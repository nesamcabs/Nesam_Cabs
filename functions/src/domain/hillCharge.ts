import type { PriceResult } from '../quote';
import { gstComponents } from './gst';
import { HillCharge, hillNames } from './hillStations';
import type { FareBreakdown } from './types';

// Hill Station Allowance / Charge as its own fare line (Customer UX v8, section 08). Added once, after the trip is priced, exactly the
// way the night allowance and the platform fee are: it is part of the taxable fare (total = taxable + GST still holds), follows the
// booking's GST setting (an amount entered with GST included has the GST taken out), is stored in the booking's price snapshot and is
// kept when the final fare is worked out. The partner's share is payout data: it goes into the (private) partner block only.

/** What was billed for one booking's hill stations (customer-visible). `amount` is before GST. */
export interface HillChargeSnapshot {
  slab: 'oneWay' | 'roundTrip' | 'multicity';
  stations: { id: string; name: string; tamil: string }[];
  units: number;
  amount: number;
  /** Set only when GST is included in the fare: the amount exactly as the admin entered it (GST included). */
  grossAmount?: number;
  label: string;
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const GST_KEYS = ['gst', 'cgst', 'sgst', 'utgst', 'igst'];
export const HILL_LINE_LABEL = 'Hill Station Allowance / Charge';

/** Adds the hill charge to a fare: the taxable amount, GST and total all move, so every figure still adds up. */
export function withHillChargeFare(source: FareBreakdown, charge?: HillChargeSnapshot): FareBreakdown {
  if (!charge || !(charge.amount > 0)) return source;
  const extra = round(charge.amount);
  const taxableAmount = round(source.taxableAmount + extra);
  const total = source.gstDetails?.mode === 'included'
    ? round(source.total + (charge.grossAmount ?? round(extra * (1 + source.gstRate))))
    : round(taxableAmount + round(taxableAmount * source.gstRate));
  const gst = round(total - taxableAmount);
  return {
    ...source,
    hillCharge: round((source.hillCharge ?? 0) + extra),
    subtotal: round(source.subtotal + extra),
    taxableAmount,
    total,
    gst,
    ...(source.subtotalBeforeAdjustment !== undefined ? { subtotalBeforeAdjustment: round(source.subtotalBeforeAdjustment + extra) } : {}),
    ...(source.gstDetails ? { gstDetails: { ...source.gstDetails, ...gstComponents(gst, source.gstDetails.split) } } : {}),
  };
}

/** The line detail the customer reads: where the hill charge comes from. */
export function hillLineDetail(c: Pick<HillChargeSnapshot, 'slab' | 'stations' | 'units'>): string {
  const where = hillNames(c.stations);
  const slab = c.slab === 'roundTrip' ? 'Round-trip' : c.slab === 'multicity' ? 'Multicity' : 'One-way';
  return `${where ? `${where} · ` : ''}${slab} hill ${c.slab === 'multicity' ? 'charge' : 'slab'}${c.units > 1 ? ` × ${c.units}` : ''}`;
}

/**
 * Applies a detected hill charge to a priced booking: a separate "Hill Station Allowance / Charge" line above GST, the charge on the
 * price snapshot, and the partner's hill payout on the (private) partner block.
 */
export function withHillCharge(result: PriceResult, hill: HillCharge | null | undefined): PriceResult {
  if (!hill || !(hill.customerTotal > 0)) return result;
  const included = result.fare.gstDetails?.mode === 'included';
  const amount = included ? round(hill.customerTotal / (1 + result.fare.gstRate)) : hill.customerTotal;
  const charge: HillChargeSnapshot = {
    slab: hill.slab, stations: hill.stations, units: hill.units, amount, ...(included ? { grossAmount: hill.customerTotal } : {}), label: HILL_LINE_LABEL,
  };
  const fare = withHillChargeFare(result.fare, charge);
  // The older "Hill travel — billed at actuals" disclosure is replaced by this prepaid line.
  const lines = result.breakup.lines.filter((l) => l.key !== 'hillStation' && l.key !== 'hill').map((l) => {
    if (GST_KEYS.includes(l.key)) {
      const value = l.key === 'gst' ? fare.gst : fare.gstDetails?.[l.key as 'cgst' | 'sgst' | 'utgst' | 'igst'] ?? l.amount;
      return { ...l, amount: value };
    }
    return l;
  });
  const insert = lines.findIndex((l) => GST_KEYS.includes(l.key));
  lines.splice(insert < 0 ? lines.length : insert, 0, {
    key: 'hillStation', label: HILL_LINE_LABEL, amount, treatment: 'included' as const, detail: hillLineDetail(charge),
  });
  const extras = lines.filter((l) => l.treatment === 'extra');
  const partnerPaise = Math.round(hill.partnerTotal * 100);
  const partner = result.pricing.partner && partnerPaise > 0
    ? { ...result.pricing.partner, basePaise: result.pricing.partner.basePaise + partnerPaise, hillPaise: partnerPaise }
    : result.pricing.partner;
  return {
    ...result,
    fare,
    pricing: { ...result.pricing, hillStation: charge, partner },
    breakup: {
      ...result.breakup,
      lines,
      packageTotal: fare.total,
      knownExtras: round(extras.reduce((sum, l) => sum + (l.amount ?? 0), 0)),
      hasActualsExtras: extras.some((l) => l.amount === null),
    },
  };
}
