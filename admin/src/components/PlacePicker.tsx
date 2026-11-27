import { useEffect, useMemo, useState } from "react";
import { DISTRICTS_BY_STATE } from "../domain/pincodeDistricts";
import { areasOf, pincodesOf, type AreaEntry, type PincodeList, type StateAreas } from "../domain/pincodes";
import { districtKey, geoDoc, isAreaKey, parseGeo, pinOfArea, slugOfArea } from "../domain/localPricing";
import { useSavedDoc } from "../services/localFareService";
import { suggestedZones, tamilNameOf } from "./localFares/model";
import { selectClass } from "./localFares/parts";
import "./localFares/localFares.css";

// The "where does this apply" choice of Booking rules, the same five boxes as the district fares page:
// State → District → Service zone → Area / Village → PIN code, with a PIN search.

/** What is chosen. `city` is the district (or a town of an older rule); `areaKey` is a village ("625534~koduvilarpatti"). */
export interface PlaceChoice { state: string; city: string; zone: string; areaKey: string; pin: string }

export const emptyChoice: PlaceChoice = { state: "", city: "", zone: "", areaKey: "", pin: "" };

/** The picker's choice for a saved rule's place. An older rule naming an area by text keeps it in `areaKey`. */
export const choiceOf = (scope: { state: string; city: string; area: string }): PlaceChoice => {
  const pin = /^[1-9]\d{5}$/.test(scope.area);
  return { state: scope.state, city: scope.city, zone: "", areaKey: pin ? "" : scope.area, pin: pin ? scope.area : "" };
};

export const isVillage = (area: string) => area.includes("~") && isAreaKey(area);

/** The areas of the given states, to name saved villages. */
export function useAreaNames(states: string[]) {
  const wanted = [...new Set(states.filter(Boolean))].sort().join(",");
  const [loaded, setLoaded] = useState<Record<string, StateAreas>>({});
  useEffect(() => {
    let current = true;
    for (const state of wanted ? wanted.split(",") : []) void areasOf(state).then((data) => { if (current) setLoaded((all) => ({ ...all, [state]: data })); }, () => undefined);
    return () => { current = false; };
  }, [wanted]);
  /** A saved area in words: "Koduvilarpatti · 625534" for a village, else the pincode or area as saved. */
  return (state: string, city: string, area: string): string => {
    if (!isVillage(area)) return area;
    const found = loaded[state]?.areas[city]?.find((a) => a.key === area);
    const slug = slugOfArea(area);
    return `${found?.name ?? slug.charAt(0).toUpperCase() + slug.slice(1)} · ${pinOfArea(area)}`;
  };
}

/**
 * The data behind a choice, and what it means for saving:
 *   `areas` is the rule areas to create — [""] = the whole district / state, a village, a PIN code, or every PIN code of a zone.
 *   `canAdd` is false while the chosen zone has no PIN code to save.
 */
export function usePlaceScope(choice: PlaceChoice) {
  const { state, city, zone, areaKey, pin } = choice;
  const [places, setPlaces] = useState<{ state: string; data: StateAreas | null } | null>(null);
  useEffect(() => {
    if (!state) return undefined;
    let current = true;
    areasOf(state).then((data) => { if (current) setPlaces({ state, data }); }, () => { if (current) setPlaces({ state, data: null }); });
    return () => { current = false; };
  }, [state]);
  const [pinList, setPinList] = useState<{ key: string; list: PincodeList | null } | null>(null);
  const listKey = `${state}|${city}`;
  useEffect(() => {
    if (!state || !city) return undefined;
    let current = true;
    void pincodesOf(state, city).then((list) => { if (current) setPinList({ key: listKey, list }); }).catch(() => undefined);
    return () => { current = false; };
  }, [state, city, listKey]);

  const stateData = places?.state === state ? places.data : null;
  const areas = useMemo<AreaEntry[]>(() => stateData?.areas[city] ?? [], [stateData, city]);
  const names = pinList?.key === listKey ? pinList.list : null;
  const saved = useSavedDoc(geoDoc(districtKey(state, city)), parseGeo);
  const suggestions = useMemo(() => suggestedZones(stateData?.zones[city]), [stateData, city]);
  // A district whose zones were never saved offers the suggested ones.
  const geo = useMemo(() => (saved.loaded && !saved.exists ? { zones: suggestions, tamil: {} } : saved.value), [saved.loaded, saved.exists, saved.value, suggestions]);
  const zones = city ? geo.zones : [];
  const zonePins = zones.find((z) => z.id === zone)?.pins;
  const inZone = zonePins ? areas.filter((a) => zonePins.includes(a.pin)) : areas;
  const listed = pin ? inZone.filter((a) => a.pin === pin) : inZone;
  // A town with no village list (an older rule) still offers its PIN codes.
  const allPins = areas.length ? [...new Set(inZone.map((a) => a.pin))] : (names?.pins.map((p) => p.pin) ?? []).filter((p) => !zonePins || zonePins.includes(p));
  const pins = [...allPins].sort().map((p) => ({ pin: p, label: `${p} · ${names?.pins.find((x) => x.pin === p)?.name ?? ""}` }));

  const chosen = areaKey || pin;
  const targets = chosen ? [chosen] : zone ? [...(zonePins ?? [])].sort() : [""];
  return {
    geo, zones, areas, listed, pins, byDistrict: stateData?.areas ?? {},
    loading: !!state && places?.state !== state,
    targets,
    canAdd: targets.length > 0,
  };
}

