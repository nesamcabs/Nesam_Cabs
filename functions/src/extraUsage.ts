// Extra usage on a trip — waiting at each stop, hill travel, roof carrier — from recording to billing and settlement.
//
//   recordExtraUsage   the assigned driver or vendor, or office staff, states what happened (per stop, with an explicit "none"
//                      versus "not recorded"). Frontend values are inputs only; no amount is accepted from a client.
//   reviewExtraUsage   an authorised finance reviewer approves or rejects a SPECIFIC revision (a stale review is refused).
//                      Approval is the only moment money is computed and posted: the server prices the usage from the rates
//                      saved on THIS booking (the customer snapshot on the booking, the partner snapshot in
//                      booking_pricing_private), never from today's configuration.
//
// What approval posts, reusing the existing money paths instead of a parallel one:
//   • customer billing — `bookings.extraCharges` (customer amounts, public) is added to the amount due by amountDueFor, so the
//     payment summary, balance and outstanding amount follow it, and the fare breakup lines show the approved amounts;
//   • partner credit   — the private partner amount is credited by the ledger as one `extra_${bookingId}` entry (like a toll
//     credit) and counted in the partner's settlement entitlement, so it follows settlement → working wallet → payout.
// An approved record is final (`status: approved`), the ledger id is deterministic and the review checks the revision, so a
// repeated approval, completion or webhook cannot bill or credit twice. A correction after posting is refused: there is no
// partner reversal rule, and re-approving would credit the amount again.
//
// Posting is BLOCKED (with the reasons) until every business rule it needs exists: the free-waiting and rounding settings, the
// rounding scope, the tax treatment, and a saved rate for each extra that was used. Nothing is guessed.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { ExtraUsageError, computeExtraCharges, parseExtraUsage, type ExtraChargesSnapshot, type ExtraUsage } from './domain/extraCharges';
import { withApprovedExtraLines, type FareBreakup } from './domain/fareBreakup';
import { loadPrivatePricing, privatePricingRef, withPrivatePricing } from './pricingPrivate';
import type { AdminAccess } from './permissions';
import { requireAction, requireAdmin, requirePermission, text } from './shared';

const bad = (m: string, details?: unknown) => new HttpsError('invalid-argument', m, details);
const bookingIdOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw bad('Invalid booking.');
  return v;
};
const isPaid = (b: DocumentData) => b.payment === 'Paid' || b.paymentStatus === 'Paid';

/** Staff who may record on any booking: the same right that edits a booking. A non-admin simply gets null. */
async function staffOrNull(auth: Parameters<typeof requireAdmin>[0]): Promise<AdminAccess | null> {
  try {
    const admin = await requireAdmin(auth);
    requireAction(admin, 'Bookings', 'edit');
    return admin;
  } catch {
    return null;
  }
}

