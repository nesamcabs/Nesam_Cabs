import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { callFunction } from './callables';
import { formatDateTime12 } from '../utils/time';
import { categoryOf, ctaOf, severityOf, soundOf } from '../utils/notificationModel';
import type { PartnerNotification, PartnerPenalty, PenaltyStatus } from '../notificationTypes';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const amount = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(str(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** This vendor's own notifications (rules allow reading only those addressed to the vendor). */
export function subscribeToVendorNotifications(vendorId: string, callback: (n: PartnerNotification[]) => void) {
  return onSnapshot(
    query(collection(db, 'notifications'), where('recipientId', '==', vendorId)),
    (snap) => {
      const rows = snap.docs.map((d): PartnerNotification => {
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
    (err) => {
      console.warn('Notifications subscription error:', err);
      callback([]);
    },
  );
}

export const markNotificationRead = (id: string) => updateDoc(doc(db, 'notifications', id), { read: true, readAt: serverTimestamp() });

const STATUSES: PenaltyStatus[] = ['Pending', 'Acknowledged', 'Paid', 'Deducted', 'Waived', 'Disputed'];
const LEGACY: Record<string, PenaltyStatus> = { Applied: 'Pending', Recovered: 'Paid', Reversed: 'Waived' };

/** Penalties issued to this vendor. Acknowledging and disputing are server functions. */
export function subscribeToVendorPenalties(vendorId: string, callback: (p: PartnerPenalty[]) => void, onError: (message: string) => void) {
  return onSnapshot(
    query(collection(db, 'penalties'), where('vendorId', '==', vendorId)),
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
          status: STATUSES.includes(raw as PenaltyStatus) ? (raw as PenaltyStatus) : LEGACY[raw] ?? 'Pending',
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
    () => onError('Could not load your penalties.'),
  );
}

export const acknowledgePenalty = (penaltyId: string) => callFunction<unknown, { ok: boolean }>('acknowledgePenalty', { penaltyId, confirmed: true });
export const disputePenalty = (penaltyId: string, note: string) => callFunction<unknown, { ok: boolean }>('disputePenalty', { penaltyId, note });
