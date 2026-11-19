import type { PriceResult } from '../quote';
import { gstComponents } from './gst';
import type { FareBreakdown } from './types';

// Night allowance: a fixed amount added automatically to a booking whose pickup falls between 11:00 PM and 6:00 AM (India time).
// One common setting for every vehicle, brand and service (Pricing → Night allowance); when it is off, or has no amount, nothing
// is charged. Like the roof-carrier and pet add-ons it is added after the trip is priced, follows the booking's GST setting, is
// stored in the booking's price snapshot and is kept when the final fare is worked out.

export const NIGHT_ALLOWANCE_START_HOUR = 23;
export const NIGHT_ALLOWANCE_END_HOUR = 6;

/** The common setting, as saved by an admin. */
export interface NightAllowanceConfig {
  enabled: boolean;
  /** Rupees per booking: the common amount, used by every vehicle class that has none of its own. */
  amount: number;
  /** Rupees per booking for one vehicle class (hatchback, sedan, suv, suv7, innova, crysta). 0 = no night allowance for that class. */
  classes?: Record<string, number>;
  /** Rupees the partner gets for one vehicle class when a night allowance applies. Absent or 0 = the partner gets nothing extra. */
  partnerClasses?: Record<string, number>;
  version: number;
}

/** What was billed for one booking. `amount` is before GST when GST is added on top, or the GST-free part when the entered amount already includes it. */
export interface NightAllowanceCharge {
  amount: number;
  /** Set only when GST is included in the fare: the amount exactly as the admin entered it (GST included). */
  grossAmount?: number;
  startHour: number;
  endHour: number;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const MAX_RUPEES = 100000;
const rate = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_RUPEES ? round(v) : 0);

/** A per-class amount: zero is allowed (and means "none for this vehicle"). */
const classRate = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RUPEES ? round(v) : null);

function classRates(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const r = classRate(v);
      if (r !== null) out[k] = r;
    }
  }
  return out;
}

export function parseNightAllowance(d: Record<string, unknown> | undefined | null): NightAllowanceConfig {
  const classes = classRates(d?.classes);
  const partnerClasses = classRates(d?.partnerClasses);
  return {
    enabled: d?.enabled === true, amount: rate(d?.amount), ...(Object.keys(classes).length ? { classes } : {}),
    ...(Object.keys(partnerClasses).length ? { partnerClasses } : {}), version: typeof d?.version === 'number' ? d.version : 0,
  };
}

/** The amount to charge a vehicle class: 0 when the setting is off or empty; the class's own amount when it has one, else the common amount. */
export function nightAllowanceFor(config: NightAllowanceConfig | null | undefined, vehicleClass?: string | null): number {
  if (!config || !config.enabled) return 0;
  const own = vehicleClass ? config.classes?.[vehicleClass] : undefined;
  return own !== undefined ? rate(own) : rate(config.amount);
}

/** What the partner gets for a night pickup in one vehicle class: 0 when the setting is off or none is set for that class. */
export function nightAllowancePartnerFor(config: NightAllowanceConfig | null | undefined, vehicleClass?: string | null): number {
  if (!config || !config.enabled || !vehicleClass) return 0;
  return rate(config.partnerClasses?.[vehicleClass]);
}

/** Hour of the day (0–23) in India. */
export function istHourOf(d: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(d));
}

/** True from 11:00 PM up to, not including, 6:00 AM India time. */
export function isNightAllowanceTime(d: Date): boolean {
  const h = istHourOf(d);
  return h >= NIGHT_ALLOWANCE_START_HOUR || h < NIGHT_ALLOWANCE_END_HOUR;
}

/** Adds a night allowance to a fare: the taxable amount, GST and total all move, so every figure still adds up. */
export function withNightAllowanceFare(source: FareBreakdown, charge?: NightAllowanceCharge): FareBreakdown {
  if (!charge || !(charge.amount > 0)) return source;
  const extra = round(charge.amount);
  const taxableAmount = round(source.taxableAmount + extra);
  const total = source.gstDetails?.mode === 'included'
    ? round(source.total + (charge.grossAmount ?? round(extra * (1 + source.gstRate))))
    : round(taxableAmount + round(taxableAmount * source.gstRate));
  const gst = round(total - taxableAmount);
  return {
    ...source,
    nightCharge: round((source.nightCharge ?? 0) + extra),
    subtotal: round(source.subtotal + extra),
    taxableAmount,
    total,
    gst,
    ...(source.subtotalBeforeAdjustment !== undefined ? { subtotalBeforeAdjustment: round(source.subtotalBeforeAdjustment + extra) } : {}),
    ...(source.gstDetails ? { gstDetails: { ...source.gstDetails, ...gstComponents(gst, source.gstDetails.split) } } : {}),
  };
}

const GST_KEYS = ['gst', 'cgst', 'sgst', 'utgst', 'igst'];

/**
 * Applies the night allowance to a priced booking when the pickup is between 11 PM and 6 AM and the common setting is on.
 * Adds a "Night allowance" line to the breakup (above GST) and records the charge in the price snapshot.
 */
export function withNightAllowance(result: PriceResult, pickupAt: Date, config: NightAllowanceConfig | null | undefined, vehicleClass?: string | null): PriceResult {
  if (!isNightAllowanceTime(pickupAt)) return result;
  // The older category engine may already charge its own night charge: never charge twice.
  if ((result.fare.nightCharge ?? 0) > 0) return result;
  const configured = nightAllowanceFor(config, vehicleClass);
  const partnerPaise = Math.round(nightAllowancePartnerFor(config, vehicleClass) * 100);
  if (!configured && !partnerPaise) return result;
  // The partner's night payout goes into the (private) partner block, like the hill payout, whatever the customer is charged.
  const partner = result.pricing.partner && partnerPaise > 0
    ? { ...result.pricing.partner, basePaise: result.pricing.partner.basePaise + partnerPaise, nightPaise: partnerPaise }
    : result.pricing.partner;
  if (!configured) return { ...result, pricing: { ...result.pricing, partner } };
  const included = result.fare.gstDetails?.mode === 'included';
  const amount = included ? round(configured / (1 + result.fare.gstRate)) : configured;
  const charge: NightAllowanceCharge = { amount, ...(included ? { grossAmount: configured } : {}), startHour: NIGHT_ALLOWANCE_START_HOUR, endHour: NIGHT_ALLOWANCE_END_HOUR };
  const fare = withNightAllowanceFare(result.fare, charge);
  const lines = result.breakup.lines.filter((l) => l.key !== 'night').map((l) => {
    if (GST_KEYS.includes(l.key)) {
      const value = l.key === 'gst' ? fare.gst : fare.gstDetails?.[l.key as 'cgst' | 'sgst' | 'utgst' | 'igst'] ?? l.amount;
      return { ...l, amount: value };
    }
    return l;
  });
  const insert = lines.findIndex((l) => GST_KEYS.includes(l.key));
  lines.splice(insert < 0 ? lines.length : insert, 0, {
    key: 'night', label: 'Night allowance', amount, treatment: 'included' as const, detail: 'Pickup between 11:00 PM and 6:00 AM',
  });
  const extras = lines.filter((l) => l.treatment === 'extra');
  return {
    ...result,
    fare,
    pricing: { ...result.pricing, nightAllowance: charge, partner },
    breakup: {
      ...result.breakup,
      lines,
      packageTotal: fare.total,
      knownExtras: round(extras.reduce((sum, l) => sum + (l.amount ?? 0), 0)),
      hasActualsExtras: extras.some((l) => l.amount === null),
    },
  };
}
