// Customer support requests and website contact forms, end to end:
//
//   submitSupportRequest   a signed-in customer (app / website) or a website visitor sends a request. It is saved in
//                          support_tickets, the office gets an in-app alert and an email (OFFICE_EMAIL, reply goes to the
//                          customer), and the customer gets an email acknowledgement when an address is known.
//   updateSupportRequest   office staff move a request to In Progress / Resolved / Closed with an optional note; the customer
//                          is emailed the update.
// Visitor requests are rate-limited per IP and carry a hidden honeypot field, so the form cannot be used to spam the inbox.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { PUBLIC_CALLABLE_ORIGINS } from './corsOrigins';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { EMAIL_RE, brandOf, renderEmail } from './mailer';
import { mailOfficeSupport } from './officeMail';
import { notify } from './notify';
import { sendEmail } from './providers';
import { requestIp } from './security';
import { rateLimited } from './http/util';
import { requirePermission, text } from './shared';

const bad = (m: string) => new HttpsError('invalid-argument', m);
const CATEGORIES = ['Booking help', 'Change or cancel a booking', 'Fare or payment', 'Refund', 'Driver or vehicle', 'Lost item', 'Safety concern', 'Account deletion', 'Feedback', 'Corporate / business travel', 'Partner with us', 'Other'];
const PHONE_RE = /^\+?[0-9\s-]{10,16}$/;

export const submitSupportRequest = onCall({ timeoutSeconds: 30, cors: PUBLIC_CALLABLE_ORIGINS }, async (request) => {
  const input = (request.data ?? {}) as Record<string, unknown>;
  // Honeypot: real people never see or fill this field. Pretend success so bots learn nothing.
  if (text(input.website, 200)) return { id: 'received' };
  const uid = request.auth?.uid ?? '';
  const ip = requestIp(request as never) || 'unknown';
  if (rateLimited(`support:${uid || ip}`, uid ? 10 : 4, 10 * 60 * 1000)) throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a few minutes or call us.');

  const brand = brandOf(text(input.brand, 40) || 'nesam');
  const categoryIn = text(input.category, 80);
  const category = CATEGORIES.includes(categoryIn) ? categoryIn : categoryIn ? 'Other' : 'Booking help';
  const message = text(input.message ?? input.description, 2000);
  if (message.length < 10) throw bad('Tell us a little more (at least 10 characters).');
  const bookingId = text(input.bookingId, 40).toUpperCase();

  let name = text(input.name, 80);
  let email = text(input.email, 120).toLowerCase();
  let phone = text(input.phone, 20);
  const customer = uid ? await db.doc(`customers/${uid}`).get() : null;
  if (customer?.exists) {
    const c = customer.data()!;
    name = name || text(c.name, 80);
    phone = phone || text(c.phone, 20);
    email = email || text(c.email, 120).toLowerCase();
  } else {
    if (name.length < 2) throw bad('Enter your name.');
    if (!email && !phone) throw bad('Enter an email address or a phone number so we can reply.');
  }
  if (email && !EMAIL_RE.test(email)) throw bad('Enter a valid email address.');
  if (phone && !PHONE_RE.test(phone)) throw bad('Enter a valid phone number.');

  const ref = db.collection('support_tickets').doc();
  const stamp = FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    tx.create(ref, {
      ...(customer?.exists ? { customerId: uid } : {}),
      customerName: name, customerPhone: phone, customerEmail: email,
      category, bookingId, description: message, brand: brand.id,
      source: customer?.exists ? (text(input.source, 30) || 'customer-app') : 'website-contact',
      status: 'Open', createdAt: stamp, updatedAt: stamp,
    });
    auditInTx(tx, { action: 'support_request_created', entity: 'support_ticket', entityId: ref.id, performedBy: uid || 'visitor', performedByName: name, role: customer?.exists ? 'customer' : 'system', next: { category, brand: brand.id } });
  });

  await Promise.all([
    notify({
      recipientType: 'admin', recipientId: 'admin', category: 'general', severity: category === 'Safety concern' ? 'warning' : 'info', sound: 'general', push: true,
      title: `${brand.name} support request`, message: `${category} · ${name || 'Website visitor'}${bookingId ? ` · ${bookingId}` : ''}`,
      cta: { label: 'Open support', page: 'support' }, sentBy: uid || 'visitor',
    }).catch((err) => console.warn('support notify failed', err)),
    mailOfficeSupport({ ticketId: ref.id, brand, name, email, phone, category, bookingId, message, signedIn: !!customer?.exists }).catch((err) => console.warn('support office mail failed', err)),
    email ? (async () => {
      const mail = renderEmail(brand, {
        title: 'We have received your request',
        greeting: `Hello ${name || 'there'},`,
        paragraphs: [`Thank you for contacting ${brand.name}. Our team will get back to you shortly. For anything urgent about a trip today, please call us.`],
        rows: [['Reference', ref.id.slice(0, 8).toUpperCase()], ['Topic', category], ['Booking ID', bookingId], ['Your message', message]],
      });
      await sendEmail(email, { subject: `${brand.name}: we received your request`, text: mail.text, html: mail.html, brand });
    })().catch((err) => console.warn('support ack mail failed', err)) : Promise.resolve(),
  ]);
  return { id: ref.id };
});