export const recordExtraUsage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const input = request.data ?? {};
  const bookingId = bookingIdOf(input.bookingId);
  let usage: ExtraUsage;
  try { usage = parseExtraUsage(input.usage); } catch (e) { if (e instanceof ExtraUsageError) throw bad(e.message); throw e; }
  if (typeof input.expectedRevision !== 'number' || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw bad('Reload the booking before saving.');
  const note = text(input.note, 300);
  const staff = await staffOrNull(request.auth);
  const ref = db.doc(`bookings/${bookingId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    let role: 'driver' | 'vendor' | 'admin';
    let name: string;
    if (b.assignedDriverId === uid) { role = 'driver'; name = text(b.assignedDriverName, 120); }
    else if (b.assignedVendorId === uid) { role = 'vendor'; name = text(b.assignedVendorName, 120); }
    else if (staff) { role = 'admin'; name = staff.name; }
    else throw new HttpsError('permission-denied', 'Only the assigned driver, the assigned vendor or office staff can record extra usage for this trip.');
    if (!['Ongoing', 'Completed'].includes(b.status)) throw new HttpsError('failed-precondition', 'Extra usage can be recorded once the trip has started.');
    const current = (b.extraUsage ?? {}) as { revision?: number; status?: string };
    const revision = typeof current.revision === 'number' ? current.revision : 0;
    if (current.status === 'approved') throw new HttpsError('failed-precondition', 'The extra charges for this trip are already approved and posted. They cannot be changed here.');
    if (input.expectedRevision !== revision) throw new HttpsError('failed-precondition', 'This trip’s extra usage was changed by someone else. Reload and review it before saving.');
    const stamp = FieldValue.serverTimestamp();
    const next = revision + 1;
    tx.update(ref, {
      extraUsage: { schema: 1, revision: next, status: 'submitted', usage, note, submittedBy: uid, submittedByName: name, submittedRole: role, submittedAt: stamp },
      updatedAt: stamp,
    });
    tx.create(ref.collection('events').doc(), { type: 'extra_usage_submitted', actorId: uid, actorRole: role, revision: next, at: stamp });
    auditInTx(tx, {
      action: 'extra_usage_submitted', entity: 'booking', entityId: bookingId, performedBy: uid, performedByName: name, role, bookingId,
      previous: { revision }, next: { revision: next, stops: usage.stops?.length ?? null, hill: usage.hill, carrier: usage.carrier },
    });
    return { revision: next };
  });
});

export const reviewExtraUsage = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'finance');
  requireAction(admin, 'Accounts', 'approve');
  requireAction(admin, 'Bookings', 'edit');
  const input = request.data ?? {};
  const bookingId = bookingIdOf(input.bookingId);
  if (typeof input.revision !== 'number' || !Number.isInteger(input.revision) || input.revision < 1) throw bad('Reload the booking before reviewing.');
  if (input.decision !== 'approve' && input.decision !== 'reject') throw bad('Choose approve or reject.');
  const note = text(input.note, 300);
  if (input.decision === 'reject' && note.length < 5) throw bad('Give a short reason for rejecting.');
  const ref = db.doc(`bookings/${bookingId}`);

  return db.runTransaction(async (tx) => {
    const [snap, privateRaw] = await Promise.all([tx.get(ref), loadPrivatePricing(tx, bookingId)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    const u = b.extraUsage as { revision?: number; status?: string; usage?: ExtraUsage } | undefined;
    if (!u || typeof u.revision !== 'number') throw new HttpsError('failed-precondition', 'No extra usage has been recorded for this trip.');
    if (u.status === 'approved') throw new HttpsError('failed-precondition', 'These extra charges are already approved and posted.');
    if (u.status !== 'submitted') throw new HttpsError('failed-precondition', 'This usage is not waiting for review.');
    if (u.revision !== input.revision) throw new HttpsError('failed-precondition', 'The usage was changed after you opened it. Reload and review the latest version.');
    const stamp = FieldValue.serverTimestamp();

    if (input.decision === 'reject') {
      tx.update(ref, { 'extraUsage.status': 'rejected', 'extraUsage.reviewNote': note, 'extraUsage.reviewedBy': admin.uid, 'extraUsage.reviewedByName': admin.name, 'extraUsage.reviewedAt': stamp, updatedAt: stamp });
      tx.create(ref.collection('events').doc(), { type: 'extra_usage_rejected', actorId: admin.uid, actorRole: 'admin', revision: u.revision, reason: note, at: stamp });
      auditInTx(tx, { action: 'extra_usage_rejected', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, reason: note, next: { revision: u.revision } });
      return { status: 'rejected' as const, revision: u.revision };
    }

    // ── Approval: the only place money is computed and posted ──
    if (b.status !== 'Completed') throw new HttpsError('failed-precondition', 'Extra charges are approved once the trip is completed.');
    if (['Cancelled', 'Rejected'].includes(b.status)) throw new HttpsError('failed-precondition', 'This booking is cancelled.');
    if (isPaid(b)) throw new HttpsError('failed-precondition', 'This booking is already paid. Refund or adjust the payment instead of adding charges to it.');
    if (!b.assignedVendorId && !b.assignedDriverId) throw new HttpsError('failed-precondition', 'The trip has no partner to credit.');
    const whole = withPrivatePricing(b, privateRaw);
    const pricing = whole.pricing as { gstRate?: number; waitingPerHourPaise?: number; extraCharges?: ExtraChargesSnapshot } | undefined;
    const snapshot = pricing?.extraCharges;
    if (!snapshot) throw new HttpsError('failed-precondition', 'No extra-charge rates were saved for this booking’s vehicle category when it was quoted, so nothing can be charged.', { code: 'extra-posting-blocked', reasons: ['No extra-charge rates were saved for this booking when it was quoted.'] });
    const usage = u.usage as ExtraUsage;
    if (snapshot.taxTreatment === 'tariff_gst' && typeof pricing?.gstRate !== 'number') {
      throw new HttpsError('failed-precondition', 'These extra charges cannot be posted yet: the booking has no saved GST rate to apply.', { code: 'extra-posting-blocked', reasons: ['The booking has no saved GST rate to apply.'] });
    }
    const gstRate = typeof pricing?.gstRate === 'number' ? pricing.gstRate : 0;
    const calc = computeExtraCharges(snapshot, snapshot.partner, usage, gstRate, pricing?.waitingPerHourPaise);
    if (calc.blocked.length || !calc.customer || !calc.partner || calc.customerGstPaise === null || calc.customerTotalPaise === null) {
      throw new HttpsError('failed-precondition', `These extra charges cannot be posted yet: ${calc.blocked.join(' ')}`, { code: 'extra-posting-blocked', reasons: calc.blocked });
    }
    const customer = { waitingPaise: calc.customer.waitingPaise, hillPaise: calc.customer.hillPaise, carrierPaise: calc.customer.carrierPaise, subtotalPaise: calc.customer.subtotalPaise, gstPaise: calc.customerGstPaise, totalPaise: calc.customerTotalPaise };
    const extraCharges = {
      schema: 1, revision: u.revision, status: 'approved', usage, taxTreatment: snapshot.taxTreatment, roundingScope: snapshot.roundingScope,
      ratesVersion: snapshot.version, tariffVersion: snapshot.tariffVersion, gstRate,
      waiting: calc.waiting ? { perStop: calc.waiting.perStop, chargeableMinutes: calc.waiting.chargeableMinutes, billedMinutes: calc.waiting.billedMinutes } : null,
      customer, approvedBy: admin.uid, approvedByName: admin.name, approvedAt: Timestamp.now(),
    };
    const breakup = b.fareBreakup && typeof b.fareBreakup === 'object' ? withApprovedExtraLines(b.fareBreakup as FareBreakup, extraCharges) : null;
    tx.update(ref, {
      extraCharges, 'extraUsage.status': 'approved', 'extraUsage.reviewNote': note, 'extraUsage.reviewedBy': admin.uid, 'extraUsage.reviewedByName': admin.name, 'extraUsage.reviewedAt': stamp,
      ...(breakup ? { fareBreakup: breakup } : {}), updatedAt: stamp,
    });
    // The partner's amounts are payout data: private storage only, linked to the same revision the booking shows.
    tx.set(privatePricingRef(bookingId), {
      schema: 1, bookingId, customerId: text(b.customerId), tariffVersion: snapshot.tariffVersion,
      extraApproved: { revision: u.revision, partner: calc.partner, approvedBy: admin.uid, approvedAt: Timestamp.now() },
    }, { merge: true });
    tx.create(ref.collection('events').doc(), { type: 'extra_usage_approved', actorId: admin.uid, actorRole: 'admin', revision: u.revision, at: stamp });
    auditInTx(tx, {
      action: 'extra_usage_approved', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, reason: note || undefined,
      next: { revision: u.revision, customerTotalPaise: customer.totalPaise, partnerTotalPaise: calc.partner.subtotalPaise, ratesVersion: snapshot.version },
    });
    return { status: 'approved' as const, revision: u.revision, customerTotalPaise: customer.totalPaise };
  });
});
