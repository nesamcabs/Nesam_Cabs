// The customer-readable fare breakup stored on every booking (`fareBreakup`).
// It is derived from the server-calculated FareBreakdown and the category's
// own configuration, so every app shows the same lines in the same words and
// never recomputes them. Each line says whether it is already in the price
// ("included") or payable separately ("extra").
import { FareBreakdown, RideCategory } from './types';
import type { PricingSnapshot } from './tariff';
import type { ExtraChargesSnapshot } from './extraCharges';

export type FareLineTreatment = 'included' | 'extra' | 'not_applicable';

export interface FareLine {
  key: string;
  label: string;
  /** Rupees. Negative for reductions. null = billed at actuals / rate only. */
  amount: number | null;
  treatment: FareLineTreatment;
  /** Human-readable rate, coverage or rule, e.g. "Includes 250 KM". */
  detail: string;
}

export interface FareBreakup {
  schema: 1;
  lines: FareLine[];
  /** What the customer pays for the package (incl. GST) — always equals fare.total. */
  packageTotal: number;
  /** Extras whose amount is known up front. Others are billed at actuals. */
  knownExtras: number;
  /** True when at least one extra is billed at actuals. */
  hasActualsExtras: boolean;
}

export const GST_IN_FARE = 'Already included in the fare (not added on top)';
export const GST_ON_TOP = 'Added on top of the fare; included in the total payable';

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
  const tax = fare.gstDetails;
  if (tax && tax.split !== 'Pending verification') {
    for (const key of ['cgst','sgst','utgst','igst'] as const) {
      if ((key === 'igst' && tax.split === 'IGST') || (key === 'cgst' && tax.split.startsWith('CGST')) || (key === 'sgst' && tax.split === 'CGST + SGST') || (key === 'utgst' && tax.split === 'CGST + UTGST')) {
        add({ key, label: key.toUpperCase(), amount: tax[key], treatment: 'included', detail: tax.mode === 'included' ? GST_IN_FARE : GST_ON_TOP });
      }
    }
  } else add({ key: 'gst', label: 'GST', amount: fare.gst, treatment: 'included', detail: tax ? `${tax.mode === 'included' ? GST_IN_FARE : GST_ON_TOP}; state split pending verified place of supply` : GST_ON_TOP });

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

  const extras = lines.filter((l) => l.treatment === 'extra');
  return {
    schema: 1,
    lines,
    packageTotal: fare.total,
    knownExtras: extras.reduce((s, l) => s + (l.amount ?? 0), 0),
    hasActualsExtras: extras.some((l) => l.amount === null),
  };
}

const num2 = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Fare lines for a booking priced by the confirmed tariff: dates / billable days, the
 * included kilometres, the daily or per-trip bata and what is billed beyond the package.
 * The extras block is shared with the category breakup so the wording stays identical.
 */
