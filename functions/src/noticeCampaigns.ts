// Communication › Messages & notices: festival wishes, common service notices and personal
// warnings composed by the office (notice_campaigns). Staff save a Draft with the exact
// recipient list (duplicate contacts already merged), then send now or schedule it. Each
// person gets one in-app record per linked account; WhatsApp / SMS / email go once per
// contact. Every attempt is logged in notification_deliveries with the campaign id, and
// failed external attempts can be retried on their own.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { audit } from './audit';
import { deliveryRow, notify, RecipientType } from './notify';
import { SendResult, sendEmail, sendSms, sendWhatsApp, toDigits } from './providers';
import { approved, requirePermission, text, requireAction } from './shared';

type Account = { type: Exclude<RecipientType, 'admin'>; id: string };
interface CampaignRecipient { name: string; phone?: string; email?: string; accounts: Account[] }

const EXTERNAL = ['whatsapp', 'sms', 'email'] as const;
const MAX_RECIPIENTS = 2000;
const CLOSED = ['Suspended', 'Inactive', 'Permanent block', 'Closed', 'Dispute hold'];
const collOf = (t: Account['type']) => (t === 'driver' ? 'drivers' : t === 'vendor' ? 'vendors' : 'customers');

function isActive(type: Account['type'], d: FirebaseFirestore.DocumentData): boolean {
  if (CLOSED.includes(String(d.accountStatus ?? ''))) return false;
  if (type === 'customer') return d.status !== 'Blocked' && d.blocked !== true;
  return approved(d.status) || d.accountStatus === 'Active';
}

function recipientsOf(raw: unknown): CampaignRecipient[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_RECIPIENTS).map((r) => ({
    name: text(r?.name, 80),
    phone: text(r?.phone, 20).replace(/\s/g, ''),
    email: text(r?.email, 120),
    accounts: (Array.isArray(r?.accounts) ? r.accounts : [])
      .filter((a: Account) => ['customer', 'driver', 'vendor'].includes(a?.type) && /^[A-Za-z0-9_-]{1,128}$/.test(String(a?.id ?? '')))
      .slice(0, 4),
  })).filter((r) => r.accounts.length > 0);
}

/** Delivers a campaign that has been claimed (status Sending). */
async function deliverCampaign(id: string, sentBy: string, sentByName: string): Promise<{ recipients: number; failed: number }> {
  const ref = db.doc(`notice_campaigns/${id}`);
  const c = (await ref.get()).data() ?? {};
  const title = text(c.title, 120);
  const message = text(c.body, 1200);
  const channels = new Set<string>((Array.isArray(c.channels) ? c.channels : []).filter((x: string) => (EXTERNAL as readonly string[]).includes(x)));
  const push = c.push !== false;
  const severity = c.kind === 'Personal warning' ? 'warning' as const : 'info' as const;
  const meta: Record<string, string | boolean> = {
    campaignId: id, noticeKind: text(c.kind, 40), language: text(c.language, 20), requiresAck: c.requiresAck === true,
    imageUrl: text(c.image?.url, 1000), tripReference: text(c.trip, 60),
  };
  const template = (process.env.WHATSAPP_TEMPLATE_BROADCAST ?? process.env.WHATSAPP_TEMPLATE_BOOKING_UPDATE ?? '').trim();
  const people = recipientsOf(c.recipients);
  let sent = 0, failed = 0, skipped = 0;

  for (let i = 0; i < people.length; i += 10) {
    await Promise.all(people.slice(i, i + 10).map(async (p) => {
      // Re-check each account at send time: removed or (when asked) inactive accounts are skipped.
      const live: Account[] = [];
      for (const a of p.accounts) {
        const snap = await db.doc(`${collOf(a.type)}/${a.id}`).get();
        if (snap.exists && (!c.onlyActive || isActive(a.type, snap.data()!))) live.push(a);
      }
      if (!live.length) { skipped++; return; }
      let firstId = '';
      for (const a of live) {
        const nid = await notify({ recipientType: a.type, recipientId: a.id, brand: 'all', category: 'general', severity, sound: 'general', title, message, sentBy, push, meta });
        firstId ||= nid ?? '';
      }
      sent++;
      const first = live[0];
      const log = (res: SendResult) => {
        if (!res.ok) failed++;
        return db.collection('notification_deliveries').add(deliveryRow(firstId, { recipientId: first.id, recipientType: first.type, category: 'general', title, message, meta }, res.channel,
          res.status === 'sent' ? 'sent' : res.status === 'not_configured' ? 'not_configured' : 'failed',
          { provider: res.provider, providerMessageId: res.providerMessageId ?? '', error: res.error ?? '', kind: 'campaign', recipientName: p.name, attempts: 1 }));
      };
      if (channels.has('whatsapp') && toDigits(p.phone ?? '').length >= 10) {
        await log(template ? await sendWhatsApp(p.phone!, { name: template, bodyParams: [p.name || 'there', `${title}: ${message}`.slice(0, 900)] })
          : { ok: false, channel: 'whatsapp', status: 'not_configured', provider: 'whatsapp_cloud', error: 'No WhatsApp template is configured.' });
      }
      if (channels.has('sms') && toDigits(p.phone ?? '').length >= 10) await log(await sendSms(p.phone!, { text: `${title}: ${message}`, variables: { message: `${title}: ${message}` } }));
      if (channels.has('email') && p.email) await log(await sendEmail(p.email, { subject: title, text: `Hello ${p.name || ''},\n\n${message}\n\nNESAM Tours & Travels` }));
    }));
  }
  await ref.update({ status: 'Sent', sentAt: FieldValue.serverTimestamp(), sentByName, counts: { sent, failed, skipped } });
  await audit({ action: 'notice_campaign_sent', entity: 'notice_campaign', entityId: id, performedBy: sentBy, performedByName: sentByName, role: 'admin', meta: { recipients: sent, skipped, failed, channels: ['in_app', ...channels] } });
  return { recipients: sent, failed };
}