const STATUSES = ['In Progress', 'Resolved', 'Closed'] as const;

export const updateSupportRequest = onCall({ timeoutSeconds: 30 }, async (request) => {
  const admin = await requirePermission(request.auth, 'engagement');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const ticketId = text(input.ticketId, 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(ticketId)) throw bad('Invalid request.');
  const status = text(input.status, 20) as (typeof STATUSES)[number];
  if (!STATUSES.includes(status)) throw bad('Choose In Progress, Resolved or Closed.');
  const note = text(input.note, 1000);
  if (status === 'Resolved' && note.length < 3) throw bad('Write the office resolution.');
  const notifyCustomer = input.notifyCustomer !== false;

  const ref = db.doc(`support_tickets/${ticketId}`);
  const t = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'This request no longer exists.');
    const stamp = FieldValue.serverTimestamp();
    tx.update(ref, {
      status, updatedAt: stamp, handledBy: admin.uid, handledByName: admin.name,
      ...(status === 'Resolved' || status === 'Closed' ? { resolution: note, resolvedBy: admin.uid, resolvedByName: admin.name, resolvedAt: stamp } : {}),
    });
    auditInTx(tx, { action: 'support_request_updated', entity: 'support_ticket', entityId: ticketId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', previous: { status: snap.data()!.status }, next: { status } });
    return snap.data()!;
  });

  let emailed = false;
  let email = text(t.customerEmail, 120);
  if (!email && t.customerId) email = text((await db.doc(`customers/${t.customerId}`).get()).data()?.email, 120);
  if (notifyCustomer && email && EMAIL_RE.test(email)) {
    const brand = brandOf(text(t.brand, 40));
    const mail = renderEmail(brand, {
      title: status === 'In Progress' ? 'We are working on your request' : status === 'Resolved' ? 'Your request is resolved' : 'Your request is closed',
      greeting: `Hello ${text(t.customerName, 80) || 'there'},`,
      paragraphs: [
        status === 'In Progress' ? 'A member of our team is now handling your request.' : 'Here is the outcome of your request.',
        ...(note ? [note] : []),
        'Reply to this email if you need anything else.',
      ],
      rows: [['Reference', ticketId.slice(0, 8).toUpperCase()], ['Topic', text(t.category, 80)], ['Booking ID', text(t.bookingId, 40)]],
    });
    const r = await sendEmail(email, { subject: `${brand.name}: update on your request`, text: mail.text, html: mail.html, brand });
    emailed = r.ok;
  }
  return { ok: true, emailed };
});

// ── Account deletion ─────────────────────────────────────────────────────────
// A signed-in customer, driver or vendor asks for their account and personal data to be erased. The request is saved as a support
// ticket (source "account-deletion", one deterministic ticket per account) so the office sees it in Support, is alerted, and the
// person gets an email acknowledgement. Nothing is deleted automatically: the office confirms identity, settles anything still
// open (live bookings, unpaid dues, wallet or deposit balance) and keeps only the records the law requires (e.g. invoices).
const DELETION_ROLES = ['customer', 'driver', 'vendor'] as const;

