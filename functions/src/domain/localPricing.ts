// Local fares by district: Local Pickup & Drop and Hourly Rental (Service & Fare Settings → Hourly Rental / Pickup & Drop).
//
// This file is the ONE pricing rule for both sides: the booking server prices trips with it and the admin Test quote previews
// with it. admin/src/domain/localPricing.ts is an exact copy (functions/test/localPricing.test.js fails when they differ), so
// it must stay free of imports.
//
//   Rates are saved per district, with optional overrides for a service zone (a group of pincodes) or an area: one village
//   (a post office of a pincode, key "625534~koduvilarpatti") or a whole pincode (key "625534").
//   A trip uses, for each vehicle: this brand's village → pincode → zone → district rate, then the shared (All brands) ones. Peak hours, toll / airport charges, night allowance and GST are one setting per brand (or the shared one).
//
// All amounts are rupees; sums are done in paise so nothing drifts.

export const LOCAL_CLASSES = ['hatchback', 'sedan', 'suv', 'suv7', 'innova', 'crysta', 'auto', 'bike'] as const;
export type LocalClass = (typeof LOCAL_CLASSES)[number];
/**
 * Auto and Bike are local vehicles: priced only from district rates (Pickup & Drop and Hourly Rental), never offered for
 * outstation, round trip, airport or multicity trips. Recognised by the vehicle category's name; null = a car.
 */
export function localOnlyClassOf(name: unknown): 'auto' | 'bike' | null {
  const n = String(name ?? '').trim().toLowerCase();
  if (/(^|[^a-z])(bike|scooter|scooty|motor ?cycle|two[- ]?wheeler)s?([^a-z]|$)/.test(n)) return 'bike';
  return /^(e[- ]?|electric |cng )?auto(?![a-z])|rickshaw/.test(n) ? 'auto' : null;
}
export const LOCAL_HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const LOCAL_BRANDS = ['common', 'nesam', 'people_taxi', 'onewaycarrentals'] as const;
export type LocalBrand = (typeof LOCAL_BRANDS)[number];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
/** The local night window: 10:00 PM up to, not including, 5:00 AM India time. */
export const NIGHT_FROM_HOUR = 22;
export const NIGHT_TO_HOUR = 5;
export const MAX_AMOUNT = 1_000_000;
export const MAX_FREE_WAIT_MINUTES = 1440;
export const MAX_ZONES = 40;
export const MAX_CORRIDORS = 100;
export const MAX_PEAK_RULES = 6;

export type Party = 'customer' | 'partner';
export type Scope = 'area' | 'zone' | 'district';
export type PeakChargeMode = 'percentage' | 'fixed';
export type TollSource = 'mapped_rate' | 'route_api' | 'at_actuals';
export type GstMode = 'excluded' | 'included';

/** Local Pickup & Drop rate of one vehicle: the bill is the base fare plus extra km, never below the minimum fare. */
export interface LocalRule {
  minimumFare: number;
  baseFare: number;
  includedKm: number;
  extraPerKm: number;
  freeWaitMins: number;
  waitPerMin: number;
}
export type LocalRuleField = keyof LocalRule;
export const RULE_FIELDS: readonly LocalRuleField[] = ['minimumFare', 'baseFare', 'includedKm', 'extraPerKm', 'freeWaitMins', 'waitPerMin'];

/** One hourly rental package of one vehicle. */
export interface RentalRow {
  customerFare: number;
  partnerPayout: number;
  includedKm: number;
  extraKmRate: number;
  extraHourRate: number;
}
export type RentalRowField = keyof RentalRow;
export const ROW_FIELDS: readonly RentalRowField[] = ['customerFare', 'partnerPayout', 'includedKm', 'extraKmRate', 'extraHourRate'];