/** Moves a Draft (or due Scheduled) campaign to Sending exactly once. */
async function claim(id: string, allowed: string[]): Promise<FirebaseFirestore.DocumentData> {
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`notice_campaigns/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Notification not found.');
    const d = snap.data()!;
    if (!allowed.includes(d.status)) throw new HttpsError('failed-precondition', `This notification is already ${String(d.status).toLowerCase()}.`);
    if (text(d.title, 120).length < 3 || text(d.body, 1200).length < 3) throw new HttpsError('failed-precondition', 'Enter the notification title and message.');
    if (!recipientsOf(d.recipients).length) throw new HttpsError('failed-precondition', 'Choose at least one recipient.');
    tx.update(ref, { status: 'Sending', sendingAt: FieldValue.serverTimestamp() });
    return d;
  });
}

export const sendNoticeCampaign = onCall({ timeoutSeconds: 540, memory: '512MiB' }, async (request) => {
  const admin = await requirePermission(request.auth, 'engagement');
  requireAction(admin, 'Communication', 'send');
  const id = text(request.data?.campaignId, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpsError('invalid-argument', 'Choose the notification.');
  if (request.data?.mode === 'schedule') {
    const at = Date.parse(String(request.data?.sendAt ?? ''));
    if (!Number.isFinite(at) || at < Date.now() + 60_000) throw new HttpsError('invalid-argument', 'Choose a send time at least one minute from now.');
    if (at > Date.now() + 90 * 86_400_000) throw new HttpsError('invalid-argument', 'Schedule within the next 90 days.');
    await db.runTransaction(async (tx) => {
      const ref = db.doc(`notice_campaigns/${id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'Notification not found.');
      if (snap.data()!.status !== 'Draft') throw new HttpsError('failed-precondition', 'Only a draft can be scheduled.');
      if (!recipientsOf(snap.data()!.recipients).length) throw new HttpsError('failed-precondition', 'Choose at least one recipient.');
      tx.update(ref, { status: 'Scheduled', sendAt: Timestamp.fromMillis(at), scheduledBy: admin.uid, scheduledByName: admin.name });
    });
    await audit({ action: 'notice_campaign_scheduled', entity: 'notice_campaign', entityId: id, performedBy: admin.uid, performedByName: admin.name, role: 'admin', meta: { sendAt: new Date(at).toISOString() } });
    return { status: 'Scheduled' };
  }
  await claim(id, ['Draft']);
  const res = await deliverCampaign(id, admin.uid, admin.name);
  return { status: 'Sent', ...res };
});

