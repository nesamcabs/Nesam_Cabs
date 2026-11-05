// One-time verification codes for customers, delivered by WhatsApp, SMS and
// email. Codes come from a secure random source, are stored only as a salted
// HMAC (never the code itself), expire after ten minutes, allow five tries,
// can be re-sent no more than once a minute and five times an hour per
// booking, and every delivery attempt is logged with its status.
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { db } from './admin';
import { audit } from './audit';
import { loadContact } from './contacts';
import { contactOf } from './customerComms';
import { deliveryRow } from './notify';
import { Channel, SendResult, mask, sendEmail, sendSms, sendWhatsApp, toDigits } from './providers';
import { logSecurityEvent, requestIp } from './security';
import { requirePermission, text, requireAction } from './shared';

const CODE_TTL_MS = 10 * 60000;
const RESEND_COOLDOWN_MS = 60000;
const MAX_ATTEMPTS = 5;
const MAX_PER_BOOKING_PER_HOUR = 5;
const MAX_PER_PHONE_PER_HOUR = 8;

const pepper = (): string => {
  const p = (process.env.OTP_PEPPER ?? '').trim();
  if (p.length < 16) throw new HttpsError('failed-precondition', 'Verification codes are not configured on the server yet (OTP_PEPPER).');
  return p;
};
const hashCode = (code: string, salt: string) => createHmac('sha256', pepper()).update(`${salt}:${code}`).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const CHANNELS: Channel[] = ['whatsapp', 'sms', 'email'];

