import { useEffect, useRef, useState } from "react";
import { geoScopeOf, type LocSel } from "../../domain/locationHierarchy";
import { testLocalQuote, type GeoService, type TestQuoteResult } from "../../services/geoFareService";
import { istInputToIso } from "../../services/serviceRulesService";
import { sourceLabel } from "../../domain/geoFareView";
import { RENTAL_HOURS } from "../../services/tariffService";
import type { VehicleCol } from "../RateTable";
import { Button, Icon } from "../ui";
import { Hint, Panel, Pill } from "./ui";

const inr = (n: number | null) => (n === null ? "At actuals" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);

/**
 * Test quote: a sample trip at the place chosen above, priced by the booking server's own pricing (location rates with inheritance,
 * the scheduled peak rule for the pickup time in IST, night allowance, platform fee, the saved GST policy and price changes). Saved
 * values only: unsaved edits in the table are not included. Nothing is booked. Tolls stay at actuals; an airport entry fee applies
 * only when the booked pickup or drop is the Airport record itself.
 */
export default function TestQuote({ brand, service, sel, vehicles }: { brand: string; service: GeoService; sel: LocSel; vehicles: VehicleCol[] }) {
  const [categoryId, setCategoryId] = useState("");
  const [km, setKm] = useState("");
  const [hours, setHours] = useState("");
  const [pickupAt, setPickupAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestQuoteResult | null>(null);
  const seq = useRef(0);
  // Another place, brand or service: an earlier answer no longer applies (a late reply is ignored too).
  useEffect(() => { seq.current++; setResult(null); setError(null); setBusy(false); }, [brand, service, sel.state, sel.district, sel.zoneId, sel.locationId]);
  const placeOk = !!sel.state && !!sel.district;
  const problem = !placeOk ? "Choose a district (and, if needed, a zone or area) above."
    : !categoryId ? "Choose a vehicle."
    : service === "local" && !(Number(km) > 0 && Number(km) <= 60) ? "Enter a distance from 1 to 60 km."
    : service === "rental" && !hours ? "Choose a package."
    : !pickupAt ? "Enter the pickup date and time (IST)." : "";
  const run = async () => {
    if (problem || busy) return;
    const mine = ++seq.current;
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await testLocalQuote({ brand, service, scope: geoScopeOf({ ...sel, pins: [] }), categoryId, ...(service === "local" ? { km: Number(km) } : { hours: Number(hours) }), pickupAt: istInputToIso(pickupAt) });
      if (seq.current === mine) setResult(r);
    } catch (e) {
      if (seq.current === mine) setError(e instanceof Error ? e.message : "The test quote could not be worked out.");
    } finally { if (seq.current === mine) setBusy(false); }
  };
  const owners = vehicles.filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i);
  const lbl = "flex flex-col gap-1 text-[12px] font-semibold text-slate-700";

  return (
    <Panel title={<span className="flex items-center gap-2"><Icon name="calculator" size={18} className="text-[#991b1b]" />Test quote</span>}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={lbl}>Vehicle
          <select className="ds-select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Test quote vehicle">
            <option value="">Select vehicle</option>
            {owners.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
        {service === "local" ? (
          <label className={lbl}>Distance (km)
            <input className="ds-input text-right" inputMode="decimal" value={km} placeholder="Set" onChange={(e) => setKm(e.target.value)} aria-label="Test quote distance" />
          </label>
        ) : (
          <label className={lbl}>Package
            <select className="ds-select" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Test quote package">
              <option value="">Select package</option>
              {RENTAL_HOURS.map((h) => <option key={h} value={h}>{h} hour{h > 1 ? "s" : ""}</option>)}
            </select>
          </label>
        )}
        <label className={lbl}>Pickup date &amp; time (IST)
          <input type="datetime-local" className="ds-input" value={pickupAt} onChange={(e) => setPickupAt(e.target.value)} aria-label="Test quote pickup time" />
        </label>
        <div className="flex items-end"><Button variant="primary" icon="calculator" loading={busy} disabled={!!problem} onClick={() => void run()} title={problem || undefined}>Get test quote</Button></div>
      </div>
      {problem && !result && <div className="mt-2"><Hint>{problem}</Hint></div>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-800" role="alert">{error}</p>}
      {result && !result.ok && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900" role="status">
          <strong className="block">Not priced on these location rates.</strong>
          {result.missing.join("; ")}
          {result.availability !== "Available" && <span className="block">Booking status here: {result.availability}.</span>}
        </div>
      )}
      {result && result.ok && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13.5px]">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Customer quote breakdown</span>
            <Pill tone={result.availability === "Paused" ? "bad" : result.availability === "Limited" ? "warn" : "ok"}>Bookings: {result.availability}</Pill>
            {result.peak && <Pill tone="warn">Peak: {result.peak.name || "Scheduled peak"}</Pill>}
          </div>
          <ul className="divide-y divide-slate-200">
            {result.lines.filter((l) => l.treatment === "included").map((l) => (
              <li key={l.key + l.label} className="flex items-baseline justify-between gap-3 py-1.5"><span className="text-slate-700">{l.label}{l.detail ? <small className="block text-slate-500">{l.detail}</small> : null}</span><strong className="tabular-nums text-slate-900">{inr(l.amount)}</strong></li>
            ))}
          </ul>
          <div className="mt-2 flex items-baseline justify-between border-t border-slate-300 pt-2">
            <span className="font-bold text-slate-900">Estimated total</span><span className="text-[20px] font-extrabold text-[#991b1b]">{inr(result.total)}</span>
          </div>
          {result.lines.some((l) => l.treatment === "extra") && <p className="mt-2 text-[12px] text-slate-600">Paid separately: {result.lines.filter((l) => l.treatment === "extra").map((l) => `${l.label}${l.amount ? ` ${inr(l.amount)}` : " (at actuals)"}`).join(", ")}.</p>}
          {result.partnerPayout !== null && <p className="mt-1 text-[12px] text-slate-600">Partner payout: <strong>{inr(result.partnerPayout)}</strong></p>}
          {result.sources && <p className="mt-1 text-[12px] text-slate-500">Rates from: {[...new Set(Object.values(result.sources))].map((id) => sourceLabel(id, brand)).join(", ")}.</p>}
        </div>
      )}
      <div className="mt-2"><Hint>Uses saved rates only (save your edits first). Nothing is booked. Confirmed bookings keep their saved fare when rates or peak rules change.</Hint></div>
    </Panel>
  );
}
