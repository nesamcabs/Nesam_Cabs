import { useCallback, useEffect, useMemo, useState } from "react";
import { getPaymentChoiceSettings, getPaymentGatewayStatus, savePaymentChoiceSettings, type GatewayStatus } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CITIES_BY_STATE } from "../domain/placeDirectory";
import {
  MAX_DISTRICTS, MAX_PART_PERCENT, MIN_PART_PERCENT, PAY_OPTION_IDS, advanceAmount, defaultChoices, validateChoices,
  type OptionRule, type PayOptionId, type PaymentChoices,
} from "../domain/paymentChoices";
import { useCan, useCanDo } from "./AccessContext";
import type { MasterLocation } from "../types";
import { subscribeLocations } from "../services/adminFirestoreService";
import LocationScopeSelector from "./location/LocationScopeSelector";
import { EMPTY_SEL, indexLocations, rulePlacesOf, type LocSel } from "../domain/locationHierarchy";
import { Notice, inputCls, primaryBtn, secondaryBtn } from "./FormKit";

/**
 * Service & Fare Settings › Payment options. The three choices a customer sees when booking — "Book now, pay later", "Pay part now"
 * (for example 25%) and "Pay 100% now" — and, for each one: a master show / hide switch, a date window, and the pickup districts it is
 * shown in. Customers get the evaluated list from the server; the booking server checks the same rules again, so a hidden option
 * cannot be booked.
 */

type Form = Omit<PaymentChoices, "version">;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const SAMPLE_TOTAL = 6082;
const TN_DISTRICTS = CITIES_BY_STATE["33"].slice(0, 38);
const sameForm = (a: Form, b: Form) => JSON.stringify(a) === JSON.stringify(b);

const COPY: Record<PayOptionId, { title: (pct: number) => string; sub: (pct: number) => string }> = {
  later: { title: () => "Book now, pay later", sub: () => "Pay your driver at the end of the trip" },
  part: { title: (p) => `Pay ${p}% now`, sub: (p) => `Pay the remaining ${100 - p}% after your trip` },
  full: { title: () => "Pay 100% now", sub: () => "Complete your payment securely online" },
};

const datesText = (r: OptionRule) => {
  if (r.schedule.mode !== "Range" || (!r.schedule.from && !r.schedule.to)) return "on every date";
  const what = r.basis === "pickup" ? "trips on" : "bookings made on";
  return r.schedule.from && r.schedule.to ? `for ${what} ${r.schedule.from} to ${r.schedule.to}` : r.schedule.from ? `for ${what} and after ${r.schedule.from}` : `for ${what} and before ${r.schedule.to}`;
};
const placesText = (r: OptionRule) => (r.districts.mode === "All" || !r.districts.list.length ? "in every district" : r.districts.mode === "Only" ? `only in ${r.districts.list.join(", ")}` : `everywhere except ${r.districts.list.join(", ")}`);

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${on ? "bg-green-600 border-green-600" : "bg-gray-300 border-gray-300"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[21px]" : "translate-x-[1px]"}`} />
    </button>
  );
}

/**
 * Chips of the chosen districts, and the shared location selector to add more: a district of the State → District list, or a saved
 * City of the Locations master (the server matches the pickup by these names, so the towns inside a district count too). Saved
 * entries stay exactly as saved.
 */
