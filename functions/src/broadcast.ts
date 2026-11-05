// Staff-composed notices to one person or a whole group, over the channels the
// sender picks. Every recipient gets the in-app record (the Notifications tab
// and popup in their app); push, WhatsApp, SMS and email are added on request,
// and each attempt is logged in notification_deliveries with its real status.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData } from 'firebase-admin/firestore';
import { db } from './admin';
import { audit } from './audit';
import { brandKey, deliveryRow, notify, NotificationCategory, NotificationSeverity, RecipientType } from './notify';
import { SendResult, sendEmail, sendSms, sendWhatsApp, toDigits } from './providers';
import { approved, requirePermission, text, requireAction } from './shared';

const CATEGORIES: NotificationCategory[] = ['bookings', 'approvals', 'trips', 'payments', 'penalties', 'general'];
const SEVERITIES: NotificationSeverity[] = ['info', 'success', 'warning', 'critical'];
const CHANNELS = ['in_app', 'push', 'whatsapp', 'sms', 'email'] as const;
type Channel = (typeof CHANNELS)[number];
const MAX_RECIPIENTS = 500;

interface Recipient { id: string; type: Exclude<RecipientType, 'admin'>; name: string; phone: string; email: string }

const toRecipient = (type: Recipient['type'], id: string, d: DocumentData): Recipient => ({
  id, type, name: text(d.companyName || d.name, 80), phone: text(d.phoneE164 || d.phone, 20).replace(/\s/g, ''), email: text(d.email, 120),
});

async function resolveRecipients(target: string, recipientType: string, recipientId: string): Promise<Recipient[]> {
  const collFor = (t: string) => (t === 'driver' ? 'drivers' : t === 'vendor' ? 'vendors' : 'customers');
  if (target === 'single_user') {
    if (!['driver', 'vendor', 'customer'].includes(recipientType) || !/^[A-Za-z0-9_-]{1,128}$/.test(recipientId)) throw new HttpsError('invalid-argument', 'Choose the recipient.');
    const snap = await db.doc(`${collFor(recipientType)}/${recipientId}`).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Recipient not found.');
    return [toRecipient(recipientType as Recipient['type'], snap.id, snap.data()!)];
  }
  const type = target === 'all_drivers' ? 'driver' : target === 'all_vendors' ? 'vendor' : target === 'all_customers' ? 'customer' : null;
  if (!type) throw new HttpsError('invalid-argument', 'Choose who receives the notice.');
  const snap = await db.collection(collFor(type)).limit(MAX_RECIPIENTS + 1).get();
  const active = snap.docs.filter((d) => approved(d.data().status));
  if (active.length > MAX_RECIPIENTS) throw new HttpsError('failed-precondition', `That group has more than ${MAX_RECIPIENTS} active members. Send to smaller groups.`);
  return active.map((d) => toRecipient(type, d.id, d.data()));
}

export const sendNotification = onCall({ timeoutSeconds: 300 }, async (request) => {
  const admin = await requirePermission(request.auth, 'engagement');
  requireAction(admin, 'Communication', 'send');
  const input = request.data ?? {};
  const title = text(input.title, 120);
  const message = text(input.message, 480);
  if (title.length < 3) throw new HttpsError('invalid-argument', 'Enter a title.');
  if (message.length < 3) throw new HttpsError('invalid-argument', 'Enter the message.');
  const category = CATEGORIES.includes(input.category) ? (input.category as NotificationCategory) : 'general';
  const severity = SEVERITIES.includes(input.severity) ? (input.severity as NotificationSeverity) : 'info';
  const channels = new Set<Channel>((Array.isArray(input.channels) ? input.channels : ['in_app']).filter((c: unknown): c is Channel => CHANNELS.includes(c as Channel)));
  channels.add('in_app');
  // Customers use one login on all three sites: a message goes to every site unless one brand is chosen.
  const brand = brandKey(input.brand) || 'all';
  const common = { category, severity, sound: 'general' as const, title, message, sentBy: admin.uid, push: channels.has('push'), brand };

  if (input.target === 'admin') {
    await notify({ ...common, recipientType: 'admin', recipientId: 'admin', push: false });
    return { recipients: 1, channels: { in_app: { sent: 1, failed: 0, notConfigured: 0 } } };
  }

  const recipients = await resolveRecipients(String(input.target), String(input.recipientType ?? ''), String(input.recipientId ?? ''));
  const tally: Record<string, { sent: number; failed: number; notConfigured: number }> = {};
  const count = (c: string, r: SendResult | { ok: true }) => {
    const t = (tally[c] ??= { sent: 0, failed: 0, notConfigured: 0 });
    if ('status' in r && r.status === 'not_configured') t.notConfigured++;
    else if (r.ok) t.sent++;
    else t.failed++;
  };
  const template = (process.env.WHATSAPP_TEMPLATE_BROADCAST ?? process.env.WHATSAPP_TEMPLATE_BOOKING_UPDATE ?? '').trim();

  for (let i = 0; i < recipients.length; i += 10) {
    await Promise.all(recipients.slice(i, i + 10).map(async (r) => {
      const id = await notify({ ...common, recipientType: r.type, recipientId: r.id });
      count('in_app', { ok: true });
      const log = (res: SendResult) => {
        count(res.channel, res);
        return db.collection('notification_deliveries').add(deliveryRow(id ?? '', { recipientId: r.id, recipientType: r.type, category, title, message }, res.channel,
          res.status === 'sent' ? 'sent' : res.status === 'not_configured' ? 'not_configured' : 'failed', { provider: res.provider, providerMessageId: res.providerMessageId ?? '', error: res.error ?? '', kind: 'broadcast' }));
      };
      if (channels.has('whatsapp') && toDigits(r.phone).length >= 10) {
        await log(template ? await sendWhatsApp(r.phone, { name: template, bodyParams: [r.name || 'there', `${title}: ${message}`] })
          : { ok: false, channel: 'whatsapp', status: 'not_configured', provider: 'whatsapp_cloud', error: 'No WhatsApp template is configured.' });
      }
      if (channels.has('sms') && toDigits(r.phone).length >= 10) await log(await sendSms(r.phone, { text: `${title}: ${message}`, variables: { message: `${title}: ${message}` } }));
      if (channels.has('email') && r.email) await log(await sendEmail(r.email, { subject: title, text: `Hello ${r.name || ''},\n\n${message}\n\nNESAM Tours & Travels` }));
    }));
  }
  await audit({ action: 'notification_sent', entity: 'notification', entityId: String(input.target), performedBy: admin.uid, performedByName: admin.name, role: 'admin', meta: { recipients: recipients.length, channels: [...channels], category } });
  return { recipients: recipients.length, channels: tally };
});
