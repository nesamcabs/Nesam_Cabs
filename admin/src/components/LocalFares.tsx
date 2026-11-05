import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { MasterLocation } from "../types";
import { subscribeLocations } from "../services/adminFirestoreService";
import { saveTariffSection } from "../services/bookingOpsService";
import { saveLocation, deriveLocationCode, type LocationForm } from "../services/locationService";
import { auth } from "../services/firebase";
import { CITIES_BY_STATE } from "../domain/placeDirectory";
import { GST_STATES } from "../domain/gstStates";
import { ActionError } from "../services/callables";
import {
  CLASS_LABEL, RENTAL_HOURS, TARIFF_CLASSES, inr, rentalMinHours, useTariff, validLocalFare, validPackage,
  type LocalFare, type RentalPackage, type TariffClass,
} from "../services/tariffService";
import { useCan } from "./AccessContext";
import { Modal } from "./Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, toneForStatus } from "./ui";
import { StageBar } from "./ui/ListKit";

type Tab = "Rental packages" | "Pickup & Drop";
const TABS: Tab[] = ["Rental packages", "Pickup & Drop"];

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const text = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/** Local fares: fixed Rental packages by vehicle category and hours, and the Pickup & Drop fare of each city. */
/** `only` shows a single section without the tab bar (rental packages are now edited in Brand & service fares). */
export default function LocalFares({ initialTab = "Rental packages", initialCity = "", onToast, only }: { initialTab?: Tab; initialCity?: string; onToast: (t: string) => void; only?: Tab }) {
  const { tariff, error } = useTariff();
  const canEdit = useCan("pricing");
  const [tab, setTab] = useState<Tab>(only ?? initialTab);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [cityId, setCityId] = useState("");
  const [edit, setEdit] = useState<
    | { kind: "package"; cls: TariffClass; hours: number }
    | { kind: "minimum"; cls: TariffClass }
    | { kind: "local"; cls: TariffClass }
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
              const minSaved = tariff?.rentalPackages?.[cls]?.minHours !== undefined;
              return (
                <tr key={cls}>
                  <td>
                    <strong>{CLASS_LABEL[cls]}</strong>
                    <small>Minimum {min} hours{minSaved ? "" : " (initial)"}</small>
                    {canEdit && <Button size="sm" variant="ghost" onClick={() => setEdit({ kind: "minimum", cls })}>Change minimum</Button>}
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
        <section aria-labelledby="pd-h">
          <h3 id="pd-h" className="text-[15px] font-bold text-ink">Local Pickup &amp; Drop</h3>
          <p className="text-[12px] text-muted mb-3">Fare = the greater of the road distance and the minimum billable kilometres, times the rate per kilometre. The 130 km Outstation minimum does not apply here.</p>
          <label className="ds-field mb-3" style={{ maxWidth: 360 }}>
            <span>City</span>
            <select className="ds-select" value={cityId} disabled={adding} onChange={(e) => void pickCity(e.target.value)}>
              <option value="">{adding ? "Adding city…" : "Choose a city…"}</option>
              {cities.length > 0 && <optgroup label="In Locations">{cities.map((c) => <option key={c.id} value={c.id}>{c.name || c.city}{c.state ? ` · ${c.state}` : ""}</option>)}</optgroup>}
              {canEdit && builtIn.length > 0 && <optgroup label="Add from the built-in list">{builtIn.map((b) => <option key={b.key} value={b.key}>{b.name} · {b.state}</option>)}</optgroup>}
            </select>
          </label>
          {addError && <p className="ds-error" role="alert">{addError}</p>}
          {city && (
            <DataTable label={`Local Pickup and Drop fares in ${city.name || city.city}`} minWidth={900} hideTools hasActions>
              <thead><tr><th>CATEGORY / CITY</th><th>MINIMUM / CUSTOMER RATE</th><th>PARTNER RATE</th><th>EXTRA KM / WAITING</th><th>STATUS</th>{canEdit && <th className="ds-actions">ACTION</th>}</tr></thead>
              <tbody>{TARIFF_CLASSES.map((cls) => {
                const raw = tariff?.localPickupDrop?.[city.id]?.classes?.[cls];
                const f = validLocalFare(raw) ? raw : null;
                return (
                  <tr key={cls}>
                    <td><strong>{CLASS_LABEL[cls]}</strong><small>{city.name || city.city}</small></td>
                    {f ? (
                      <>
                        <td><strong>{inr(f.customerRate)}/km</strong><small>Minimum {f.minKm} km</small></td>
                        <td>{inr(f.partnerRate)}/km</td>
                        <td>{inr(f.extraKmRate)}/km<small>Waiting {inr(f.waitingPerHour)}/hour</small></td>
                        <td><Badge tone={toneForStatus(f.enabled ? "Enabled" : "Disabled")}>{f.enabled ? "Enabled" : "Disabled"}</Badge></td>
                      </>
                    ) : <td colSpan={4}><span className="text-muted">Not configured</span></td>}
                    {canEdit && <td className="ds-actions"><div><Button size="sm" onClick={() => setEdit({ kind: "local", cls })}>{f ? "Edit fare" : "Set fare"}</Button></div></td>}
                  </tr>
                );
              })}</tbody>
            </DataTable>
          )}
          {city && <p className="text-[11px] text-faint mt-3">Applies to bookings whose pickup and drop are both locations of this city in the location master (office bookings). A trip without an enabled fare here keeps its existing pricing; it is never quoted at ₹0.</p>}
        </section>
      )}

      {edit?.kind === "package" && <PackageEditor cls={edit.cls} hours={edit.hours} existing={tariff?.rentalPackages?.[edit.cls]?.packages?.[String(edit.hours)]} version={version} onClose={() => setEdit(null)} onSaved={done} />}
      {edit?.kind === "minimum" && <MinimumEditor cls={edit.cls} current={rentalMinHours(tariff, edit.cls)} packages={tariff?.rentalPackages?.[edit.cls]?.packages ?? {}} version={version} onClose={() => setEdit(null)} onSaved={done} />}
      {edit?.kind === "local" && city && <LocalEditor cls={edit.cls} city={city} existing={tariff?.localPickupDrop?.[city.id]?.classes?.[edit.cls]} version={version} onClose={() => setEdit(null)} onSaved={done} />}
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

