import { parseRentalPackageRule } from './domain/tariff';
// Admin edits to business_config/tariff_v2, one section at a time: base rates (with outstation extra
// usage and the airport fare), a city's Local Pickup & Drop fare, a class's minimum rental hours and a
// rental package. Each save is validated here (the editors' checks are only a convenience), refuses a stale
// edit, bumps the tariff version and writes the audit entry in the same transaction. A saved tariff only
// changes NEW quotes: a booking keeps the pricing snapshot it was quoted with.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { parseHillStationConfig } from './domain/hillStations';
import { MAX_EXTRA_SLABS, MAX_PACKAGE_NAME, PACKAGE_NAME_KEYS, cleanPackageName, extraSlabId, isExtraSlabId, parsePackageNames, type ExtraSlab, type ExtraSlabId } from './domain/timeBased';
import {
  BrandFareOverride, RENTAL_HOURS, RentalPackage, TARIFF_CLASSES, TariffClass, TariffConfig, TimeBasedClassRates, TimeBasedSettings, DEFAULT_TIME_BASED, parseRentalPackage, parseTariffConfig, rentalMinHours, scopedTariffForBrand,
} from './domain/tariff';
import { EXTRA_CATEGORY_ID, ExtraChargeRow, ExtraChargeSide, ExtraChargesConfig, MAX_FREE_WAITING_MINUTES, MAX_WAITING_ROUNDING_MINUTES, ROUNDING_SCOPES, RoundingScope, TAX_TREATMENTS, TaxTreatment } from './domain/extraCharges';
import { TARIFF_DOC } from './quote';
import { requirePermission, text, requireAction } from './shared';
import { BRAND_SUPPORTED_SERVICES, BrandId, SUPPORTED_BRANDS } from './brandContext';
import { gstState, validGstRule, type FareGstRule } from './domain/gst';

const MAX_AMOUNT = 1_000_000;
const bad = (m: string) => new HttpsError('invalid-argument', m);

/** A finite rupee amount at paise precision. `positive` forbids zero (allowances and waiting may be zero). */
function amount(v: unknown, label: string, positive: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${label} must be a number.`);
  if (positive ? v <= 0 : v < 0) throw bad(`${label} must be ${positive ? 'greater than zero' : 'zero or more'}.`);
  if (v > MAX_AMOUNT) throw bad(`${label} is too large.`);
  return Math.round(v * 100) / 100;
}

const obj = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${label} is missing.`);
  return v as Record<string, unknown>;
};

function classOf(v: unknown): TariffClass {
  if (typeof v !== 'string' || !(TARIFF_CLASSES as readonly string[]).includes(v)) throw bad('Choose a supported vehicle category.');
  return v as TariffClass;
}

function hoursOf(v: unknown): number {
  if (typeof v !== 'number' || !(RENTAL_HOURS as readonly number[]).includes(v)) throw bad(`Choose a whole-hour rental package from 1 to 15 hours.`);
  return v;
}

// ── Section: base rates, outstation extra usage, airport ────────────────────

function applyBaseRates(base: TariffConfig, d: Record<string, unknown>): TariffConfig {
  const next: TariffConfig = {
    ...base,
    oneWay: { ...base.oneWay, classes: { ...base.oneWay.classes } },
    roundTrip: { ...base.roundTrip, classes: { ...base.roundTrip.classes } },
    outstationExtras: { ...(base.outstationExtras ?? {}) },
    oneWayExtras: { ...(base.oneWayExtras ?? {}) },
    roundTripExtras: { ...(base.roundTripExtras ?? {}) },
  };
  next.oneWay.minKm = amount(d.oneWayMinKm, 'One Way minimum kilometres', true);
  if (d.airport != null) {
    const a = obj(d.airport, 'The airport fare');
    next.airport = { customerBase: amount(a.customerBase, 'Airport customer base fare', true), partnerBase: amount(a.partnerBase, 'Airport partner base payout', true) };
  }
  const classes = obj(d.classes, 'The category rates');
  for (const [key, raw] of Object.entries(classes)) {
    const cls = classOf(key);
    // Innova and SUV 7+1 may be cleared (null): they then use the SUV rates again. Every other class must stay configured.
    if (raw === null) {
      if (cls !== 'innova' && cls !== 'suv7' && cls !== 'hatchback') throw bad('Only the Hatchback, Innova and SUV 7+1 rates can be cleared.');
      delete next.oneWay.classes[cls]; delete next.roundTrip.classes[cls]; delete next.outstationExtras![cls];
      delete next.oneWayExtras![cls]; delete next.roundTripExtras![cls];
      continue;
    }
    const c = obj(raw, `The ${cls} rates`);
    const one = obj(c.oneWay, `The ${cls} One Way rates`), round = obj(c.roundTrip, `The ${cls} Round Trip rates`);
    next.oneWay.classes[cls] = {
      customerRate: amount(one.customerRate, `${cls} Customer One Way rate`, true), partnerRate: amount(one.partnerRate, `${cls} Partner One Way rate`, true),
      customerBata: amount(one.customerBata, `${cls} Customer allowance`, false), partnerBata: amount(one.partnerBata, `${cls} Partner allowance`, false),
    };
    const minKmPerDay = amount(round.minKmPerDay, `${cls} Round Trip minimum kilometres per day`, true);
    next.roundTrip.classes[cls] = {
      customerRate: amount(round.customerRate, `${cls} Customer Round Trip rate`, true), partnerRate: amount(round.partnerRate, `${cls} Partner Round Trip rate`, true),
      // One Way and Round Trip keep separate allowances (the confirmed Crysta values differ), so each has its own pair.
      customerBata: amount(round.customerBata, `${cls} Round Trip customer allowance`, false), partnerBata: amount(round.partnerBata, `${cls} Round Trip partner allowance`, false),
      minKmPerDay,
      // The mini round-trip slab is its own section (below); keep it as it was.
      ...(base.roundTrip.classes[cls]?.miniFare ? { miniFare: base.roundTrip.classes[cls]!.miniFare, miniPartnerFare: base.roundTrip.classes[cls]!.miniPartnerFare } : {}),
      // The time-based round trip packages are their own section (below); keep them as they were.
      ...((base.roundTrip.classes[cls]?.timeBased ?? base.roundTrip.packages?.[cls]) ? { timeBased: base.roundTrip.classes[cls]?.timeBased ?? base.roundTrip.packages![cls] } : {}),
    };
    // Old clients can still update the shared fallback, but cannot overwrite separately saved journey rates.
    for (const [field, target, label] of [
      ['outstationExtra', next.outstationExtras!, 'Outstation'],
      ['oneWayExtra', next.oneWayExtras!, 'One Way'],
      ['roundTripExtra', next.roundTripExtras!, 'Round Trip'],
    ] as const) {
      if (c[field] === undefined) continue;
      const extra = obj(c[field], `The ${cls} ${label} extra usage`);
      target[cls] = {
        extraKmRate: amount(extra.extraKmRate, `${cls} ${label} customer extra charge per kilometre`, true),
        waitingPerHour: amount(extra.waitingPerHour, `${cls} ${label} customer extra charge per waiting hour`, false),
      };
    }
  }
  return next;
}

