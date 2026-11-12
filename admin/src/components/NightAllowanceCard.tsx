import { useEffect, useState } from "react";
import { subscribeToDocument } from "../services/adminFirestoreService";
import { saveNightAllowance } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useCan } from "./AccessContext";
import { Notice, inputCls, primaryBtn } from "./FormKit";

interface Stored { enabled?: boolean; amount?: number; version?: number; updatedByName?: string }

const MAX_RUPEES = 100000;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * The night allowance, one common setting for every vehicle, brand and service: a fixed amount added automatically to a booking
 * whose pickup is between 11:00 PM and 6:00 AM (India time), shown to the customer as its own "Night allowance" line.
 */
export default function NightAllowanceCard() {
  const canEdit = useCan("pricing");
  const [stored, setStored] = useState<Stored | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [amount, setAmount] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(
    () =>
      subscribeToDocument<Stored>("business_config/night_allowance", (d) => {
        setStored(d);
        setError(null);
        if (!dirty) {
          setEnabled(d?.enabled === true);
          setAmount(d?.amount ? String(d.amount) : "");
        }
      }, setError),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const value = Number(amount);
  const problem =
    amount.trim() !== "" && (!Number.isFinite(value) || value < 0 || value > MAX_RUPEES) ? `Enter an amount from 0 to ${MAX_RUPEES.toLocaleString("en-IN")} rupees.`
    : enabled && !(value > 0) ? "Enter an amount above zero, or switch the night allowance off."
    : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await saveNightAllowance({ enabled, amount: Number.isFinite(value) ? value : 0, expectedVersion: stored?.version ?? 0 });
      setDirty(false);
      setMsg({ tone: "ok", text: enabled ? "Saved. New quotes and bookings with a pickup between 11:00 PM and 6:00 AM include this amount; existing bookings keep the fare they were booked at." : "Saved. The night allowance is switched off." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The night allowance was not saved." });
    } finally {
      setBusy(false);
    }
  };

  const active = stored?.enabled === true && (stored.amount ?? 0) > 0;

  return (
    <section className="bg-white rounded-2xl border border-line shadow-sm p-5 space-y-4" aria-label="Night allowance">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">Night allowance</h2>
          <p className="text-sm text-muted">One common amount for every vehicle and every brand.</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${active ? "bg-green-50 text-green-800 border-green-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>
          {stored === undefined ? "Loading…" : active ? `On · ${inr(stored?.amount ?? 0)}` : "Off"}
        </span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="rounded-xl border border-line bg-gray-50 px-3 py-2 text-sm grid gap-1 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-4">
        <strong className="text-ink">11:00 PM – 6:00 AM</strong>
        <span className="text-muted">Added automatically to a booking whose pickup time falls in this window (India time), on every service.</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-end max-w-xl">
        <label className="flex items-center gap-2 text-sm font-semibold text-body pb-2.5">
          <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setDirty(true); setMsg(null); }} disabled={!canEdit} className="w-4 h-4 accent-brand" />
          Night allowance is on
        </label>
        <label className="block text-xs font-semibold">Amount (INR per booking)
          <input value={amount} onChange={(e) => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setDirty(true); setMsg(null); }} inputMode="decimal" placeholder="0" disabled={!canEdit} className={`${inputCls} mt-1`} />
        </label>
      </div>

      {problem && dirty && <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? <button onClick={save} disabled={!dirty || !!problem || busy} className={primaryBtn}>{busy ? "Saving…" : "Save night allowance"}</button> : <span className="text-sm text-muted">Changing this needs pricing access.</span>}
        {stored?.updatedByName && <span className="text-xs text-muted">Last changed by {stored.updatedByName} (version {stored.version}).</span>}
      </div>
      <p className="text-xs text-muted">It follows the booking’s GST setting like the roof carrier charge: with GST added on top, the amount you enter is before GST; with GST included, it is what the customer pays. The platform fee, if on, is worked out on the fare including the night allowance.</p>
    </section>
  );
}
