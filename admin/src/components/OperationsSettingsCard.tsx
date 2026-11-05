import { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { describeDataError, subscribeToDocument } from "../services/adminFirestoreService";
import { DEFAULT_UNASSIGNED_THRESHOLDS } from "../domain/bookingFlow";
import { useCan } from "./AccessContext";
import { Field, Notice, inputCls, primaryBtn } from "./FormKit";

interface Ops { unassignedAlertHours?: number; unassignedCriticalHours?: number }
interface Sec { enforceIntegrity?: boolean; allowWebDriverTrips?: boolean; integrityTtlHours?: number }

/**
 * Operations & security settings (settings/operations, settings/security).
 * Both are read by the server functions, not just by this screen.
 */
export default function OperationsSettingsCard() {
  const canEdit = useCan("system");
  const [ops, setOps] = useState<Ops | null | undefined>(undefined);
  const [sec, setSec] = useState<Sec | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ warn: String(DEFAULT_UNASSIGNED_THRESHOLDS.warningHours), crit: String(DEFAULT_UNASSIGNED_THRESHOLDS.criticalHours), enforce: false, allowWeb: true, ttl: "24" });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const a = subscribeToDocument<Ops>("settings/operations", setOps, setLoadError);
    const b = subscribeToDocument<Sec>("settings/security", setSec, setLoadError);
    return () => { a(); b(); };
  }, []);
  useEffect(() => {
    if (ops === undefined || sec === undefined || dirty) return;
    setForm({
      warn: String(ops?.unassignedAlertHours ?? DEFAULT_UNASSIGNED_THRESHOLDS.warningHours),
      crit: String(ops?.unassignedCriticalHours ?? DEFAULT_UNASSIGNED_THRESHOLDS.criticalHours),
      enforce: sec?.enforceIntegrity === true, allowWeb: sec?.allowWebDriverTrips !== false, ttl: String(sec?.integrityTtlHours ?? 24),
    });
  }, [ops, sec, dirty]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setMsg(null); };
  const warn = Number(form.warn), crit = Number(form.crit), ttl = Number(form.ttl);
  const problem =
    !(warn > 0 && warn <= 72) ? "The warning window must be between 1 and 72 hours."
    : !(crit > 0 && crit <= warn) ? "The urgent window must be more than 0 and no longer than the warning window."
    : !(ttl > 0 && ttl <= 72) ? "Device re-check must be between 1 and 72 hours."
    : null;

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await setDoc(doc(db, "settings", "operations"), { unassignedAlertHours: warn, unassignedCriticalHours: crit, updatedAt: serverTimestamp() }, { merge: true });
      await setDoc(doc(db, "settings", "security"), { enforceIntegrity: form.enforce, allowWebDriverTrips: form.allowWeb, integrityTtlHours: ttl, updatedAt: serverTimestamp() }, { merge: true });
      setDirty(false);
      setMsg({ tone: "ok", text: "Settings saved." });
    } catch (e) {
      setMsg({ tone: "error", text: describeDataError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {loadError && <Notice tone="error">{loadError}</Notice>}
      <section className="space-y-3">
        <h3 className="text-[15px] font-bold text-ink flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-brand" />Unassigned booking alerts</h3>
        <p className="text-sm text-muted">Approved or confirmed bookings with no driver are flagged on the dashboard and staff are notified as the pickup gets close — once per level, so alerts do not repeat.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Warning before pickup (hours)" hint="Normal above this; warning at or below it."><input value={form.warn} onChange={(e) => set("warn", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" disabled={!canEdit} className={inputCls} /></Field>
          <Field label="Urgent before pickup (hours)" hint="Critical at or below this."><input value={form.crit} onChange={(e) => set("crit", e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" disabled={!canEdit} className={inputCls} /></Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[15px] font-bold text-ink flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-brand" />Driver device security</h3>
        <p className="text-sm text-muted">When on, a driver’s Android phone must pass Google Play Integrity (genuine, unmodified device running the published app) before it can start, reach or end a trip. Failures are logged under Security events.</p>
        <Notice tone="warn">Turn this on only after Play Integrity is configured on the server (PLAY_INTEGRITY_PACKAGE_NAME and a service account) — otherwise Android drivers will be refused.</Notice>
        <label className="flex items-center gap-2 text-sm font-semibold text-body"><input type="checkbox" checked={form.enforce} onChange={(e) => set("enforce", e.target.checked)} disabled={!canEdit} className="w-4 h-4 accent-brand" />Require a verified device for trip actions</label>
        <label className="flex items-center gap-2 text-sm font-semibold text-body"><input type="checkbox" checked={form.allowWeb} onChange={(e) => set("allowWeb", e.target.checked)} disabled={!canEdit} className="w-4 h-4 accent-brand" />Allow drivers to run trips from the web portal (a browser cannot be verified)</label>
        <Field label="Re-check device every (hours)"><input value={form.ttl} onChange={(e) => set("ttl", e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={!canEdit} className={`${inputCls} max-w-[10rem]`} /></Field>
      </section>

      {problem && dirty && <p className="text-sm font-semibold text-red-700" role="alert">{problem}</p>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
      {canEdit ? <button onClick={save} disabled={!dirty || !!problem || busy} className={primaryBtn}>{busy ? "Saving…" : "Save"}</button> : <p className="text-sm text-muted">Changing these needs system access.</p>}
    </div>
  );
}
