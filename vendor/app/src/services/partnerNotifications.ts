import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
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

/** This user's own notifications (rules allow reading only those addressed to them). */
/**
 * One login can be a rider, a driver and a vendor at once, so with `role` only the notifications for
 * that role are returned (older ones that record no role are kept).
 */
export function subscribeToNotifications(recipientId: string, callback: (n: PartnerNotification[]) => void, role?: 'customer' | 'driver' | 'vendor') {
  return onSnapshot(
    query(collection(db, 'notifications'), where('recipientId', '==', recipientId)),
    (snap) => {
      const rows = snap.docs.filter((d) => !role || !str(d.data().recipientType) || str(d.data().recipientType) === role).map((d): PartnerNotification => {
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
  await updateDoc(doc(db, 'notifications', id), { read: true, readAt: serverTimestamp() });
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
