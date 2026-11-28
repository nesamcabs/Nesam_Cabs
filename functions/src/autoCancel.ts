// Cancels bookings nobody accepted once their pickup time is 30 minutes old (rules: domain/autoCancel.ts), with the reason
// recorded on the booking, and tells the office about accepted trips that did not start (never cancelled here). Runs with the
// periodic jobs, and whenever the open admin panel asks (runBookingAutoCancel), so it does not depend on the cron alone.
// Safe to run any number of times: each booking is re-checked and changed inside one transaction.
import { onCall } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { txnsRef } from './bookingPayments';
import { sendCustomerMessage } from './customerComms';
import {
  AUTO_CANCEL_AFTER_MINUTES, AUTO_CANCEL_CUSTOMER_REASON, AUTO_CANCEL_LOOKBACK_HOURS, AUTO_CANCEL_REASON, AutoCancelKind, acceptedNotStarted, autoCancelKindOf,
} from './domain/autoCancel';
import { summarizePayments, tripSubStatusOf } from './domain/bookingFlow';
import { formatDateTime12, pickupInstant } from './domain/time';
import { money } from './marketplace';
import { notify, notifyInTx, pushAfterCommit, NotifyInput, inr } from './notify';
import { reconcileBooking } from './reconcile';
import { requirePermission, text } from './shared';

const PAGE = 200;
const code = (b: DocumentData, id: string) => text(b.bookingId) || id;

