import { useEffect, useMemo, useState } from "react";
import { saveTariffConfig, saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, FALLS_BACK_TO_SUV, TARIFF_CLASSES, outstationExtraFor, useTariff, type Tariff, type TariffClass, type Zone } from "../services/tariffService";
import { useCan } from "./AccessContext";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "./FormKit";

/** Every editable number of one vehicle category, kept as the text the admin typed. */
const ROW_KEYS = ["rtMin", "cOW", "pOW", "cRT", "pRT", "cAllowOW", "pAllowOW", "cAllowRT", "pAllowRT", "extraKmOW", "waitingOW", "extraKmRT", "waitingRT"] as const;
type RowKey = (typeof ROW_KEYS)[number];
type Row = Record<RowKey, string>;
interface Form { owMin: string; airC: string; airP: string; rows: Record<TariffClass, Row> }

/** key, label, unit, whether zero is allowed (allowances and waiting may be ₹0; rates and distances may not). */
const RATE_COLS: [RowKey, string, string, boolean][] = [
  ["rtMin", "Round Trip minimum", "km/day", false],
  ["cOW", "Customer One Way rate", "₹/km", false],
  ["pOW", "Partner One Way rate", "₹/km", false],
  ["cRT", "Customer Round Trip rate", "₹/km", false],
  ["pRT", "Partner Round Trip rate", "₹/km", false],
  ["cAllowOW", "Customer allowance, One Way", "₹/trip", true],
  ["pAllowOW", "Partner allowance, One Way", "₹/trip", true],
  ["cAllowRT", "Customer allowance, Round Trip", "₹/day", true],
  ["pAllowRT", "Partner allowance, Round Trip", "₹/day", true],
];
const EXTRA_OW_COLS: [RowKey, string, string, boolean][] = [
  ["extraKmOW", "Customer extra charge per kilometre", "₹/km", false],
  ["waitingOW", "Customer extra charge per waiting hour", "₹/hour", true],
];
const EXTRA_RT_COLS: [RowKey, string, string, boolean][] = [
  ["extraKmRT", "Customer extra charge per kilometre", "₹/km", false],
  ["waitingRT", "Customer extra charge per waiting hour", "₹/hour", true],
];
const ALL_COLS = [...RATE_COLS, ...EXTRA_OW_COLS, ...EXTRA_RT_COLS];

const str = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const blankRow = (): Row => Object.fromEntries(ROW_KEYS.map((k) => [k, ""])) as Row;

function fromTariff(t: Tariff | null): Form {
  const rows = {} as Record<TariffClass, Row>;
  for (const c of TARIFF_CLASSES) {
    const ow = t?.oneWay?.classes?.[c], rt = t?.roundTrip?.classes?.[c];
    // Keep a wholly inherited Innova row blank so clearing it still means "use SUV".
    const owExtra = t?.oneWayExtras?.[c] ?? t?.outstationExtras?.[c] ?? (ow || rt ? outstationExtraFor(t, c, "One Way") : undefined);
    const rtExtra = t?.roundTripExtras?.[c] ?? t?.outstationExtras?.[c] ?? (ow || rt ? outstationExtraFor(t, c, "Round Trip") : undefined);
    rows[c] = {
      rtMin: str(rt?.minKmPerDay), cOW: str(ow?.customerRate), pOW: str(ow?.partnerRate), cRT: str(rt?.customerRate), pRT: str(rt?.partnerRate),
      cAllowOW: str(ow?.customerBata), pAllowOW: str(ow?.partnerBata), cAllowRT: str(rt?.customerBata), pAllowRT: str(rt?.partnerBata),
      extraKmOW: str(owExtra?.extraKmRate), waitingOW: str(owExtra?.waitingPerHour),
      extraKmRT: str(rtExtra?.extraKmRate), waitingRT: str(rtExtra?.waitingPerHour),
    };
  }
  // 130 km is the documented One Way minimum (Tariff & Operations v2.0); it is only saved when the admin saves.
  return { owMin: str(t?.oneWay?.minKm) || "130", airC: str(t?.airport?.customerBase), airP: str(t?.airport?.partnerBase), rows };
}

