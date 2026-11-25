/**
 * The one location hierarchy every geographic setting uses:  State → District → Service Zone → Area / City / Village  (+ PIN).
 *
 * Data comes only from real sources: the Locations master (canonical record ids) and India Post's district / pincode directory
 * (pincodeDistricts.ts, pincodes/*.json). Nothing here invents a district, zone, village or pincode mapping.
 *   - A District is administrative: India Post's list for the state, plus a district saved on a Locations record.
 *   - A Service Zone is a business zone: a Locations record of type "Service Zone", or an older Pickup & Drop zone (an
 *     "Area / Locality" that lists the pincodes it covers). It is never treated as a district.
 *   - An Area is any other Locations record (City, Area / Locality, Airport, …).
 * Broad choices (whole state, all districts, all zones, all mapped areas) are configuration scopes, never a pickup address.
 * Pure functions: the booking server applies the same rules (functions/src/domain/geoScope.ts, geoPricing.ts).
 */
import type { MasterLocation } from "../types";
import { GST_STATES } from "./gstStates";
import { DISTRICTS_BY_STATE } from "./pincodeDistricts";

export interface LocSel {
  /** GST state code; '' = all states. */
  state: string;
  /** District name as listed; '' = whole state / all districts. */
  district: string;
  /** Service Zone record id; '' = all zones. */
  zoneId: string;
  /** Area / city / village record id; '' = all mapped areas. */
  locationId: string;
  /** PIN codes picked from PIN search (rule screens): one place each. */
  pins: string[];
}
export const EMPTY_SEL: LocSel = { state: "", district: "", zoneId: "", locationId: "", pins: [] };
export type SelLevel = "all" | "state" | "district" | "zone" | "area";

const low = (v?: string | null) => (v ?? "").trim().toLowerCase();
const PIN = /^[1-9]\d{5}$/;

/** GST code of a state saved as a name ("Tamil Nadu") or a code ("33"); '' when unknown. */
export function stateCodeOf(v?: string | null): string {
  const s = (v ?? "").trim();
  if (/^\d{2}$/.test(s)) return GST_STATES.some(([c]) => c === s) ? s : "";
  return GST_STATES.find(([, n]) => low(n) === low(s))?.[0] ?? "";
}
export const stateNameOf = (code: string) => GST_STATES.find(([c]) => c === code)?.[1] ?? code;

/** The pincodes a record covers: its `pincodes` list and its single `pincode`. */
export function pinsOfLocation(l: Pick<MasterLocation, "pincode" | "pincodes">): string[] {
  return [...new Set([...(l.pincodes ?? []), l.pincode ?? ""].map((p) => p.trim()).filter((p) => PIN.test(p)))];
}

/** A Service Zone record (new type), or an older Pickup & Drop zone: an Area / Locality listing the pincodes it covers. */
export const isZone = (l: MasterLocation) => l.type === "Service Zone" || (l.type === "Area / Locality" && (l.pincodes?.length ?? 0) > 0);

/** The listed district matching a name in a state (any case); '' when not listed. */
export function listedDistrict(state: string, name?: string | null): string {
  const n = low(name);
  return n ? (DISTRICTS_BY_STATE[state] ?? []).find((d) => low(d) === n) ?? "" : "";
}

/**
 * The district of a record: its saved district (matched to the listed name when it is one), a City whose name is a district, or
 * the record above it. '' when none is known. A record's pincode is resolved separately (PIN directory) by the caller.
 */
export function districtOfLocation(l: MasterLocation, byId: Map<string, MasterLocation>): string {
  const seen = new Set<string>();
  let cur: MasterLocation | undefined = l;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const st = stateCodeOf(cur.state);
    const saved = (cur.district ?? "").trim();
    if (saved) return listedDistrict(st, saved) || saved;
    if (cur.type === "City") { const d = listedDistrict(st, cur.name) || listedDistrict(st, cur.city); if (d) return d; }
    cur = cur.parentLocationId ? byId.get(cur.parentLocationId) : undefined;
  }
  return "";
}

export interface Indexed { loc: MasterLocation; state: string; district: string; zone: boolean; pins: string[] }

