// The geographic scope of Local Pickup & Drop / Hourly Rental rates and scheduled peak rules. Pure functions, no database.
//
// Hierarchy (admin "Service & Fare Settings" location selector):  State → District → Service Zone → Area / City / Village.
//   - A District is administrative (India Post's district list, or the district saved on a Locations record).
//   - A Service Zone is a business zone: a Locations record of type "Service Zone", or an older Pickup & Drop zone
//     (an "Area / Locality" that lists the pincodes it covers). It is never the same thing as a district.
//   - An Area is any other Locations record (City, Area / Locality, Airport, …) identified by its record id.
//
// Rates are saved against one scope key and resolved most specific first: area → zone → district. Peak rules may also be
// saved for a whole state or everywhere. Missing values are never zero and never borrowed from another district.
import { DISTRICTS_BY_STATE } from './pincodeDistricts';
import { pinsOfCity, stateCodeOf } from './pincodeLookup';

export type GeoLevel = 'all' | 'state' | 'district' | 'zone' | 'area';

export interface GeoScope {
  level: GeoLevel;
  /** GST state code ("33"); '' for level 'all'. */
  state: string;
  /** District name as listed (India Post / Locations); '' above district level. */
  district: string;
  /** Locations record id of the Service Zone (level 'zone'). */
  zoneId?: string;
  /** Locations record id of the area / city / village (level 'area'). */
  locationId?: string;
  /** Human label kept for history screens only; never used to match. */
  label?: string;
}

/** Where a pickup is, resolved by the booking server: the keys of every scope that covers it. */
export interface PlaceScope {
  state: string;
  district: string;
  /** The Service Zone the pickup is in; null when none or when two zones claim it (ambiguous). */
  zoneId: string | null;
  /** The chosen Locations record and the records above it, closest first. */
  areaIds: string[];
}

const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The stable key of one scope. Doc ids and rule lookups use it; labels never do. */
export function scopeKey(s: Pick<GeoScope, 'level' | 'state' | 'district' | 'zoneId' | 'locationId'>): string {
  switch (s.level) {
    case 'all': return 'all';
    case 'state': return `s_${s.state}`;
    case 'district': return `d_${s.state}_${slug(s.district)}`;
    case 'zone': return `z_${s.zoneId}`;
    case 'area': return `a_${s.locationId}`;
  }
}

/** Fare keys of a pickup, most specific first: its area records, its zone, its district. */
export function fareKeysOf(p: PlaceScope): string[] {
  const keys = p.areaIds.map((id) => `a_${id}`);
  if (p.zoneId) keys.push(`z_${p.zoneId}`);
  if (p.state && p.district) keys.push(scopeKey({ level: 'district', state: p.state, district: p.district }));
  return keys;
}

/** Peak-rule keys of a pickup: the fare keys, then the whole state, then everywhere. */
export function peakKeysOf(p: PlaceScope): string[] {
  return [...fareKeysOf(p), ...(p.state ? [`s_${p.state}`] : []), 'all'];
}

/** How specific a key is: area 4, zone 3, district 2, state 1, everywhere 0. */
export function keyRank(key: string): number {
  return key.startsWith('a_') ? 4 : key.startsWith('z_') ? 3 : key.startsWith('d_') ? 2 : key.startsWith('s_') ? 1 : 0;
}

/** The district names of a state (India Post). */
export function districtsOf(state: string): string[] {
  return DISTRICTS_BY_STATE[stateCodeOf(state)] ?? [];
}

/** The listed district name matching `name` in a state, any case; '' when it is not a district of that state. */
export function districtName(state: string, name: unknown): string {
  const n = typeof name === 'string' ? name.trim().toLowerCase() : '';
  return n ? districtsOf(state).find((d) => d.toLowerCase() === n) ?? '' : '';
}

/**
 * The state and district a pincode belongs to (India Post: every pincode is in exactly one district). With a state, only that
 * state is searched. null when the pincode is not in the directory.
 */
export function districtOfPin(pin: string, state?: string): { state: string; district: string } | null {
  if (!/^[1-9]\d{5}$/.test(pin)) return null;
  const code = state ? stateCodeOf(state) : '';
  const states = code ? [code] : Object.keys(DISTRICTS_BY_STATE);
  for (const st of states) {
    for (const d of DISTRICTS_BY_STATE[st] ?? []) {
      if (pinsOfCity(d, st)?.has(pin)) return { state: st, district: d };
    }
  }
  return null;
}