/** Called by periodicJobs: sends scheduled campaigns that are due. */
export async function runScheduledNotices(): Promise<number> {
  const due = await db.collection('notice_campaigns').where('status', '==', 'Scheduled').where('sendAt', '<=', Timestamp.now()).limit(5).get();
  let n = 0;
  for (const d of due.docs) {
    try {
      const c = await claim(d.id, ['Scheduled']);
      await deliverCampaign(d.id, text(c.scheduledBy, 128) || 'system', text(c.scheduledByName, 80) || 'Scheduled send');
      n++;
    } catch (err) {
      console.warn('scheduled notice failed', d.id, err);
    }
  }
  return n;
}

/** Retries failed WhatsApp / SMS / email attempts (a campaign's rows or all recent failures), or resends one row. */
export const retryFailedDeliveries = onCall({ timeoutSeconds: 300 }, async (request) => {
  const admin = await requirePermission(request.auth, 'engagement');
  requireAction(admin, 'Communication', 'send');
  const deliveryId = text(request.data?.deliveryId, 128);
  const campaignId = text(request.data?.campaignId, 128);
  let docs: FirebaseFirestore.DocumentSnapshot[];
  if (deliveryId) {
    const one = await db.doc(`notification_deliveries/${deliveryId}`).get();
    if (!one.exists) throw new HttpsError('not-found', 'Delivery not found.');
    docs = [one];
  } else {
    let q: FirebaseFirestore.Query = db.collection('notification_deliveries').where('status', '==', 'failed');
    if (campaignId) q = q.where('campaignId', '==', campaignId);
    docs = (await q.limit(200).get()).docs;
  }
  let retried = 0, recovered = 0;
  for (const row of docs) {
    const r = row.data()!;
    // A named row may be resent whatever its status; the bulk retry takes failed rows only.
    if ((!deliveryId && r.status !== 'failed') || !(EXTERNAL as readonly string[]).includes(r.channel)) continue;
    const type = ['customer', 'driver', 'vendor'].includes(r.recipientType) ? (r.recipientType as Account['type']) : null;
    if (!type || !r.recipientId) continue;
    const who = (await db.doc(`${collOf(type)}/${r.recipientId}`).get()).data();
    if (!who) continue;
    const phone = text(who.phoneE164 || who.phone, 20).replace(/\s/g, '');
    const email = text(who.email, 120);
    const name = text(who.companyName || who.name, 80);
    const title = text(r.title, 140), message = text(r.message, 300);
    let res: SendResult;
    if (r.channel === 'email') {
      if (!email) continue;
      res = await sendEmail(email, { subject: title, text: `Hello ${name},\n\n${message}\n\nNESAM Tours & Travels` });
    } else if (r.channel === 'sms') {
      if (toDigits(phone).length < 10) continue;
      res = await sendSms(phone, { text: `${title}: ${message}`, variables: { message: `${title}: ${message}` } });
    } else {
      const template = (process.env.WHATSAPP_TEMPLATE_BROADCAST ?? process.env.WHATSAPP_TEMPLATE_BOOKING_UPDATE ?? '').trim();
      if (toDigits(phone).length < 10) continue;
      res = template ? await sendWhatsApp(phone, { name: template, bodyParams: [name || 'there', `${title}: ${message}`] })
        : { ok: false, channel: 'whatsapp', status: 'not_configured', provider: 'whatsapp_cloud', error: 'No WhatsApp template is configured.' };
    }
    retried++;
    if (res.ok) recovered++;
    await row.ref.update({
      status: res.status === 'sent' ? 'sent' : res.status === 'not_configured' ? 'not_configured' : 'failed',
      error: res.error ?? '', provider: res.provider, providerMessageId: res.providerMessageId ?? '',
      attempts: FieldValue.increment(1), lastRetryAt: FieldValue.serverTimestamp(), lastRetryBy: admin.uid,
    });
  }
  await audit({ action: 'notification_retry', entity: 'notification_delivery', entityId: deliveryId || campaignId || 'failed', performedBy: admin.uid, performedByName: admin.name, role: 'admin', meta: { retried, recovered } });
  return { retried, recovered };
});
