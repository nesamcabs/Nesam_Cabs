// Booking stages as the vendor sees them (reference wMatches): Accepted → Upcoming → On Trip → Completed / Cancelled.
import type { VendorBooking } from '../../types/operations';
import type { BookingTab } from '../../navigation/types';
import type { Tone } from '../../components/kit/core';

export type Stage = BookingTab;

export function stageOf(b: VendorBooking): Stage {
  if (b.status === 'Completed') return 'Completed';
  if (b.status === 'Cancelled' || b.status === 'Rejected') return 'Cancelled';
  if (b.status === 'Ongoing' || ['Reached Pickup', 'Trip Started', 'Trip Ended'].includes(b.tripSubStatus) || ['In Progress', 'Arrived Destination', 'Reached Pickup'].includes(b.tripStage)) return 'On Trip';
  return b.driverId && b.vehicleId ? 'Upcoming' : 'Accepted';
}

/** Driver / vehicle can still be (re)assigned and a cancellation requested: before the trip starts. */
export const canChange = (b: VendorBooking) => ['Accepted', 'Upcoming'].includes(stageOf(b)) && (!b.tripSubStatus || b.tripSubStatus === 'Not Started');

export const STAGE_BADGE: Record<Stage, [string, Tone]> = {
  Accepted: ['Assignment pending', 'amber'],
  Upcoming: ['Driver assigned', 'neutral'],
  'On Trip': ['Trip in progress', 'red'],
  Completed: ['Completed', 'green'],
  Cancelled: ['Cancelled', 'neutral'],
};

export const SETTLEMENT_LABEL: Record<string, string> = {
  Paid: 'Bank settled',
  Wallet: 'Wallet posted',
  Processing: 'Processing',
  Due: 'Settlement pending',
  'On Hold': 'On hold',
  Failed: 'Payout failed',
};

export const payoutOf = (b: VendorBooking): number | null => (b.payoutRecorded ? b.vendorPayout : null);
