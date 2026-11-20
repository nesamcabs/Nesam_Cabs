// Hill station charge (Customer UX v8 · "Round Trip & Hill Station Developer Guide", section 08).
//
// A One Way or Round Trip whose pickup, destination or any stop is in a hill station of Tamil Nadu, Karnataka (Bangalore side
// included) or Kerala gets a Hill Station Allowance / Charge, billed as its OWN line (never mixed into the base or package fare)
// from the vehicle class's configured slab:
//   One Way    : base fare + driver bata + extra km + hill charge (One-Way slab) + toll / permit
//   Round Trip : package fare + extra km + hill charge (Round-Trip slab) + toll / permit
// Hill station trips never use the 5-hour / 8-hour short packages: they go straight to the Full Day or the multi-day slab.
//
// Detection is by POSTAL PINCODE only — there is no distance or radius calculation. Each hill station lists the India Post
// pincodes that cover the hill and the country around it (about 10 km of the hill station, taken from the post offices that
// deliver there). A trip place is "in" a hill station when its pincode is one of them. The place's pincode is the one the map
// search wrote in its address (Google's formatted addresses carry it), the one the app sent, or — for a bare map pin — the one
// the server reverse-geocodes (placePincode.ts). A place with no pincode is not a hill-station place; nothing is guessed.
//
// A pincode is the smallest area India Post publishes, so a few pincodes also deliver to a plains town beside the hill (the
// Nelliyampathy pincode also covers Nemmara). Where a pincode mostly delivers to a plains town (Sirumalai with Dindigul city,
// B R Hills with Yelandur) the hill is left out rather than flagging that town. Admin can add pincodes to a station, add a station
// or switch one off (business_config/tariff_v2 → hillStation.stations / disabledStations).
//
// Pure helpers only (no Firestore, no map calls) so the quote, the booking snapshot, the final fare and the tests share one rule.
import type { TariffClass } from './tariff';

export type HillState = 'Tamil Nadu' | 'Karnataka' | 'Kerala';

export interface HillStation {
  id: string;
  name: string;
  /** Tamil name, shown beside the English one ('' when there is no common Tamil spelling). */
  tamil: string;
  state: HillState;
  /** India Post pincodes (six digits) that cover the hill station and about 10 km around it. */
  pincodes: string[];
}

const st = (id: string, name: string, tamil: string, state: HillState, pincodes: string[]): HillStation => ({ id, name, tamil, state, pincodes });

/**
 * The hill stations of the developer guide, with the pincodes of the post offices on and around each hill (India Post office list;
 * each pincode checked against the office names it delivers to). Edit here, or per deployment from the admin hill-station setting.
 */
export const HILL_STATIONS: readonly HillStation[] = [
  // ── Tamil Nadu ──
  st('ooty', 'Ooty', 'ஊட்டி', 'Tamil Nadu', ['643001', '643002', '643003', '643004', '643005', '643006', '643007', '643202', '643215', '643243']),
  st('coonoor', 'Coonoor', 'குன்னூர்', 'Tamil Nadu', ['643101', '643102', '643103', '643105', '643201', '643202', '643213', '643214', '643215', '643218', '643231', '643243']),
  st('kotagiri', 'Kotagiri', 'கோத்தகிரி', 'Tamil Nadu', ['643201', '643206', '643214', '643216', '643217']),
  st('kodaikanal', 'Kodaikanal', 'கொடைக்கானல்', 'Tamil Nadu', ['624101', '624103']),
  st('yercaud', 'Yercaud', 'ஏற்காடு', 'Tamil Nadu', ['636601', '636602']),
  st('valparai', 'Valparai', 'வால்பாறை', 'Tamil Nadu', ['642125', '642127']),
  st('topslip', 'Topslip', 'டாப்ஸ்லிப்', 'Tamil Nadu', ['642133']),
  st('megamalai', 'Megamalai', 'மேகமலை', 'Tamil Nadu', ['625519']),
  st('kolli-hills', 'Kolli Hills', 'கொல்லிமலை', 'Tamil Nadu', ['637411']),
  st('yelagiri', 'Yelagiri', 'ஏலகிரி', 'Tamil Nadu', ['635853']),
  st('jawadhu-hills', 'Jawadhu Hills', 'ஜவ்வாது மலை', 'Tamil Nadu', ['635703']),
  st('kalvarayan-hills', 'Kalvarayan Hills', 'கல்வராயன் மலை', 'Tamil Nadu', ['606209']),
  st('manjolai', 'Manjolai', 'மாஞ்சோலை', 'Tamil Nadu', ['627420']),
  st('kolukkumalai', 'Kolukkumalai', 'கொழுக்குமலை', 'Tamil Nadu', ['685618']),
  // ── Kerala ──
  st('munnar', 'Munnar', 'மூணாறு', 'Kerala', ['685565', '685612', '685613', '685614', '685616']),
  st('thekkady', 'Thekkady', 'தேக்கடி', 'Kerala', ['685509']),
  st('vagamon', 'Vagamon', 'வாகமன்', 'Kerala', ['685501', '685503']),
  st('peermade', 'Peermade', 'பீர்மேடு', 'Kerala', ['685531']),
  st('ponmudi', 'Ponmudi', 'பொன்முடி', 'Kerala', ['695551']),
  st('wayanad', 'Wayanad', 'வயநாடு', 'Kerala', ['673121', '673123', '673575', '673576', '673577']),
  st('nelliyampathy', 'Nelliyampathy', 'நெல்லியம்பதி', 'Kerala', ['678508']),
  // ── Karnataka (Coorg, the Chikmagalur and Western Ghats hills, and the Bangalore side) ──
  st('madikeri', 'Madikeri (Coorg)', 'குடகு', 'Karnataka', ['571201']),
  st('bhagamandala', 'Bhagamandala · Talacauvery', '', 'Karnataka', ['571247']),
  st('chikmagalur', 'Chikmagalur · Mullayanagiri', 'சிக்மகளூர்', 'Karnataka', ['577101', '577130', '577131']),
  st('kemmangundi', 'Kemmangundi', '', 'Karnataka', ['577137']),
  st('sakleshpur', 'Sakleshpur', '', 'Karnataka', ['573134']),
  st('agumbe', 'Agumbe', '', 'Karnataka', ['577411']),
  st('kudremukh', 'Kudremukh', '', 'Karnataka', ['577142']),
  st('nandi-hills', 'Nandi Hills · Skandagiri', '', 'Karnataka', ['562103']),
];

