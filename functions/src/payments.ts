// Gateway (Razorpay) checkout. A client-reported "payment succeeded" proves nothing: money is
// recognised only after the server (a) verifies the checkout signature AND (b) fetches the
// payment from the provider and sees it captured for the order's exact amount, or (c) receives a
// signed provider webhook. Either way the result becomes a canonical receipt in
// bookings/{id}/payment_transactions (the same record a cash or UPI receipt uses), so the balance,
// the paid flag and partner settlement are all DERIVED from it. Pending and failed payments never
// reduce the balance. Receipts are idempotent on the provider payment id, so a retried callback,
// a double webhook or a replayed checkout posts once.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { summarizePayments } from './domain/bookingFlow';
import { derivedPaymentFields, txnsRef } from './bookingPayments';

export const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
export const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');

// Secret Manager needs these params to have a value for `firebase deploy`. Until real keys are
// set they hold the sentinel "UNSET", which is treated exactly like "not configured".
const UNSET = 'UNSET';
export const configured = (...values: string[]) => values.every((v) => v && v !== UNSET);

const paiseOf = (rupees: number) => Math.round(rupees * 100);
export const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** What the provider says about a payment. Injectable so the flow is testable without the network. */
export interface ProviderPayment {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  method?: string;
  captured?: boolean;
}
type FetchPayment = (paymentId: string, keyId: string, keySecret: string) => Promise<ProviderPayment>;
let fetchPaymentImpl: FetchPayment = async (paymentId, keyId, keySecret) => {
  const rp = new Razorpay({ key_id: keyId, key_secret: keySecret }) as any;
  return (await rp.payments.fetch(paymentId)) as ProviderPayment;
};
/** Test hook. */
export function setPaymentFetcher(fn: FetchPayment | null): void {
  fetchPaymentImpl = fn ?? (async (paymentId, keyId, keySecret) => (await (new Razorpay({ key_id: keyId, key_secret: keySecret }) as any).payments.fetch(paymentId)) as ProviderPayment);
}

export const gatewayTxnId = (paymentId: string) => `gw_${paymentId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`;

export interface GatewayReceipt { bookingId: string; paymentId: string; orderId: string; amountPaise: number; method: string; source: 'checkout' | 'webhook' }

/**
 * Records a CAPTURED provider payment as a receipt. Idempotent: the receipt id is derived from the
 * provider payment id, so any number of callbacks produce one record and one balance change.
 */
