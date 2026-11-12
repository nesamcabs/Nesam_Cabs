import type { PriceResult } from '../quote';
import { gstComponents } from './gst';
import type { FareBreakdown } from './types';

// Platform fee: a "hybrid" fee added to a booking: a percentage of the fare, never below a minimum and never above a cap
// (for example 5% with a ₹50 minimum and a ₹250 cap). One common setting for every brand, switched on and set separately
// for each kind of service. Like the night allowance it is added once, after the trip is priced; it is part of the taxable
// fare (so total = taxable + GST still holds everywhere), is stored in the booking's price snapshot and is kept when the
// final fare is worked out.

export const PLATFORM_FEE_SERVICES = ['outstation', 'local', 'rental', 'airport', 'multicity'] as const;
export type PlatformFeeService = (typeof PLATFORM_FEE_SERVICES)[number];

export const PLATFORM_FEE_SERVICE_LABELS: Record<PlatformFeeService, string> = {
  outstation: 'Outstation (One Way and Round Trip)',
  local: 'Local Pickup & Drop',
  rental: 'Local Rental (hourly)',
  airport: 'Airport Taxi',
  multicity: 'Multicity tour',
};

export interface PlatformFeeRule {
  enabled: boolean;
  /** Percentage of the fare (0–100). */
  percent: number;
  /** The fee is never below this many rupees. */
  min: number;
  /** The fee is never above this many rupees (0 = no cap). */
  cap: number;
}

export interface PlatformFeeConfig {
  version: number;
  services: Record<PlatformFeeService, PlatformFeeRule>;
}

/** What was billed on one booking, as stored in its price snapshot. `amount` is before GST. */
export interface PlatformFeeCharge {
  service: PlatformFeeService;
  amount: number;
  percent: number;
  min: number;
  cap: number;
}

export const DEFAULT_PLATFORM_FEE_RULE: PlatformFeeRule = { enabled: false, percent: 5, min: 50, cap: 250 };

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const MAX = 100000;
const money = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX ? round(v) : fallback);

export function parsePlatformFeeRule(value: unknown): PlatformFeeRule {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const percent = typeof v.percent === 'number' && Number.isFinite(v.percent) && v.percent >= 0 && v.percent <= 100 ? round(v.percent) : DEFAULT_PLATFORM_FEE_RULE.percent;
  const min = money(v.min, DEFAULT_PLATFORM_FEE_RULE.min);
  const cap = money(v.cap, DEFAULT_PLATFORM_FEE_RULE.cap);
  return { enabled: v.enabled === true, percent, min, cap };
}

export function parsePlatformFee(d: Record<string, unknown> | undefined | null): PlatformFeeConfig {
  const services = (d?.services && typeof d.services === 'object' ? d.services : {}) as Record<string, unknown>;
  return {
    version: typeof d?.version === 'number' ? d.version : 0,
    services: Object.fromEntries(PLATFORM_FEE_SERVICES.map((s) => [s, parsePlatformFeeRule(services[s])])) as Record<PlatformFeeService, PlatformFeeRule>,
  };
}

/** The fee for a fare: percent of the fare, raised to the minimum and lowered to the cap (a cap of 0 means no cap). 0 when off. */
export function platformFeeAmount(rule: PlatformFeeRule, fareAmount: number): number {
  if (!rule.enabled || !(fareAmount > 0)) return 0;
  let fee = round((fareAmount * rule.percent) / 100);
  if (fee < rule.min) fee = rule.min;
  if (rule.cap > 0 && fee > rule.cap) fee = rule.cap;
  return Math.round(fee); // whole rupees, so the customer sees a clean amount
}

/** Which service setting a priced booking falls under. */
export function platformFeeServiceOf(result: Pick<PriceResult, 'pricing' | 'service'>, multicity?: boolean): PlatformFeeService {
  if (multicity) return 'multicity';
  switch (result.pricing.model) {
    case 'local_pickup_drop': return 'local';
    case 'rental_package':
    case 'rental_time': return 'rental';
    case 'airport_transfer': return 'airport';
    default: break;
  }
  if (result.service === 'Rental') return 'rental';
  if (result.service === 'Airport') return 'airport';
  if (result.service === 'Local') return 'local';
  return 'outstation';
}

/** "5% of the fare · minimum ₹50 · maximum ₹250". */
export function describePlatformFee(c: Pick<PlatformFeeCharge, 'percent' | 'min' | 'cap'>): string {
  const parts = [`${c.percent}% of the fare`];
  if (c.min > 0) parts.push(`minimum ₹${c.min.toLocaleString('en-IN')}`);
  if (c.cap > 0) parts.push(`maximum ₹${c.cap.toLocaleString('en-IN')}`);
  return parts.join(' · ');
}

/** Adds a platform fee to a fare: the taxable amount, GST and total all move, so every figure still adds up. */
export function withPlatformFeeFare(source: FareBreakdown, charge?: PlatformFeeCharge): FareBreakdown {
  if (!charge || !(charge.amount > 0)) return source;
  const extra = round(charge.amount);
  const taxableAmount = round(source.taxableAmount + extra);
  const total = source.gstDetails?.mode === 'included'
    ? round(source.total + round(extra * (1 + source.gstRate)))
    : round(taxableAmount + round(taxableAmount * source.gstRate));
  const gst = round(total - taxableAmount);
  return {
    ...source,
    platformFee: round((source.platformFee ?? 0) + extra),
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
 * Applies the platform fee to a priced booking when the service has it switched on. Adds a "Platform fee" line to the breakup
 * (above GST) and records the charge in the price snapshot. The percentage is taken on the fare as priced so far (night
 * allowance and add-ons included, after any discount, before GST).
 */
export function withPlatformFee(result: PriceResult, config: PlatformFeeConfig | null | undefined, multicity?: boolean): PriceResult {
  if (!config) return result;
  const service = platformFeeServiceOf(result, multicity);
  const rule = config.services[service];
  const amount = platformFeeAmount(rule, result.fare.taxableAmount);
  if (!(amount > 0)) return result;
  const charge: PlatformFeeCharge = { service, amount, percent: rule.percent, min: rule.min, cap: rule.cap };
  const fare = withPlatformFeeFare(result.fare, charge);
  const lines = result.breakup.lines.filter((l) => l.key !== 'platformFee').map((l) => {
    if (GST_KEYS.includes(l.key)) {
      const value = l.key === 'gst' ? fare.gst : fare.gstDetails?.[l.key as 'cgst' | 'sgst' | 'utgst' | 'igst'] ?? l.amount;
      return { ...l, amount: value };
    }
    return l;
  });
  const insert = lines.findIndex((l) => GST_KEYS.includes(l.key));
  lines.splice(insert < 0 ? lines.length : insert, 0, {
    key: 'platformFee', label: 'Platform fee', amount, treatment: 'included' as const, detail: describePlatformFee(charge),
  });
  const extras = lines.filter((l) => l.treatment === 'extra');
  return {
    ...result,
    fare,
    pricing: { ...result.pricing, platformFee: charge },
    breakup: {
      ...result.breakup,
      lines,
      packageTotal: fare.total,
      knownExtras: round(extras.reduce((sum, l) => sum + (l.amount ?? 0), 0)),
      hasActualsExtras: extras.some((l) => l.amount === null),
    },
  };
}
