// Staff decision notices. When staff approve, reject or suspend a driver or vendor in the console, the admin app files a
// request in `partner_notice_requests` (firestore.rules: active staff only, sentBy = the writer). This trigger turns it
// into an ordinary notification with notify() — stored in that partner's own inbox, pushed to that partner's app and
// logged — so every inbox record, without exception, is written by the server. The request is marked Delivered (or
// Skipped) with the notification id; a retried event never notifies twice (dedupe on the request id).
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { notify, type NotificationCategory, type NotificationSeverity, type NotifyInput } from './notify';

export const PARTNER_NOTICE_REQUESTS = 'partner_notice_requests';

const CATEGORIES: NotificationCategory[] = ['approvals', 'general'];
const SEVERITIES: NotificationSeverity[] = ['info', 'success', 'warning', 'critical'];
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** The notification a staff request describes, or null when it is not a valid one. */
export function noticeFromRequest(requestId: string, data: Record<string, unknown> | undefined): NotifyInput | null {
  if (!data) return null;
  const audience = data.audience === 'driver' || data.audience === 'vendor' ? data.audience : null;
  const recipientId = str(data.recipientId, 128);
  const title = str(data.title, 140);
  if (!audience || !recipientId || !title) return null;
  const pick = <T extends string>(v: unknown, allowed: T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
  return {
    recipientType: audience,
    recipientId,
    category: pick(data.category, CATEGORIES, 'approvals'),
    severity: pick(data.severity, SEVERITIES, 'info'),
    sound: 'approval',
    title,
    message: str(data.message, 500),
    push: true,
    sentBy: str(data.sentBy, 128) || 'staff',
    dedupeKey: `partner_notice_${requestId}`,
    meta: { requestId },
  };
}

export const onPartnerNoticeRequested = onDocumentCreated(`${PARTNER_NOTICE_REQUESTS}/{requestId}`, async (event) => {
  const requestId = event.params.requestId;
  const n = noticeFromRequest(requestId, event.data?.data());
  const ref = db.doc(`${PARTNER_NOTICE_REQUESTS}/${requestId}`);
  if (!n) {
    await ref.set({ status: 'Skipped', error: 'Not a valid partner notice.', processedAt: FieldValue.serverTimestamp() }, { merge: true });
    return;
  }
  // null = already delivered by an earlier attempt of this same event.
  const notificationId = await notify(n);
  await ref.set({ status: 'Delivered', ...(notificationId ? { notificationId } : {}), processedAt: FieldValue.serverTimestamp() }, { merge: true });
});