export async function recordGatewayReceipt(r: GatewayReceipt): Promise<{ recorded: boolean; status: string; balanceDue: number }> {
  const ref = db.doc(`bookings/${r.bookingId}`);
  const txId = gatewayTxnId(r.paymentId);
  return db.runTransaction(async (tx) => {
    const [snap, existing, all] = await Promise.all([tx.get(ref), tx.get(txnsRef(r.bookingId).doc(txId)), tx.get(txnsRef(r.bookingId))]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (existing.exists) {
      const s = (b.paymentSummary ?? {}) as { status?: string; balanceDue?: number };
      return { recorded: false, status: String(s.status ?? ''), balanceDue: Number(s.balanceDue ?? 0) };
    }
    const amount = r.amountPaise / 100;
    const code = String(b.bookingId || r.bookingId);
    const prior = all.docs.map((d) => d.data());
    const txn = {
      id: txId, bookingId: r.bookingId, bookingCode: code, amount, method: 'Gateway', kind: prior.length === 0 ? 'advance' : 'partial', status: 'Success',
      collectorType: 'system', collectorId: 'razorpay', collectorName: 'Online payment (Razorpay)',
      paymentDate: Timestamp.now(), reference: r.paymentId, notes: `Order ${r.orderId} · ${r.method}`,
      enteredBy: 'razorpay', enteredByRole: 'system', enteredByName: 'Razorpay', provider: { name: 'razorpay', orderId: r.orderId, paymentId: r.paymentId, source: r.source }, createdAt: FieldValue.serverTimestamp(),
    };
    const rows = [...prior, txn];
    const { summary, fields } = derivedPaymentFields(b, rows);
    // The last transaction closes the balance → label it final.
    if (summary.status === 'Paid') txn.kind = 'final';
    tx.create(txnsRef(r.bookingId).doc(txId), txn);
    tx.update(ref, { ...fields, updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`payments/${r.bookingId}_${txId}`), {
      id: `${r.bookingId}_${txId}`, bookingId: code, bookingDocumentId: r.bookingId, customerId: b.customerId ?? '', customer: b.customer ?? '', amount,
      method: 'Gateway', status: 'Success', gateway: 'Razorpay', reference: r.paymentId, date: new Date().toISOString(), verifiedBy: 'razorpay', collectorType: 'system',
      collectorId: 'razorpay', collectorName: 'Online payment (Razorpay)', kind: txn.kind, createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(ref.collection('events').doc(), { type: 'payment_recorded', actorId: 'razorpay', actorRole: 'system', amount, method: 'Gateway', kind: txn.kind, collectorType: 'system', at: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'payment_recorded', entity: 'payment', entityId: txId, performedBy: 'razorpay', performedByName: 'Razorpay', role: 'system', bookingId: r.bookingId,
      next: { amount, method: 'Gateway', source: r.source, totalPaid: summary.totalPaid, balanceDue: summary.balanceDue, status: summary.status },
    });
    return { recorded: true, status: summary.status, balanceDue: summary.balanceDue };
  });
}

/** Marks a provider payment that did not succeed. It never touches the balance. */
async function recordGatewayFailure(bookingId: string, paymentId: string, orderId: string, reason: string) {
  await db.doc(`bookings/${bookingId}/gateway_orders/${orderId}`).set({ lastPaymentId: paymentId, lastFailure: reason, failedAt: FieldValue.serverTimestamp(), status: 'attempt_failed' }, { merge: true });
}

/**
 * Creates a provider order for the booking's CURRENT balance (derived from receipts), never a
 * client-supplied amount. Until real keys are configured this throws PAYMENT_NOT_CONFIGURED
 * rather than fabricating an order.
 */
export const createRazorpayOrder = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const keyId = RAZORPAY_KEY_ID.value();
  const keySecret = RAZORPAY_KEY_SECRET.value();
  if (!configured(keyId, keySecret)) throw new HttpsError('failed-precondition', 'PAYMENT_NOT_CONFIGURED');
  const { bookingId } = (request.data ?? {}) as { bookingId?: string };
  if (typeof bookingId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(bookingId)) throw new HttpsError('invalid-argument', 'bookingId is required.');
  const ref = db.doc(`bookings/${bookingId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
  const b = snap.data()!;
  if (b.customerId !== uid) throw new HttpsError('permission-denied', 'This booking does not belong to you.');
  if (['Cancelled', 'Rejected'].includes(b.status)) throw new HttpsError('failed-precondition', `A ${String(b.status).toLowerCase()} booking cannot be paid.`);
  const txns = await txnsRef(bookingId).get();
  const { summary } = derivedPaymentFields(b, txns.docs.map((d) => d.data()));
  const amountPaise = paiseOf(summary.balanceDue);
  if (amountPaise < 100) throw new HttpsError('failed-precondition', summary.status === 'Paid' ? 'This booking is already fully paid.' : 'There is no balance to pay online.');
  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  const order = await razorpay.orders.create({ amount: amountPaise, currency: 'INR', receipt: `${bookingId}`.slice(0, 40), notes: { bookingId, customerId: uid } });
  await db.doc(`bookings/${bookingId}/gateway_orders/${order.id}`).set({
    orderId: order.id, bookingId, customerId: uid, amountPaise, currency: 'INR', status: 'created', createdAt: FieldValue.serverTimestamp(),
  });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId };
});

/**
 * Verifies a checkout result. The signature proves the order/payment pair came from the
 * checkout; the provider fetch proves the money was captured for exactly the order's amount.
 */
export const verifyRazorpayPayment = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const keyId = RAZORPAY_KEY_ID.value();
  const keySecret = RAZORPAY_KEY_SECRET.value();
  if (!configured(keyId, keySecret)) throw new HttpsError('failed-precondition', 'PAYMENT_NOT_CONFIGURED');
  const { bookingId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = (request.data ?? {}) as Record<string, string | undefined>;
  if (!bookingId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) throw new HttpsError('invalid-argument', 'Missing payment verification fields.');
  const [booking, order] = await Promise.all([db.doc(`bookings/${bookingId}`).get(), db.doc(`bookings/${bookingId}/gateway_orders/${razorpayOrderId}`).get()]);
  if (!booking.exists) throw new HttpsError('not-found', 'Booking not found.');
  if (booking.data()!.customerId !== uid) throw new HttpsError('permission-denied', 'This booking does not belong to you.');
  if (!order.exists) throw new HttpsError('failed-precondition', 'Order does not match this booking.');
  const expected = createHmac('sha256', keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
  if (!safeEq(expected, razorpaySignature)) throw new HttpsError('invalid-argument', 'Payment signature verification failed.');

  const p = await fetchPaymentImpl(razorpayPaymentId, keyId, keySecret);
  if (p.order_id !== razorpayOrderId) throw new HttpsError('failed-precondition', 'The payment does not belong to this order.');
  if (p.status === 'failed') {
    await recordGatewayFailure(bookingId, p.id, razorpayOrderId, 'failed');
    throw new HttpsError('failed-precondition', 'The payment failed. You have not been charged; please try again.');
  }
  if (p.status !== 'captured') {
    // Authorized but not yet captured, or still processing: nothing is recognised until the provider captures it.
    return { verified: true, status: 'pending', message: 'Your payment is being confirmed. It will show on the booking shortly.' };
  }
  if (p.amount !== order.data()!.amountPaise || p.currency !== 'INR') throw new HttpsError('failed-precondition', 'The paid amount does not match the order.');
  const r = await recordGatewayReceipt({ bookingId, paymentId: p.id, orderId: razorpayOrderId, amountPaise: p.amount, method: p.method ?? 'online', source: 'checkout' });
  await order.ref.set({ status: 'paid', paymentId: p.id, paidAt: FieldValue.serverTimestamp() }, { merge: true });
  // HTTP hosting has no Firestore triggers: release earnings and refresh settlement here too.
  await (await import('./reconcile')).reconcileBooking(bookingId);
  return { verified: true, status: 'paid', balanceDue: r.balanceDue, duplicate: !r.recorded };
});

/**
 * Handles a signed Razorpay webhook body. Returns what was done. The caller (HTTP entry point)
 * has already verified X-Razorpay-Signature over the raw body.
 */
export async function handleRazorpayEvent(event: any): Promise<{ handled: boolean; detail: string }> {
  const type = String(event?.event ?? '');
  const entity = event?.payload?.payment?.entity as ProviderPayment & { notes?: Record<string, string>; error_description?: string } | undefined;
  if (!entity?.id || !entity.order_id) return { handled: false, detail: 'no payment entity' };
  // The booking is found through the order we created, never trusted from the payload notes alone.
  const orders = await db.collectionGroup('gateway_orders').where('orderId', '==', entity.order_id).limit(1).get();
  if (orders.empty) {
    // Wallet checkout may close before capture completes. The signed webhook must
    // finish that payment without depending on the customer's callback returning.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(entity.order_id)) return { handled: false, detail: 'unknown order' };
    // Local Taxi ride payment: found through the order we created, amount and currency re-checked, idempotent on the payment id.
    const ltOrder = await db.doc(`lt_payment_orders/${entity.order_id}`).get();
    if (ltOrder.exists) {
      const lt = await import('./localTaxi/payFns');
      if (type === 'payment.failed') { await lt.recordRidePaymentFailure(entity.order_id, entity.id, entity.error_description ?? 'failed'); return { handled: true, detail: 'ride payment failure noted' }; }
      if (type !== 'payment.captured' && type !== 'order.paid') return { handled: false, detail: `ignored ${type}` };
      if (entity.status !== 'captured' || entity.currency !== 'INR' || !Number.isSafeInteger(entity.amount) || entity.amount <= 0) return { handled: false, detail: 'invalid captured payment' };
      if (entity.amount !== ltOrder.data()!.amountPaise) return { handled: false, detail: 'amount mismatch' };
      const r = await lt.recordRidePayment({ rideId: String(ltOrder.data()!.rideId), paymentId: entity.id, orderId: entity.order_id, amountPaise: entity.amount, method: entity.method ?? 'online', source: 'webhook' });
      return { handled: true, detail: r.recorded ? 'ride payment recorded' : 'duplicate' };
    }
    // A dues payment is applied to the ledger debits it was created for (see applyDuesPayment), never as a generic top-up.
    const duePayment = await db.doc(`due_payments/${entity.order_id}`).get();
    if (duePayment.exists) {
      const d = duePayment.data()!;
      if (type !== 'payment.captured' && type !== 'order.paid') return { handled: false, detail: `ignored ${type}` };
      if (entity.status !== 'captured' || entity.currency !== 'INR' || !Number.isSafeInteger(entity.amount) || entity.amount <= 0) return { handled: false, detail: 'invalid captured payment' };
      if (entity.amount !== d.amountPaise) return { handled: false, detail: 'amount mismatch' };
      if (!['vendor', 'driver'].includes(d.partyType) || typeof d.partyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(d.partyId)) return { handled: false, detail: 'invalid dues owner' };
      const { applyDuesPayment } = await import('./partnerOps');
      await applyDuesPayment(duePayment.id, entity.id, d.partyType, d.partyId, entity.amount);
      return { handled: true, detail: 'dues payment reconciled' };
    }
    // A security-deposit top-up is added to the deposit once (see applyDepositTopup), never to the working wallet.
    const depositPayment = await db.doc(`deposit_payments/${entity.order_id}`).get();
    if (depositPayment.exists) {
      const d = depositPayment.data()!;
      if (type !== 'payment.captured' && type !== 'order.paid') return { handled: false, detail: `ignored ${type}` };
      if (entity.status !== 'captured' || entity.currency !== 'INR' || !Number.isSafeInteger(entity.amount) || entity.amount <= 0) return { handled: false, detail: 'invalid captured payment' };
      if (entity.amount !== d.amountPaise) return { handled: false, detail: 'amount mismatch' };
      if (!['vendor', 'driver'].includes(d.partyType) || typeof d.partyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(d.partyId)) return { handled: false, detail: 'invalid deposit owner' };
      const { applyDepositTopup } = await import('./partnerOps');
      const outcome = await applyDepositTopup(depositPayment.id, entity.id, d.partyType, d.partyId);
      return { handled: true, detail: `deposit top-up ${outcome}` };
    }
    const recharge = await db.doc(`wallet_recharges/${entity.order_id}`).get();
    if (!recharge.exists) return { handled: false, detail: 'unknown order' };
    const r = recharge.data()!;
    if (type !== 'payment.captured' && type !== 'order.paid') return { handled: false, detail: `ignored ${type}` };
    if (entity.status !== 'captured' || entity.currency !== 'INR' || !Number.isSafeInteger(entity.amount) || entity.amount <= 0) return { handled: false, detail: 'invalid captured payment' };
    if (entity.amount !== r.amountPaise) return { handled: false, detail: 'amount mismatch' };
    if (!['vendor', 'driver'].includes(r.partyType) || typeof r.partyId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(r.partyId)) return { handled: false, detail: 'invalid wallet owner' };
    const { creditRecharge } = await import('./partnerOps');
    await creditRecharge(recharge.id, entity.id, r.partyType, r.partyId);
    return { handled: true, detail: 'wallet recharge reconciled' };
  }
  const order = orders.docs[0]!;
  const o = order.data();
  const bookingId = String(o.bookingId);
  if (type === 'payment.captured' || (type === 'order.paid' && entity.status === 'captured')) {
    if (entity.status !== 'captured' || entity.currency !== 'INR' || !Number.isSafeInteger(entity.amount) || entity.amount <= 0) return { handled: false, detail: 'invalid captured payment' };
    if (entity.amount !== o.amountPaise) return { handled: false, detail: 'amount mismatch' };
    const r = await recordGatewayReceipt({ bookingId, paymentId: entity.id, orderId: entity.order_id, amountPaise: entity.amount, method: entity.method ?? 'online', source: 'webhook' });
    await order.ref.set({ status: 'paid', paymentId: entity.id, paidAt: FieldValue.serverTimestamp() }, { merge: true });
    await (await import('./reconcile')).reconcileBooking(bookingId);
    return { handled: true, detail: r.recorded ? 'recorded' : 'duplicate' };
  }
  if (type === 'payment.failed') {
    await recordGatewayFailure(bookingId, entity.id, entity.order_id, entity.error_description ?? 'failed');
    return { handled: true, detail: 'failure noted' };
  }
  return { handled: false, detail: `ignored ${type}` };
}

/** Webhook signature: HMAC-SHA256 of the raw body with the webhook secret. */
export function razorpayWebhookValid(raw: Buffer | string, signature: string, secret: string): boolean {
  if (!secret || secret.length < 8 || !signature) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return safeEq(expected, signature);
}

void summarizePayments;
