// Re-derives money / ledger state for a booking or payout request.
//
// On Firebase this work is done by Firestore triggers (onBookingCancelled,
// onBookingMoneyChange, onBookingFinanceChange, onPayoutRequestWritten). A host
// without Firestore triggers (Vercel) runs the same idempotent steps instead:
//   • right after a callable that changes a booking / payout request,
//   • from the apps after the few direct writes the security rules still allow
//     (customer cancel, toll receipts, marketplace claim / dispatch) via the
//     `reconcile` callable below,
//   • from a periodic sweep (api/cron/reconcile) as a safety net.
// Every step reads the stored document and derives its result, so running them
// more than once — or for a booking that did not change — is harmless.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { reconcileCancelledBooking } from './bookingOps';
import { reconcileBookingMoney } from './bookingPayments';
import { syncBookingFinance, syncPayoutLedger, recomputeWallet } from './ledger';
import { syncRating } from './ratings';
import { syncSettlementDue } from './settlement';
import { requireAdmin } from './shared';

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Runs every booking-level reconcile step in dependency order. */
export async function reconcileBooking(bookingId: string): Promise<void> {
  await reconcileCancelledBooking(bookingId);
  await reconcileBookingMoney(bookingId);
  const actor = await syncBookingFinance(bookingId);
  if (actor) await recomputeWallet(actor.type, actor.id);
  await syncSettlementDue(bookingId);
  await syncRating(bookingId);
}

export async function reconcilePayout(requestId: string): Promise<void> {
  await syncPayoutLedger(requestId);
}

/** Bookings written in the last `minutes` (all clients stamp updatedAt when they write a booking). */
export async function sweepRecentBookings(minutes = 30, limit = 300): Promise<{ checked: number; failed: number }> {
  const since = Timestamp.fromMillis(Date.now() - minutes * 60000);
  const snap = await db.collection('bookings').where('updatedAt', '>=', since).limit(limit).get();
  let failed = 0;
  for (const d of snap.docs) {
    try {
      await reconcileBooking(d.id);
    } catch (err) {
      failed++;
      console.warn('reconcile failed', d.id, err);
    }
  }
  return { checked: snap.size, failed };
}

/**
 * Callable: lets a signed-in party ask the server to settle a booking or payout request it
 * belongs to. It never takes amounts or states from the caller — it only re-runs the
 * server's own derivation — so it cannot be used to change a fare, a balance or a status.
 */
export const reconcile = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const input = (request.data ?? {}) as { bookingId?: unknown; payoutRequestId?: unknown };

  if (typeof input.payoutRequestId === 'string') {
    if (!ID.test(input.payoutRequestId)) throw new HttpsError('invalid-argument', 'Invalid payout request.');
    const p = (await db.doc(`payout_requests/${input.payoutRequestId}`).get()).data();
    if (!p) throw new HttpsError('not-found', 'Payout request not found.');
    if (p.driverId !== uid && p.vendorId !== uid) await requireAdmin(request.auth);
    await reconcilePayout(input.payoutRequestId);
    return { ok: true };
  }

  if (typeof input.bookingId !== 'string' || !ID.test(input.bookingId)) throw new HttpsError('invalid-argument', 'Invalid booking.');
  const b = (await db.doc(`bookings/${input.bookingId}`).get()).data();
  if (!b) throw new HttpsError('not-found', 'Booking not found.');
  const related = [b.customerId, b.assignedDriverId, b.assignedVendorId].includes(uid);
  if (!related) await requireAdmin(request.auth);
  await reconcileBooking(input.bookingId);
  return { ok: true };
});
