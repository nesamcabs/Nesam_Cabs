import type { TripRecord } from '@core/types';
import { COMPANY_NAME, COMPANY_UPI_ID } from '@core/config/constants';

/** What the trip costs in total: the stored fare plus tolls the driver paid on the way. */
export function payableAmount(trip: TripRecord): number {
  return Math.round((trip.fareBreakdown?.total ?? trip.fare) + trip.tollCharges + (trip.extraCharges ?? 0));
}

/** What is still owed: the server's balance once payments are recorded, else the full amount. */
export function amountDue(trip: TripRecord): number {
  return trip.paid ? Math.max(0, Math.round(trip.paid.balanceDue)) : payableAmount(trip);
}

export function isPaid(trip: TripRecord): boolean {
  return trip.paymentStatus === 'Paid' || (trip.paid !== null && trip.paid.totalPaid > 0 && amountDue(trip) === 0);
}

/** UPI deep link; only offered when NESAM has configured its UPI id. */
export function upiLink(trip: TripRecord): string | null {
  if (!COMPANY_UPI_ID) return null;
  const params = [
    ['pa', COMPANY_UPI_ID],
    ['pn', COMPANY_NAME],
    ['am', amountDue(trip).toFixed(2)],
    ['cu', 'INR'],
    ['tn', `Ride ${trip.bookingId}`],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
  return `upi://pay?${params}`;
}
