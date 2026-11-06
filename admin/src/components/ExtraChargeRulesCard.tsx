import { useEffect, useState } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { useTariff } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button, Icon } from "./ui";

/**
 * The four rules every waiting / hill / roof-carrier charge needs before it can be billed automatically
 * (functions/src/domain/extraCharges.ts computeExtraCharges). Saved once in tariff_v2.extraCharges and used by
 * every brand, service and vehicle. Until all four are set, recorded extras wait for office review.
 */
export default function ExtraChargeRulesCard() {
  const { tariff } = useTariff();
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const saved = tariff?.extraCharges;
  const [free, setFree] = useState("");
  const [step, setStep] = useState("");
  const [scope, setScope] = useState("");
  const [tax, setTax] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const savedKey = JSON.stringify([saved?.freeWaitingMinutes, saved?.waitingRoundingMinutes, saved?.waitingRoundingScope, saved?.taxTreatment]);
  useEffect(() => {
    setFree(saved?.freeWaitingMinutes !== undefined ? String(saved.freeWaitingMinutes) : "");
    setStep(saved?.waitingRoundingMinutes !== undefined ? String(saved.waitingRoundingMinutes) : "");
    setScope(saved?.waitingRoundingScope ?? "");
    setTax(saved?.taxTreatment ?? "");
  }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const whole = (v: string, min: number) => /^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= 1440;
  const changed = JSON.stringify([free === "" ? undefined : Number(free), step === "" ? undefined : Number(step), scope || undefined, tax || undefined]) !== savedKey;
  const complete = saved?.freeWaitingMinutes !== undefined && saved?.waitingRoundingMinutes !== undefined && !!saved?.waitingRoundingScope && !!saved?.taxTreatment;

  const save = async () => {
    if (!canEdit || busy || !changed || tariff === undefined) return;
    if (!whole(free, 0) || !whole(step, 1)) return setMessage({ ok: false, text: "Enter whole minutes: free waiting 0–1440, rounding 1–1440." });
    setBusy(true);
    setMessage(null);
    try {
      await saveTariffSection({
        section: "extraCharges", expectedVersion: tariff?.version ?? 0, reason: "Extra charge rules updated",
        data: { freeWaitingMinutes: Number(free), waitingRoundingMinutes: Number(step), waitingRoundingScope: scope || null, taxTreatment: tax || null, categories: {} },
      });
      setMessage({ ok: true, text: "Saved. New bookings use these rules." });
    } catch (err) {
      console.error("[NESAM API] Save extra-charge rules failed:", err);
      setMessage({ ok: false, text: "Not saved. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ds-panel ds-panel-pad" aria-label="Rules for extra charges" id="fare-extra-settings">
      <h3 className="text-[15px] font-bold text-ink mb-1">Rules for extra charges</h3>
            <p className={`flex items-center gap-1.5 text-[12px] mb-3 ${complete ? "text-ok" : "text-bad"}`} role="status">
        <Icon name={complete ? "circle-check" : "circle-alert"} size={13} /> {complete ? "Set." : "Not complete."}
      </p>
      <fieldset disabled={!canEdit || busy} className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
        <label className="ds-field"><span>Free waiting at each stop (minutes)</span><input className="ds-input" type="number" min={0} max={1440} step={1} value={free} onChange={(e) => setFree(e.target.value)} /></label>
        <label className="ds-field"><span>Round waiting up to every (minutes)</span><input className="ds-input" type="number" min={1} max={1440} step={1} value={step} onChange={(e) => setStep(e.target.value)} /></label>
        <label className="ds-field"><span>Rounding</span>
          <select className="ds-select" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Not decided</option><option value="per_stop">Each stop on its own</option><option value="combined">All stops added together</option>
          </select>
        </label>
        <label className="ds-field"><span>GST on extra charges</span>
          <select className="ds-select" value={tax} onChange={(e) => setTax(e.target.value)}>
            <option value="">Not decided</option><option value="no_gst">No GST</option><option value="tariff_gst">Add the booking's GST rate</option>
          </select>
        </label>
        <div><Button variant="primary" onClick={save} loading={busy} disabled={!changed}>Save rules</Button></div>
      </fieldset>
      {message && <p className={message.ok ? "text-[12px] text-ok mt-2" : "ds-error mt-2"} role="status">{message.text}</p>}
    </section>
  );
}
