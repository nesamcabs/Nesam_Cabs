import { createHash } from 'crypto';
import { gstComponents, type GstSnapshot } from './gst';
import { istDate, paise, taxableFromInclusivePaise, type MulticityQuote, type PricingSnapshot } from './tariff';
import type { FareBreakdown } from './types';

/** Ordered route and schedule identity; quote/status changes do not change the itinerary. */
export function multicityFingerprint(e: Record<string, any>): string {
  const point = (p: any) => p ? [p.id || '', p.name || '', p.address || '', p.lat, p.lng] : null;
  return createHash('sha256').update(JSON.stringify({
    brand: e.brand || 'nesam', customerId: e.customerId || '', pickup: point(e.pickupPoint), drop: point(e.dropPoint),
    stops: (e.stops || []).map(point), itinerary: (e.itinerary || []).map(point),
    pickupAt: e.pickupAt?.toMillis?.() ?? null, tripEndAt: e.tripEndAt?.toMillis?.() ?? null,
  })).digest('hex');
}

export function multicityBookingAmounts(q: MulticityQuote, meta: {
  tariffVersion: number; tariffClass: PricingSnapshot['tariffClass']; brand: string; pickupMs: number; endMs: number; durationMin: number; gst: GstSnapshot | null;
}): { pricing: PricingSnapshot; fare: FareBreakdown } {
  const net = (value: number) => q.gstIncluded ? taxableFromInclusivePaise(value, q.gstRate) : value;
  const distanceFare = net(q.distancePaise) / 100;
  const fare: FareBreakdown = {
    baseFare: 0, distanceFare, timeFare: 0, nightCharge: 0,
    driverAllowance: Math.round(q.taxablePaise - net(q.distancePaise)) / 100, minimumFareAdjustment: 0,
    subtotal: q.taxablePaise / 100, discount: 0, taxableAmount: q.taxablePaise / 100, gstRate: q.gstRate,
    gst: q.gstPaise / 100, total: q.totalPaise / 100, distanceKm: q.totalKm, durationMin: meta.durationMin,
    perKmRate: net(paise(q.rates.customerRate)) / 100, perMinuteRate: 0,
    ...(meta.gst ? { gstDetails: { ...meta.gst, ...gstComponents(q.gstPaise / 100, meta.gst.split) } } : {}),
  };
  const pricing: PricingSnapshot = {
    schema: 2, source: 'tariff_v2', model: 'round_trip_calendar', tariffVersion: meta.tariffVersion,
    tariffClass: meta.tariffClass, brand: meta.brand, gstRate: q.gstRate, gstInFare: q.gstIncluded,
    ...(meta.gst ? { gst: meta.gst } : {}),
    quotedKm: q.totalKm, includedKm: q.billableKm, extraKmRatePaise: net(paise(q.rates.extraKmRate)),
    customerRatePaise: net(paise(q.rates.customerRate)), customerBataPaise: net(paise(q.rates.customerBata)),
    days: q.days, minKmPerDay: q.rates.minKmPerDay, packagePaise: q.taxablePaise,
    discount: 0, adminAdjustment: 0, adjustmentPercent: 0, adjustmentDirection: 'increase',
    partner: { mode: 'NORMAL_RATE', ratePaise: paise(q.rates.partnerRate), bataPaise: paise(q.rates.partnerBata), minKm: q.rates.minKmPerDay, days: q.days, basePaise: q.partnerPaise },
    ...(q.rates.waitingPerHour !== undefined ? { waitingPerHourPaise: net(paise(q.rates.waitingPerHour)) } : {}),
    pickupDate: istDate(meta.pickupMs), endDate: istDate(meta.endMs), gates: [],
  };
  return { pricing, fare };
}