export function buildTariffFareBreakup(category: RideCategory, fare: FareBreakdown, outstation: boolean, pricing: PricingSnapshot): FareBreakup {
  const built = buildFareBreakup(category, fare, outstation);
  // A package or route fare saved "GST included" shows its GST as already inside the fare.
  const base = pricing.gstInFare && !fare.gstDetails ? { ...built, lines: built.lines.map((l) => (l.key === 'gst' ? { ...l, detail: GST_IN_FARE } : l)) } : built;
  const rate = num2(pricing.customerRatePaise);
  const roundTrip = pricing.model === 'round_trip_calendar';
  // A waiting rate saved with the tariff replaces the category wording; without one the category line is unchanged.
  const w = pricing.waitingPerHourPaise;
  const waiting = typeof w !== 'number' ? null : w > 0 ? `${num2(w)} per hour of waiting` : 'No waiting charge';
  const extrasBlock = (rest: FareLine[]): FareLine[] => rest.map((l) => (l.key === 'waiting' && waiting ? { ...l, detail: waiting } : l));
  if (pricing.model === 'rental_package') {
    const head: FareLine[] = [{
      key: 'package', label: `${pricing.rentalHours ?? ''}-hour rental package`.trim(), amount: fare.baseFare, treatment: 'included',
      detail: `${pricing.includedKm} KM included; ${num2(pricing.extraHourRatePaise ?? 0)} per extra hour`,
    }];
    const rest = base.lines.filter((l) => !['base', 'distance', 'time', 'night', 'driverAllowance', 'minimum'].includes(l.key));
    const lines = [...head, ...extrasBlock(rest).map((l) => (l.key === 'extraKm' ? { ...l, detail: `${num2(pricing.extraKmRatePaise)} per KM beyond the ${pricing.includedKm} KM included` } : l))];
    const extras = lines.filter((l) => l.treatment === 'extra');
    return { schema: 1, lines, packageTotal: fare.total, knownExtras: extras.reduce((s, l) => s + (l.amount ?? 0), 0), hasActualsExtras: extras.some((l) => l.amount === null) };
  }
  if (pricing.model === 'airport_transfer') {
    const beyond = Math.max(0, Math.round((pricing.quotedKm - pricing.minKmPerDay) * 10) / 10);
    const head: FareLine[] = [
      { key: 'package', label: 'Airport transfer base fare', amount: fare.baseFare, treatment: 'included', detail: `Covers the first ${pricing.minKmPerDay} KM` },
      ...(fare.distanceFare > 0 ? [{ key: 'distance', label: 'Distance beyond included KM', amount: fare.distanceFare, treatment: 'included' as const, detail: `${beyond} KM at ${num2(pricing.extraKmRatePaise)}/KM` }] : []),
    ];
    const rest = base.lines.filter((l) => !['base', 'distance', 'time', 'night', 'driverAllowance', 'minimum'].includes(l.key));
    const lines = [...head, ...extrasBlock(rest).map((l) => (l.key === 'extraKm' ? { ...l, detail: `${num2(pricing.extraKmRatePaise)} per KM beyond the ${pricing.includedKm} KM quoted` } : l))];
    const extras = lines.filter((l) => l.treatment === 'extra');
    return { schema: 1, lines, packageTotal: fare.total, knownExtras: extras.reduce((s, l) => s + (l.amount ?? 0), 0), hasActualsExtras: extras.some((l) => l.amount === null) };
  }
  if (pricing.model === 'fixed_route') {
    const head: FareLine[] = [{
      key: 'package', label: 'Fixed route fare', amount: fare.baseFare, treatment: 'included',
      detail: `Agreed fare for this route (${pricing.includedKm} KM by road); it does not change with the kilometres driven`,
    }];
    // No per-KM charge is added to an agreed fare.
    const rest = base.lines.filter((l) => !['base', 'distance', 'time', 'night', 'driverAllowance', 'minimum', 'extraKm'].includes(l.key));
    const lines = [...head, ...extrasBlock(rest)];
    const extras = lines.filter((l) => l.treatment === 'extra');
    return { schema: 1, lines, packageTotal: fare.total, knownExtras: extras.reduce((s, l) => s + (l.amount ?? 0), 0), hasActualsExtras: extras.some((l) => l.amount === null) };
  }
  const head: FareLine[] = [
    {
      key: 'distance', label: roundTrip ? 'Distance (billable KM)' : 'Distance charge', amount: fare.distanceFare + fare.minimumFareAdjustment, treatment: 'included',
      detail: roundTrip
        ? `${pricing.includedKm} KM billable (minimum ${pricing.minKmPerDay} KM/day × ${pricing.days} day${pricing.days === 1 ? '' : 's'}) at ${rate}/KM`
        : pricing.model === 'local_pickup_drop'
        ? `${pricing.includedKm} KM billable (local minimum ${pricing.minKmPerDay} KM) at ${rate}/KM`
        : `${pricing.includedKm} KM included (minimum ${pricing.minKmPerDay} KM) at ${rate}/KM`,
    },
    {
      key: 'driverAllowance', label: roundTrip ? 'Driver allowance (per day)' : 'Driver allowance', amount: fare.driverAllowance, treatment: 'included',
      detail: roundTrip ? `${num2(pricing.customerBataPaise)} × ${pricing.days} day${pricing.days === 1 ? '' : 's'} (${pricing.pickupDate}${pricing.endDate ? ` → ${pricing.endDate}` : ''})` : 'Included in the fare',
    },
  ];
  const rest = base.lines.filter((l) => !['base', 'distance', 'time', 'night', 'driverAllowance', 'minimum'].includes(l.key));
  const lines = [
    ...(pricing.model === 'local_pickup_drop' ? head.filter((l) => l.key !== 'driverAllowance') : head),
    ...extrasBlock(rest).map((l) => (l.key === 'extraKm' ? { ...l, detail: `${num2(pricing.extraKmRatePaise)} per KM beyond the ${pricing.includedKm} KM included` } : l)),
  ];
  const extras = lines.filter((l) => l.treatment === 'extra');
  return { schema: 1, lines, packageTotal: fare.total, knownExtras: extras.reduce((s, l) => s + (l.amount ?? 0), 0), hasActualsExtras: extras.some((l) => l.amount === null) };
}

/**
 * Discloses the category's configured waiting / hill / roof-carrier rates on a quoted breakup. They are charges outside the
 * package that apply only to the extras actually used, so no amount is added to the total: each line states its rate and
 * rule. A rate that was never configured adds no line and leaves the category's own wording alone.
 */