function MinimumEditor({ cls, current, packages, version, onClose, onSaved }: { cls: TariffClass; current: number; packages: Partial<Record<string, Partial<RentalPackage>>>; version: number; onClose: () => void; onSaved: (t: string) => void }) {
  const ed = useEditor(onClose, onSaved);
  const [hours, setHours] = useState(String(current));
  const [reason, setReason] = useState("");
  const next = Number(hours);
  const hidden = RENTAL_HOURS.filter((h) => h < next && validPackage(packages[String(h)]));
  const problem = !Number.isInteger(next) || next < 1 || next > 12 ? "Choose a whole number of hours from 1 to 12." : next === current ? "Choose a different minimum." : reason.trim().length < 5 ? "Record the reason for this change." : null;
  return (
    <Modal title={`${CLASS_LABEL[cls]} · minimum rental`} onClose={ed.close} busy={ed.busy}
      footer={<><Button onClick={ed.close} disabled={ed.busy}>Cancel</Button><Button variant="primary" type="submit" form="min-form" loading={ed.busy}>Save minimum</Button></>}>
      <form id="min-form" className="grid gap-4" noValidate onSubmit={(e) => ed.submit(e, problem, async () => (await saveTariffSection({ section: "rentalMinimum", class: cls, minHours: next, expectedVersion: version, reason: reason.trim() })).version, (v) => `${CLASS_LABEL[cls]} minimum rental is now ${next} hours (tariff version ${v}).`)}>
        {ed.error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{ed.error}</div>}
        <label className="ds-field"><span>Minimum rental · hours</span>
          <select className="ds-select" value={hours} onChange={(e) => { setHours(e.target.value); ed.setDirty(); ed.setError(null); }}>{Array.from({ length: 12 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h} hours</option>)}</select>
        </label>
        <p className="text-[12px] text-muted">Packages shorter than the minimum show as Not available and are not quoted. Their saved values are kept.</p>
        {hidden.length > 0 && <p className="text-[12px] text-bad" role="status">Saved {hidden.join(", ")}-hour package{hidden.length > 1 ? "s" : ""} will stop being quoted for {CLASS_LABEL[cls]}.</p>}
        <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={300} value={reason} onChange={(e) => { setReason(e.target.value); ed.setDirty(); ed.setError(null); }} /></label>
      </form>
    </Modal>
  );
}