export type RuleMap = Partial<Record<LocalClass, LocalRule>>;
/** Vehicle → hours ("1" … "15") → package. */
export type RentalMap = Partial<Record<LocalClass, Partial<Record<string, RentalRow>>>>;
/** The rates saved at one level (the district, one zone or one area). */
export interface LevelRates { customer?: RuleMap; partner?: RuleMap; rental?: RentalMap }
export interface Coverage { local?: boolean; outstation?: boolean }
/** One brand's (or the shared) rates of a district. */
export interface BrandFares {
  coverage?: Coverage;
  district: LevelRates;
  zones: Record<string, LevelRates>;
  areas: Record<string, LevelRates>;
}
export interface ServiceZone { id: string; name: string; pins: string[] }
/** The zones and Tamil names of a district (shared by every brand). */
export interface DistrictGeo { zones: ServiceZone[]; tamil: Record<string, string> }

export interface PeakRule {
  id: string;
  label: string;
  startHour: number;
  endHour: number;
  chargeMode: PeakChargeMode;
  /** Percent of the ride fare, or rupees. */
  value: number;
  /** The extra charge is never above this many rupees. */
  maxCap: number;
  active: boolean;
}
export interface TollCorridor { id: string; fromPin: string; toPin: string; name: string; amount: number }
export interface LocalSettings {
  peak: { localEnabled: boolean; rentalEnabled: boolean; weekdays: Weekday[]; rules: PeakRule[] };
  additional: {
    autoToll: boolean;
    tollSource: TollSource;
    /** Used when the route has a toll but no mapped / live amount is known. */
    tollAmount: number;
    corridors: TollCorridor[];
    airportEnabled: boolean;
    airportFee: number;
    /** Tolls the fare did not already include are billed from the driver's receipts. */
    tollsAtActuals: boolean;
    parkingAtActuals: boolean;
  };
  /** Pickup & Drop night allowance as a percent of the ride fare. 0 = this page adds none. */
  night: { percent: number };
  gst: { percent: number; mode: GstMode };
}

export const emptyRule = (): LocalRule => ({ minimumFare: 0, baseFare: 0, includedKm: 0, extraPerKm: 0, freeWaitMins: 0, waitPerMin: 0 });
export const emptyRow = (): RentalRow => ({ customerFare: 0, partnerPayout: 0, includedKm: 0, extraKmRate: 0, extraHourRate: 0 });
export const emptyFares = (): BrandFares => ({ district: {}, zones: {}, areas: {} });
export const emptyGeo = (): DistrictGeo => ({ zones: [], tamil: {} });
export function defaultSettings(): LocalSettings {
  return {
    peak: {
      localEnabled: false, rentalEnabled: false, weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      rules: [
        { id: 'morning_rush', label: 'Morning Peak', startHour: 7, endHour: 10, chargeMode: 'percentage', value: 0, maxCap: 0, active: false },
        { id: 'evening_rush', label: 'Evening Peak', startHour: 17, endHour: 20, chargeMode: 'percentage', value: 0, maxCap: 0, active: false },
      ],
    },
    additional: { autoToll: false, tollSource: 'mapped_rate', tollAmount: 0, corridors: [], airportEnabled: false, airportFee: 0, tollsAtActuals: true, parkingAtActuals: true },
    night: { percent: 0 },
    gst: { percent: 5, mode: 'excluded' },
  };
}

// ── Completeness ────────────────────────────────────────────────────────────

