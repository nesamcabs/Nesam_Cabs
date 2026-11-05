/**
 * Trip actions. Each is a server function that validates the step order, stamps
 * the time, records where it happened and ignores a repeated tap. The app never
 * writes a trip's status or step itself.
 */
import { callFunction, newId } from './callables';
import { getFirebaseLocation, type Fix } from './location';

export type TripStep = 'En Route to Pickup' | 'Reached Pickup' | 'Trip Started' | 'Trip Ended';

export interface TollIn {
  id: string;
  name: string;
  amount: number;
  receiptPhotoUrl: string;
  uploadedAt: string;
}

/** One idempotency key per button press attempt: a retry or double tap changes nothing the second time. */
export const newRequestId = () => newId('trip');

export async function advanceTrip(args: { bookingId: string; to: TripStep; location?: Fix | null; endOdometer?: number; totalKm?: number; tolls?: TollIn[]; requestId: string }) {
  return callFunction<unknown, { ok: boolean; duplicate: boolean; stage: TripStep }>('advanceTrip', {
    bookingId: args.bookingId, to: args.to, location: args.location ?? undefined, platform: 'web', requestId: args.requestId,
    ...(args.endOdometer !== undefined ? { endOdometer: args.endOdometer } : {}),
    ...(args.totalKm !== undefined ? { totalKm: args.totalKm } : {}),
    ...(args.tolls ? { tolls: args.tolls } : {}),
  });
}

/**
 * The customer's number for the call button. The server releases it only to the booking's current
 * assigned driver from 8 hours before pickup, and logs every request. Raw numbers are never stored.
 */
export const revealCustomerContact = (bookingId: string) =>
  callFunction<unknown, { phone: string; name: string }>('getCustomerContact', { bookingId, platform: 'web' });

export const verifyBoarding = (bookingId: string, otp: string) => callFunction<unknown, { ok: boolean }>('verifyBoarding', { bookingId, otp });

export interface CollectionInput {
  bookingId: string;
  amount: number;
  method: 'Cash' | 'UPI' | 'Bank Transfer';
  reference: string;
  notes?: string;
  requestId: string;
}

/** The driver records money collected from the customer; it is saved as a payment against them. */
export const recordCollection = (i: CollectionInput) =>
  callFunction<unknown, { id: string; duplicate: boolean }>('recordPayment', {
    bookingId: i.bookingId, amount: i.amount, method: i.method, reference: i.reference, notes: i.notes ?? '', requestId: i.requestId, collectorType: 'driver',
  });

export const acknowledgePenalty = (penaltyId: string) => callFunction<unknown, { ok: boolean }>('acknowledgePenalty', { penaltyId, confirmed: true });
export const disputePenalty = (penaltyId: string, note: string) => callFunction<unknown, { ok: boolean }>('disputePenalty', { penaltyId, note });

export { getFirebaseLocation };
