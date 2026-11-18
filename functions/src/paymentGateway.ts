// Payment gateway (Razorpay) controls around the checkout in payments.ts:
//   getPaymentOptions        any signed-in user: may this app offer "Pay online" right now?
//   getPaymentGatewayStatus  finance staff: are the keys and the webhook configured, test or live mode, is online payment on?
//   setOnlinePayments        finance staff (Accounts › approve): the office's on/off switch for customer online payments.
//   refundGatewayPayment     finance staff (Accounts › approve): send a booking's pending refund back to the customer's original
//                            online payment through Razorpay, then complete it through updateRefund (the same state machine,
//                            audit trail and customer notice as a manual refund).
// Secrets never leave the server: the status reports only whether a key is set and its mode, never the key itself.
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import Razorpay from 'razorpay';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { audit } from './audit';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, configured } from './payments';
import { txnsRef } from './bookingPayments';
import { requireAction, requirePermission } from './shared';
import { docId } from './marketplace';

const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');
const SETTINGS = 'settings/payments';

/** Reads a secret without throwing when it was never bound or set (the HTTP API reads process.env instead). */
function secretValue(s: { value(): string }, envName: string): string {
  try {
    const v = s.value();
    if (v) return v;
  } catch {
    /* not bound in this runtime */
  }
  return (process.env[envName] ?? '').trim();
}

export function gatewayMode(keyId: string): 'live' | 'test' | 'unset' {
  if (!configured(keyId)) return 'unset';
  if (keyId.startsWith('rzp_live_')) return 'live';
  if (keyId.startsWith('rzp_test_')) return 'test';
  return 'live';
}

/** "rzp_live_…a1B2": enough to tell keys apart in the panel, never the whole id. */
export function maskKeyId(keyId: string): string {
  if (!configured(keyId)) return '';
  const prefix = /^rzp_(live|test)_/.exec(keyId)?.[0] ?? '';
  return `${prefix}…${keyId.slice(-4)}`;
}

async function onlineEnabled(): Promise<boolean> {
  const s = (await db.doc(SETTINGS).get()).data();
  return s?.onlineEnabled !== false;
}

/** Whether "Pay online" may be offered: the keys are set and the office has not switched online payment off. */
export const getPaymentOptions = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const keys = configured(secretValue(RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID'), secretValue(RAZORPAY_KEY_SECRET, 'RAZORPAY_KEY_SECRET'));
  const enabled = await onlineEnabled();
  return { online: keys && enabled, provider: 'razorpay', methods: ['UPI', 'Card', 'Net banking', 'Wallet'] };
});

export const getPaymentGatewayStatus = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET] }, async (request) => {
  await requirePermission(request.auth, 'finance');
  const keyId = secretValue(RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID');
  const keySecret = secretValue(RAZORPAY_KEY_SECRET, 'RAZORPAY_KEY_SECRET');
  const webhook = secretValue(RAZORPAY_WEBHOOK_SECRET, 'RAZORPAY_WEBHOOK_SECRET');
  const s = (await db.doc(SETTINGS).get()).data() ?? {};
  return {
    keyConfigured: configured(keyId, keySecret),
    mode: gatewayMode(keyId),
    keyIdHint: maskKeyId(keyId),
    webhookConfigured: configured(webhook) && webhook.length >= 8,
    onlineEnabled: s.onlineEnabled !== false,
    updatedByName: typeof s.updatedByName === 'string' ? s.updatedByName : '',
    updatedAt: s.updatedAt instanceof Timestamp ? s.updatedAt.toDate().toISOString() : null,
  };
});

export const setOnlinePayments = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'finance');
  requireAction(admin, 'Accounts', 'approve');
  const on = (request.data ?? {}).enabled;
  if (typeof on !== 'boolean') throw new HttpsError('invalid-argument', 'enabled must be true or false.');
  const before = (await db.doc(SETTINGS).get()).data()?.onlineEnabled !== false;
  await db.doc(SETTINGS).set({ onlineEnabled: on, updatedBy: admin.uid, updatedByName: admin.name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await audit({ action: on ? 'online_payments_enabled' : 'online_payments_disabled', entity: 'settings', entityId: 'payments', performedBy: admin.uid, performedByName: admin.name, role: 'admin', previous: { onlineEnabled: before }, next: { onlineEnabled: on } });
  return { onlineEnabled: on };
});

// ── Gateway refunds ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ProviderRefund { id: string; status: string; amount: number; payment_id?: string }
type RefundPayment = (paymentId: string, amountPaise: number, notes: Record<string, string>, keyId: string, keySecret: string) => Promise<ProviderRefund>;
const defaultRefund: RefundPayment = async (paymentId, amountPaise, notes, keyId, keySecret) => {
  const rp = new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as { payments: { refund(id: string, body: Record<string, unknown>): Promise<ProviderRefund> } };
  return rp.payments.refund(paymentId, { amount: amountPaise, speed: 'normal', notes });
};
let refundImpl: RefundPayment = defaultRefund;
/** Test hook. */
export function setGatewayRefunder(fn: RefundPayment | null): void {
  refundImpl = fn ?? defaultRefund;
}

export interface GatewayPaid { paymentId: string; paidPaise: number; refundedPaise: number }

/**
 * Splits a refund over the booking's online payments, newest first, never more than what is left on each payment.
 * Returns null when the online payments cannot cover the whole amount (the rest was paid by cash / UPI to a person).
 */
