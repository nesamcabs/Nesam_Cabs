// Hill station charge (Customer UX v8 · "Round Trip & Hill Station Developer Guide", section 08).
//
// A One Way or Round Trip whose pickup, destination or any stop is in a Tamil Nadu hill station gets a Hill Station Allowance /
// Charge, billed as its OWN line (never mixed into the base or package fare) from the vehicle class's configured slab:
//   One Way    : base fare + driver bata + extra km + hill charge (One-Way slab) + toll / permit
//   Round Trip : package fare + extra km + hill charge (Round-Trip slab) + toll / permit
// Hill station trips never use the 5-hour / 8-hour short packages: they go straight to the Full Day or the multi-day slab.
//
// Detection uses the map position of each place (the latitude / longitude the map API returned for the pickup, drop and stops):
// a place is "in" a hill station when it lies within that station's radius. A place whose name or address names the hill station
// (Tamil or English) counts too when it is within a wider ring, so a hamlet on the hill road is found by its address and a
// town on a road that merely carries the hill's name ("Ooty Road, Coimbatore") is not.
//
// Pure helpers only (no Firestore, no map calls) so the quote, the booking snapshot, the final fare and the tests share one rule.
import type { TariffClass } from './tariff';

export interface HillStation {
  id: string;
  name: string;
  /** Tamil name, shown beside the English one. */
  tamil: string;
  /** Lower-case English spellings and Tamil spellings that identify the station in a place name or address. */
  aliases: string[];
  lat: number;
  lng: number;
  /** A place within this many km of the centre is in the hill station. */
  radiusKm: number;
}

/** A named place is also taken to be in the hill station when it is within this multiple of the radius. */
export const NAME_RING_FACTOR = 2.5;

/** The Tamil Nadu hill stations of the developer guide. Centres are approximate; radii cover the town and its sightseeing hill roads. */
export const HILL_STATIONS: readonly HillStation[] = [
  { id: 'ooty', name: 'Ooty', tamil: 'ஊட்டி', aliases: ['ooty', 'udhagamandalam', 'udagamandalam', 'ootacamund', 'உதகமண்டலம்', 'ஊட்டி'], lat: 11.4102, lng: 76.695, radiusKm: 16 },
  { id: 'kodaikanal', name: 'Kodaikanal', tamil: 'கொடைக்கானல்', aliases: ['kodaikanal', 'kodaikkanal', 'கொடைக்கானல்'], lat: 10.2381, lng: 77.4892, radiusKm: 14 },
  { id: 'yercaud', name: 'Yercaud', tamil: 'ஏற்காடு', aliases: ['yercaud', 'yercadu', 'ஏற்காடு'], lat: 11.7753, lng: 78.2097, radiusKm: 10 },
  { id: 'coonoor', name: 'Coonoor', tamil: 'குன்னூர்', aliases: ['coonoor', 'coonur', 'kunnur', 'குன்னூர்'], lat: 11.3531, lng: 76.7959, radiusKm: 9 },
  { id: 'kotagiri', name: 'Kotagiri', tamil: 'கோத்தகிரி', aliases: ['kotagiri', 'kothagiri', 'கோத்தகிரி'], lat: 11.421, lng: 76.8606, radiusKm: 9 },
  { id: 'valparai', name: 'Valparai', tamil: 'வால்பாறை', aliases: ['valparai', 'valpparai', 'வால்பாறை'], lat: 10.3267, lng: 76.951, radiusKm: 14 },
  { id: 'megamalai', name: 'Megamalai', tamil: 'மேகமலை', aliases: ['megamalai', 'meghamalai', 'high wavys', 'highwavys', 'மேகமலை'], lat: 9.67, lng: 77.38, radiusKm: 16 },
  { id: 'kolli-hills', name: 'Kolli Hills', tamil: 'கொல்லிமலை', aliases: ['kolli hills', 'kolli malai', 'kollimalai', 'kolli hill', 'கொல்லிமலை'], lat: 11.25, lng: 78.34, radiusKm: 14 },
  { id: 'yelagiri', name: 'Yelagiri', tamil: 'ஏலகிரி', aliases: ['yelagiri', 'elagiri', 'yelagiri hills', 'ஏலகிரி'], lat: 12.58, lng: 78.64, radiusKm: 8 },
  { id: 'kolukkumalai', name: 'Kolukkumalai', tamil: 'கொழுக்குமலை', aliases: ['kolukkumalai', 'kolukumalai', 'kolukku malai', 'kolukkumalai tea', 'கொழுக்குமலை'], lat: 10.07, lng: 77.23, radiusKm: 12 },
  { id: 'jawadhu-hills', name: 'Jawadhu Hills', tamil: 'ஜவ்வாது மலை', aliases: ['jawadhu', 'javadhu', 'jawadi', 'jawadhu hills', 'javadi hills', 'ஜவ்வாது'], lat: 12.58, lng: 78.83, radiusKm: 22 },
  { id: 'manjolai', name: 'Manjolai', tamil: 'மாஞ்சோலை', aliases: ['manjolai', 'manjolai estate', 'upper kodayar', 'மாஞ்சோலை'], lat: 8.58, lng: 77.42, radiusKm: 12 },
  { id: 'kalvarayan-hills', name: 'Kalvarayan Hills', tamil: 'கல்வராயன் மலை', aliases: ['kalvarayan', 'kalrayan', 'kalvarayan hills', 'kalrayan hills', 'கல்வராயன்'], lat: 11.85, lng: 78.72, radiusKm: 25 },
  { id: 'sirumalai', name: 'Sirumalai', tamil: 'சிறுமலை', aliases: ['sirumalai', 'sirumalai hills', 'சிறுமலை'], lat: 10.15, lng: 78.0, radiusKm: 14 },
  { id: 'topslip', name: 'Topslip', tamil: 'டாப்ஸ்லிப்', aliases: ['topslip', 'top slip', 'டாப்ஸ்லிப்'], lat: 10.47, lng: 76.85, radiusKm: 12 },
];

