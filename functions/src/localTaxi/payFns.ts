// Local Taxi online payment (Razorpay), reusing the platform's existing keys, signature check and provider fetch.
// Payment status is kept apart from ride status: a ride is `completed` whether or not it is paid yet. Money is
// recognised only after the server (a) verifies the checkout signature and fetches the payment from the provider, or
// (b) receives a signed webhook (handled in payments.ts → recordRidePayment). The amount is read from the ride on the
// server; a client-supplied amount is never used. Receipts are idempotent on the provider payment id.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData } from 'firebase-admin/firestore';
import { createHmac } from 'crypto';
import Razorpay from 'razorpay';
import { db } from '../admin';
import { auditInTx } from '../audit';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, configured, safeEq } from '../payments';
import { COL, cleanId } from './model';
import { rideEventTx, rideRef } from './dispatch';

/** What the customer owes on a ride right now, in paise (0 when nothing is due). */
export function amountDuePaise(ride: DocumentData): number {
  if (ride.status === 'completed' && ['payment_due'].includes(ride.paymentStatus)) return Number(ride.final?.totalPaise ?? 0);
  if (ride.status === 'cancelled' && ride.paymentStatus === 'cancellation_fee_due') return Number(ride.cancellationFeePaise ?? 0);
  return 0;
}

export const ltCreatePaymentOrder = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const keyId = RAZORPAY_KEY_ID.value();
  const keySecret = RAZORPAY_KEY_SECRET.value();
  if (!configured(keyId, keySecret)) throw new HttpsError('failed-precondition', 'PAYMENT_NOT_CONFIGURED');
  const rideId = cleanId(request.data?.rideId, 'ride');
  const ride = (await rideRef(rideId).get()).data();
  if (!ride || ride.customerId !== uid) throw new HttpsError('not-found', 'This ride does not exist.');
  if (ride.paymentMethod !== 'online' && ride.status !== 'cancelled') throw new HttpsError('failed-precondition', 'This ride is paid in cash.');
  const amountPaise = amountDuePaise(ride);
  if (amountPaise < 100) throw new HttpsError('failed-precondition', ride.paymentStatus === 'paid' ? 'This ride is already paid.' : 'There is nothing to pay on this ride.');
  // Reuse the open order for the same amount so a double tap never creates two charges.
  if (ride.openOrderId) {
    const open = await db.doc(`${COL.paymentOrders}/${ride.openOrderId}`).get();
    if (open.exists && open.data()!.status === 'created' && open.data()!.amountPaise === amountPaise) return { orderId: open.id, amount: amountPaise, currency: 'INR', keyId, reused: true };
  }
  const order = await new Razorpay({ key_id: keyId, key_secret: keySecret }).orders.create({ amount: amountPaise, currency: 'INR', receipt: `lt_${rideId}`.slice(0, 40), notes: { rideId, customerId: uid, module: 'local_taxi' } });
  await db.doc(`${COL.paymentOrders}/${order.id}`).set({ orderId: order.id, rideId, customerId: uid, amountPaise, currency: 'INR', status: 'created', createdAt: FieldValue.serverTimestamp() });
  await rideRef(rideId).update({ openOrderId: order.id, updatedAt: FieldValue.serverTimestamp() });
  return { orderId: order.id, amount: order.amount, currency: order.currency, keyId };
});

export interface RidePaymentReceipt { rideId: string; paymentId: string; orderId: string; amountPaise: number; method: string; source: 'checkout' | 'webhook' }

