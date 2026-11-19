import type { TariffClass, TariffConfig } from './tariff';
import { fareServiceKey } from '../fareScope';
import { extraChargesSnapshot } from './extraCharges';

/**
 * The hill station charge a service sets on its own fare table (customer pays / partner gets, rupees per trip) for a vehicle class: the shared
 * and brand rows merged the same way as the other extras. Used by Multicity, which has no One-Way / Round-Trip slab of its own.
 */
export function scopedHillRates(tariff: TariffConfig | null, brand: string | undefined, service: string, klass: TariffClass | null, categoryId: string): { customer: number; partner: number } | null {
  const serviceKey = fareServiceKey(service);
  const shared = klass ? tariff?.brandOverrides?.common?.[serviceKey]?.[klass] : undefined;
  const branded = klass && brand ? tariff?.brandOverrides?.[brand]?.[serviceKey]?.[klass] : undefined;
  const ov = { ...shared, ...branded };
  const row = tariff?.extraCharges?.categories[categoryId];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const customer = num(ov.hillCharge !== undefined ? ov.hillCharge : row?.customer?.hill);
  const partner = num(ov.partnerHillCharge !== undefined ? ov.partnerHillCharge : row?.partner?.hill);
  return customer > 0 ? { customer, partner } : null;
}

/**
 * The roof carrier and pet travel add-ons a customer can tick, per trip, for one vehicle on one brand and service: what the customer pays and what the
 * partner gets. Each comes from the fare table (the brand's own value, else the shared one); when nothing is typed there the older settings still
 * apply: the vehicle category's carrier charge, and the common pet charge. The partner's pet amount has no older setting, so it is 0 until set.
 */
export function scopedAddOnRates(tariff: TariffConfig | null, brand: string | undefined, service: string, klass: TariffClass | null): { carrier: number; pet: number; partnerPet: number } {
  const serviceKey = fareServiceKey(service);
  const shared = klass ? tariff?.brandOverrides?.common?.[serviceKey]?.[klass] : undefined;
  const branded = klass && brand ? tariff?.brandOverrides?.[brand]?.[serviceKey]?.[klass] : undefined;
  const ov = { ...shared, ...branded };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.round(v * 100) / 100 : 0);
  return {
    carrier: num(ov.carrierCharge),
    pet: ov.petCharge !== undefined ? num(ov.petCharge) : num(tariff?.petCharge),
    partnerPet: num(ov.partnerPetCharge),
  };
}

/** Merge shared and brand extras identically for ordinary bookings and Multicity quotes. */
export function scopedExtraChargesSnapshot(tariff: TariffConfig | null, brand: string | undefined, service: string, klass: TariffClass | null, categoryId: string) {

  const serviceKey = fareServiceKey(service);
  const shared = klass ? tariff?.brandOverrides?.common?.[serviceKey]?.[klass] : undefined;
  const branded = klass && brand ? tariff?.brandOverrides?.[brand]?.[serviceKey]?.[klass] : undefined;
  const ov = { ...shared, ...branded };
  const cfg = tariff?.extraCharges;
  const baseRow = cfg?.categories[categoryId];
  const hasScopedExtras = ['waitingPerHour','hillCharge','carrierCharge','partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge','freeWaitingMinutes','waitingRoundingMinutes','waitingRoundingScope','taxTreatment'].some(key => ov[key as keyof typeof ov] !== undefined);
  const effectiveExtras = hasScopedExtras ? {
    ...cfg, version: cfg?.version ?? 0,
    ...(ov.freeWaitingMinutes !== undefined ? { freeWaitingMinutes: ov.freeWaitingMinutes } : {}),
    ...(ov.waitingRoundingMinutes !== undefined ? { waitingRoundingMinutes: ov.waitingRoundingMinutes } : {}),
    ...(ov.waitingRoundingScope !== undefined ? { waitingRoundingScope: ov.waitingRoundingScope } : {}),
    ...(ov.taxTreatment !== undefined ? { taxTreatment: ov.taxTreatment } : {}),
    categories: { ...cfg?.categories, [categoryId]: {
      customer: { ...baseRow?.customer,
        ...(ov.waitingPerHour !== undefined ? { waitingPerHour: ov.waitingPerHour } : {}),
        ...(ov.hillCharge !== undefined ? { hill: ov.hillCharge } : {}),
        ...(ov.carrierCharge !== undefined ? { carrier: ov.carrierCharge } : {}),
      }, partner: { ...baseRow?.partner,
        ...(ov.partnerWaitingPerHour !== undefined ? { waitingPerHour: ov.partnerWaitingPerHour } : {}),
        ...(ov.partnerHillCharge !== undefined ? { hill: ov.partnerHillCharge } : {}),
        ...(ov.partnerCarrierCharge !== undefined ? { carrier: ov.partnerCarrierCharge } : {}),
      },
    } },
  } : cfg;
  // Unconfigured timing/tax policies stay null in the snapshot and require review; never invent them.
  return extraChargesSnapshot(effectiveExtras, tariff?.version ?? 0, categoryId);
}

