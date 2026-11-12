import type { PriceResult } from '../quote';
import { gstComponents } from './gst';
import type { FareBreakdown, RideCategory } from './types';

// Night allowance: a fixed amount added automatically to a booking whose pickup falls between 11:00 PM and 6:00 AM (India time).
// The amount is set by an admin for each vehicle category and each brand (Vehicle categories → edit → Night allowance), so a
// brand or a vehicle with nothing set is never charged. Like the roof-carrier and pet add-ons it is added after the trip is
// priced, follows the booking's GST setting, is stored in the booking's price snapshot and is kept when the final fare is worked out.

export const NIGHT_ALLOWANCE_START_HOUR = 23;
export const NIGHT_ALLOWANCE_END_HOUR = 6;

/** What was billed for one booking. `amount` is before GST when GST is added on top, or the GST-free part when the entered amount already includes it. */
export interface NightAllowanceCharge {
  amount: number;
  /** Set only when GST is included in the fare: the amount exactly as the admin entered it (GST included). */
  grossAmount?: number;
  startHour: number;
  endHour: number;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const rate = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100000 ? round(v) : 0);

/** Night-allowance amounts keyed by brand, from a saved category (anything invalid is dropped). */
export function nightAllowanceByBrandOf(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [brand, amount] of Object.entries(value as Record<string, unknown>)) {
    const r = rate(amount);
    if (r > 0) out[brand] = r;
  }
  return out;
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

/** The amount set for this vehicle category and brand; 0 when none. */
export function nightAllowanceFor(category: Pick<RideCategory, 'nightAllowanceByBrand'>, brand?: string): number {
  return rate(category.nightAllowanceByBrand?.[brand || 'nesam']);
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
 * Applies the night allowance to a priced booking when the pickup is between 11 PM and 6 AM and the category has an amount for
 * this brand. Adds a "Night allowance" line to the breakup (above GST) and records the charge in the price snapshot.
 */
export function withNightAllowance(result: PriceResult, pickupAt: Date, category: Pick<RideCategory, 'nightAllowanceByBrand'>, brand?: string): PriceResult {
  if (!isNightAllowanceTime(pickupAt)) return result;
  // The older category engine may already charge its own night charge: never charge twice.
  if ((result.fare.nightCharge ?? 0) > 0) return result;
  const configured = nightAllowanceFor(category, brand);
  if (!configured) return result;
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
    pricing: { ...result.pricing, nightAllowance: charge },
    breakup: {
      ...result.breakup,
      lines,
      packageTotal: fare.total,
      knownExtras: round(extras.reduce((sum, l) => sum + (l.amount ?? 0), 0)),
      hasActualsExtras: extras.some((l) => l.amount === null),
    },
  };
}