// ── Section: Local Pickup & Drop ────────────────────────────────────────────

/**
 * The place a Local Pickup & Drop fare is saved for: an active City of the location master, or an active zone of a City
 * (an "Area / Locality" record). A zone's fare is used for trips that start in that zone and stay in its City; a vehicle class
 * with no enabled zone fare keeps the City's fare (functions/src/quote.ts, zoneIdOf).
 */
async function cityOf(id: unknown): Promise<{ id: string; name: string; parentCityId?: string }> {
  if (typeof id !== 'string' || !id || id.includes('/')) throw bad('Choose a city.');
  const snap = await db.doc(`locations/${id}`).get();
  const l = snap.data();
  if (!snap.exists || !l || (l.type !== 'City' && l.type !== 'Area / Locality')) throw bad('That is not a city or zone in the location master.');
  if (l.status !== 'Active') throw bad(`That ${l.type === 'City' ? 'city' : 'zone'} is not active in the location master.`);
  const name = text(l.name, 80) || text(l.area, 80) || text(l.city, 80) || snap.id;
  if (l.type === 'City') return { id: snap.id, name };
  const parentCityId = await zoneCityId(snap.id, l);
  if (!parentCityId) throw bad('That zone is not linked to an active city. Set its city in Locations first.');
  return { id: snap.id, name, parentCityId };
}

/** The active City a zone belongs to: its parent record when that is a City, else the one active City with the same name and state. */
async function zoneCityId(zoneId: string, z: DocumentData): Promise<string | null> {
  const parent = typeof z.parentLocationId === 'string' && z.parentLocationId && !z.parentLocationId.includes('/') ? await db.doc(`locations/${z.parentLocationId}`).get() : null;
  if (parent?.exists && parent.data()?.type === 'City' && parent.data()?.status === 'Active') return parent.id;
  if (!z.city) return null;
  const cities = await db.collection('locations').where('type', '==', 'City').where('status', '==', 'Active').where('city', '==', z.city).get();
  const same = cities.docs.filter((d) => d.id !== zoneId && (!z.state || !d.data().state || d.data().state === z.state));
  return same.length === 1 ? same[0]!.id : null;
}

function applyLocal(base: TariffConfig, city: { id: string; name: string; parentCityId?: string }, cls: TariffClass, f: Record<string, unknown>): TariffConfig {
  if (typeof f.enabled !== 'boolean') throw bad('Choose whether this fare is enabled.');
  const existing = base.localPickupDrop?.[city.id];
  const fare = {
    minKm: amount(f.minKm, 'Minimum billable kilometres', true),
    customerRate: amount(f.customerRate, 'Customer rate per kilometre', true),
    partnerRate: amount(f.partnerRate, 'Partner rate per kilometre', true),
    extraKmRate: amount(f.extraKmRate, 'Extra kilometre rate', true),
    waitingPerHour: amount(f.waitingPerHour, 'Waiting charge', false),
    enabled: f.enabled,
  };
  return { ...base, localPickupDrop: { ...(base.localPickupDrop ?? {}), [city.id]: { cityName: city.name, ...(city.parentCityId ? { parentCityId: city.parentCityId } : {}), classes: { ...(existing?.classes ?? {}), [cls]: fare } } } };
}

/**
 * Local Pickup & Drop fares for many cities in one save (the demo setup covers every city of the location master).
 * `fares` maps a city id to the fare of each vehicle class; every fare is checked exactly like a single save. A city that is not an
 * active City of the location master is skipped (and counted), never saved.
 */
const MAX_BULK_CITIES = 800;
async function citiesOf(ids: string[]): Promise<Map<string, { id: string; name: string }>> {
  if (ids.length > MAX_BULK_CITIES) throw bad(`Save at most ${MAX_BULK_CITIES} cities at a time.`);
  const out = new Map<string, { id: string; name: string }>();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).filter((id) => id && !id.includes('/')).map((id) => db.doc(`locations/${id}`));
    if (!refs.length) continue;
    for (const snap of await db.getAll(...refs)) {
      const l = snap.data();
      if (snap.exists && l && l.type === 'City' && l.status === 'Active') out.set(snap.id, { id: snap.id, name: text(l.name, 80) || text(l.city, 80) || snap.id });
    }
  }
  return out;
}

function applyLocalBulk(base: TariffConfig, fares: Record<string, unknown>, cities: Map<string, { id: string; name: string }>): { next: TariffConfig; saved: number; skipped: number } {
  let next = base, saved = 0, skipped = 0;
  for (const [cityId, byClass] of Object.entries(fares)) {
    const city = cities.get(cityId);
    if (!city) { skipped += 1; continue; }
    for (const [key, raw] of Object.entries(obj(byClass, `The ${city.name} fares`))) next = applyLocal(next, city, classOf(key), obj(raw, `The ${city.name} ${key} fare`));
    saved += 1;
  }
  return { next, saved, skipped };
}

// ── Section: extra charges (waiting, hill, roof carrier) ────────────────────

/** One rate of one side: null / missing = not configured (the value is removed); a number ≥ 0 is stored — 0 is an explicit "no charge". */
function optionalAmount(v: unknown, label: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  return amount(v, label, false);
}