// ── Configuration (business_config/tariff_v2 → hillStation) ──────────────────

/** Rupees, as the admin entered them (the fare's GST setting decides whether GST is inside or on top). */
export interface HillSlab { customer: number; partner: number }
export interface HillClassRates { oneWay?: HillSlab; roundTrip?: HillSlab }

export interface HillStationConfig {
  enabled: boolean;
  /** 'trip': one hill charge per trip (default). 'station': one per distinct hill station the trip visits. */
  chargePer: 'trip' | 'station';
  /** The slab of each vehicle class. A class with no slab is never charged here (nothing is invented). */
  classes: Partial<Record<TariffClass, HillClassRates>>;
  /** Extra or corrected stations (matched by id over the built-in list). */
  stations?: HillStation[];
  /** Built-in station ids that must not be treated as hill stations. */
  disabledStations?: string[];
}

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000;
const slabOf = (v: unknown): HillSlab | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  return isAmount(o.customer) && isAmount(o.partner) ? { customer: o.customer, partner: o.partner } : undefined;
};
const stationOf = (v: unknown): HillStation | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim().toLowerCase() : '';
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  if (!/^[a-z0-9-]{2,40}$/.test(id) || !name) return null;
  if (typeof o.lat !== 'number' || typeof o.lng !== 'number' || !(o.lat >= 6 && o.lat <= 37 && o.lng >= 67 && o.lng <= 98)) return null;
  if (typeof o.radiusKm !== 'number' || !(o.radiusKm >= 1 && o.radiusKm <= 60)) return null;
  const aliases = (Array.isArray(o.aliases) ? o.aliases : []).filter((a): a is string => typeof a === 'string' && a.trim().length >= 3).map((a) => a.trim().toLowerCase().slice(0, 60)).slice(0, 12);
  return { id, name, tamil: typeof o.tamil === 'string' ? o.tamil.trim().slice(0, 80) : '', aliases: aliases.length ? aliases : [name.toLowerCase()], lat: o.lat, lng: o.lng, radiusKm: o.radiusKm };
};

/** Parses the stored section; anything malformed is dropped (treated as not configured). `classKeys` are the valid tariff classes. */
export function parseHillStationConfig(raw: unknown, classKeys: readonly string[]): HillStationConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const classes: HillStationConfig['classes'] = {};
  if (o.classes && typeof o.classes === 'object') {
    for (const [cls, row] of Object.entries(o.classes as Record<string, unknown>)) {
      if (!classKeys.includes(cls) || !row || typeof row !== 'object') continue;
      const oneWay = slabOf((row as Record<string, unknown>).oneWay), roundTrip = slabOf((row as Record<string, unknown>).roundTrip);
      if (oneWay || roundTrip) classes[cls as TariffClass] = { ...(oneWay ? { oneWay } : {}), ...(roundTrip ? { roundTrip } : {}) };
    }
  }
  const stations = (Array.isArray(o.stations) ? o.stations : []).map(stationOf).filter((s): s is HillStation => s !== null).slice(0, 60);
  const disabled = (Array.isArray(o.disabledStations) ? o.disabledStations : []).filter((x): x is string => typeof x === 'string').slice(0, 60);
  return {
    enabled: o.enabled === true, chargePer: o.chargePer === 'station' ? 'station' : 'trip', classes,
    ...(stations.length ? { stations } : {}), ...(disabled.length ? { disabledStations: disabled } : {}),
  };
}

/** The built-in stations with the configured corrections / additions applied. */
export function hillStationsOf(cfg?: HillStationConfig | null): HillStation[] {
  const off = new Set(cfg?.disabledStations ?? []);
  const byId = new Map<string, HillStation>(HILL_STATIONS.filter((s) => !off.has(s.id)).map((s) => [s.id, s]));
  for (const s of cfg?.stations ?? []) byId.set(s.id, s);
  return [...byId.values()];
}

