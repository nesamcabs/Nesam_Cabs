import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { MasterLocation } from "../types";
import { subscribeLocations } from "../services/adminFirestoreService";
import { saveTariffSection } from "../services/bookingOpsService";
import { saveLocation, deriveLocationCode, type LocationForm } from "../services/locationService";
import { auth } from "../services/firebase";
import { CITIES_BY_STATE, directoryZones } from "../domain/placeDirectory";
import { GST_STATES } from "../domain/gstStates";
import { ActionError } from "../services/callables";
import {
  CLASS_LABEL, RENTAL_HOURS, TARIFF_CLASSES, inr, rentalMinHours, useTariff, validLocalFare, validPackage,
  type LocalFare, type RentalPackage, type TariffClass,
} from "../services/tariffService";
import { useCan } from "./AccessContext";
import { Modal } from "./Feedback";
import ZonePincodes from "./ZonePincodes";
import { Badge, Button, DataTable, EmptyState, Icon, toneForStatus } from "./ui";
import { StageBar } from "./ui/ListKit";
import { CardBody, Problems, RateTable, SaveBar, SettingCard, vehicleColumns, type VehicleCol } from "./RateTable";

type Tab = "Rental packages" | "Pickup & Drop";
const TABS: Tab[] = ["Rental packages", "Pickup & Drop"];

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const lc = (s?: string) => (s ?? "").trim().toLowerCase();
const text = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Local fares: fixed Rental packages by vehicle category and hours, and the Pickup & Drop fare of each city. */
/** `only` shows a single section without the tab bar (rental packages are now edited in Brand & service fares). */
export default function LocalFares({ initialTab = "Rental packages", initialCity = "", onToast, only, vehicles }: { initialTab?: Tab; initialCity?: string; onToast: (t: string) => void; only?: Tab; vehicles?: VehicleCol[] }) {
  const { tariff, error } = useTariff();
  const canEdit = useCan("pricing");
  const [tab, setTab] = useState<Tab>(only ?? initialTab);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [cityId, setCityId] = useState("");
  // Pickup & Drop: State, District, City, then the whole city or one of its zones.
  const [stateSel, setStateSel] = useState("");
  const [districtSel, setDistrictSel] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [edit, setEdit] = useState<
    | { kind: "package"; cls: TariffClass; hours: number }
    | { kind: "minimum"; cls: TariffClass }
    | null
  >(null);
  useEffect(() => subscribeLocations(setLocations), []);

  // Cities come from the location master; the record id is the canonical identity of a city.
  const cities = useMemo(() => locations.filter((l) => l.type === "City" && l.status === "Active").sort((a, b) => (a.name || a.city).localeCompare(b.name || b.city)), [locations]);
  useEffect(() => {
    if (cityId || !cities.length) return;
    const match = initialCity ? cities.filter((c) => c.city === initialCity || c.name === initialCity) : [];
    if (match.length === 1) setCityId(match[0].id);
  }, [cities, cityId, initialCity]);
  // Built-in cities that are not in the location master yet: choosing one adds it to Locations as an active City.
  const builtIn = useMemo(() => {
    const have = new Set(cities.map((c) => `${(c.name || c.city).trim().toLowerCase()}|${(c.state || "").trim().toLowerCase()}`));
    const out: { key: string; name: string; state: string }[] = [];
    for (const [code, names] of Object.entries(CITIES_BY_STATE)) {
      const state = GST_STATES.find(([c]) => c === code)?.[1] ?? code;
      for (const name of names) if (!have.has(`${name.toLowerCase()}|${state.toLowerCase()}`) && !cities.some((c) => (c.name || c.city).trim().toLowerCase() === name.toLowerCase())) out.push({ key: `new:${code}:${name}`, name, state });
    }
    return out;
  }, [cities]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [pendingName, setPendingName] = useState("");
  // When the new City record arrives from the location master, select it.
  useEffect(() => {
    if (!pendingName) return;
    const found = cities.find((c) => (c.name || c.city).trim().toLowerCase() === pendingName.toLowerCase());
    if (found) { setCityId(found.id); setPendingName(""); }
  }, [cities, pendingName]);
  const pickCity = async (value: string) => {
    setAddError("");
    if (!value.startsWith("new:")) return setCityId(value);
    const entry = builtIn.find((b) => b.key === value);
    if (!entry || adding) return;
    setAdding(true);
    const form: LocationForm = {
      name: entry.name, code: deriveLocationCode(entry.name), type: "City", state: entry.state, district: "", city: entry.name, area: "", pincode: "", address: "",
      parentLocationId: "", lat: "", lng: "", placeId: "", pickupEnabled: true, dropEnabled: true, onlineBookingEnabled: true, adminBookingEnabled: true,
      serviceIds: [], status: "Active", displayOrder: locations.length + 1,
    };
    try {
      await saveLocation(form, null, locations, auth.currentUser?.uid || "");
      setPendingName(entry.name);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "The city could not be added to Locations.");
    } finally {
      setAdding(false);
    }
  };
  const city = cities.find((c) => c.id === cityId);
  // A city chosen elsewhere (or added from the built-in list) also sets its state and district.
  useEffect(() => {
    if (!city) return;
    setStateSel((s) => s || city.state || "");
    setDistrictSel((d) => (d && lc(d) === lc(city.district) ? d : city.district || ""));
  }, [city]);
  const states = useMemo(() => {
    const names = new Set(cities.map((c) => c.state).filter(Boolean));
    if (canEdit) for (const b of builtIn) names.add(b.state);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [cities, builtIn, canEdit]);
  const inState = cities.filter((c) => !stateSel || lc(c.state) === lc(stateSel));
  const districts = [...new Set(inState.map((c) => c.district?.trim()).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b));
  const cityChoices = inState.filter((c) => !districtSel || lc(c.district) === lc(districtSel));
  const builtInChoices = canEdit && !districtSel ? builtIn.filter((b) => !stateSel || lc(b.state) === lc(stateSel)) : [];
  // The city's zones: active "Area / Locality" records whose parent is the city (or, with no parent, the same city name and state).
  const cityName = city ? city.name || city.city : "";
  const zones = useMemo(() => !city ? [] : locations
    .filter((l) => l.type === "Area / Locality" && l.status === "Active" && (l.parentLocationId === city.id || (!l.parentLocationId && lc(l.city) === lc(city.city || city.name) && (!l.state || !city.state || lc(l.state) === lc(city.state)))))
    .sort((a, b) => (a.name || a.area || "").localeCompare(b.name || b.area || "")), [locations, city]);
  const zone = zones.find((z) => z.id === zoneId);
  const builtInZones = city && canEdit ? directoryZones(cityName).filter((z) => !zones.some((m) => lc(m.name || m.area) === lc(z))) : [];
  const [pendingZone, setPendingZone] = useState("");
  useEffect(() => {
    if (!pendingZone) return;
    const found = zones.find((z) => lc(z.name || z.area) === lc(pendingZone));
    if (found) { setZoneId(found.id); setPendingZone(""); }
  }, [zones, pendingZone]);
  const addZone = async (name: string, pincodes?: string[]) => {
    if (!city || !name || adding) return;
    setAddError("");
    setAdding(true);
    const form: LocationForm = {
      name, code: deriveLocationCode(`${cityName} ${name}`), type: "Area / Locality", state: city.state, district: city.district ?? "", city: city.city || cityName, area: name, pincode: "", address: "",
      parentLocationId: city.id, lat: "", lng: "", placeId: "", pickupEnabled: true, dropEnabled: true, onlineBookingEnabled: true, adminBookingEnabled: true,
      serviceIds: [], status: "Active", displayOrder: locations.length + 1, ...(pincodes?.length ? { pincodes, pincode: [...pincodes].sort()[0] } : {}),
    };
    try {
      await saveLocation(form, null, locations, auth.currentUser?.uid || "");
      setPendingZone(name);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "The zone could not be added to Locations.");
      throw err;
    } finally {
      setAdding(false);
    }
  };
  const zoneHasOwn = (id: string) => Object.values(tariff?.localPickupDrop?.[id]?.classes ?? {}).some((f) => validLocalFare(f) && f?.enabled);
  const version = tariff?.version ?? 0;
  const ready = tariff !== undefined && !error;
  const done = (t: string) => { setEdit(null); onToast(t); };

  return (
    <div className="grid gap-4">
      <p className="text-[12px] text-muted">Fixed local fares. Rental packages and Pickup &amp; Drop are priced separately from each other and from Outstation. A new fare changes new quotes only; confirmed bookings keep their fare.</p>
      {!only && <StageBar label="Local fares" tabs={TABS.map((t) => ({ id: t, label: t }))} value={tab} onChange={setTab} />}
      {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />Saved fares could not be loaded: {error}. Check your pricing access and reload.</div>}
      {tariff === undefined && !error && <p className="text-[12px] text-muted" role="status">Loading saved fares…</p>}
      {!canEdit && ready && <p className="text-[12px] text-muted">You can view these fares. Changing them needs pricing access.</p>}

      {ready && tab === "Rental packages" && (
        <section aria-labelledby="rental-h">
          <h3 id="rental-h" className="text-[15px] font-bold text-ink">Rental packages</h3>
          <p className="text-[12px] text-muted mb-3">Customer fare, partner payout, covered kilometres and extra usage for each package. A package shorter than the category minimum cannot be quoted.</p>
          <DataTable label="Rental packages by vehicle category and hours" minWidth={1020} hideTools>
            <thead><tr><th>VEHICLE CATEGORY</th>{RENTAL_HOURS.map((h) => <th key={h}>{h} HOURS</th>)}</tr></thead>
            <tbody>{TARIFF_CLASSES.map((cls) => {
              const min = rentalMinHours(tariff, cls);
              return (
                <tr key={cls}>
                  <td>
                    <strong>{CLASS_LABEL[cls]}</strong>
                    <small>1 to 15 hours</small>
                  </td>
                  {RENTAL_HOURS.map((h) => {
                    const raw = tariff?.rentalPackages?.[cls]?.packages?.[String(h)];
                    const pkg = validPackage(raw) ? raw : null;
                    if (h < min) return <td key={h}><span className="text-muted">Not available</span>{pkg && <small>Saved package kept; below the {min}-hour minimum</small>}</td>;
                    if (!pkg) return <td key={h}><span className="text-muted">Not configured</span>{canEdit && <Button size="sm" onClick={() => setEdit({ kind: "package", cls, hours: h })}>Set rate</Button>}</td>;
                    return (
                      <td key={h}>
                        <strong>{inr(pkg.customerFare)}</strong>
                        <small>Partner {inr(pkg.partnerPayout)} · {pkg.includedKm} km</small>
                        <small>{pkg.gstMode === "included" ? "GST included" : "GST added"} · {inr(pkg.extraKmRate)}/km · {inr(pkg.extraHourRate)}/hour extra</small>
                        <Badge tone={toneForStatus(pkg.enabled ? "Enabled" : "Disabled")}>{pkg.enabled ? "Enabled" : "Disabled"}</Badge>
                        {canEdit && <Button size="sm" onClick={() => setEdit({ kind: "package", cls, hours: h })}>Edit</Button>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}</tbody>
          </DataTable>
          <p className="text-[11px] text-faint mt-3">A rental is quoted at the saved package only when its hours are chosen on the booking; extra hours are recorded on the quote and billed at actuals.</p>
        </section>
      )}

      {ready && tab === "Pickup & Drop" && (
        <section aria-label="Local Pickup and Drop" className="space-y-4">
          <SettingCard title="Local Pickup & Drop"
            description="Choose a city, then set the rates for the whole city or for one of its zones. Zone rates are used for trips that start in that zone and stay in the city; a vehicle without zone rates uses the city rates.">
            <CardBody>
              <div className="fm-place-picker">
                <label className="fm-mini"><span>State</span>
                  <select className="ds-select" value={stateSel} onChange={(e) => { setStateSel(e.target.value); setDistrictSel(""); setCityId(""); setZoneId(""); }}>
                    <option value="">All states</option>
                    {states.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </label>
                <label className="fm-mini"><span>District</span>
                  <select className="ds-select" value={districtSel} disabled={!districts.length} onChange={(e) => { setDistrictSel(e.target.value); setCityId(""); setZoneId(""); }}>
                    <option value="">{districts.length ? "All districts" : "No districts saved"}</option>
                    {districts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </label>
                <label className="fm-mini"><span>City</span>
                  <select className="ds-select" value={cityId} disabled={adding} onChange={(e) => { setZoneId(""); void pickCity(e.target.value); }}>
                    <option value="">{adding ? "Adding..." : cityChoices.length || builtInChoices.length ? "Choose a city" : "No cities here"}</option>
                    {cityChoices.length > 0 && <optgroup label="In Locations">{cityChoices.map((c) => <option key={c.id} value={c.id}>{c.name || c.city}{!stateSel && c.state ? ` · ${c.state}` : ""}</option>)}</optgroup>}
                    {builtInChoices.length > 0 && <optgroup label="Add from the built-in list">{builtInChoices.map((b) => <option key={b.key} value={b.key}>{b.name}{!stateSel ? ` · ${b.state}` : ""}</option>)}</optgroup>}
                  </select>
                </label>
              </div>
              {addError && <p className="ds-error mt-2" role="alert">{addError}</p>}
            </CardBody>
            {city && (
              <CardBody className="fm-body--inline">
                <div className="fm-seg" role="tablist" aria-label={`Zones of ${cityName}`}>
                  <button type="button" role="tab" aria-selected={!zoneId} className={!zoneId ? "is-on" : ""} onClick={() => setZoneId("")}>Whole city</button>
                  {zones.map((z) => (
                    <button key={z.id} type="button" role="tab" aria-selected={zoneId === z.id} className={zoneId === z.id ? "is-on" : ""} onClick={() => setZoneId(z.id)}>
                      {z.name || z.area}{zoneHasOwn(z.id) ? <span className="fm-seg__dot" title="Has its own rates" /> : null}
                    </button>
                  ))}
                </div>
                {builtInZones.length > 0 && (
                  <label className="fm-inline-field">
                    <span>Add a zone</span>
                    <select className="ds-select" value="" disabled={adding} onChange={(e) => void addZone(e.target.value).catch(() => undefined)}>
                      <option value="">{adding ? "Adding..." : "Choose a zone"}</option>
                      {builtInZones.map((z) => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </label>
                )}
                {!zones.length && !builtInZones.length ? <span className="fm-hint">No zones for {cityName} yet. Add one below with its pincodes, or add areas of this city in Locations.</span> : null}
              </CardBody>
            )}
            {city && (
              <CardBody>
                <ZonePincodes key={zone?.id ?? city.id} city={city} zone={zone} zones={zones} canEdit={canEdit} busy={adding} onToast={onToast}
                  onCreate={(name, pins) => addZone(name, pins)} />
              </CardBody>
            )}
          </SettingCard>
          {city && <PickupDropMatrix key={zone?.id ?? city.id} place={zone ?? city} cityName={cityName} cityFares={zone ? tariff?.localPickupDrop?.[city.id]?.classes : undefined} vehicles={vehicles} canEdit={canEdit} onToast={onToast} />}
        </section>
      )}

      {edit?.kind === "package" && <PackageEditor cls={edit.cls} hours={edit.hours} existing={tariff?.rentalPackages?.[edit.cls]?.packages?.[String(edit.hours)]} version={version} onClose={() => setEdit(null)} onSaved={done} />}
    </div>
  );
}

/** Shared save plumbing: validation message, busy flag, server error, unsaved-change prompt. */
function useEditor(onClose: () => void, onSaved: (t: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const close = () => { if (busy) return; if (dirty && !window.confirm("Discard your unsaved changes?")) return; onClose(); };
  const submit = async (e: FormEvent, problem: string | null, run: () => Promise<number>, doneText: (version: number) => string) => {
    e.preventDefault();
    if (busy) return;
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const v = await run();
      onSaved(doneText(v));
    } catch (err) {
      // Entered values stay in the form; the sheet is not closed.
      setError(err instanceof ActionError ? err.message : "The fare was not saved.");
      setBusy(false);
    }
  };
  return { busy, error, setError, dirty, setDirty: () => setDirty(true), close, submit };
}

function PackageEditor({ cls, hours, existing, version, onClose, onSaved }: { cls: TariffClass; hours: number; existing?: Partial<RentalPackage>; version: number; onClose: () => void; onSaved: (t: string) => void }) {
  const ed = useEditor(onClose, onSaved);
  const [f, setF] = useState({
    fare: text(existing?.customerFare), payout: text(existing?.partnerPayout), km: text(existing?.includedKm), exKm: text(existing?.extraKmRate), exHr: text(existing?.extraHourRate),
    gst: existing?.gstMode ?? "", enabled: existing?.enabled ?? false, reason: "",
  });
  const touch = () => { ed.setDirty(); ed.setError(null); };
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); touch(); };
  const setText = (k: "fare" | "payout" | "km" | "exKm" | "exHr", v: string) => { setF((x) => ({ ...x, [k]: v })); touch(); };
  const fields: ["fare" | "payout" | "km" | "exKm" | "exHr", string][] = [["fare", "Customer fare"], ["payout", "Partner payout"], ["km", "Covered kilometres"], ["exKm", "Extra kilometre charge"], ["exHr", "Extra hour charge"]];
  const problem = (() => {
    for (const [k, label] of fields) if (!(num(f[k]) > 0)) return `Enter ${label.toLowerCase()} (more than zero).`;
    if (f.gst !== "included" && f.gst !== "excluded") return "Choose whether the fare includes GST or GST is added on top.";
    if (f.reason.trim().length < 5) return "Record the reason for this change.";
    return null;
  })();
  return (
    <Modal title={`${CLASS_LABEL[cls]} · ${hours}-hour package`} onClose={ed.close} busy={ed.busy} size="lg"
      footer={<><Button onClick={ed.close} disabled={ed.busy}>Cancel</Button><Button variant="primary" type="submit" form="pkg-form" loading={ed.busy}>Save package</Button></>}>
      <form id="pkg-form" className="grid gap-4" noValidate onSubmit={(e) => ed.submit(e, problem, async () => (await saveTariffSection({
        section: "rentalPackage", class: cls, hours, expectedVersion: version, reason: f.reason.trim(),
        data: { customerFare: num(f.fare), partnerPayout: num(f.payout), includedKm: num(f.km), extraKmRate: num(f.exKm), extraHourRate: num(f.exHr), gstMode: f.gst, enabled: f.enabled },
      })).version, (v) => `${CLASS_LABEL[cls]} ${hours}-hour package saved (tariff version ${v}).`)}>
        {ed.error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{ed.error}</div>}
        <div className="ds-form-grid">
          <label className="ds-field"><span>Covered hours</span><input className="ds-input" value={`${hours} hours`} readOnly aria-readonly="true" /></label>
          {fields.map(([k, label]) => (
            <label key={k} className="ds-field"><span>{label} · {k === "km" ? "km" : k === "exKm" ? "₹/km" : k === "exHr" ? "₹/hour" : "₹"}</span>
              <input className="ds-input" type="number" inputMode="decimal" min={0} step="0.01" value={f[k]} onChange={(e) => setText(k, e.target.value)} />
            </label>
          ))}
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-[12px] font-medium text-muted mb-1">Tax on the customer fare</legend>
          {([["included", "Fare includes GST", "The customer pays exactly this amount; GST is shown inside it."], ["excluded", "GST added on top", "GST is added to this amount at the tariff's GST rate."]] as const).map(([v, label, hint]) => (
            <label key={v} className="ds-check ds-panel ds-panel-pad" style={{ alignItems: "center" }}><input type="radio" name="gst-mode" checked={f.gst === v} onChange={() => set({ gst: v })} /><span><strong className="block text-[13px] text-ink">{label}</strong><small className="text-muted">{hint}</small></span></label>
          ))}
        </fieldset>
        <label className="ds-check"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Available for new quotes and bookings</label>
        <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={300} value={f.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
      </form>
    </Modal>
  );
}

type PdKey = "minKm" | "rate" | "exKm" | "wait" | "partner";
type PdDraft = Record<PdKey, string> & { enabled: boolean };
const PD_FIELDS: { key: PdKey; label: string; unit: string; zeroOk?: boolean }[] = [
  { key: "minKm", label: "Minimum billable km", unit: "km" },
  { key: "rate", label: "Price per km", unit: "₹/km" },
  { key: "exKm", label: "Extra km price", unit: "₹/km" },
  { key: "wait", label: "Waiting", unit: "₹/hour", zeroOk: true },
  { key: "partner", label: "Partner pay per km", unit: "₹/km" },
];
const pdOf = (f?: Partial<LocalFare>): PdDraft => ({ minKm: text(f?.minKm), rate: text(f?.customerRate), exKm: text(f?.extraKmRate), wait: text(f?.waitingPerHour), partner: text(f?.partnerRate), enabled: f?.enabled ?? false });

/**
 * One city's (or one zone's) Pickup & Drop fares: the rates down the side, the vehicles across the top, one Save for every changed
 * vehicle. For a zone, `cityFares` are the city's rates: a vehicle whose zone rates are off uses them (shown in grey).
 */
function PickupDropMatrix({ place, cityName, cityFares, vehicles, canEdit, onToast }: {
  place: MasterLocation; cityName: string; cityFares?: Partial<Record<TariffClass, Partial<LocalFare>>>; vehicles?: VehicleCol[]; canEdit: boolean; onToast: (t: string) => void;
}) {
  const city = place;
  const isZone = place.type !== "City";
  // Only the rate classes an active vehicle category is priced as.
  const classes = TARIFF_CLASSES.filter((c) => !vehicles?.length || vehicles.some((v) => v.cls === c));
  const { tariff } = useTariff();
  const savedOf = (c: TariffClass) => pdOf(tariff?.localPickupDrop?.[city.id]?.classes?.[c]);
  const [drafts, setDrafts] = useState<Partial<Record<TariffClass, PdDraft>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const draftOf = (c: TariffClass) => drafts[c] ?? savedOf(c);
  const dirtyOf = (c: TariffClass) => !!drafts[c] && JSON.stringify(drafts[c]) !== JSON.stringify(savedOf(c));
  const changed = classes.filter(dirtyOf);
  const set = (c: TariffClass, patch: Partial<PdDraft>) => { setMessage(null); setDrafts((d) => ({ ...d, [c]: { ...(d[c] ?? savedOf(c)), ...patch } })); };
  const nameOf = (c: TariffClass) => vehicles?.find((v) => v.cls === c && v.owner)?.name ?? CLASS_LABEL[c];
  const errorOf = (c: TariffClass): string => {
    if (!dirtyOf(c)) return "";
    const d = draftOf(c);
    for (const f of PD_FIELDS) {
      const v = num(d[f.key]);
      if (!Number.isFinite(v)) return `enter ${f.label.toLowerCase()}.`;
      if (f.zeroOk ? v < 0 : v <= 0) return `${f.label.toLowerCase()} must be ${f.zeroOk ? "zero or more" : "more than zero"}.`;
    }
    return "";
  };
  const problems = classes.map((c) => (errorOf(c) ? `${nameOf(c)}: ${errorOf(c)}` : "")).filter(Boolean);
  const name = isZone ? `${place.name || place.area} (${cityName})` : place.name || place.city;
  // A zone's empty box shows the city's rate in grey.
  const cityText = (c: TariffClass, k: PdKey) => {
    const f = cityFares?.[c];
    if (!f || !validLocalFare(f) || !f.enabled) return "";
    return text(k === "minKm" ? f.minKm : k === "rate" ? f.customerRate : k === "exKm" ? f.extraKmRate : k === "wait" ? f.waitingPerHour : f.partnerRate);
  };

  const save = async () => {
    if (!canEdit || busy || !changed.length || problems.length) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    let version = tariff?.version ?? 0;
    const done: string[] = [];
    try {
      for (const c of changed) {
        const d = draftOf(c);
        const r = await saveTariffSection({
          section: "localPickupDrop", cityId: city.id, class: c, expectedVersion: version, reason: reason.trim(),
          data: { minKm: num(d.minKm), customerRate: num(d.rate), partnerRate: num(d.partner), extraKmRate: num(d.exKm), waitingPerHour: num(d.wait), enabled: d.enabled },
        });
        version = r.version;
        done.push(nameOf(c));
      }
      setDrafts({});
      setReason("");
      onToast(`Pickup & Drop fares saved for ${name}: ${done.join(", ")}.`);
    } catch (err) {
      const why = err instanceof ActionError ? err.message : "Not saved. Please try again.";
      setMessage({ ok: false, text: done.length ? `Saved for ${done.join(", ")}. ${why}` : why });
    } finally {
      setBusy(false);
    }
  };

  const configured = (c: TariffClass) => validLocalFare(tariff?.localPickupDrop?.[city.id]?.classes?.[c]);
  return (
    <SettingCard title={`Pickup & Drop · ${name}`}
      description={isZone
        ? `Rates for trips that start in this zone and stay in ${cityName}. Grey numbers are the city rates, used by any vehicle whose zone rates are off.`
        : "Fare = the greater of the road distance and the minimum billable km, times the price per km. The 130 km Outstation minimum does not apply."}
      footer={canEdit ? <SaveBar reason={reason} onReason={setReason} onSave={save} busy={busy} disabled={!changed.length || problems.length > 0} message={message}
        note={isZone ? "Fill every box of a vehicle and switch on Use zone rates to price it here." : "Fill every box of a vehicle to save it. Switch it on to quote it."} /> : null}>
      <RateTable label={`Pickup and Drop fares in ${name}`} disabled={!canEdit || busy}
        columns={(() => {
          const statusOf = (c: TariffClass) => errorOf(c) ? { tone: "warn" as const, text: "Check", title: errorOf(c) }
            : !configured(c) && !dirtyOf(c) ? { tone: "off" as const, text: isZone ? "City rates" : "Not set" } : undefined;
          return vehicles?.length ? vehicleColumns(vehicles, (c) => classes.includes(c), statusOf) : classes.map((c) => ({ key: c, name: nameOf(c), status: statusOf(c) }));
        })()}
        groups={[
          { title: "Customer pays", rows: PD_FIELDS.filter((f) => f.key !== "partner").map((f) => ({ key: f.key, label: f.label, unit: f.unit, required: true, cell: (c: string) => { const v = draftOf(c as TariffClass)[f.key]; return { value: v, own: v !== "", placeholder: isZone ? cityText(c as TariffClass, f.key) || "—" : undefined, onChange: (next: string) => set(c as TariffClass, { [f.key]: next } as Partial<PdDraft>) }; } })) },
          { title: "Partner gets", rows: PD_FIELDS.filter((f) => f.key === "partner").map((f) => ({ key: f.key, label: f.label, unit: f.unit, required: true, cell: (c: string) => { const v = draftOf(c as TariffClass)[f.key]; return { value: v, own: v !== "", placeholder: isZone ? cityText(c as TariffClass, f.key) || "—" : undefined, onChange: (next: string) => set(c as TariffClass, { [f.key]: next } as Partial<PdDraft>) }; } })) },
          { title: "Availability", rows: [{ key: "enabled", label: isZone ? "Use zone rates" : "Quote to customers", cell: (c: string) => ({ checked: draftOf(c as TariffClass).enabled, onToggle: (on: boolean) => set(c as TariffClass, { enabled: on }), title: draftOf(c as TariffClass).enabled ? "On" : "Off" }) }] },
        ]} />
      <Problems items={problems} />
    </SettingCard>
  );
}
