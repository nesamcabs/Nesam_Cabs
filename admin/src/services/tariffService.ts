import { useEffect, useState } from "react";
import { subscribeToDocument } from "./adminFirestoreService";

/** Vehicle classes the tariff prices. Innova has its own rates only once saved; until then it is priced at the SUV rates. */
// "suv" is SUV 6+1 and "suv7" is SUV 7+1; a class with no rates of its own (Innova, SUV 7+1) uses the SUV rates.
export type TariffClass = "sedan" | "suv" | "suv7" | "innova" | "crysta";
export const TARIFF_CLASSES: readonly TariffClass[] = ["sedan", "suv", "suv7", "innova", "crysta"];
export const FALLS_BACK_TO_SUV = (c: TariffClass): boolean => c === "innova" || c === "suv7";
export const CLASS_LABEL: Record<TariffClass, string> = { sedan: "Sedan", suv: "SUV 6+1", suv7: "SUV 7+1", innova: "Innova", crysta: "Innova Crysta" };

export const RENTAL_HOURS = [4, 6, 8, 10, 12] as const;
/** Minimum rental hours of a category that has none saved yet (the server applies the same default). */
export const DEFAULT_RENTAL_MIN_HOURS: Record<TariffClass, number> = { sedan: 4, suv: 4, suv7: 4, innova: 4, crysta: 10 };

export interface OneWayRates { customerRate: number; customerBata: number; partnerRate: number; partnerBata: number }
export interface RoundTripRates extends OneWayRates { minKmPerDay: number }
export interface OutstationExtra { extraKmRate: number; waitingPerHour: number }
export interface LocalFare { minKm: number; customerRate: number; partnerRate: number; extraKmRate: number; waitingPerHour: number; enabled: boolean }
export interface RentalPackage { customerFare: number; partnerPayout: number; includedKm: number; extraKmRate: number; extraHourRate: number; gstMode: "included" | "excluded"; enabled: boolean }
export interface Zone { id: string; name: string; lat: number; lng: number; radiusKm: number }

/** Waiting / hill / roof-carrier rates of one side, in rupees. Absent = not configured; 0 = explicit "no charge". */
export interface ExtraChargeSide { waitingPerHour?: number; hill?: number; carrier?: number }
export interface ExtraChargeRow { customer?: ExtraChargeSide; partner?: ExtraChargeSide }
/** tariff_v2.extraCharges: keyed by the real vehicle category id; `version` counts saves of this section only. */
export interface ExtraCharges { version?: number; freeWaitingMinutes?: number; waitingRoundingMinutes?: number; waitingRoundingScope?: "per_stop" | "combined"; taxTreatment?: "no_gst" | "tariff_gst"; categories?: Record<string, ExtraChargeRow> }

/** Brand identifier used across booking portals and admin. */
export type BrandId = "nesam" | "people_taxi" | "onewaycarrentals";
export const BRANDS: { id: BrandId; name: string; tag: string }[] = [
  { id: "nesam", name: "NESAM", tag: "Company Core" },
  { id: "people_taxi", name: "People Taxi", tag: "Blue Transit" },
  { id: "onewaycarrentals", name: "One Way Car Rentals", tag: "Emerald Drops" },
];

export const BRAND_LABELS: Record<BrandId, string> = {
  nesam: "NESAM",
  people_taxi: "People Taxi",
  onewaycarrentals: "One Way Car Rentals",
};

/** Services with their own rates in the fare workspace. */
export const WORKSPACE_SERVICES = ["One Way", "Round Trip", "Airport Taxi", "Local Rental", "Multicity"] as const;
export type WorkspaceService = (typeof WORKSPACE_SERVICES)[number];
export type FareWorkspaceScope = { brand: BrandId | "common"; service: WorkspaceService };

export const BRAND_SUPPORTED_SERVICES: Record<BrandId, readonly WorkspaceService[]> = {
  nesam: ["One Way", "Round Trip", "Airport Taxi", "Local Rental", "Multicity"],
  people_taxi: ["One Way", "Round Trip", "Airport Taxi", "Local Rental", "Multicity"],
  onewaycarrentals: ["One Way", "Round Trip", "Airport Taxi", "Local Rental", "Multicity"],
};

export interface BrandFareOverride {
  partnerWaitingPerHour?: number;
  partnerHillCharge?: number;
  partnerCarrierCharge?: number;
  freeWaitingMinutes?: number;
  waitingRoundingMinutes?: number;
  waitingRoundingScope?: 'per_stop' | 'combined';
  taxTreatment?: 'no_gst' | 'tariff_gst';
  customerRate?: number;
  partnerRate?: number;
  customerBase?: number;
  partnerBase?: number;
  minKm?: number;
  minKmPerDay?: number;
  customerBata?: number;
  cngCustomerRate?: number;
  cngCustomerBata?: number;
  cngPartnerRate?: number;
  cngPartnerBata?: number;
  cngExtraKmRate?: number;
  cngMinKmPerDay?: number;
  partnerBata?: number;
  extraKmRate?: number;
  waitingPerHour?: number;
  hillCharge?: number;
  carrierCharge?: number;
  rentalPackages?: Record<string, { customerFare?: number; partnerPayout?: number; includedKm?: number; extraKmRate?: number; extraHourRate?: number }>;
  minRentalHours?: number;
  enabled?: boolean;
}

