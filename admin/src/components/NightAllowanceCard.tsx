import { useEffect, useState } from "react";
import { subscribeToDocument } from "../services/adminFirestoreService";
import { saveNightAllowance } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, type TariffClass } from "../services/tariffService";
import { useCan } from "./AccessContext";
import { Notice, primaryBtn } from "./FormKit";

interface Stored { enabled?: boolean; amount?: number; classes?: Partial<Record<TariffClass, number>>; version?: number; updatedByName?: string }

const MAX_RUPEES = 100000;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/**
 * Night allowance, set for each vehicle in Service & Fare Settings → Fares: a fixed amount added automatically to a booking whose pickup is
 * between 11:00 PM and 6:00 AM (India time), for every brand and service, shown to the customer as its own "Night allowance" line.
 * One switch turns it on or off; each vehicle has its own amount (0 = none for that vehicle).
 */
export default function NightAllowanceCard({ names = {} }: { names?: Partial<Record<TariffClass, string>> }) {
  const canEdit = useCan("pricing");
  const [stored, setStored] = useState<Stored | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [amounts, setAmounts] = useState<Partial<Record<TariffClass, string>>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(
    () =>
      subscribeToDocument<Stored>("business_config/night_allowance", (d) => {
        setStored(d);
        setError(null);
        if (!dirty) {
          // A vehicle with no amount of its own shows the older common amount.
          setAmounts(Object.fromEntries(TARIFF_CLASSES.map((c) => {
            // A night allowance an older save left switched off shows as zero (none).
            const v = d?.enabled === true ? d?.classes?.[c] ?? d?.amount : 0;
            return [c, v !== undefined && v !== null ? String(v) : ""];
          })) as Partial<Record<TariffClass, string>>);
        }
      }, setError),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const num = (c: TariffClass) => (amounts[c] ?? "").trim() === "" ? 0 : Number(amounts[c]);
  const bad = TARIFF_CLASSES.find((c) => !Number.isFinite(num(c)) || num(c) < 0 || num(c) > MAX_RUPEES);
  const problem = bad ? `Enter ${CLASS_LABEL[bad]} as an amount from 0 to ${MAX_RUPEES.toLocaleString("en-IN")} rupees.`
    : null;
  // No on/off switch: it is on whenever a vehicle has an amount above zero.
  const enabled = TARIFF_CLASSES.some((c) => num(c) > 0);

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const classes = Object.fromEntries(TARIFF_CLASSES.map((c) => [c, num(c)])) as Record<string, number>;
      // The common amount stays as the fallback for any vehicle class added later.
      await saveNightAllowance({ enabled, amount: classes.sedan ?? 0, classes, expectedVersion: stored?.version ?? 0 });
      setDirty(false);
      setMsg({ tone: "ok", text: "Saved. New quotes and bookings with a pickup between 11:00 PM and 6:00 AM include each vehicle's amount; existing bookings keep the fare they were booked at." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof ActionError ? e.message : "The night allowance was not saved." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ds-panel ds-panel-pad" aria-label="Night allowance">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h3 className="text-[15px] font-bold text-ink mb-1">Night allowance</h3>
          <p className="text-[12px] text-muted">Added automatically to a booking whose pickup is between <strong className="text-ink">11:00 PM and 6:00 AM</strong> (India time), on every service and brand. Set the amount for each vehicle; 0 means none.</p>
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}


      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {TARIFF_CLASSES.map((c) => (
          <label key={c} className="ds-field">
            <span>{names[c] ?? CLASS_LABEL[c]} (₹ / booking)</span>
            <input className="ds-input text-right" type="number" min={0} step="0.01" inputMode="decimal" placeholder="0" disabled={!canEdit || busy}
              value={amounts[c] ?? ""} onChange={(e) => { setAmounts((a) => ({ ...a, [c]: e.target.value })); setDirty(true); setMsg(null); }} />
          </label>
        ))}
      </div>

      {problem && dirty && <p className="ds-error mt-2" role="alert">{problem}</p>}
      {msg && <Notice tone={msg.tone === "ok" ? "ok" : "error"}>{msg.text}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
        <span className="text-xs text-muted">{stored?.updatedByName ? `Last changed by ${stored.updatedByName} (version ${stored.version}).${stored?.amount ? ` Common amount ${inr(stored.amount)}.` : ""}` : ""}</span>
        {canEdit ? <button onClick={save} disabled={!dirty || !!problem || busy} className={`${primaryBtn} ml-auto`}>{busy ? "Saving…" : "Save night allowance"}</button> : <span className="text-sm text-muted ml-auto">Changing this needs pricing access.</span>}
      </div>
      <p className="text-xs text-muted mt-2">It follows the booking’s GST setting like the roof carrier charge: with GST added on top, the amount you enter is before GST; with GST included, it is what the customer pays. The platform fee, if on, is worked out on the fare including the night allowance.</p>
    </section>
  );
}
