import type { TripSubStatus } from '../types';

/**
 * The driver's step on a trip — Reached Pickup → Trip Started → Trip Ended.
 * The server (functions/src/domain/bookingFlow.ts) is authoritative and
 * re-checks every step; this only reads what it stored. Older trips without a
 * sub-status map from their legacy stage, and a trip recorded under the
 * earlier order ("Trip Started" while driving to the pickup, stage En Route
 * Pickup) has not reached the pickup yet.
 */
export function tripSubStatusOf(b: { tripSubStatus?: unknown; tripStage?: unknown; status?: unknown }): TripSubStatus {
  const v = String(b.tripSubStatus ?? '');
  if (v === 'Trip Started' && b.tripStage === 'En Route Pickup') return 'Not Started';
  if (v === 'Not Started' || v === 'Reached Pickup' || v === 'Trip Started' || v === 'Trip Ended') return v;
  if (b.status === 'Completed') return 'Trip Ended';
  switch (b.tripStage) {
    case 'Reached Pickup': return 'Reached Pickup';
    case 'In Progress':
    case 'Arrived Destination': return 'Trip Started';
    case 'Completed': return 'Trip Ended';
    default: return 'Not Started';
  }
}