export default function PlacePicker({ value, onChange, scope, stateOptions, citiesOf, statePlaceholder = "All locations", disabled }: {
  value: PlaceChoice;
  onChange: (next: PlaceChoice) => void;
  scope: ReturnType<typeof usePlaceScope>;
  stateOptions: { value: string; label: string }[];
  /** Places of a state that has no district list. */
  citiesOf: (state: string) => string[];
  statePlaceholder?: string;
  disabled?: boolean;
}) {
  const { state, city, zone, areaKey, pin } = value;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const districts = state ? DISTRICTS_BY_STATE[state] ?? citiesOf(state) : [];
  const { geo, zones, areas, listed, pins, byDistrict, loading } = scope;
  const chosenArea = areas.find((a) => a.key === areaKey);
  const matches = useMemo(() => (search.length < 3 ? [] : Object.entries(byDistrict)
    .flatMap(([name, list]) => list.filter((a) => a.pin.startsWith(search)).map((area) => ({ district: name, area })))
    .sort((a, b) => a.area.pin.localeCompare(b.area.pin) || a.area.name.localeCompare(b.area.name))), [search, byDistrict]);
  const shown = matches.slice(0, 200);
  const repeated = useMemo(() => { const seen = new Set<string>(), twice = new Set<string>(); for (const a of areas) (seen.has(a.name) ? twice : seen).add(a.name); return twice; }, [areas]);
  const areaLabel = (a: AreaEntry) => { const tamil = tamilNameOf(geo, a); return `${a.name}${tamil ? ` (${tamil})` : ""}${repeated.has(a.name) ? ` · ${a.pin}` : ""}`; };
  const pick = (m: (typeof matches)[number]) => { onChange({ state, city: m.district, zone: "", areaKey: m.area.key, pin: "" }); setSearch(""); setOpen(false); };
  const shownPin = chosenArea?.pin ?? (isVillage(areaKey) ? pinOfArea(areaKey) : pin);

  return (
    <div className="lf-root space-y-3">
      <div className="relative w-full lf-search">
        <div className="flex items-center h-9 px-3 rounded-xl border border-slate-200 bg-slate-50/70 focus-within:bg-white focus-within:border-[#991B1B] gap-2">
          <input type="text" inputMode="numeric" maxLength={6} value={search} disabled={disabled || !state} aria-label="Search PIN" placeholder={state ? "Search PIN..." : "Choose a state to search PIN"} className="lf-bare w-full font-semibold"
            onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
            onChange={(e) => { setSearch(e.target.value.replace(/\D/g, "").slice(0, 6)); setOpen(true); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) pick(matches[0]); } if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }} />
        </div>
        {open && search.length >= 3 && (
          <div className="absolute right-0 left-0 top-[calc(100%+6px)] z-30 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400">
              {matches.length ? `Matched Areas (${matches.length})${matches.length > shown.length ? " · type more digits" : ""}` : "No area with this PIN"}
            </div>
            <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {shown.map((m) => (
                <button key={`${m.district}:${m.area.key}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} className="w-full px-3 py-2 text-left hover:bg-red-50/40 flex items-center justify-between gap-2 text-xs">
                  <span>
                    <span className="block font-bold text-slate-900">{m.area.name}</span>
                    <span className="block text-[10px] text-slate-500">{m.district}</span>
                  </span>
                  <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{m.area.pin}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="lf-five">
        <label className="block"><span className="lf-label">State</span>
          <select className={selectClass} value={state} disabled={disabled} onChange={(e) => onChange({ ...emptyChoice, state: e.target.value })}>
            <option value="">{statePlaceholder}</option>
            {stateOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">District</span>
          <select className={selectClass} value={city} disabled={disabled || !state} onChange={(e) => onChange({ ...emptyChoice, state, city: e.target.value })}>
            <option value="">Whole state</option>
            {city && !districts.includes(city) ? <option value={city}>{city}</option> : null}
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">Service zone</span>
          <select className={selectClass} value={zone} disabled={disabled || !city} onChange={(e) => onChange({ ...value, zone: e.target.value, areaKey: "", pin: "" })}>
            <option value="">All zones ({zones.length})</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">Area / Village</span>
          <select className={selectClass} value={areaKey} disabled={disabled || !city || loading} onChange={(e) => onChange({ ...value, areaKey: e.target.value, pin: "" })}>
            <option value="">{loading ? "Loading areas…" : `All mapped areas (${listed.length})`}</option>
            {areaKey && !listed.some((a) => a.key === areaKey) ? <option value={areaKey}>{chosenArea ? areaLabel(chosenArea) : areaKey}</option> : null}
            {listed.map((a) => <option key={a.key} value={a.key}>{areaLabel(a)}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">PIN code</span>
          <select className={`${selectClass} font-mono`} value={shownPin} disabled={disabled || !city || loading} onChange={(e) => onChange({ ...value, pin: e.target.value, areaKey: "" })}>
            <option value="">All PIN codes ({pins.length})</option>
            {shownPin && !pins.some((p) => p.pin === shownPin) ? <option value={shownPin}>{shownPin}</option> : null}
            {pins.map((p) => <option key={p.pin} value={p.pin}>{p.label}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
