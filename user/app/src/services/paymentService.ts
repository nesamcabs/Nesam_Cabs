// Online payment of a booking (Razorpay). The server decides everything that matters: whether online payment is on, the amount
// (the booking's current balance, derived from its receipts — the app never sends an amount), and whether a payment counts
// (signature + a fetch of the captured payment, or the signed webhook). The app only opens Razorpay Checkout for the order the
// server created and hands the result back to be verified.
import { ActionError, callFunction } from './callables';

export interface PaymentOptions {
  /** Online payment can be offered: keys are configured and the office has it switched on. */
  online: boolean;
  methods: string[];
}

export interface GatewayOrder {
  orderId: string;
  /** In paise. */
  amount: number;
  currency: string;
  keyId: string;
}

/** What Razorpay Checkout returns on success. */
export interface CheckoutSuccess {
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface VerifyResult {
  verified: boolean;
  status: 'paid' | 'pending';
  balanceDue?: number;
  message?: string;
  duplicate?: boolean;
}

let optionsCache: { at: number; value: PaymentOptions } | null = null;

/** Whether "Pay online" may be shown. Cached for a minute; any failure reads as "not available" (cash / UPI still work). */
export async function getPaymentOptions(force = false): Promise<PaymentOptions> {
  if (!force && optionsCache && Date.now() - optionsCache.at < 60000) return optionsCache.value;
  try {
    const value = await callFunction<Record<string, never>, PaymentOptions>('getPaymentOptions', {});
    optionsCache = { at: Date.now(), value };
    return value;
  } catch {
    return { online: false, methods: [] };
  }
}

export const createBookingPayment = (bookingId: string) => callFunction<{ bookingId: string }, GatewayOrder>('createRazorpayOrder', { bookingId });

export const verifyBookingPayment = (bookingId: string, r: CheckoutSuccess) =>
  callFunction<Record<string, string>, VerifyResult>('verifyRazorpayPayment', {
    bookingId,
    razorpayOrderId: r.orderId,
    razorpayPaymentId: r.paymentId,
    razorpaySignature: r.signature,
  });

/** A payment error in words a rider can act on. */
export function paymentErrorText(err: unknown): string {
  const message = err instanceof ActionError || err instanceof Error ? err.message : '';
  if (/PAYMENT_NOT_CONFIGURED/.test(message)) return 'Online payment is not available yet. Please pay your driver by cash or UPI.';
  if (/ONLINE_PAYMENTS_OFF/.test(message)) return 'Online payment is switched off right now. Please pay your driver by cash or UPI.';
  return message || 'The payment could not be completed. You have not been charged; please try again.';
}

export interface CheckoutLabels {
  name: string;
  description: string;
  /** Brand colour of the Checkout header, e.g. "#C8181F". */
  color: string;
  prefill?: { name?: string; contact?: string; email?: string };
}

/**
 * A tiny page that opens Razorpay Checkout for one order and posts the outcome to its host: { ok, orderId, paymentId, signature },
 * { dismissed: true } or { failed: true, reason }. A WebView receives it through ReactNativeWebView.postMessage; an iframe host
 * injects a shim that forwards it with parent.postMessage. Every value is JSON-encoded, so nothing in a name can break the page.
 */
export function checkoutHtml(o: GatewayOrder, l: CheckoutLabels): string {
  const options = {
    key: o.keyId,
    amount: o.amount,
    currency: o.currency,
    order_id: o.orderId,
    name: l.name,
    description: l.description,
    prefill: l.prefill ?? {},
    theme: { color: l.color },
    retry: { enabled: true, max_count: 3 },
  };
  const json = JSON.stringify(options).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#fff;font-family:-apple-system,Roboto,Arial,sans-serif}#w{display:flex;height:100%;align-items:center;justify-content:center;color:#555;font-size:14px}</style></head>
<body><div id="w">Opening secure payment…</div>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>
var post=function(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}};
if(!window.Razorpay){post({failed:true,reason:'Could not load the payment page. Check your connection and try again.'})}else{
var o=${json};
o.handler=function(r){post({ok:true,orderId:r.razorpay_order_id,paymentId:r.razorpay_payment_id,signature:r.razorpay_signature})};
o.modal={ondismiss:function(){post({dismissed:true})},confirm_close:true};
var rz=new Razorpay(o);
rz.on('payment.failed',function(r){post({failed:true,reason:(r&&r.error&&r.error.description)||'The payment failed.'})});
rz.open();}
</script></body></html>`;
}

export type CheckoutMessage = { ok: true; orderId: string; paymentId: string; signature: string } | { dismissed: true } | { failed: true; reason: string };

/** Parses a message from the checkout page; anything malformed reads as null and is ignored. */
export function parseCheckoutMessage(raw: unknown): CheckoutMessage | null {
  try {
    const m = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return null;
    if (m.ok === true && typeof m.orderId === 'string' && typeof m.paymentId === 'string' && typeof m.signature === 'string') return { ok: true, orderId: m.orderId, paymentId: m.paymentId, signature: m.signature };
    if (m.dismissed === true) return { dismissed: true };
    if (m.failed === true) return { failed: true, reason: typeof m.reason === 'string' ? m.reason.slice(0, 200) : 'The payment failed.' };
    return null;
  } catch {
    return null;
  }
}
