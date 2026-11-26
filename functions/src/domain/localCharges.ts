// What a district local fare (domain/localPricing.ts) adds around the priced ride: the booking's own record of it, the
// pass-through route toll and airport entry, the waiting the minimum fare already covers, and the local waiting rates.
import { gstComponents, inclusiveTaxable } from './gst';
import { minimumHeadroom, type LocalRule, type Scope, type TollSource } from './localPricing';
import type { ExtraChargesSnapshot } from './extraCharges';
import type { PricingSnapshot } from './tariff';
import type { FareBreakdown } from './types';
import type { PriceResult } from '../quote';

/** Stored on the booking's price snapshot (customer-readable: it never holds a partner rate). */
export interface LocalSnapshot {
  schema: 1;
  kind: 'ride' | 'rental';
  district: string;
  districtKey: string;
  /** Where the rate came from. */
  source: Scope;
  /** The shared (All brands) rate was used, not the brand's own. */
  shared: boolean;
  version: number;
  /** Pickup & Drop: the customer rate the final fare is worked from. */
  rule?: LocalRule;
  /** Hourly Rental: the package booked. */
  hours?: number;
  peakPaise: number;
  peakLabel?: string;
  nightPaise: number;
  nightPercent: number;
  /** This fare's own night percentage decides the night charge: the common night allowance is not added. */
  ownNight: boolean;
  /** Added automatically, exactly as entered (GST inside them when the fare includes GST). */
  tollPaise: number;
  airportPaise: number;
  tollSource: TollSource;
  tollsAtActuals: boolean;
  parkingAtActuals: boolean;
  /** The same two before GST, in rupees, once added to the fare; `gross` is set when GST is included in them. */
  passThrough?: { toll: number; airport: number; gross?: number };
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Adds the route toll and airport entry to a fare: taxable amount, GST and total all move, so every figure still adds up. */
export function withLocalPassThroughFare(source: FareBreakdown, local?: LocalSnapshot): FareBreakdown {
  const pt = local?.passThrough;
  if (!pt || !(pt.toll + pt.airport > 0)) return source;
  const extra = round(pt.toll + pt.airport);
  const taxableAmount = round(source.taxableAmount + extra);
  const total = source.gstDetails?.mode === 'included'
    ? round(source.total + (pt.gross ?? round(extra * (1 + source.gstRate))))
    : round(taxableAmount + round(taxableAmount * source.gstRate));
  const gst = round(total - taxableAmount);
  return {
    ...source,
    ...(pt.toll > 0 ? { routeToll: pt.toll } : {}),
    ...(pt.airport > 0 ? { airportEntry: pt.airport } : {}),
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
 * Adds the automatic toll and airport entry to a priced district ride, after the ride fare: no discount, price change, peak or
 * night percentage applies to them. The partner is paid them back.
 */
export function withLocalPassThrough(result: PriceResult): PriceResult {
  const local = result.pricing.localFare;
  if (!local || !(local.tollPaise + local.airportPaise > 0)) return result;
  const included = result.fare.gstDetails?.mode === 'included';
  const net = (paise: number) => (included ? inclusiveTaxable(paise, result.fare.gstRate) : paise) / 100;
  const snapshot: LocalSnapshot = {
    ...local,
    passThrough: { toll: net(local.tollPaise), airport: net(local.airportPaise), ...(included ? { gross: (local.tollPaise + local.airportPaise) / 100 } : {}) },
  };
  const fare = withLocalPassThroughFare(result.fare, snapshot);
  const lines = result.breakup.lines.map((l) => {
    if (!GST_KEYS.includes(l.key)) return l;
    return { ...l, amount: l.key === 'gst' ? fare.gst : fare.gstDetails?.[l.key as 'cgst' | 'sgst' | 'utgst' | 'igst'] ?? l.amount };
  });
  const at = lines.findIndex((l) => GST_KEYS.includes(l.key));
  const added = [
    ...(local.tollPaise > 0 ? [{ key: 'routeToll', label: 'Route toll', amount: snapshot.passThrough!.toll, treatment: 'included' as const, detail: 'Added for the tolls on this route' }] : []),
    ...(local.airportPaise > 0 ? [{ key: 'airportEntry', label: 'Airport entry charge', amount: snapshot.passThrough!.airport, treatment: 'included' as const, detail: 'Airport pickup or drop' }] : []),
  ];
  lines.splice(at < 0 ? lines.length : at, 0, ...added);
  const passPaise = local.tollPaise + local.airportPaise;
  const partner = result.pricing.partner ? { ...result.pricing.partner, basePaise: result.pricing.partner.basePaise + passPaise, passThroughPaise: passPaise } : result.pricing.partner;
  return { ...result, fare, pricing: { ...result.pricing, localFare: snapshot, partner }, breakup: { ...result.breakup, lines, packageTotal: fare.total } };
}

/** The district's waiting rates as the booking's extra charges: per minute after each side's own free minutes, billed after the trip. */
export function localWaitingCharges(
  base: ExtraChargesSnapshot | undefined, i: { tariffVersion: number; categoryId: string; rule: LocalRule; partnerRule: LocalRule; gstIncluded: boolean; gstRate: number },
): ExtraChargesSnapshot {
  const customerRate = Math.round(i.rule.waitPerMin * 6000);
  return {
    schema: 1, version: base?.version ?? 0, tariffVersion: i.tariffVersion, categoryId: i.categoryId,
    freeWaitingMinutes: i.rule.freeWaitMins, waitingRoundingMinutes: 1, roundingScope: 'per_stop', taxTreatment: 'tariff_gst',
    // A rate entered with GST inside is stored without it: GST is added back when the waiting is billed.
    customer: { ...base?.customer, waitingPerHourPaise: i.gstIncluded ? inclusiveTaxable(customerRate, i.gstRate) : customerRate },
    partner: { ...base?.partner, waitingPerHourPaise: Math.round(i.partnerRule.waitPerMin * 6000), freeWaitingMinutes: i.partnerRule.freeWaitMins },
  };
}

/** Waiting the minimum fare already covers on a finished district ride, for each side. */
export function localWaitingCredit(pricing: PricingSnapshot | null | undefined, totalKm: number): { customerPaise: number; partnerPaise: number } | undefined {
  const local = pricing?.localFare;
  if (!pricing || !local?.rule) return undefined;
  const km = Math.max(totalKm, pricing.quotedKm);
  const customer = Math.round(minimumHeadroom(local.rule, km) * 100);
  const own = pricing.partner?.localRule;
  return {
    customerPaise: pricing.gstInFare ? inclusiveTaxable(customer, pricing.gstRate) : customer,
    partnerPaise: own ? Math.round(minimumHeadroom(own, km) * 100) : 0,
  };
}
