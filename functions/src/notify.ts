// Server-side notifications. Every event is stored once as an in-app record
// (`notifications`) with a category, severity and sound key the apps use to
// pick a tab, a colour and a tone, and each delivery attempt on any channel is
// logged in `notification_deliveries` (recipient, channel, status, booking).
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

const clip = (s: string, n: number) => s.slice(0, n);

export function notificationDocId(dedupeKey: string): string {
  return `dk_${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 40)}`;
}

function record(n: NotifyInput) {
  return {
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
    ...(n.meta ?? {}),
  };
}

/**
 * Stores the in-app record inside a transaction (so it exists iff the change
 * does). Call it after the transaction's reads. It cannot de-duplicate (that
 * needs a read); alerts that must not repeat use `notify` with a dedupeKey.
 * Push delivery is attempted after commit with `pushAfterCommit`.
 */
export function notifyInTx(tx: Transaction, n: NotifyInput): string {
  if (n.dedupeKey) throw new Error('notifyInTx cannot de-duplicate; use notify().');
  const ref = db.collection('notifications').doc();
  tx.set(ref, record(n));
  tx.set(db.collection('notification_deliveries').doc(), deliveryRow(ref.id, n, 'in_app', 'sent'));
  return ref.id;
}

/** Push for notifications stored with notifyInTx, once the transaction has committed. */
export async function pushAfterCommit(items: { id: string; input: NotifyInput }[]): Promise<void> {
  await Promise.all(items.filter((i) => i.input.push !== false).map((i) => deliverPush(i.id, i.input).catch((err) => console.warn('push failed', err))));
}

/** Outside a transaction. Returns the id, or null when a duplicate was skipped. */
export async function notify(n: NotifyInput, store: Firestore = db): Promise<string | null> {
  let id: string;
  if (n.dedupeKey) {
    id = notificationDocId(n.dedupeKey);
    try {
      await store.doc(`notifications/${id}`).create(record(n));
    } catch (err) {
      if ((err as { code?: number }).code === 6) return null; // ALREADY_EXISTS
      throw err;
    }
  } else {
    id = (await store.collection('notifications').add(record(n))).id;
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
 * Sends the push for a stored notification to every registered device of the
 * recipient (`device_tokens`, written by the apps). Dead tokens are removed.
 * Without registered tokens this is a no-op recorded as `skipped`.
 */
export async function deliverPush(notificationId: string, n: NotifyInput): Promise<void> {
  if(!await (await import('./channelPolicy')).channelEnabled('push')) {
    await db.collection('notification_deliveries').add(deliveryRow(notificationId,n,'push','skipped',{error:'Push delivery is disabled in Settings.'}));
    return;
  }
  const tokens = await db.collection('device_tokens').where('ownerId', '==', n.recipientId).limit(20).get();
  if (tokens.empty) {
    await db.collection('notification_deliveries').add(deliveryRow(notificationId, n, 'push', 'skipped', { error: 'No registered device.' }));
    return;
  }
  const sound = n.sound ?? 'general';
  const res = await getMessaging().sendEachForMulticast({
    tokens: tokens.docs.map((d) => d.data().token as string),
    notification: { title: clip(n.title, 100), body: clip(n.message, 200) },
    data: { notificationId, category: n.category, severity: n.severity ?? 'info', bookingId: n.bookingId ?? '', page: n.cta?.page ?? '' },
    android: {
      priority: n.severity === 'critical' || n.severity === 'warning' || sound === 'new_booking' ? 'high' : 'normal',
      notification: { channelId: ANDROID_CHANNEL[sound], sound: `${sound}.wav` },
    },
    apns: { payload: { aps: { sound: `${sound}.wav` } } },
  });
  const stale: string[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code ?? '';
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') stale.push(tokens.docs[i].id);
  });
  await Promise.all(stale.map((id) => db.doc(`device_tokens/${id}`).delete()));
  await db.collection('notification_deliveries').add(deliveryRow(notificationId, n, 'push', res.successCount > 0 ? 'sent' : 'failed', {
    provider: 'fcm', error: res.successCount > 0 ? '' : 'Push delivery failed on every device.',
  }));
}
