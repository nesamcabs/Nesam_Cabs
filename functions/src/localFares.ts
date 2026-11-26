// District local fares (Service & Fare Settings → Hourly Rental / Pickup & Drop): loading them for a quote, and the one callable
// that saves them. The pricing rules themselves are in domain/localPricing.ts. Everything is stored under business_config
// (staff-readable, never written by a client):
//   local_fare_index                     which districts have rates, for which brands
//   local_geo_{state~district}           the district's service zones and Tamil area names
//   local_fares_{state~district}_{brand} one brand's rates and coverage switches
//   local_settings_{brand}               peak hours, toll / airport charges, night allowance, GST
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { requirePermission, requireAction, googleRouteRequest, text } from './shared';
import { withPincode } from './placePincode';
import { pinsOfCity, stateCodeOf } from './domain/pincodeLookup';
import { isOutstation } from './domain/pricing';
import type { GeoPlace } from './domain/types';
import {
  LOCAL_BRANDS, LOCAL_CLASSES, LOCAL_HOURS, LOCAL_INDEX_DOC, MAX_AMOUNT, MAX_CORRIDORS, MAX_PEAK_RULES, MAX_ZONES, ROW_FIELDS, RULE_FIELDS,
  areaNamesOf, autoTollAmount, defaultSettings, districtKey, faresAreUsed, faresDoc, geoDoc, isAreaKey, isLocalId, isPin, pinOfArea, parseFares, parseGeo, parseIndex, parseRow,
  parseRule, parseSettings, rowProblem, ruleProblem, settingsDoc, settingsProblem, zoneOfPin,
  type FaresByBrand, type LiveToll, type LocalSettings,
} from './domain/localPricing';

/** Everything the pricing engine needs about one trip's pickup district. */
export interface LocalFareContext {
  key: string;
  district: string;
  pin: string;
  zoneId?: string;
  /** Village names the pickup's address mentions (see areaNamesOf). */
  areaNames?: string[];
  brand: string;
  /** This brand's and the shared rates of the district. */
  fares: FaresByBrand;
  settings: LocalSettings;
  /** Saved versions the trip was priced from. */
  version: number;
  /** The drop is in the same district (a Pickup & Drop trip). */
  sameDistrict: boolean;
  /** The toll the route adds to a Pickup & Drop fare automatically, rupees. */
  toll: number;
}

// ── Live route tolls (Google Routes) ────────────────────────────────────────

const tollCache = new Map<string, { at: number; toll: LiveToll }>();
const TOLL_TTL_MS = 6 * 60 * 60 * 1000;