/** Every record with its state code, district and pincodes worked out once. `pinDistrict` resolves a pincode to its district. */
export function indexLocations(locations: MasterLocation[], pinDistrict?: (state: string, pin: string) => string): Indexed[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  return locations.map((loc) => {
    const state = stateCodeOf(loc.state);
    const pins = pinsOfLocation(loc);
    let district = districtOfLocation(loc, byId);
    if (!district && pinDistrict && pins[0]) district = pinDistrict(state, pins[0]);
    return { loc, state, district, zone: isZone(loc), pins };
  });
}

/** Districts of a state: India Post's list and any district saved on a Locations record of that state. */
export function districtsOf(state: string, index: Indexed[]): string[] {
  const saved = index.filter((x) => x.state === state && x.district).map((x) => x.district);
  const listed = DISTRICTS_BY_STATE[state] ?? [];
  return [...new Set([...listed, ...saved.filter((d) => !listed.some((l) => low(l) === low(d)))])].sort((a, b) => a.localeCompare(b));
}

const sameDistrict = (x: Indexed, state: string, district: string) => x.state === state && low(x.district) === low(district);

/** Active (or currently chosen) Service Zones of a district. */
export function zonesOf(index: Indexed[], state: string, district: string, keepId = ""): MasterLocation[] {
  return index.filter((x) => x.zone && sameDistrict(x, state, district) && (x.loc.status === "Active" || x.loc.id === keepId)).map((x) => x.loc)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The zone an area belongs to: a zone above it, else the one zone of its district listing its pincode. null when none / ambiguous. */
export function zoneOfArea(area: MasterLocation, index: Indexed[]): MasterLocation | null {
  const byId = new Map(index.map((x) => [x.loc.id, x]));
  const seen = new Set<string>();
  let cur = area.parentLocationId ? byId.get(area.parentLocationId) : undefined;
  while (cur && !seen.has(cur.loc.id)) {
    seen.add(cur.loc.id);
    if (cur.zone) return cur.loc;
    cur = cur.loc.parentLocationId ? byId.get(cur.loc.parentLocationId) : undefined;
  }
  const me = byId.get(area.id);
  if (!me || !me.pins.length) return null;
  const claim = index.filter((x) => x.zone && x.loc.status === "Active" && sameDistrict(x, me.state, me.district) && me.pins.some((p) => x.pins.includes(p)));
  return claim.length === 1 ? claim[0]!.loc : null;
}

/** Mapped areas of a district (or of one of its zones): Locations records other than zones. */
export function areasOf(index: Indexed[], state: string, district: string, zoneId = "", keepId = ""): MasterLocation[] {
  return index.filter((x) => !x.zone && sameDistrict(x, state, district) && (x.loc.status === "Active" || x.loc.id === keepId))
    .filter((x) => !zoneId || zoneOfArea(x.loc, index)?.id === zoneId)
    .map((x) => x.loc).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Applies a change to a selection: a new state clears everything below it; a new district clears zone, area and PINs; a new zone
 * keeps the area only when it belongs to that zone; choosing an area under "All zones" selects the zone it actually belongs to.
 * Nothing is ever auto-selected as a fallback.
 */
export function changeSel(prev: LocSel, patch: Partial<LocSel>, index: Indexed[]): LocSel {
  if (patch.state !== undefined && patch.state !== prev.state) return { ...EMPTY_SEL, state: patch.state };
  if (patch.district !== undefined && patch.district !== prev.district) return { ...EMPTY_SEL, state: prev.state, district: patch.district };
  if (patch.zoneId !== undefined && patch.zoneId !== prev.zoneId) {
    const area = index.find((x) => x.loc.id === prev.locationId)?.loc;
    const keep = area && patch.zoneId && zoneOfArea(area, index)?.id === patch.zoneId;
    return { ...prev, zoneId: patch.zoneId, locationId: keep ? prev.locationId : "", pins: [] };
  }
  if (patch.locationId !== undefined && patch.locationId !== prev.locationId) {
    const area = index.find((x) => x.loc.id === patch.locationId)?.loc;
    const zone = area ? zoneOfArea(area, index) : null;
    return { ...prev, locationId: patch.locationId, zoneId: patch.locationId ? zone?.id ?? prev.zoneId : prev.zoneId, pins: [] };
  }
  if (patch.pins !== undefined) return { ...prev, pins: [...new Set(patch.pins)] };
  return prev;
}

/** A selection that points at one record (PIN search result, saved scope): state, district, zone and area filled in. */
export function selOfLocation(id: string, index: Indexed[]): LocSel | null {
  const x = index.find((i) => i.loc.id === id);
  if (!x || !x.state) return null;
  if (x.zone) return { ...EMPTY_SEL, state: x.state, district: x.district, zoneId: x.loc.id };
  return { ...EMPTY_SEL, state: x.state, district: x.district, zoneId: zoneOfArea(x.loc, index)?.id ?? "", locationId: x.loc.id };
}

export function selLevel(s: LocSel): SelLevel {
  return s.locationId ? "area" : s.zoneId ? "zone" : s.district ? "district" : s.state ? "state" : "all";
}

/** The scope a location-scoped rate / peak rule is saved for (the server checks it again). */
export function geoScopeOf(s: LocSel): { level: SelLevel; state: string; district: string; zoneId?: string; locationId?: string } {
  const level = selLevel(s);
  return { level, state: s.state, district: s.district, ...(level === "zone" ? { zoneId: s.zoneId } : {}), ...(level === "area" ? { locationId: s.locationId } : {}) };
}

const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Same keys as functions/src/domain/geoScope.ts scopeKey. */
export function scopeKeyOf(s: { level: SelLevel; state: string; district: string; zoneId?: string; locationId?: string }): string {
  switch (s.level) {
    case "all": return "all";
    case "state": return `s_${s.state}`;
    case "district": return `d_${s.state}_${slug(s.district)}`;
    case "zone": return `z_${s.zoneId}`;
    case "area": return `a_${s.locationId}`;
  }
}
/** Fare keys a selection inherits from, most specific first (area → zone → district). */
export function fareChainOf(s: LocSel): string[] {
  const keys: string[] = [];
  if (s.locationId) keys.push(`a_${s.locationId}`);
  if (s.zoneId) keys.push(`z_${s.zoneId}`);
  if (s.state && s.district) keys.push(scopeKeyOf({ level: "district", state: s.state, district: s.district }));
  return keys;
}

/** A booking-rule place (service_rules scope), unchanged in shape: state code, city / district name, area name or pincode, optional zone. */
export interface RulePlace { state: string; city: string; area: string; zoneId?: string; zoneName?: string }

/**
 * The booking-rule places a selection stands for. A City record stays a city rule (its own name), so an existing city-wide rule keeps
 * its meaning; a district is a city-level rule with the district name, exactly as the old State → City row saved it; picked PINs give
 * one place each, as before.
 */
export function rulePlacesOf(s: LocSel, index: Indexed[]): RulePlace[] {
  if (!s.state) return [{ state: "", city: "", area: "" }];
  if (s.pins.length) return s.pins.map((pin) => ({ state: s.state, city: s.district, area: pin }));
  if (s.locationId) {
    const l = index.find((x) => x.loc.id === s.locationId)?.loc;
    if (!l) return [];
    if (l.type === "City") return [{ state: s.state, city: low(l.name) === low(s.district) ? s.district : l.name, area: "" }];
    return [{ state: s.state, city: s.district, area: l.name }];
  }
  if (s.zoneId) {
    const z = index.find((x) => x.loc.id === s.zoneId)?.loc;
    return z ? [{ state: s.state, city: s.district, area: "", zoneId: z.id, zoneName: z.name }] : [];
  }
  if (s.district) return [{ state: s.state, city: s.district, area: "" }];
  return [{ state: s.state, city: "", area: "" }];
}

/** Full hierarchy label of a rule place, so repeated names are told apart: "Periyakulam · Theni · Tamil Nadu". */
export function rulePlaceLabel(p: RulePlace): string {
  if (!p.state && !p.city) return "All locations";
  const parts = [PIN.test(p.area) ? `PIN ${p.area}` : p.area, p.zoneName ? `${p.zoneName} (zone)` : "", p.city, stateNameOf(p.state)].filter(Boolean);
  return parts.join(" · ");
}

/** The breadcrumb of a selection: real names only. */
export function breadcrumbOf(s: LocSel, index: Indexed[], broad = { state: "All states", zone: "All zones", area: "All mapped areas" }): string[] {
  if (!s.state) return [broad.state];
  const name = (id: string) => index.find((x) => x.loc.id === id)?.loc.name ?? "Unknown location";
  return [stateNameOf(s.state), s.district || "Whole state", ...(s.district ? [s.zoneId ? name(s.zoneId) : broad.zone, s.locationId ? name(s.locationId) : broad.area] : [])];
}

/** PIN search: the Locations records carrying a pincode (with their full hierarchy), most specific first. */
export function locationsWithPin(pin: string, index: Indexed[]): Indexed[] {
  if (!PIN.test(pin)) return [];
  return index.filter((x) => x.pins.includes(pin)).sort((a, b) => Number(a.zone) - Number(b.zone) || a.loc.name.localeCompare(b.loc.name));
}

/** The GST state codes whose pincodes can start with these digits (India Post circles), so PIN search loads only those files. */
export function statesForPin(pin: string): string[] {
  const p2 = Number(pin.slice(0, 2)), p3 = Number(pin.slice(0, 3));
  if (!PIN.test(pin)) return [];
  if (p2 === 11) return ["07"];
  if (p2 >= 12 && p2 <= 13) return ["06"];
  if (p2 >= 14 && p2 <= 16) return ["03", "04", "06"];
  if (p2 === 17) return ["02"];
  if (p2 >= 18 && p2 <= 19) return ["01", "38"];
  if (p2 >= 20 && p2 <= 28) return ["09", "05"];
  if (p2 >= 30 && p2 <= 34) return ["08"];
  if (p2 >= 36 && p2 <= 39) return ["24", "26"];
  if (p2 >= 40 && p2 <= 44) return ["27", "30"];
  if (p2 >= 45 && p2 <= 48) return ["23"];
  if (p2 === 49) return ["22"];
  if (p2 === 50) return ["36"];
  if (p2 >= 51 && p2 <= 53) return ["37", "36"];
  if (p2 >= 56 && p2 <= 59) return ["29"];
  if (p2 >= 60 && p2 <= 64) return ["33", "34"];
  if (p2 >= 67 && p2 <= 69) return ["32", "31", "34"];
  if (p2 >= 70 && p2 <= 74) return p3 === 737 ? ["11"] : p3 === 744 ? ["35"] : ["19", "11", "35"];
  if (p2 >= 75 && p2 <= 77) return ["21"];
  if (p2 === 78) return ["18"];
  if (p2 === 79) return ["12", "13", "14", "15", "16", "17", "18"];
  if (p2 >= 80 && p2 <= 85) return ["10", "20"];
  return [];
}

/**
 * The selector position of a saved rule place (editing): best effort, never changing the saved scope. The caller keeps the saved
 * scope until the selector is actually changed, so a city-wide or pincode rule keeps its exact meaning.
 */
export function selOfRulePlace(p: RulePlace, index: Indexed[]): LocSel {
  const state = stateCodeOf(p.state) || p.state;
  if (!state) return EMPTY_SEL;
  let district = listedDistrict(state, p.city), locationId = "";
  if (!district && p.city) {
    const city = index.find((x) => x.state === state && x.loc.type === "City" && low(x.loc.name) === low(p.city));
    if (city) { district = city.district; locationId = city.loc.id; } else district = p.city;
  }
  if (p.zoneId) return { ...EMPTY_SEL, state, district, zoneId: p.zoneId };
  if (PIN.test(p.area)) return { ...EMPTY_SEL, state, district, pins: [p.area] };
  if (p.area) {
    const a = index.find((x) => !x.zone && x.state === state && low(x.district) === low(district) && low(x.loc.name) === low(p.area));
    if (a) return { ...EMPTY_SEL, state, district, zoneId: zoneOfArea(a.loc, index)?.id ?? "", locationId: a.loc.id };
  }
  return { ...EMPTY_SEL, state, district, locationId };
}
