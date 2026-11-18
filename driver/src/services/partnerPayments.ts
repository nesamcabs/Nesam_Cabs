// Online payments a driver makes to NESAM (Razorpay): outstanding dues (cash fares collected and penalties that the trip earnings
// did not cover) and the refundable security deposit. The server decides the dues amount from confirmed ledger debits, creates
// the order, and changes nothing until it has verified the captured payment (functions/src/partnerOps.ts). The app only opens
// Razorpay Checkout for that order and hands the result back. A driver employed by a fleet settles through the fleet instead.
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../config/firebase';
import { ActionError, callFunction } from './callables';

export interface PartnerOrder { orderId: string; amount: number; currency: string; keyId: string; name: string; phone: string }
export interface DuesItem { label: string; amount: number }
export interface DuesSummary { payable: number; items: DuesItem[] }
export interface DuesOrder extends PartnerOrder { payable: number; items: DuesItem[] }
export interface DuesOutcome { status: 'applied' | 'partly_applied' | 'held' | 'pending'; captured?: number; applied?: number; held?: number; message?: string }
export interface DepositOutcome { status: 'credited' | 'held' | 'pending'; amount?: number; message?: string }
export interface DepositState { amount: number; status: string }

export const DEPOSIT_TOPUP_MIN = 100;
export const DEPOSIT_TOPUP_MAX = 100000;

export const getDuesSummary = () => callFunction<Record<string, never>, DuesSummary>('getDuesSummary', {});
export const createDuesPayment = () => callFunction<Record<string, never>, DuesOrder>('createDuesPayment', {});
export const verifyDuesPayment = (orderId: string, paymentId: string, signature: string) =>
  callFunction<Record<string, string>, DuesOutcome>('verifyDuesPayment', { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature });
export const createDepositPayment = (amount: number) => callFunction<{ amount: number }, PartnerOrder>('createDepositPayment', { amount });
export const verifyDepositPayment = (orderId: string, paymentId: string, signature: string) =>
  callFunction<Record<string, string>, DepositOutcome>('verifyDepositPayment', { razorpayOrderId: orderId, razorpayPaymentId: paymentId, razorpaySignature: signature });

/** The driver's own deposit record (partner_deposits/driver_{uid}); absent means "Not paid". */
export function watchDeposit(uid: string, onChange: (d: DepositState) => void, onError?: () => void): () => void {
  return onSnapshot(
    doc(db, 'partner_deposits', `driver_${uid}`),
    (s) => {
      const d = s.data();
      onChange({ amount: typeof d?.amount === 'number' && Number.isFinite(d.amount) ? d.amount : 0, status: typeof d?.status === 'string' ? d.status : 'Not paid' });
    },
    () => onError?.(),
  );
}

/** A payment error in words a driver can act on. */
export function partnerPaymentError(err: unknown): string {
  const message = err instanceof ActionError || err instanceof Error ? err.message : '';
  if (/PAYMENT_NOT_CONFIGURED/.test(message)) return 'Online payment is not switched on yet. Contact the NESAM office to pay.';
  return message || 'The payment could not be completed. You have not been charged; please try again.';
}

/** Never says "paid" unless an amount was actually applied to the dues. */
export function duesOutcomeText(v: DuesOutcome, inr: (n: number) => string): string {
  const applied = v.applied ?? 0;
  const captured = v.captured ?? 0;
  const held = v.held ?? 0;
  if (v.status === 'applied' && applied > 0) return `${inr(applied)} paid. Your dues have been updated.`;
  if (v.status === 'partly_applied' && applied > 0) return `${inr(applied)} of your ${inr(captured)} payment was applied to your dues. ${inr(held)} is held by NESAM for review.`;
  if (v.status === 'held' || (v.status === 'applied' && applied <= 0)) return `Your payment of ${inr(captured || held)} was received, but your dues changed while you were paying, so NESAM will review and apply it.`;
  return v.message || 'Your payment is being confirmed. Your dues update shortly.';
}

/** Razorpay Checkout for one order, posting { ok … } / { dismissed } / { failed } to its host (WebView or iframe shim). */
export function partnerCheckoutHtml(o: PartnerOrder, description: string): string {
  const options = {
    key: o.keyId,
    amount: o.amount,
    currency: o.currency,
    order_id: o.orderId,
    name: 'NESAM Tours & Travels',
    description,
    prefill: { name: o.name || undefined, contact: o.phone || undefined },
    theme: { color: '#CF0035' },
    retry: { enabled: true, max_count: 3 },
  };
  const json = JSON.stringify(options).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#fff;font-family:-apple-system,Roboto,Arial,sans-serif}#w{display:flex;height:100%;align-items:center;justify-content:center;color:#555;font-size:14px}</style></head>
<body><div id="w">Opening secure payment…</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
var post=function(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}};
if(!window.Razorpay){post({failed:true,fatal:true,reason:'Could not load the payment page. Check your connection and try again.'})}else{
var o=${json};
o.handler=function(r){post({ok:true,orderId:r.razorpay_order_id,paymentId:r.razorpay_payment_id,signature:r.razorpay_signature})};
o.modal={ondismiss:function(){post({dismissed:true})},confirm_close:true};
var rz=new Razorpay(o);
rz.on('payment.failed',function(r){post({failed:true,reason:(r&&r.error&&r.error.description)||'The payment failed.'})});
rz.open();}
</script></body></html>`;
}

export type CheckoutMessage = { ok: true; orderId: string; paymentId: string; signature: string } | { dismissed: true } | { failed: true; reason: string; fatal: boolean };

export function parseCheckoutMessage(raw: unknown): CheckoutMessage | null {
  try {
    const m = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return null;
    if (m.ok === true && typeof m.orderId === 'string' && typeof m.paymentId === 'string' && typeof m.signature === 'string') return { ok: true, orderId: m.orderId, paymentId: m.paymentId, signature: m.signature };
    if (m.dismissed === true) return { dismissed: true };
    if (m.failed === true) return { failed: true, fatal: m.fatal === true, reason: typeof m.reason === 'string' ? m.reason.slice(0, 200) : 'The payment failed.' };
    return null;
  } catch {
    return null;
  }
}