export function planGatewayRefund(payments: GatewayPaid[], amountPaise: number): { paymentId: string; amountPaise: number }[] | null {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) return null;
  let left = amountPaise;
  const out: { paymentId: string; amountPaise: number }[] = [];
  for (const p of payments) {
    const room = Math.max(0, p.paidPaise - p.refundedPaise);
    if (room <= 0 || left <= 0) continue;
    const take = Math.min(room, left);
    out.push({ paymentId: p.paymentId, amountPaise: take });
    left -= take;
  }
  return left === 0 ? out : null;
}

const LOCK_MS = 5 * 60 * 1000;

export const refundGatewayPayment = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET], timeoutSeconds: 60 }, async (request: CallableRequest) => {
  const admin = await requirePermission(request.auth, 'finance');
  requireAction(admin, 'Accounts', 'approve');
  const keyId = secretValue(RAZORPAY_KEY_ID, 'RAZORPAY_KEY_ID');
  const keySecret = secretValue(RAZORPAY_KEY_SECRET, 'RAZORPAY_KEY_SECRET');
  if (!configured(keyId, keySecret)) throw new HttpsError('failed-precondition', 'PAYMENT_NOT_CONFIGURED');
  const bookingId = docId((request.data ?? {}).bookingId, 'booking');
  const ref = db.doc(`bookings/${bookingId}`);

  // Take the lock: one gateway refund at a time per booking, so a double click can never refund twice.
  const { amountPaise, plan } = await db.runTransaction(async (tx) => {
    const [snap, txns, done] = await Promise.all([tx.get(ref), tx.get(txnsRef(bookingId)), tx.get(ref.collection('gateway_refunds'))]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const r = snap.data()!.refund;
    if (!r || !['Pending', 'Processing', 'Failed'].includes(r.status)) throw new HttpsError('failed-precondition', 'This booking has no refund waiting to be paid.');
    const lock = snap.data()!.gatewayRefundLock as { at?: Timestamp } | undefined;
    if (lock?.at && Date.now() - lock.at.toMillis() < LOCK_MS) throw new HttpsError('aborted', 'A refund for this booking is already being sent. Please wait a minute and refresh.');
    const refundedBy = new Map<string, number>();
    for (const d of done.docs) {
      const g = d.data();
      if (g.status !== 'failed') refundedBy.set(g.paymentId, (refundedBy.get(g.paymentId) ?? 0) + Number(g.amountPaise || 0));
    }
    const paid: GatewayPaid[] = txns.docs
      .map((d) => d.data())
      .filter((t) => t.method === 'Gateway' && t.status === 'Success' && typeof t.provider?.paymentId === 'string')
      .sort((a, b) => (b.paymentDate?.toMillis?.() ?? 0) - (a.paymentDate?.toMillis?.() ?? 0))
      .map((t) => ({ paymentId: String(t.provider.paymentId), paidPaise: Math.round(Number(t.amount) * 100), refundedPaise: refundedBy.get(String(t.provider.paymentId)) ?? 0 }));
    const want = Math.round(Number(r.amount) * 100);
    const onlineLeft = paid.reduce((s, p) => s + Math.max(0, p.paidPaise - p.refundedPaise), 0);
    if (!paid.length) throw new HttpsError('failed-precondition', 'This booking was not paid online. Refund it by cash, UPI or bank transfer and record it with the reference.');
    const split = planGatewayRefund(paid, want);
    if (!split) throw new HttpsError('failed-precondition', `Only ₹${(onlineLeft / 100).toLocaleString('en-IN')} was paid online. Refund the rest by cash, UPI or bank transfer and record it manually.`);
    tx.update(ref, { gatewayRefundLock: { by: admin.uid, at: Timestamp.now() } });
    return { amountPaise: want, plan: split };
  });

  const made: ProviderRefund[] = [];
  try {
    for (const step of plan) {
      const rf = await refundImpl(step.paymentId, step.amountPaise, { bookingId, refundedBy: admin.uid }, keyId, keySecret);
      made.push(rf);
      await ref.collection('gateway_refunds').doc(rf.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || `rf_${Date.now()}`).set({
        refundId: rf.id, paymentId: step.paymentId, amountPaise: step.amountPaise, status: rf.status || 'pending', by: admin.uid, byName: admin.name, createdAt: FieldValue.serverTimestamp(),
      });
    }
  } catch (err) {
    await ref.update({ gatewayRefundLock: FieldValue.delete() });
    const detail = (err as { error?: { description?: string } })?.error?.description ?? (err as Error)?.message ?? 'unknown error';
    await audit({ action: 'gateway_refund_failed', entity: 'refund', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, next: { detail, sent: made.map((m) => m.id) } });
    if (made.length) throw new HttpsError('internal', `Part of the refund was sent (${made.map((m) => m.id).join(', ')}), then Razorpay refused the rest: ${detail}. Do not retry; contact support with these references.`);
    throw new HttpsError('failed-precondition', `Razorpay could not send the refund: ${detail}`);
  }

  // The money has left: complete the refund through the normal path (status, history, audit, customer notice).
  const { updateRefund } = await import('./bookingOps');
  try {
    await (updateRefund as unknown as { run(r: unknown): Promise<unknown> }).run({
      data: { bookingId, status: 'Completed', method: 'Razorpay', reference: made.map((m) => m.id).join(' ').slice(0, 120), note: 'Refunded to the original online payment through Razorpay.' },
      auth: request.auth,
      rawRequest: request.rawRequest,
    });
  } finally {
    await ref.update({ gatewayRefundLock: FieldValue.delete() });
  }
  return { refunded: true, amount: amountPaise / 100, refunds: made.map((m) => ({ id: m.id, status: m.status, amount: m.amount / 100 })) };
});