function DistrictPicker({ list, onChange, disabled }: { id: string; list: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  useEffect(() => subscribeLocations(setLocations, () => setLocations([])), []);
  const index = useMemo(() => indexLocations(locations), [locations]);
  const [sel, setSel] = useState<LocSel>(EMPTY_SEL);
  const name = sel.district ? rulePlacesOf({ ...sel, zoneId: "", pins: [] }, index)[0]?.city ?? "" : "";
  const add = (names: string[]) => {
    const next = [...list];
    for (const n of names.map((x) => x.trim()).filter(Boolean)) if (!next.some((x) => x.toLowerCase() === n.toLowerCase()) && next.length < MAX_DISTRICTS) next.push(n);
    onChange(next);
    setSel({ ...EMPTY_SEL, state: sel.state });
  };
  const cities = index.filter((x) => x.loc.type === "City" && x.state === sel.state && x.district.toLowerCase() === sel.district.toLowerCase());
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-live="polite">
        {list.map((d) => (
          <span key={d} className="inline-flex items-center gap-1 rounded-full border border-line bg-gray-50 px-2.5 py-1 text-[12px] font-semibold text-ink">
            {d}
            {!disabled && <button type="button" onClick={() => onChange(list.filter((x) => x !== d))} aria-label={`Remove ${d}`} className="text-muted hover:text-bad cursor-pointer leading-none">×</button>}
          </span>
        ))}
        {!list.length && <span className="text-[12px] text-muted">No district chosen yet.</span>}
      </div>
      {!disabled && (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <LocationScopeSelector variant="row" label="Payment option district" value={sel} onChange={setSel} locations={locations} depth="district" pinSearch="locate"
                broad={{ state: "Select a state" }} />
            </div>
            {cities.length > 0 && (
              <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold text-slate-700">City (optional)</span>
                <select className="ds-select" value={sel.locationId} aria-label="Payment option city" onChange={(e) => setSel({ ...sel, locationId: e.target.value })}>
                  <option value="">Whole district</option>
                  {cities.map((c) => <option key={c.loc.id} value={c.loc.id}>{c.loc.name}</option>)}
                </select>
              </label>
            )}
            <button type="button" className={secondaryBtn} disabled={!name || list.some((x) => x.toLowerCase() === name.toLowerCase())} onClick={() => add([name])}>{name ? `Add ${name}` : "Add district"}</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={secondaryBtn} onClick={() => add(TN_DISTRICTS)} title="Adds all 38 Tamil Nadu districts">All Tamil Nadu districts</button>
            {list.length > 0 && <button type="button" className="text-[12px] font-semibold text-brand cursor-pointer" onClick={() => onChange([])}>Clear</button>}
          </div>
        </>
      )}
    </div>
  );
}

