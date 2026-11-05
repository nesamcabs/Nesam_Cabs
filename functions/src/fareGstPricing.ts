import { HttpsError } from 'firebase-functions/v2/https';
import { fareServiceKey } from './fareScope';
import { gstSplit, gstState, withFareGst, type GstSnapshot } from './domain/gst';
import { gstOn, istDate, matchFixedRoute, paise, r2, scopedTariffForBrand, taxableFromInclusivePaise, type TariffConfig } from './domain/tariff';
import type { PriceInput, PriceResult } from './quote';

export function fareGstFor(i: PriceInput): GstSnapshot | null {
  return fareGstForScope({ ...i, service: fareServiceKey(i.tripType) });
}

/** Shared by ordinary bookings and travel-desk Multicity quotes. */
export function fareGstForScope(i: { tariff: PriceInput['tariff']; brand?: string; service: string; boardingState?: string; recipientState?: string; recipientAddressState?: string }): GstSnapshot | null {
  const service = i.service;
  const common = i.tariff?.fareGst?.common?.[service], brand = i.brand ? i.tariff?.fareGst?.[i.brand]?.[service] : undefined;
  if (!common && !brand) return defaultFareGst(i.tariff);
  const boardingState = gstState(i.boardingState);
  if (!boardingState && (Object.keys(common?.states ?? {}).length || Object.keys(brand?.states ?? {}).length)) {
    throw new HttpsError('failed-precondition', 'State-specific GST requires a verified pickup state. Select a master location or contact the booking desk.');
  }
  const rule = brand?.states?.[boardingState] ?? brand?.default ?? common?.states?.[boardingState] ?? common?.default;
  if (!rule) return defaultFareGst(i.tariff);
  // Passenger transport: registered recipient's state, otherwise embarkation. Rental: recipient
  // location on record, otherwise supplier location (domestic general place-of-supply rule).
  const placeOfSupply = gstState(i.recipientState) || (rule.classification === 'rental' ? gstState(i.recipientAddressState) || rule.supplierState : boardingState);
  const { reference: _internalReference, ...publicRule } = rule;
  return { ...publicRule, boardingState, placeOfSupply, split: gstSplit(rule.supplierState, placeOfSupply) };
}

/**
 * With no GST rule saved for a service, the tariff's own rate (5%) is still INCLUDED in the fare: the amount worked out
 * from the rates is what the customer pays, and the GST inside it is shown, never added on top. A rule saved in the admin
 * Fare GST settings (included or excluded, per state) always wins over this. Only for tariff pricing; the old category
 * engine used while no tariff is saved keeps its own arithmetic.
 */
function defaultFareGst(tariff: PriceInput['tariff']): GstSnapshot | null {
  if (!tariff) return null;
  return { rate: tariff.gstRate > 0 ? tariff.gstRate : 0.05, mode: 'included', classification: 'passenger', supplierState: '', boardingState: '', placeOfSupply: '', split: 'Pending verification' };
}

/** Calculate the entered amounts once, then extract included tax. Never change partner payouts. */
export function gstPricingInput(i: PriceInput, tax: GstSnapshot, klass: Parameters<typeof scopedTariffForBrand>[3]): PriceInput {
  let tariff: TariffConfig | null = i.tariff ? scopedTariffForBrand(i.tariff, i.brand, i.tripType, klass) : null;
  if (tariff) {
    const rentalPackages = Object.fromEntries(Object.entries(tariff.rentalPackages ?? {}).map(([cls, config]) => [cls, { ...config,
      packages: Object.fromEntries(Object.entries(config?.packages ?? {}).map(([hours, pkg]) => [hours, pkg ? { ...pkg, gstMode: 'excluded' as const } : pkg])),
    }]));
    tariff = { ...tariff, gstRate: 0, brandOverrides: undefined, rentalPackages };
  }
  // Route-specific and business contracts explicitly retain their own included/excluded setting.
  const normalizeRule = <T extends { customerFare: number; gstMode: 'included' | 'excluded' }>(r: T): T => ({ ...r,
    customerFare: r.gstMode === 'included' ? taxableFromInclusivePaise(paise(r.customerFare), tax.rate) / 100 : r.customerFare,
    gstMode: 'excluded',
  });
  const fixed = i.businessContract || (i.tripType === 'One Way' && i.pickup.id !== 'pin' && i.drop.id !== 'pin' && i.fixedRoutes?.length
    ? matchFixedRoute(i.fixedRoutes, { originId: i.pickup.id, destinationId: i.drop.id, categoryId: i.category.id, serviceId: i.serviceId ?? '', brand: i.brand, fareService: fareServiceKey(i.tripType), date: istDate(i.pickupAt.getTime()) }) : null);
  const multiplier = tax.mode === 'included' && !fixed ? 1 + tax.rate : 1;
  return { ...i, tariff,
    ...(i.discount !== undefined ? { discount: r2(i.discount * multiplier) } : {}),
    ...(i.adminDiscount?.type === 'fixed' ? { adminDiscount: { ...i.adminDiscount, value: r2(i.adminDiscount.value * multiplier) } } : {}),
    fixedRoutes: i.fixedRoutes?.map(normalizeRule),
    businessContract: i.businessContract ? { ...i.businessContract, rule: normalizeRule(i.businessContract.rule) } : i.businessContract,
  };
}

export function applyFareGst(r: PriceResult, tax: GstSnapshot): PriceResult {
  const explicit = ['fixed_route','business_contract_per_km'].includes(r.pricing.model);
  const included = tax.mode === 'included' && !explicit;
  const fare = withFareGst(r.fare, tax, included);
  const pricing: PriceResult['pricing'] = { ...r.pricing, gstRate: tax.rate, gst: tax, gstInFare: tax.mode === 'included' };
  if (included) {
    pricing.gstInclusiveBase = { packagePaise: r.pricing.packagePaise, customerRatePaise: r.pricing.customerRatePaise, customerBataPaise: r.pricing.customerBataPaise, extraKmRatePaise: r.pricing.extraKmRatePaise, discount: r.pricing.discount, adminAdjustment: r.pricing.adminAdjustment };
    for (const key of ['packagePaise','customerRatePaise','customerBataPaise','extraKmRatePaise','extraHourRatePaise','waitingPerHourPaise'] as const) {
      const value = pricing[key];
      if (typeof value === 'number') pricing[key] = taxableFromInclusivePaise(value, tax.rate);
    }
    pricing.discount = fare.discount;
    pricing.adminAdjustment = fare.adminAdjustment ?? 0;
  }
  if (pricing.businessGstMode === 'included' && pricing.businessCustomerRatePaise !== undefined) pricing.businessCustomerRatePaise = taxableFromInclusivePaise(pricing.businessCustomerRatePaise, tax.rate);
  if (pricing.businessGstMode) pricing.businessGstMode = 'excluded';
  return { ...r, fare, pricing };
}
