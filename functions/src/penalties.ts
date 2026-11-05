// Penalties issued to drivers and vendors. Issued, changed and acknowledged only
// here: the amount, reason, related trip, who issued it and who acknowledged it
// are all stored and audited. Acknowledging records that the person has READ the
// penalty — it is not an admission, and the partner can dispute it.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { PENALTY_STATUSES, PenaltyStatusName, penaltyBlocker, penaltyStatusOf } from './domain/bookingFlow';
import { recomputeWallet, walletId } from './ledger';
import { notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { approved, requireAdmin, requirePermission, text, requireAction } from './shared';

export const MAX_PENALTY = 100000;
export const ACK_TEXT = 'I have read and understood the penalty information.';
export const PENALTY_CATEGORIES = [
  'Trip Cancellation', 'No Show at Pickup', 'Late Arrival', 'Misconduct / Complaint',
  'Document / Insurance Lapse', 'Vehicle Condition', 'Other',
  // Master Admin penalty reasons.
  'Assignment deadline missed', 'Accepted duty not fulfilled', 'Cancellation after driver arrival', 'Service / conduct issue',
];

const docId = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return v;
};

export const issuePenalty = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'compliance');
  requireAction(admin, 'Penalties', 'create');
  const input = request.data ?? {};
  const party = input.party === 'Vendor' ? 'Vendor' : input.party === 'Driver' ? 'Driver' : null;
  if (!party) throw new HttpsError('invalid-argument', 'Choose whether the penalty is for a driver or a vendor.');
  const partyId = docId(input.partyId, party.toLowerCase());
  const category = text(input.category, 60);
  if (!PENALTY_CATEGORIES.includes(category)) throw new HttpsError('invalid-argument', 'Choose a violation category.');
  const reason = text(input.reason, 500);
  if (reason.length < 10) throw new HttpsError('invalid-argument', 'Describe the violation (at least 10 characters).');
  const description = text(input.description, 1000);
  const amount = input.amount;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpsError('invalid-argument', 'Enter a penalty amount greater than zero, in whole rupees.');
  if (amount > MAX_PENALTY) throw new HttpsError('invalid-argument', `A penalty cannot exceed ₹${MAX_PENALTY.toLocaleString('en-IN')}.`);
  const compensation = input.customerCompensation == null ? 0 : input.customerCompensation;
  if (!Number.isSafeInteger(compensation) || compensation < 0 || compensation > amount) throw new HttpsError('invalid-argument', 'Customer compensation must be whole rupees and no more than the penalty.');
  const incidentDate = text(input.incidentDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate)) throw new HttpsError('invalid-argument', 'Enter the incident date.');
  if (incidentDate > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) throw new HttpsError('invalid-argument', 'The incident date cannot be in the future.');
  const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(input.requestId) ? input.requestId : '';
  const ref = requestId ? db.doc(`penalties/${requestId}`) : db.collection('penalties').doc();
  const pushes: { id: string; input: NotifyInput }[] = [];

  return db.runTransaction(async (tx) => {
    pushes.length = 0;
    const bookingRef = input.bookingId ? db.doc(`bookings/${docId(input.bookingId, 'booking')}`) : null;
    const [existing, partner, booking] = await Promise.all([
      tx.get(ref), tx.get(db.doc(`${party === 'Driver' ? 'drivers' : 'vendors'}/${partyId}`)), bookingRef ? tx.get(bookingRef) : Promise.resolve(null),
    ]);
    if (existing.exists) return { id: ref.id, duplicate: true };
    if (!partner.exists) throw new HttpsError('not-found', `${party} not found.`);
    let bookingCode = '';
    if (booking) {
      if (!booking.exists) throw new HttpsError('not-found', 'Booking not found.');
      const b = booking.data()!;
      const owner = party === 'Driver' ? b.assignedDriverId : b.assignedVendorId;
      // A trip can be penalised only against someone who handled it (including a previous driver on a reassigned trip).
      let handled = owner === partyId;
      if (!handled) {
        const history = await tx.get(booking.ref.collection('assignments'));
        handled = history.docs.some((d) => d.data().oldDriver?.id === partyId || d.data().oldDriver?.vendorId === partyId);
      }
      if (!handled) throw new HttpsError('failed-precondition', `This booking was not handled by the selected ${party.toLowerCase()}.`);
      bookingCode = text(b.bookingId) || booking.id;
    }
    const p = partner.data()!;
    const name = text(p.companyName || p.name, 120);
    const stamp = FieldValue.serverTimestamp();
    tx.create(ref, {
      id: ref.id, entityType: party, entityId: partyId, entityName: name,
      driverId: party === 'Driver' ? partyId : '', vendorId: party === 'Vendor' ? partyId : '',
      category, reason, description, notes: description, amount, customerCompensation: compensation,
      bookingDocumentId: booking?.id ?? '', bookingCode, incidentDate,
      status: 'Pending', requiresAcknowledgement: true, acknowledged: false,
      issuedBy: admin.uid, issuedByName: admin.name, issuedAt: stamp, createdBy: admin.uid, createdAt: stamp, updatedAt: stamp,
      history: [{ status: 'Pending', by: admin.uid, byName: admin.name, at: Timestamp.now(), note: 'Issued' }],
    });
    auditInTx(tx, { action: 'penalty_issued', entity: 'penalty', entityId: ref.id, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: booking?.id, next: { party, partyId, amount, category }, reason });
    const n: NotifyInput = {
      recipientType: party === 'Driver' ? 'driver' : 'vendor', recipientId: partyId, category: 'penalties', severity: 'critical', sound: 'general',
      title: `Penalty of ₹${amount.toLocaleString('en-IN')} issued`, message: `${category}${bookingCode ? ` · ${bookingCode}` : ''}: ${reason}`,
      bookingId: booking?.id, bookingCode, cta: { label: 'View penalty', page: 'penalties' }, push: true, sentBy: admin.uid,
    };
    pushes.push({ id: notifyInTx(tx, n), input: n });
    return { id: ref.id, duplicate: false };
  }).then(async (r) => { await pushAfterCommit(pushes); return r; });
});

