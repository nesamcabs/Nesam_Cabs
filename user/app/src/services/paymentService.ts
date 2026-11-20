// Online payment of a booking (Razorpay). The server decides everything that matters: whether online payment is on, the amount
// (the booking's current balance, derived from its receipts — the app never sends an amount), and whether a payment counts
// (signature + a fetch of the captured payment, or the signed webhook). The app only opens Razorpay Checkout for the order the
// server created and hands the result back to be verified.
import { ActionError, callFunction } from './callables';

/** One thing the rider may choose at checkout. Decided by the office (Service & Fare Settings › Payment options), per pickup district and date. */
export type PayChoiceId = 'later' | 'part' | 'full';
export interface PayChoice {
  id: PayChoiceId;
  /** Share paid now: 0 for pay later, the office's part percentage, 100 for the full amount. */
  percent: number;
  recommended: boolean;
}

export interface PaymentOptions {
  /** Online payment can be offered: keys are configured and the office has it switched on. */
  online: boolean;
  methods: string[];
  /** What to show at checkout, in order. Empty when the server is an older version (the app then falls back to pay later / pay online). */
  choices?: PayChoice[];
}

/** The trip the choices are for: the pickup place (the office can limit an option to some districts) and the pickup time (dates). */
export interface PaymentContext {
  pickup?: { name?: string; address?: string; lat?: number; lng?: number } | null;
  scheduledAt?: Date | null;
}

/** The amount paid now, in whole rupees, rounded up: 25% of ₹6,082 is ₹1,521. The server uses the same rule. */
export function advanceOf(total: number, percent: number): number {
  if (!(total > 0)) return 0;
  return Math.min(Math.round(total), Math.max(1, Math.ceil((total * percent) / 100 - 1e-9)));
}

/** The choices to show. An older server (no list) gets the two it always had; the rider's own pick never survives a list that no longer has it. */
export function checkoutChoices(o: PaymentOptions): PayChoice[] {
  if (o.choices && o.choices.length) return o.choices;
  return o.online
    ? [{ id: 'later', percent: 0, recommended: false }, { id: 'full', percent: 100, recommended: false }]
    : [{ id: 'later', percent: 0, recommended: false }];
}

/** The title, line under it and the amount paid now for one choice, as in the booking screens. */
export function choiceText(c: PayChoice, total: number): { title: string; subtitle: string; amount: number; label: string } {
  if (c.id === 'later') return { title: 'Book Now, Pay Later', subtitle: 'Pay your driver at the end of the trip', amount: 0, label: 'Pay Now' };
  if (c.id === 'part') return { title: `Pay ${c.percent}% Now`, subtitle: `Pay the remaining ${100 - c.percent}% after your trip`, amount: advanceOf(total, c.percent), label: `Pay Now (${c.percent}%)` };
  return { title: 'Pay 100% Now', subtitle: 'Complete your payment securely online', amount: advanceOf(total, 100), label: 'Total Payable' };
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

const optionsCache = new Map<string, { at: number; value: PaymentOptions }>();
const contextKey = (c?: PaymentContext) => JSON.stringify([c?.pickup?.lat ?? null, c?.pickup?.lng ?? null, c?.pickup?.name ?? '', c?.scheduledAt?.toISOString().slice(0, 10) ?? '']);

/**
 * What the rider may choose at checkout. Cached for a minute per pickup and day; any failure reads as "pay later only"
 * (the booking itself never depends on this).
 */
export async function getPaymentOptions(ctx?: PaymentContext, force = false): Promise<PaymentOptions> {
  const key = contextKey(ctx);
  const hit = optionsCache.get(key);
  if (!force && hit && Date.now() - hit.at < 60000) return hit.value;
  try {
    const pickup = ctx?.pickup ? { name: ctx.pickup.name, address: ctx.pickup.address, lat: ctx.pickup.lat, lng: ctx.pickup.lng } : undefined;
    const value = await callFunction<Record<string, unknown>, PaymentOptions>('getPaymentOptions', { ...(pickup ? { pickup } : {}), ...(ctx?.scheduledAt ? { scheduledAt: ctx.scheduledAt.toISOString() } : {}) });
    optionsCache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return { online: false, methods: [] };
  }
}

/** `advance: true` asks for the advance the rider chose at booking ("Pay 25% now"); without it the order is for the whole balance. */
export const createBookingPayment = (bookingId: string, advance = false) =>
  callFunction<{ bookingId: string; advance?: boolean }, GatewayOrder>('createRazorpayOrder', advance ? { bookingId, advance: true } : { bookingId });

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