export const sendVerificationCode = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireAction(admin, 'Bookings', 'create');
  const bookingId = text(request.data?.bookingId, 128);
  const wanted = (Array.isArray(request.data?.channels) ? request.data.channels : CHANNELS).filter((c: unknown): c is Channel => CHANNELS.includes(c as Channel));
  if (!bookingId) throw new HttpsError('invalid-argument', 'Choose a booking.');
  if (!wanted.length) throw new HttpsError('invalid-argument', 'Choose at least one channel.');
  const snap = await db.doc(`bookings/${bookingId}`).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const b = snap.data()!;
  const stored = await loadContact(bookingId, b);
  const c = { ...contactOf(b), phone: stored.phone, whatsapp: stored.whatsapp, email: stored.email };
  const dest: Partial<Record<Channel, string>> = {};
  if (wanted.includes('whatsapp') && toDigits(c.whatsapp).length >= 10) dest.whatsapp = c.whatsapp;
  if (wanted.includes('sms') && toDigits(c.phone).length >= 10) dest.sms = c.phone;
  if (wanted.includes('email') && c.email) dest.email = c.email;
  // Email is optional: with no address the other channels carry on.
  if (!Object.keys(dest).length) throw new HttpsError('failed-precondition', 'The customer has no contact for the chosen channels.');
  const phoneKey = createHmac('sha256', pepper()).update(toDigits(c.phone)).digest('hex').slice(0, 32);

  const hourAgo = Timestamp.fromMillis(Date.now() - 3600000);
  const [recent, byPhone] = await Promise.all([
    db.collection('otp_verifications').where('bookingId', '==', bookingId).where('createdAt', '>', hourAgo).get(),
    db.collection('otp_verifications').where('phoneKey', '==', phoneKey).where('createdAt', '>', hourAgo).get(),
  ]);
  const newest = Math.max(0, ...recent.docs.map((d) => (d.data().createdAt as Timestamp).toMillis()));
  if (Date.now() - newest < RESEND_COOLDOWN_MS) throw new HttpsError('resource-exhausted', `Wait ${Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - newest)) / 1000)} seconds before sending another code.`);
  if (recent.size >= MAX_PER_BOOKING_PER_HOUR) throw new HttpsError('resource-exhausted', 'Too many codes were sent for this booking. Try again in an hour.');
  if (byPhone.size >= MAX_PER_PHONE_PER_HOUR) {
    await logSecurityEvent({ type: 'otp_rate_limited', severity: 'medium', userId: admin.uid, role: 'admin', bookingId, source: 'server', details: { destination: mask.phone(c.phone) }, ip: requestIp(request) }).catch(() => null);
    throw new HttpsError('resource-exhausted', 'Too many codes were sent to this number. Try again in an hour.');
  }

  const code = String(randomInt(100000, 1000000));
  const salt = randomBytes(12).toString('hex');
  const ref = db.collection('otp_verifications').doc();
  // Older pending codes stop working the moment a new one is issued.
  await Promise.all(recent.docs.filter((d) => d.data().status === 'pending').map((d) => d.ref.update({ status: 'superseded' })));
  await ref.set({
    bookingId, purpose: 'customer_verification', codeHash: hashCode(code, salt), salt, phoneKey, attempts: 0, maxAttempts: MAX_ATTEMPTS, status: 'pending',
    expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS), createdBy: admin.uid, createdAt: FieldValue.serverTimestamp(),
    destinations: Object.fromEntries(Object.entries(dest).map(([k, v]) => [k, k === 'email' ? mask.email(v!) : mask.phone(v!)])),
  });

  const sms = `Your NESAM verification code is ${code}. It is valid for 10 minutes. Do not share it with anyone.`;
  const jobs: Promise<SendResult>[] = [];
  if (dest.whatsapp) {
    const tpl = (process.env.WHATSAPP_TEMPLATE_OTP ?? '').trim();
    jobs.push(tpl ? sendWhatsApp(dest.whatsapp, { name: tpl, bodyParams: [code], otpButton: code }) : Promise.resolve({ ok: false, channel: 'whatsapp' as Channel, status: 'not_configured' as const, provider: 'whatsapp_cloud', error: 'No WhatsApp OTP template is configured.' }));
  }
  if (dest.sms) jobs.push(sendSms(dest.sms, { text: sms, variables: { otp: code, var1: code } }));
  if (dest.email) jobs.push(sendEmail(dest.email, { subject: 'Your NESAM verification code', text: `${sms}\n\nIf you did not request this, ignore this message.` }));
  const results = await Promise.all(jobs);
  const row = { recipientId: text(b.customerId) || bookingId, recipientType: 'customer' as const, category: 'general' as const, title: 'Verification code', message: 'Verification code sent', bookingId };
  await Promise.all(results.map((r) => db.collection('notification_deliveries').add(deliveryRow('', row, r.channel, r.status === 'sent' ? 'sent' : r.status === 'not_configured' ? 'not_configured' : 'failed', {
    provider: r.provider, providerMessageId: r.providerMessageId ?? '', error: r.error ?? '', kind: 'otp', otpId: ref.id,
  }))));
  const delivered = results.filter((r) => r.ok);
  await ref.update({ channels: results.map((r) => ({ channel: r.channel, status: r.status, ...(r.error ? { error: r.error } : {}) })), status: delivered.length ? 'pending' : 'failed' });
  await audit({ action: 'verification_code_sent', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, meta: { channels: results.map((r) => `${r.channel}:${r.status}`) } });
  if (!delivered.length) {
    throw new HttpsError('unavailable', `The code could not be delivered. ${results.map((r) => `${r.channel}: ${r.error ?? r.status}`).join(' ')}`);
  }
  return { sent: results.map((r) => ({ channel: r.channel, status: r.status, ...(r.error ? { error: r.error } : {}) })), expiresInMinutes: CODE_TTL_MS / 60000 };
});