function extraSide(v: unknown, who: 'Customer' | 'Partner', cat: string): ExtraChargeSide {
  const s = v === undefined || v === null ? {} : obj(v, `${cat} ${who.toLowerCase()} charges`);
  const out: ExtraChargeSide = {};
  const waiting = optionalAmount(s.waitingPerHour, `${cat}: ${who} waiting per hour`);
  const hill = optionalAmount(s.hill, `${cat}: ${who} hill charge per trip`);
  const carrier = optionalAmount(s.carrier, `${cat}: ${who} carrier charge per trip`);
  if (waiting !== undefined) out.waitingPerHour = waiting;
  if (hill !== undefined) out.hill = hill;
  if (carrier !== undefined) out.carrier = carrier;
  return out;
}

function wholeMinutes(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw bad(`${label} must be a whole number of minutes.`);
  if (v < min || v > max) throw bad(`${label} must be from ${min} to ${max} minutes.`);
  return v;
}

/** The categories a payload refers to, checked against the real vehicle_categories (before the transaction, like cityOf). */
async function extraCategoryNames(data: Record<string, unknown>): Promise<Map<string, string>> {
  const rows = obj(data.categories, 'The category charges');
  const ids = Object.keys(rows);
  if (ids.length > 50) throw bad('Too many categories in one save.');
  const names = new Map<string, string>();
  for (const id of ids) {
    if (!EXTRA_CATEGORY_ID.test(id)) throw bad('Choose a valid vehicle category.');
    const snap = await db.doc(`vehicle_categories/${id}`).get();
    if (!snap.exists) throw bad(`Vehicle category "${id}" does not exist.`);
    names.set(id, text(snap.data()?.name, 80) || id);
  }
  return names;
}

/**
 * Replaces the submitted categories' rows and the waiting rules; categories that are not in the payload — including inactive
 * or renamed ones — keep their saved rows untouched. The section's own version is bumped here, never taken from the client.
 */
function applyExtraCharges(base: TariffConfig, d: Record<string, unknown>, names: Map<string, string>): { next: TariffConfig; changed: string[] } {
  const freeWaitingMinutes = wholeMinutes(d.freeWaitingMinutes, 'Free waiting per stop', 0, MAX_FREE_WAITING_MINUTES);
  const waitingRoundingMinutes = wholeMinutes(d.waitingRoundingMinutes, 'The waiting rounding interval', 1, MAX_WAITING_ROUNDING_MINUTES);
  const rows = obj(d.categories, 'The category charges');
  const categories: Record<string, ExtraChargeRow> = { ...(base.extraCharges?.categories ?? {}) };
  const changed: string[] = [];
  for (const [id, raw] of Object.entries(rows)) {
    const name = names.get(id) ?? id;
    const r = obj(raw, `The ${name} charges`);
    const row: ExtraChargeRow = { customer: extraSide(r.customer, 'Customer', name), partner: extraSide(r.partner, 'Partner', name) };
    const empty = !Object.keys(row.customer).length && !Object.keys(row.partner).length;
    if (empty) { if (categories[id]) { delete categories[id]; changed.push(id); } continue; }
    if (JSON.stringify(categories[id] ?? null) !== JSON.stringify(row)) changed.push(id);
    categories[id] = row;
  }
  // Two business decisions are explicit settings, never assumed: how rounding is scoped and how the customer's extra charges are taxed.
  // "Not decided" (null) is allowed and keeps monetary posting of approved usage blocked.
  const scope = d.waitingRoundingScope ?? null, tax = d.taxTreatment ?? null;
  if (scope !== null && !(ROUNDING_SCOPES as readonly unknown[]).includes(scope)) throw bad('Choose how waiting is rounded: per stop or combined.');
  if (tax !== null && !(TAX_TREATMENTS as readonly unknown[]).includes(tax)) throw bad('Choose how extra charges are taxed.');
  const extraCharges: ExtraChargesConfig = {
    version: (base.extraCharges?.version ?? 0) + 1, freeWaitingMinutes, waitingRoundingMinutes, categories,
    ...(scope ? { waitingRoundingScope: scope as RoundingScope } : {}), ...(tax ? { taxTreatment: tax as TaxTreatment } : {}),
  };
  return { next: { ...base, extraCharges }, changed };
}

// ── Sections: rental minimum and packages ───────────────────────────────────

function applyRentalMinimum(base: TariffConfig, cls: TariffClass, hours: unknown): TariffConfig {
  if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 15) throw bad('The minimum rental must be a whole number of hours from 1 to 15.');
  const current = base.rentalPackages?.[cls];
  // Packages already saved are kept untouched; the ones below the new minimum simply stop being quotable.
  return { ...base, rentalPackages: { ...(base.rentalPackages ?? {}), [cls]: { packages: current?.packages ?? {}, minHours: hours } } };
}

function applyRentalPackage(base: TariffConfig, cls: TariffClass, hours: number, p: Record<string, unknown>): TariffConfig {
  const min = rentalMinHours(base, cls);
  if (hours < min) throw bad(`A ${hours}-hour package is shorter than this category's ${min}-hour minimum.`);
  if (typeof p.enabled !== 'boolean') throw bad('Choose whether this package is available.');
  if (p.gstMode !== 'included' && p.gstMode !== 'excluded') throw bad('Choose whether the fare includes GST or GST is added.');
  const pkg: RentalPackage | null = parseRentalPackage({
    customerFare: amount(p.customerFare, 'Customer fare', true), partnerPayout: amount(p.partnerPayout, 'Partner payout', true),
    includedKm: amount(p.includedKm, 'Covered kilometres', true), extraKmRate: amount(p.extraKmRate, 'Extra kilometre charge', true),
    extraHourRate: amount(p.extraHourRate, 'Extra hour charge', true), gstMode: p.gstMode, enabled: p.enabled,
  });
  if (!pkg) throw bad('The rental package is incomplete.');
  const current = base.rentalPackages?.[cls];
  return { ...base, rentalPackages: { ...(base.rentalPackages ?? {}), [cls]: { ...(current?.minHours ? { minHours: current.minHours } : {}), packages: { ...(current?.packages ?? {}), [String(hours)]: pkg } } } };
}

// ── Section: mini round trip (short same-day slab + the overnight combo's day 1) ───

