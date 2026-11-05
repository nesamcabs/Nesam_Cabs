// Booking payments as transactions. A booking never has "a payment field that
// is overwritten": every receipt (advance, part payment, final balance) is its
// own immutable record in bookings/{id}/payment_transactions, with who
// collected it. The paid / balance / status figures on the booking are derived
// from those records by this module only — never typed in, never client-written.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { DocumentData, FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx, AuditRole } from './audit';
import { PAYMENT_KINDS, MANUAL_PAYMENT_METHODS, CollectorType, COLLECTOR_TYPES, PaymentTxn, PaymentSummary, amountDueFor, legacyPaymentField, summarizePayments } from './domain/bookingFlow';
import { formatDateTime12 } from './domain/time';
import { notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { approved, requestIdOf, requireAdmin, text, requireAction } from './shared';
import type { AdminAccess } from './permissions';

const MAX_PAYMENT = 10000000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const docId = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return v;
};

export const txnsRef = (bookingId: string) => db.collection(`bookings/${bookingId}/payment_transactions`);

/** Methods the business accepts. settings/payment_methods.enabled may add or remove entries. */
async function enabledMethods(tx: Transaction): Promise<string[]> {
  const snap = await tx.get(db.doc('settings/payment_methods'));
  const list = snap.data()?.enabled;
  const extra = Array.isArray(list) ? list.filter((m: unknown): m is string => typeof m === 'string' && m.length > 0 && m.length <= 30 && m !== 'Gateway') : [];
  return extra.length ? extra : [...MANUAL_PAYMENT_METHODS];
}

function toPaymentTxn(d: DocumentData): PaymentTxn {
  return {
    amount: typeof d.amount === 'number' ? d.amount : 0, method: String(d.method ?? ''), kind: d.kind, collectorType: d.collectorType,
    status: d.status, paymentDate: d.paymentDate?.toMillis?.() ?? null,
  };
}

/** Recomputes the booking's derived payment fields from its transaction records. */
export function derivedPaymentFields(b: DocumentData, txns: DocumentData[]) {
  const summary = summarizePayments(amountDueFor(b), txns.map(toPaymentTxn), b.refund ?? null);
  return { summary, fields: summaryFields(b, summary) };
}

function summaryFields(b: DocumentData, s: PaymentSummary) {
  return {
    paymentSummary: { ...s, updatedAt: Timestamp.now() },
    paymentStatus: s.status,
    payment: legacyPaymentField(s),
    ...(s.status === 'Paid' && !b.paidAt ? { paidAt: FieldValue.serverTimestamp() } : {}),
  };
}

interface Caller {
  uid: string;
  role: AuditRole;
  name: string;
  /** Collector the transaction is recorded against. */
  collectorType: CollectorType;
  collectorId: string;
  admin: AdminAccess | null;
}

/**
 * Who is calling: an active staff member with finance access (may record for
 * any collector), or the booking's own driver / vendor (always recorded as
 * themselves — a partner cannot record cash on someone else's behalf).
 */
