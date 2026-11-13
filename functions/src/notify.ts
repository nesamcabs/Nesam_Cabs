// Server-side notifications. Every event is stored once as an in-app record in
// the inbox of the panel it is for — one collection per audience, so a panel can
// never read (or show) another panel's notifications, even when one login is a
// rider, a driver and a vendor at the same time:
//
//   customer_notifications   rider apps and sites (NESAM Cabs, One Way Car Rentals, People Taxi; `brand` picks the site)
//   driver_notifications     driver partner app (owner-drivers and vendor fleet drivers)
//   vendor_notifications     vendor partner app
//   admin_notifications      the shared office inbox (recipientId 'admin')
//
// Each record carries a category, severity and sound key the apps use to pick a
// tab, a colour and a tone. Every delivery attempt on any channel is logged in
// `notification_deliveries` (recipient, channel, status, booking), and a push
// goes only to the devices registered by that audience's app (device_tokens.role).
//
// Categories mirror the tabs in every app: Bookings, Approvals, Trips,
// Payments, Penalties, General. Three tones exist — new booking, approval /
// confirmation, and general — mapped to separate Android channels.
import { createHash } from 'crypto';
import { FieldValue, Firestore, Transaction } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { db } from './admin';

export type NotificationCategory = 'bookings' | 'approvals' | 'trips' | 'payments' | 'penalties' | 'general';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NotificationSound = 'new_booking' | 'approval' | 'general';
export type RecipientType = 'admin' | 'driver' | 'vendor' | 'customer';

/** The inbox collection of each audience. Only the server writes them (firestore.rules). */
export const INBOX_COLLECTION: Readonly<Record<RecipientType, string>> = Object.freeze({
  customer: 'customer_notifications',
  driver: 'driver_notifications',
  vendor: 'vendor_notifications',
  admin: 'admin_notifications',
});

/** The collection that held every audience's notifications together; read-only since the split (scripts/migrate-notifications.cjs). */
export const LEGACY_NOTIFICATIONS = 'notifications';

export const inboxOf = (type: RecipientType): string => INBOX_COLLECTION[type];