function applyRoundTripMini(base: TariffConfig, d: Record<string, unknown>): TariffConfig {
  const next: TariffConfig = { ...base, roundTrip: { ...base.roundTrip, classes: { ...base.roundTrip.classes } } };
  next.roundTrip.miniMaxHours = amount(d.miniMaxHours, 'Mini round-trip hour limit', true);
  next.roundTrip.miniMaxKm = amount(d.miniMaxKm, 'Mini round-trip kilometre limit', true);
  const classes = obj(d.classes, 'The mini fares');
  for (const [key, raw] of Object.entries(classes)) {
    const cls = classOf(key);
    const current = next.roundTrip.classes[cls];
    if (!current) throw bad(`Set the ${cls} Round Trip base rates before its mini fare.`);
    if (raw === null) {
      const { miniFare: _mf, miniPartnerFare: _mp, ...rest } = current;
      next.roundTrip.classes[cls] = rest;
      continue;
    }
    const m = obj(raw, `The ${cls} mini fare`);
    next.roundTrip.classes[cls] = {
      ...current,
      miniFare: amount(m.miniFare, `${cls} mini customer fare`, true),
      miniPartnerFare: amount(m.miniPartnerFare, `${cls} mini partner fare`, true),
    };
  }
  return next;
}

// ── Section: time-based round trip (Customer UX v7) ─────────────────────────

/** One fuel's package amounts of a class, checked. `cls` names it in messages ("sedan", "sedan CNG"). */
function timeBasedAmounts(m: Record<string, unknown>, cls: string, settings: TimeBasedSettings): TimeBasedClassRates {
  const morning = ['morningFare', 'morningKm', 'morningPartner'].map((k) => m[k]);
  const anyMorning = morning.some((v) => v !== undefined && v !== null && v !== '');
  const tb: TimeBasedClassRates = {
    fiveFare: amount(m.fiveFare, `${cls} 5-hour customer fare`, true), fiveKm: amount(m.fiveKm, `${cls} 5-hour included kilometres`, true), fivePartner: amount(m.fivePartner, `${cls} 5-hour partner payout`, true),
    eightFare: amount(m.eightFare, `${cls} 8-hour customer fare`, true), eightKm: amount(m.eightKm, `${cls} 8-hour included kilometres`, true), eightPartner: amount(m.eightPartner, `${cls} 8-hour partner payout`, true),
    ...(anyMorning ? { morningFare: amount(m.morningFare, `${cls} Morning Return customer fare`, true), morningKm: amount(m.morningKm, `${cls} Morning Return included kilometres`, true), morningPartner: amount(m.morningPartner, `${cls} Morning Return partner payout`, true) } : {}),
  };
  // Extra hour slabs: optional per class (a class without amounts for a slab is simply not offered it), all three amounts or none.
  if (m.extra !== undefined && m.extra !== null) {
    const ex = obj(m.extra, `The ${cls} extra hour slabs`);
    const out: NonNullable<TimeBasedClassRates['extra']> = {};
    for (const [id, raw] of Object.entries(ex)) {
      if (!isExtraSlabId(id) || !(settings.extraSlabs ?? []).some((x) => extraSlabId(x.hours) === id)) continue;
      const sid: ExtraSlabId = id;
      if (raw === null) continue;
      const e = obj(raw, `The ${cls} ${id.slice(1)}-hour slab`);
      const vals = [e.fare, e.km, e.partner];
      if (vals.every((v) => v === undefined || v === null || v === '')) continue;
      const h = id.slice(1);
      const row = { fare: amount(e.fare, `${cls} ${h}-hour customer fare`, true), km: amount(e.km, `${cls} ${h}-hour included kilometres`, true), partner: amount(e.partner, `${cls} ${h}-hour partner payout`, true) };
      out[sid] = row;
      if (row.partner > row.fare) throw bad(`${cls}: the ${h}-hour partner payout cannot be above the customer fare.`);
    }
    if (Object.keys(out).length) tb.extra = out;
  }
  // The office's own Full-Day amounts (optional, each on its own): blank ones follow the Round Trip day rates.
  for (const [key, label] of [['fullFare', 'customer fare'], ['fullKm', 'included kilometres'], ['fullPartner', 'partner payout']] as const) {
    const v = m[key];
    if (v !== undefined && v !== null && v !== '') tb[key] = amount(v, `${cls} Full-Day ${label}`, true);
  }
  if (tb.fiveFare >= tb.eightFare) throw bad(`${cls}: the 5-hour fare must be lower than the 8-hour fare.`);
  if (tb.fiveKm >= tb.eightKm) throw bad(`${cls}: the 5-hour kilometres must be fewer than the 8-hour kilometres.`);
  if (tb.fullFare !== undefined && tb.fullFare <= tb.eightFare) throw bad(`${cls}: the Full-Day fare must be higher than the 8-hour fare.`);
  if (tb.fullKm !== undefined && tb.fullKm < tb.eightKm) throw bad(`${cls}: the Full-Day kilometres cannot be fewer than the 8-hour kilometres.`);
  if (tb.fullFare !== undefined && tb.fullPartner !== undefined && tb.fullPartner > tb.fullFare) throw bad(`${cls}: the Full-Day partner payout cannot be above the customer fare.`);
  return tb;
}

const minuteOfDay = (v: unknown, label: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 1439) throw bad(`${label} must be a time of day.`);
  return v;
};

/**
 * The 5-hour / 8-hour packages (and the optional Morning Return) of each class, with the shared cutoffs. The Full-Day package
 * is not entered here: it is the class's normal Round Trip day (daily minimum KM × rate + allowance). Switching `enabled` on
 * makes customer Round Trip quotes time-based for every class that has amounts; the others keep calendar pricing.
 */