/** business_config/tariff_v2 as stored. Anything absent is "not configured" — never zero. */
export interface FareGstRule { supplierState: string; rate: number; mode: 'included' | 'excluded'; classification: 'passenger' | 'rental'; reference: string }
export interface FareGstPolicy { default?: FareGstRule; states?: Record<string, FareGstRule> }
export interface Tariff {
  fareGst?: Record<string, Record<string, FareGstPolicy>>;
  version?: number;
  enabled?: boolean;
  gstRate?: number;
  oneWay?: { minKm?: number; classes?: Partial<Record<TariffClass, Partial<OneWayRates>>> };
  roundTrip?: { maxDays?: number; classes?: Partial<Record<TariffClass, Partial<RoundTripRates>>> };
  cityDrop?: { baseKm?: number; zones?: Zone[] };
  outstationExtras?: Partial<Record<TariffClass, Partial<OutstationExtra>>>;
  oneWayExtras?: Partial<Record<TariffClass, Partial<OutstationExtra>>>;
  roundTripExtras?: Partial<Record<TariffClass, Partial<OutstationExtra>>>;
  airport?: { customerBase?: number; partnerBase?: number };
  localPickupDrop?: Record<string, { cityName?: string; classes?: Partial<Record<TariffClass, Partial<LocalFare>>> }>;
  rentalPackages?: Partial<Record<TariffClass, { minHours?: number; packages?: Partial<Record<string, Partial<RentalPackage>>> }>>;
  extraCharges?: ExtraCharges;
  brandOverrides?: Partial<Record<string, Partial<Record<string, Partial<Record<TariffClass, BrandFareOverride>>>>>>;
  /** Display only: the % shown as a higher struck-out price, by brand then service. */
  displayMarkup?: Record<string, Record<string, number>>;
}

/** Journey-specific rates take precedence; old shared rates remain a backwards-compatible fallback. */
export function outstationExtraFor(t: Tariff | null | undefined, cls: TariffClass, trip: "One Way" | "Round Trip") {
  const specific = trip === "One Way" ? t?.oneWayExtras : t?.roundTripExtras;
  return specific?.[cls] ?? t?.outstationExtras?.[cls]
    ?? (FALLS_BACK_TO_SUV(cls) ? specific?.suv ?? t?.outstationExtras?.suv : undefined);
}

/** Live tariff document: undefined = loading, null = nothing saved yet. */
export function useTariff(): { tariff: Tariff | null | undefined; error: string | null } {
  const [tariff, setTariff] = useState<Tariff | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeToDocument<Tariff>("business_config/tariff_v2", (t) => { setTariff(t); setError(null); }, setError), []);
  return { tariff, error };
}

export const rentalMinHours = (t: Tariff | null | undefined, cls: TariffClass): number => t?.rentalPackages?.[cls]?.minHours ?? DEFAULT_RENTAL_MIN_HOURS[cls];

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const inr = (n: unknown): string => (finite(n) ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");

/** A saved local fare is usable only when every field is a valid number (the server drops anything else). */
export function validLocalFare(f: Partial<LocalFare> | undefined): f is LocalFare {
  return !!f && [f.minKm, f.customerRate, f.partnerRate, f.extraKmRate].every((v) => finite(v) && v > 0) && finite(f.waitingPerHour) && f.waitingPerHour >= 0 && typeof f.enabled === "boolean";
}

export function validPackage(p: Partial<RentalPackage> | undefined): p is RentalPackage {
  return !!p && [p.customerFare, p.partnerPayout, p.includedKm, p.extraKmRate, p.extraHourRate].every((v) => finite(v) && v > 0) && (p.gstMode === "included" || p.gstMode === "excluded") && typeof p.enabled === "boolean";
}

export type RateSource = "common" | "override";

export interface RateValue {
  value: number | undefined;
  source: RateSource;
  label: string;
  isExplicitZero: boolean;
}

/** Resolves the effective value and whether it originates from a Brand override or the Common baseline. */
export function resolveRate(
  tariff: Tariff | null | undefined,
  brandId: BrandId | "common",
  service: WorkspaceService,
  cls: TariffClass,
  field: keyof BrandFareOverride,
  commonValue: number | undefined
): RateValue {
  const shared = tariff?.brandOverrides?.common?.[service]?.[cls]?.[field];
  if (typeof shared === "number" && Number.isFinite(shared)) commonValue = shared;
  if (brandId === "common") {
    return {
      value: commonValue,
      source: "common",
      label: "Common baseline",
      isExplicitZero: commonValue === 0,
    };
  }

  const brandOverride = tariff?.brandOverrides?.[brandId]?.[service]?.[cls];
  const overrideVal = brandOverride ? (brandOverride[field] as number | undefined) : undefined;

  if (typeof overrideVal === "number" && Number.isFinite(overrideVal)) {
    return {
      value: overrideVal,
      source: "override",
      label: `${BRAND_LABELS[brandId]} override`,
      isExplicitZero: overrideVal === 0,
    };
  }

  return {
    value: commonValue,
    source: "common",
    label: "Common rate (inherited)",
    isExplicitZero: commonValue === 0,
  };
}

/** Identifies which brands still inherit the common value for a specific service, category and field. */
export function getInheritingBrands(
  tariff: Tariff | null | undefined,
  service: WorkspaceService,
  cls: TariffClass,
  field: keyof BrandFareOverride
): { inheriting: string[]; overridden: { brand: string; value: number }[] } {
  const inheriting: string[] = [];
  const overridden: { brand: string; value: number }[] = [];

  for (const b of BRANDS) {
    const val = tariff?.brandOverrides?.[b.id]?.[service]?.[cls]?.[field] as number | undefined;
    if (typeof val === "number" && Number.isFinite(val)) {
      overridden.push({ brand: b.name, value: val });
    } else {
      inheriting.push(b.name);
    }
  }

  return { inheriting, overridden };
}