/** Whether the road between two points has a toll, and its price when Google gives one in rupees. null = could not ask. */
export async function liveRouteToll(a: GeoPlace, b: GeoPlace): Promise<LiveToll> {
  const key = (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim();
  if (!key) return null;
  const id = `${a.lat.toFixed(4)},${a.lng.toFixed(4)}>${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
  const hit = tollCache.get(id);
  if (hit && Date.now() - hit.at < TOLL_TTL_MS) return hit.toll;
  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.travelAdvisory.tollInfo' },
      body: JSON.stringify({ ...googleRouteRequest(a, b), extraComputations: ['TOLLS'] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      console.warn('[localFares] toll lookup unavailable', { status: response.status });
      return null;
    }
    const route = ((await response.json()) as { routes?: Array<{ travelAdvisory?: { tollInfo?: { estimatedPrice?: Array<{ currencyCode?: string; units?: string; nanos?: number }> } } }> }).routes?.[0];
    if (!route) return null;
    const info = route.travelAdvisory?.tollInfo;
    const inr = info?.estimatedPrice?.find((x) => x.currencyCode === 'INR');
    const price = inr ? Number(inr.units ?? 0) + Number(inr.nanos ?? 0) / 1e9 : null;
    const toll: LiveToll = { hasToll: !!info, price: price !== null && Number.isFinite(price) && price > 0 ? price : null };
    if (tollCache.size > 500) tollCache.delete(tollCache.keys().next().value as string);
    tollCache.set(id, { at: Date.now(), toll });
    return toll;
  } catch (error) {
    console.warn('[localFares] toll lookup failed', error instanceof Error ? error.message : error);
    return null;
  }
}

// ── Loading for a quote ─────────────────────────────────────────────────────

/**
 * The district rates that apply to a trip, or null when its pickup is in no district that has any (the trip is then priced
 * exactly as before). Costs one read while no district is configured.
 */
export async function loadLocalContext(i: { brand?: string; tripType: string; pickup: GeoPlace; drop: GeoPlace; distanceKm: number }): Promise<LocalFareContext | null> {
  const index = parseIndex((await db.doc(LOCAL_INDEX_DOC).get()).data());
  const brand = i.brand || 'nesam';
  const mine = Object.entries(index.districts).filter(([, d]) => d.brands.includes(brand) || d.brands.includes('common'));
  if (!mine.length) return null;
  const pickup = await withPincode(i.pickup);
  const pin = pickup.pincode;
  if (!pin) return null;
  const found = mine.find(([, d]) => pinsOfCity(d.district, d.state)?.has(pin));
  if (!found) return null;
  const [key, entry] = found;
  const refs = [geoDoc(key), faresDoc(key, 'common'), faresDoc(key, brand), settingsDoc(brand), settingsDoc('common')].map((p) => db.doc(p));
  const [geoSnap, commonSnap, brandSnap, brandSettings, commonSettings] = await db.getAll(...refs);
  const geo = parseGeo(geoSnap!.data());
  const fares: FaresByBrand = {};
  if (commonSnap!.exists) fares.common = parseFares(commonSnap!.data());
  if (brandSnap!.exists) fares[brand] = parseFares(brandSnap!.data());
  const saved = brandSettings!.exists ? brandSettings! : commonSettings!.exists ? commonSettings! : null;
  const settings = saved ? parseSettings(saved.data()) : defaultSettings();
  const version = Math.max(...[geoSnap, commonSnap, brandSnap, brandSettings, commonSettings].map((s) => Number(s!.data()?.version) || 0));

  let sameDistrict = i.tripType === 'Local Rental';
  let toll = 0;
  if (i.tripType === 'One Way' && !isOutstation(i.distanceKm)) {
    const drop = await withPincode(i.drop);
    sameDistrict = !!drop.pincode && !!pinsOfCity(entry.district, entry.state)?.has(drop.pincode);
    if (sameDistrict && settings.additional.autoToll) {
      const live = settings.additional.tollSource === 'route_api' ? await liveRouteToll(pickup, drop) : null;
      toll = autoTollAmount(settings, pin, drop.pincode!, live);
    }
  }
  const zoneId = zoneOfPin(geo, pin)?.id;
  const areaNames = areaNamesOf([pickup.name, pickup.address], entry.district);
  return { key, district: entry.district, pin, ...(zoneId ? { zoneId } : {}), areaNames, brand, fares, settings, version, sameDistrict, toll };
}

// ── Saving ──────────────────────────────────────────────────────────────────

const bad = (m: string) => new HttpsError('invalid-argument', m);
const obj = (v: unknown, label: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad(`${label} is missing.`);
  return v as Record<string, unknown>;
};
const optional = (v: unknown, label: string): Record<string, unknown> => (v === undefined || v === null ? {} : obj(v, label));
function checkNumber(v: unknown, label: string, max = MAX_AMOUNT): void {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw bad(`${label} must be a number from 0 to ${max}.`);
}

/** A level's rates must be complete or entirely empty: a half-filled rate is refused, never silently dropped. */
function checkLevel(raw: unknown, where: string): void {
  const level = optional(raw, where);
  for (const party of ['customer', 'partner'] as const) {
    for (const [cls, rule] of Object.entries(optional(level[party], where))) {
      const label = `${where} · ${cls} ${party} rate`;
      if (!(LOCAL_CLASSES as readonly string[]).includes(cls)) throw bad(`${label}: unknown vehicle.`);
      const r = obj(rule, label);
      for (const f of RULE_FIELDS) checkNumber(r[f], `${label} (${f})`);
      if (!Number.isInteger(r.freeWaitMins)) throw bad(`${label}: free waiting must be whole minutes.`);
      const problem = ruleProblem(parseRule(r));
      if (problem) throw bad(`${label}: ${problem}.`);
    }
  }
  for (const [cls, rows] of Object.entries(optional(level.rental, where))) {
    if (!(LOCAL_CLASSES as readonly string[]).includes(cls)) throw bad(`${where}: unknown vehicle "${cls}".`);
    for (const [hours, row] of Object.entries(obj(rows, `${where} · ${cls} packages`))) {
      const label = `${where} · ${cls} ${hours}-hour package`;
      if (!(LOCAL_HOURS as readonly number[]).includes(Number(hours))) throw bad(`${label}: packages are 1 to 15 hours.`);
      const r = obj(row, label);
      for (const f of ROW_FIELDS) checkNumber(r[f], `${label} (${f})`);
      const problem = rowProblem(parseRow(r));
      if (problem) throw bad(`${label}: ${problem}.`);
    }
  }
}

function checkGeo(raw: unknown, pins: Set<string>) {
  const g = obj(raw, 'The zones');
  const zones = Array.isArray(g.zones) ? g.zones : [];
  if (zones.length > MAX_ZONES) throw bad(`Use at most ${MAX_ZONES} zones in a district.`);
  const names = new Set<string>(), ids = new Set<string>(), used = new Map<string, string>();
  for (const value of zones) {
    const z = obj(value, 'A zone');
    const name = text(z.name, 80);
    if (!isLocalId(z.id) || ids.has(z.id as string)) throw bad('A zone has no valid id.');
    ids.add(z.id as string);
    if (!name) throw bad('Name every zone.');
    if (names.has(name.toLowerCase())) throw bad(`Two zones are named "${name}".`);
    names.add(name.toLowerCase());
    if (!Array.isArray(z.pins) || !z.pins.length) throw bad(`${name}: choose at least one pincode.`);
    for (const pin of z.pins) {
      if (!isPin(pin) || !pins.has(pin)) throw bad(`${name}: ${String(pin)} is not a pincode of this district.`);
      if (used.has(pin) && used.get(pin) !== name) throw bad(`${pin} is in both "${used.get(pin)}" and "${name}". A pincode can be in one zone only.`);
      used.set(pin, name);
    }
  }
  for (const key of Object.keys(optional(g.tamil, 'The Tamil names'))) if (!isAreaKey(key) || !pins.has(pinOfArea(key))) throw bad(`${key} is not an area of this district.`);
  return parseGeo(g);
}

function checkSettings(raw: unknown) {
  const s = obj(raw, 'The settings');
  const peak = obj(s.peak, 'Peak pricing'), add = obj(s.additional, 'Additional charges'), night = obj(s.night, 'Night allowance'), gst = obj(s.gst, 'GST');
  checkNumber(night.percent, 'The night allowance percentage', 100);
  checkNumber(gst.percent, 'GST', 40);
  if (gst.mode !== 'included' && gst.mode !== 'excluded') throw bad('Choose whether GST is added on top or included in the fare.');
  checkNumber(add.tollAmount, 'The toll amount');
  checkNumber(add.airportFee, 'The airport entry charge');
  if (!['mapped_rate', 'route_api', 'at_actuals'].includes(String(add.tollSource))) throw bad('Choose how the toll amount is found.');
  const rules = Array.isArray(peak.rules) ? peak.rules : [];
  if (rules.length > MAX_PEAK_RULES) throw bad(`Use at most ${MAX_PEAK_RULES} peak windows.`);
  for (const value of rules) {
    const r = obj(value, 'A peak window');
    checkNumber(r.value, 'A peak charge');
    checkNumber(r.maxCap, 'A peak max cap');
    for (const k of ['startHour', 'endHour'] as const) if (!Number.isInteger(r[k]) || (r[k] as number) < 0 || (r[k] as number) > 24) throw bad('Choose valid peak window times.');
  }
  const corridors = Array.isArray(add.corridors) ? add.corridors : [];
  if (corridors.length > MAX_CORRIDORS) throw bad(`Use at most ${MAX_CORRIDORS} mapped toll routes.`);
  for (const value of corridors) {
    const c = obj(value, 'A mapped toll route');
    if (!isPin(c.fromPin) || !isPin(c.toPin)) throw bad('Choose both areas of every mapped toll route.');
    checkNumber(c.amount, 'A mapped toll amount');
  }
  const parsed = parseSettings(s);
  const problem = settingsProblem(parsed);
  if (problem) throw bad(problem);
  return parsed;
}

const MAX_DOC_BYTES = 700_000;

/**
 * Saves what the page changed, together: this brand's rates for one district, the district's zones, and the brand's shared
 * settings. Each part carries the version it was edited from; a newer saved one is refused, never overwritten. A change prices
 * new quotes only — a confirmed booking keeps the pricing it was quoted with.
 */
export const saveLocalFares = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw bad('Give a short reason for the change.');
  const brand = text(input.brand, 50);
  if (!(LOCAL_BRANDS as readonly string[]).includes(brand)) throw bad('Choose a brand.');
  const state = stateCodeOf(input.state), district = text(input.district, 80);
  const pins = state && district ? pinsOfCity(district, state) : null;
  if (!pins) throw bad('Choose a district.');
  const key = districtKey(state, district);

  const part = (v: unknown, label: string) => {
    if (v === undefined || v === null) return null;
    const p = obj(v, label);
    if (typeof p.expectedVersion !== 'number' || !Number.isInteger(p.expectedVersion) || p.expectedVersion < 0) throw bad('Reload the page before saving.');
    return { data: p.data, expectedVersion: p.expectedVersion };
  };
  const faresIn = part(input.fares, 'The rates'), geoIn = part(input.geo, 'The zones'), settingsIn = part(input.settings, 'The settings');
  if (!faresIn && !geoIn && !settingsIn) throw bad('Nothing to save.');
  const geo = geoIn ? checkGeo(geoIn.data, pins) : null;
  // `data: null` removes a brand's own settings, so it follows the shared ones again.
  if (settingsIn && settingsIn.data === null && brand === 'common') throw bad('The shared settings cannot be removed.');
  const settings = settingsIn && settingsIn.data !== null ? checkSettings(settingsIn.data) : null;
  if (faresIn) {
    const raw = obj(faresIn.data, 'The rates');
    checkLevel(raw.district, `${district} district`);
    for (const [id, level] of Object.entries(optional(raw.zones, 'Zone rates'))) checkLevel(level, `Zone ${id}`);
    for (const [area, level] of Object.entries(optional(raw.areas, 'Area rates'))) {
      if (!isAreaKey(area) || !pins.has(pinOfArea(area))) throw bad(`${pinOfArea(area)} is not a pincode of ${district}.`);
      checkLevel(level, `Area ${area}`);
    }
    for (const [k, v] of Object.entries(optional(raw.coverage, 'Coverage'))) if (!['local', 'outstation'].includes(k) || typeof v !== 'boolean') throw bad('Choose coverage on or off.');
  }

  const indexRef = db.doc(LOCAL_INDEX_DOC), geoRef = db.doc(geoDoc(key)), faresRef = db.doc(faresDoc(key, brand)), settingsRef = db.doc(settingsDoc(brand));
  return db.runTransaction(async (tx) => {
    const [indexSnap, geoSnap, faresSnap, settingsSnap] = await Promise.all([tx.get(indexRef), tx.get(geoRef), tx.get(faresRef), tx.get(settingsRef)]);
    const versionOf = (s: FirebaseFirestore.DocumentSnapshot) => Number(s.data()?.version) || 0;
    const stale = (p: { expectedVersion: number } | null, s: FirebaseFirestore.DocumentSnapshot, what: string) => {
      if (p && p.expectedVersion !== versionOf(s)) throw new HttpsError('failed-precondition', `${what} were changed by someone else. Reload and review them before saving.`);
    };
    stale(faresIn, faresSnap, 'These rates');
    stale(geoIn, geoSnap, 'The zones');
    stale(settingsIn, settingsSnap, 'These settings');
    const stamp = { updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() };
    const out: { faresVersion?: number; geoVersion?: number; settingsVersion?: number } = {};

    if (geo) {
      out.geoVersion = versionOf(geoSnap) + 1;
      tx.set(geoRef, { state, district, ...geo, version: out.geoVersion, ...stamp });
    }
    if (faresIn) {
      const fares = parseFares(faresIn.data);
      // Rates of a zone that no longer exists are dropped.
      const zones = new Set((geo ?? parseGeo(geoSnap.data())).zones.map((z) => z.id));
      for (const id of Object.keys(fares.zones)) if (!zones.has(id)) delete fares.zones[id];
      if (JSON.stringify(fares).length > MAX_DOC_BYTES) throw bad('This district has too many area overrides to save. Use zone overrides for groups of areas.');
      out.faresVersion = versionOf(faresSnap) + 1;
      // `district` in these documents is the district-level rates; the district's name is `districtName`.
      tx.set(faresRef, { state, districtName: district, brand, ...fares, version: out.faresVersion, ...stamp });
      const index = parseIndex(indexSnap.data());
      const brands = new Set(index.districts[key]?.brands ?? []);
      if (faresAreUsed(fares)) brands.add(brand); else brands.delete(brand);
      if (brands.size) index.districts[key] = { state, district, brands: [...brands].sort() }; else delete index.districts[key];
      tx.set(indexRef, { ...index, version: versionOf(indexSnap) + 1, ...stamp });
    }
    if (settingsIn) {
      if (settings) {
        out.settingsVersion = versionOf(settingsSnap) + 1;
        tx.set(settingsRef, { brand, ...settings, version: out.settingsVersion, ...stamp });
      } else {
        out.settingsVersion = 0;
        tx.delete(settingsRef);
      }
    }
    auditInTx(tx, {
      action: 'local_fares_saved', entity: 'local_fares', entityId: `${key}_${brand}`, performedBy: actor.uid, performedByName: actor.name, role: 'admin', reason,
      meta: { brand, state, district, rates: !!faresIn, zones: !!geoIn, settings: !!settingsIn, ...out },
    });
    return out;
  });
});