export function applyRoundTripTimeBased(base: TariffConfig, d: Record<string, unknown>): TariffConfig {
  const next: TariffConfig = { ...base, roundTrip: { ...base.roundTrip, classes: { ...base.roundTrip.classes } } };
  const packages = { ...(base.roundTrip.packages ?? {}) };
  // The Round Trip rates saved for All brands count too, not only the older base rate cards.
  const shared = scopedTariffForBrand(base, 'common', 'Round Trip').roundTrip.classes;
  const sIn = obj(d.settings, 'The time-based settings');
  const settings: TimeBasedSettings = {
    enabled: d.enabled === true,
    cutoffMinutes: minuteOfDay(sIn.cutoffMinutes, 'The booked cutoff time'),
    morningCutoffMinutes: minuteOfDay(sIn.morningCutoffMinutes, 'The Morning Return cutoff time'),
    nextDayEightFromMinutes: minuteOfDay(sIn.nextDayEightFromMinutes, 'The 8-hour first-day start time'),
    nextDayFiveFromMinutes: minuteOfDay(sIn.nextDayFiveFromMinutes, 'The 5-hour first-day start time'),
    shortKmLimit: amount(sIn.shortKmLimit, 'The short-package kilometre limit', true),
    fiveKmLimit: sIn.fiveKmLimit === undefined || sIn.fiveKmLimit === null || sIn.fiveKmLimit === '' ? DEFAULT_TIME_BASED.fiveKmLimit : amount(sIn.fiveKmLimit, 'The 5-hour kilometre limit', true),
    lateNightEndMinutes: sIn.lateNightEndMinutes === undefined || sIn.lateNightEndMinutes === null ? DEFAULT_TIME_BASED.lateNightEndMinutes : minuteOfDay(sIn.lateNightEndMinutes, 'The late-night group end time'),
    fiveHours: amount(sIn.fiveHours, 'The short package hours', true),
    eightHours: amount(sIn.eightHours, 'The medium package hours', true),
  };
  if (settings.fiveHours >= settings.eightHours) throw bad('The 5-hour package must be shorter than the 8-hour package.');
  if (settings.nextDayEightFromMinutes >= settings.nextDayFiveFromMinutes) throw bad('The 8-hour first-day start must be earlier than the 5-hour first-day start.');
  if (settings.fiveKmLimit > settings.shortKmLimit) throw bad('The 5-hour kilometre limit cannot be above the 8-hour kilometre limit.');
  if (settings.lateNightEndMinutes >= settings.nextDayEightFromMinutes) throw bad('The late-night group must end before the 8-hour first-day start.');
  if (settings.cutoffMinutes <= settings.eightHours * 60) throw bad('The booked cutoff must be later than the longest short package.');
  if (settings.morningCutoffMinutes >= 12 * 60) throw bad('The Morning Return cutoff must be before noon.');
  // Extra hour slabs (optional): each is a whole number of hours with its own round-trip km limit.
  if (sIn.extraSlabs !== undefined && sIn.extraSlabs !== null) {
    if (!Array.isArray(sIn.extraSlabs)) throw bad('The extra hour slabs must be a list.');
    if (sIn.extraSlabs.length > MAX_EXTRA_SLABS) throw bad(`Add at most ${MAX_EXTRA_SLABS} extra hour slabs.`);
    const seen = new Set<number>();
    const list: ExtraSlab[] = [];
    for (const raw of sIn.extraSlabs as unknown[]) {
      const e = obj(raw, 'An extra hour slab');
      const hours = amount(e.hours, 'The extra slab hours', true);
      if (!Number.isInteger(hours) || hours < 1 || hours > 23) throw bad('Extra slab hours must be a whole number from 1 to 23.');
      if (hours === settings.fiveHours || hours === settings.eightHours) throw bad(`A ${hours}-hour package already exists. Choose other hours for the extra slab.`);
      if (seen.has(hours)) throw bad(`There are two ${hours}-hour slabs. Each slab needs its own hours.`);
      if (hours * 60 >= settings.cutoffMinutes) throw bad(`A ${hours}-hour slab cannot end before the booked cutoff.`);
      seen.add(hours);
      if (typeof e.name === 'string' && e.name.trim().length > MAX_PACKAGE_NAME) throw bad(`The name of the ${hours}-hour package can have at most ${MAX_PACKAGE_NAME} characters.`);
      const name = cleanPackageName(e.name);
      list.push({ hours, kmLimit: amount(e.kmLimit, `The ${hours}-hour slab kilometre limit`, true), ...(name ? { name } : {}) });
    }
    if (list.length) settings.extraSlabs = list.sort((a, b) => a.hours - b.hours);
  }
  // Package names (optional): what the customer sees instead of "5-Hour Return" etc. A blank name keeps the standard one.
  if (sIn.names !== undefined && sIn.names !== null) {
    const namesIn = obj(sIn.names, 'The package names');
    for (const k of PACKAGE_NAME_KEYS) {
      const v = namesIn[k];
      if (typeof v === 'string' && v.trim().length > MAX_PACKAGE_NAME) throw bad(`A package name can have at most ${MAX_PACKAGE_NAME} characters.`);
    }
    const names = parsePackageNames(namesIn);
    if (names) settings.names = names;
  }
  next.roundTrip.timeBased = settings;
  const classes = obj(d.classes, 'The class amounts');
  for (const [key, raw] of Object.entries(classes)) {
    const cls = classOf(key);
    const current = next.roundTrip.classes[cls];
    if (raw === null) {
      delete packages[cls];
      if (current) {
        const { timeBased: _drop, ...rest } = current;
        next.roundTrip.classes[cls] = rest;
      }
      continue;
    }
    if (!current && !shared[cls]) throw bad(`Set the ${cls} Round Trip rates (All brands, Diesel / Petrol) before its time-based packages.`);
    const main = obj(raw, `The ${cls} time-based packages`);
    const tb: TimeBasedClassRates = timeBasedAmounts(main, cls, settings);
    if (main.cng !== undefined && main.cng !== null) tb.cng = timeBasedAmounts(obj(main.cng, `The ${cls} CNG packages`), `${cls} CNG`, settings);
    if (current) {
      next.roundTrip.classes[cls] = { ...current, timeBased: tb };
      delete packages[cls];
    } else packages[cls] = tb;
  }
  if (Object.keys(packages).length) next.roundTrip.packages = packages; else delete next.roundTrip.packages;
  if (settings.enabled && !Object.keys(packages).length && !Object.values(next.roundTrip.classes).some((c) => c?.timeBased)) throw bad('Enter the 5-hour and 8-hour packages for at least one category before switching the time-based round trip on.');
  return next;
}