/** Staff action on a penalty: paid, deducted from payout, waived, or an upheld dispute. */
export const transitionPenalty = onCall(async (request) => {
  const admin = await requireAdmin(request.auth);
  const input = request.data ?? {};
  const penaltyId = docId(input.penaltyId, 'penalty');
  const to = input.status as PenaltyStatusName;
  if (!(PENALTY_STATUSES as readonly string[]).includes(to) || to === 'Acknowledged' || to === 'Disputed') throw new HttpsError('invalid-argument', 'Choose Pending, Paid, Deducted or Waived.');
  const needsFinance = to === 'Paid' || to === 'Deducted';
  if (!admin.permissions.includes(needsFinance ? 'finance' : 'compliance')) throw new HttpsError('permission-denied', needsFinance ? 'Recording a payment or deduction needs finance access.' : 'Your role does not include compliance access.');
  requireAction(admin, needsFinance ? 'Accounts' : 'Penalties', 'approve');
  const note = text(input.note, 500);
  const reference = text(input.reference, 120);
  if ((to === 'Waived' || to === 'Pending') && note.length < 5) throw new HttpsError('invalid-argument', to === 'Waived' ? 'Give the reason for the waiver.' : 'Give the decision note.');
  if (to === 'Paid' && reference.length < 3) throw new HttpsError('invalid-argument', 'Enter the payment reference.');
  const ref = db.doc(`penalties/${penaltyId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  let wallet: { type: 'driver' | 'vendor'; id: string } | null = null;
  const result = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    wallet = null;
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Penalty not found.');
    const p = snap.data()!;
    const from = penaltyStatusOf(p.status);
    const blocker = penaltyBlocker(from, to);
    if (blocker) throw new HttpsError('failed-precondition', blocker);
    const partnerType = p.entityType === 'Vendor' || p.vendorId ? 'vendor' : 'driver';
    const partnerId = text(p.driverId) || text(p.vendorId) || text(p.entityId);
    const stamp = FieldValue.serverTimestamp();
    const history = [...(Array.isArray(p.history) ? p.history : []).slice(-19), { status: to, by: admin.uid, byName: admin.name, at: Timestamp.now(), note, reference }];
    const extra: Record<string, unknown> = {};
    if (to === 'Paid') Object.assign(extra, { paidAt: stamp, paymentReference: reference, recoveryReference: reference, recoveredAt: stamp });
    if (to === 'Deducted') {
      Object.assign(extra, { deductedAt: stamp, deductedBy: admin.uid, ledgerEntryId: `penalty_${penaltyId}` });
      // A deduction reduces the partner's withdrawable balance through the same ledger as every other money movement.
      const amount = Number(p.amount);
      tx.set(db.doc(`wallet_ledger/penalty_${penaltyId}`), {
        schema: 2, actorType: partnerType, actorId: partnerId, walletId: walletId(partnerType, partnerId), [partnerType === 'vendor' ? 'vendorId' : 'driverId']: partnerId,
        type: 'penalty_deduction', direction: 'debit', netAmount: amount, grossAmount: amount, commissionAmount: 0, status: 'completed',
        bookingId: text(p.bookingDocumentId), bookingCode: text(p.bookingCode), payoutRequestId: '', penaltyId, source: 'penalty', createdAt: stamp, finalizedAt: stamp,
      });
      wallet = { type: partnerType, id: partnerId };
    }
    if (to === 'Waived' || to === 'Pending') Object.assign(extra, { resolutionNote: note, resolvedAt: stamp, resolvedBy: admin.uid });
    tx.update(ref, { status: to, history, updatedAt: stamp, updatedBy: admin.uid, ...extra });
    auditInTx(tx, { action: `penalty_${to.toLowerCase()}`, entity: 'penalty', entityId: penaltyId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: text(p.bookingDocumentId) || undefined, previous: { status: from }, next: { status: to, amount: p.amount }, reason: note || reference });
    const n: NotifyInput = {
      recipientType: partnerType, recipientId: partnerId, category: 'penalties', severity: to === 'Waived' ? 'success' : 'info', sound: 'general',
      title: `Penalty ${to === 'Pending' ? 'upheld' : to.toLowerCase()}`, message: `₹${Number(p.amount).toLocaleString('en-IN')} · ${text(p.category)}${note ? ` — ${note}` : ''}`,
      bookingId: text(p.bookingDocumentId) || undefined, bookingCode: text(p.bookingCode), cta: { label: 'View penalty', page: 'penalties' }, push: true, sentBy: admin.uid,
    };
    pushes.push({ id: notifyInTx(tx, n), input: n });
    return { status: to };
  });
  await pushAfterCommit(pushes);
  const w = wallet as { type: 'driver' | 'vendor'; id: string } | null;
  if (w) await recomputeWallet(w.type, w.id);
  return result;
});

async function partnerPenalty(auth: { uid: string } | undefined, penaltyId: string) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const ref = db.doc(`penalties/${penaltyId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Penalty not found.');
  const p = snap.data()!;
  const role = p.driverId === auth.uid ? 'driver' : p.vendorId === auth.uid ? 'vendor' : null;
  if (!role) throw new HttpsError('permission-denied', 'This penalty was not issued to you.');
  const profile = await db.doc(`${role}s/${auth.uid}`).get();
  if (!profile.exists || !approved(profile.data()!.status)) throw new HttpsError('permission-denied', 'Your account is not active.');
  return { ref, role: role as 'driver' | 'vendor', name: text(profile.data()!.companyName || profile.data()!.name) };
}

export const acknowledgePenalty = onCall(async (request) => {
  const penaltyId = docId(request.data?.penaltyId, 'penalty');
  if (request.data?.confirmed !== true) throw new HttpsError('failed-precondition', 'Tick the box to confirm you have read the penalty.');
  const { ref, role, name } = await partnerPenalty(request.auth, penaltyId);
  const uid = request.auth!.uid;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const p = snap.data()!;
    if (p.acknowledged === true) return { ok: true, already: true };
    const from = penaltyStatusOf(p.status);
    if (from !== 'Pending') throw new HttpsError('failed-precondition', `This penalty is ${from.toLowerCase()} and does not need acknowledgement.`);
    const stamp = FieldValue.serverTimestamp();
    const history = [...(Array.isArray(p.history) ? p.history : []).slice(-19), { status: 'Acknowledged', by: uid, byName: name, at: Timestamp.now(), note: 'Read and understood' }];
    tx.update(ref, { status: 'Acknowledged', acknowledged: true, acknowledgedAt: stamp, acknowledgedBy: uid, acknowledgedByName: name, acknowledgedByRole: role, acknowledgementText: ACK_TEXT, history, updatedAt: stamp });
    auditInTx(tx, { action: 'penalty_acknowledged', entity: 'penalty', entityId: penaltyId, performedBy: uid, performedByName: name, role, bookingId: text(p.bookingDocumentId) || undefined, previous: { status: from }, next: { status: 'Acknowledged', acknowledged: true } });
    return { ok: true, already: false };
  });
});

export const disputePenalty = onCall(async (request) => {
  const penaltyId = docId(request.data?.penaltyId, 'penalty');
  const note = text(request.data?.note, 500);
  if (note.length < 10) throw new HttpsError('invalid-argument', 'Explain why you dispute this penalty (at least 10 characters).');
  const { ref, role, name } = await partnerPenalty(request.auth, penaltyId);
  const uid = request.auth!.uid;
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const p = snap.data()!;
    const from = penaltyStatusOf(p.status);
    const blocker = penaltyBlocker(from, 'Disputed');
    if (blocker) throw new HttpsError('failed-precondition', blocker);
    const stamp = FieldValue.serverTimestamp();
    const history = [...(Array.isArray(p.history) ? p.history : []).slice(-19), { status: 'Disputed', by: uid, byName: name, at: Timestamp.now(), note }];
    tx.update(ref, { status: 'Disputed', disputeNote: note, disputedAt: stamp, disputedBy: uid, history, updatedAt: stamp });
    auditInTx(tx, { action: 'penalty_disputed', entity: 'penalty', entityId: penaltyId, performedBy: uid, performedByName: name, role, bookingId: text(p.bookingDocumentId) || undefined, previous: { status: from }, next: { status: 'Disputed' }, reason: note });
    const n: NotifyInput = {
      recipientType: 'admin', recipientId: 'admin', category: 'penalties', severity: 'warning', sound: 'general', title: 'Penalty disputed',
      message: `${name} disputed a ₹${Number(p.amount).toLocaleString('en-IN')} penalty: ${note}`, bookingId: text(p.bookingDocumentId) || undefined, bookingCode: text(p.bookingCode),
      cta: { label: 'Review penalty', page: 'penalties' }, push: true, sentBy: uid,
    };
    notifyInTx(tx, n);
    return { ok: true };
  });
});
