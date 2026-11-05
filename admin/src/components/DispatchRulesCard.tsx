import { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { describeDataError, subscribeToDocument } from "../services/adminFirestoreService";
import { useCan } from "./AccessContext";
import { Field, Notice, inputCls, primaryBtn } from "./FormKit";

type Ops = Record<string, any>;

interface Form {
  minLead: string; maxDays: string;
  radius: string; fixAge: string; fixAcc: string; startWindow: string;
  buffer: string; speed: string; tripMin: string;
  waves: boolean; ownersAll: string; vendors: string; topRated: string;
  settleSmall: string; settleMode: "payout" | "wallet"; settleHours: string;
}

const DEFAULTS: Form = {
  minLead: "30", maxDays: "30", radius: "3", fixAge: "120", fixAcc: "200", startWindow: "360",
  buffer: "45", speed: "40", tripMin: "180", waves: false, ownersAll: "120", vendors: "180", topRated: "4.5",
  settleSmall: "300", settleMode: "payout", settleHours: "4",
};

const fromOps = (o: Ops | null): Form => ({
  minLead: String(o?.bookingMinLeadMinutes ?? DEFAULTS.minLead),
  maxDays: String(o?.bookingMaxAdvanceDays ?? DEFAULTS.maxDays),
  radius: String(o?.pickupRadiusKm ?? DEFAULTS.radius),
  fixAge: String(o?.locationMaxAgeSeconds ?? DEFAULTS.fixAge),
  fixAcc: String(o?.locationMaxAccuracyMeters ?? DEFAULTS.fixAcc),
  startWindow: String(o?.tripStartWindowMinutes ?? DEFAULTS.startWindow),
  buffer: String(o?.assignmentBufferMinutes ?? DEFAULTS.buffer),
  speed: String(o?.repositionSpeedKmh ?? DEFAULTS.speed),
  tripMin: String(o?.defaultTripMinutes ?? DEFAULTS.tripMin),
  waves: o?.dutyRelease?.enabled === true,
  ownersAll: String(o?.dutyRelease?.ownersAllSeconds ?? DEFAULTS.ownersAll),
  vendors: String(o?.dutyRelease?.vendorsSeconds ?? DEFAULTS.vendors),
  topRated: String(o?.dutyRelease?.topRatedMin ?? DEFAULTS.topRated),
  settleSmall: String(o?.settlement?.smallAmount ?? DEFAULTS.settleSmall),
  settleMode: o?.settlement?.belowThreshold === "wallet" ? "wallet" : "payout",
  settleHours: String(o?.settlement?.payoutHours ?? DEFAULTS.settleHours),
});

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

/**
 * Booking window, pickup gate, scheduling buffers, duty release waves and the settlement policy. Every
 * value here is a working default awaiting business sign-off (decisions D09, D11, D14); the server reads
 * them from settings/operations and falls back to the same defaults when a field is absent.
 */
export default function DispatchRulesCard() {
  const canEdit = useCan("system");
  const [ops, setOps] = useState<Ops | null | undefined>(undefined);
  const [form, setForm] = useState<Form>(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => subscribeToDocument<Ops>("settings/operations", setOps, (m) => setMsg({ tone: "error", text: m })), []);
  useEffect(() => {
    if (ops === undefined || dirty) return;
    setForm(fromOps(ops));
  }, [ops, dirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setMsg(null); };
  const digits = (v: string) => v.replace(/[^\d.]/g, "");

  const problem =
    !(num(form.minLead) >= 0 && num(form.minLead) <= 10080) ? "Minimum notice must be between 0 and 10,080 minutes."
    : !(num(form.maxDays) >= 1 && num(form.maxDays) <= 365) ? "The booking horizon must be 1 to 365 days."
    : !(num(form.radius) >= 0.1 && num(form.radius) <= 25) ? "Pickup radius must be between 0.1 and 25 km."
    : !(num(form.fixAge) >= 10 && num(form.fixAge) <= 900) ? "Location freshness must be 10 to 900 seconds."
    : !(num(form.fixAcc) >= 10 && num(form.fixAcc) <= 2000) ? "Location accuracy must be 10 to 2,000 metres."
    : !(num(form.startWindow) >= 15 && num(form.startWindow) <= 4320) ? "The start window must be 15 to 4,320 minutes."
    : !(num(form.buffer) >= 0 && num(form.buffer) <= 600) ? "The operating buffer must be 0 to 600 minutes."
    : !(num(form.speed) >= 10 && num(form.speed) <= 120) ? "Repositioning speed must be 10 to 120 km/h."
    : !(num(form.tripMin) >= 30 && num(form.tripMin) <= 2880) ? "Default trip length must be 30 to 2,880 minutes."
    : !(num(form.ownersAll) >= 0 && num(form.vendors) >= num(form.ownersAll)) ? "Vendors open at or after the owner-driver wave."
    : !(num(form.topRated) >= 0 && num(form.topRated) <= 5) ? "Top-rated threshold must be 0 to 5."
    : !(num(form.settleSmall) >= 0) || !(num(form.settleHours) >= 0 && num(form.settleHours) <= 168) ? "Check the settlement values."
    : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await setDoc(doc(db, "settings", "operations"), {
        bookingMinLeadMinutes: num(form.minLead), bookingMaxAdvanceDays: num(form.maxDays),
        pickupRadiusKm: num(form.radius), locationMaxAgeSeconds: num(form.fixAge), locationMaxAccuracyMeters: num(form.fixAcc), tripStartWindowMinutes: num(form.startWindow),
        assignmentBufferMinutes: num(form.buffer), repositionSpeedKmh: num(form.speed), defaultTripMinutes: num(form.tripMin),
        dutyRelease: { enabled: form.waves, ownersAllSeconds: num(form.ownersAll), vendorsSeconds: num(form.vendors), topRatedMin: num(form.topRated) },
        settlement: { smallAmount: num(form.settleSmall), belowThreshold: form.settleMode, payoutHours: num(form.settleHours) },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setDirty(false);
      setMsg({ tone: "ok", text: "Dispatch rules saved." });
    } catch (e) {
      setMsg({ tone: "error", text: describeDataError(e) });
    } finally {
      setBusy(false);
    }
  };

  const heading = (t: string) => <h3 className="text-[15px] font-bold text-ink flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-brand" />{t}</h3>;
  const text = (label: string, k: keyof Form, hint?: string) => (
    <Field label={label} hint={hint}><input value={String(form[k])} onChange={(e) => set(k, digits(e.target.value) as never)} inputMode="decimal" disabled={!canEdit} className={inputCls} /></Field>
  );

  return (
    <div className="space-y-6 max-w-3xl mt-8">
      <Notice tone="info">These are working defaults pending business confirmation (pickup radius, buffers, release timing, the small-amount payout rule). Change them here; the server reads them on every action.</Notice>

      <section className="space-y-3">
        {heading("Booking window")}
        <div className="grid sm:grid-cols-2 gap-3">
          {text("Minimum notice before pickup (minutes)", "minLead")}
          {text("Furthest pickup (days ahead)", "maxDays")}
        </div>
      </section>

      <section className="space-y-3">
        {heading("Trip start and pickup gate")}
        <div className="grid sm:grid-cols-2 gap-3">
          {text("Pickup radius (km)", "radius", "Reached is refused beyond this distance, on the server.")}
          {text("Start window (minutes before pickup)", "startWindow", "Earliest a driver may start for pickup.")}
          {text("Location must be fresher than (seconds)", "fixAge")}
          {text("Location accuracy no worse than (metres)", "fixAcc")}
        </div>
      </section>

      <section className="space-y-3">
        {heading("Driver and vehicle scheduling")}
        <p className="text-sm text-muted">A duty is allowed when the resource finishes its earlier trip, repositions and clears this buffer before the next pickup.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {text("Operating buffer (minutes)", "buffer")}
          {text("Repositioning speed (km/h)", "speed")}
          {text("Trip length when unknown (minutes)", "tripMin")}
        </div>
      </section>

      <section className="space-y-3">
        {heading("Duty release")}
        <label className="flex items-center gap-2 text-sm font-semibold text-body"><input type="checkbox" checked={form.waves} onChange={(e) => set("waves", e.target.checked)} disabled={!canEdit} className="w-4 h-4 accent-brand" />Release a published duty in waves (top-rated owner-drivers, then others, then vendors)</label>
        <div className="grid sm:grid-cols-3 gap-3">
          {text("Other owner-drivers after (seconds)", "ownersAll")}
          {text("Vendors after (seconds)", "vendors")}
          {text("Top-rated at or above", "topRated")}
        </div>
      </section>

      <section className="space-y-3">
        {heading("Partner settlement")}
        <div className="grid sm:grid-cols-3 gap-3">
          {text("Payout due after completion (hours)", "settleHours")}
          {text("Small amount below (₹)", "settleSmall")}
          <Field label="Small amounts">
            <select value={form.settleMode} onChange={(e) => set("settleMode", e.target.value as Form["settleMode"])} disabled={!canEdit} className={inputCls}>
              <option value="payout">Pay on the same schedule</option>
              <option value="wallet">Keep in the wallet for withdrawal</option>
            </select>
          </Field>
        </div>
      </section>

      {problem && dirty && <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
      {canEdit ? <button onClick={save} disabled={!dirty || !!problem || busy} className={primaryBtn}>{busy ? "Saving…" : "Save dispatch rules"}</button> : <p className="text-sm text-muted">Changing these needs system access.</p>}
    </div>
  );
}
