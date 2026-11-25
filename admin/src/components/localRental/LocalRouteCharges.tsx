import { useEffect, useMemo, useState } from "react";
import type { Indexed, LocSel } from "../../domain/locationHierarchy";
import { saveGeoFares, type AirportEntry, type GeoFareDoc } from "../../services/geoFareService";
import { Button } from "../ui";
import { airportDocId, airportsOf } from "./LocalFareRates";
import { Hint, LoadFailure, Panel, Pill } from "./ui";
import type { FeedStatus } from "../../hooks/useLocationsFeed";

/**
 * Local route charges.
 *   Route toll: tolls stay billed at actuals (the existing policy every quote already discloses). No verified toll-plaza tariffs or
 *   toll-capable route API exist in this system, so a mapped toll estimate is not offered: nothing is guessed from a nearby plaza.
 *   Airport entry: a saved fee on one Airport record of the Locations master. It is charged once, only when the booked pickup or drop
 *   is that record (never matched by an airport name in an address), outside GST and peak, and passed to the partner who pays it.
 *   Local Pickup & Drop only; Hourly Rental and the separate Airport Taxi service are not changed.
 */
export default function LocalRouteCharges({ brand, docs, feed, locationsStatus, sel, index, canEdit, onToast }: {
  brand: string; docs: Map<string, GeoFareDoc> | null; feed: FeedStatus; locationsStatus: FeedStatus; sel: LocSel; index: Indexed[]; canEdit: boolean; onToast: (t: string) => void;
}) {
  const airports = useMemo(() => (sel.district ? airportsOf(index, sel) : []), [index, sel]);
  const [airportId, setAirportId] = useState("");
  useEffect(() => { setAirportId((cur) => (airports.some((a) => a.id === cur) ? cur : "")); }, [airports]);
  const ownId = airportId ? airportDocId(brand, airportId) : "";
  const sharedId = airportId && brand !== "common" ? airportDocId("common", airportId) : "";
  const saved: AirportEntry | undefined = airportId ? docs?.get(ownId)?.airportEntry : undefined;
  const shared: AirportEntry | undefined = sharedId ? docs?.get(sharedId)?.airportEntry : undefined;
  const [on, setOn] = useState(false);
  const [fee, setFee] = useState("");
  const [pickup, setPickup] = useState(false);
  const [drop, setDrop] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setOn(!!saved); setFee(saved ? String(saved.customerFee) : ""); setPickup(saved ? saved.appliesTo !== "drop" : false); setDrop(saved ? saved.appliesTo !== "pickup" : false);
    setMessage(null);
  }, [ownId, saved?.customerFee, saved?.appliesTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = on !== !!saved || (on && (fee !== String(saved?.customerFee ?? "") || (pickup ? (drop ? "both" : "pickup") : "drop") !== saved?.appliesTo));
  const problem = !airportId ? "Choose an airport." : on && !(Number(fee) > 0) ? "Enter the entry fee." : on && !pickup && !drop ? "Choose pickup, drop or both." : reason.trim().length < 5 ? "Enter a reason (at least 5 characters)." : "";
  const save = async () => {
    // The saved entry must have loaded: a failed read never lets an empty form replace a saved fee.
    if (!docs || !canEdit || busy || !dirty) return;
    if (problem) return setMessage({ ok: false, text: problem });
    setBusy(true); setMessage(null);
    try {
      await saveGeoFares({
        brand, service: "local", targets: [{ level: "area", state: sel.state, district: sel.district, locationId: airportId }],
        data: { airportEntry: on ? { customerFee: Math.round(Number(fee) * 100) / 100, appliesTo: pickup && drop ? "both" : pickup ? "pickup" : "drop" } : null },
        expected: { [ownId]: docs?.get(ownId)?.version ?? 0 }, reason: reason.trim(),
      });
      setReason("");
      onToast(on ? "Airport entry fee saved." : "Airport entry fee removed.");
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "The airport entry was not saved." });
    } finally { setBusy(false); }
  };

  return (
    <Panel title="Local route charges">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="min-w-0 rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-[14px] text-slate-900">Route toll</strong><Pill tone="info">At actuals</Pill></div>
          <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold text-slate-700">Source</span>
            <select className="ds-select w-full min-w-0" value="actuals" disabled={!canEdit} onChange={() => undefined} aria-label="Toll source">
              <option value="actuals">At actuals (existing policy)</option>
              <option value="mapped" disabled>Mapped toll tariffs — no verified toll records</option>
            </select>
          </label>
          <div className="mt-2"><Hint>Tolls are not estimated. Each quote shows “Toll — payable separately at actuals” and the trip bill adds the receipts, so nothing is charged twice.</Hint></div>
        </div>
        <div className="min-w-0 rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-[14px] text-slate-900">Airport entry</strong>
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={on} disabled={!canEdit || !airportId} onChange={(e) => { setOn(e.target.checked); setMessage(null); }} /> Charge an entry fee</label>
          </div>
          {!sel.district ? <Hint>Choose a district above to see its airports.</Hint>
            : locationsStatus.loading ? <Hint>Loading locations…</Hint>
            : locationsStatus.error ? <LoadFailure what="Locations" failure={locationsStatus} onRetry={locationsStatus.onRetry} />
            : feed.error ? <LoadFailure what="Saved airport entry fees" failure={feed} onRetry={feed.onRetry} />
            : !docs ? <Hint>Loading saved fees…</Hint>
            : !airports.length ? <Hint>No Airport location is saved for {sel.district}. Add the airport in Locations to set its entry fee.</Hint> : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] sm:items-end">
              <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold text-slate-700">Airport</span>
                <select className="ds-select" value={airportId} onChange={(e) => setAirportId(e.target.value)} aria-label="Airport">
                  <option value="">Select airport</option>
                  {airports.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1"><span className="text-[12px] font-semibold text-slate-700">Entry fee ₹</span>
                <input className="ds-input text-right" inputMode="decimal" value={fee} disabled={!canEdit || !on} placeholder={shared ? String(shared.customerFee) : "Set"} onChange={(e) => setFee(e.target.value)} aria-label="Airport entry fee" />
              </label>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] sm:col-span-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={pickup} disabled={!canEdit || !on} onChange={(e) => setPickup(e.target.checked)} /> Pickup eligible</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={drop} disabled={!canEdit || !on} onChange={(e) => setDrop(e.target.checked)} /> Drop eligible</label>
              </div>
            </div>
          )}
          {airportId && !saved && shared && <div className="mt-2"><Hint>Inherited from All brands: ₹{shared.customerFee} ({shared.appliesTo}). Set a fee here to override it for this brand.</Hint></div>}
          {airportId && canEdit && (dirty || message) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className="ds-input min-w-[200px] flex-1" placeholder="Reason for change" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label="Reason for airport entry change" />
              <Button size="sm" variant="primary" loading={busy} disabled={!dirty || !docs} onClick={() => void save()}>Save airport entry</Button>
            </div>
          )}
          {message && <p className={`mt-2 text-[12.5px] font-semibold ${message.ok ? "text-emerald-700" : "text-red-700"}`} role="alert">{message.text}</p>}
          <div className="mt-2"><Hint>Charged once when the booked pickup or drop is this airport record. Not taxed, not part of the peak charge; the partner is reimbursed the same fee.</Hint></div>
        </div>
      </div>
    </Panel>
  );
}
