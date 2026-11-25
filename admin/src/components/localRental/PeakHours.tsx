import { useEffect, useMemo, useState } from "react";
import { geoScopeOf, scopeKeyOf, type LocSel } from "../../domain/locationHierarchy";
import { DAY_SHORT, WEEK, daysText, minutesOf, overlapsWith, slotsText } from "../../domain/peakSchedule";
import { savePeakRule, type GeoService, type PeakRule } from "../../services/geoFareService";
import { Button, Icon } from "../ui";
import { Footer, Hint, Panel, Pill } from "./ui";

type Form = { id?: string; version?: number; name: string; enabled: boolean; days: number[]; slots: { start: string; end: string }[]; from: string; until: string; type: "percent" | "fixed"; value: string; cap: string; priority: string };
const blank = (): Form => ({ name: "", enabled: false, days: [], slots: [{ start: "", end: "" }], from: "", until: "", type: "percent", value: "", cap: "", priority: "" });

/**
 * Scheduled peak pricing for Local Pickup & Drop or Hourly Rental (each its own rules). A rule applies to the place chosen in the
 * location selector (everywhere, a state, a district, a zone or an area), on the chosen weekdays and time windows (minute precision,
 * IST), between optional dates, as a percentage or fixed extra with an optional cap. Quotes match it on the scheduled pickup time.
 * New rules start switched off; nothing is enabled automatically. Overlaps of the same place and priority are refused.
 */