/** Cancels one booking if it is still due. Returns what was done, or null when it was left alone. */
async function cancelIfDue(bookingId: string, nowMs: number): Promise<{ kind: AutoCancelKind; booking: DocumentData; paid: number } | null> {
  const ref = db.doc(`bookings/${bookingId}`);
  const market = db.doc(`marketplace_trips/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    // Read inside the transaction: an approval or an accept that lands first wins.
    const [snap, m, bids, all] = await Promise.all([tx.get(ref), tx.get(market), tx.get(market.collection('bids')), tx.get(txnsRef(bookingId))]);
    const b = snap.data();
    if (!snap.exists || !b) return null;
    const waiting = bids.docs.filter((d) => d.data().status === 'Pending Review');
    const kind = autoCancelKindOf(b, m.exists ? m.data() : null, waiting.length, nowMs);
    if (!kind) return null;
    const paid = summarizePayments(money(b.fare), all.docs.map((d) => ({ amount: d.data().amount, method: d.data().method, status: d.data().status, kind: d.data().kind, collectorType: d.data().collectorType }))).totalPaid;
    const reason = AUTO_CANCEL_REASON[kind];
    const stamp = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: 'Cancelled', cancelledAt: stamp, cancelReason: AUTO_CANCEL_CUSTOMER_REASON, cancelledBy: 'system', cancellationFee: 0,
      cancellation: { cancelledBy: { type: 'system', id: '', name: 'Auto-cancel' }, reason, charge: 0, at: stamp, amountPaid: paid, auto: kind },
      // The customer is never at fault here: anything paid is due back in full.
      refund: paid > 0 ? { status: 'Pending', eligible: true, amount: paid, method: '', reference: '', requestedAt: stamp, history: [] } : { status: 'Not Applicable', eligible: false, amount: 0, history: [] },
      updatedAt: stamp,
    });
    if (m.exists) tx.update(market, { status: 'Closed', closedReason: 'auto_cancel', closedAt: stamp, updatedAt: stamp });
    for (const bid of waiting) tx.update(bid.ref, { status: 'Rejected', reviewedAt: stamp });
    tx.create(ref.collection('events').doc(), { type: 'auto_cancelled', actorId: 'system', actorRole: 'system', kind, reason, at: stamp });
    auditInTx(tx, { action: 'booking_auto_cancelled', entity: 'booking', entityId: bookingId, performedBy: 'system', performedByName: 'Auto-cancel', role: 'system', bookingId, previous: { status: b.status }, next: { status: 'Cancelled', kind, refund: paid }, reason });
    if (b.customerId) {
      const label = code(b, bookingId);
      const n: NotifyInput = {
        recipientType: 'customer', brand: b.brand, recipientId: b.customerId, category: 'bookings', severity: 'warning', sound: 'general', event: 'cancelled', title: 'Booking cancelled',
        message: `Booking ${label} was cancelled. ${AUTO_CANCEL_CUSTOMER_REASON}${paid > 0 ? ` Your payment of ${inr(paid)} is due to be refunded.` : ''}`, bookingId, bookingCode: label, push: true,
      };
      pushes.push({ id: notifyInTx(tx, n), input: n });
    }
    return { kind, booking: b, paid };
  });
  if (!out) return null;
  await pushAfterCommit(pushes);
  const label = code(out.booking, bookingId);
  await notify({
    recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: out.paid > 0 ? 'critical' : 'warning', sound: 'general', push: true,
    title: out.paid > 0 ? 'Booking auto-cancelled · refund to review' : 'Booking auto-cancelled',
    message: `${label} · ${text(out.booking.pickup)} · pickup ${formatDateTime12(pickupInstant(out.booking)!)}. ${AUTO_CANCEL_REASON[out.kind]}`,
    bookingId, bookingCode: label, cta: { label: 'Open booking', page: 'booking-detail', bookingId }, dedupeKey: `auto_cancel_${bookingId}`,
  }).catch((err) => console.warn('auto-cancel admin notice failed', err));
  await sendCustomerMessage(bookingId, out.booking, 'booking_cancelled', { reason: AUTO_CANCEL_CUSTOMER_REASON }).catch((err) => console.warn('customer message failed', err));
  await reconcileBooking(bookingId).catch((err) => console.warn('auto-cancel reconcile failed', err));
  return out;
}

/** Asks the office to check an accepted trip that has not started (once per booking). */
async function alertNotStarted(bookingId: string, b: DocumentData): Promise<boolean> {
  const label = code(b, bookingId);
  const who = text(b.assignedDriverName || b.assignedVendorName) || 'The partner';
  const record = tripSubStatusOf(b) === 'Reached Pickup' ? `${who} marked Reached pickup, but the trip has not started` : `${who} has not marked Reached pickup`;
  const id = await notify({
    recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'critical', sound: 'general', push: true,
    title: 'Accepted trip not started · check and decide',
    message: `${label} · pickup ${formatDateTime12(pickupInstant(b)!)}. ${record}. Call the customer and the driver; if the trip will not run, cancel it from the booking.`,
    bookingId, bookingCode: label, cta: { label: 'Open booking', page: 'booking-detail', bookingId }, dedupeKey: `not_started_${bookingId}`,
  }).catch((err) => { console.warn('not-started notice failed', err); return null; });
  return !!id;
}

export async function runAutoCancel(nowMs = Date.now()): Promise<{ checked: number; cancelled: number; notStartedAlerts: number }> {
  const upTo = Timestamp.fromMillis(nowMs - AUTO_CANCEL_AFTER_MINUTES * 60000);
  const from = Timestamp.fromMillis(upTo.toMillis() - AUTO_CANCEL_LOOKBACK_HOURS * 3600000);
  const due = (statuses: string[]) => db.collection('bookings').where('status', 'in', statuses).where('pickupAt', '>=', from).where('pickupAt', '<=', upTo).limit(PAGE).get();
  const [open, accepted] = await Promise.all([due(['Pending', 'Approved']), due(['Confirmed', 'Assigned'])]);
  let cancelled = 0, notStartedAlerts = 0;
  for (const d of open.docs) {
    try {
      if (await cancelIfDue(d.id, nowMs)) cancelled++;
    } catch (err) {
      console.error('auto-cancel failed', d.id, err);
    }
  }
  for (const d of accepted.docs) if (acceptedNotStarted(d.data(), nowMs) && (await alertNotStarted(d.id, d.data()))) notStartedAlerts++;
  return { checked: open.size + accepted.size, cancelled, notStartedAlerts };
}

/** Each warm server instance runs the check at most this often, however many admin tabs ask. */
const ASK_EVERY_MS = 30000;
let lastAsked = 0;

/** The open admin panel's request to run the check now. */
export const runBookingAutoCancel = onCall({ timeoutSeconds: 60 }, async (request) => {
  await requirePermission(request.auth, 'operations');
  if (Date.now() - lastAsked < ASK_EVERY_MS) return { ok: true, ran: false };
  lastAsked = Date.now();
  return { ok: true, ran: true, ...(await runAutoCancel()) };
});