export const ruleIsEmpty = (r: LocalRule): boolean => RULE_FIELDS.every((f) => !(r[f] > 0));
/** A rate that can price a trip. Anything else is "not set" — it is never billed as ₹0. */
export const ruleIsSet = (r: LocalRule | undefined | null): r is LocalRule => !!r && (r.baseFare > 0 || r.minimumFare > 0) && r.extraPerKm > 0;
/** Why a half-filled rate cannot be saved ('' = fine: either complete or entirely empty). */
export function ruleProblem(r: LocalRule): string {
  if (ruleIsEmpty(r)) return '';
  if (!(r.baseFare > 0 || r.minimumFare > 0)) return 'enter a minimum fare or a base fare';
  if (!(r.extraPerKm > 0)) return 'enter the rate beyond the included km';
  if (!Number.isInteger(r.freeWaitMins) || r.freeWaitMins > MAX_FREE_WAIT_MINUTES) return `free waiting must be whole minutes up to ${MAX_FREE_WAIT_MINUTES}`;
  return '';
}
export const rowIsEmpty = (r: RentalRow): boolean => ROW_FIELDS.every((f) => !(r[f] > 0));
export const rowIsSet = (r: RentalRow | undefined | null): r is RentalRow => !!r && ROW_FIELDS.every((f) => r[f] > 0);
const ROW_LABEL: Record<RentalRowField, string> = { customerFare: 'customer fare', partnerPayout: 'partner payout', includedKm: 'included km', extraKmRate: 'extra km rate', extraHourRate: 'extra hour rate' };
export function rowProblem(r: RentalRow): string {
  if (rowIsEmpty(r)) return '';
  const missing = ROW_FIELDS.filter((f) => !(r[f] > 0));
  return missing.length ? `enter the ${missing.map((f) => ROW_LABEL[f]).join(', ')}` : '';
}

// ── Parsing (anything malformed is dropped) ─────────────────────────────────

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const money = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_AMOUNT ? Math.round(v * 100) / 100 : 0);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const isPin = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{5}$/.test(v);
export const isLocalId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

// ── Areas ───────────────────────────────────────────────────────────────────

/** How a village name is compared: letters only, without the part in brackets; "patty" and "patti" are the same. */
export const areaSlug = (name: string): string => name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z]+/g, '').replace(/patty$/, 'patti').slice(0, 60);
/** A pincode ("625534") or one village of it ("625534~koduvilarpatti"). */
export const isAreaKey = (v: unknown): v is string => typeof v === 'string' && /^[1-9]\d{5}(~[a-z]{1,60})?$/.test(v);
export const areaKeyOf = (pin: string, name: string): string => (areaSlug(name) ? `${pin}~${areaSlug(name)}` : pin);
export const pinOfArea = (key: string): string => key.slice(0, 6);
export const slugOfArea = (key: string): string => key.slice(7);
/**
 * The village names an address mentions, most specific first: the place's own name, then each part of its address. The
 * district's own name counts only when it comes first ("Allinagaram, Theni, …" is Allinagaram, not the village of Theni).
 */
export function areaNamesOf(texts: readonly (string | undefined)[], district: string): string[] {
  const parts = texts.flatMap((t) => (t ?? '').split(',')).map(areaSlug).filter((s) => s.length >= 3);
  return [...new Set(parts)].filter((s, i) => i === 0 || s !== areaSlug(district));
}

