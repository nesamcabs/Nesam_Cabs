import type { FareLine, TripRecord } from '@core/types';
import { linesFromBreakdown } from '@core/utils/fareBreakup';

/** The lines to show for a booked trip: the server's breakup, else one rebuilt from the stored fare. */
export function tripFareLines(trip: TripRecord): FareLine[] {
  if (trip.fareLines.length) return trip.fareLines;
  return trip.fareBreakdown
    ? linesFromBreakdown(trip.fareBreakdown)
    : [{ key: 'fare', label: 'Ride fare', amount: trip.fare, treatment: 'included', detail: '' }];
}
