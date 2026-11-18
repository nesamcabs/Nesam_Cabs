// Razorpay Checkout in the browser: load checkout.js once, open it for an order the server created, and resolve with the result.
// A failed attempt keeps Checkout open (Razorpay lets the rider retry), so it is reported through `onFailedAttempt`, not resolved.
import type { CheckoutLabels, CheckoutSuccess, GatewayOrder } from '@core/services/paymentService';

// Same declaration as the Local Taxi page, so both can see window.Razorpay.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: any) => void) => void } }
}

let loading: Promise<boolean> | null = null;

export function loadCheckout(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (!loading) {
    loading = new Promise<boolean>((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.async = true;
      s.onload = () => resolve(!!window.Razorpay);
      s.onerror = () => { loading = null; resolve(false); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** The brand colour of this site, read from the theme so each brand's Checkout matches it. */
export function brandColor(fallback = '#C8181F'): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function openCheckout(order: GatewayOrder, labels: CheckoutLabels, onFailedAttempt?: (reason: string) => void): Promise<CheckoutSuccess | 'dismissed'> {
  if (!(await loadCheckout()) || !window.Razorpay) throw new Error('The secure payment page could not load. Check your connection and try again.');
  return new Promise((resolve) => {
    const rz = new window.Razorpay!({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: labels.name,
      description: labels.description,
      prefill: labels.prefill ?? {},
      theme: { color: labels.color },
      retry: { enabled: true, max_count: 3 },
      handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
        resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => resolve('dismissed'), confirm_close: true },
    });
    rz.on('payment.failed', (r: { error?: { description?: string } }) => onFailedAttempt?.(r?.error?.description || 'The payment failed. You can try again.'));
    rz.open();
  });
}
