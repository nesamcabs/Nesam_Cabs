import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, writeBatch, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callFunction } from './callables';
import { formatDateTime12, toDate } from '../utils/time';
import { categoryOf, ctaOf, severityOf, soundOf } from '../utils/notificationModel';
import type { PartnerNotification, PartnerPenalty, PenaltyStatus } from '../types/notifications';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const amount = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(str(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * The vendor inbox. One login can be a rider, a driver and a vendor at once; riders, drivers and the office each have
 * their own collection (functions/src/notify.ts), so only vendor notifications can ever appear in this app.
 */
export const VENDOR_INBOX = 'vendor_notifications';
/** The newest notifications kept in the inbox. */
const INBOX_LIMIT = 200;

/**
 * Live newest-first listener on the inbox. While the (recipientId, createdAt) index is still building after a deploy the
 * ordered query is refused; the plain equality query is used then, so the inbox never goes blank.
 */
function listenToInbox(recipientId: string, onDocs: (docs: QueryDocumentSnapshot<DocumentData>[]) => void, onError: () => void): () => void {
  const inbox = collection(db, VENDOR_INBOX);
  let stop = onSnapshot(
    query(inbox, where('recipientId', '==', recipientId), orderBy('createdAt', 'desc'), limit(INBOX_LIMIT)),
    (snap) => onDocs(snap.docs),
    (err) => {
      if ((err as { code?: string }).code !== 'failed-precondition') return onError();
      stop = onSnapshot(query(inbox, where('recipientId', '==', recipientId), limit(INBOX_LIMIT)), (snap) => onDocs(snap.docs), onError);
    },
  );
  return () => stop();
}

/** This vendor's own notifications (rules allow reading only those addressed to them), newest first. */
export function subscribeToNotifications(recipientId: string, callback: (n: PartnerNotification[]) => void) {
  if (!recipientId) {
    callback([]);
    return () => undefined;
  }
  return listenToInbox(
    recipientId,
    (docs) => {
      // The collection is the vendor inbox; the type check only guards against a record filed in the wrong place.
      const rows = docs.filter((d) => (str(d.data().recipientType) || 'vendor') === 'vendor').map((d): PartnerNotification => {
        const data = d.data();
        const created = toDate(data.createdAt);
        const base = { type: str(data.type), category: str(data.category), severity: str(data.severity), priority: str(data.priority), sound: str(data.sound), cta: data.cta, bookingId: str(data.bookingId) };
        return {
          id: d.id,
          title: str(data.title) || 'Notification',
          message: str(data.message || data.desc || data.body),
          time: created ? formatDateTime12(created) : '',
          read: Boolean(data.read),
          createdAtMs: created?.getTime() ?? 0,
          category: categoryOf(base),
          severity: severityOf(base),
          sound: soundOf(base),
          bookingId: str(data.bookingId),
          bookingCode: str(data.bookingCode),
          ...ctaOf(base),
          popup: data.push !== false,
        };
      });
      rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
      callback(rows);
    },
    () => callback([]),
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, VENDOR_INBOX, id), { read: true, readAt: serverTimestamp() });
}

/** Marks several notifications read in as few writes as possible (a batch holds at most 500). */
export async function markNotificationsRead(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 450) {
    const batch = writeBatch(db);
    for (const id of unique.slice(i, i + 450)) batch.update(doc(db, VENDOR_INBOX, id), { read: true, readAt: serverTimestamp() });
    await batch.commit();
  }
}

const STATUSES: PenaltyStatus[] = ['Pending', 'Acknowledged', 'Paid', 'Deducted', 'Waived', 'Disputed'];
const LEGACY: Record<string, PenaltyStatus> = { Applied: 'Pending', Recovered: 'Paid', Reversed: 'Waived' };

/** Penalties issued to this partner (read-only here; acknowledging and disputing are server functions). */
export function subscribeToPenalties(field: 'driverId' | 'vendorId', partnerId: string, callback: (p: PartnerPenalty[]) => void) {
  return onSnapshot(
    query(collection(db, 'penalties'), where(field, '==', partnerId)),
    (snap) => {
      const rows = snap.docs.map((d): PartnerPenalty => {
        const data = d.data();
        const raw = str(data.status);
        return {
          id: d.id,
          amount: amount(data.amount),
          category: str(data.category) || 'Other',
          reason: str(data.reason),
          description: str(data.description || data.notes),
          bookingCode: str(data.bookingCode),
          bookingId: str(data.bookingDocumentId),
          incidentDate: str(data.incidentDate),
          status: STATUSES.includes(raw as PenaltyStatus) ? (raw as PenaltyStatus) : (LEGACY[raw] ?? 'Pending'),
          acknowledged: data.acknowledged === true,
          acknowledgedAt: toDate(data.acknowledgedAt),
          disputeNote: str(data.disputeNote),
          issuedAt: toDate(data.issuedAt) ?? toDate(data.createdAt),
          issuedByName: str(data.issuedByName),
        };
      });
      rows.sort((a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0));
      callback(rows);
    },
    () => callback([]),
  );
}

export const acknowledgePenalty = (penaltyId: string) => callFunction<unknown, { ok: boolean }>('acknowledgePenalty', { penaltyId, confirmed: true });
export const disputePenalty = (penaltyId: string, note: string) => callFunction<unknown, { ok: boolean }>('disputePenalty', { penaltyId, note });