/**
 * Hill Station Allowance / Charge: one One-Way slab and one Round-Trip slab per vehicle class (customer and partner amounts), the
 * master switch, whether the slab is charged once per trip or once per hill station, and optional corrections to the station list.
 * A `null` class removes its slabs. A class with only one slab is charged for that kind of trip only.
 */
function applyHillStation(base: TariffConfig, d: Record<string, unknown>): TariffConfig {
  const classes: NonNullable<TariffConfig['hillStation']>['classes'] = { ...(base.hillStation?.classes ?? {}) };
  const incoming = d.classes === undefined ? {} : obj(d.classes, 'The hill station slabs');
  const slab = (raw: unknown, label: string) => {
    if (raw === null || raw === undefined) return undefined;
    const o = obj(raw, label);
    return { customer: amount(o.customer, `${label} customer charge`, true), partner: amount(o.partner, `${label} partner payout`, false) };
  };
  for (const [key, raw] of Object.entries(incoming)) {
    const cls = classOf(key);
    if (raw === null) { delete classes[cls]; continue; }
    const row = obj(raw, `The ${cls} hill station slabs`);
    const oneWay = slab(row.oneWay, `${cls} one-way hill`), roundTrip = slab(row.roundTrip, `${cls} round-trip hill`);
    if (!oneWay && !roundTrip) { delete classes[cls]; continue; }
    classes[cls] = { ...(oneWay ? { oneWay } : {}), ...(roundTrip ? { roundTrip } : {}) };
  }
  const enabled = d.enabled === true;
  if (enabled && !Object.keys(classes).length) throw bad('Enter the hill station charge for at least one vehicle category before switching it on.');
  const parsed = parseHillStationConfig({
    enabled, chargePer: d.chargePer === 'station' ? 'station' : 'trip', classes,
    stations: d.stations === undefined ? base.hillStation?.stations : d.stations,
    disabledStations: d.disabledStations === undefined ? base.hillStation?.disabledStations : d.disabledStations,
  }, TARIFF_CLASSES);
  if (!parsed) throw bad('The hill station setting is invalid.');
  return { ...base, hillStation: parsed };
}