// ── Detection ────────────────────────────────────────────────────────────────

export type HillRole = 'pickup' | 'stop' | 'drop';
export interface HillPlaceInput { role: HillRole; name?: string; address?: string; lat: number; lng: number }
export interface HillMatch {
  id: string;
  name: string;
  tamil: string;
  /** The place of the trip that is in this hill station. */
  role: HillRole;
  placeName: string;
  /** 'location': within the station's radius. 'name': named by the place and within the wider ring. */
  via: 'location' | 'name';
  distanceKm: number;
}

const R_KM = 6371;
/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

const normText = (v: unknown): string => (typeof v === 'string' ? v : '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const ASCII = /^[a-z0-9 ]+$/;
function namesStation(text: string, s: HillStation): boolean {
  if (!text) return false;
  const padded = ` ${text} `;
  return s.aliases.some((alias) => {
    const a = normText(alias);
    if (!a) return false;
    // English aliases match whole words ("ooty" is not "footy"); Tamil aliases match as text (Tamil words take suffixes).
    return ASCII.test(a) ? padded.includes(` ${a} `) : text.includes(a);
  });
}

/** The nearest station that holds the place (by position, or by name within the wider ring), or null. */
export function hillStationOf(p: Pick<HillPlaceInput, 'name' | 'address' | 'lat' | 'lng'>, stations: readonly HillStation[] = HILL_STATIONS): { station: HillStation; via: 'location' | 'name'; distanceKm: number } | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  const text = normText(`${p.name ?? ''} ${p.address ?? ''}`);
  let best: { station: HillStation; via: 'location' | 'name'; distanceKm: number } | null = null;
  for (const station of stations) {
    const distanceKm = haversineKm(p, station);
    const via = distanceKm <= station.radiusKm ? 'location' : distanceKm <= station.radiusKm * NAME_RING_FACTOR && namesStation(text, station) ? 'name' : null;
    if (via && (!best || distanceKm < best.distanceKm)) best = { station, via, distanceKm };
  }
  return best;
}

/** Every hill station the trip's pickup, stops and drop are in (one entry per place; the same station can appear for several places). */
export function detectHillStations(places: readonly HillPlaceInput[], cfg?: HillStationConfig | null): HillMatch[] {
  const stations = hillStationsOf(cfg);
  const out: HillMatch[] = [];
  for (const place of places) {
    const hit = hillStationOf(place, stations);
    if (!hit) continue;
    out.push({
      id: hit.station.id, name: hit.station.name, tamil: hit.station.tamil, role: place.role, placeName: (place.name || place.address || '').slice(0, 120),
      via: hit.via, distanceKm: Math.round(hit.distanceKm * 10) / 10,
    });
  }
  return out;
}

/** Distinct hill stations of a detection, in trip order. */
export function distinctHillStations(matches: readonly HillMatch[]): { id: string; name: string; tamil: string }[] {
  const seen = new Set<string>();
  const out: { id: string; name: string; tamil: string }[] = [];
  for (const m of matches) if (!seen.has(m.id)) { seen.add(m.id); out.push({ id: m.id, name: m.name, tamil: m.tamil }); }
  return out;
}

// ── Charge ───────────────────────────────────────────────────────────────────

/** What a booking is charged for its hill stations, as configured at quote time (rupees as entered). */
export interface HillCharge {
  slab: 'oneWay' | 'roundTrip';
  /** The hill stations the trip is in (customer-visible). */
  stations: { id: string; name: string; tamil: string }[];
  /** How many times the slab is charged (1, or one per station with chargePer 'station'). */
  units: number;
  /** Customer rupees as configured, per unit and in total. */
  customerPerUnit: number;
  customerTotal: number;
  /** Partner rupees (payout data — never stored on the customer-readable booking). */
  partnerTotal: number;
}

/** The hill charge of a detected trip, or null when the setting is off, no hill station was found, or the class has no slab. */
export function hillChargeFor(cfg: HillStationConfig | null | undefined, cls: TariffClass | null, tripType: 'One Way' | 'Round Trip', matches: readonly HillMatch[]): HillCharge | null {
  if (!cfg?.enabled || !cls || !matches.length) return null;
  const slabKey = tripType === 'Round Trip' ? 'roundTrip' : 'oneWay';
  const slab = cfg.classes[cls]?.[slabKey];
  if (!slab || !(slab.customer > 0)) return null;
  const stations = distinctHillStations(matches);
  const units = cfg.chargePer === 'station' ? stations.length : 1;
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return { slab: slabKey, stations, units, customerPerUnit: slab.customer, customerTotal: round2(slab.customer * units), partnerTotal: round2(slab.partner * units) };
}

/** "Ooty", "Ooty and Coonoor", "Ooty, Coonoor and Kotagiri". */
export function hillNames(stations: readonly { name: string }[]): string {
  const n = stations.map((s) => s.name);
  return n.length <= 1 ? n[0] ?? '' : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
