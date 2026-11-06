import type { PriceResult } from '../quote';
import { gstComponents } from './gst';
import type { FareBreakdown, FareExtras } from './types';
import type { ExtraChargesSnapshot } from './extraCharges';

export interface BookingAddOns { roofCarrier: boolean; pets: boolean }
export interface BookingAddOnCharges extends BookingAddOns { carrierCharge: number; petCharge: number; grossAmount?: number }

/** Clients send choices only. Prices always come from the saved vehicle category. */
export function bookingAddOnsOf(value: unknown): BookingAddOns {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return { roofCarrier: v.roofCarrier === true, pets: v.pets === true };
}

const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const rate = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? round(v) : 0;

/** The customer prepaid the carrier; the partner's configured reimbursement remains payable. */
export function ratesAfterPrepaidAddOns(snapshot: ExtraChargesSnapshot, carrierPrepaid: boolean): ExtraChargesSnapshot {
  return carrierPrepaid ? { ...snapshot, customer: { ...snapshot.customer, carrierPaise: 0 } } : snapshot;
}

/** Selected per-trip charges are billed once and snapshotted, independently of later price edits. */
export function withBookingAddOns(result: PriceResult, selection: unknown, rates?: FareExtras, commonPetCharge = 0): PriceResult {
  const selected = bookingAddOnsOf(selection);
  if (!selected.roofCarrier && !selected.pets) return result;
  const included = result.fare.gstDetails?.mode === 'included';
  const taxRate = result.fare.gstRate;
  const net = (v: number) => included ? round(v / (1 + taxRate)) : v;
  const carrier = selected.roofCarrier ? rate(rates?.carrierCharge) : 0;
  const pets = selected.pets ? rate(commonPetCharge) : 0;
  const charges: BookingAddOnCharges = { ...selected, carrierCharge: net(carrier), petCharge: net(pets) };
  if (included) charges.grossAmount = round(carrier + pets);
  const fare = withBookedAddOnFare(result.fare, charges);
  const { total, gst } = fare;
  const lines = result.breakup.lines.filter(l => !(selected.roofCarrier && l.key === 'carrier')).map(l => {
    if (['gst', 'cgst', 'sgst', 'utgst', 'igst'].includes(l.key)) {
      const amount = l.key === 'gst' ? gst : fare.gstDetails?.[l.key as 'cgst' | 'sgst' | 'utgst' | 'igst'] ?? l.amount;
      return { ...l, amount };
    }
    return l;
  });
  const insert = lines.findIndex(l => ['gst', 'cgst', 'sgst', 'utgst', 'igst'].includes(l.key));
  const billed = [
    ...(selected.roofCarrier ? [{ key: 'carrierAddon', label: 'Roof carrier', amount: charges.carrierCharge, treatment: 'included' as const, detail: 'Selected add-on · per trip' }] : []),
    ...(selected.pets ? [{ key: 'petAddon', label: 'Pet travel', amount: charges.petCharge, treatment: 'included' as const, detail: 'Selected add-on · per trip' }] : []),
  ];
  lines.splice(insert < 0 ? lines.length : insert, 0, ...billed);
  const extras = lines.filter(l => l.treatment === 'extra');
  return { ...result, fare, pricing: { ...result.pricing, bookingAddOns: charges }, breakup: { ...result.breakup, lines,
    packageTotal: total, knownExtras: round(extras.reduce((sum, l) => sum + (l.amount ?? 0), 0)), hasActualsExtras: extras.some(l => l.amount === null),
  } };
}

/** Keep the originally agreed add-on prices when actual distance is billed. */
export function withBookedAddOnFare(source: FareBreakdown, charges?: BookingAddOnCharges): FareBreakdown {
  if (!charges || (!charges.roofCarrier && !charges.pets)) return source;
  const extra = round(charges.carrierCharge + charges.petCharge);
  const taxableAmount = round(source.taxableAmount + extra);
  const total = source.gstDetails?.mode === 'included'
    ? round(source.total + (charges.grossAmount ?? round(extra * (1 + source.gstRate))))
    : round(taxableAmount + round(taxableAmount * source.gstRate));
  const gst = round(total - taxableAmount);
  return { ...source, addOns: charges, subtotal: round(source.subtotal + extra), taxableAmount, total, gst,
    ...(source.subtotalBeforeAdjustment !== undefined ? { subtotalBeforeAdjustment: round(source.subtotalBeforeAdjustment + extra) } : {}),
    ...(source.gstDetails ? { gstDetails: { ...source.gstDetails, ...gstComponents(gst, source.gstDetails.split) } } : {}),
  };
}
