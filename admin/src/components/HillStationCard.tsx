import { useEffect, useMemo, useState } from "react";
import { saveTariffSection } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { CLASS_LABEL, TARIFF_CLASSES, useTariff, type TariffClass } from "../services/tariffService";
import { useCan, useCanDo } from "./AccessContext";
import { Button } from "./ui";

/**
 * Hill Station Allowance / Charge (Customer UX v8, 16 Nov 2026, section 08). A One Way or Round Trip whose pickup, stop or destination is
 * in a Tamil Nadu hill station is detected automatically from the map position of each place, and the vehicle's slab is added to the fare
 * as its own line — "Hill Station Allowance / Charge" — never mixed into the base or package fare:
 *   One Way    : base fare + driver bata + extra km + hill charge (One-Way slab) + toll / permit
 *   Round Trip : package fare + extra km + hill charge (Round-Trip slab) + toll / permit
 * Hill stations never use the 5-Hour / 8-Hour packages. Amounts follow the fare's GST setting (entered with GST included or added on top).
 * Applies to every brand, like the rate cards it sits on.
 */
const STATIONS = ["Ooty", "Kodaikanal", "Yercaud", "Coonoor", "Kotagiri", "Valparai", "Megamalai", "Kolli Hills", "Yelagiri", "Kolukkumalai", "Jawadhu Hills", "Manjolai", "Kalvarayan Hills", "Sirumalai", "Topslip"];
const FIELDS = ["owCustomer", "owPartner", "rtCustomer", "rtPartner"] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string>;
const EMPTY: Draft = { owCustomer: "", owPartner: "", rtCustomer: "", rtPartner: "" };
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));
const text = (n: number | undefined) => (n === undefined ? "" : String(n));

