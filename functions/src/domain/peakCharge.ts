import type { PriceResult } from '../quote';
import { gstComponents } from './gst';
import type { FareBreakdown } from './types';

// The scheduled peak-hour charge and the Local airport entry fee as their own fare lines, added once after the ride is priced, the
// same way the hill charge is (domain/hillCharge.ts). Both are stored in the booking's price snapshot and re-applied unchanged when
// the final fare is worked out, so a confirmed booking never picks up later setting changes.
//   - Peak: part of the taxable fare (GST applies to it); worked out on the eligible ride fare only.
//   - Airport entry: a pass-through like tolls and parking: outside the taxable amount, never multiplied by peak.

export interface PeakChargeSnapshot {
  ruleId: string;
  ruleVersion: number;
  name: string;
  type: 'percent' | 'fixed';
  value: number;
  cap?: number;
  /** The IST date the matching window started on (an overnight window keeps its evening's date). */
  windowStart: string;
  /** Rupees before GST. */
  amount: number;
  /** The eligible ride fare the charge was worked out on, rupees. */
  eligible: number;
  label: string;
}

export interface AirportEntrySnapshot {
  locationId: string;
  side: 'pickup' | 'drop';
  amount: number;
  partnerAmount: number;
  source: string;
  sourceVersion: number;
  label: string;
}

export const PEAK_LINE_LABEL = 'Peak-hour charge';
export const AIRPORT_ENTRY_LABEL = 'Airport entry';
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const GST_KEYS = ['gst', 'cgst', 'sgst', 'utgst', 'igst'];

export function withPeakChargeFare(source: FareBreakdown, charge?: PeakChargeSnapshot): FareBreakdown {
  if (!charge || !(charge.amount > 0)) return source;
  const extra = round(charge.amount);
  const taxableAmount = round(source.taxableAmount + extra);
  const total = source.gstDetails?.mode === 'included'
    ? round(source.total + round(extra * (1 + source.gstRate)))
    : round(taxableAmount + round(taxableAmount * source.gstRate));
  const gst = round(total - taxableAmount);
  return {
    ...source,
    peakCharge: round((source.peakCharge ?? 0) + extra),
    subtotal: round(source.subtotal + extra),
    taxableAmount,
    total,
    gst,
    ...(source.gstDetails ? { gstDetails: { ...source.gstDetails, ...gstComponents(gst, source.gstDetails.split) } } : {}),
  };
}

export function withAirportEntryFare(source: FareBreakdown, entry?: AirportEntrySnapshot): FareBreakdown {
  if (!entry || !(entry.amount > 0)) return source;
  return { ...source, airportEntry: round((source.airportEntry ?? 0) + entry.amount), total: round(source.total + entry.amount) };
}

function rebuild(result: PriceResult, fare: FareBreakdown, line: { key: string; label: string; amount: number; detail: string }, afterGst: boolean): PriceResult['breakup'] {
  const lines = result.breakup.lines.filter((l) => l.key !== line.key).map((l) => {
    if (!GST_KEYS.includes(l.key)) return l;
    const value = l.key === 'gst' ? fare.gst : fare.gstDetails?.[l.key as 'cgst' | 'sgst' | 'utgst' | 'igst'] ?? l.amount;
    return { ...l, amount: value };
  });
  const gstAt = lines.findIndex((l) => GST_KEYS.includes(l.key));
  const lastGst = lines.reduce((at, l, i) => (GST_KEYS.includes(l.key) ? i : at), -1);
  const at = afterGst ? (lastGst < 0 ? lines.length : lastGst + 1) : gstAt < 0 ? lines.length : gstAt;
  lines.splice(at, 0, { ...line, treatment: 'included' as const });
  const extras = lines.filter((l) => l.treatment === 'extra');
  return { ...result.breakup, lines, packageTotal: fare.total, knownExtras: round(extras.reduce((s, l) => s + (l.amount ?? 0), 0)), hasActualsExtras: extras.some((l) => l.amount === null) };
}

export function withPeakCharge(result: PriceResult, charge: PeakChargeSnapshot | null): PriceResult {
  if (!charge || !(charge.amount > 0)) return result;
  const fare = withPeakChargeFare(result.fare, charge);
  const detail = charge.type === 'percent' ? `${charge.name || 'Scheduled peak'} · ${charge.value}% of the ride fare${charge.cap !== undefined ? `, up to ₹${charge.cap}` : ''}` : `${charge.name || 'Scheduled peak'} · fixed`;
  return { ...result, fare, pricing: { ...result.pricing, peakCharge: charge }, breakup: rebuild(result, fare, { key: 'peakCharge', label: PEAK_LINE_LABEL, amount: charge.amount, detail }, false) };
}

export function withAirportEntry(result: PriceResult, entry: AirportEntrySnapshot | null): PriceResult {
  if (!entry || !(entry.amount > 0)) return result;
  const fare = withAirportEntryFare(result.fare, entry);
  const partnerPaise = Math.round(entry.partnerAmount * 100);
  const partner = result.pricing.partner && partnerPaise > 0 ? { ...result.pricing.partner, basePaise: result.pricing.partner.basePaise + partnerPaise } : result.pricing.partner;
  return {
    ...result, fare, pricing: { ...result.pricing, airportEntry: entry, partner },
    breakup: rebuild(result, fare, { key: 'airportEntry', label: AIRPORT_ENTRY_LABEL, amount: entry.amount, detail: `Saved airport entry fee (${entry.side}) · not taxed, not part of peak` }, true),
  };
}
