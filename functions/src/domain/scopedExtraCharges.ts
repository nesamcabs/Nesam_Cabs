import type { TariffClass, TariffConfig } from './tariff';
import { fareServiceKey } from '../fareScope';
import { extraChargesSnapshot } from './extraCharges';

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

