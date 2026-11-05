import { gstComponents, withFareGst, validGstRule, type FareGstPolicies, type GstSnapshot } from './gst';
// Confirmed customer tariffs and normal partner rates (Tariff & Operations v2.0, 09 Oct 2026).
//
// Everything is computed in integer PAISE, so 13.50/km or 12.60/km never accumulate
// floating-point error. Customer totals are rounded half-up to the whole rupee (the
// existing fare engine's explicit rounding); partner entitlements keep paise.
//
// Only what is CONFIRMED is calculated. Unresolved items are gated, never guessed:
//   D01/D02 rental distance + partner overtime · D04 tax · D05 add-on units ·
//   D06 missing state rates · D07 multi-city · D08 fixed-route zones · D15 city boundaries.
// A missing rate is `null`, never zero.
import { FareBreakdown } from './types';
import { ExtraChargesConfig, ExtraChargesSnapshot, parseExtraCharges } from './extraCharges';

// 'suv' is SUV 6+1 and 'suv7' is SUV 7+1. Like Innova, a class with no rates of its own keeps using the SUV rates (see classRates).
export type TariffClass = 'sedan' | 'suv' | 'suv7' | 'innova' | 'crysta';
export const TARIFF_CLASSES: readonly TariffClass[] = ['sedan', 'suv', 'suv7', 'innova', 'crysta'];
/** Classes that price at the SUV rates until they have rates of their own. */
export const FALLS_BACK_TO_SUV = (c: TariffClass): boolean => c === 'innova' || c === 'suv7';

/**
 * One-way / round-trip / city-drop rates of a class. Tariffs saved before 'innova' existed priced Innova
 * as 'suv', so an Innova duty with no rate of its own keeps using the SUV rate (nothing changes until
 * an Innova rate is saved). The local-fare and rental-package sections never inherit.
 */
export function classRates<T>(m: Partial<Record<TariffClass, T>>, c: TariffClass): T | undefined {
  return m[c] ?? (FALLS_BACK_TO_SUV(c) ? m.suv : undefined);
}

/** Rupees → paise, rejecting anything that is not a finite non-negative number. */
export const paise = (rupees: number): number => Math.round(rupees * 100);
export const rupeesOf = (p: number): number => p / 100;
/** Half-up rounding of paise to a whole rupee, returned in rupees. */
export const roundRupee = (p: number): number => Math.floor(p / 100 + 0.5);

/** Money in rupees at paise precision (two decimals, half-up). */
export const r2 = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 100) / 100;
/** GST on a taxable amount, half-up to the paise. Integer arithmetic: 5% of 5,050.00 is exactly 252.50. */
export function gstOn(taxable: number, rate: number): number {
  const taxablePaise = Math.round(taxable * 100);
  const basisPoints = Math.round(rate * 10000);
  return Math.floor((taxablePaise * basisPoints + 5000) / 10000) / 100;
}

/** KM carry one decimal place; amount = km × rate, in paise, half-up. */
export function kmAmountPaise(km: number, ratePaise: number): number {
  const tenths = Math.round(km * 10);
  return Math.floor((tenths * ratePaise) / 10 + 0.5);
}

// ── Configuration ───────────────────────────────────────────────────────────

/** The CNG rate card of one vehicle class. All four rates together, or no CNG option; the extra-km rate falls back to the CNG customer rate. */
export interface CngRates { customerRate: number; customerBata: number; partnerRate: number; partnerBata: number; extraKmRate?: number; /** Round Trip: the daily minimum KM on the CNG card; absent = the class's normal daily minimum. */ minKmPerDay?: number }
export interface OneWayRates { customerRate: number; customerBata: number; partnerRate: number; partnerBata: number; cng?: CngRates }
export interface RoundTripRates extends OneWayRates { minKmPerDay: number }
export interface RentalRates { firstHour: number; laterHour: number; minHours: number; minTimeFare: number; partnerPerHour: number }
export interface CityDropRates { customerBase: number; customerExtraKm: number; partnerBase: number; partnerExtraKm: number }
export interface CityZone { id: string; name: string; lat: number; lng: number; radiusKm: number }

/** Outstation / round-trip usage beyond the package. Independent of the local-fare rates. */
export interface OutstationExtra { extraKmRate: number; waitingPerHour: number }
/** Airport base fare and partner base payout shared by every class (the older single setting). */
export interface AirportRates { customerBase: number; partnerBase: number }
/**
 * Airport transfer rates of one class, resolved Common → brand. The base fare covers the first `includedKm`; every KM beyond
 * is charged at `extraKmRate` (customer) and paid at `partnerExtraKmRate` (partner). Any rate missing = not configured.
 */
export interface AirportClassRates { customerBase?: number; partnerBase?: number; includedKm?: number; extraKmRate?: number; partnerExtraKmRate?: number; waitingPerHour?: number }
/** Local Pickup & Drop fare of one vehicle class in one city: max(road km, minKm) × rate. */
export interface LocalFareEntry { minKm: number; customerRate: number; partnerRate: number; extraKmRate: number; waitingPerHour: number; enabled: boolean }
/** Keyed by the canonical City record id in `locations`; `cityName` is a display copy only. */
export interface LocalCityFares { cityName: string; classes: Partial<Record<TariffClass, LocalFareEntry>> }
export const RENTAL_HOURS = [4, 6, 8, 10, 12] as const;
export type RentalHours = (typeof RENTAL_HOURS)[number];
export type GstMode = 'included' | 'excluded';
export interface RentalPackage { customerFare: number; partnerPayout: number; includedKm: number; extraKmRate: number; extraHourRate: number; gstMode: GstMode; enabled: boolean }
/** `packages` is keyed by the hour count ("4", "6", …). */
export interface RentalClassConfig { minHours?: number; packages: Partial<Record<string, RentalPackage>> }
/** Minimum rental hours of a category that has none saved yet. */
export const DEFAULT_RENTAL_MIN_HOURS: Readonly<Record<TariffClass, number>> = { sedan: 4, suv: 4, suv7: 4, innova: 4, crysta: 10 };

/** Brand-scoped fare override for a specific service and vehicle class. */
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
  partnerBata?: number;
  extraKmRate?: number;
  /** CNG rate card (One Way and Round Trip): a brand can set its own, anything not set inherits Common. */
  cngCustomerRate?: number;
  cngCustomerBata?: number;
  cngPartnerRate?: number;
  cngPartnerBata?: number;
  cngExtraKmRate?: number;
  cngMinKmPerDay?: number;
  waitingPerHour?: number;
  hillCharge?: number;
  carrierCharge?: number;
  rentalPackages?: Record<string, { customerFare?: number; partnerPayout?: number; includedKm?: number; extraKmRate?: number; extraHourRate?: number }>;
  minRentalHours?: number;
  enabled?: boolean;
}