export function withExtraChargeLines(b: FareBreakup, s: ExtraChargesSnapshot): FareBreakup {
  const c = s.customer;
  let lines = [...b.lines];
  const upsert = (line: FareLine) => {
    const at = lines.findIndex((l) => l.key === line.key);
    if (at >= 0) lines[at] = line; else lines.push(line);
  };
  if (c.waitingPerHourPaise !== undefined) {
    const rule = s.freeWaitingMinutes !== null && s.waitingRoundingMinutes !== null
      ? ` after ${s.freeWaitingMinutes} free minute${s.freeWaitingMinutes === 1 ? '' : 's'} per stop, counted in ${s.waitingRoundingMinutes}-minute blocks`
      : '';
    upsert({
      key: 'waiting', label: 'Waiting charges', amount: null, treatment: 'extra',
      detail: c.waitingPerHourPaise > 0 ? `${num2(c.waitingPerHourPaise)} per hour of waiting${rule}` : 'No waiting charge',
    });
  }
  if (c.hillPaise !== undefined) {
    upsert({ key: 'hill', label: 'Hill travel', amount: null, treatment: 'extra', detail: c.hillPaise > 0 ? `${num2(c.hillPaise)} per trip when hill travel applies` : 'No hill charge' });
  }
  if (c.carrierPaise !== undefined) {
    // The category's older carrier line is replaced by the configured one.
    lines = lines.filter((l) => l.key !== 'carrier');
    upsert({ key: 'carrier', label: 'Roof carrier', amount: null, treatment: 'extra', detail: c.carrierPaise > 0 ? `${num2(c.carrierPaise)} per trip when a roof carrier is used` : 'No roof carrier charge' });
  }
  const extras = lines.filter((l) => l.treatment === 'extra');
  return { ...b, lines, knownExtras: extras.reduce((sum, l) => sum + (l.amount ?? 0), 0), hasActualsExtras: extras.some((l) => l.amount === null) };
}

/** What the office approved for a trip (the customer side only — this goes on the customer-readable booking). */
export interface ApprovedExtraLines {
  usage: { stops: { stopId: string; waitedMinutes: number }[] | null; hill: boolean | null; carrier: boolean | null };
  waiting: { chargeableMinutes: number; billedMinutes: number | null } | null;
  customer: { waitingPaise: number; hillPaise: number; carrierPaise: number; subtotalPaise: number; gstPaise: number; totalPaise: number };
}

/**
 * Shows the APPROVED amounts on the breakup. These lines are charges outside the package, so `packageTotal` (= fare.total) does
 * not change; they are added to the amount due separately (see amountDueFor). Each extra that was not used shows ₹0.
 */
export function withApprovedExtraLines(b: FareBreakup, x: ApprovedExtraLines): FareBreakup {
  const money = (p: number) => p / 100;
  const stops = x.usage.stops ?? [];
  const lines = b.lines.filter((l) => !['waiting', 'hill', 'carrier', 'extraGst'].includes(l.key));
  const at = lines.findIndex((l) => l.key === 'toll');
  const added: FareLine[] = [
    {
      key: 'waiting', label: 'Waiting charges', amount: money(x.customer.waitingPaise), treatment: 'extra',
      detail: x.customer.waitingPaise > 0 && x.waiting
        ? `${x.waiting.billedMinutes ?? x.waiting.chargeableMinutes} min billed across ${stops.length} stop${stops.length === 1 ? '' : 's'} (free waiting applied at each stop)`
        : 'No chargeable waiting on this trip',
    },
    { key: 'hill', label: 'Hill travel', amount: money(x.customer.hillPaise), treatment: 'extra', detail: x.usage.hill ? 'Hill travel applied' : 'Not applicable to this trip' },
    { key: 'carrier', label: 'Roof carrier', amount: money(x.customer.carrierPaise), treatment: 'extra', detail: x.usage.carrier ? 'Roof carrier used' : 'Not used on this trip' },
    ...(x.customer.gstPaise > 0 ? [{ key: 'extraGst', label: 'GST on extra charges', amount: money(x.customer.gstPaise), treatment: 'extra' as const, detail: 'At the GST rate saved with this booking' }] : []),
  ];
  const next = at >= 0 ? [...lines.slice(0, at), ...added, ...lines.slice(at)] : [...lines, ...added];
  const extras = next.filter((l) => l.treatment === 'extra');
  return { ...b, lines: next, knownExtras: extras.reduce((s, l) => s + (l.amount ?? 0), 0), hasActualsExtras: extras.some((l) => l.amount === null) };
}