export const requestAccountDeletion = onCall({ timeoutSeconds: 30 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to request deletion of your account.');
  if (rateLimited(`acctdel:${uid}`, 5, 60 * 60 * 1000)) throw new HttpsError('resource-exhausted', 'Too many requests. Please try again later.');
  const input = (request.data ?? {}) as Record<string, unknown>;
  const reason = text(input.reason, 500);
  const hint = text(input.role, 20);

  const [c, d, v] = await Promise.all([db.doc(`customers/${uid}`).get(), db.doc(`drivers/${uid}`).get(), db.doc(`vendors/${uid}`).get()]);
  const found = [c.exists && 'customer', d.exists && 'driver', v.exists && 'vendor'].filter(Boolean) as (typeof DELETION_ROLES)[number][];
  if (found.length === 0) throw new HttpsError('failed-precondition', 'We could not find an account for this sign-in.');
  const role = (DELETION_ROLES as readonly string[]).includes(hint) && found.includes(hint as never) ? (hint as (typeof DELETION_ROLES)[number]) : found[0]!;
  const profile = (role === 'customer' ? c : role === 'driver' ? d : v).data() ?? {};
  const name = text(profile.name ?? profile.fullName ?? profile.businessName, 80);
  const phone = text(profile.phone ?? profile.mobile, 20);
  const email = text(profile.email, 120).toLowerCase();

  // Live bookings the office must settle before erasing (customers only; partners are checked by the office against duties and dues).
  let liveBookings = 0;
  if (role === 'customer') {
    const snap = await db.collection('bookings').where('customerId', '==', uid).get();
    liveBookings = snap.docs.filter((b) => !['Completed', 'Cancelled'].includes(String(b.data().status))).length;
  }

  const ref = db.doc(`support_tickets/acctdel_${uid}`);
  const stamp = FieldValue.serverTimestamp();
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && ['Open', 'In Progress'].includes(String(snap.data()!.status))) return false; // repeat tap or retry: one open request only
    tx.set(ref, {
      customerId: uid, customerName: name, customerPhone: phone, customerEmail: email,
      category: 'Account deletion', bookingId: '', brand: 'nesam', source: 'account-deletion', accountRole: role,
      description: `Account deletion requested by ${role} ${name || uid}.${reason ? ` Reason: ${reason}` : ''}${liveBookings ? ` ${liveBookings} booking(s) still open.` : ''}`,
      status: 'Open', createdAt: stamp, updatedAt: stamp,
    });
    auditInTx(tx, { action: 'account_deletion_requested', entity: 'support_ticket', entityId: ref.id, performedBy: uid, performedByName: name, role, next: { role, liveBookings } });
    return true;
  });

  if (created) {
    const brand = brandOf('nesam');
    await Promise.all([
      notify({
        recipientType: 'admin', recipientId: 'admin', category: 'general', severity: 'warning', sound: 'general', push: true,
        title: 'Account deletion request', message: `${role} · ${name || uid}${liveBookings ? ` · ${liveBookings} open booking(s)` : ''}`,
        cta: { label: 'Open support', page: 'support' }, sentBy: uid,
      }).catch((err) => console.warn('deletion notify failed', err)),
      email && EMAIL_RE.test(email) ? (async () => {
        const mail = renderEmail(brand, {
          title: 'We received your account deletion request',
          greeting: `Hello ${name || 'there'},`,
          paragraphs: ['Our team will verify the request, settle anything still open on your account and then confirm by email or phone. Records we must keep by law, such as invoices, are retained.'],
          rows: [['Reference', ref.id.slice(-8).toUpperCase()]],
        });
        await sendEmail(email, { subject: `${brand.name}: account deletion request received`, text: mail.text, html: mail.html, brand });
      })().catch((err) => console.warn('deletion ack mail failed', err)) : Promise.resolve(),
    ]);
  }
  return { requested: true, alreadyOpen: !created, liveBookings, reference: ref.id.slice(-8).toUpperCase() };
});
