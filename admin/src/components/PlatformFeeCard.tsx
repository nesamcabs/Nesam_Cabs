import { useEffect, useState } from "react";
import { subscribeToDocument } from "../services/adminFirestoreService";
import { savePlatformFee } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useCan } from "./AccessContext";
import { Notice, inputCls, primaryBtn } from "./FormKit";

/** The services a platform fee can be set for. Keep in step with functions/src/domain/platformFee.ts. */
const SERVICES = [
  { id: "outstation", label: "Outstation", hint: "One Way and Round Trip" },
  { id: "local", label: "Local Pickup & Drop", hint: "Trips inside one city" },
  { id: "rental", label: "Local Rental", hint: "Hourly packages" },
  { id: "airport", label: "Airport Taxi", hint: "Airport transfers" },
  { id: "multicity", label: "Multicity", hint: "Tours through several cities" },
] as const;
type ServiceId = (typeof SERVICES)[number]["id"];

interface Rule { enabled: boolean; percent: string; min: string; cap: string }
type Form = Record<ServiceId, Rule>;
interface Stored { version: number; services?: Partial<Record<ServiceId, { enabled?: boolean; percent?: number; min?: number; cap?: number }>>; updatedByName?: string }

const SUGGESTED = { percent: "5", min: "50", cap: "250" };
const MAX_RUPEES = 100000;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const blank = (): Form => Object.fromEntries(SERVICES.map((s) => [s.id, { enabled: false, ...SUGGESTED }])) as Form;
const fromStored = (d: Stored | null | undefined): Form => {
  const f = blank();
  for (const s of SERVICES) {
    const r = d?.services?.[s.id];
    if (r) f[s.id] = { enabled: r.enabled === true, percent: String(r.percent ?? SUGGESTED.percent), min: String(r.min ?? SUGGESTED.min), cap: String(r.cap ?? SUGGESTED.cap) };
  }
  return f;
};

/** The fee for a fare, exactly as the server works it out (percent of the fare, at least the minimum, at most the cap; cap 0 = none). */
function feeFor(r: Rule, fare: number): number {
  const percent = Number(r.percent), min = Number(r.min), cap = Number(r.cap);
  if (![percent, min, cap].every(Number.isFinite) || !(fare > 0)) return 0;
  let fee = Math.round(((fare * percent) / 100 + Number.EPSILON) * 100) / 100;
  if (fee < min) fee = min;
  if (cap > 0 && fee > cap) fee = cap;
  return Math.round(fee);
}

const describe = (r: Rule) => {
  const parts = [`${Number(r.percent) || 0}%`];
  const min = Number(r.min), cap = Number(r.cap);
  const tail = [min > 0 ? `${inr(min)} minimum` : "", cap > 0 ? `${inr(cap)} cap` : ""].filter(Boolean).join(" and ");
  return tail ? `${parts[0]} with ${tail}` : parts[0];
};

function problemOf(f: Form): string | null {
  for (const s of SERVICES) {
    const r = f[s.id];
    const percent = Number(r.percent), min = Number(r.min), cap = Number(r.cap);
    if (r.percent.trim() === "" || !Number.isFinite(percent) || percent < 0 || percent > 100) return `${s.label}: enter a percentage from 0 to 100.`;
    if (r.min.trim() === "" || !Number.isFinite(min) || min < 0 || min > MAX_RUPEES) return `${s.label}: enter the minimum fee in rupees (0 for none).`;
    if (r.cap.trim() === "" || !Number.isFinite(cap) || cap < 0 || cap > MAX_RUPEES) return `${s.label}: enter the maximum fee in rupees (0 for no maximum).`;
    if (r.enabled && percent <= 0 && min <= 0) return `${s.label}: set a percentage or a minimum fee above zero, or switch it off.`;
    if (cap > 0 && cap < min) return `${s.label}: the maximum cannot be lower than the minimum.`;
  }
  return null;
}

/**
 * The platform fee, one common setting for every brand: for each service, a hybrid fee of a percentage of the fare, never below a
 * minimum and never above a cap. It is added to new bookings automatically and shown to the customer as its own "Platform fee" line.
 */
