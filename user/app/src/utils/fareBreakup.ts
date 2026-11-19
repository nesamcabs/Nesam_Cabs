// The fare breakup is built by the booking server (functions/src/domain/fareBreakup.ts) and stored on every quote and booking.
// The app never calculates a fare: this file only turns older records that have no stored breakup into lines.
import type { FareBreakdown, FareLine } from '../types';

export interface FareBreakup {
  lines: FareLine[];
  /** What the customer pays for the package (incl. GST) — always equals fare.total. */
  packageTotal: number;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** The lines of a fare for the rare case the server's own breakup is missing (older records): the amounts only. */
export function breakupFromFare(fare: FareBreakdown): FareBreakup {
  return { lines: linesFromBreakdown(fare), packageTotal: fare.total };
}

/** Included lines for a booking stored before the server kept a breakup. */
export function linesFromBreakdown(fare: FareBreakdown): FareLine[] {
  const lines: FareLine[] = [];
  const add = (key: string, label: string, amount: number, detail = '') => {
    if (amount) lines.push({ key, label, amount, treatment: 'included', detail });
  };
  add('distance', 'Distance charge', fare.baseFare + fare.distanceFare, `${fare.distanceKm} KM at ${rupees(fare.perKmRate)}/KM`);
  add('time', 'Time charge', fare.timeFare, `${fare.durationMin} min`);
  add('night', 'Night allowance', fare.nightCharge);
  add('driverAllowance', 'Driver allowance', fare.driverAllowance, 'Outstation trip');
  add('minimum', 'Minimum fare top-up', fare.minimumFareAdjustment);
  if (fare.globalAdjustment) add('adjustment', fare.globalAdjustment.name || 'Fare adjustment', fare.globalAdjustment.amount);
  add('agreed', 'Agreed fare adjustment', fare.adminAdjustment ?? 0);
  add('carrierAddon', 'Roof carrier', fare.addOns?.carrierCharge ?? 0);
  add('petAddon', 'Pet travel', fare.addOns?.petCharge ?? 0);
  add('discount', 'Discount', -fare.discount);
  add('platformFee', 'Platform fee', fare.platformFee ?? 0);
  lines.push({ key: 'gst', label: 'GST', amount: fare.gst, treatment: 'included', detail: '' });
  return lines;
}