/** Records a CAPTURED payment for a ride. Idempotent: the payment document id is the provider payment id. */
export async function recordRidePayment(r: RidePaymentReceipt): Promise<{ recorded: boolean }> {
  const payId = `rzp_${r.paymentId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)}`;
  return db.runTransaction(async (tx) => {
    const [rs, ps, os] = await Promise.all([tx.get(rideRef(r.rideId)), tx.get(db.doc(`${COL.payments}/${payId}`)), tx.get(db.doc(`${COL.paymentOrders}/${r.orderId}`))]);
    const ride = rs.data();
    if (!ride) throw new HttpsError('not-found', 'Ride not found.');
    if (ps.exists) return { recorded: false };
    if (!os.exists || os.data()!.rideId !== r.rideId || os.data()!.amountPaise !== r.amountPaise) throw new HttpsError('failed-precondition', 'The paid amount does not match this ride.');
    const due = amountDuePaise(ride);
    if (due !== r.amountPaise) throw new HttpsError('failed-precondition', 'The paid amount does not match what is due on this ride.');
    const now = Date.now();
    tx.create(ps.ref, { rideId: r.rideId, customerId: ride.customerId, method: 'online', provider: 'razorpay', providerPaymentId: r.paymentId, orderId: r.orderId, amountPaise: r.amountPaise, currency: 'INR', status: 'captured', source: r.source, instrument: r.method, createdAtMs: now, createdAt: FieldValue.serverTimestamp() });
    tx.update(rs.ref, { paymentStatus: 'paid', paidAtMs: now, openOrderId: '', updatedAt: FieldValue.serverTimestamp() });
    tx.update(os.ref, { status: 'paid', paymentId: r.paymentId, paidAtMs: now });
    tx.set(db.doc(`${COL.settlements}/${r.rideId}`), { status: 'online_paid', onlinePaidPaise: r.amountPaise, paidAtMs: now }, { merge: true });
    rideEventTx(tx, r.rideId, { type: 'payment', actorId: 'razorpay', actorRole: 'system', meta: { method: 'online', amountPaise: r.amountPaise, source: r.source } });
    auditInTx(tx, { action: 'lt_payment_recorded', entity: 'lt_payment', entityId: payId, performedBy: 'razorpay', role: 'system', bookingId: r.rideId, next: { amountPaise: r.amountPaise, source: r.source } });
    return { recorded: true };
  });
}

export async function recordRidePaymentFailure(orderId: string, paymentId: string, reason: string) {
  const o = await db.doc(`${COL.paymentOrders}/${orderId}`).get();
  if (!o.exists) return;
  await o.ref.set({ lastPaymentId: paymentId, lastFailure: String(reason).slice(0, 200), failedAt: FieldValue.serverTimestamp() }, { merge: true });
  await rideRef(String(o.data()!.rideId)).set({ paymentFailure: { reason: String(reason).slice(0, 200), atMs: Date.now() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Verifies a checkout result: signature + the provider's own record (captured, same order, exact amount). */
export const ltVerifyPayment = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const keyId = RAZORPAY_KEY_ID.value();
  const keySecret = RAZORPAY_KEY_SECRET.value();
  if (!configured(keyId, keySecret)) throw new HttpsError('failed-precondition', 'PAYMENT_NOT_CONFIGURED');
  const { rideId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = (request.data ?? {}) as Record<string, string | undefined>;
  if (!rideId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) throw new HttpsError('invalid-argument', 'Missing payment verification fields.');
  const [ride, order] = await Promise.all([rideRef(cleanId(rideId, 'ride')).get(), db.doc(`${COL.paymentOrders}/${cleanId(razorpayOrderId, 'order')}`).get()]);
  if (!ride.exists || ride.data()!.customerId !== uid) throw new HttpsError('not-found', 'This ride does not exist.');
  if (!order.exists || order.data()!.rideId !== rideId) throw new HttpsError('failed-precondition', 'The order does not match this ride.');
  const expected = createHmac('sha256', keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
  if (!safeEq(expected, razorpaySignature)) throw new HttpsError('invalid-argument', 'Payment signature verification failed.');
  const p = (await (new Razorpay({ key_id: keyId, key_secret: keySecret }) as any).payments.fetch(razorpayPaymentId)) as unknown as { id: string; order_id: string; status: string; amount: number; currency: string; method?: string };
  if (p.order_id !== razorpayOrderId) throw new HttpsError('failed-precondition', 'The payment does not belong to this order.');
  if (p.status === 'failed') {
    await recordRidePaymentFailure(razorpayOrderId, p.id, 'failed');
    throw new HttpsError('failed-precondition', 'The payment failed. You have not been charged; please try again.');
  }
  if (p.status !== 'captured') return { verified: true, status: 'pending', message: 'Your payment is being confirmed.' };
  if (p.amount !== order.data()!.amountPaise || p.currency !== 'INR') throw new HttpsError('failed-precondition', 'The paid amount does not match the order.');
  const r = await recordRidePayment({ rideId, paymentId: p.id, orderId: razorpayOrderId, amountPaise: p.amount, method: p.method ?? 'online', source: 'checkout' });
  return { verified: true, status: 'paid', duplicate: !r.recorded };
});