async function resolveCaller(auth: { uid: string; token?: { email?: string } } | undefined, b: DocumentData, input: Record<string, unknown>): Promise<Caller> {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = auth.uid;
  const adminSnap = await db.doc(`admins/${uid}`).get();
  if (adminSnap.exists && adminSnap.data()?.role === 'admin' && adminSnap.data()?.status === 'active') {
    const admin = await requireAdmin(auth);
    if (!admin.permissions.includes('finance')) throw new HttpsError('permission-denied', 'Recording payments needs finance access.');
    requireAction(admin, 'Accounts', 'create');
    const requested = String(input.collectorType ?? 'admin');
    if (!(COLLECTOR_TYPES as readonly string[]).includes(requested)) throw new HttpsError('invalid-argument', 'Choose who collected the payment.');
    let collectorId = admin.uid;
    if (requested === 'driver') {
      if (!b.assignedDriverId) throw new HttpsError('failed-precondition', 'This booking has no driver to record a collection against.');
      collectorId = b.assignedDriverId;
    } else if (requested === 'vendor') {
      if (!b.assignedVendorId) throw new HttpsError('failed-precondition', 'This booking has no vendor to record a collection against.');
      collectorId = b.assignedVendorId;
    }
    return { uid, role: 'admin', name: admin.name, collectorType: requested as CollectorType, collectorId, admin };
  }
  if (b.assignedDriverId === uid) {
    const d = await db.doc(`drivers/${uid}`).get();
    if (!d.exists || !approved(d.data()!.status)) throw new HttpsError('permission-denied', 'Your driver account is not active.');
    return { uid, role: 'driver', name: text(d.data()!.name), collectorType: 'driver', collectorId: uid, admin: null };
  }
  if (b.assignedVendorId === uid) {
    const v = await db.doc(`vendors/${uid}`).get();
    if (!v.exists || !approved(v.data()!.status)) throw new HttpsError('permission-denied', 'Your vendor account is not active.');
    return { uid, role: 'vendor', name: text(v.data()!.companyName || v.data()!.name), collectorType: 'vendor', collectorId: uid, admin: null };
  }
  throw new HttpsError('permission-denied', 'You cannot record payments for this booking.');
}

async function collectorName(c: Caller, b: DocumentData): Promise<string> {
  if (c.role !== 'admin') return c.name;
  if (c.collectorType === 'driver') return text(b.assignedDriverName || b.driver);
  if (c.collectorType === 'vendor') return text(b.assignedVendorName);
  return c.name;
}

