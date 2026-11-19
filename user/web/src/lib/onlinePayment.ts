// Online payment of a booking (Razorpay) for this website: whether "Pay online" may be offered, and one function that runs the whole payment —
// the server creates the order for the booking's CURRENT balance (the browser never sends an amount), Razorpay Checkout opens, and the result
// is handed back to the server to be verified (signature + a fetch of the captured payment). Nothing here ever reports money as received
// on its own: only the server's verification does. It never throws; every outcome is a result the page can show in words.
import { useEffect, useState } from 'react';
import type { TripRecord } from '@core/types';
import { formatINR } from '@core/utils/format';
import { createBookingPayment, getPaymentOptions, paymentErrorText, verifyBookingPayment, type CheckoutLabels } from '@core/services/paymentService';
import { brandColor, openCheckout } from './razorpayCheckout';

const BRAND_NAME = 'NESAM Cabs';

export type OnlinePaymentResult = { status: 'paid' | 'pending' | 'dismissed' | 'error'; message: string };

/** Whether "Pay online" can be shown: the rider is signed in, the keys are set and the office has online payment switched on. */
export function useOnlinePaymentAvailable(signedIn: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!signedIn) { setOn(false); return undefined; }
    let alive = true;
    void getPaymentOptions().then((o) => { if (alive) setOn(o.online); });
    return () => { alive = false; };
  }, [signedIn]);
  return on;
}

/** What is still owed: the server's balance once payments are recorded, else the full fare with tolls and approved extras. */
export function bookingAmountDue(trip: Pick<TripRecord, 'paid' | 'fareBreakdown' | 'fare' | 'tollCharges' | 'extraCharges'>): number {
  return trip.paid ? Math.max(0, Math.round(trip.paid.balanceDue)) : Math.round((trip.fareBreakdown?.total ?? trip.fare) + (trip.tollCharges ?? 0) + (trip.extraCharges ?? 0));
}

export async function payBookingOnline(
  bookingId: string,
  description: string,
  prefill?: CheckoutLabels['prefill'],
  onFailedAttempt?: (reason: string) => void,
): Promise<OnlinePaymentResult> {
  let checkout;
  try {
    const order = await createBookingPayment(bookingId);
    checkout = await openCheckout(order, { name: BRAND_NAME, description, color: brandColor(), prefill }, onFailedAttempt);
  } catch (e) {
    return { status: 'error', message: paymentErrorText(e) };
  }
  if (checkout === 'dismissed') return { status: 'dismissed', message: 'Payment not completed. You have not been charged. You can pay online from your booking, or pay your driver.' };
  try {
    const v = await verifyBookingPayment(bookingId, checkout);
    if (v.status === 'paid') return { status: 'paid', message: v.balanceDue && v.balanceDue > 0 ? `Payment received. Balance ${formatINR(v.balanceDue)}.` : 'Payment received. Thank you!' };
    return { status: 'pending', message: v.message || 'Your payment is being confirmed. It will show on the booking shortly.' };
  } catch {
    // Money may already have been taken: never tell the rider they were not charged here, and never ask them to pay twice.
    return { status: 'pending', message: 'We could not confirm your payment yet. If money was deducted it will show on your booking shortly, so please do not pay again.' };
  }
}