function parseFareGst(value: unknown): FareGstPolicies | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: FareGstPolicies = {};
  for (const brand of ['common','nesam','people_taxi','onewaycarrentals']) {
    const services = (value as FareGstPolicies)[brand];
    if (!services) continue;
    for (const service of ['One Way','Round Trip','Airport Taxi','Local Rental','Multicity']) {
      const policy = services[service];
      if (!policy) continue;
      const states = Object.fromEntries(Object.entries(policy.states ?? {}).filter(([code, rule]) => /^[0-9]{2}$/.test(code) && validGstRule(rule)));
      const entry = { ...(validGstRule(policy.default) ? { default: policy.default } : {}), ...(Object.keys(states).length ? { states } : {}) };
      if (Object.keys(entry).length) (result[brand] ??= {})[service] = entry;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

export interface TariffConfig {
  fareGst?: FareGstPolicies;
  /** Rupee amounts. Absent = not configured (never zero). */
  version: number;
  enabled: boolean;
  gstRate: number;
  oneWay: { minKm: number; classes: Partial<Record<TariffClass, OneWayRates>> };
  roundTrip: { maxDays: number; classes: Partial<Record<TariffClass, RoundTripRates>> };
  rental: { classes: Partial<Record<TariffClass, RentalRates>> };
  cityDrop: { baseKm: number; zones: CityZone[]; classes: Partial<Record<TariffClass, CityDropRates>> };
  outstationExtras?: Partial<Record<TariffClass, OutstationExtra>>;
  oneWayExtras?: Partial<Record<TariffClass, OutstationExtra>>;
  roundTripExtras?: Partial<Record<TariffClass, OutstationExtra>>;
  airport?: AirportRates;
  /** Derived by scopedTariffForBrand from the Common / brand Airport Taxi settings; never stored. */
  airportClasses?: Partial<Record<TariffClass, AirportClassRates>>;
  localPickupDrop?: Record<string, LocalCityFares>;
  rentalPackages?: Partial<Record<TariffClass, RentalClassConfig>>;
  /** Waiting, hill and roof carrier rates by vehicle category (see domain/extraCharges.ts). */
  extraCharges?: ExtraChargesConfig;
  /** Display only: % shown as a higher, struck-out price above a fare, by Brand -> Service. It never changes what is charged. */
  displayMarkup?: Record<string, Record<string, number>>;
  /** Brand-specific fare overrides organized by Brand -> Service -> Category. */
  brandOverrides?: Partial<Record<string, Partial<Record<string, Partial<Record<TariffClass, BrandFareOverride>>>>>>;
}

/** The values the owner confirmed on 09 Oct 2026 (Crysta one-way bata ₹600 supersedes ₹500). */
export const CONFIRMED_TARIFF_V2: Omit<TariffConfig, 'version' | 'enabled'> = {
  gstRate: 0.05,
  oneWay: {
    minKm: 130,
    classes: {
      sedan: { customerRate: 15, customerBata: 400, partnerRate: 13.5, partnerBata: 300 },
      suv: { customerRate: 20, customerBata: 400, partnerRate: 18, partnerBata: 300 },
      crysta: { customerRate: 26, customerBata: 600, partnerRate: 24, partnerBata: 400 },
    },
  },
  roundTrip: {
    maxDays: 30,
    classes: {
      sedan: { customerRate: 14, customerBata: 400, partnerRate: 12.6, partnerBata: 300, minKmPerDay: 250 },
      suv: { customerRate: 19, customerBata: 400, partnerRate: 17.1, partnerBata: 300, minKmPerDay: 250 },
      crysta: { customerRate: 22, customerBata: 500, partnerRate: 20, partnerBata: 400, minKmPerDay: 300 },
    },
  },
  rental: {
    classes: {
      sedan: { firstHour: 500, laterHour: 350, minHours: 4, minTimeFare: 1550, partnerPerHour: 250 },
      suv: { firstHour: 700, laterHour: 450, minHours: 5, minTimeFare: 2500, partnerPerHour: 400 },
      crysta: { firstHour: 800, laterHour: 600, minHours: 10, minTimeFare: 6200, partnerPerHour: 500 },
    },
  },
  cityDrop: {
    baseKm: 20,
    zones: [],
    classes: {
      sedan: { customerBase: 800, customerExtraKm: 35, partnerBase: 500, partnerExtraKm: 25 },
      suv: { customerBase: 1200, customerExtraKm: 50, partnerBase: 700, partnerExtraKm: 35 },
      crysta: { customerBase: 2000, customerExtraKm: 70, partnerBase: 1200, partnerExtraKm: 50 },
    },
  },
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function rateMap<T extends object>(v: unknown, keys: readonly (keyof T)[]): Partial<Record<TariffClass, T>> {
  const out: Partial<Record<TariffClass, T>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const c of TARIFF_CLASSES) {
    const r = (v as Record<string, unknown>)[c];
    if (!r || typeof r !== 'object') continue;
    // A class with any missing rate is left out entirely: a partial rate card is not a price.
    if (keys.every((k) => isNum((r as Record<string, unknown>)[k as string]))) out[c] = r as T;
  }
  return out;
}

const isPos = (v: unknown): v is number => isNum(v) && v > 0;

/** Keeps a class's CNG rate card only when it is complete; a partial card is dropped, never priced at ₹0. */
function sanitizeCng<T extends OneWayRates>(m: Partial<Record<TariffClass, T>>): Partial<Record<TariffClass, T>> {
  for (const c of TARIFF_CLASSES) {
    const r = m[c];
    if (!r || !('cng' in r)) continue;
    const g = (r as { cng?: Partial<CngRates> }).cng;
    const { cng: _drop, ...rest } = r as T & { cng?: unknown };
    m[c] = (g && isPos(g.customerRate) && isNum(g.customerBata) && isNum(g.partnerRate) && isNum(g.partnerBata)
      ? { ...rest, cng: { customerRate: g.customerRate, customerBata: g.customerBata, partnerRate: g.partnerRate, partnerBata: g.partnerBata, ...(isPos(g.extraKmRate) ? { extraKmRate: g.extraKmRate } : {}), ...(isPos(g.minKmPerDay) ? { minKmPerDay: g.minKmPerDay } : {}) } }
      : rest) as unknown as T;
  }
  return m;
}

function parseLocalFare(r: any): LocalFareEntry | null {
  if (!r || typeof r !== 'object') return null;
  // A rate that is missing, zero or malformed is "not configured" — it is never priced as ₹0.
  if (!isPos(r.minKm) || !isPos(r.customerRate) || !isPos(r.partnerRate) || !isPos(r.extraKmRate) || !isNum(r.waitingPerHour)) return null;
  return { minKm: r.minKm, customerRate: r.customerRate, partnerRate: r.partnerRate, extraKmRate: r.extraKmRate, waitingPerHour: r.waitingPerHour, enabled: r.enabled === true };
}

function parseLocalPickupDrop(v: unknown): Record<string, LocalCityFares> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Record<string, LocalCityFares> = {};
  for (const [cityId, raw] of Object.entries(v as Record<string, any>)) {
    if (!cityId || !raw || typeof raw !== 'object') continue;
    const classes: Partial<Record<TariffClass, LocalFareEntry>> = {};
    for (const c of TARIFF_CLASSES) {
      const e = parseLocalFare(raw.classes?.[c]);
      if (e) classes[c] = e;
    }
    out[cityId] = { cityName: typeof raw.cityName === 'string' ? raw.cityName : cityId, classes };
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseRentalPackage(r: any): RentalPackage | null {
  if (!r || typeof r !== 'object') return null;
  if (!isPos(r.customerFare) || !isPos(r.partnerPayout) || !isPos(r.includedKm) || !isPos(r.extraKmRate) || !isPos(r.extraHourRate)) return null;
  if (r.gstMode !== 'included' && r.gstMode !== 'excluded') return null;
  return { customerFare: r.customerFare, partnerPayout: r.partnerPayout, includedKm: r.includedKm, extraKmRate: r.extraKmRate, extraHourRate: r.extraHourRate, gstMode: r.gstMode, enabled: r.enabled === true };
}

function parseRentalPackages(v: unknown): Partial<Record<TariffClass, RentalClassConfig>> | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const out: Partial<Record<TariffClass, RentalClassConfig>> = {};
  for (const c of TARIFF_CLASSES) {
    const raw = (v as Record<string, any>)[c];
    if (!raw || typeof raw !== 'object') continue;
    const packages: Partial<Record<string, RentalPackage>> = {};
    for (const h of RENTAL_HOURS) {
      const p = parseRentalPackage(raw.packages?.[String(h)]);
      if (p) packages[String(h)] = p;
    }
    const min = raw.minHours;
    out[c] = { ...(Number.isInteger(min) && min >= 1 && min <= 12 ? { minHours: min } : {}), packages };
  }
  return Object.keys(out).length ? out : undefined;
}

function parseBrandOverrides(raw: unknown): TariffConfig['brandOverrides'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: NonNullable<TariffConfig['brandOverrides']> = {};
  for (const [brand, services] of Object.entries(raw as Record<string, any>)) {
    if (!services || typeof services !== 'object') continue;
    out[brand] = {};
    for (const [service, classes] of Object.entries(services as Record<string, any>)) {
      if (!classes || typeof classes !== 'object') continue;
      out[brand][service] = {};
      for (const [cls, rates] of Object.entries(classes as Record<string, any>)) {
        if (!rates || typeof rates !== 'object') continue;
        const r: BrandFareOverride = {};
        for (const key of ['partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge','freeWaitingMinutes','waitingRoundingMinutes'] as const) if (isNum(rates[key])) r[key] = rates[key];
        if (rates.waitingRoundingScope === 'per_stop' || rates.waitingRoundingScope === 'combined') r.waitingRoundingScope = rates.waitingRoundingScope;
        if (rates.taxTreatment === 'no_gst' || rates.taxTreatment === 'tariff_gst') r.taxTreatment = rates.taxTreatment;
        if (isNum(rates.customerRate)) r.customerRate = rates.customerRate;
        if (isNum(rates.partnerRate)) r.partnerRate = rates.partnerRate;
        if (isNum(rates.customerBase)) r.customerBase = rates.customerBase;
        if (isNum(rates.partnerBase)) r.partnerBase = rates.partnerBase;
        if (isNum(rates.minKm)) r.minKm = rates.minKm;
        if (isNum(rates.minKmPerDay)) r.minKmPerDay = rates.minKmPerDay;
        if (isNum(rates.customerBata)) r.customerBata = rates.customerBata;
        if (isNum(rates.partnerBata)) r.partnerBata = rates.partnerBata;
        if (isNum(rates.extraKmRate)) r.extraKmRate = rates.extraKmRate;
        for (const key of ['cngCustomerRate', 'cngCustomerBata', 'cngPartnerRate', 'cngPartnerBata', 'cngExtraKmRate', 'cngMinKmPerDay'] as const) if (isNum(rates[key])) r[key] = rates[key];
        if (isNum(rates.waitingPerHour)) r.waitingPerHour = rates.waitingPerHour;
        if (isNum(rates.hillCharge)) r.hillCharge = rates.hillCharge;
        if (isNum(rates.carrierCharge)) r.carrierCharge = rates.carrierCharge;
        if (isNum(rates.minRentalHours)) r.minRentalHours = rates.minRentalHours;
        if (typeof rates.enabled === 'boolean') r.enabled = rates.enabled;
        if (rates.rentalPackages && typeof rates.rentalPackages === 'object') {
          const pkgs: NonNullable<BrandFareOverride['rentalPackages']> = {};
          for (const h of RENTAL_HOURS) {
            const p = rates.rentalPackages[String(h)];
            if (!p || typeof p !== 'object') continue;
            const row: NonNullable<BrandFareOverride['rentalPackages']>[string] = {};
            for (const f of ['customerFare', 'partnerPayout', 'includedKm', 'extraKmRate', 'extraHourRate'] as const) if (isPos(p[f])) row[f] = p[f];
            if (Object.keys(row).length) pkgs[String(h)] = row;
          }
          if (Object.keys(pkgs).length) r.rentalPackages = pkgs;
        }
        out[brand][service][cls as TariffClass] = r;
      }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Resolves a brand-scoped tariff configuration.
 * Brand-specific overrides take precedence over the shared baseline rates.
 * Missing overrides cleanly inherit the common rate (never ₹0).
 * Explicit zero values in overrides are preserved where business rules permit.
 */
export function scopedTariffForBrand(
  base: TariffConfig,
  brand: string | undefined,
  service: string,
  selectedClass?: TariffClass | null
): TariffConfig {
  // A service-specific common override never rewrites the older all-service baseline.
  if (brand !== 'common' && base.brandOverrides?.common) base = scopedTariffForBrand(base, 'common', service, selectedClass);
  if (!brand || !base.brandOverrides || !base.brandOverrides[brand]) {
    return base;
  }

  const brandServices = base.brandOverrides[brand];
  const serviceKey =
    service === 'One Way' || service === 'Outstation'
      ? 'One Way'
      : service === 'Airport Taxi' || service === 'Airport'
      ? 'Airport Taxi'
      : service === 'Local Rental' || service === 'Rental'
      ? 'Local Rental'
      : service === 'Multicity'
      ? 'Multicity'
      : service === 'Round Trip'
      ? 'Round Trip'
      : service;

  const overrides = brandServices[serviceKey];
  if (!overrides || !Object.keys(overrides).length) {
    return base;
  }

  // Clone base config and apply scoped overrides. A field the scope does not set inherits the baseline; a rate card
  // that is still incomplete after inheriting is left unconfigured (the quote is refused), never priced at ₹0.
  const next: TariffConfig = {
    ...base,
    oneWay: { ...base.oneWay, classes: { ...base.oneWay.classes } },
    roundTrip: { ...base.roundTrip, classes: { ...base.roundTrip.classes } },
    outstationExtras: { ...(base.outstationExtras ?? {}) },
    oneWayExtras: { ...(base.oneWayExtras ?? {}) },
    roundTripExtras: { ...(base.roundTripExtras ?? {}) },
    airportClasses: { ...(base.airportClasses ?? {}) },
    rentalPackages: { ...(base.rentalPackages ?? {}) },
  };
  const pick = <K extends keyof BrandFareOverride>(ov: BrandFareOverride, key: K, inherited: BrandFareOverride[K] | undefined) => (ov[key] !== undefined ? ov[key] : inherited);

  for (const cls of (selectedClass ? [selectedClass] : TARIFF_CLASSES)) {
    const ov = overrides[cls];
    if (!ov) continue;
    if (serviceKey === 'One Way' || serviceKey === 'Round Trip') {
      const trip = serviceKey;
      const common = trip === 'One Way' ? classRates(base.oneWay.classes, cls) : classRates(base.roundTrip.classes, cls);
      if (ov.customerRate !== undefined || ov.partnerRate !== undefined || ov.customerBata !== undefined || ov.partnerBata !== undefined || ov.cngCustomerRate !== undefined || ov.cngCustomerBata !== undefined || ov.cngPartnerRate !== undefined || ov.cngPartnerBata !== undefined || ov.cngExtraKmRate !== undefined || ov.cngMinKmPerDay !== undefined || (trip === 'Round Trip' && ov.minKmPerDay !== undefined)) {
        const merged = {
          customerRate: pick(ov, 'customerRate', common?.customerRate),
          partnerRate: pick(ov, 'partnerRate', common?.partnerRate),
          customerBata: pick(ov, 'customerBata', common?.customerBata),
          partnerBata: pick(ov, 'partnerBata', common?.partnerBata),
        };
        // The CNG card inherits field by field from Common; it is kept only when complete.
        const cngMerged = {
          customerRate: pick(ov, 'cngCustomerRate', common?.cng?.customerRate),
          customerBata: pick(ov, 'cngCustomerBata', common?.cng?.customerBata),
          partnerRate: pick(ov, 'cngPartnerRate', common?.cng?.partnerRate),
          partnerBata: pick(ov, 'cngPartnerBata', common?.cng?.partnerBata),
          extraKmRate: pick(ov, 'cngExtraKmRate', common?.cng?.extraKmRate),
          minKmPerDay: trip === 'Round Trip' ? pick(ov, 'cngMinKmPerDay', common?.cng?.minKmPerDay) : undefined,
        };
        const cng: CngRates | undefined = isPos(cngMerged.customerRate) && isNum(cngMerged.customerBata) && isNum(cngMerged.partnerRate) && isNum(cngMerged.partnerBata)
          ? { customerRate: cngMerged.customerRate, customerBata: cngMerged.customerBata, partnerRate: cngMerged.partnerRate, partnerBata: cngMerged.partnerBata, ...(isPos(cngMerged.extraKmRate) ? { extraKmRate: cngMerged.extraKmRate } : {}), ...(isPos(cngMerged.minKmPerDay) ? { minKmPerDay: cngMerged.minKmPerDay } : {}) }
          : undefined;
        if (trip === 'One Way') {
          if (isNum(merged.customerRate) && isNum(merged.partnerRate) && isNum(merged.customerBata) && isNum(merged.partnerBata)) next.oneWay.classes[cls] = { ...(merged as OneWayRates), ...(cng ? { cng } : {}) };
        } else {
          const minKmPerDay = pick(ov, 'minKmPerDay', (common as RoundTripRates | undefined)?.minKmPerDay);
          if (isNum(merged.customerRate) && isNum(merged.partnerRate) && isNum(merged.customerBata) && isNum(merged.partnerBata) && isPos(minKmPerDay)) next.roundTrip.classes[cls] = { ...(merged as OneWayRates), ...(cng ? { cng } : {}), minKmPerDay };
        }
      }
      if (trip === 'One Way' && ov.minKm !== undefined && ov.minKm > 0) next.oneWay.minKm = ov.minKm;
      if (ov.extraKmRate !== undefined || ov.waitingPerHour !== undefined) {
        const commonExtra = outstationExtraFor(base, cls, trip);
        const ownRate = trip === 'One Way' ? next.oneWay.classes[cls]?.customerRate : next.roundTrip.classes[cls]?.customerRate;
        const extraKmRate = pick(ov, 'extraKmRate', commonExtra?.extraKmRate ?? ownRate);
        const waitingPerHour = pick(ov, 'waitingPerHour', commonExtra?.waitingPerHour);
        // With no waiting rate saved anywhere the quote shows no waiting rate (the extra-charges section may still add one).
        if (isNum(extraKmRate)) (trip === 'One Way' ? next.oneWayExtras! : next.roundTripExtras!)[cls] = { extraKmRate, waitingPerHour: isNum(waitingPerHour) ? waitingPerHour : NaN };
      }
    } else if (serviceKey === 'Airport Taxi') {
      const inherited = airportRatesFor(base, cls);
      next.airportClasses![cls] = {
        customerBase: pick(ov, 'customerBase', inherited.customerBase),
        partnerBase: pick(ov, 'partnerBase', inherited.partnerBase),
        includedKm: pick(ov, 'minKm', inherited.includedKm),
        extraKmRate: pick(ov, 'extraKmRate', inherited.extraKmRate),
        partnerExtraKmRate: pick(ov, 'partnerRate', inherited.partnerExtraKmRate),
        waitingPerHour: pick(ov, 'waitingPerHour', inherited.waitingPerHour),
      };
    } else if (serviceKey === 'Local Rental') {
      const commonClass = base.rentalPackages?.[cls];
      if (ov.rentalPackages || ov.minRentalHours !== undefined) {
        const mergedPkgs = { ...(commonClass?.packages ?? {}) };
        for (const [hrs, pkg] of Object.entries(ov.rentalPackages ?? {})) {
          const basePkg = commonClass?.packages?.[hrs];
          // A package the baseline never configured is offered once the scope supplies every rate; GST mode follows the baseline (else excluded).
          const merged = parseRentalPackage({
            customerFare: pkg.customerFare ?? basePkg?.customerFare,
            partnerPayout: pkg.partnerPayout ?? basePkg?.partnerPayout,
            includedKm: pkg.includedKm ?? basePkg?.includedKm,
            extraKmRate: pkg.extraKmRate ?? basePkg?.extraKmRate,
            extraHourRate: pkg.extraHourRate ?? basePkg?.extraHourRate,
            gstMode: basePkg?.gstMode ?? 'excluded',
            enabled: basePkg ? basePkg.enabled : true,
          });
          if (merged) mergedPkgs[hrs] = merged;
        }
        next.rentalPackages![cls] = { minHours: ov.minRentalHours ?? commonClass?.minHours, packages: mergedPkgs };
      }
    }
  }

  return next;
}

/** Airport transfer rates of a class in an (already scoped) tariff: the per-class settings, else the older shared base fares. */
export function airportRatesFor(cfg: TariffConfig, cls: TariffClass): AirportClassRates {
  return cfg.airportClasses?.[cls] ?? (FALLS_BACK_TO_SUV(cls) ? cfg.airportClasses?.suv : undefined) ?? { customerBase: cfg.airport?.customerBase, partnerBase: cfg.airport?.partnerBase };
}

/** The airport rates of a class when every one needed to quote is configured; null otherwise. */
export function completeAirportRates(cfg: TariffConfig, cls: TariffClass): Required<Omit<AirportClassRates, 'waitingPerHour'>> & { waitingPerHour?: number } | null {
  const r = airportRatesFor(cfg, cls);
  if (!isPos(r.customerBase) || !isPos(r.partnerBase) || !isPos(r.includedKm) || !isPos(r.extraKmRate) || !isNum(r.partnerExtraKmRate)) return null;
  return { customerBase: r.customerBase, partnerBase: r.partnerBase, includedKm: r.includedKm, extraKmRate: r.extraKmRate, partnerExtraKmRate: r.partnerExtraKmRate, ...(isNum(r.waitingPerHour) ? { waitingPerHour: r.waitingPerHour } : {}) };
}

/** Parses business_config/tariff_v2. Anything malformed is dropped (treated as not configured). */
function parseDisplayMarkup(v: unknown): Record<string, Record<string, number>> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [brand, services] of Object.entries(v as Record<string, unknown>)) {
    if (!services || typeof services !== 'object' || Array.isArray(services)) continue;
    const row: Record<string, number> = {};
    for (const [service, pct] of Object.entries(services as Record<string, unknown>)) {
      if (isNum(pct) && pct > 0 && pct <= 300) row[service] = Math.round(pct * 100) / 100;
    }
    if (Object.keys(row).length) out[brand] = row;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The % shown as a struck-out higher price above a fare: the brand's own setting for the service, else the shared one. 0 = none. */
export function displayMarkupPercent(cfg: TariffConfig | null, brand: string | undefined, service: string): number {
  return cfg?.displayMarkup?.[brand ?? '']?.[service] ?? cfg?.displayMarkup?.common?.[service] ?? 0;
}

export function parseTariffConfig(d: Record<string, any> | undefined | null): TariffConfig | null {
  if (!d || typeof d !== 'object') return null;
  const airportOk = isNum(d.airport?.customerBase) && isNum(d.airport?.partnerBase);
  const extras = rateMap<OutstationExtra>(d.outstationExtras, ['extraKmRate', 'waitingPerHour']);
  const oneWayExtras = rateMap<OutstationExtra>(d.oneWayExtras, ['extraKmRate', 'waitingPerHour']);
  const roundTripExtras = rateMap<OutstationExtra>(d.roundTripExtras, ['extraKmRate', 'waitingPerHour']);
  const localPickupDrop = parseLocalPickupDrop(d.localPickupDrop);
  const rentalPackages = parseRentalPackages(d.rentalPackages);
  const extraCharges = parseExtraCharges(d.extraCharges);
  const brandOverrides = parseBrandOverrides(d.brandOverrides);
  const zones: CityZone[] = Array.isArray(d.cityDrop?.zones)
    ? d.cityDrop.zones.filter((z: any) => z && typeof z.id === 'string' && isNum(z.radiusKm) && z.radiusKm > 0 && Number.isFinite(z.lat) && Number.isFinite(z.lng))
        .map((z: any) => ({ id: z.id, name: String(z.name ?? z.id), lat: z.lat, lng: z.lng, radiusKm: z.radiusKm }))
    : [];
  return {
    version: typeof d.version === 'number' ? d.version : 0,
    enabled: d.enabled === true,
    gstRate: isNum(d.gstRate) && d.gstRate < 1 ? d.gstRate : 0.05,
    oneWay: { minKm: isNum(d.oneWay?.minKm) && d.oneWay.minKm > 0 ? d.oneWay.minKm : 130, classes: sanitizeCng(rateMap<OneWayRates>(d.oneWay?.classes, ['customerRate', 'customerBata', 'partnerRate', 'partnerBata'])) },
    roundTrip: {
      maxDays: isNum(d.roundTrip?.maxDays) && d.roundTrip.maxDays >= 1 ? Math.floor(d.roundTrip.maxDays) : 30,
      classes: sanitizeCng(rateMap<RoundTripRates>(d.roundTrip?.classes, ['customerRate', 'customerBata', 'partnerRate', 'partnerBata', 'minKmPerDay'])),
    },
    rental: { classes: rateMap<RentalRates>(d.rental?.classes, ['firstHour', 'laterHour', 'minHours', 'minTimeFare', 'partnerPerHour']) },
    cityDrop: { baseKm: isNum(d.cityDrop?.baseKm) && d.cityDrop.baseKm > 0 ? d.cityDrop.baseKm : 20, zones, classes: rateMap<CityDropRates>(d.cityDrop?.classes, ['customerBase', 'customerExtraKm', 'partnerBase', 'partnerExtraKm']) },
    ...(Object.keys(extras).length ? { outstationExtras: extras } : {}),
    ...(Object.keys(oneWayExtras).length ? { oneWayExtras } : {}),
    ...(Object.keys(roundTripExtras).length ? { roundTripExtras } : {}),
    ...(airportOk ? { airport: { customerBase: d.airport.customerBase, partnerBase: d.airport.partnerBase } } : {}),
    ...(localPickupDrop ? { localPickupDrop } : {}),
    ...(rentalPackages ? { rentalPackages } : {}),
    ...(extraCharges ? { extraCharges } : {}),
    ...(brandOverrides ? { brandOverrides } : {}),
    ...(parseDisplayMarkup(d.displayMarkup) ? { displayMarkup: parseDisplayMarkup(d.displayMarkup) } : {}),
    ...(parseFareGst(d.fareGst) ? { fareGst: parseFareGst(d.fareGst) } : {}),
  };
}

// ── IST calendar days ───────────────────────────────────────────────────────

/** Calendar date (YYYY-MM-DD) of an instant on the India calendar. */
export function istDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/**
 * Chargeable days of a round trip = Indian end date − Indian pickup date + 1. A midnight
 * boundary adds a day even when fewer than 24 hours elapsed. Returns null for an end that
 * is before the pickup.
 */
export function calendarDays(pickupMs: number, endMs: number): number | null {
  if (!Number.isFinite(pickupMs) || !Number.isFinite(endMs) || endMs < pickupMs) return null;
  const a = Date.parse(`${istDate(pickupMs)}T00:00:00Z`);
  const b = Date.parse(`${istDate(endMs)}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

// ── Calculations ────────────────────────────────────────────────────────────

/** What a duty's partner is entitled to under the normal fixed rate. Not used for marketplace duties. */
export interface PartnerNormalRate {
  mode: 'NORMAL_RATE';
  ratePaise: number;
  bataPaise: number;
  /** Partner billable-KM floor (same as the customer floor — a working assumption, D03). */
  minKm: number;
  days: number;
  basePaise: number;
}

export interface PricingSnapshot {
  gst?: GstSnapshot;
  /** True when the configured fare already contained GST (GST was extracted from it, not added on top). */
  gstInFare?: boolean;
  gstInclusiveBase?: Pick<PricingSnapshot, "packagePaise" | "customerRatePaise" | "customerBataPaise" | "extraKmRatePaise" | "discount" | "adminAdjustment">;
  schema: 2;
  /** 'tariff_v2' (this module) or 'legacy_category' (admin category fares, kept for local / airport duties). */
  source: 'tariff_v2' | 'legacy_category';
  model: 'one_way_standard' | 'round_trip_calendar' | 'city_drop_package' | 'rental_time' | 'legacy_category' | 'local_pickup_drop' | 'rental_package' | 'fixed_route' | 'business_contract_per_km' | 'airport_transfer';
  tariffVersion: number;
  tariffClass: TariffClass | null;
  gstRate: number;
  quotedKm: number;
  includedKm: number;
  /** Customer rate for each km beyond the quoted / included package. */
  extraKmRatePaise: number;
  customerRatePaise: number;
  customerBataPaise: number;
  days: number;
  minKmPerDay: number;
  /** Customer package before discount and GST, paise. */
  packagePaise: number;
  /** Fixed discount carried into the final fare (coupon, admin), rupees. */
  discount: number;
  /** Staff-authorised pre-GST adjustment carried into the final fare, rupees. */
  adminAdjustment: number;
  /** Global percentage adjustment in force when quoted; re-applied once to the final package. */
  adjustmentPercent: number;
  adjustmentDirection: 'increase' | 'decrease';
  partner: PartnerNormalRate | null;
  /** Waiting charge per hour in force when quoted (recorded for billing at actuals; not added to the quoted fare). */
  waitingPerHourPaise?: number;
  /** The waiting / hill / roof-carrier rates (customer and partner) of this booking's category when quoted. Never changed by later edits. */
  extraCharges?: ExtraChargesSnapshot;
  /** Rental package only: the booked hours and the rate for each hour beyond them. */
  rentalHours?: number;
  extraHourRatePaise?: number;
  /** Local Pickup & Drop only: canonical City record the fare came from. */
  localCityId?: string;
  /** Fixed route fare only: the fare record (and its version) that priced the booking, and whether the booked direction was its reverse. */
  fixedRouteId?: string;
  fixedRouteVersion?: number;
  fixedRouteReversed?: boolean;
  businessCustomerRatePaise?: number;
  businessGstMode?: GstMode;
  /** 'cng' when the fare was worked out on the CNG rate card. */
  fuelType?: 'cng';
  /** Brand scope applied to price this booking. */
  brand?: string;
  /** True when brand-specific overrides were used instead of common baseline. */
  brandScoped?: boolean;
  /** Dates charged, IST, for round trips. */
  pickupDate: string;
  endDate: string | null;
  /** Free-text decisions still open that affect this quote. */
  gates: string[];
}

export interface QuoteInput {
  config: TariffConfig;
  tariffClass: TariffClass;
  tripType: 'One Way' | 'Round Trip';
  routeKm: number;
  durationMin: number;
  pickupMs: number;
  endMs: number | null;
  discount?: number;
  adjustmentPercent?: number;
  adjustmentDirection?: 'increase' | 'decrease';
  /** 'cng' prices the trip on the class's CNG rate card (One Way and Round Trip). */
  fuel?: 'cng';
}

export interface QuoteResult {
  fare: FareBreakdown;
  pricing: PricingSnapshot;
}

export class TariffError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const GATES_ONE_WAY = [
  'D03: partner floor and quoted-KM treatment (130-km floor assumed to apply to partner payout)',
  'D04: tax rate, base and inclusions are configured separately',
];
const GATES_ROUND_TRIP = [
  'D03: SUV / Crysta round-trip partner rates and partner daily minimum (matching customer minimum assumed)',
  'D04: tax rate, base and inclusions are configured separately',
];

function toBreakdown(args: {
  packagePaise: number; distancePaise: number; bataPaise: number; floorPaise: number; discount: number; adminAdjustment: number;
  adjustmentPercent: number; adjustmentDirection: 'increase' | 'decrease'; gstRate: number; km: number; durationMin: number; ratePaise: number;
}): FareBreakdown {
  // The package keeps its paise; GST is worked out on the taxable amount and kept to the paise
  // (Functional Spec p.8: a 310 km Sedan trip is ₹5,050.00 + ₹252.50 GST = ₹5,302.50).
  const pre = r2(args.packagePaise / 100);
  const adjustmentAmount = args.adjustmentPercent > 0 ? (args.adjustmentDirection === 'decrease' ? -1 : 1) * r2((pre * args.adjustmentPercent) / 100) : 0;
  const subtotal = Math.max(0, r2(pre + adjustmentAmount + args.adminAdjustment));
  const discount = Math.min(Math.max(0, r2(args.discount)), subtotal);
  const taxable = r2(subtotal - discount);
  const gst = gstOn(taxable, args.gstRate);
  return {
    subtotalBeforeAdjustment: pre,
    globalAdjustment: args.adjustmentPercent > 0 ? { id: 'fare-adjustment', name: 'Fare adjustment', direction: args.adjustmentDirection, percent: args.adjustmentPercent, amount: adjustmentAmount } : null,
    discountDetail: discount > 0 ? { type: 'coupon', value: discount, amount: discount, source: 'coupon', reason: '' } : null,
    baseFare: 0,
    // The lines always add up to the package: distance is the remainder after bata and the floor top-up.
    distanceFare: r2(pre - args.bataPaise / 100 - args.floorPaise / 100),
    timeFare: 0,
    nightCharge: 0,
    driverAllowance: r2(args.bataPaise / 100),
    minimumFareAdjustment: r2(args.floorPaise / 100),
    ...(args.adminAdjustment ? { adminAdjustment: args.adminAdjustment } : {}),
    subtotal,
    discount,
    taxableAmount: taxable,
    gstRate: args.gstRate,
    gst,
    total: r2(taxable + gst),
    distanceKm: Math.round(args.km * 10) / 10,
    durationMin: Math.round(args.durationMin),
    perKmRate: rupeesOf(args.ratePaise),
    perMinuteRate: 0,
  };
}

/**
 * Customer rate for each KM beyond the package, and the waiting charge, for outstation and round-trip
 * duties. The saved "outstation extra usage" values win; with none saved the customer's own per-KM rate
 * applies, exactly as before they could be edited.
 */
export function outstationExtraFor(cfg: TariffConfig, cls: TariffClass, trip: 'One Way' | 'Round Trip'): OutstationExtra | undefined {
  const specific = trip === 'One Way' ? cfg.oneWayExtras : cfg.roundTripExtras;
  return specific?.[cls] ?? cfg.outstationExtras?.[cls]
    ?? (FALLS_BACK_TO_SUV(cls) ? specific?.suv ?? cfg.outstationExtras?.suv : undefined);
}

/** The rate card a trip is priced on: the class's normal one, or its CNG card when the customer chose CNG. */
function fuelRates<T extends OneWayRates>(r: T, fuel: 'cng' | undefined): T {
  if (fuel !== 'cng') return r;
  if (!r.cng) throw new TariffError('cng-unavailable', 'CNG is not available for this vehicle.');
  // A Round Trip on the CNG card uses its own daily minimum KM when one is set.
  const cngMin = 'minKmPerDay' in r && isPos(r.cng.minKmPerDay) ? { minKmPerDay: r.cng.minKmPerDay } : {};
  return { ...r, customerRate: r.cng.customerRate, customerBata: r.cng.customerBata, partnerRate: r.cng.partnerRate, partnerBata: r.cng.partnerBata, ...cngMin };
}

function extraUsage(cfg: TariffConfig, cls: TariffClass, ratePaise: number, trip: 'One Way' | 'Round Trip'): { extraKmRatePaise: number; waiting: { waitingPerHourPaise?: number } } {
  const x = outstationExtraFor(cfg, cls, trip);
  if (!x) return { extraKmRatePaise: ratePaise, waiting: {} };
  return { extraKmRatePaise: paise(x.extraKmRate), waiting: Number.isFinite(x.waitingPerHour) ? { waitingPerHourPaise: paise(x.waitingPerHour) } : {} };
}

/** Standard one-way: included KM = max(floor, quoted route KM); base = included × rate + bata. */
export function quoteOneWay(i: QuoteInput): QuoteResult {
  const standard = classRates(i.config.oneWay.classes, i.tariffClass);
  if (!standard) throw new TariffError('rate-missing', 'The one-way tariff for this vehicle class is not configured.');
  const r = fuelRates(standard, i.fuel);
  const included = Math.max(i.config.oneWay.minKm, Math.round(i.routeKm * 10) / 10);
  const ratePaise = paise(r.customerRate), bataPaise = paise(r.customerBata);
  const standardExtra = extraUsage(i.config, i.tariffClass, ratePaise, 'One Way');
  const extra = i.fuel === 'cng' ? { ...standardExtra, extraKmRatePaise: paise(r.cng?.extraKmRate ?? r.customerRate) } : standardExtra;
  const distancePaise = kmAmountPaise(included, ratePaise);
  const floorPaise = kmAmountPaise(Math.max(0, included - i.routeKm), ratePaise);
  const packagePaise = distancePaise + bataPaise;
  const partnerKm = included;
  const fare = toBreakdown({
    packagePaise, distancePaise: distancePaise - floorPaise, bataPaise, floorPaise, discount: i.discount ?? 0, adminAdjustment: 0,
    adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase', gstRate: i.config.gstRate,
    km: included, durationMin: i.durationMin, ratePaise,
  });
  return {
    fare,
    pricing: {
      schema: 2, source: 'tariff_v2', model: 'one_way_standard', tariffVersion: i.config.version, tariffClass: i.tariffClass, gstRate: i.config.gstRate,
      quotedKm: included, includedKm: included, extraKmRatePaise: extra.extraKmRatePaise, customerRatePaise: ratePaise, customerBataPaise: bataPaise,
      ...(i.fuel === 'cng' ? { fuelType: 'cng' as const } : {}), ...extra.waiting, days: 1, minKmPerDay: i.config.oneWay.minKm, packagePaise, discount: fare.discount, adminAdjustment: 0,
      adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase',
      partner: { mode: 'NORMAL_RATE', ratePaise: paise(r.partnerRate), bataPaise: paise(r.partnerBata), minKm: i.config.oneWay.minKm, days: 1, basePaise: kmAmountPaise(partnerKm, paise(r.partnerRate)) + paise(r.partnerBata) },
      pickupDate: istDate(i.pickupMs), endDate: null, gates: [...GATES_ONE_WAY],
    },
  };
}

/** Round trip by Indian calendar days; billable KM = max(total KM, daily minimum × days). */
export function quoteRoundTrip(i: QuoteInput): QuoteResult {
  const standard = classRates(i.config.roundTrip.classes, i.tariffClass);
  if (!standard) throw new TariffError('rate-missing', 'The round-trip tariff for this vehicle class is not configured.');
  const r = fuelRates(standard, i.fuel);
  if (i.endMs === null) throw new TariffError('end-required', 'Choose the date and time the trip ends.');
  const days = calendarDays(i.pickupMs, i.endMs);
  if (days === null) throw new TariffError('end-before-pickup', 'The trip cannot end before it starts.');
  if (days > i.config.roundTrip.maxDays) throw new TariffError('too-long', `Round trips can be booked for up to ${i.config.roundTrip.maxDays} days.`);
  const actualKm = Math.round(i.routeKm * 2 * 10) / 10;
  const floorKm = r.minKmPerDay * days;
  const billable = Math.max(actualKm, floorKm);
  const ratePaise = paise(r.customerRate), bataPaise = paise(r.customerBata) * days;
  const standardExtra = extraUsage(i.config, i.tariffClass, ratePaise, 'Round Trip');
  const extra = i.fuel === 'cng' ? { ...standardExtra, extraKmRatePaise: paise(r.cng?.extraKmRate ?? r.customerRate) } : standardExtra;
  const distancePaise = kmAmountPaise(billable, ratePaise);
  const floorPaise = kmAmountPaise(Math.max(0, billable - actualKm), ratePaise);
  const packagePaise = distancePaise + bataPaise;
  const partnerRate = paise(r.partnerRate);
  const fare = toBreakdown({
    packagePaise, distancePaise: distancePaise - floorPaise, bataPaise, floorPaise, discount: i.discount ?? 0, adminAdjustment: 0,
    adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase', gstRate: i.config.gstRate,
    km: billable, durationMin: i.durationMin * 2, ratePaise,
  });
  return {
    fare,
    pricing: {
      schema: 2, source: 'tariff_v2', model: 'round_trip_calendar', tariffVersion: i.config.version, tariffClass: i.tariffClass, gstRate: i.config.gstRate,
      quotedKm: actualKm, includedKm: billable, extraKmRatePaise: extra.extraKmRatePaise, customerRatePaise: ratePaise, customerBataPaise: paise(r.customerBata),
      ...(i.fuel === 'cng' ? { fuelType: 'cng' as const } : {}), ...extra.waiting, days, minKmPerDay: r.minKmPerDay, packagePaise, discount: fare.discount, adminAdjustment: 0,
      adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase',
      partner: { mode: 'NORMAL_RATE', ratePaise: partnerRate, bataPaise: paise(r.partnerBata), minKm: r.minKmPerDay, days, basePaise: kmAmountPaise(billable, partnerRate) + paise(r.partnerBata) * days },
      pickupDate: istDate(i.pickupMs), endDate: istDate(i.endMs), gates: [...GATES_ROUND_TRIP],
    },
  };
}

/**
 * Local rental TIME component only. Fare = minimum time fare + max(0, minutes − minimum
 * minutes) × later-hour rate / 60 (no rounding of an extra minute to an hour). The distance
 * component is an OPEN decision (D01/D02), so a rental is never quoted as bookable.
 */
export function rentalTimeFare(r: RentalRates, minutes: number): { timePaise: number; minutesOver: number } {
  const minMinutes = r.minHours * 60;
  const over = Math.max(0, minutes - minMinutes);
  const extra = (over * paise(r.laterHour)) / 60;
  return { timePaise: paise(r.minTimeFare) + Math.floor(extra + 0.5), minutesOver: over };
}

/** Local city drop package: base for the first N km + extra km at the class extra rate. */
export function cityDropFare(cfg: TariffConfig, cls: TariffClass, km: number): { customerPaise: number; partnerPaise: number; extraKm: number } {
  const r = classRates(cfg.cityDrop.classes, cls);
  if (!r) throw new TariffError('rate-missing', 'The city-drop package for this vehicle class is not configured.');
  const extraKm = Math.max(0, Math.round(km * 10) / 10 - cfg.cityDrop.baseKm);
  return {
    customerPaise: paise(r.customerBase) + kmAmountPaise(extraKm, paise(r.customerExtraKm)),
    partnerPaise: paise(r.partnerBase) + kmAmountPaise(extraKm, paise(r.partnerExtraKm)),
    extraKm,
  };
}

const GATES_LOCAL = ['D04: tax rate, base and inclusions are configured separately'];

/** The explicitly enabled, valid Local Pickup & Drop fare of a class in a city; null = not configured / not enabled. */
export function localFareFor(cfg: TariffConfig, cityId: string, cls: TariffClass): { cityName: string; fare: LocalFareEntry } | null {
  const city = cfg.localPickupDrop?.[cityId];
  const fare = city?.classes[cls];
  return city && fare && fare.enabled ? { cityName: city.cityName, fare } : null;
}

/**
 * Local Pickup & Drop inside one city: billable KM = max(road KM, the city's local minimum), priced at the
 * customer rate per KM. The 130 KM outstation floor does not apply here. Kilometres beyond the billable
 * KM are charged at the extra-KM rate when the trip ends; waiting is recorded and billed at actuals.
 */
export function quoteLocalPickupDrop(i: QuoteInput & { cityId: string }): QuoteResult {
  const hit = localFareFor(i.config, i.cityId, i.tariffClass);
  if (!hit) throw new TariffError('rate-missing', 'Local Pickup & Drop is not configured for this city and vehicle class.');
  const r = hit.fare;
  const included = Math.max(r.minKm, Math.round(i.routeKm * 10) / 10);
  const ratePaise = paise(r.customerRate);
  const packagePaise = kmAmountPaise(included, ratePaise);
  const floorPaise = kmAmountPaise(Math.max(0, included - i.routeKm), ratePaise);
  const fare = toBreakdown({
    packagePaise, distancePaise: packagePaise - floorPaise, bataPaise: 0, floorPaise, discount: i.discount ?? 0, adminAdjustment: 0,
    adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase', gstRate: i.config.gstRate,
    km: included, durationMin: i.durationMin, ratePaise,
  });
  const partnerRate = paise(r.partnerRate);
  return {
    fare,
    pricing: {
      schema: 2, source: 'tariff_v2', model: 'local_pickup_drop', tariffVersion: i.config.version, tariffClass: i.tariffClass, gstRate: i.config.gstRate,
      quotedKm: included, includedKm: included, extraKmRatePaise: paise(r.extraKmRate), customerRatePaise: ratePaise, customerBataPaise: 0,
      waitingPerHourPaise: paise(r.waitingPerHour), localCityId: i.cityId, days: 1, minKmPerDay: r.minKm, packagePaise, discount: fare.discount, adminAdjustment: 0,
      adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase',
      partner: { mode: 'NORMAL_RATE', ratePaise: partnerRate, bataPaise: 0, minKm: r.minKm, days: 1, basePaise: kmAmountPaise(included, partnerRate) },
      pickupDate: istDate(i.pickupMs), endDate: null, gates: [...GATES_LOCAL],
    },
  };
}

/**
 * Airport transfer: the base fare covers the first included KM; each KM of the quoted route beyond it is charged at the
 * extra-KM rate. The partner is paid the base payout plus the partner rate for the same extra KM. Kilometres driven beyond
 * the quoted route are billed at trip end at the same rates; waiting is billed at actuals.
 */
export function quoteAirport(i: QuoteInput & { rates: NonNullable<ReturnType<typeof completeAirportRates>> }): QuoteResult {
  const r = i.rates;
  const km = Math.round(i.routeKm * 10) / 10;
  const extraKm = Math.max(0, Math.round((km - r.includedKm) * 10) / 10);
  const basePaise = paise(r.customerBase), extraRatePaise = paise(r.extraKmRate), partnerExtraPaise = paise(r.partnerExtraKmRate);
  const extraPaise = kmAmountPaise(extraKm, extraRatePaise);
  const packagePaise = basePaise + extraPaise;
  const base = toBreakdown({
    packagePaise, distancePaise: extraPaise, bataPaise: 0, floorPaise: 0, discount: i.discount ?? 0, adminAdjustment: 0,
    adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase', gstRate: i.config.gstRate,
    km, durationMin: i.durationMin, ratePaise: extraRatePaise,
  });
  const fare: FareBreakdown = { ...base, baseFare: r2(basePaise / 100), distanceFare: r2(base.distanceFare - basePaise / 100) };
  return {
    fare,
    pricing: {
      schema: 2, source: 'tariff_v2', model: 'airport_transfer', tariffVersion: i.config.version, tariffClass: i.tariffClass, gstRate: i.config.gstRate,
      // Extra KM at trip end are counted beyond the larger of the quoted route and the included KM.
      quotedKm: km, includedKm: Math.max(km, r.includedKm), extraKmRatePaise: extraRatePaise, customerRatePaise: 0, customerBataPaise: 0,
      ...(r.waitingPerHour !== undefined ? { waitingPerHourPaise: paise(r.waitingPerHour) } : {}),
      days: 1, minKmPerDay: r.includedKm, packagePaise, discount: fare.discount, adminAdjustment: 0,
      adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase',
      partner: { mode: 'NORMAL_RATE', ratePaise: partnerExtraPaise, bataPaise: 0, minKm: r.includedKm, days: 1, basePaise: paise(r.partnerBase) + kmAmountPaise(extraKm, partnerExtraPaise) },
      pickupDate: istDate(i.pickupMs), endDate: null, gates: [...GATES_LOCAL],
    },
  };
}

/** Minimum rental hours of a class: the saved value, else the initial minimum (Sedan / SUV / Innova 4, Crysta 10). */
export function rentalMinHours(cfg: TariffConfig, cls: TariffClass): number {
  return cfg.rentalPackages?.[cls]?.minHours ?? DEFAULT_RENTAL_MIN_HOURS[cls];
}

/** Taxable paise of a GST-inclusive amount, using the same half-up GST rounding as every other fare. */
export function taxableFromInclusivePaise(totalPaise: number, gstRate: number): number {
  const withTax = (t: number) => t + Math.round(gstOn(t / 100, gstRate) * 100);
  let t = Math.round(totalPaise / (1 + gstRate));
  for (let n = 0; n < 5 && withTax(t) < totalPaise; n++) t++;
  for (let n = 0; n < 5 && t > 0 && withTax(t) > totalPaise; n++) t--;
  return t;
}

/**
 * A saved rental package that may be quoted now: enabled, valid, and not shorter than the class minimum.
 * A package below the minimum keeps its saved data but is never quoted.
 */
export function rentalPackageFor(cfg: TariffConfig, cls: TariffClass, hours: number): { pkg: RentalPackage } | { error: string } {
  if (!(RENTAL_HOURS as readonly number[]).includes(hours)) return { error: `${hours}-hour rental packages are not offered.` };
  const min = rentalMinHours(cfg, cls);
  if (hours < min) return { error: `This vehicle's rental starts at ${min} hours.` };
  const pkg = cfg.rentalPackages?.[cls]?.packages[String(hours)];
  if (!pkg || !pkg.enabled) return { error: `The ${hours}-hour rental package is not configured for this vehicle.` };
  return { pkg };
}

/** The package quoted when the customer has not picked one: the shortest enabled package the class may book; null = none. */
export function defaultRentalHours(cfg: TariffConfig, cls: TariffClass): number | null {
  for (const h of RENTAL_HOURS) if (!('error' in rentalPackageFor(cfg, cls, h))) return h;
  return null;
}

/**
 * Local rental by fixed package. The customer fare is what the package says; GST follows the package's
 * own mode — "included" means the saved fare already contains GST (the total stays equal to it), "excluded"
 * adds GST on top. Both use the one GST rate and rounding of the tariff.
 */
export function quoteRentalPackage(i: QuoteInput & { hours: number }): QuoteResult {
  const found = rentalPackageFor(i.config, i.tariffClass, i.hours);
  if ('error' in found) throw new TariffError('rate-missing', found.error);
  const p = found.pkg;
  const fixedPaise = paise(p.customerFare);
  const packagePaise = p.gstMode === 'included' ? taxableFromInclusivePaise(fixedPaise, i.config.gstRate) : fixedPaise;
  const extraKmPaise = paise(p.extraKmRate);
  const base = toBreakdown({
    packagePaise, distancePaise: packagePaise, bataPaise: 0, floorPaise: 0, discount: i.discount ?? 0, adminAdjustment: 0,
    adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase', gstRate: i.config.gstRate,
    km: p.includedKm, durationMin: i.hours * 60, ratePaise: extraKmPaise,
  });
  // The whole package is the base fare; there is no separate distance line.
  const fare: FareBreakdown = { ...base, baseFare: base.distanceFare, distanceFare: 0 };
  return {
    fare,
    pricing: {
      schema: 2, source: 'tariff_v2', model: 'rental_package', tariffVersion: i.config.version, tariffClass: i.tariffClass, gstRate: i.config.gstRate,
      quotedKm: p.includedKm, includedKm: p.includedKm, extraKmRatePaise: extraKmPaise,
      // No per-KM rate prices the package itself, so a short trip never shows a "minimum fare" top-up.
      customerRatePaise: 0, customerBataPaise: 0, rentalHours: i.hours, extraHourRatePaise: paise(p.extraHourRate), days: 1, minKmPerDay: 0,
      packagePaise, discount: fare.discount, adminAdjustment: 0, adjustmentPercent: i.adjustmentPercent ?? 0, adjustmentDirection: i.adjustmentDirection ?? 'increase',
      partner: { mode: 'NORMAL_RATE', ratePaise: 0, bataPaise: 0, minKm: p.includedKm, days: 1, basePaise: paise(p.partnerPayout) },
      gstInFare: p.gstMode === 'included',
      pickupDate: istDate(i.pickupMs), endDate: null,
      gates: [...GATES_LOCAL, 'Extra hours are recorded on the quote and billed at actuals; they are not added to the final fare automatically'],
    },
  };
}

// ── Fixed route fares ───────────────────────────────────────────────────────

/** An agreed fare for one route (and, when allowed, its reverse) saved with the Fixed route fares tool. */
export interface FixedRouteFare {
  brand?: string;
  fareService?: string;
  id: string;
  name: string;
  originId: string;
  destinationId: string;
  categoryId: string;
  /** '' = any service. */
  serviceId: string;
  customerFare: number;
  partnerPayout: number;
  gstMode: GstMode;
  /** Whether the global fare adjustment applies to this fare: always an explicit choice. */
  peakAdjustment: 'apply' | 'exclude';
  reverseDirection: boolean;
  priority: number;
  effectiveFrom: string;
  effectiveUntil: string;
  version: number;
}

/**
 * An enabled fare saved through the tool and valid in every field. Older route rules (no partner payout, GST
 * or peak choice) and anything incomplete return null and are never priced.
 */
export function parseFixedRouteFare(id: string, d: Record<string, any> | undefined | null): FixedRouteFare | null {
  if (!d || d.managed !== true || d.pricingType !== 'FIXED_ROUTE' || d.status !== 'Active') return null;
  const s = (v: unknown): string => (typeof v === 'string' ? v : '');
  const originId = s(d.originLocationId), destinationId = s(d.destinationLocationId), categoryId = s(d.vehicleCategoryId);
  if (!originId || !destinationId || originId === destinationId || !categoryId) return null;
  if (!isPos(d.baseFare) || !isPos(d.partnerPayout)) return null;
  if (d.gstMode !== 'included' && d.gstMode !== 'excluded') return null;
  if (d.peakAdjustment !== 'apply' && d.peakAdjustment !== 'exclude') return null;
  if (typeof d.reverseDirection !== 'boolean') return null;
  if (typeof d.priority !== 'number' || !Number.isInteger(d.priority) || d.priority < 1 || d.priority > 99) return null;
  return {
    id, brand: s(d.brand), fareService: s(d.fareService), name: s(d.name), originId, destinationId, categoryId, serviceId: s(d.serviceId), customerFare: d.baseFare, partnerPayout: d.partnerPayout,
    gstMode: d.gstMode, peakAdjustment: d.peakAdjustment, reverseDirection: d.reverseDirection, priority: d.priority,
    effectiveFrom: s(d.effectiveFrom), effectiveUntil: s(d.effectiveUntil), version: typeof d.version === 'number' ? d.version : 0,
  };
}

/**
 * The fare that applies to a trip: same canonical origin / destination (the reverse only when the fare allows
 * it), vehicle category and service (a fare for one service never prices another), inside its dates. Several
 * matches resolve the same way every time: lowest priority number, then the booked direction over its reverse,
 * then a service-specific fare over an any-service one, then the record id.
 */
export function matchFixedRoute(
  rules: FixedRouteFare[],
  c: { originId: string; destinationId: string; categoryId: string; serviceId: string; date: string; brand?: string; fareService?: string },
): { rule: FixedRouteFare; reversed: boolean } | null {
  const hits: { rule: FixedRouteFare; reversed: boolean }[] = [];
  for (const r of rules) {
    if (r.brand && r.brand !== c.brand) continue;
    if (r.fareService && r.fareService !== c.fareService) continue;
    if (r.categoryId !== c.categoryId) continue;
    if (r.serviceId && r.serviceId !== c.serviceId) continue;
    if (r.effectiveFrom && c.date < r.effectiveFrom) continue;
    if (r.effectiveUntil && c.date > r.effectiveUntil) continue;
    const direct = r.originId === c.originId && r.destinationId === c.destinationId;
    const reversed = r.reverseDirection && r.originId === c.destinationId && r.destinationId === c.originId;
    if (direct || reversed) hits.push({ rule: r, reversed: !direct });
  }
  hits.sort((a, b) => Number(!!b.rule.brand) - Number(!!a.rule.brand) || a.rule.priority - b.rule.priority || Number(a.reversed) - Number(b.reversed) || Number(!a.rule.serviceId) - Number(!b.rule.serviceId) || (a.rule.id < b.rule.id ? -1 : 1));
  return hits[0] ?? null;
}

/**
 * A fixed route fare replaces the distance-based base fare: the customer pays the agreed fare (GST follows the
 * fare's own mode, using the one GST rate and rounding of every other fare) and the partner is paid the agreed
 * payout. The road distance is still recorded. The global fare adjustment applies only when the fare opts in.
 */
export function quoteFixedRoute(i: {
  rule: FixedRouteFare; reversed: boolean; gstRate: number; tariffVersion: number; tariffClass: TariffClass | null;
  routeKm: number; durationMin: number; pickupMs: number; discount?: number; adjustmentPercent?: number; adjustmentDirection?: 'increase' | 'decrease';
}): QuoteResult {
  const r = i.rule;
  const fixedPaise = paise(r.customerFare);
  const packagePaise = r.gstMode === 'included' ? taxableFromInclusivePaise(fixedPaise, i.gstRate) : fixedPaise;
  const adjustmentPercent = r.peakAdjustment === 'apply' ? i.adjustmentPercent ?? 0 : 0;
  const direction = i.adjustmentDirection ?? 'increase';
  const km = Math.round(i.routeKm * 10) / 10;
  const base = toBreakdown({
    packagePaise, distancePaise: packagePaise, bataPaise: 0, floorPaise: 0, discount: i.discount ?? 0, adminAdjustment: 0,
    adjustmentPercent, adjustmentDirection: direction, gstRate: i.gstRate, km: i.routeKm, durationMin: i.durationMin, ratePaise: 0,
  });
  // The agreed fare is the whole base fare; there is no distance line.
  const fare: FareBreakdown = { ...base, baseFare: base.distanceFare, distanceFare: 0 };
  return {
    fare,
    pricing: {
      schema: 2, source: 'tariff_v2', model: 'fixed_route', tariffVersion: i.tariffVersion, tariffClass: i.tariffClass, gstRate: i.gstRate,
      // The road distance is kept; no per-KM charge is added to an agreed fare, so a longer trip does not raise it.
      quotedKm: km, includedKm: km, extraKmRatePaise: 0, customerRatePaise: 0, customerBataPaise: 0, days: 1, minKmPerDay: 0,
      fixedRouteId: r.id, fixedRouteVersion: r.version, fixedRouteReversed: i.reversed, gstInFare: r.gstMode === 'included',
      packagePaise, discount: fare.discount, adminAdjustment: 0, adjustmentPercent, adjustmentDirection: direction,
      partner: { mode: 'NORMAL_RATE', ratePaise: 0, bataPaise: 0, minKm: 0, days: 1, basePaise: paise(r.partnerPayout) },
      pickupDate: istDate(i.pickupMs), endDate: null,
      gates: [...GATES_LOCAL, 'Fixed route fare: the agreed fare is charged for the route whatever the kilometres driven'],
    },
  };
}

/** True when both places lie inside the SAME configured city zone. No zones configured → false (gated, D15). */
export function withinCityZone(cfg: TariffConfig, a: { lat: number; lng: number }, b: { lat: number; lng: number }): CityZone | null {
  const dist = (p: { lat: number; lng: number }, z: CityZone) => {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (p.lat - z.lat) * rad, dLng = (p.lng - z.lng) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(z.lat * rad) * Math.cos(p.lat * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  return cfg.cityDrop.zones.find((z) => dist(a, z) <= z.radiusKm && dist(b, z) <= z.radiusKm) ?? null;
}

// ── Final fare from verified total KM ───────────────────────────────────────

export interface FinalInput {
  pricing: PricingSnapshot;
  /** Total KM the driver entered for the whole trip. */
  totalKm: number;
  /** Actual trip end instant. */
  endMs: number;
  /** Customer-facing add-ons recorded at actuals (tolls are handled separately by the booking). */
}

export interface FinalResult {
  fare: FareBreakdown;
  billableKm: number;
  extraKm: number;
  days: number;
  extraKmPaise: number;
  customerPackagePaise: number;
  /** Partner entitlement for a NORMAL_RATE duty, paise; null for marketplace / legacy payouts. */
  partnerPaise: number | null;
  /** Calendar days beyond the quoted days (trip ran into another date). */
  extraDays: number;
}

/**
 * Final fare = the LOCKED quoted package + only the distance beyond the quoted included KM
 * (never the whole trip priced again). A shorter trip never reduces the quoted package.
 * A round trip that runs into another Indian date adds the day's bata and daily minimum.
 */
export function finalizeFare(i: FinalInput): FinalResult {
  const p = i.pricing;
  if (p.gst && p.gstInclusiveBase) {
    const base = p.gstInclusiveBase;
    const rawPricing: PricingSnapshot = { ...p, ...base, gst: undefined, gstInclusiveBase: undefined, gstRate: 0,
      // An office fare override is a net adjustment and must survive the inclusive snapshot.
      adminAdjustment: r2(p.adminAdjustment * (1 + p.gstRate)),
    };
    const result = finalizeFare({ ...i, pricing: rawPricing });
    const fare = withFareGst(result.fare, p.gst, true);
    return { ...result, fare, customerPackagePaise: taxableFromInclusivePaise(result.customerPackagePaise, p.gstRate), extraKmPaise: taxableFromInclusivePaise(result.extraKmPaise, p.gstRate) };
  }
  if (!(i.totalKm > 0) || !Number.isFinite(i.totalKm)) throw new TariffError('km-required', 'Enter the total kilometres driven.');
  const totalKm = Math.round(i.totalKm * 10) / 10;
  let packagePaise = p.packagePaise;
  let includedKm = p.includedKm;
  let days = p.days;
  let extraDays = 0;
  if (p.model === 'round_trip_calendar' && p.endDate) {
    const actual = calendarDays(Date.parse(`${p.pickupDate}T12:00:00+05:30`), i.endMs);
    if (actual !== null && actual > p.days) {
      extraDays = actual - p.days;
      days = actual;
      // The new dates carry their own bata and their own daily minimum.
      includedKm = p.includedKm + p.minKmPerDay * extraDays;
      packagePaise += p.customerBataPaise * extraDays + kmAmountPaise(p.minKmPerDay * extraDays, p.customerRatePaise);
    }
  }
  const extraKm = Math.max(0, Math.round((totalKm - includedKm) * 10) / 10);
  const businessTotal=p.model==='business_contract_per_km'&&typeof p.businessCustomerRatePaise==='number'
    ? kmAmountPaise(Math.max(totalKm,p.quotedKm),p.businessCustomerRatePaise):null;
  const extraKmPaise = businessTotal!==null
    ? Math.max(0,(p.businessGstMode==='included'?taxableFromInclusivePaise(businessTotal,p.gstRate):businessTotal)-packagePaise)
    : kmAmountPaise(extraKm, p.extraKmRatePaise);
  const total = packagePaise + extraKmPaise;
  const pre = r2(total / 100);
  const adjustmentAmount = p.adjustmentPercent > 0 ? (p.adjustmentDirection === 'decrease' ? -1 : 1) * r2((pre * p.adjustmentPercent) / 100) : 0;
  const subtotal = Math.max(0, r2(pre + adjustmentAmount + p.adminAdjustment));
  const discount = Math.min(p.discount, subtotal);
  const taxable = r2(subtotal - discount);
  const gst = gstOn(taxable, p.gstRate);
  const billableKm = Math.max(totalKm, includedKm);
  let partnerPaise: number | null = null;
  if (p.partner && p.model === 'airport_transfer') {
    // The quoted payout plus the partner rate for every KM driven beyond the quoted route.
    partnerPaise = p.partner.basePaise + kmAmountPaise(Math.max(0, Math.round((totalKm - includedKm) * 10) / 10), p.partner.ratePaise);
  } else if (p.partner && (p.model === 'rental_package' || p.model === 'fixed_route')) {
    // A rental package or fixed route fare pays the partner its agreed payout.
    partnerPaise = p.partner.basePaise;
  } else if (p.partner) {
    const quotedPartnerKm = Math.max(p.quotedKm, p.model === 'round_trip_calendar' ? p.partner.minKm * p.partner.days : p.partner.minKm);
    const partnerKm = Math.max(totalKm, quotedPartnerKm, p.model === 'round_trip_calendar' ? p.partner.minKm * days : p.partner.minKm);
    // The agreed payout can include a scoped percentage adjustment. Rebuilding it from
    // rate + unchanged bata would lose that adjustment (and could reduce a shorter tour).
    // Keep the agreed base and add only usage beyond its saved distance/calendar days.
    partnerPaise = p.partner.basePaise + kmAmountPaise(partnerKm - quotedPartnerKm, p.partner.ratePaise) + p.partner.bataPaise * Math.max(0, days - p.partner.days);
  }
  const fare: FareBreakdown = {
    subtotalBeforeAdjustment: pre,
    globalAdjustment: p.adjustmentPercent > 0 ? { id: 'fare-adjustment', name: 'Fare adjustment', direction: p.adjustmentDirection, percent: p.adjustmentPercent, amount: adjustmentAmount } : null,
    discountDetail: discount > 0 ? { type: 'coupon', value: discount, amount: discount, source: 'coupon', reason: '' } : null,
    baseFare: 0,
    distanceFare: r2(pre - (p.customerBataPaise * days) / 100 - Math.max(0, kmAmountPaise(Math.max(0, includedKm - totalKm), p.customerRatePaise)) / 100),
    timeFare: 0,
    nightCharge: 0,
    driverAllowance: r2((p.customerBataPaise * days) / 100),
    minimumFareAdjustment: Math.max(0, r2(kmAmountPaise(Math.max(0, includedKm - totalKm), p.customerRatePaise) / 100)),
    ...(p.adminAdjustment ? { adminAdjustment: p.adminAdjustment } : {}),
    subtotal, discount, taxableAmount: taxable, gstRate: p.gstRate, gst, total: r2(taxable + gst),
    distanceKm: totalKm, durationMin: 0, perKmRate: rupeesOf(p.extraKmRatePaise), perMinuteRate: 0,
  };
  if (p.gst) fare.gstDetails = { ...p.gst, ...gstComponents(fare.gst, p.gst.split) };
  return { fare, billableKm, extraKm, days, extraKmPaise, customerPackagePaise: packagePaise, partnerPaise, extraDays };
}

/**
 * Final fare for a booking priced by the older admin-category engine. The quoted package
 * stays; only the kilometres beyond the quoted distance are added at the category's
 * extra-km rate, and GST follows the same rate as the quote.
 */
export function finalizeLegacyFare(args: { total: number; taxable: number; gstRate: number; discount: number; quotedKm: number; extraKmRate: number; totalKm: number }) {
  const totalKm = Math.round(args.totalKm * 10) / 10;
  const extraKm = Math.max(0, Math.round((totalKm - args.quotedKm) * 10) / 10);
  const extra = r2(extraKm * args.extraKmRate);
  const taxable = r2(args.taxable + extra);
  const gst = gstOn(taxable, args.gstRate);
  return { extraKm, extra, taxable, gst, total: taxable + gst, distanceKm: totalKm };
}

// ── Multicity itineraries ───────────────────────────────────────────────────

/** Per-KM touring rates of a Multicity itinerary for one class. */
export interface MulticityRates { customerRate: number; partnerRate: number; customerBata: number; partnerBata: number; minKmPerDay: number; extraKmRate: number; waitingPerHour?: number }

/**
 * Multicity rates of a class: the Round Trip rate card (a multi-day tour is billed the same way), then the Common Multicity
 * settings, then the brand's own. null when any rate is still missing after inheriting.
 */
export function multicityRatesFor(cfg: TariffConfig, brand: string | undefined, cls: TariffClass): MulticityRates | null {
  const rt = classRates(cfg.roundTrip.classes, cls);
  const rtx = outstationExtraFor(cfg, cls, 'Round Trip');
  const r: Partial<MulticityRates> = { ...rt, extraKmRate: rtx?.extraKmRate, waitingPerHour: Number.isFinite(rtx?.waitingPerHour) ? rtx?.waitingPerHour : undefined };
  const layers = [cfg.brandOverrides?.common?.Multicity?.[cls], brand && brand !== 'common' ? cfg.brandOverrides?.[brand]?.Multicity?.[cls] : undefined];
  for (const ov of layers) {
    if (!ov) continue;
    for (const key of ['customerRate', 'partnerRate', 'customerBata', 'partnerBata', 'minKmPerDay', 'extraKmRate', 'waitingPerHour'] as const) if (isNum(ov[key])) r[key] = ov[key];
  }
  const extraKmRate = r.extraKmRate ?? r.customerRate;
  if (!isPos(r.customerRate) || !isNum(r.partnerRate) || !isNum(r.customerBata) || !isNum(r.partnerBata) || !isPos(r.minKmPerDay) || !isPos(extraKmRate)) return null;
  return { customerRate: r.customerRate, partnerRate: r.partnerRate, customerBata: r.customerBata, partnerBata: r.partnerBata, minKmPerDay: r.minKmPerDay, extraKmRate, ...(isNum(r.waitingPerHour) ? { waitingPerHour: r.waitingPerHour } : {}) };
}

export interface MulticityQuote {
  totalKm: number; billableKm: number; days: number;
  distancePaise: number; bataPaise: number; packagePaise: number;
  taxablePaise: number; gstPaise: number; totalPaise: number; gstRate: number; gstIncluded: boolean;
  partnerPaise: number; rates: MulticityRates;
}

/**
 * Multicity tour = max(itinerary KM, daily minimum × calendar days) × rate + daily bata × days. GST is added on top, or
 * extracted from the fare when the GST policy says the fare already includes it. The partner is paid the same way at the
 * partner rates.
 */
export function quoteMulticity(i: { rates: MulticityRates; totalKm: number; days: number; gstRate: number; gstIncluded: boolean }): MulticityQuote {
  const r = i.rates;
  const totalKm = Math.round(i.totalKm * 10) / 10;
  const billableKm = Math.max(totalKm, r.minKmPerDay * i.days);
  const distancePaise = kmAmountPaise(billableKm, paise(r.customerRate));
  const bataPaise = paise(r.customerBata) * i.days;
  const packagePaise = distancePaise + bataPaise;
  const taxablePaise = i.gstIncluded ? taxableFromInclusivePaise(packagePaise, i.gstRate) : packagePaise;
  const gstPaise = i.gstIncluded ? packagePaise - taxablePaise : Math.round(gstOn(taxablePaise / 100, i.gstRate) * 100);
  return {
    totalKm, billableKm, days: i.days, distancePaise, bataPaise, packagePaise, taxablePaise, gstPaise, totalPaise: taxablePaise + gstPaise,
    gstRate: i.gstRate, gstIncluded: i.gstIncluded, rates: r,
    partnerPaise: kmAmountPaise(billableKm, paise(r.partnerRate)) + paise(r.partnerBata) * i.days,
  };
}
