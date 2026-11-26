import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Save } from "lucide-react";
import { DISTRICTS_BY_STATE } from "../../domain/pincodeDistricts";
import { areasOf, pincodesOf, type AreaEntry, type PincodeList, type StateAreas } from "../../domain/pincodes";
import {
  defaultSettings, districtKey, faresDoc, geoDoc, isAreaKey, parseFares, parseGeo, parseSettings, pinOfArea, resolveCoverage, settingsDoc, settingsProblem, zoneOfPin,
  type BrandFares, type DistrictGeo, type FaresByBrand, type LocalBrand, type LocalClass, type LocalSettings, type Party, type Scope, type ServiceZone,
} from "../../domain/localPricing";
import { saveLocalFares, useSavedDoc } from "../../services/localFareService";
import { ActionError } from "../../services/callables";
import { useCan, useCanDo } from "../AccessContext";
import { editedLevels, faresProblem, sameData, suggestedZones, tamilNameOf, type EditContext } from "./model";
import { RentalTable, RideTable, type LocalVehicle } from "./RateTables";
import LocationBar, { type PinOption } from "./LocationBar";
import ZoneManager from "./ZoneManager";
import SharedSections, { type AreaOption } from "./SharedSections";
import TestQuote from "./TestQuote";
import { parseCommonNight, parsePlatformRules } from "./quotePreview";
import { saveTariffSection } from "../../services/bookingOpsService";
import { useTariff } from "../../services/tariffService";
import "./localFares.css";

export type LocalMode = "pickup_drop" | "hourly_rental";
export type { LocalVehicle } from "./RateTables";

const NO_AREAS: AreaEntry[] = [];
const BRAND_NAME: Record<LocalBrand, string> = { common: "All brands (shared)", nesam: "Nesam Cabs", people_taxi: "People Taxi", onewaycarrentals: "One Way Car Rentals" };
const PLACE_KEY = "nesam-local-fares-place";
function savedPlace(): { state: string; district: string } {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null") as { state?: string; district?: string } | null;
    if (p?.state && p.district && DISTRICTS_BY_STATE[p.state]?.includes(p.district)) return { state: p.state, district: p.district };
  } catch { /* no saved choice */ }
  return { state: "33", district: "Theni" };
}
interface Draft<T> { key: string; value: T; base: number }

/**
 * Local fares of one district: Pickup & Drop rates and 1–15 hour rental packages with district → zone → area inheritance, the
 * brand's peak / toll / night / GST settings, a live test quote and one save with a reason.
 */