const toNum = (s: string) => (s.trim() === "" ? NaN : Number(s));
/** Comparable form: numbers, so "15.50" and "15.5" are the same value. */
const canon = (f: Form) => JSON.stringify([toNum(f.owMin) || null, toNum(f.airC) || null, toNum(f.airP) || null, TARIFF_CLASSES.map((c) => ROW_KEYS.map((k) => (f.rows[c][k].trim() === "" ? null : toNum(f.rows[c][k]))))]);
const isBlank = (r: Row) => ROW_KEYS.every((k) => r[k].trim() === "");

/**
 * Base rates & partner payout: the customer and normal-partner rates by vehicle category, the outstation
 * extra usage defaults and the airport fare. Saved only through the server as one new tariff version
 * (audited, with a stale-edit check). A new tariff affects NEW quotes; a confirmed booking keeps its snapshot.
 */
export default function TariffConfigCard({ onDirtyChange, onBusyChange }: { onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void } = {}) {
  const canEdit = useCan("pricing");
  const { tariff: t, error: loadError } = useTariff();
  const [form, setForm] = useState<Form>(() => fromTariff(null));
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [zone, setZone] = useState({ name: "", lat: "", lng: "", radius: "" });

  const savedVersion = t?.version ?? 0;
  const saved = useMemo(() => canon(fromTariff(t ?? null)), [t]);
  const dirty = t !== undefined && canon(form) !== saved;
  // Load the saved values once, and again whenever the saved tariff moves on while nothing is being edited.
  useEffect(() => {
    if (t === undefined) return;
    if (loadedVersion === null || (!dirty && loadedVersion !== savedVersion)) {
      setForm(fromTariff(t));
      setLoadedVersion(savedVersion);
    }
  }, [t, dirty, loadedVersion, savedVersion]);
  const stale = loadedVersion !== null && loadedVersion !== savedVersion && dirty;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch: Partial<Omit<Form, "rows">>) => { setForm((f) => ({ ...f, ...patch })); setMsg(null); };
  const setCell = (c: TariffClass, k: RowKey, v: string) => { setForm((f) => ({ ...f, rows: { ...f.rows, [c]: { ...f.rows[c], [k]: v } } })); setMsg(null); };

  /** The same rules the server enforces; the server is still the authority. */
  const problem = useMemo((): string | null => {
    const min = toNum(form.owMin);
    if (!(min > 0)) return "Enter the One Way minimum kilometres.";
    const air = [form.airC, form.airP];
    if (air.some((v) => v.trim() !== "") && !air.every((v) => toNum(v) > 0)) return "Enter both the airport customer base fare and the partner base payout, or leave both empty.";
    for (const c of TARIFF_CLASSES) {
      const r = form.rows[c];
      const savedHere = !!t?.oneWay?.classes?.[c] || !!t?.roundTrip?.classes?.[c];
      if (isBlank(r)) {
        if (savedHere && !FALLS_BACK_TO_SUV(c)) return `${CLASS_LABEL[c]} rates cannot be cleared once saved. Enter its rates.`;
        continue;
      }
      for (const [k, label, , zeroOk] of ALL_COLS) {
        const v = toNum(r[k]);
        if (!Number.isFinite(v)) return `${CLASS_LABEL[c]}: enter ${label.toLowerCase()}.`;
        if (zeroOk ? v < 0 : v <= 0) return `${CLASS_LABEL[c]}: ${label.toLowerCase()} must be ${zeroOk ? "zero or more" : "more than zero"}.`;
      }
    }
    return null;
  }, [form, t]);

  const reasonOk = reason.trim().length >= 5;
  const locked = !canEdit || busy || t === undefined || !!loadError;

  const save = async () => {
    if (locked || !dirty || problem || stale || busy) return;
    if (!reasonOk) return setMsg({ tone: "error", text: "Give a short reason for the change." });
    const classes: Record<string, unknown> = {};
    for (const c of TARIFF_CLASSES) {
      const r = form.rows[c], n = (k: RowKey) => toNum(r[k]);
      if (isBlank(r)) {
        if (FALLS_BACK_TO_SUV(c) && (t?.oneWay?.classes?.[c] || t?.roundTrip?.classes?.[c] || t?.outstationExtras?.[c] || t?.oneWayExtras?.[c] || t?.roundTripExtras?.[c])) classes[c] = null;
        continue;
      }
      classes[c] = {
        oneWay: { customerRate: n("cOW"), partnerRate: n("pOW"), customerBata: n("cAllowOW"), partnerBata: n("pAllowOW") },
        roundTrip: { customerRate: n("cRT"), partnerRate: n("pRT"), customerBata: n("cAllowRT"), partnerBata: n("pAllowRT"), minKmPerDay: n("rtMin") },
        oneWayExtra: { extraKmRate: n("extraKmOW"), waitingPerHour: n("waitingOW") },
        roundTripExtra: { extraKmRate: n("extraKmRT"), waitingPerHour: n("waitingRT") },
      };
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveTariffSection({
        section: "baseRates", expectedVersion: loadedVersion ?? 0, reason: reason.trim(),
        data: { oneWayMinKm: toNum(form.owMin), ...(form.airC.trim() ? { airport: { customerBase: toNum(form.airC), partnerBase: toNum(form.airP) } } : {}), classes },
      });
      setLoadedVersion(r.version);
      setReason("");
      setMsg({ tone: "ok", text: `Saved as tariff version ${r.version}. New quotes use these rates; confirmed bookings keep the fare they were quoted.` });
    } catch (e) {
      // The entered values stay in the form so nothing has to be typed again.
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The tariff was not saved." });
    } finally {
      setBusy(false);
    }
  };

  const switchTariff = async (enabled: boolean) => {
    if (locked || dirty) return;
    if (!reasonOk) return setMsg({ tone: "error", text: "Give a short reason for the change." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveTariffConfig({ keepSavedRates: true, enabled, reason: reason.trim(), expectedVersion: savedVersion });
      setReason("");
      setMsg({ tone: "ok", text: `Saved as version ${r.version}. ${r.enabled ? "New One Way and Round Trip bookings are priced by this tariff." : "The confirmed tariff is off; vehicle category fares apply to those bookings."}` });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The tariff was not saved." });
    } finally {
      setBusy(false);
    }
  };

  const loadDefaults = async () => {
    if (locked || dirty) return;
    if (!reasonOk) return setMsg({ tone: "error", text: "Give a short reason for the change." });
    if (!window.confirm("Replace the saved One Way, Round Trip, rental-time and city-drop rates with the documented defaults of 09 Oct 2026? Local Pickup & Drop fares, rental packages and outstation extras are kept.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveTariffConfig({ useConfirmedDefaults: true, enabled: t?.enabled === true, reason: reason.trim(), expectedVersion: savedVersion, cityDrop: { zones: t?.cityDrop?.zones ?? [] } });
      setReason("");
      setMsg({ tone: "ok", text: `Documented defaults saved as version ${r.version}.` });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The defaults were not saved." });
    } finally {
      setBusy(false);
    }
  };

  const saveZones = async (zones: Zone[]) => {
    if (locked || dirty) return;
    if (!reasonOk) return setMsg({ tone: "error", text: "Give a short reason for the change." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveTariffConfig({ keepSavedRates: true, enabled: t?.enabled === true, reason: reason.trim(), expectedVersion: savedVersion, cityDrop: { zones } });
      setReason("");
      setZone({ name: "", lat: "", lng: "", radius: "" });
      setMsg({ tone: "ok", text: `City zones saved as version ${r.version}.` });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The zones were not saved." });
    } finally {
      setBusy(false);
    }
  };

  const addZone = () => {
    const lat = Number(zone.lat), lng = Number(zone.lng), r = Number(zone.radius);
    if (!zone.name.trim() || !zone.lat.trim() || !zone.lng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || !(r > 0)) return setMsg({ tone: "error", text: "Enter the city name, its centre latitude / longitude and a radius in km." });
    const id = zone.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    void saveZones([...(t?.cityDrop?.zones ?? []).filter((z) => z.id !== id), { id, name: zone.name.trim(), lat, lng, radiusKm: r }]);
  };

  const zones = t?.cityDrop?.zones ?? [];
  const cell = (c: TariffClass, [k, label, unit]: [RowKey, string, string, boolean]) => (
    <td key={k} className="px-2 py-1.5">
      <input
        type="number" inputMode="decimal" min={0} step="0.01" value={form.rows[c][k]} disabled={locked}
        onChange={(e) => setCell(c, k, e.target.value)} aria-label={`${CLASS_LABEL[c]} · ${label} (${unit})`}
        placeholder={FALLS_BACK_TO_SUV(c) ? "SUV rate" : "Not configured"} className={`${inputCls} w-[104px] tabular-nums`}
      />
    </td>
  );
  const head = (cols: [RowKey, string, string, boolean][]) => cols.map(([k, label, unit]) => (
    <th key={k} scope="col" className="px-2 py-2 text-left text-[11px] font-semibold text-muted align-bottom min-w-[112px]">{label}<span className="block font-normal text-faint">{unit}</span></th>
  ));
  const table = (caption: string, cols: [RowKey, string, string, boolean][], min: number) => (
    <div className="overflow-auto max-h-[56vh] rounded-lg border border-line">
      <table className="w-full text-[12px]" style={{ minWidth: min }}>
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-neutral-bg"><tr><th scope="col" className="sticky left-0 z-20 bg-neutral-bg px-3 py-2 text-left text-[11px] font-semibold text-muted align-bottom min-w-[130px]">Vehicle category</th>{head(cols)}</tr></thead>
        <tbody>{TARIFF_CLASSES.map((c) => (
          <tr key={c} className="border-t border-line-soft">
            <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-semibold text-ink">
              {CLASS_LABEL[c]}
              {FALLS_BACK_TO_SUV(c) && <span className="block text-[11px] font-normal text-muted">{isBlank(form.rows[c]) ? "Uses the SUV 6+1 rates" : "Own rates"}</span>}
            </th>
            {cols.map((col) => cell(c, col))}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <section className="space-y-5" aria-labelledby="tariff-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="tariff-h" className="text-[16px] font-bold text-ink">Base rates &amp; partner payout</h2>
          <p className="text-sm text-muted">Customer and normal-partner rates by vehicle category. Saved as a new tariff version; confirmed bookings keep the fare they were quoted.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-amber-50 text-amber-800 border-amber-300">Unsaved changes</span>}
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${t?.enabled ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>
            {t === undefined ? "Loading…" : t === null ? "Nothing saved yet" : t.enabled ? `On · version ${t.version}` : `Off · version ${t.version} — category fares apply`}
          </span>
        </div>
      </div>

      {loadError && <Notice tone="error">The tariff could not be loaded: {loadError}. Check your pricing access and reload.</Notice>}
      {t === undefined && !loadError && <p className="text-[12px] text-muted" role="status">Loading the saved tariff…</p>}
      {stale && <Notice tone="warn">The tariff was changed by someone else (now version {savedVersion}). Your edits were made on version {loadedVersion}. <button type="button" className="underline font-semibold" onClick={() => { setForm(fromTariff(t ?? null)); setLoadedVersion(savedVersion); setMsg(null); }}>Discard my edits and reload</button></Notice>}
      {!canEdit && t !== undefined && <Notice tone="info">You can view the tariff. Changing it needs pricing access.</Notice>}

      {t !== undefined && !loadError && (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="One Way minimum kilometres" required hint="km — applies to One Way outstation only"><input type="number" min={0} step="0.1" value={form.owMin} disabled={locked} onChange={(e) => set({ owMin: e.target.value })} className={`${inputCls} tabular-nums`} /></Field>
            <Field label="Airport customer base fare" hint="₹ — saved; quotes use it once the airport formula is confirmed"><input type="number" min={0} step="0.01" value={form.airC} disabled={locked} placeholder="Not configured" onChange={(e) => set({ airC: e.target.value })} className={`${inputCls} tabular-nums`} /></Field>
            <Field label="Airport partner base payout" hint="₹ — saved; not yet applied to quotes"><input type="number" min={0} step="0.01" value={form.airP} disabled={locked} placeholder="Not configured" onChange={(e) => set({ airP: e.target.value })} className={`${inputCls} tabular-nums`} /></Field>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[13px] font-bold text-ink">Rates by vehicle category</h3>
            {table("Customer and partner rates by vehicle category", RATE_COLS, 1180)}
            <p className="text-xs text-muted">Innova uses the SUV rates until its own are entered; clear the whole Innova row to go back to the SUV rates. One Way and Round Trip keep separate allowances.</p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[13px] font-bold text-ink">One Way extra usage</h3>
            <p className="text-xs text-muted">Extra kilometre and waiting rates for One Way trips only. Existing shared rates apply until separate rates are saved. Confirmed bookings retain their saved rates.</p>
            {table("One Way customer extra usage charges by vehicle category", EXTRA_OW_COLS, 520)}
          </div>
          <div className="space-y-1.5">
            <h3 className="text-[13px] font-bold text-ink">Round Trip extra usage</h3>
            <p className="text-xs text-muted">Extra kilometre and waiting rates for Round Trip trips only, separate from One Way and local usage rates.</p>
            {table("Round Trip customer extra usage charges by vehicle category", EXTRA_RT_COLS, 520)}
          </div>
        </>
      )}

      {canEdit && t !== undefined && !loadError && (
        <div className="space-y-3">
          <Field label="Reason for this change" required error={dirty && !reasonOk ? "Give a short reason for the change." : null}>
            <input value={reason} disabled={busy} maxLength={300} onChange={(e) => { setReason(e.target.value); setMsg(null); }} className={inputCls} placeholder="e.g. Confirmed rates of 09 Oct 2026" />
          </Field>
          {dirty && problem && <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={locked || !dirty || !!problem || stale || !reasonOk} onClick={save} className={primaryBtn}>{busy ? "Saving…" : "Save new tariff version"}</button>
            <button type="button" disabled={busy || !dirty} onClick={() => { setForm(fromTariff(t ?? null)); setMsg(null); }} className={secondaryBtn}>Discard changes</button>
          </div>

          <details className="rounded-lg border border-line p-3">
            <summary className="text-sm font-semibold cursor-pointer">Tariff switch, documented defaults and city zones</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted">{dirty ? "Save or discard your edits first. " : ""}These use the reason above and change only what they say.</p>
              <div className="flex flex-wrap gap-2">
                {t?.enabled
                  ? <button type="button" disabled={locked || dirty || !reasonOk} onClick={() => switchTariff(false)} className={secondaryBtn}>Turn the confirmed tariff off</button>
                  : <button type="button" disabled={locked || dirty || !reasonOk || t === null} onClick={() => switchTariff(true)} className={primaryBtn}>Turn the confirmed tariff on</button>}
                <button type="button" disabled={locked || dirty || !reasonOk} onClick={loadDefaults} className={secondaryBtn}>Load documented defaults</button>
              </div>
              <Notice tone="info">
                <div className="text-xs space-y-1">
                  <div><strong>Not quoted as bookable (decision pending):</strong> state entry charges where a rate is missing, same-day multi-city, fixed-route zones.</div>
                  <div><strong>City drop zones:</strong> {zones.length ? zones.map((z) => z.name).join(", ") : "none configured, so local trips use Local Pickup & Drop fares or vehicle category fares"}.</div>
                </div>
              </Notice>
              <div className="grid sm:grid-cols-4 gap-2">
                <Field label="City"><input value={zone.name} onChange={(e) => setZone({ ...zone, name: e.target.value })} className={inputCls} /></Field>
                <Field label="Centre latitude"><input value={zone.lat} onChange={(e) => setZone({ ...zone, lat: e.target.value })} inputMode="decimal" className={inputCls} /></Field>
                <Field label="Centre longitude"><input value={zone.lng} onChange={(e) => setZone({ ...zone, lng: e.target.value })} inputMode="decimal" className={inputCls} /></Field>
                <Field label="Radius (km)"><input value={zone.radius} onChange={(e) => setZone({ ...zone, radius: e.target.value })} inputMode="decimal" className={inputCls} /></Field>
              </div>
              <button type="button" disabled={locked || dirty || !reasonOk} onClick={addZone} className={secondaryBtn}>Save city zone</button>
            </div>
          </details>
        </div>
      )}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
    </section>
  );
}
