import { useEffect, useState } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { BRAND_LABELS, useTariff, type FareWorkspaceScope } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button } from "./ui";

/**
 * Strike-through price: a percentage added on top of the real fare and shown crossed out above it in the customer apps.
 * It is display only: the fare, GST and partner payout never change. Saved for the selected brand and service.
 */
export default function DisplayMarkupCard({ scope }: { scope: FareWorkspaceScope }) {
  const { tariff } = useTariff();
  const canEdit = useCan("pricing") && useCanDo("Settings", "edit");
  const saved = tariff?.displayMarkup?.[scope.brand]?.[scope.service];
  const inherited = scope.brand !== "common" ? tariff?.displayMarkup?.common?.[scope.service] : undefined;
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setValue(saved ? String(saved) : ""); setReason(""); setMessage(null); }, [saved, scope.brand, scope.service]);

  const pct = value.trim() === "" ? null : Number(value);
  const invalid = pct !== null && (!Number.isFinite(pct) || pct <= 0 || pct > 300);
  const changed = (pct ?? 0) !== (saved ?? 0);
  const example = pct && !invalid ? Math.round(1000 * (1 + pct / 100)) : null;
  const where = `${scope.brand === "common" ? "All brands" : BRAND_LABELS[scope.brand]} → ${scope.service}`;

  const save = async () => {
    if (!canEdit || busy || invalid || !changed) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    try {
      await saveTariffSection({ section: "displayMarkup", expectedVersion: tariff?.version ?? 0, reason: reason.trim(), brand: scope.brand, service: scope.service, data: { percent: pct } });
      setReason("");
      setMessage({ ok: true, text: pct ? `Saved: ${pct}% for ${where}.` : `Removed for ${where}.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ActionError ? err.message : "It was not saved. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ds-panel ds-panel-pad" aria-label="Struck-out price">
      <h3 className="text-[15px] font-bold text-ink mb-1">Struck-out price</h3>
      <p className="text-[12px] text-muted mb-3">Shows a higher price crossed out above the real fare. The fare itself never changes. For {where}.</p>
      <fieldset disabled={!canEdit || busy} className="flex flex-wrap items-end gap-3 min-w-0">
        <label className="ds-field" style={{ width: 150 }}>
          <span>Increase by (%)</span>
          <input className="ds-input text-right" type="number" inputMode="decimal" min={0} max={300} step="0.5" value={value} placeholder={inherited ? `${inherited} (shared)` : "None"} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="ds-field" style={{ flex: "1 1 220px" }}>
          <span>Reason for change</span>
          <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this changed" />
        </label>
        <Button variant="primary" onClick={save} loading={busy} disabled={invalid || !changed || !canEdit}>Save</Button>
      </fieldset>
      {example ? <p className="text-[12px] text-muted mt-2">Example: a ₹1,000 fare shows <s>₹{example.toLocaleString("en-IN")}</s> ₹1,000.</p> : null}
      {invalid ? <p className="ds-error mt-2" role="alert">Enter a percentage above 0 and up to 300, or leave it blank for none.</p> : null}
      {message ? <p className={message.ok ? "text-[12px] text-ok mt-2" : "ds-error mt-2"} role="status">{message.text}</p> : null}
    </section>
  );
}