export default function PlatformFeeCard() {
  const canEdit = useCan("pricing");
  const [stored, setStored] = useState<Stored | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [sample, setSample] = useState("5000");

  useEffect(
    () =>
      subscribeToDocument<Stored>("business_config/platform_fee", (d) => {
        setStored(d);
        setError(null);
        if (!dirty) setForm(fromStored(d));
      }, setError),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const set = (id: ServiceId, patch: Partial<Rule>) => {
    setForm((f) => ({ ...f, [id]: { ...f[id], ...patch } }));
    setDirty(true);
    setMsg(null);
  };
  const number = (v: string) => v.replace(/[^\d.]/g, "");

  const problem = problemOf(form);
  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await savePlatformFee({
        services: Object.fromEntries(SERVICES.map((s) => [s.id, { enabled: form[s.id].enabled, percent: Number(form[s.id].percent), min: Number(form[s.id].min), cap: Number(form[s.id].cap) }])),
        expectedVersion: stored?.version ?? 0,
      });
      setDirty(false);
      setMsg({ tone: "ok", text: "Saved. New quotes and bookings use these fees from now on; existing bookings keep the fee they were booked with." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The platform fee was not saved." });
    } finally {
      setBusy(false);
    }
  };

  const fare = Number(sample);
  const activeCount = SERVICES.filter((s) => form[s.id].enabled).length;

  return (
    <section className="bg-white rounded-2xl border border-line shadow-sm p-5 space-y-4" aria-label="Platform fee">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-ink">Platform fee</h2>
          <p className="text-sm text-muted">One common setting for every brand. Switch it on for the services that should carry a fee.</p>
        </div>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${activeCount ? "bg-green-50 text-green-800 border-green-300" : "bg-gray-100 text-gray-700 border-gray-300"}`}>
          {stored === undefined ? "Loading…" : activeCount ? `On for ${activeCount} of ${SERVICES.length} services` : "Off for all services"}
        </span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <div className="rounded-xl border border-line bg-gray-50 px-3 py-2 text-sm grid gap-1 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:gap-4">
        <strong className="text-ink">Hybrid</strong>
        <span className="text-muted">Combines vehicle, distance and fare: a percentage of the fare, kept between a minimum and a cap.</span>
        <span className="font-semibold text-body">5% with ₹50 minimum and ₹250 cap</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="pf-sample" className="font-semibold text-body">Preview with a fare of ₹</label>
        <input id="pf-sample" value={sample} onChange={(e) => setSample(number(e.target.value))} inputMode="decimal" className={`${inputCls} w-28`} />
        <span className="text-xs text-muted">The fee is worked out on the fare before GST, including any night allowance and add-ons.</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-bold">Service</th>
              <th className="py-2 pr-3 font-bold">On</th>
              <th className="py-2 pr-3 font-bold">% of fare</th>
              <th className="py-2 pr-3 font-bold">Minimum ₹</th>
              <th className="py-2 pr-3 font-bold">Maximum ₹</th>
              <th className="py-2 font-bold">Preview</th>
            </tr>
          </thead>
          <tbody>
            {SERVICES.map((s) => {
              const r = form[s.id];
              return (
                <tr key={s.id} className="border-t border-line align-middle">
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold text-ink">{s.label}</div>
                    <div className="text-xs text-muted">{s.hint}</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => set(s.id, { enabled: e.target.checked })} disabled={!canEdit} aria-label={`Platform fee on for ${s.label}`} className="w-4 h-4 accent-brand" />
                  </td>
                  <td className="py-2.5 pr-3"><input value={r.percent} onChange={(e) => set(s.id, { percent: number(e.target.value) })} inputMode="decimal" disabled={!canEdit} aria-label={`${s.label} percentage`} className={`${inputCls} w-20`} /></td>
                  <td className="py-2.5 pr-3"><input value={r.min} onChange={(e) => set(s.id, { min: number(e.target.value) })} inputMode="decimal" disabled={!canEdit} aria-label={`${s.label} minimum`} className={`${inputCls} w-24`} /></td>
                  <td className="py-2.5 pr-3"><input value={r.cap} onChange={(e) => set(s.id, { cap: number(e.target.value) })} inputMode="decimal" disabled={!canEdit} aria-label={`${s.label} maximum`} className={`${inputCls} w-24`} /></td>
                  <td className="py-2.5 text-xs">
                    {r.enabled ? (
                      <span className="text-body"><strong className="text-ink">{inr(feeFor(r, fare))}</strong> · {describe(r)}</span>
                    ) : (
                      <span className="text-muted">No fee</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {problem && dirty && <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit ? <button onClick={save} disabled={!dirty || !!problem || busy} className={primaryBtn}>{busy ? "Saving…" : "Save platform fee"}</button> : <span className="text-sm text-muted">Changing this needs pricing access.</span>}
        {stored?.updatedByName && <span className="text-xs text-muted">Last changed by {stored.updatedByName} (version {stored.version}).</span>}
      </div>
      <p className="text-xs text-muted">Enter 0 as the maximum for no cap. The customer sees the fee as its own “Platform fee” line in the fare breakup, and it is part of the amount they pay. GST is worked out on the whole fare, fee included. Confirm with your accountant how a platform fee should be taxed and invoiced.</p>
    </section>
  );
}