function applyBrandOverride(
  base: TariffConfig,
  brand: string,
  service: string,
  cls: TariffClass,
  data: Record<string, unknown>,
  clearOverride?: boolean
): { next: TariffConfig; meta: Record<string, unknown> } {
  if (brand !== 'common' && !SUPPORTED_BRANDS.includes(brand as BrandId)) {
    throw bad(`Unsupported brand: "${brand}".`);
  }
  const supportedServices = BRAND_SUPPORTED_SERVICES[brand === 'common' ? 'nesam' : brand as BrandId];
  if (!supportedServices.includes(service)) {
    throw bad(`Service "${service}" is not supported by brand "${brand}".`);
  }

  const existingOverrides = { ...(base.brandOverrides ?? {}) };
  const brandData = { ...(existingOverrides[brand] ?? {}) };
  const serviceData = { ...(brandData[service] ?? {}) };

  if (clearOverride) {
    delete serviceData[cls];
    if (Object.keys(serviceData).length === 0) {
      delete brandData[service];
    } else {
      brandData[service] = serviceData;
    }
    if (Object.keys(brandData).length === 0) {
      delete existingOverrides[brand];
    } else {
      existingOverrides[brand] = brandData;
    }
    return {
      next: { ...base, brandOverrides: existingOverrides },
      meta: { section: 'brandOverride', brand, service, class: cls, action: 'cleared' },
    };
  }

  const override: BrandFareOverride = { ...(serviceData[cls] ?? {}) };

  if (data.customerRate !== undefined && data.customerRate !== null) {
    override.customerRate = amount(data.customerRate, 'Customer rate', true);
  } else if (data.customerRate === null) {
    delete override.customerRate;
  }

  if (data.partnerRate !== undefined && data.partnerRate !== null) {
    override.partnerRate = amount(data.partnerRate, 'Partner rate', true);
  } else if (data.partnerRate === null) {
    delete override.partnerRate;
  }

  if (data.customerBase !== undefined && data.customerBase !== null) {
    override.customerBase = amount(data.customerBase, 'Customer base fare', true);
  } else if (data.customerBase === null) {
    delete override.customerBase;
  }

  if (data.partnerBase !== undefined && data.partnerBase !== null) {
    override.partnerBase = amount(data.partnerBase, 'Partner base payout', true);
  } else if (data.partnerBase === null) {
    delete override.partnerBase;
  }

  if (data.minKm !== undefined && data.minKm !== null) {
    override.minKm = amount(data.minKm, 'Minimum kilometres', true);
  } else if (data.minKm === null) {
    delete override.minKm;
  }

  if (data.minKmPerDay !== undefined && data.minKmPerDay !== null) {
    override.minKmPerDay = amount(data.minKmPerDay, 'Daily minimum kilometres', true);
  } else if (data.minKmPerDay === null) {
    delete override.minKmPerDay;
  }

  if (data.customerBata !== undefined && data.customerBata !== null) {
    override.customerBata = amount(data.customerBata, 'Customer allowance', false);
  } else if (data.customerBata === null) {
    delete override.customerBata;
  }

  if (data.partnerBata !== undefined && data.partnerBata !== null) {
    override.partnerBata = amount(data.partnerBata, 'Partner allowance', false);
  } else if (data.partnerBata === null) {
    delete override.partnerBata;
  }

  // CNG rate card (One Way, Round Trip, Airport Taxi and Multicity): each field saved on its own; null removes it.
  for (const [key, label, positive] of [
    ['cngCustomerBase', 'CNG customer base fare', true], ['cngPartnerBase', 'CNG partner base payout', true], ['cngMinKm', 'CNG included kilometres', true],
    ['cngCustomerRate', 'CNG customer rate', true], ['cngPartnerRate', 'CNG partner rate', true],
    ['cngCustomerBata', 'CNG customer allowance', false], ['cngPartnerBata', 'CNG partner allowance', false],
    ['cngExtraKmRate', 'CNG extra kilometre rate', true], ['cngMinKmPerDay', 'CNG minimum kilometres per day', true],
  ] as const) {
    if (data[key] !== undefined && data[key] !== null) override[key] = amount(data[key], label, positive);
    else if (data[key] === null) delete override[key];
  }

  if (data.extraKmRate !== undefined && data.extraKmRate !== null) {
    override.extraKmRate = amount(data.extraKmRate, 'Extra kilometre rate', true);
  } else if (data.extraKmRate === null) {
    delete override.extraKmRate;
  }

  if (data.waitingPerHour !== undefined && data.waitingPerHour !== null) {
    override.waitingPerHour = amount(data.waitingPerHour, 'Waiting charge per hour', false);
  } else if (data.waitingPerHour === null) {
    delete override.waitingPerHour;
  }

  if (data.hillCharge !== undefined && data.hillCharge !== null) {
    override.hillCharge = amount(data.hillCharge, 'Hill charge', false);
  } else if (data.hillCharge === null) {
    delete override.hillCharge;
  }

  if (data.carrierCharge !== undefined && data.carrierCharge !== null) {
    override.carrierCharge = amount(data.carrierCharge, 'Luggage carrier charge', false);
  } else if (data.carrierCharge === null) {
    delete override.carrierCharge;
  }

  if (data.petCharge !== undefined && data.petCharge !== null) {
    override.petCharge = amount(data.petCharge, 'Pet travel charge', false);
  } else if (data.petCharge === null) {
    delete override.petCharge;
  }

  if (typeof data.enabled === 'boolean') {
    override.enabled = data.enabled;
  }

  for (const key of ['partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge','partnerPetCharge'] as const) {
    if (data[key] === null) delete override[key];
    else if (data[key] !== undefined) override[key] = amount(data[key], key, false);
  }
  for (const key of ['freeWaitingMinutes','waitingRoundingMinutes'] as const) {
    if (data[key] === null) delete override[key];
    else if (data[key] !== undefined) {
      const value = data[key];
      if (typeof value !== 'number' || !Number.isInteger(value) || value < (key === 'freeWaitingMinutes' ? 0 : 1) || value > 1440) throw bad('Enter valid waiting minutes.');
      override[key] = value;
    }
  }
  if (data.waitingRoundingScope === null) delete override.waitingRoundingScope;
  else if (data.waitingRoundingScope !== undefined) {
    if (data.waitingRoundingScope !== 'per_stop' && data.waitingRoundingScope !== 'combined') throw bad('Choose per-stop or combined waiting rounding.');
    override.waitingRoundingScope = data.waitingRoundingScope;
  }
  if (data.taxTreatment === null) delete override.taxTreatment;
  else if (data.taxTreatment !== undefined) {
    if (data.taxTreatment !== 'no_gst' && data.taxTreatment !== 'tariff_gst') throw bad('Choose an extra-charge tax treatment.');
    override.taxTreatment = data.taxTreatment;
  }

  if (data.minRentalHours === null) delete override.minRentalHours;
  else if (data.minRentalHours !== undefined) {
    if (typeof data.minRentalHours !== 'number' || !Number.isInteger(data.minRentalHours) || data.minRentalHours < 1 || data.minRentalHours > 15) throw bad('Minimum rental hours must be between 1 and 15.');
    override.minRentalHours = data.minRentalHours;
  }
  if (data.rentalPackageRule !== undefined) {
    if (service !== 'Local Rental') throw bad('Rental package settings require Local Rental scope.');
    const rule = parseRentalPackageRule(data.rentalPackageRule);
    if (!rule) throw bad('Complete all rental package settings with positive amounts and choose the kilometre allowance mode.');
    override.rentalPackageRule = rule;
  }

  if (data.rentalPackages !== undefined) {
    if (service !== 'Local Rental') throw bad('Rental packages require Local Rental scope.');
    const packages = obj(data.rentalPackages, 'Rental package overrides');
    const nextPackages: NonNullable<BrandFareOverride['rentalPackages']> = {};
    for (const [key, value] of Object.entries(packages)) {
      hoursOf(Number(key));
      const raw = obj(value, 'Rental package');
      const row: NonNullable<BrandFareOverride['rentalPackages']>[string] = {};
      for (const field of ['customerFare', 'partnerPayout', 'includedKm', 'extraKmRate', 'extraHourRate'] as const) {
        if (raw[field] !== undefined && raw[field] !== null) row[field] = amount(raw[field], field, true);
      }
      if (Object.keys(row).length) nextPackages[key] = row;
    }
    if (Object.keys(nextPackages).length) override.rentalPackages = nextPackages;
    else delete override.rentalPackages;
  }

  if (!Object.keys(override).length) return applyBrandOverride(base, brand, service, cls, {}, true);
  serviceData[cls] = override;
  brandData[service] = serviceData;
  existingOverrides[brand] = brandData;

  return {
    next: { ...base, brandOverrides: existingOverrides },
    meta: { section: 'brandOverride', brand, service, class: cls, override },
  };
}

/**
 * Saves one section of the tariff. `expectedVersion` is required: the editor saves against the version it
 * loaded, and a newer tariff is refused rather than overwritten. A brand-new tariff starts switched off —
 * nothing here turns the confirmed tariff on.
 */