export const recordPayment = onCall(async (request) => {
  const input = (request.data ?? {}) as Record<string, unknown>;
  const bookingId = docId(input.bookingId, 'booking');
  const txId = requestIdOf(input.requestId);
  const ref = db.doc(`bookings/${bookingId}`);

  const amount = input.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT) throw new HttpsError('invalid-argument', 'Enter the amount received, greater than zero.');
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) throw new HttpsError('invalid-argument', 'Use at most two decimal places.');
  const method = text(input.method, 30);
  const reference = text(input.reference, 120);
  const notes = text(input.notes, 300);
  const kindIn = typeof input.kind === 'string' && (PAYMENT_KINDS as readonly string[]).includes(input.kind) ? input.kind : '';
  const requestedDate = typeof input.paymentDate === 'string' || typeof input.paymentDate === 'number' ? new Date(input.paymentDate) : null;
  if (requestedDate && !Number.isFinite(requestedDate.getTime())) throw new HttpsError('invalid-argument', 'Enter a valid payment date.');

  const snap0 = await ref.get();
  if (!snap0.exists) throw new HttpsError('not-found', 'Booking not found.');
  const caller = await resolveCaller(request.auth, snap0.data()!, input);
  const label = await collectorName(caller, snap0.data()!);
  const pushes: { id: string; input: NotifyInput }[] = [];

  const result = await db.runTransaction(async (tx) => {
    pushes.length = 0; // the callback can retry; only the committed attempt may push
    const [snap, existing, all, methods] = await Promise.all([tx.get(ref), tx.get(txnsRef(bookingId).doc(txId)), tx.get(txnsRef(bookingId)), enabledMethods(tx)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (existing.exists) {
      if (existing.data()!.enteredBy !== caller.uid) throw new HttpsError('permission-denied', 'Request already used.');
      return { id: txId, summary: (b.paymentSummary ?? null) as PaymentSummary | null, duplicate: true };
    }
    // Re-check the caller's relationship inside the transaction.
    if (caller.role === 'driver' && b.assignedDriverId !== caller.uid) throw new HttpsError('permission-denied', 'This booking is no longer assigned to you.');
    if (caller.role === 'vendor' && b.assignedVendorId !== caller.uid) throw new HttpsError('permission-denied', 'This booking is no longer assigned to you.');
    if (['Cancelled', 'Rejected'].includes(b.status)) throw new HttpsError('failed-precondition', `A ${String(b.status).toLowerCase()} booking cannot take new payments. Use the refund flow instead.`);
    if (!methods.includes(method)) throw new HttpsError('invalid-argument', `Choose a payment method: ${methods.join(', ')}.`);
    if (method !== 'Cash' && reference.length < 4) throw new HttpsError('invalid-argument', `Enter the ${method === 'UPI' ? 'UPI transaction' : 'transfer'} reference.`);
    const paymentDate = requestedDate ?? new Date();
    if (paymentDate.getTime() > Date.now() + CLOCK_SKEW_MS) throw new HttpsError('invalid-argument', 'The payment date cannot be in the future.');
    const created = (b.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (created && paymentDate.getTime() < created - 86400000) throw new HttpsError('invalid-argument', 'The payment date is before the booking was created.');

    const prior = all.docs.map((d) => d.data());
    const before = summarizePayments(amountDueFor(b), prior.map(toPaymentTxn), b.refund ?? null);
    if (amount > before.balanceDue + 0.005) {
      throw new HttpsError('failed-precondition', before.balanceDue > 0
        ? `The amount is more than the balance due (₹${before.balanceDue.toLocaleString('en-IN')}).`
        : 'This booking is already fully paid.');
    }
    const kind = kindIn || (before.transactions === 0 && amount < before.balanceDue ? 'advance' : amount >= before.balanceDue - 0.005 ? 'final' : 'partial');
    const txn = {
      id: txId, bookingId, bookingCode: text(b.bookingId) || bookingId, amount, method, kind, status: 'Success',
      collectorType: caller.collectorType, collectorId: caller.collectorId, collectorName: label,
      paymentDate: Timestamp.fromDate(paymentDate), reference, notes,
      enteredBy: caller.uid, enteredByRole: caller.role, enteredByName: caller.name, createdAt: FieldValue.serverTimestamp(),
    };
    const after = summarizePayments(amountDueFor(b), [...prior, txn].map(toPaymentTxn), b.refund ?? null);
    tx.create(txnsRef(bookingId).doc(txId), txn);
    tx.update(ref, { ...summaryFields(b, after), updatedAt: FieldValue.serverTimestamp() });
    // Mirror for the Payments screen and reports (company-wide receipts list).
    tx.set(db.doc(`payments/${bookingId}_${txId}`), {
      id: `${bookingId}_${txId}`, bookingId: txn.bookingCode, bookingDocumentId: bookingId, customerId: b.customerId ?? '', customer: b.customer ?? '',
      amount, method, status: 'Success', gateway: `${caller.collectorType === 'admin' || caller.collectorType === 'staff' ? 'Received by NESAM' : `Collected by ${caller.collectorType}`}`,
      reference, date: paymentDate.toISOString(), verifiedBy: caller.uid, collectorType: caller.collectorType, collectorId: caller.collectorId,
      collectorName: label, kind, createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(ref.collection('events').doc(), { type: 'payment_recorded', actorId: caller.uid, actorRole: caller.role, amount, method, kind, collectorType: caller.collectorType, at: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'payment_recorded', entity: 'payment', entityId: txId, performedBy: caller.uid, performedByName: caller.name, role: caller.role, bookingId,
      previous: { totalPaid: before.totalPaid, balanceDue: before.balanceDue, status: before.status },
      next: { amount, method, kind, collectorType: caller.collectorType, totalPaid: after.totalPaid, balanceDue: after.balanceDue, status: after.status },
    });
    const n: NotifyInput = {
      recipientType: 'admin', recipientId: 'admin', category: 'payments', severity: after.status === 'Paid' ? 'success' : 'info', sound: 'general',
      title: after.status === 'Paid' ? 'Booking fully paid' : 'Payment received',
      message: `₹${amount.toLocaleString('en-IN')} by ${method} (${label || caller.collectorType}) for ${txn.bookingCode} at ${formatDateTime12(paymentDate)}. Balance ₹${after.balanceDue.toLocaleString('en-IN')}.`,
      bookingId, bookingCode: txn.bookingCode, cta: { label: 'View payment', page: 'booking-detail', bookingId }, push: after.status === 'Paid',
    };
    pushes.push({ id: notifyInTx(tx, n), input: n });
    return { id: txId, summary: after, duplicate: false };
  });
  await pushAfterCommit(pushes);
  return result;
});

/** A recorded payment is never deleted: finance voids it with a reason and the history keeps both. */
export const voidPayment = onCall(async (request) => {
  const admin = await requireAdmin(request.auth);
  if (!admin.permissions.includes('finance')) throw new HttpsError('permission-denied', 'Voiding a payment needs finance access.');
  requireAction(admin, 'Accounts', 'approve');
  const bookingId = docId(request.data?.bookingId, 'booking');
  const txId = docId(request.data?.paymentId, 'payment');
  const reason = text(request.data?.reason, 300);
  if (reason.length < 10) throw new HttpsError('invalid-argument', 'Give a reason of at least 10 characters.');
  const ref = db.doc(`bookings/${bookingId}`);
  return db.runTransaction(async (tx) => {
    const [snap, all] = await Promise.all([tx.get(ref), tx.get(txnsRef(bookingId))]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const target = all.docs.find((d) => d.id === txId);
    if (!target) throw new HttpsError('not-found', 'Payment not found.');
    if (target.data().status === 'Voided') throw new HttpsError('failed-precondition', 'This payment is already voided.');
    const b = snap.data()!;
    if (b.finance && b.finance.schema === 1) throw new HttpsError('failed-precondition', 'This trip is financially finalized. Record an adjustment instead of voiding.');
    const rows = all.docs.map((d) => (d.id === txId ? { ...d.data(), status: 'Voided' } : d.data()));
    const { summary, fields } = derivedPaymentFields(b, rows);
    tx.update(target.ref, { status: 'Voided', voidedAt: FieldValue.serverTimestamp(), voidedBy: admin.uid, voidReason: reason });
    tx.update(ref, { ...fields, updatedAt: FieldValue.serverTimestamp() });
    tx.update(db.doc(`payments/${bookingId}_${txId}`), { status: 'Voided', voidedBy: admin.uid, voidReason: reason });
    auditInTx(tx, {
      action: 'payment_voided', entity: 'payment', entityId: txId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, reason,
      previous: { amount: target.data().amount, status: 'Success' }, next: { status: 'Voided', totalPaid: summary.totalPaid, balanceDue: summary.balanceDue },
    });
    return { summary };
  });
});

const MONEY_KEYS = ['fare', 'tollCharges', 'extraCharges', 'status', 'refund'];

/** Keeps paid / balance figures right when the fare, tolls, status or refund changes. */
export const onBookingMoneyChange = onDocumentUpdated('bookings/{bookingId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (MONEY_KEYS.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null))) return;
  await reconcileBookingMoney(event.params.bookingId);
});

/** Recomputes the paid / balance figures from the booking and its transactions. Idempotent. */
export async function reconcileBookingMoney(bookingId: string): Promise<void> {
  const ref = db.doc(`bookings/${bookingId}`);
  await db.runTransaction(async (tx) => {
    const [snap, all] = await Promise.all([tx.get(ref), tx.get(txnsRef(bookingId))]);
    const b = snap.data();
    if (!snap.exists || !b) return;
    const { summary, fields } = derivedPaymentFields(b, all.docs.map((d) => d.data()));
    const prev = b.paymentSummary;
    if (prev && prev.amountDue === summary.amountDue && prev.totalPaid === summary.totalPaid && prev.status === summary.status && prev.refunded === summary.refunded) return;
    // Bookings paid before transactions existed keep their legacy "Paid" flag.
    if (!all.size && (b.payment === 'Paid' || b.paymentStatus === 'Paid') && !b.refund) return;
    tx.update(ref, fields);
  });
}
