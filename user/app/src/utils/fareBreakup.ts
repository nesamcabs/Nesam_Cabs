// Client mirror of the server's fare breakup (functions/src/domain/fareBreakup.ts).
// A booked trip shows the lines the server stored; this builds the same lines
// for the quote before booking, so the estimate and the booking never disagree.
import type { FareBreakdown, FareLine, RideCategory } from '../types';

export interface FareBreakup {
  lines: FareLine[];
  /** What the customer pays for the package (incl. GST) — always equals fare.total. */
  packageTotal: number;
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function buildFareBreakup(category: RideCategory, fare: FareBreakdown, outstation: boolean): FareBreakup {
  const x = category.fare.extras;
  const lines: FareLine[] = [];
  const add = (l: FareLine) => lines.push(l);

  add({
    key: 'base', label: 'Base package', amount: fare.baseFare, treatment: 'included',
    detail: category.fare.baseKm > 0 ? `Includes ${category.fare.baseKm} KM` : 'Base fare',
  });
  add({
    key: 'distance', label: 'Distance charge', amount: fare.distanceFare, treatment: 'included',
    detail: fare.distanceFare > 0
      ? `${fare.distanceKm} KM booked at ${rupees(fare.perKmRate)}/KM beyond the included ${category.fare.baseKm} KM`
      : `${fare.distanceKm} KM booked, within the included KM`,
  });
  if (fare.timeFare > 0) add({ key: 'time', label: 'Time charge', amount: fare.timeFare, treatment: 'included', detail: `${fare.durationMin} min at ${rupees(fare.perMinuteRate)}/min` });
  if (fare.nightCharge > 0) add({ key: 'night', label: 'Night charge', amount: fare.nightCharge, treatment: 'included', detail: 'Pickup between 10:00 PM and 06:00 AM' });
  add(outstation
    ? { key: 'driverAllowance', label: 'Driver allowance', amount: fare.driverAllowance, treatment: 'included', detail: 'Outstation trip — included in the fare' }
    : { key: 'driverAllowance', label: 'Driver allowance', amount: null, treatment: 'not_applicable', detail: 'Not applicable to local trips' });
  if (fare.minimumFareAdjustment > 0) add({ key: 'minimum', label: 'Minimum fare top-up', amount: fare.minimumFareAdjustment, treatment: 'included', detail: 'Applied so the fare reaches the category minimum' });
  if (fare.globalAdjustment) {
    const a = fare.globalAdjustment;
    add({ key: 'adjustment', label: a.name || 'Fare adjustment', amount: a.amount, treatment: 'included', detail: `${a.direction === 'increase' ? '+' : '−'}${a.percent}% on the package total` });
  }
  if (fare.adminAdjustment) add({ key: 'agreed', label: 'Agreed fare adjustment', amount: fare.adminAdjustment, treatment: 'included', detail: 'Authorised by NESAM staff' });
  if (fare.discount > 0) {
    const d = fare.discountDetail;
    add({
      key: 'discount', label: 'Discount', amount: -fare.discount, treatment: 'included',
      detail: d?.type === 'percentage' ? `${d.value}% discount` : d?.type === 'fixed' ? `Flat ${rupees(d.value)} discount` : 'Promo discount',
    });
  }
  add({ key: 'gst', label: 'GST', amount: fare.gst, treatment: 'included', detail: 'Added on top of the fare; included in the total payable' });

  // Charges outside the package.
  add({
    key: 'extraKm', label: 'Extra KM', amount: null, treatment: 'extra',
    detail: `${rupees(x?.extraKmRate ?? fare.perKmRate)} per KM beyond the ${fare.distanceKm} KM booked`,
  });
  add({
    key: 'waiting', label: 'Waiting charges', amount: null, treatment: 'extra',
    detail: x && x.waitingPerHour > 0 ? `${rupees(x.waitingPerHour)} per hour of waiting` : 'Billed at actuals',
  });
  add(x?.tollIncluded
    ? { key: 'toll', label: 'Toll', amount: null, treatment: 'included', detail: 'Included in the fare' }
    : { key: 'toll', label: 'Toll', amount: null, treatment: 'extra', detail: 'Payable separately at actuals' });
  add(x?.parkingIncluded
    ? { key: 'parking', label: 'Parking', amount: null, treatment: 'included', detail: 'Included in the fare' }
    : { key: 'parking', label: 'Parking', amount: null, treatment: 'extra', detail: 'Payable separately at actuals' });
  add(outstation
    ? { key: 'stateTax', label: 'State tax / permit', amount: x && x.permitCharge > 0 ? x.permitCharge : null, treatment: 'extra', detail: x && x.permitCharge > 0 ? 'Payable separately per trip' : 'Payable separately at actuals' }
    : { key: 'stateTax', label: 'State tax / permit', amount: null, treatment: 'not_applicable', detail: 'Not applicable to local trips' });
  if (x && x.carrierCharge > 0) add({ key: 'carrier', label: 'Carrier / luggage', amount: x.carrierCharge, treatment: 'extra', detail: 'Payable separately if a carrier is used' });

  return { lines, packageTotal: fare.total };
}

/** Included lines for a booking stored before the server kept a breakup (no category to describe extras). */
export function linesFromBreakdown(fare: FareBreakdown): FareLine[] {
  const lines: FareLine[] = [];
  const add = (key: string, label: string, amount: number, detail = '') => {
    if (amount) lines.push({ key, label, amount, treatment: 'included', detail });
  };
  lines.push({ key: 'base', label: 'Base fare', amount: fare.baseFare, treatment: 'included', detail: '' });
  add('distance', 'Distance charge', fare.distanceFare, `${fare.distanceKm} KM at ${rupees(fare.perKmRate)}/KM`);
  add('time', 'Time charge', fare.timeFare, `${fare.durationMin} min`);
  add('night', 'Night charge', fare.nightCharge);
  add('driverAllowance', 'Driver allowance', fare.driverAllowance, 'Outstation trip');
  add('minimum', 'Minimum fare top-up', fare.minimumFareAdjustment);
  if (fare.globalAdjustment) add('adjustment', fare.globalAdjustment.name || 'Fare adjustment', fare.globalAdjustment.amount);
  add('agreed', 'Agreed fare adjustment', fare.adminAdjustment ?? 0);
  add('discount', 'Discount', -fare.discount);
  lines.push({ key: 'gst', label: 'GST', amount: fare.gst, treatment: 'included', detail: '' });
  return lines;
}