export default function PeakHours({ brand, service, serviceText, sel, rules, rulesError, canEdit, onToast, scopeText, placeLabel, labelOfKey }: {
  brand: string; service: GeoService; serviceText: string; sel: LocSel; rules: PeakRule[] | null; rulesError: string | null; canEdit: boolean;
  onToast: (t: string) => void; scopeText: (target: string) => string; placeLabel: string; labelOfKey: (key: string, saved?: string) => string;
}) {
  const brandId = brand === "common" ? "" : brand;
  const [f, setF] = useState<Form>(blank);
  const [checked, setChecked] = useState<"no" | "ok" | string>("no");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [removing, setRemoving] = useState<PeakRule | null>(null);
  useEffect(() => { setF(blank()); setChecked("no"); setMessage(null); }, [brand, service]);
  const set = (p: Partial<Form>) => { setF((x) => ({ ...x, ...p })); setChecked("no"); setMessage(null); };
  const scope = geoScopeOf(sel);
  const key = scopeKeyOf(scope);
  const mine = useMemo(() => (rules ?? []).filter((r) => (r.brand ?? "") === brandId), [rules, brandId]);
  const shared = useMemo(() => (rules ?? []).filter((r) => brandId && !r.brand), [rules, brandId]);

  const problem = (() => {
    if (!f.name.trim()) return "Enter a rule name.";
    if (!f.days.length) return "Choose at least one day.";
    for (const s of f.slots) {
      if (!Number.isFinite(minutesOf(s.start)) || !Number.isFinite(minutesOf(s.end))) return "Enter the start and end of every time window.";
      if (s.start === s.end) return "A time window must end at a different time than it starts.";
    }
    if (f.from && f.until && f.until < f.from) return "The until date must be on or after the effective-from date.";
    const v = Number(f.value);
    if (!(f.value.trim() && Number.isFinite(v) && v > 0)) return "Enter the adjustment value (more than zero).";
    if (f.type === "percent" && v > 200) return "A percentage above 200% is not allowed.";
    if (f.cap.trim() && !(Number(f.cap) > 0)) return "Enter a maximum extra above zero, or leave it empty.";
    const p = Number(f.priority);
    if (!Number.isInteger(p) || p < 1 || p > 99) return "Set a priority from 1 to 99.";
    return "";
  })();
  const draft = { id: f.id, brand: brandId, service, scopeKey: key, enabled: f.enabled, days: f.days, slots: f.slots, from: f.from, until: f.until, priority: Number(f.priority), name: f.name };
  const validate = () => {
    if (problem) return setChecked(problem);
    const clash = overlapsWith(draft, mine);
    setChecked(clash.length ? `Overlaps “${clash.map((c) => c.name).join("”, “")}” at the same place and priority.` : "ok");
  };

  const save = async () => {
    if (!canEdit || busy) return;
    if (problem) return setMessage({ ok: false, text: problem });
    const clash = overlapsWith(draft, mine);
    if (clash.length) return setMessage({ ok: false, text: `Overlaps “${clash.map((c) => c.name).join("”, “")}”. Change the days, times, dates or priority.` });
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Enter a reason for this change (at least 5 characters)." });
    setBusy(true); setMessage(null);
    try {
      await savePeakRule({
        ...(f.id ? { id: f.id, expectedVersion: f.version ?? 0 } : {}), brand, service, scope, name: f.name.trim(), enabled: f.enabled, days: f.days, slots: f.slots,
        from: f.from, until: f.until, type: f.type, value: Number(f.value), cap: f.cap.trim() ? Number(f.cap) : null, priority: Number(f.priority), reason: reason.trim(),
      });
      onToast(`Peak rule “${f.name.trim()}” saved${f.enabled ? " and switched on" : " (switched off)"}.`);
      setF(blank()); setReason(""); setChecked("no");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "The peak rule was not saved." });
    } finally { setBusy(false); }
  };
  const edit = (r: PeakRule) => {
    setF({ id: r.id, version: r.version, name: r.name, enabled: r.enabled, days: r.days, slots: r.slots.length ? r.slots : [{ start: "", end: "" }], from: r.from ?? "", until: r.until ?? "", type: r.type, value: String(r.value), cap: r.cap !== undefined ? String(r.cap) : "", priority: String(r.priority) });
    setChecked("no"); setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const remove = async (r: PeakRule) => {
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Enter a reason in the footer before removing a rule." });
    setBusy(true); setMessage(null);
    try { await savePeakRule({ id: r.id, expectedVersion: r.version ?? 0, remove: true, brand, service, reason: reason.trim() }); onToast(`Peak rule “${r.name}” removed.`); setRemoving(null); setReason(""); if (f.id === r.id) setF(blank()); }
    catch (err) { setMessage({ ok: false, text: err instanceof Error ? err.message : "The rule was not removed." }); }
    finally { setBusy(false); }
  };
  const editingOther = f.id && rules?.find((r) => r.id === f.id)?.scopeKey !== key;
  const lbl = "text-[13px] font-semibold text-slate-800";

  return (
    <div className="space-y-4">
      <Panel title={<span className="flex items-center gap-2">Scheduled peak rule <Pill tone={f.id ? "info" : "warn"}>{f.id ? "Editing" : "Draft"}</Pill></span>}
        aside={<label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">Rule enabled <input type="checkbox" role="switch" checked={f.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} /></label>}>
        <div className="grid gap-x-5 gap-y-3 lg:grid-cols-[118px_minmax(0,1.7fr)_118px_minmax(0,1fr)] lg:items-center">
          <span className={lbl}>Rule name <b className="text-red-700">*</b></span>
          <input className="ds-input" value={f.name} maxLength={80} disabled={!canEdit} placeholder="Enter rule name" onChange={(e) => set({ name: e.target.value })} aria-label="Rule name" />
          <span className={lbl}>Service</span><input className="ds-input bg-slate-50" value={serviceText} readOnly aria-label="Service" />

          <span className={lbl}>Days <b className="text-red-700">*</b></span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
            {WEEK.map((d) => {
              const on = f.days.includes(d);
              return <button key={d} type="button" aria-pressed={on} disabled={!canEdit} onClick={() => set({ days: on ? f.days.filter((x) => x !== d) : [...f.days, d] })}
                className={`h-[32px] min-w-[46px] rounded-md border px-2 text-[13px] font-semibold ${on ? "border-[#991b1b] bg-[#991b1b] text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{DAY_SHORT[d]}{on ? " ✓" : ""}</button>;
            })}
          </div>
          <span className={lbl}>Time zone</span><input className="ds-input bg-slate-50" value="IST (Asia/Kolkata)" readOnly aria-label="Time zone" />

          <span className={lbl}>Time windows <b className="text-red-700">*</b></span>
          <div className="space-y-2 lg:col-span-3">
            {f.slots.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-700">Start</span>
                <input type="time" className="ds-input w-[130px]" value={s.start} disabled={!canEdit} aria-label={`Window ${i + 1} start`} onChange={(e) => set({ slots: f.slots.map((x, n) => (n === i ? { ...x, start: e.target.value } : x)) })} />
                <span className="text-slate-500">—</span>
                <span className="text-[13px] font-semibold text-slate-700">End</span>
                <input type="time" className="ds-input w-[130px]" value={s.end} disabled={!canEdit} aria-label={`Window ${i + 1} end`} onChange={(e) => set({ slots: f.slots.map((x, n) => (n === i ? { ...x, end: e.target.value } : x)) })} />
                {s.start && s.end && minutesOf(s.end) <= minutesOf(s.start) && s.start !== s.end && <Pill tone="info">Overnight</Pill>}
                {f.slots.length > 1 && canEdit && <button type="button" className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:text-red-700" aria-label={`Remove window ${i + 1}`} onClick={() => set({ slots: f.slots.filter((_, n) => n !== i) })}><Icon name="trash-2" size={15} /></button>}
                {i === f.slots.length - 1 && canEdit && f.slots.length < 6 && <Button icon="plus" size="sm" onClick={() => set({ slots: [...f.slots, { start: "", end: "" }] })}>Add time window</Button>}
              </div>
            ))}
          </div>

          <span className={lbl}>Effective from</span>
          <input type="date" className="ds-input max-w-[220px]" value={f.from} disabled={!canEdit} onChange={(e) => set({ from: e.target.value })} aria-label="Effective from" />
          <span className={lbl}>Until (optional)</span>
          <input type="date" className="ds-input" value={f.until} min={f.from || undefined} disabled={!canEdit} onChange={(e) => set({ until: e.target.value })} aria-label="Until" />

          <span className={lbl}>Adjustment type <b className="text-red-700">*</b></span>
          <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-slate-50 p-1" role="radiogroup" aria-label="Adjustment type">
            {(["percent", "fixed"] as const).map((t) => <button key={t} type="button" role="radio" aria-checked={f.type === t} disabled={!canEdit} onClick={() => set({ type: t })}
              className={`h-[32px] rounded-md px-4 text-[13px] font-semibold ${f.type === t ? "bg-[#991b1b] text-white" : "text-slate-700"}`}>{t === "percent" ? "Percentage" : "Fixed amount"}</button>)}
          </div>
          <span className={lbl}>Value <b className="text-red-700">*</b></span>
          <div className="relative">
            <input className="ds-input w-full !pr-9 text-right" inputMode="decimal" value={f.value} placeholder="Set" disabled={!canEdit} onChange={(e) => set({ value: e.target.value })} aria-label="Adjustment value" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-slate-500">{f.type === "percent" ? "%" : "₹"}</span>
          </div>

          <span className={lbl}>Maximum extra ₹</span>
          <input className="ds-input max-w-[220px]" inputMode="decimal" value={f.cap} placeholder="Set cap" disabled={!canEdit} onChange={(e) => set({ cap: e.target.value })} aria-label="Maximum extra" />
          <span className={lbl}>Priority <b className="text-red-700">*</b></span>
          <input className="ds-input" inputMode="numeric" value={f.priority} placeholder="Set priority" disabled={!canEdit} onChange={(e) => set({ priority: e.target.value.replace(/\D/g, "") })} aria-label="Priority" />

          <span className={lbl}>Charge basis</span><input className="ds-input bg-slate-50" value="Eligible ride fare only" readOnly aria-label="Charge basis" />
          <span className={lbl}>Partner payout</span><input className="ds-input bg-slate-50" value="Existing configured policy" title="Peak charges do not change the partner payout" readOnly aria-label="Partner payout" />
        </div>
        <div className="mt-3"><Hint>Tolls, parking, airport entry and taxes are excluded from the peak charge. The customer sees the peak charge before confirming; confirmed bookings keep their fare.</Hint></div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={validate} disabled={!canEdit}>Validate overlaps</Button>
          <span className="h-5 w-px bg-slate-300" />
          {checked === "no" ? <span className="flex items-center gap-1.5 text-[13px] text-slate-600"><span className="h-2 w-2 rounded-full bg-slate-400" />Not validated</span>
            : checked === "ok" ? <span className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700"><Icon name="circle-check" size={15} />No overlap at {placeLabel}</span>
            : <span className="flex items-center gap-1.5 text-[13px] font-semibold text-red-700" role="alert"><Icon name="circle-alert" size={15} />{checked}</span>}
          {editingOther && <Pill tone="warn">The location above differs from where this rule was saved: saving moves it there.</Pill>}
          {f.id && <Button size="sm" onClick={() => { setF(blank()); setChecked("no"); }}>New rule instead</Button>}
        </div>
      </Panel>

      <Panel title="Saved rules">
        {rulesError ? <p className="text-[13px] text-red-700" role="alert">Saved peak rules could not be loaded: {rulesError}</p>
          : rules === null ? <p className="text-[13px] text-slate-500" role="status">Loading saved rules…</p>
          : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] text-[13.5px]">
                <thead className="bg-slate-50 text-left text-[12.5px] font-semibold text-slate-700"><tr>
                  <th className="px-3 py-2">Rule</th><th className="px-3 py-2">Days &amp; time</th><th className="px-3 py-2">Scope</th><th className="px-3 py-2">Adjustment</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {!mine.length && !shared.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-600">No peak rules configured.</td></tr>}
                  {[...mine, ...shared].map((r) => {
                    const own = (r.brand ?? "") === brandId;
                    return (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="px-3 py-2"><strong className="text-slate-800">{r.name}</strong><small className="block text-slate-500">Priority {r.priority}{!own ? " · All brands" : ""}</small></td>
                        <td className="px-3 py-2 text-slate-700">{daysText(r.days)}<small className="block text-slate-500">{slotsText(r.slots)}{r.from || r.until ? ` · ${r.from || "…"} → ${r.until || "no end"}` : ""}</small></td>
                        <td className="px-3 py-2 text-slate-700">{labelOfKey(r.scopeKey, r.scope?.label)}</td>
                        <td className="px-3 py-2 text-slate-700">{r.type === "percent" ? `+${r.value}%` : `+₹${r.value}`}{r.cap !== undefined ? <small className="block text-slate-500">cap ₹{r.cap}</small> : null}</td>
                        <td className="px-3 py-2"><Pill tone={r.enabled ? "ok" : "off"}>{r.enabled ? "On" : "Off"}</Pill></td>
                        <td className="px-3 py-2 text-right">
                          {own && canEdit ? (
                            removing?.id === r.id ? (
                              <span className="inline-flex gap-2"><Button size="sm" variant="danger" loading={busy} onClick={() => void remove(r)}>Confirm remove</Button><Button size="sm" onClick={() => setRemoving(null)}>Keep</Button></span>
                            ) : <span className="inline-flex gap-2"><Button size="sm" onClick={() => edit(r)}>Edit</Button><Button size="sm" onClick={() => setRemoving(r)}>Remove</Button></span>
                          ) : <small className="text-slate-500">{own ? "" : "Change under All brands"}</small>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </Panel>
      {canEdit && (
        <Footer scopeText={scopeText(placeLabel)} reason={reason} onReason={setReason} onSave={save} saveLabel={f.id ? "Save changes" : "Save peak rule"} busy={busy}
          disabled={!f.name.trim()} message={message} />
      )}
    </div>
  );
}
