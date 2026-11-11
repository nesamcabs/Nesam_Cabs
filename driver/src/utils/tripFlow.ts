import type { TripSubStatus } from '../types/driver';

/** The driver's steps, in order: Reached Pickup Location → Trip Started → Trip Ended. */
export const TRIP_STEPS: TripSubStatus[] = ['Reached Pickup', 'Trip Started', 'Trip Ended'];
export const TRIP_STEP_LABELS = ['Reached Pickup', 'Trip Started', 'Trip End'];

/**
 * The driver's step on a trip. The server (functions/src/domain/bookingFlow.ts)
 * is authoritative and re-checks every step; this only reads what it stored.
 * Older trips without a sub-status map from their legacy stage, and a trip
 * recorded under the earlier order ("Trip Started" while driving to the
 * pickup, stage En Route Pickup) has not reached the pickup yet.
 */
export function tripSubStatusOf(b: { tripSubStatus?: unknown; tripStage?: unknown; status?: unknown }): TripSubStatus {
  const v = String(b.tripSubStatus ?? '');
  if (v === 'Trip Started' && b.tripStage === 'En Route Pickup') return 'Not Started';
  if (v === 'Not Started' || v === 'Reached Pickup' || v === 'Trip Started' || v === 'Trip Ended') return v;
  if (b.status === 'Completed') return 'Trip Ended';
  switch (b.tripStage) {
    case 'Reached Pickup':
      return 'Reached Pickup';
    case 'In Progress':
    case 'Arrived Destination':
      return 'Trip Started';
    case 'Completed':
      return 'Trip Ended';
    default:
      return 'Not Started';
  }
}

/** The step the driver can take next, or null when the trip has ended. */
export function nextStep(current: TripSubStatus): TripSubStatus | null {
  if (current === 'Not Started') return 'Reached Pickup';
  if (current === 'Reached Pickup') return 'Trip Started';
  if (current === 'Trip Started') return 'Trip Ended';
  return null;
}

/** What still stands between the driver and "Trip Started" (both are checked again by the server). */
export function startBlockers(t: { verificationSubmitted: boolean; boardingVerified: boolean }): string[] {
  const out: string[] = [];
  if (!t.verificationSubmitted) out.push('Live selfie and vehicle photos');
  if (!t.boardingVerified) out.push("Customer's boarding OTP");
  return out;
}