export const verifyCustomerCode = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireAction(admin, 'Bookings', 'create');
  const bookingId = text(request.data?.bookingId, 128);
  const code = text(request.data?.code, 8);
  if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Enter the 6-digit code.');
  const pending = await db.collection('otp_verifications').where('bookingId', '==', bookingId).where('status', '==', 'pending').get();
  const latest = pending.docs.sort((a, b) => (b.data().createdAt as Timestamp).toMillis() - (a.data().createdAt as Timestamp).toMillis())[0];
  if (!latest) throw new HttpsError('failed-precondition', 'There is no active code. Send a new one.');
  let locked = false;
  const outcome = await db.runTransaction(async (tx) => {
    locked = false;
    const snap = await tx.get(latest.ref);
    const d = snap.data()!;
    if (d.status !== 'pending') throw new HttpsError('failed-precondition', 'This code is no longer active. Send a new one.');
    if ((d.expiresAt as Timestamp).toMillis() < Date.now()) { tx.update(latest.ref, { status: 'expired' }); return 'expired' as const; }
    if (sameHash(hashCode(code, d.salt), d.codeHash)) {
      tx.update(latest.ref, { status: 'verified', verifiedAt: FieldValue.serverTimestamp(), verifiedBy: admin.uid });
      tx.update(db.doc(`bookings/${bookingId}`), { customerVerified: true, customerVerifiedAt: FieldValue.serverTimestamp(), customerVerifiedBy: admin.uid, updatedAt: FieldValue.serverTimestamp() });
      return 'ok' as const;
    }
    const attempts = (d.attempts ?? 0) + 1;
    locked = attempts >= MAX_ATTEMPTS;
    tx.update(latest.ref, { attempts, ...(locked ? { status: 'locked', lockedAt: FieldValue.serverTimestamp() } : {}) });
    return locked ? ('locked' as const) : (`wrong:${MAX_ATTEMPTS - attempts}` as const);
  });
  if (outcome === 'ok') {
    await audit({ action: 'customer_verified', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId });
    return { verified: true };
  }
  if (locked) await logSecurityEvent({ type: 'otp_attempts_exceeded', severity: 'medium', userId: admin.uid, role: 'admin', bookingId, source: 'server', details: { purpose: 'customer_verification' }, ip: requestIp(request) }).catch(() => null);
  if (outcome === 'expired') throw new HttpsError('failed-precondition', 'This code has expired. Send a new one.');
  if (outcome === 'locked') throw new HttpsError('failed-precondition', 'Too many wrong codes. Send a new code.');
  throw new HttpsError('failed-precondition', `That code is not correct. ${outcome.split(':')[1]} attempts left.`);
});

/**
 * WhatsApp delivery receipts (sent / delivered / read / failed). Configure this URL
 * in the Meta app's webhook settings with WHATSAPP_WEBHOOK_VERIFY_TOKEN; requests are
 * accepted only with a valid X-Hub-Signature-256 made with WHATSAPP_APP_SECRET.
 */
export const whatsappWebhook = onRequest(async (req, res) => {
  const verifyToken = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
  const secret = (process.env.WHATSAPP_APP_SECRET ?? '').trim();
  if (req.method === 'GET') {
    if (verifyToken && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) { res.status(200).send(String(req.query['hub.challenge'] ?? '')); return; }
    res.sendStatus(403);
    return;
  }
  if (req.method !== 'POST' || !secret) { res.sendStatus(403); return; }
  const sig = String(req.headers['x-hub-signature-256'] ?? '');
  const expected = `sha256=${createHmac('sha256', secret).update(req.rawBody).digest('hex')}`;
  if (!sameHash(sig, expected)) { res.sendStatus(403); return; }
  const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
  const statuses = (req.body?.entry ?? []).flatMap((e: any) => (e.changes ?? []).flatMap((c: any) => c.value?.statuses ?? []));
  for (const s of statuses) {
    const status = map[s.status];
    if (!status || !s.id) continue;
    const rows = await db.collection('notification_deliveries').where('providerMessageId', '==', s.id).limit(5).get();
    await Promise.all(rows.docs.map((d) => d.ref.update({ status, statusAt: FieldValue.serverTimestamp(), ...(status === 'failed' ? { error: String(s.errors?.[0]?.title ?? 'Delivery failed').slice(0, 200) } : {}) })));
  }
  res.sendStatus(200);
});