export default function LocalPricingManager({ brand, mode, vehicles, onModeChange, onDirtyChange, onBusyChange }: {
  brand: LocalBrand; mode: LocalMode; vehicles: LocalVehicle[];
  onModeChange: (mode: LocalMode) => void;
  onDirtyChange: (dirty: boolean) => void; onBusyChange: (busy: boolean) => void;
}) {
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const allowed = pricingAccess && settingsEdit;
  const [place, setPlace] = useState(savedPlace);
  const { state, district } = place;
  const key = districtKey(state, district);
  const [zoneId, setZoneId] = useState("");
  const [areaKey, setAreaKey] = useState("");
  const [pinFilter, setPinFilter] = useState("");
  const [tab, setTab] = useState<Scope>("district");
  const [party, setParty] = useState<Party>("customer");
  const [picked, setPicked] = useState<LocalClass>("sedan");
  const [hours, setHours] = useState(4);
  const [testArea, setTestArea] = useState("");
  const cls: LocalClass = vehicles.some((v) => v.cls === picked) ? picked : vehicles[0]?.cls ?? "sedan";
  const vehicle = vehicles.find((v) => v.cls === cls) ?? { cls, name: "Sedan", subtitle: "" };

  // ── Places: every village / post office of the state, and the district's PIN codes ──
  const [places, setPlaces] = useState<{ state: string; data: StateAreas } | null>(null);
  const [placesError, setPlacesError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setPlacesError(false);
    areasOf(state).then((data) => { if (current) setPlaces({ state, data }); }, () => { if (current) setPlacesError(true); });
    return () => { current = false; };
  }, [state, attempt]);
  const stateData = places?.state === state ? places.data : null;
  const areas: AreaEntry[] = stateData?.areas[district] ?? NO_AREAS;
  const [pinList, setPinList] = useState<{ key: string; list: PincodeList | null } | null>(null);
  useEffect(() => {
    let current = true;
    void pincodesOf(state, district).then((list) => { if (current) setPinList({ key, list }); }).catch(() => undefined);
    return () => { current = false; };
  }, [state, district, key, attempt]);
  const pincodes: PincodeList = (pinList?.key === key ? pinList.list : null) ?? { city: district, pins: [] };
  const suggestions = useMemo(() => suggestedZones(stateData?.zones[district]), [stateData, district]);

  // ── Saved documents ──
  const geoSaved = useSavedDoc(geoDoc(key), parseGeo);
  const sharedSaved = useSavedDoc(faresDoc(key, "common"), parseFares);
  const brandSaved = useSavedDoc(faresDoc(key, brand), parseFares);
  const ownSettings = useSavedDoc(settingsDoc(brand), parseSettings);
  const sharedSettings = useSavedDoc(settingsDoc("common"), parseSettings);
  const platform = useSavedDoc("business_config/platform_fee", parsePlatformRules);
  const night = useSavedDoc("business_config/night_allowance", parseCommonNight);
  const docs = [geoSaved, sharedSaved, brandSaved, ownSettings, sharedSettings];
  const loadError = docs.find((d) => d.error)?.error ?? null;
  const loaded = docs.every((d) => d.loaded) && !loadError && !!stateData;
  const { tariff } = useTariff();

  // ── Drafts: what is typed but not saved ──
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const faresKey = `${key}|${brand}`;
  const [faresDraft, setFaresDraft] = useState<Draft<BrandFares> | null>(null);
  const [geoDraft, setGeoDraft] = useState<Draft<DistrictGeo> | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<Draft<LocalSettings | null> | null>(null);
  const [strikeDraft, setStrikeDraft] = useState<{ key: string; value: string } | null>(null);
  const myFaresDraft = faresDraft?.key === faresKey ? faresDraft : null;
  const myGeoDraft = geoDraft?.key === key ? geoDraft : null;
  const mySettingsDraft = settingsDraft?.key === brand ? settingsDraft : null;
  // A change of brand has already been confirmed by the page: what was typed for the other brand is dropped.
  const shownBrand = useRef(brand);
  useEffect(() => {
    if (shownBrand.current === brand) return;
    shownBrand.current = brand;
    setFaresDraft(null); setGeoDraft(null); setSettingsDraft(null); setStrikeDraft(null); setBanner(null);
  }, [brand]);

  // A district whose zones were never saved offers the suggested ones.
  const usingSuggested = geoSaved.loaded && !geoSaved.exists;
  const geoBase: DistrictGeo = usingSuggested ? { zones: suggestions, tamil: {} } : geoSaved.value;
  const geo = myGeoDraft?.value ?? geoBase;
  const mine = myFaresDraft?.value ?? brandSaved.value;
  const all: FaresByBrand = brand === "common" ? { common: mine } : { common: sharedSaved.value, [brand]: mine };
  const inheritedSettings = sharedSettings.exists ? sharedSettings.value : defaultSettings();
  const savedSettings = ownSettings.exists ? ownSettings.value : inheritedSettings;
  const settings = mySettingsDraft ? mySettingsDraft.value ?? inheritedSettings : savedSettings;
  const faresDirty = !!myFaresDraft && !sameData(myFaresDraft.value, brandSaved.value);
  const geoDirty = !!myGeoDraft && !sameData(myGeoDraft.value, geoBase);
  const settingsDirty = !!mySettingsDraft && (mySettingsDraft.value === null ? ownSettings.exists : !sameData(mySettingsDraft.value, savedSettings));
  // The strike-out price of a rental is kept with the rate card (it never changes what is charged).
  const savedStrike = tariff?.displayMarkup?.[brand]?.["Local Rental"];
  const strikeValue = strikeDraft?.key === brand ? strikeDraft.value : savedStrike ? String(savedStrike) : "";
  const strikeDirty = strikeDraft?.key === brand && (Number(strikeValue) || 0) !== (savedStrike ?? 0);
  const dirty = faresDirty || geoDirty || settingsDirty || strikeDirty;
  const stale = (faresDirty && myFaresDraft!.base !== brandSaved.version) || (geoDirty && myGeoDraft!.base !== geoSaved.version) || (settingsDirty && mySettingsDraft!.base !== ownSettings.version);

  const canEdit = allowed && loaded && !busy;
  useEffect(() => { onDirtyChange(dirty); onBusyChange(busy); }, [dirty, busy, onDirtyChange, onBusyChange]);
  const leaving = useRef({ onDirtyChange, onBusyChange });
  leaving.current = { onDirtyChange, onBusyChange };
  useEffect(() => () => { leaving.current.onDirtyChange(false); leaving.current.onBusyChange(false); }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!banner?.ok) return undefined;
    const timer = window.setTimeout(() => setBanner(null), 5000);
    return () => window.clearTimeout(timer);
  }, [banner]);

  const setMine = (value: BrandFares) => { setBanner(null); setFaresDraft((d) => ({ key: faresKey, value, base: d?.key === faresKey ? d.base : brandSaved.version })); };
  const setGeo = (value: DistrictGeo) => { setBanner(null); setGeoDraft((d) => ({ key, value, base: d?.key === key ? d.base : geoSaved.version })); };
  const setSettings = (value: LocalSettings | null) => { setBanner(null); setSettingsDraft((d) => ({ key: brand, value, base: d?.key === brand ? d.base : ownSettings.version })); };
  const setZones = (zones: ServiceZone[]) => {
    setGeo({ ...geo, zones });
    // A removed zone takes its rates with it.
    const gone = Object.keys(mine.zones).filter((id) => !zones.some((z) => z.id === id));
    if (gone.length) setMine({ ...mine, zones: Object.fromEntries(Object.entries(mine.zones).filter(([id]) => !gone.includes(id))) });
  };

  /** Moves to another district, asking first when rates typed for this one are not saved. */
  const goTo = (next: { state: string; district: string }, pin = "") => {
    if (busy) return false;
    if (next.state !== state || next.district !== district) {
      if ((faresDirty || geoDirty) && !window.confirm(`Discard the unsaved rates of ${district} district?`)) return false;
      setFaresDraft(null); setGeoDraft(null); setPlace(next); setZoneId(""); setBanner(null);
      try { localStorage.setItem(PLACE_KEY, JSON.stringify(next)); } catch { /* the choice is simply not remembered */ }
    }
    setAreaKey(pin);
    setPinFilter("");
    setTestArea(pin);
    return true;
  };

  // ── What is chosen: zone → PIN code → area ──
  const chosenZone = geo.zones.some((z) => z.id === zoneId) ? zoneId : "";
  const chosenArea = areas.find((a) => a.key === areaKey);
  const zoneOfChoice = chosenArea || pinFilter ? zoneOfPin(geo, chosenArea?.pin ?? pinFilter)?.id ?? "" : "";
  // The zone tab opens on the zone of the chosen area.
  const shownZone = chosenZone || (tab === "zone" ? zoneOfChoice : "");
  const zonePins = geo.zones.find((z) => z.id === shownZone)?.pins;
  const inZone = useMemo(() => (zonePins ? areas.filter((a) => zonePins.includes(a.pin)) : areas), [areas, zonePins]);
  const filter = inZone.some((a) => a.pin === pinFilter) ? pinFilter : "";
  const listed = filter ? inZone.filter((a) => a.pin === filter) : inZone;
  const area = listed.find((a) => a.key === areaKey);
  const pinNames = useMemo(() => new Map(pincodes.pins.map((x) => [x.pin, x.name])), [pincodes]);
  const pinOptions: PinOption[] = useMemo(() => [...new Set(inZone.map((a) => a.pin))].sort().map((pin) => ({ pin, label: `${pin} · ${pinNames.get(pin) ?? ""}` })), [inZone, pinNames]);
  // A name used under two PIN codes is told apart by its PIN.
  const repeated = useMemo(() => { const seen = new Set<string>(), twice = new Set<string>(); for (const a of areas) (seen.has(a.name) ? twice : seen).add(a.name); return twice; }, [areas]);
  const areaLabel = (a: AreaEntry) => { const tamil = tamilNameOf(geo, a); return `${a.name}${tamil ? ` (${tamil})` : ""}${repeated.has(a.name) ? ` · ${a.pin}` : ""}`; };
  /** How a saved area rate is named: the village, or all areas of a PIN code. */
  const areaTitle = (id: string) => { const found = areas.find((a) => a.key === id); return found ? `${found.name} · ${found.pin}` : id.includes("~") ? id : `All areas of ${pinOfArea(id)}`; };

  const context: EditContext = { all, mine, brand, geo };
  const areaLevel = area?.key ?? filter;
  const levels = editedLevels(tab, geo, shownZone, areaLevel);
  const savedAreas = Object.keys(mine.areas).filter(isAreaKey).sort();
  const tollPins: AreaOption[] = useMemo(() => [...new Set(areas.map((a) => a.pin))].sort().map((pin) => ({ pin, label: `${pinNames.get(pin) ?? ""} · ${pin}` })), [areas, pinNames]);
  const vehicleName = (c: LocalClass) => vehicles.find((v) => v.cls === c)?.name ?? c;
  const openArea = (id: string) => {
    setZoneId("");
    if (id.includes("~")) { setPinFilter(""); setAreaKey(id); setTestArea(id); }
    else { setAreaKey(""); setPinFilter(id); }
  };

  const discard = () => { setFaresDraft(null); setGeoDraft(null); setSettingsDraft(null); setStrikeDraft(null); setBanner(null); };

  const save = async () => {
    if (!allowed || busy) return;
    const fail = (text: string) => setBanner({ ok: false, text });
    if (!loaded) return fail("The saved fares are still loading.");
    if (!dirty) return fail("Nothing has changed yet.");
    if (stale) return fail("Someone else saved changes while you were editing. Discard yours to load theirs.");
    if (geoDirty) {
      const names = geo.zones.map((z) => z.name.trim().toLowerCase());
      if (names.some((n) => !n)) return fail("Name every zone.");
      if (new Set(names).size !== names.length) return fail("Two zones have the same name.");
      const empty = geo.zones.find((z) => !z.pins.length);
      if (empty) return fail(`${empty.name}: choose at least one pincode, or remove the zone.`);
    }
    if (faresDirty) {
      const problem = faresProblem(mine, { district, zone: (id) => geo.zones.find((z) => z.id === id)?.name ?? "Zone", vehicle: vehicleName, area: areaTitle });
      if (problem) return fail(problem);
    }
    if (settingsDirty && mySettingsDraft!.value) {
      const problem = settingsProblem(mySettingsDraft!.value);
      if (problem) return fail(problem);
    }
    const strike = strikeValue.trim() === "" ? null : Number(strikeValue);
    if (strikeDirty && strike !== null && (!Number.isFinite(strike) || strike < 0 || strike > 300)) return fail("The strike-out price must be from 0 to 300%.");
    if (reason.trim().length < 5) return fail("Please enter a short Reason for change (at least 5 characters) before saving fare rules.");
    // A rate for a zone that is only suggested saves the zones with it.
    const saveZones = geoDirty || (faresDirty && Object.keys(mine.zones).some((id) => !geoSaved.value.zones.some((z) => z.id === id)));
    setBusy(true);
    setBanner(null);
    try {
      if (faresDirty || saveZones || settingsDirty) {
        await saveLocalFares({
          brand, state, district, reason: reason.trim(),
          ...(faresDirty ? { fares: { data: mine, expectedVersion: myFaresDraft!.base } } : {}),
          ...(saveZones ? { geo: { data: geo, expectedVersion: myGeoDraft?.base ?? geoSaved.version } } : {}),
          ...(settingsDirty ? { settings: { data: mySettingsDraft!.value, expectedVersion: mySettingsDraft!.base } } : {}),
        });
        setFaresDraft(null); setGeoDraft(null); setSettingsDraft(null);
      }
      if (strikeDirty) await saveTariffSection({ section: "displayMarkup", expectedVersion: tariff?.version ?? 0, reason: reason.trim(), brand, service: "Local Rental", data: { percent: strike || null } });
      discard();
      setReason("");
      setBanner({ ok: true, text: `Saved ${mode === "pickup_drop" ? "Local Pickup & Drop" : "Hourly Rental (1–15h)"} rules for ${district}. Confirmed bookings keep their saved fares.` });
    } catch (err) {
      fail(err instanceof ActionError ? err.message : "The fare rules were not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const hasOwnSettings = brand !== "common" && (mySettingsDraft ? mySettingsDraft.value !== null : ownSettings.exists);
  const tabs: { id: Scope; label: string }[] = [{ id: "district", label: "District default" }, { id: "zone", label: "Zone overrides" }, { id: "area", label: "Area overrides" }];
  /** What typing changes, when it is not simply the district. */
  const editing = tab === "zone" ? (levels.length > 1 ? `All ${levels.length} zones` : geo.zones.find((z) => z.id === shownZone)?.name ?? "")
    : tab === "area" && areaLevel ? areaTitle(areaLevel) : "";
  const ride = mode === "pickup_drop";

  return (
    <div className="lf-root space-y-4 text-slate-900">
      {loadError && <p className="ds-error" role="alert"><CircleAlert className="w-4 h-4" /> Saved fares could not be loaded: {loadError}. Check your pricing access and reload.</p>}
      {placesError && (
        <p className="ds-error" role="alert"><CircleAlert className="w-4 h-4" /> The area list could not be loaded.
          <button type="button" className="font-bold underline ml-1" onClick={() => setAttempt((n) => n + 1)}>Try again</button></p>
      )}
      {!allowed && <p className="text-xs text-slate-500">View only: changing fares needs pricing access.</p>}
      {stale && (
        <p className="ds-error" role="alert"><CircleAlert className="w-4 h-4" /> Someone else saved changes while you were editing.
          <button type="button" className="font-bold underline ml-1" onClick={discard}>Discard mine and load theirs</button></p>
      )}

      <LocationBar state={state} district={district} zoneId={shownZone} areaKey={area?.key ?? ""} pin={area?.pin ?? filter} geo={geo} byDistrict={stateData?.areas ?? {}} listed={listed} pins={pinOptions}
        areaLabel={areaLabel} loading={!stateData && !placesError} coverage={resolveCoverage(all, brand)} canEdit={canEdit}
        lead={(
          <div className="inline-flex self-start p-1 rounded-xl bg-slate-100 border border-slate-200" role="group" aria-label="Local service">
            {([["pickup_drop", "Local Pickup & Drop"], ["hourly_rental", "Hourly Rental (1–15h)"]] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={mode === id} disabled={busy} onClick={() => onModeChange(id)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${mode === id ? "bg-white text-[#991B1B] shadow-2xs" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
            ))}
          </div>
        )}
        onState={(code) => goTo({ state: code, district: code === "33" ? "Theni" : DISTRICTS_BY_STATE[code]![0]! })}
        onDistrict={(name) => goTo({ state, district: name })}
        onZone={(id) => { setZoneId(id); setAreaKey(""); setPinFilter(""); }}
        onArea={(next) => { setAreaKey(next); if (next) setTestArea(next); }}
        onPin={(next) => { setPinFilter(next); setAreaKey(""); }}
        onFound={(name, found) => { if (goTo({ state, district: name }, found)) setZoneId(""); }}
        onCoverage={(k, on) => {
          // Switching back to what is inherited removes the choice, so nothing is left to save.
          const inherited = brand === "common" ? true : sharedSaved.value.coverage?.[k] ?? true;
          const coverage = { ...mine.coverage, [k]: on };
          if (on === inherited && brandSaved.value.coverage?.[k] === undefined) delete coverage[k];
          const next = { ...mine, coverage };
          if (!Object.keys(coverage).length) delete (next as BrandFares).coverage;
          setMine(next);
        }} />

      <div className="lf-main">
        <div className="space-y-4 min-w-0">
          <section className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden" aria-label={ride ? "Pickup and Drop rates" : "Hourly rental packages"}>
            <div className="px-5 pt-3 border-b border-slate-200 bg-slate-50/60 flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Rate level">
              {tabs.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                  className={`px-4 py-2 rounded-t-xl text-xs font-bold transition-all ${tab === t.id ? "bg-[#991B1B] text-white shadow-2xs" : "text-slate-600 hover:text-slate-900 hover:bg-white/70"}`}>{t.label}</button>
              ))}
            </div>

            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-900" aria-live="polite">{!loaded && !loadError && !placesError ? <span className="text-slate-400 font-semibold">Loading saved fares…</span> : editing}</h3>
                {ride ? (
                  <div className="inline-flex p-1 rounded-xl bg-slate-100 border border-slate-200/80 ml-auto" role="group" aria-label="Fare side">
                    {([["customer", "Customer fare"], ["partner", "Partner payout"]] as const).map(([id, label]) => (
                      <button key={id} type="button" aria-pressed={party === id} onClick={() => setParty(id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${party === id ? "bg-white text-[#991B1B] shadow-2xs" : "text-slate-600 hover:text-slate-900"}`}>{label}</button>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap ml-auto" role="group" aria-label="Vehicle">
                    {vehicles.map((v) => (
                      <button key={v.cls} type="button" aria-pressed={cls === v.cls} onClick={() => setPicked(v.cls)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${cls === v.cls ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200/70"}`}>{v.name}</button>
                    ))}
                  </div>
                )}
              </div>

              {tab === "zone" && <ZoneManager list={pincodes} geo={geo} zoneId={shownZone} canEdit={canEdit} suggested={usingSuggested && !geoDirty && geo.zones.length > 0}
                onChange={setZones} onSelect={(id) => { setZoneId(id); setAreaKey(""); setPinFilter(""); }} />}
              {tab === "area" && savedAreas.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Areas with their own rates">
                  {savedAreas.map((id) => (
                    <button key={id} type="button" aria-pressed={areaLevel === id} onClick={() => openArea(id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${areaLevel === id ? "bg-purple-600 text-white border-purple-600" : "bg-purple-50 text-purple-800 border-purple-200"}`}>{areaTitle(id)}</button>
                  ))}
                </div>
              )}

              {!levels.length ? (
                <p className="py-6 text-center text-xs text-slate-500">{tab === "zone" ? "Add a zone to give it its own rates." : "Choose an Area / Village or a PIN code above."}</p>
              ) : ride ? (
                <RideTable context={context} vehicles={vehicles} levels={levels} party={party} tab={tab} canEdit={canEdit} selected={cls} onSelect={setPicked} onChange={setMine} />
              ) : (
                <RentalTable context={context} vehicle={vehicle} levels={levels} tab={tab} canEdit={canEdit} selectedHours={hours} onSelectHours={setHours} onChange={setMine} />
              )}
            </div>
          </section>

          <SharedSections settings={settings} canEdit={canEdit} areas={tollPins} onChange={setSettings}
            onUseShared={hasOwnSettings ? () => setSettings(null) : undefined}
            strike={ride ? undefined : { value: strikeValue, inherited: brand === "common" ? undefined : tariff?.displayMarkup?.common?.["Local Rental"], onChange: (value) => { setBanner(null); setStrikeDraft({ key: brand, value }); } }} />
        </div>

        <TestQuote service={ride ? "ride" : "rental"} district={district} fares={all} brand={brand} geo={geo} settings={settings} areas={areas} areaLabel={areaLabel} vehicles={vehicles}
          cls={cls} areaKey={testArea} hours={hours} platform={platform.value} night={night.value} unsaved={dirty} onCls={setPicked} onArea={setTestArea} onHours={setHours} />
      </div>

      <footer className="lf-footer bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl px-4 sm:px-5 py-3 shadow-lg">
        {banner && (
          <div role={banner.ok ? "status" : "alert"} className={`mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${banner.ok ? "bg-slate-900 text-white" : "bg-red-50 text-[#991B1B] border border-red-200"}`}>
            {banner.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <CircleAlert className="w-4 h-4 shrink-0" />}
            <span>{banner.text}</span>
          </div>
        )}
        <div className="lf-between gap-3">
          <div className="text-xs">
            <p className="font-bold text-slate-900">{BRAND_NAME[brand]} · {ride ? "Pickup & Drop" : "Hourly Rental"} · {district}</p>
            {dirty && <p className="text-[11px] font-semibold text-amber-700">Unsaved changes</p>}
          </div>
          <div className="flex items-center gap-2.5 flex-1 justify-end flex-wrap lf-save">
            <input type="text" maxLength={300} aria-label="Reason for change" value={reason} disabled={!canEdit} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} placeholder="Reason for change" className="lf-text flex-1 min-w-44 h-9" />
            {dirty && <button type="button" onClick={() => { if (window.confirm("Discard all unsaved changes?")) discard(); }} disabled={busy} className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 shrink-0">Discard</button>}
            <button type="button" onClick={() => void save()} disabled={!allowed || busy} className="h-9 px-4 rounded-xl bg-[#991B1B] hover:bg-[#7F1D1D] disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors">
              <Save className="w-3.5 h-3.5" /><span>{busy ? "Saving…" : "Save fare rules"}</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