export const saveTariffSection = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw bad('Give a short reason for the change.');
  // `latest: true` saves against the newest tariff: each section writes only its own fields inside a transaction.
  const saveLatest = input.latest === true;
  if (!saveLatest && (typeof input.expectedVersion !== 'number' || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) throw bad('Reload the tariff before saving.');
  const section = input.section;
  const city = section === 'localPickupDrop' ? await cityOf(input.cityId) : null;
  const extraNames = section === 'extraCharges' ? await extraCategoryNames(obj(input.data, 'The extra charges')) : null;
  const bulkCities = section === 'localPickupDropBulk' ? await citiesOf(Object.keys(obj(obj(input.data, 'The fares').fares, 'The city fares'))) : null;
  let bulkResult: { saved: number; skipped: number } | null = null;

  const ref = db.doc(TARIFF_DOC);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? parseTariffConfig(snap.data()) : null;
    if (!saveLatest && input.expectedVersion !== (before?.version ?? 0)) {
      throw new HttpsError('failed-precondition', 'The tariff was changed by someone else. Reload and review it before saving.');
    }
    const base = before ?? parseTariffConfig({ version: 0 })!;
    let next: TariffConfig;
    let meta: Record<string, unknown>;
    if (section === 'petCharge') {
      const petCharge = amount(obj(input.data, 'Pet travel pricing').petCharge, 'Common pet travel charge', false);
      if (petCharge > 100000) throw bad('Common pet travel charge must not exceed INR 100,000.');
      next = { ...base, petCharge };
      meta = { section, petCharge };
    } else if (section === 'baseRates') {
      const d = obj(input.data, 'The rates');
      next = applyBaseRates(base, d);
      meta = { section, classes: Object.keys(obj(d.classes, 'The category rates')) };
    } else if (section === 'fareGst') {
      const brand = text(input.brand, 50), service = text(input.service, 50);
      if (!['common', ...SUPPORTED_BRANDS].includes(brand) || !['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'].includes(service)) throw bad('Choose a GST brand and service.');
      const d = obj(input.data, 'GST settings');
      const state = d.state === '' ? '' : gstState(d.state);
      if (d.state !== '' && !state) throw bad('Choose a valid pickup state for the GST override.');
      const fareGst = { ...base.fareGst };
      const services = { ...fareGst[brand] };
      const policy = { ...services[service], states: { ...services[service]?.states } };
      if (input.clearOverride === true) {
        if (state) delete policy.states[state]; else delete policy.default;
      } else {
        if (!validGstRule(d.rule)) throw bad('Choose the supplier state, included/excluded mode, classification, a GST rate from 0 to 40%, and an approval reference.');
        const raw = d.rule;
        const rule: FareGstRule = { supplierState: gstState(raw.supplierState), rate: Math.round(raw.rate * 10000) / 10000, mode: raw.mode, classification: raw.classification, reference: text(raw.reference, 300) };
        if (state) policy.states[state] = rule; else policy.default = rule;
      }
      if (!Object.keys(policy.states).length) delete (policy as { states?: unknown }).states;
      if (!policy.default && !policy.states) delete services[service]; else services[service] = policy;
      if (!Object.keys(services).length) delete fareGst[brand]; else fareGst[brand] = services;
      next = { ...base, fareGst };
      meta = { section, brand, service, state: state || 'all', clear: input.clearOverride === true };
    } else if (section === 'brandOverride') {
      const cls = classOf(input.class);
      const brand = text(input.brand, 50);
      const service = text(input.service, 50);
      const r = applyBrandOverride(base, brand, service, cls, obj(input.data, 'The override data'), input.clearOverride === true);
      next = r.next;
      meta = r.meta;
    } else if (section === 'localPickupDrop' && city) {
      const cls = classOf(input.class);
      next = applyLocal(base, city, cls, obj(input.data, 'The fare'));
      meta = { section, cityId: city.id, cityName: city.name, class: cls, ...(city.parentCityId ? { zoneOfCityId: city.parentCityId } : {}) };
    } else if (section === 'localPickupDropBulk' && bulkCities) {
      const r = applyLocalBulk(base, obj(obj(input.data, 'The fares').fares, 'The city fares'), bulkCities);
      next = r.next;
      bulkResult = { saved: r.saved, skipped: r.skipped };
      meta = { section, cities: r.saved, skipped: r.skipped };
    } else if (section === 'extraCharges' && extraNames) {
      const r = applyExtraCharges(base, obj(input.data, 'The extra charges'), extraNames);
      next = r.next;
      meta = { section, extraChargesVersion: next.extraCharges?.version ?? 0, was: base.extraCharges?.version ?? 0, categories: r.changed };
    } else if (section === 'displayMarkup') {
      // Display only: the fare is shown as this % off a struck-out price. No fare, tax or payout is changed by it.
      const brand = text(input.brand, 50), service = text(input.service, 50);
      if (!['common', ...SUPPORTED_BRANDS].includes(brand) || !['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'].includes(service)) throw bad('Choose a brand and service.');
      const d = obj(input.data, 'The setting');
      const pct = d.percent;
      const all = { ...(base.displayMarkup ?? {}) };
      const row = { ...(all[brand] ?? {}) };
      if (pct === null || pct === 0) delete row[service];
      else {
        if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 90) throw bad('The percentage must be more than 0 and at most 90.');
        row[service] = Math.round(pct * 100) / 100;
      }
      if (Object.keys(row).length) all[brand] = row; else delete all[brand];
      next = { ...base };
      if (Object.keys(all).length) next.displayMarkup = all; else delete next.displayMarkup;
      meta = { section, brand, service, percent: pct };
    } else if (section === 'roundTripMini') {
      const d = obj(input.data, 'The mini round-trip fares');
      next = applyRoundTripMini(base, d);
      meta = { section, classes: Object.keys(obj(d.classes, 'The mini fares')), miniMaxHours: next.roundTrip.miniMaxHours, miniMaxKm: next.roundTrip.miniMaxKm };
    } else if (section === 'roundTripTimeBased') {
      const d = obj(input.data, 'The time-based round-trip packages');
      next = applyRoundTripTimeBased(base, d);
      meta = { section, enabled: next.roundTrip.timeBased?.enabled === true, classes: Object.keys(obj(d.classes, 'The class amounts')) };
    } else if (section === 'hillStation') {
      const d = obj(input.data, 'The hill station charges');
      next = applyHillStation(base, d);
      meta = { section, enabled: next.hillStation?.enabled === true, chargePer: next.hillStation?.chargePer, classes: Object.keys(next.hillStation?.classes ?? {}) };
    } else if (section === 'rentalMinimum') {
      const cls = classOf(input.class);
      next = applyRentalMinimum(base, cls, input.minHours);
      meta = { section, class: cls, minHours: input.minHours, was: rentalMinHours(base, cls) };
    } else if (section === 'rentalPackage') {
      const cls = classOf(input.class), hours = hoursOf(input.hours);
      next = applyRentalPackage(base, cls, hours, obj(input.data, 'The package'));
      meta = { section, class: cls, hours };
    } else {
      throw bad('Unknown tariff section.');
    }
    const version = (before?.version ?? 0) + 1;
    tx.set(ref, { ...next, version, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'tariff_section_saved', entity: 'tariff', entityId: 'v2', performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: before ? { version: before.version } : null, next: { version }, meta, reason,
    });
    return { version, ...(section === 'extraCharges' ? { extraChargesVersion: next.extraCharges?.version ?? 0 } : {}), ...(bulkResult ?? {}) };
  });
});