function OptionEditor({ id, rule, percent, recommended, onChange, canEdit, problem }: { id: PayOptionId; rule: OptionRule; percent: number; recommended: boolean; onChange: (p: Partial<OptionRule>) => void; canEdit: boolean; problem: string }) {
  const copy = COPY[id];
  const range = rule.schedule.mode === "Range";
  return (
    <section className={`rounded-2xl border p-4 space-y-4 ${rule.visible ? "border-line bg-white" : "border-line bg-gray-50"}`} aria-label={copy.title(percent)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink flex flex-wrap items-center gap-2">
            {copy.title(percent)}
            {recommended && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">★ Recommended</span>}
          </h3>
          <p className="text-[12px] text-muted">{copy.sub(percent)}{id !== "later" ? " · paid through Razorpay" : ""}</p>
        </div>
        <label className="flex items-center gap-2 text-[12px] font-semibold text-body">
          {rule.visible ? "Shown to customers" : "Hidden from customers"}
          <Switch on={rule.visible} onChange={(v) => onChange({ visible: v })} disabled={!canEdit} label={`${copy.title(percent)} shown to customers`} />
        </label>
      </div>

      <div className={`grid gap-4 md:grid-cols-2 ${rule.visible ? "" : "opacity-50 pointer-events-none"}`} aria-disabled={!rule.visible}>
        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold uppercase tracking-wide text-muted">Dates</legend>
          <div className="flex flex-wrap gap-4 text-[13px]">
            <label className="inline-flex items-center gap-1.5"><input type="radio" name={`${id}-dates`} checked={!range} disabled={!canEdit} onChange={() => onChange({ schedule: { ...rule.schedule, mode: "Always" } })} />Every day</label>
            <label className="inline-flex items-center gap-1.5"><input type="radio" name={`${id}-dates`} checked={range} disabled={!canEdit} onChange={() => onChange({ schedule: { ...rule.schedule, mode: "Range" } })} />Only between dates</label>
          </div>
          {range && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <input type="date" className={`${inputCls} w-40`} value={rule.schedule.from} max={rule.schedule.to || undefined} disabled={!canEdit} aria-label="First day" onChange={(e) => onChange({ schedule: { ...rule.schedule, from: e.target.value } })} />
                <span className="text-muted">to</span>
                <input type="date" className={`${inputCls} w-40`} value={rule.schedule.to} min={rule.schedule.from || undefined} disabled={!canEdit} aria-label="Last day" onChange={(e) => onChange({ schedule: { ...rule.schedule, to: e.target.value } })} />
              </div>
              <label className="flex flex-wrap items-center gap-2 text-[12px] text-body">
                The dates are the day the
                <select className={`${inputCls} w-auto`} value={rule.basis} disabled={!canEdit} onChange={(e) => onChange({ basis: e.target.value === "pickup" ? "pickup" : "booking" })}>
                  <option value="booking">customer books</option>
                  <option value="pickup">trip starts (pickup day)</option>
                </select>
              </label>
              <p className="text-[11px] text-muted">Both days are included. Leave one date empty for “from” or “until” only. India time.</p>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-[12px] font-bold uppercase tracking-wide text-muted">Pickup district</legend>
          <select className={`${inputCls} w-auto`} value={rule.districts.mode} disabled={!canEdit} aria-label="Where to show it"
            onChange={(e) => onChange({ districts: { ...rule.districts, mode: e.target.value === "Only" ? "Only" : e.target.value === "Except" ? "Except" : "All" } })}>
            <option value="All">Show in every district</option>
            <option value="Only">Show only in these districts</option>
            <option value="Except">Hide in these districts</option>
          </select>
          {rule.districts.mode !== "All" && <DistrictPicker id={`${id}-d`} list={rule.districts.list} disabled={!canEdit} onChange={(list) => onChange({ districts: { ...rule.districts, list } })} />}
        </fieldset>
      </div>

      {/* Said only when it adds something: hidden, or limited by dates or districts. */}
      {!rule.visible ? <p className="text-[12px] text-muted">Customers never see this option.</p>
        : range || rule.districts.mode !== "All" ? <p className="text-[12px] rounded-lg px-3 py-2 border bg-green-50 border-green-200 text-green-900">Customers see this option {datesText(rule)}, {placesText(rule)}.</p> : null}
      {problem && <p className="text-[12px] font-semibold text-bad" role="alert">{problem}</p>}
    </section>
  );
}

export default function PaymentOptionsCard() {
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const [saved, setSaved] = useState<(PaymentChoices & { updatedByName: string; updatedAt: string | null }) | null>(null);
  const [form, setForm] = useState<Form>(() => { const { version: _v, ...rest } = defaultChoices(); return rest; });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [gateway, setGateway] = useState<GatewayStatus | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const d = await getPaymentChoiceSettings();
      setSaved(d);
      const { version: _v, ...rest } = d;
      setForm({ options: rest.options, partPercent: rest.partPercent, recommended: rest.recommended });
    } catch (e) {
      setError(e instanceof ActionError ? e.message : "The payment options could not be loaded.");
    }
  }, []);
  useEffect(() => { void load(); getPaymentGatewayStatus().then(setGateway).catch(() => undefined); }, [load]);

  const dirty = !!saved && !sameForm(form, { options: saved.options, partPercent: saved.partPercent, recommended: saved.recommended });
  const setOption = (id: PayOptionId, patch: Partial<OptionRule>) => { setMsg(null); setForm((f) => ({ ...f, options: { ...f.options, [id]: { ...f.options[id], ...patch } } })); };

  const problem = useMemo(() => { try { validateChoices(form); return ""; } catch (e) { return (e as Error).message; } }, [form]);
  const optionProblem = (id: PayOptionId) => (problem && !problem.startsWith("The part payment") && !problem.startsWith("At least") && problem.startsWith({ later: "Book now", part: "Pay part", full: "Pay 100%" }[id]) ? problem : "");

  const save = async () => {
    if (!canEdit || busy || problem || !dirty) return;
    setBusy(true);
    setMsg(null);
    try {
      await savePaymentChoiceSettings({ ...form, expectedVersion: saved?.version ?? 0 });
      await load();
      setMsg({ tone: "ok", text: "Saved. Customers see the new options on their next booking; bookings already made keep the option they chose." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The payment options were not saved." });
    } finally {
      setBusy(false);
    }
  };

  const onlineBlocked = gateway && (!gateway.keyConfigured || !gateway.onlineEnabled);

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl border border-line shadow-sm p-5 space-y-4" aria-label="Payment options">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">Payment options</h2>
            <p className="text-sm text-muted">The choices customers see when they book, on all three websites (Nesam Cabs, People Taxi, One Way Car Rentals) and in the app. Show or hide each one, run it between dates, and limit it to some pickup districts. A district is decided by the trip's pickup place, so the towns inside it count too (Erode covers Gobichettipalayam).</p>
          </div>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${saved ? "bg-green-50 text-green-800 border-green-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>
            {saved ? `${PAY_OPTION_IDS.filter((id) => form.options[id].visible).length} of 3 shown` : error ? "Not loaded" : "Loading…"}
          </span>
        </div>
        {error && <Notice tone="error">{error} <button type="button" className="font-bold underline cursor-pointer" onClick={() => void load()}>Try again</button></Notice>}
        {onlineBlocked && <Notice tone="warn">Online options (“Pay part now” and “Pay 100% now”) are hidden from every customer until Razorpay is ready: {!gateway!.keyConfigured ? "the API keys are not set." : "customer online payments are switched off on the Payments page."} “Book now, pay later” still works.</Notice>}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1 block">
            <span className="text-[12px] font-bold uppercase tracking-wide text-muted">Part payment now (%)</span>
            <div className="flex items-center gap-2">
              <input type="number" min={MIN_PART_PERCENT} max={MAX_PART_PERCENT} step={1} className={`${inputCls} w-24`} value={form.partPercent} disabled={!canEdit}
                onChange={(e) => { setMsg(null); setForm((f) => ({ ...f, partPercent: Math.round(Number(e.target.value)) })); }} />
              <span className="text-[12px] text-muted">of the trip total, rounded up to the rupee. On {inr(SAMPLE_TOTAL)} that is {inr(advanceAmount(SAMPLE_TOTAL, Math.min(MAX_PART_PERCENT, Math.max(MIN_PART_PERCENT, form.partPercent || 0))))}.</span>
            </div>
          </label>
          <label className="space-y-1 block">
            <span className="text-[12px] font-bold uppercase tracking-wide text-muted">“Recommended” badge</span>
            <select className={`${inputCls} w-auto`} value={form.recommended} disabled={!canEdit} onChange={(e) => { setMsg(null); setForm((f) => ({ ...f, recommended: (PAY_OPTION_IDS as readonly string[]).includes(e.target.value) ? (e.target.value as PayOptionId) : "" })); }}>
              <option value="">No badge</option>
              <option value="later">Book now, pay later</option>
              <option value="part">Pay {form.partPercent}% now</option>
              <option value="full">Pay 100% now</option>
            </select>
          </label>
        </div>
      </section>

      {PAY_OPTION_IDS.map((id) => (
        <OptionEditor key={id} id={id} rule={form.options[id]} percent={form.partPercent} recommended={form.recommended === id} canEdit={canEdit} onChange={(p) => setOption(id, p)} problem={optionProblem(id)} />
      ))}

      <div className="sticky bottom-0 z-10 -mx-1 rounded-2xl border border-line bg-white/95 backdrop-blur p-3 shadow-sm flex flex-wrap items-center gap-3">
        {canEdit ? (
          <>
            <button type="button" onClick={() => void save()} disabled={!dirty || !!problem || busy} className={primaryBtn}>{busy ? "Saving…" : "Save payment options"}</button>
            {dirty && <button type="button" className={secondaryBtn} onClick={() => { setMsg(null); void load(); }} disabled={busy}>Discard changes</button>}
          </>
        ) : <span className="text-sm text-muted">Changing this needs pricing access.</span>}
        {dirty && !problem && <span className="text-[12px] text-muted">You have unsaved changes.</span>}
        {problem && dirty && <span className="text-[12px] font-semibold text-bad" role="alert">{problem}</span>}
        {saved?.updatedByName && <span className="text-xs text-muted ml-auto">Last changed by {saved.updatedByName} (version {saved.version}).</span>}
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