/** Rupees for a notification line: ₹18,907.90 for paise, ₹18,908 for whole amounts, never ₹18,907.9. */
export function inr(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  const safe = Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  const whole = Number.isInteger(safe);
  return `₹${safe.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
export type DeliveryChannel = 'in_app' | 'push' | 'whatsapp' | 'sms' | 'email';
export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'not_configured' | 'skipped';

export interface NotificationCta {
  label: string;
  /** Admin/app page key to open, e.g. "booking-detail", "penalties". */
  page: string;
  bookingId?: string;
}

/** The customer site a notification belongs to; "all" reaches every site. Anything else names no brand. */
export type BrandKey = 'nesam' | 'onewaycarrentals' | 'people_taxi' | 'all' | '';

export function brandKey(raw: unknown): BrandKey {
  const v = typeof raw === 'string' ? raw.toLowerCase().trim() : '';
  if (v === 'all') return 'all';
  if (v.includes('people')) return 'people_taxi';
  if (v.includes('oneway') || v.includes('one_way') || v.includes('one-way')) return 'onewaycarrentals';
  if (v.includes('nesam')) return 'nesam';
  return '';
}

export interface NotifyInput {
  recipientType: RecipientType;
  /** Shared staff inbox is the literal 'admin'. */
  recipientId: string;
  category: NotificationCategory;
  severity?: NotificationSeverity;
  sound?: NotificationSound;
  title: string;
  message: string;
  bookingId?: string;
  bookingCode?: string;
  cta?: NotificationCta;
  /** Same key → at most one notification (alerts must not repeat every minute). */
  dedupeKey?: string;
  /** Interruptive (heads-up + sound) when true; quiet inbox entry otherwise. */
  push?: boolean;
  /** Who caused it, for the audit view. */
  sentBy?: string;
  /** Which customer site this is for (a rider's login works on all three), e.g. the booking's brand. */
  brand?: string;
  /** Extra fields stored on the in-app record (e.g. campaignId, requiresAck, imageUrl). */
  meta?: Record<string, string | boolean>;
}

const clip = (s: string, n: number) => String(s ?? '').slice(0, n);

export function notificationDocId(dedupeKey: string): string {
  return `dk_${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 40)}`;
}

/**
 * The input with its recipient made exact, or null when it cannot be delivered to anyone: an unknown audience, or a
 * rider / partner record without an id (e.g. a booking the office entered for a walk-in customer). Such an event is
 * skipped rather than stored under an id no app can ever read.
 */
function addressed(n: NotifyInput): NotifyInput | null {
  if (!Object.prototype.hasOwnProperty.call(INBOX_COLLECTION, n.recipientType)) {
    console.warn('notification skipped: unknown recipient type', n.recipientType, n.title);
    return null;
  }
  if (n.recipientType === 'admin') return n.recipientId === 'admin' ? n : { ...n, recipientId: 'admin' };
  const id = typeof n.recipientId === 'string' ? n.recipientId.trim() : '';
  if (!id || id.length > 128 || id.includes('/')) {
    console.warn('notification skipped: no recipient id', n.recipientType, n.title);
    return null;
  }
  return id === n.recipientId ? n : { ...n, recipientId: id };
}

function record(n: NotifyInput) {
  return {
    // Extra fields first: they can add to a record but never replace who it is for or what it says.
    ...(n.meta ?? {}),
    recipientId: n.recipientId,
    recipientType: n.recipientType,
    brand: brandKey(n.brand),
    category: n.category,
    type: n.category,
    severity: n.severity ?? 'info',
    sound: n.sound ?? 'general',
    title: clip(n.title, 140),
    message: clip(n.message, 500),
    bookingId: n.bookingId ?? '',
    bookingCode: n.bookingCode ?? '',
    cta: n.cta ?? null,
    actionUrl: n.cta?.page ?? '',
    channel: 'In-App',
    priority: n.severity === 'critical' ? 'urgent' : n.severity === 'warning' ? 'high' : 'normal',
    push: n.push !== false,
    dedupeKey: n.dedupeKey ?? '',
    read: false,
    sentBy: n.sentBy ?? 'system',
    createdAt: FieldValue.serverTimestamp(),
  };
}

/**
 * Stores the in-app record inside a transaction (so it exists iff the change
 * does). Call it after the transaction's reads. It cannot de-duplicate (that
 * needs a read); alerts that must not repeat use `notify` with a dedupeKey.
 * Push delivery is attempted after commit with `pushAfterCommit`.
 * Returns '' (and stores nothing) when the notification has no deliverable recipient.
 */
export function notifyInTx(tx: Transaction, input: NotifyInput): string {
  if (input.dedupeKey) throw new Error('notifyInTx cannot de-duplicate; use notify().');
  const n = addressed(input);
  if (!n) return '';
  const ref = db.collection(inboxOf(n.recipientType)).doc();
  tx.set(ref, record(n));
  tx.set(db.collection('notification_deliveries').doc(), deliveryRow(ref.id, n, 'in_app', 'sent'));
  return ref.id;
}

/** Push for notifications stored with notifyInTx, once the transaction has committed. */
export async function pushAfterCommit(items: { id: string; input: NotifyInput }[]): Promise<void> {
  await Promise.all(items.filter((i) => i.id && i.input.push !== false).map((i) => {
    const n = addressed(i.input);
    return n ? deliverPush(i.id, n).catch((err) => console.warn('push failed', err)) : undefined;
  }));
}

/** Outside a transaction. Returns the id, or null when a duplicate was skipped or there is no deliverable recipient. */
export async function notify(input: NotifyInput, store: Firestore = db): Promise<string | null> {
  const n = addressed(input);
  if (!n) return null;
  const inbox = store.collection(inboxOf(n.recipientType));
  let id: string;
  if (n.dedupeKey) {
    id = notificationDocId(n.dedupeKey);
    try {
      await inbox.doc(id).create(record(n));
    } catch (err) {
      if ((err as { code?: number }).code === 6) return null; // ALREADY_EXISTS
      throw err;
    }
  } else {
    id = (await inbox.add(record(n))).id;
  }
  await store.collection('notification_deliveries').add(deliveryRow(id, n, 'in_app', 'sent'));
  if (n.push !== false) await deliverPush(id, n).catch((err) => console.warn('push failed', err));
  return id;
}

/** Shared staff inbox. */
export const notifyAdmins = (n: Omit<NotifyInput, 'recipientType' | 'recipientId'>) =>
  notify({ ...n, recipientType: 'admin', recipientId: 'admin' });

export function deliveryRow(notificationId: string, n: Pick<NotifyInput, 'recipientId' | 'recipientType' | 'category' | 'title' | 'message' | 'bookingId' | 'meta'>, channel: DeliveryChannel, status: DeliveryStatus, extra: Record<string, unknown> = {}) {
  return {
    notificationId,
    recipientId: n.recipientId,
    recipientType: n.recipientType,
    // The inbox the in-app record lives in ('' for a type with none, e.g. an OTP message).
    inbox: INBOX_COLLECTION[n.recipientType as RecipientType] ?? '',
    category: n.category,
    title: clip(n.title, 140),
    message: clip(n.message, 300),
    bookingId: n.bookingId ?? '',
    channel,
    status,
    provider: '',
    providerMessageId: '',
    error: '',
    sentAt: FieldValue.serverTimestamp(),
    ...(typeof n.meta?.campaignId === 'string' ? { campaignId: n.meta.campaignId } : {}),
    ...extra,
  };
}

// ── Push (FCM) ────────────────────────────────────────────────────────────

/** Android notification channel ids the apps register; each has its own tone. */
export const ANDROID_CHANNEL: Record<NotificationSound, string> = {
  new_booking: 'nesam_new_booking',
  approval: 'nesam_approval',
  general: 'nesam_general',
};

/**
 * The devices a push for this recipient may go to: the ones the recipient registered from THIS audience's app
 * (device_tokens.role). A rider who is also a driver gets rider pushes on the rider app only and duty pushes on the
 * driver app only. Each token once, even if it was registered twice.
 */
export function pushTargets(recipientType: RecipientType, docs: { id: string; data: () => Record<string, unknown> }[]): { id: string; token: string }[] {
  const seen = new Set<string>();
  const out: { id: string; token: string }[] = [];
  for (const d of docs) {
    const x = d.data();
    const token = typeof x.token === 'string' ? x.token : '';
    if (!token || x.role !== recipientType || seen.has(token)) continue;
    seen.add(token);
    out.push({ id: d.id, token });
  }
  return out;
}

/**
 * Sends the push for a stored notification to every device the recipient
 * registered from this audience's app (`device_tokens`, written by the apps).
 * Dead tokens are removed. Without registered tokens this is a no-op recorded
 * as `skipped`. The shared office inbox has no devices.
 */
export async function deliverPush(notificationId: string, n: NotifyInput): Promise<void> {
  if (n.recipientType === 'admin') return;
  if(!await (await import('./channelPolicy')).channelEnabled('push')) {
    await db.collection('notification_deliveries').add(deliveryRow(notificationId,n,'push','skipped',{error:'Push delivery is disabled in Settings.'}));
    return;
  }
  const snap = await db.collection('device_tokens').where('ownerId', '==', n.recipientId).limit(50).get();
  const targets = pushTargets(n.recipientType, snap.docs).slice(0, 20);
  if (!targets.length) {
    await db.collection('notification_deliveries').add(deliveryRow(notificationId, n, 'push', 'skipped', { error: `No registered ${n.recipientType} app device.` }));
    return;
  }
  const sound = n.sound ?? 'general';
  const res = await getMessaging().sendEachForMulticast({
    tokens: targets.map((t) => t.token),
    notification: { title: clip(n.title, 100), body: clip(n.message, 200) },
    // `audience` lets an app ignore a tap on anything that is not its own.
    data: { notificationId, audience: n.recipientType, category: n.category, severity: n.severity ?? 'info', bookingId: n.bookingId ?? '', page: n.cta?.page ?? '' },
    android: {
      priority: n.severity === 'critical' || n.severity === 'warning' || sound === 'new_booking' ? 'high' : 'normal',
      notification: { channelId: ANDROID_CHANNEL[sound], sound: `${sound}.wav` },
    },
    apns: { payload: { aps: { sound: `${sound}.wav` } } },
  });
  const stale: string[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code ?? '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') stale.push(targets[i].id);
  });
  await Promise.all(stale.map((id) => db.doc(`device_tokens/${id}`).delete()));
  await db.collection('notification_deliveries').add(deliveryRow(notificationId, n, 'push', res.successCount > 0 ? 'sent' : 'failed', {
    provider: 'fcm', error: res.successCount > 0 ? '' : 'Push delivery failed on every device.',
  }));
}