export function parseRule(v: unknown): LocalRule {
  const o = obj(v);
  return { minimumFare: money(o.minimumFare), baseFare: money(o.baseFare), includedKm: money(o.includedKm), extraPerKm: money(o.extraPerKm), freeWaitMins: Math.round(money(o.freeWaitMins)), waitPerMin: money(o.waitPerMin) };
}
export function parseRow(v: unknown): RentalRow {
  const o = obj(v);
  return { customerFare: money(o.customerFare), partnerPayout: money(o.partnerPayout), includedKm: money(o.includedKm), extraKmRate: money(o.extraKmRate), extraHourRate: money(o.extraHourRate) };
}
export function parseLevel(v: unknown): LevelRates {
  const o = obj(v);
  const out: LevelRates = {};
  for (const party of ['customer', 'partner'] as const) {
    const map: RuleMap = {};
    for (const cls of LOCAL_CLASSES) {
      const raw = obj(o[party])[cls];
      if (!raw) continue;
      const rule = parseRule(raw);
      if (ruleIsSet(rule)) map[cls] = rule;
    }
    if (Object.keys(map).length) out[party] = map;
  }
  const rental: RentalMap = {};
  for (const cls of LOCAL_CLASSES) {
    const rows: Partial<Record<string, RentalRow>> = {};
    for (const h of LOCAL_HOURS) {
      const raw = obj(obj(o.rental)[cls])[String(h)];
      if (!raw) continue;
      const row = parseRow(raw);
      if (rowIsSet(row)) rows[String(h)] = row;
    }
    if (Object.keys(rows).length) rental[cls] = rows;
  }
  if (Object.keys(rental).length) out.rental = rental;
  return out;
}
export const levelIsEmpty = (l: LevelRates): boolean => !l.customer && !l.partner && !l.rental;
export function parseFares(v: unknown): BrandFares {
  const o = obj(v);
  const out: BrandFares = { district: parseLevel(o.district), zones: {}, areas: {} };
  for (const [id, raw] of Object.entries(obj(o.zones))) {
    const level = parseLevel(raw);
    if (isLocalId(id) && !levelIsEmpty(level)) out.zones[id] = level;
  }
  for (const [key, raw] of Object.entries(obj(o.areas))) {
    const level = parseLevel(raw);
    if (isAreaKey(key) && !levelIsEmpty(level)) out.areas[key] = level;
  }
  const c = obj(o.coverage);
  const coverage: Coverage = {};
  if (typeof c.local === 'boolean') coverage.local = c.local;
  if (typeof c.outstation === 'boolean') coverage.outstation = c.outstation;
  if (Object.keys(coverage).length) out.coverage = coverage;
  return out;
}
/** True when the document says anything at all (a rate, or a coverage switch turned off). */
export const faresAreUsed = (f: BrandFares): boolean =>
  !levelIsEmpty(f.district) || Object.keys(f.zones).length > 0 || Object.keys(f.areas).length > 0 || f.coverage !== undefined;

export function parseGeo(v: unknown): DistrictGeo {
  const o = obj(v);
  const zones: ServiceZone[] = [];
  const taken = new Set<string>();
  for (const raw of Array.isArray(o.zones) ? o.zones : []) {
    const z = obj(raw);
    const name = str(z.name, 80);
    if (!isLocalId(z.id) || !name || zones.some((x) => x.id === z.id)) continue;
    const pins = (Array.isArray(z.pins) ? z.pins : []).filter((p): p is string => isPin(p) && !taken.has(p));
    pins.forEach((p) => taken.add(p));
    zones.push({ id: z.id as string, name, pins: [...new Set(pins)].sort() });
  }
  const tamil: Record<string, string> = {};
  for (const [key, name] of Object.entries(obj(o.tamil))) if (isAreaKey(key) && str(name, 80)) tamil[key] = str(name, 80);
  return { zones, tamil };
}

export function parseSettings(v: unknown): LocalSettings {
  const o = obj(v), d = defaultSettings();
  const peak = obj(o.peak), add = obj(o.additional), night = obj(o.night), gst = obj(o.gst);
  const hour = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 24 ? x : fallback);
  const rules: PeakRule[] = Array.isArray(peak.rules)
    ? peak.rules.slice(0, MAX_PEAK_RULES).map((raw, i) => {
      const r = obj(raw);
      return {
        id: isLocalId(r.id) ? (r.id as string) : `peak_${i + 1}`, label: str(r.label, 60) || `Peak ${i + 1}`,
        startHour: hour(r.startHour, 0), endHour: hour(r.endHour, 0), chargeMode: r.chargeMode === 'fixed' ? 'fixed' : 'percentage',
        value: money(r.value), maxCap: money(r.maxCap), active: r.active === true,
      };
    })
    : d.peak.rules;
  const corridors: TollCorridor[] = (Array.isArray(add.corridors) ? add.corridors : []).slice(0, MAX_CORRIDORS).flatMap((raw, i) => {
    const c = obj(raw);
    return isPin(c.fromPin) && isPin(c.toPin) ? [{ id: isLocalId(c.id) ? (c.id as string) : `toll_${i + 1}`, fromPin: c.fromPin, toPin: c.toPin, name: str(c.name, 80), amount: money(c.amount) }] : [];
  });
  const source = add.tollSource === 'route_api' || add.tollSource === 'at_actuals' ? add.tollSource : 'mapped_rate';
  return {
    peak: {
      localEnabled: peak.localEnabled === true, rentalEnabled: peak.rentalEnabled === true,
      weekdays: Array.isArray(peak.weekdays) ? WEEKDAYS.filter((w) => (peak.weekdays as unknown[]).includes(w)) : d.peak.weekdays,
      rules,
    },
    additional: {
      autoToll: add.autoToll === true, tollSource: source, tollAmount: money(add.tollAmount), corridors,
      airportEnabled: add.airportEnabled === true, airportFee: money(add.airportFee),
      tollsAtActuals: add.tollsAtActuals !== false, parkingAtActuals: add.parkingAtActuals !== false,
    },
    night: { percent: Math.min(100, money(night.percent)) },
    gst: { percent: typeof gst.percent === 'number' && gst.percent >= 0 && gst.percent <= 40 ? Math.round(gst.percent * 100) / 100 : d.gst.percent, mode: gst.mode === 'included' ? 'included' : 'excluded' },
  };
}