function LocalEditor({ cls, city, existing, version, onClose, onSaved }: { cls: TariffClass; city: MasterLocation; existing?: Partial<LocalFare>; version: number; onClose: () => void; onSaved: (t: string) => void }) {
  const ed = useEditor(onClose, onSaved);
  const [f, setF] = useState({ minKm: text(existing?.minKm), rate: text(existing?.customerRate), partner: text(existing?.partnerRate), exKm: text(existing?.extraKmRate), wait: text(existing?.waitingPerHour), enabled: existing?.enabled ?? false, reason: "" });
  const touch = () => { ed.setDirty(); ed.setError(null); };
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); touch(); };
  const setText = (k: "minKm" | "rate" | "partner" | "exKm" | "wait", v: string) => { setF((x) => ({ ...x, [k]: v })); touch(); };
  const fields: ["minKm" | "rate" | "partner" | "exKm" | "wait", string, string][] = [
    ["minKm", "Minimum billable kilometres", "km"], ["rate", "Customer rate per kilometre", "₹/km"], ["partner", "Partner rate per kilometre", "₹/km"],
    ["exKm", "Extra kilometre rate", "₹/km"], ["wait", "Waiting charge", "₹/hour"],
  ];
  const problem = (() => {
    for (const [k, label] of fields) {
      const v = num(f[k]);
      if (!Number.isFinite(v)) return `Enter ${label.toLowerCase()}.`;
      if (k === "wait" ? v < 0 : v <= 0) return `${label} must be ${k === "wait" ? "zero or more" : "more than zero"}.`;
    }
    if (f.reason.trim().length < 5) return "Record the reason for this change.";
    return null;
  })();
  const name = city.name || city.city;
  return (
    <Modal title={`${CLASS_LABEL[cls]} · ${name}`} subtitle="Local Pickup & Drop" onClose={ed.close} busy={ed.busy} size="lg"
      footer={<><Button onClick={ed.close} disabled={ed.busy}>Cancel</Button><Button variant="primary" type="submit" form="local-form" loading={ed.busy}>Save fare</Button></>}>
      <form id="local-form" className="grid gap-4" noValidate onSubmit={(e) => ed.submit(e, problem, async () => (await saveTariffSection({
        section: "localPickupDrop", cityId: city.id, class: cls, expectedVersion: version, reason: f.reason.trim(),
        data: { minKm: num(f.minKm), customerRate: num(f.rate), partnerRate: num(f.partner), extraKmRate: num(f.exKm), waitingPerHour: num(f.wait), enabled: f.enabled },
      })).version, (v) => `${CLASS_LABEL[cls]} fare for ${name} saved (tariff version ${v}).`)}>
        {ed.error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{ed.error}</div>}
        <p className="text-[12px] text-muted">Base fare = the greater of the road distance and the minimum billable kilometres, times the customer rate per kilometre. Tax, rounding and the partner payout follow the tariff.</p>
        <div className="ds-form-grid">
          {fields.map(([k, label, unit]) => (
            <label key={k} className="ds-field"><span>{label} · {unit}</span>
              <input className="ds-input" type="number" inputMode="decimal" min={0} step="0.01" value={f[k]} onChange={(e) => setText(k, e.target.value)} />
            </label>
          ))}
        </div>
        <label className="ds-check"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} />Enabled — new quotes in {name} use this fare</label>
        <label className="ds-field"><span>Reason for this change</span><input className="ds-input" maxLength={300} value={f.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
      </form>
    </Modal>
  );
}