export default function HillStationCard() {
  const { tariff } = useTariff();
  const pricingAccess = useCan("pricing");
  const settingsEdit = useCanDo("Settings", "edit");
  const canEdit = pricingAccess && settingsEdit;
  const saved = tariff?.hillStation;
  const [enabled, setEnabled] = useState(false);
  const [chargePer, setChargePer] = useState<"trip" | "station">("trip");
  const [rows, setRows] = useState<Partial<Record<TariffClass, Draft>>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const cards = useMemo(() => TARIFF_CLASSES.filter((c) => tariff?.roundTrip?.classes?.[c] || tariff?.oneWay?.classes?.[c]), [tariff]);
  const toDraft = (c: TariffClass): Draft => {
    const row = saved?.classes?.[c];
    return { owCustomer: text(row?.oneWay?.customer), owPartner: text(row?.oneWay?.partner), rtCustomer: text(row?.roundTrip?.customer), rtPartner: text(row?.roundTrip?.partner) };
  };

  useEffect(() => {
    setEnabled(saved?.enabled === true);
    setChargePer(saved?.chargePer === "station" ? "station" : "trip");
    setRows(Object.fromEntries(TARIFF_CLASSES.map((c) => [c, toDraft(c)])) as Partial<Record<TariffClass, Draft>>);
    setReason("");
    setMessage(null);
  }, [tariff?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const slabError = (c: TariffClass): string => {
    const d = rows[c];
    if (!d) return "";
    for (const [cust, part, label] of [["owCustomer", "owPartner", "One-way"], ["rtCustomer", "rtPartner", "Round-trip"]] as const) {
      const a = d[cust].trim(), b = d[part].trim();
      if (!a && !b) continue;
      if (!a || !(Number(a) > 0)) return `${label}: enter the customer charge (above zero), or clear both amounts.`;
      if (!b || !(Number(b) >= 0)) return `${label}: enter the partner payout (zero or more), or clear both amounts.`;
    }
    return "";
  };
  const anyError = cards.map(slabError).find(Boolean) ?? "";
  const hasAny = cards.some((c) => FIELDS.some((f) => (rows[c]?.[f] ?? "").trim() !== ""));
  const needsData = enabled && !hasAny;

  const snapshot = (en: boolean, per: string, r: Array<Draft | undefined>) => JSON.stringify([en, per, r.map((d) => FIELDS.map((f) => (d?.[f] ?? "").trim()))]);
  const changed = snapshot(saved?.enabled === true, saved?.chargePer === "station" ? "station" : "trip", cards.map((c) => toDraft(c))) !== snapshot(enabled, chargePer, cards.map((c) => rows[c]));

  const setField = (c: TariffClass, f: Field, v: string) => setRows((r) => ({ ...r, [c]: { ...(r[c] ?? EMPTY), [f]: v } }));

  const save = async () => {
    if (!canEdit || busy || !changed || anyError || needsData) return;
    if (reason.trim().length < 5) return setMessage({ ok: false, text: "Add a short reason." });
    setBusy(true);
    setMessage(null);
    try {
      const classes: Record<string, unknown> = {};
      for (const c of cards) {
        const d = rows[c] ?? EMPTY;
        const ow = d.owCustomer.trim() !== "" ? { customer: num(d.owCustomer), partner: num(d.owPartner) } : undefined;
        const rt = d.rtCustomer.trim() !== "" ? { customer: num(d.rtCustomer), partner: num(d.rtPartner) } : undefined;
        if (!ow && !rt) { if (saved?.classes?.[c]) classes[c] = null; continue; }
        classes[c] = { ...(ow ? { oneWay: ow } : {}), ...(rt ? { roundTrip: rt } : {}) };
      }
      await saveTariffSection({ section: "hillStation", expectedVersion: tariff?.version ?? 0, reason: reason.trim(), data: { enabled, chargePer, classes } });
      setReason("");
      setMessage({ ok: true, text: enabled ? "Saved. New One Way and Round Trip quotes to hill stations now carry this charge as a separate line; bookings already made keep what they were sold." : "Saved. Hill station charges are switched off." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ActionError ? err.message : "It was not saved. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const input = "ds-input text-right";
  return (
    <section className="ds-panel ds-panel-pad" aria-label="Hill station charge">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <h3 className="text-[15px] font-bold text-ink mb-1">Hill Station Allowance / Charge</h3>
          <p className="text-[12px] text-muted">
            Detected automatically from the map position of the pickup, every stop and the destination, and shown to the customer as its own fare line. Hill stations never use the 5-hour / 8-hour packages. Amounts follow the fare's GST setting.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <input type="checkbox" checked={enabled} disabled={!canEdit || busy} onChange={(e) => setEnabled(e.target.checked)} />
          Switch on for customers
        </label>
      </div>

      <p className="text-[12px] text-muted mb-3"><strong className="text-ink">Detected hill stations:</strong> {STATIONS.join(", ")}.</p>

      <fieldset disabled={!canEdit || busy} className="min-w-0">
        <label className="ds-field" style={{ maxWidth: 320 }}>
          <span>Charge the slab</span>
          <select className="ds-input" value={chargePer} onChange={(e) => setChargePer(e.target.value as "trip" | "station")}>
            <option value="trip">Once per trip (default)</option>
            <option value="station">Once for every hill station visited</option>
          </select>
        </label>

        <div className="mt-3 space-y-3">
          {cards.length === 0 ? <p className="text-[12px] text-muted">Save the One Way or Round Trip rate card for a category first.</p> : null}
          {cards.map((c) => {
            const d = rows[c] ?? EMPTY;
            const err = slabError(c);
            return (
              <div key={c} className="rounded-lg border border-line p-3" style={{ minWidth: 0 }}>
                <strong className="text-[13px] block mb-2">{CLASS_LABEL[c]}</strong>
                {([["ow", "One-way slab"], ["rt", "Round-trip slab"]] as const).map(([k, label]) => (
                  <div key={k} className="mb-2">
                    <span className="text-[12px] font-semibold text-ink">{label}</span>
                    <div className="grid gap-2 mt-1" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
                      <label className="ds-field"><span>Customer charge (₹)</span><input className={input} type="number" min={0} step="0.01" inputMode="decimal" value={d[`${k}Customer` as Field]} onChange={(e) => setField(c, `${k}Customer` as Field, e.target.value)} /></label>
                      <label className="ds-field"><span>Partner payout (₹)</span><input className={input} type="number" min={0} step="0.01" inputMode="decimal" value={d[`${k}Partner` as Field]} onChange={(e) => setField(c, `${k}Partner` as Field, e.target.value)} /></label>
                    </div>
                  </div>
                ))}
                {err ? <p className="ds-error" role="alert">{err}</p> : null}
              </div>
            );
          })}
        </div>
        {needsData ? <p className="ds-error mt-2" role="alert">Enter a hill station slab for at least one category before switching this on.</p> : null}

        <div className="flex flex-wrap items-end gap-3 mt-3">
          <label className="ds-field" style={{ flex: "1 1 220px" }}>
            <span>Reason for change</span>
            <input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <Button variant="primary" onClick={save} loading={busy} disabled={!changed || !!anyError || needsData || !canEdit}>Save</Button>
        </div>
      </fieldset>
      {message ? <p className={message.ok ? "text-[12px] text-ok mt-2" : "ds-error mt-2"} role="status">{message.text}</p> : null}
    </section>
  );
}