/** Why these settings cannot be saved ('' = fine). Checked by the admin page and again by the server. */
export function settingsProblem(s: LocalSettings): string {
  const nums: [number, string][] = [[s.additional.tollAmount, 'The toll amount'], [s.additional.airportFee, 'The airport entry charge'], [s.night.percent, 'The night allowance'], [s.gst.percent, 'GST']];
  for (const r of s.peak.rules) nums.push([r.value, `${r.label}: the charge`], [r.maxCap, `${r.label}: the max cap`]);
  for (const c of s.additional.corridors) nums.push([c.amount, 'A mapped toll amount']);
  for (const [n, label] of nums) if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return `${label} must be zero or more.`;
  if (s.night.percent > 100) return 'The night allowance cannot be above 100%.';
  if (s.gst.percent > 40) return 'GST cannot be above 40%.';
  if (s.peak.rules.length > MAX_PEAK_RULES) return `Use at most ${MAX_PEAK_RULES} peak windows.`;
  const active = s.peak.rules.filter((r) => r.active);
  for (const r of s.peak.rules) {
    if (!Number.isInteger(r.startHour) || !Number.isInteger(r.endHour) || r.startHour < 0 || r.endHour > 24 || r.startHour >= r.endHour) return `${r.label}: the end time must be after the start time.`;
    if (!r.active) continue;
    if (!(r.value > 0)) return `${r.label}: enter the extra charge, or untick the window.`;
    if (r.chargeMode === 'percentage' && r.value > 100) return `${r.label}: the percentage cannot be above 100.`;
    if (!(r.maxCap > 0)) return `${r.label}: enter the max cap (the most extra a trip can be charged).`;
  }
  for (let a = 0; a < active.length; a++) for (let b = a + 1; b < active.length; b++) {
    if (active[a]!.startHour < active[b]!.endHour && active[b]!.startHour < active[a]!.endHour) return `${active[a]!.label} and ${active[b]!.label} overlap. A trip can have only one peak window.`;
  }
  if ((s.peak.localEnabled || s.peak.rentalEnabled) && !s.peak.weekdays.length) return 'Choose at least one weekday for peak pricing.';
  const add = s.additional;
  if (add.corridors.length > MAX_CORRIDORS) return `Use at most ${MAX_CORRIDORS} mapped toll routes.`;
  if (add.corridors.some((c) => !isPin(c.fromPin) || !isPin(c.toPin))) return 'Choose both areas of every mapped toll route, or remove it.';
  if (add.autoToll && add.tollSource === 'route_api' && !(add.tollAmount > 0)) return 'Enter the fallback toll amount used when the live route has no price.';
  if (add.autoToll && add.tollSource === 'mapped_rate' && add.corridors.some((c) => !(c.amount > 0)) && !(add.tollAmount > 0)) {
    return 'Enter an amount for every mapped toll route, or a fallback amount.';
  }
  if (add.airportEnabled && !(add.airportFee > 0)) return 'Enter the airport entry charge, or switch it off.';
  return '';
}