// ── Pincodes ─────────────────────────────────────────────────────────────────

const PINCODE = /^[1-9]\d{5}$/;
/** The six-digit pincode in `v` (a string or number), or '' when it is not a valid Indian pincode. */
export function validPincode(v: unknown): string {
  const s = typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' ? v.trim() : '';
  return PINCODE.test(s) ? s : '';
}

/** The pincode written in a place's address or name ("… Tamil Nadu 643001, India"): the last standalone six-digit number, or ''. */
export function pincodeIn(text: unknown): string {
  if (typeof text !== 'string') return '';
  const found = [...text.matchAll(/(?<![\d-])([1-9]\d{5})(?![\d-])/g)];
  const last = found[found.length - 1];
  return last ? last[1]! : '';
}

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
  /** Extra or corrected stations (matched by id over the built-in list): their pincodes replace the built-in ones. */
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
const STATES: readonly HillState[] = ['Tamil Nadu', 'Karnataka', 'Kerala'];
const stationOf = (v: unknown): HillStation | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim().toLowerCase() : '';
  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  if (!/^[a-z0-9-]{2,40}$/.test(id) || !name) return null;
  const pincodes = [...new Set((Array.isArray(o.pincodes) ? o.pincodes : []).map(validPincode).filter(Boolean))].slice(0, 60);
  // A station without pincodes cannot be detected (an older radius-style entry is dropped here).
  if (!pincodes.length) return null;
  const state = STATES.find((s) => s === o.state) ?? 'Tamil Nadu';
  return { id, name, tamil: typeof o.tamil === 'string' ? o.tamil.trim().slice(0, 80) : '', state, pincodes };
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
  const stations = (Array.isArray(o.stations) ? o.stations : []).map(stationOf).filter((s): s is HillStation => s !== null).slice(0, 80);
  const disabled = (Array.isArray(o.disabledStations) ? o.disabledStations : []).filter((x): x is string => typeof x === 'string').slice(0, 80);
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
/** A trip place: its pincode, or the address / name the pincode is read from. */
export interface HillPlaceInput { role: HillRole; name?: string; address?: string; pincode?: string }
export interface HillMatch {
  id: string;
  name: string;
  tamil: string;
  /** The place of the trip that is in this hill station. */
  role: HillRole;
  placeName: string;
  /** The pincode that matched. */
  pincode: string;
}

/** The pincode of a trip place: the one it carries, else the one written in its address, else in its name. */
export function placePincode(p: Pick<HillPlaceInput, 'name' | 'address' | 'pincode'>): string {
  return validPincode(p.pincode) || pincodeIn(p.address) || pincodeIn(p.name);
}

/** The hill station whose pincodes include the place's pincode, or null. */
export function hillStationOf(p: Pick<HillPlaceInput, 'name' | 'address' | 'pincode'>, stations: readonly HillStation[] = HILL_STATIONS): { station: HillStation; pincode: string } | null {
  const pincode = placePincode(p);
  if (!pincode) return null;
  const station = stations.find((s) => s.pincodes.includes(pincode));
  return station ? { station, pincode } : null;
}

/** Every hill station the trip's pickup, stops and drop are in (one entry per place; the same station can appear for several places). */
export function detectHillStations(places: readonly HillPlaceInput[], cfg?: HillStationConfig | null): HillMatch[] {
  const stations = hillStationsOf(cfg);
  const out: HillMatch[] = [];
  for (const place of places) {
    const hit = hillStationOf(place, stations);
    if (!hit) continue;
    out.push({ id: hit.station.id, name: hit.station.name, tamil: hit.station.tamil, role: place.role, placeName: (place.name || place.address || '').slice(0, 120), pincode: hit.pincode });
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
  slab: 'oneWay' | 'roundTrip' | 'multicity';
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

/** The hill charge of a trip: the rupees the fare table sets for the vehicle, once per trip (or once per hill station visited). */
export function hillChargeForRates(cfg: HillStationConfig | null | undefined, rates: { customer: number; partner: number } | null, matches: readonly HillMatch[], slab: HillCharge['slab']): HillCharge | null {
  if (!rates || !(rates.customer > 0) || !matches.length) return null;
  const stations = distinctHillStations(matches);
  const units = cfg?.chargePer === 'station' ? stations.length : 1;
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return { slab, stations, units, customerPerUnit: rates.customer, customerTotal: round2(rates.customer * units), partnerTotal: round2(rates.partner * units) };
}

/** "Ooty", "Ooty and Coonoor", "Ooty, Coonoor and Kotagiri". */
export function hillNames(stations: readonly { name: string }[]): string {
  const n = stations.map((s) => s.name);
  return n.length <= 1 ? n[0] ?? '' : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}
