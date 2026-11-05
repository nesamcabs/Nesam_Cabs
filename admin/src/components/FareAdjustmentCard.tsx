import { useEffect, useState } from "react";
import { subscribeToDocument } from "../services/adminFirestoreService";
import { saveFareAdjustment } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useCan } from "./AccessContext";
import { Field, Notice, inputCls, primaryBtn } from "./FormKit";
import { isoDateIST } from "../utils/time";

interface Stored {
  enabled: boolean;
  name: string;
  direction: "increase" | "decrease";
  percent: number;
  startDate: string;
  endDate: string;
  reason: string;
  version: number;
  updatedByName?: string;
}

/** Effective now, on the India calendar. */
function status(s: Stored | null, today: string): { label: string; tone: "ok" | "warn" | "off" } {
  if (!s || !s.enabled || !(s.percent > 0)) return { label: "Not active", tone: "off" };
  if (s.startDate && today < s.startDate) return { label: `Scheduled from ${s.startDate}`, tone: "warn" };
  if (s.endDate && today > s.endDate) return { label: "Ended", tone: "off" };
  return { label: "Active now", tone: "ok" };
}

/**
 * One percentage adjustment applied to the package fare of every vehicle
 * category (festival pricing, a promotional reduction…). It is applied once to
 * the base package — never compounded — and each booking shows it as its own line.
 */
export default function FareAdjustmentCard() {
  const canEdit = useCan("pricing");
  const [stored, setStored] = useState<Stored | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ enabled: false, name: "", direction: "increase" as "increase" | "decrease", percent: "", startDate: "", endDate: "", reason: "" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(
    () =>
      subscribeToDocument<Stored>("business_config/fare_adjustment", (d) => {
        setStored(d);
        setError(null);
        if (!dirty) setForm({ enabled: d?.enabled ?? false, name: d?.name ?? "", direction: d?.direction ?? "increase", percent: d ? String(d.percent) : "", startDate: d?.startDate ?? "", endDate: d?.endDate ?? "", reason: d?.reason ?? "" });
      }, setError),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
    setMsg(null);
  };

  const pct = Number(form.percent);
  const problem =
    form.percent.trim() !== "" && (!Number.isFinite(pct) || pct < 0 || pct > 100) ? "Enter a percentage from 0 to 100."
    : form.direction === "decrease" && pct >= 100 ? "A decrease must be below 100%."
    : form.endDate && form.startDate && form.endDate < form.startDate ? "The end date is before the start date."
    : form.enabled && !form.name.trim() ? "Give the adjustment a name, e.g. “Festival pricing”."
    : form.enabled && !(pct > 0) ? "Enter the percentage."
    : form.enabled && form.reason.trim().length < 5 ? "Give a short reason."
    : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveFareAdjustment({
        enabled: form.enabled, name: form.name.trim(), direction: form.direction, percent: Number.isFinite(pct) ? pct : 0,
        startDate: form.startDate, endDate: form.endDate, reason: form.reason.trim(), expectedVersion: stored?.version ?? 0,
      });
      setDirty(false);
      setMsg({ tone: "ok", text: form.enabled ? "Saved. New bookings use this adjustment from now on; existing bookings keep the fare they were booked at." : "Saved. The adjustment is switched off." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The adjustment was not saved." });
    } finally {
      setBusy(false);
    }
  };

  const st = status(stored ?? null, isoDateIST(new Date()));
  const example = form.percent && Number.isFinite(pct) ? Math.round(10000 * (1 + (form.direction === "increase" ? 1 : -1) * (pct / 100))) : null;

  return (
    <section className="bg-white rounded-2xl border border-line shadow-sm p-5 space-y-4" aria-label="Global fare adjustment">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">Global fare adjustment</h2>
          <p className="text-sm text-muted">Raise or lower every vehicle category’s package fare by a percentage.</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${st.tone === "ok" ? "bg-green-50 text-green-800 border-green-300" : st.tone === "warn" ? "bg-amber-50 text-amber-900 border-amber-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>
          {stored === undefined ? "Loading…" : st.label}
        </span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {stored?.enabled && st.tone === "ok" && (
        <Notice tone="info"><strong>{stored.name}</strong>: {stored.direction === "increase" ? "+" : "−"}{stored.percent}% is being applied to all new bookings{stored.endDate ? ` until ${stored.endDate}` : ""}. It appears as its own line on each booking’s fare.</Notice>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold text-body sm:col-span-2 lg:col-span-4">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} disabled={!canEdit} className="w-4 h-4 accent-brand" />
          Adjustment is on
        </label>
        <Field label="Name" hint="Shown on the fare, e.g. Festival pricing"><input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={80} disabled={!canEdit} className={inputCls} /></Field>
        <Field label="Direction">
          <select value={form.direction} onChange={(e) => set("direction", e.target.value as "increase" | "decrease")} disabled={!canEdit} className={inputCls}>
            <option value="increase">Increase (+)</option>
            <option value="decrease">Decrease (−)</option>
          </select>
        </Field>
        <Field label="Percentage" hint={example !== null ? `Example: a ₹10,000 package becomes ₹${example.toLocaleString("en-IN")}` : undefined}>
          <input value={form.percent} onChange={(e) => set("percent", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" disabled={!canEdit} className={inputCls} />
        </Field>
        <Field label="Reason"><input value={form.reason} onChange={(e) => set("reason", e.target.value)} maxLength={300} disabled={!canEdit} className={inputCls} /></Field>
        <Field label="Start date" hint="Optional"><input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} disabled={!canEdit} className={inputCls} /></Field>
        <Field label="End date" hint="Optional"><input type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} disabled={!canEdit} className={inputCls} /></Field>
      </div>
      {problem && dirty && <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
      <div className="flex items-center gap-3">
        {canEdit ? <button onClick={save} disabled={!dirty || !!problem || busy} className={primaryBtn}>{busy ? "Saving…" : "Save adjustment"}</button> : <span className="text-sm text-muted">Changing this needs pricing access.</span>}
        {stored?.updatedByName && <span className="text-xs text-muted">Last changed by {stored.updatedByName} (version {stored.version}).</span>}
      </div>
      <p className="text-xs text-muted">The adjustment applies once to the package total — it is never added on top of an earlier adjustment. A discount, if given, is taken off after it.</p>
    </section>
  );
}