// ── Documents ───────────────────────────────────────────────────────────────

/** "33~theni": the state's GST code and the district. */
export const districtKey = (state: string, district: string): string => `${state}~${district.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
export const LOCAL_INDEX_DOC = 'business_config/local_fare_index';
export const geoDoc = (key: string): string => `business_config/local_geo_${key}`;
export const faresDoc = (key: string, brand: string): string => `business_config/local_fares_${key}_${brand}`;
export const settingsDoc = (brand: string): string => `business_config/local_settings_${brand}`;
/** The districts that have saved rates or coverage, and for which brands. */
export interface LocalIndex { districts: Record<string, { state: string; district: string; brands: string[] }> }
export function parseIndex(v: unknown): LocalIndex {
  const out: LocalIndex = { districts: {} };
  for (const [key, raw] of Object.entries(obj(obj(v).districts))) {
    const d = obj(raw);
    const brands = (Array.isArray(d.brands) ? d.brands : []).filter((b): b is string => (LOCAL_BRANDS as readonly unknown[]).includes(b));
    if (typeof d.state === 'string' && typeof d.district === 'string' && brands.length) out.districts[key] = { state: d.state, district: d.district, brands };
  }
  return out;
}

// ── Inheritance ─────────────────────────────────────────────────────────────

export type FaresByBrand = Partial<Record<string, BrandFares>>;
export interface Target {
  pin?: string;
  zoneId?: string;
  /** Village slugs of the place, most specific first (areaNamesOf). */
  areaNames?: readonly string[];
}
export interface Resolved<T> { value: T; scope: Scope; brand: string }

export const zoneOfPin = (geo: DistrictGeo, pin: string | undefined): ServiceZone | undefined => (pin ? geo.zones.find((z) => z.pins.includes(pin)) : undefined);
const brandOrder = (brand: string): string[] => (brand === 'common' ? ['common'] : [brand, 'common']);

function resolveAt<T>(fares: FaresByBrand, brand: string, target: Target, read: (level: LevelRates) => T | undefined): Resolved<T> | null {
  for (const b of brandOrder(brand)) {
    const f = fares[b];
    if (!f) continue;
    const villages = target.pin ? (target.areaNames ?? []).map((n): [Scope, LevelRates | undefined] => ['area', f.areas[`${target.pin}~${n}`]]) : [];
    const levels: [Scope, LevelRates | undefined][] = [
      ...villages,
      ['area', target.pin ? f.areas[target.pin] : undefined],
      ['zone', target.zoneId ? f.zones[target.zoneId] : undefined],
      ['district', f.district],
    ];
    for (const [scope, level] of levels) {
      const value = level ? read(level) : undefined;
      if (value !== undefined) return { value, scope, brand: b };
    }
  }
  return null;
}
export const resolveRule = (fares: FaresByBrand, brand: string, party: Party, cls: LocalClass, target: Target): Resolved<LocalRule> | null =>
  resolveAt(fares, brand, target, (l) => { const r = l[party]?.[cls]; return ruleIsSet(r) ? r : undefined; });
export const resolveRow = (fares: FaresByBrand, brand: string, cls: LocalClass, hours: number, target: Target): Resolved<RentalRow> | null =>
  resolveAt(fares, brand, target, (l) => { const r = l.rental?.[cls]?.[String(hours)]; return rowIsSet(r) ? r : undefined; });
/** The package hours that have a rate here, shortest first. */
export const rentalHoursFor = (fares: FaresByBrand, brand: string, cls: LocalClass, target: Target): number[] =>
  LOCAL_HOURS.filter((h) => resolveRow(fares, brand, cls, h, target) !== null);
export function resolveCoverage(fares: FaresByBrand, brand: string): Required<Coverage> {
  const pick = (k: keyof Coverage) => { for (const b of brandOrder(brand)) { const v = fares[b]?.coverage?.[k]; if (v !== undefined) return v; } return true; };
  return { local: pick('local'), outstation: pick('outstation') };
}

// ── Calculation ─────────────────────────────────────────────────────────────

const p = (rupees: number): number => Math.round(rupees * 100);
const km1 = (km: number): number => Math.round(Math.max(0, km) * 10) / 10;

/** Weekday and hour of an instant in India. */
export function istParts(ms: number): { weekday: Weekday; hour: number } {
  const d = new Date(ms + 330 * 60000);
  return { weekday: WEEKDAYS[(d.getUTCDay() + 6) % 7]!, hour: d.getUTCHours() };
}
export const isNightHour = (hour: number): boolean => hour >= NIGHT_FROM_HOUR || hour < NIGHT_TO_HOUR;

/** The one peak window that applies to a pickup time, if any. */
export function matchPeak(s: LocalSettings, service: 'local' | 'rental', weekday: Weekday, hour: number): PeakRule | null {
  const on = service === 'local' ? s.peak.localEnabled : s.peak.rentalEnabled;
  if (!on || !s.peak.weekdays.includes(weekday)) return null;
  return s.peak.rules.find((r) => r.active && hour >= r.startHour && hour < r.endHour) ?? null;
}
/** The peak extra on a ride fare: whole rupees, never above the cap. */
export function peakAmount(rule: PeakRule | null, rideFare: number): number {
  if (!rule) return 0;
  const raw = rule.chargeMode === 'percentage' ? Math.round((p(rideFare) * rule.value) / 10000) : rule.value;
  return Math.max(0, Math.min(rule.maxCap, raw));
}

/** What a live routing service said about a route's tolls; null = it could not be asked. */
export type LiveToll = { hasToll: boolean; price: number | null } | null;
/** The toll added to the fare automatically for a route between two areas. */
export function autoTollAmount(s: LocalSettings, fromPin: string, toPin: string, live: LiveToll): number {
  const a = s.additional;
  if (!a.autoToll || a.tollSource === 'at_actuals') return 0;
  if (a.tollSource === 'route_api') return live?.hasToll ? (live.price && live.price > 0 ? Math.round(live.price) : a.tollAmount) : 0;
  const hit = a.corridors.find((c) => (c.fromPin === fromPin && c.toPin === toPin) || (c.fromPin === toPin && c.toPin === fromPin));
  return hit ? (hit.amount > 0 ? hit.amount : a.tollAmount) : 0;
}

/** Base fare plus extra km (without the minimum fare floor), paise. */
const rawRidePaise = (r: LocalRule, km: number): number => p(r.baseFare) + Math.round(km1(km1(km) - r.includedKm) * p(r.extraPerKm));
/** The ride fare for a distance: base + extra km, never below the minimum fare. Rupees. */
export const rideFare = (r: LocalRule, km: number): number => Math.max(p(r.minimumFare), rawRidePaise(r, km)) / 100;

export interface RideParts {
  distanceKm: number;
  baseFare: number;
  includedKm: number;
  extraKm: number;
  extraKmCharge: number;
  /** What was added to reach the minimum fare. */
  minimumTopUp: number;
  /** The eligible ride fare: the base for peak and night. */
  rideFare: number;
}
export function rideParts(r: LocalRule, km: number): RideParts {
  const distanceKm = km1(km), extraKm = km1(distanceKm - r.includedKm), raw = rawRidePaise(r, distanceKm), fare = Math.max(p(r.minimumFare), raw);
  return { distanceKm, baseFare: r.baseFare, includedKm: r.includedKm, extraKm, extraKmCharge: (raw - p(r.baseFare)) / 100, minimumTopUp: (fare - raw) / 100, rideFare: fare / 100 };
}

/**
 * Waiting after the free minutes. While a fare sits on its minimum, waiting first uses up the difference between the minimum
 * and the metered amount, exactly as "never below the minimum fare" means: bill = max(minimum, base + extra km + waiting).
 */
export function waitingCharge(r: LocalRule, km: number, waitMins: number): { chargeableMins: number; metered: number; charge: number } {
  const chargeableMins = Math.max(0, Math.floor(waitMins) - r.freeWaitMins);
  const metered = (chargeableMins * p(r.waitPerMin)) / 100;
  const raw = rawRidePaise(r, km);
  const charge = Math.max(0, Math.max(p(r.minimumFare), raw + p(metered)) - Math.max(p(r.minimumFare), raw)) / 100;
  return { chargeableMins, metered, charge };
}
/** How much of later waiting the minimum fare already covers, rupees. */
export const minimumHeadroom = (r: LocalRule, km: number): number => Math.max(0, p(r.minimumFare) - rawRidePaise(r, km)) / 100;

export interface RideQuote extends RideParts {
  peakRule: PeakRule | null;
  peak: number;
  night: number;
  toll: number;
  airport: number;
}
/** Everything a Pickup & Drop booking is quoted before GST. Waiting is not known yet: it is billed after the trip. */
export function quoteLocalRide(i: { rule: LocalRule; settings: LocalSettings; km: number; pickupMs: number; airportTrip: boolean; toll: number }): RideQuote {
  const parts = rideParts(i.rule, i.km);
  const { weekday, hour } = istParts(i.pickupMs);
  const peakRule = matchPeak(i.settings, 'local', weekday, hour);
  const night = isNightHour(hour) ? Math.round((p(parts.rideFare) * i.settings.night.percent) / 10000) : 0;
  return {
    ...parts, peakRule, peak: peakAmount(peakRule, parts.rideFare), night,
    toll: Math.max(0, i.toll), airport: i.settings.additional.airportEnabled && i.airportTrip ? i.settings.additional.airportFee : 0,
  };
}
export function quoteRentalRow(i: { row: RentalRow; settings: LocalSettings; pickupMs: number }): { peakRule: PeakRule | null; peak: number } {
  const { weekday, hour } = istParts(i.pickupMs);
  const peakRule = matchPeak(i.settings, 'rental', weekday, hour);
  return { peakRule, peak: peakAmount(peakRule, i.row.customerFare) };
}

/** GST on a sum of entered amounts: added on top, or taken out of them when the fares include it. */
export function gstTotals(sum: number, percent: number, mode: GstMode): { taxable: number; gst: number; total: number } {
  const paise = p(sum), rate = percent / 100;
  if (mode === 'included') {
    const taxable = Math.round(paise / (1 + rate));
    return { taxable: taxable / 100, gst: (paise - taxable) / 100, total: paise / 100 };
  }
  const gst = Math.round(paise * rate);
  return { taxable: paise / 100, gst: gst / 100, total: (paise + gst) / 100 };
}

/**
 * Which of the driver's toll / parking receipts are billed on top of the fare, rupees. A toll or airport entry the fare already
 * includes is never billed a second time. State permit and driver allowance receipts are not tolls: they are always billed.
 */
export function billableReceipts(receipts: readonly { name?: string; amount: number }[], rules: { tollsAtActuals: boolean; parkingAtActuals: boolean; prepaidToll: number; prepaidEntry?: number }): number {
  let tolls = 0, parking = 0, entry = 0, other = 0;
  for (const r of receipts) {
    const name = r.name ?? '';
    if (/permit|bata|state tax/i.test(name)) other += p(r.amount);
    else if (/entry|airport/i.test(name)) entry += p(r.amount);
    else if (/park/i.test(name)) parking += p(r.amount);
    else tolls += p(r.amount);
  }
  const extraTolls = rules.tollsAtActuals ? Math.max(0, tolls - p(rules.prepaidToll)) : 0;
  const parkingAndEntry = rules.parkingAtActuals ? parking + Math.max(0, entry - p(rules.prepaidEntry ?? 0)) : 0;
  return (extraTolls + parkingAndEntry + other) / 100;
}
