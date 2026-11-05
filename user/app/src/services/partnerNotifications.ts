import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callFunction } from './callables';
import { formatDateTime12, toDate } from '../utils/time';
import { categoryOf, ctaOf, severityOf, soundOf } from '../utils/notificationModel';
import type { PartnerNotification, PartnerPenalty, PenaltyStatus } from '../types/notifications';
import { normalizeBrand, visibleOnSite, type SiteBrand } from '../utils/brandScope';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));
const amount = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(str(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** The brand a booking was made on, read once per booking (older notifications carry only the booking). */
const bookingBrands = new Map<string, Promise<ReturnType<typeof normalizeBrand>>>();
function brandOfBooking(bookingId: string) {
  let known = bookingBrands.get(bookingId);
  if (!known) {
    known = getDoc(doc(db, 'bookings', bookingId))
      .then((s) => {
        const d = s.data();
        return normalizeBrand(d?.brand || d?.bookingSource || d?.source);
      })
      .catch(() => '' as const);
    bookingBrands.set(bookingId, known);
  }
  return known;
}

export type NotificationRole = 'customer' | 'driver' | 'vendor';

/**
 * This user's own notifications (rules allow reading only those addressed to them).
 * - `role`: one login can be a rider, a driver and a vendor at once; only notifications for that role
 *   are returned (a vendor's "Account suspended" must not appear in the rider's inbox). Older ones that
 *   record no role are treated as rider notifications.
 * - `site`: only that site's notifications (and those sent to every site): the same rider account works
 *   on NESAM Cabs, One Way Car Rentals and People Taxi, and each should show only its own.
 */
export function subscribeToNotifications(recipientId: string, callback: (n: PartnerNotification[]) => void, scope: { role?: NotificationRole; site?: SiteBrand } = {}) {
  const { role, site } = scope;
  let latest = 0;
  return onSnapshot(
    query(collection(db, 'notifications'), where('recipientId', '==', recipientId)),
    (snap) => {
      const forRole = (data: Record<string, unknown>) => !role || !str(data.recipientType) || str(data.recipientType) === role;
      const rows = snap.docs.filter((d) => forRole(d.data())).map((d): PartnerNotification => {
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
          brand: normalizeBrand(data.brand),
          ...ctaOf(base),
          popup: data.push !== false,
        };
      });
      rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
      if (!site) return callback(rows);

      // Notifications that name no brand but belong to a booking take that booking's brand.
      const run = ++latest;
      void Promise.all(
        rows.map(async (n) => (n.brand || !n.bookingId ? n : { ...n, brand: await brandOfBooking(n.bookingId) })),
      ).then((resolved) => {
        if (run === latest) callback(resolved.filter((n) => visibleOnSite(site, normalizeBrand(n.brand))));
      });
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
