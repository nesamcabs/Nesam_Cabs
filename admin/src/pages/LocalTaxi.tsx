// Local Taxi control room: service-zone map editor, versioned fares with a simulator, driver eligibility and live rides.
// Every save goes to a server function that validates it and records who changed what; nothing here prices a ride.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "../components/ui";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "../services/geoService";
import { CLASS_LABEL, useTariff, type Tariff } from "../services/tariffService";
import { classLabel, currentFareRupees, currentLocalFare, fareFromLocalFare, localCities, osmBoundary, tariffClassOf } from "../services/localTaxiSetup";
import { subscribeDrivers, subscribeVehicleCategories } from "../services/adminFirestoreService";
import type { Driver, VehicleCategory } from "../types";
import {
  activateFare, adminCancelRide, assignRide, auditFor, rideEvents, saveFare, saveZone, setDriverEligibility, setZoneStatus, simulateFare,
  watchDriverStates, watchFares, watchRides, watchZones,
  type AuditRow, type DispatchPolicy, type FareBreakdown, type FareConfig, type LtDriverState, type LtFare, type LtRide, type LtZone, type Position, type RideEvent,
} from "../services/localTaxiService";

type Tab = "zones" | "fares" | "drivers" | "rides";
const TABS: { id: Tab; label: string }[] = [{ id: "zones", label: "Service zones" }, { id: "fares", label: "Fares" }, { id: "drivers", label: "Drivers" }, { id: "rides", label: "Rides" }];
const ERODE_VIEW: [number, number] = [11.341, 77.7172]; // where the map opens; this is a view position, not a service boundary
const msg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong. Please try again.");
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const ago = (ms?: number) => (ms ? (Date.now() - ms < 90000 ? "just now" : `${Math.round((Date.now() - ms) / 60000)} min ago`) : "never");
const DEFAULT_DISPATCH: DispatchPolicy = { radiusStartMeters: 2000, radiusStepMeters: 1000, radiusMaxMeters: 6000, offerTtlSeconds: 20, searchTimeoutSeconds: 180, locationMaxAgeSeconds: 60, arrivalRadiusMeters: 250, quoteTtlSeconds: 300 };
const STATUS_TONE: Record<string, string> = { active: "bg-emerald-50 text-emerald-700 border-emerald-200", draft: "bg-amber-50 text-amber-700 border-amber-200", inactive: "bg-slate-100 text-slate-600 border-slate-200", scheduled: "bg-blue-50 text-blue-700 border-blue-200", retired: "bg-slate-100 text-slate-500 border-slate-200" };
const Pill = ({ s }: { s: string }) => <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[s] ?? "bg-slate-50 text-slate-600 border-slate-200"}`}>{s.replace(/_/g, " ")}</span>;
const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block text-[12px] font-semibold text-slate-600">{label}<div className="mt-1">{children}</div>{hint ? <span className="mt-0.5 block text-[11px] font-normal text-slate-500">{hint}</span> : null}</label>
);
const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-blue-500 focus:outline-none";

// ── Zone map editor ────────────────────────────────────────────────────────────────────────────────────────────────
function ZoneMap({ points, onChange, others, readOnly }: { points: Position[]; onChange: (p: Position[]) => void; others: { id: string; name: string; ring: Position[] }[]; readOnly: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const latest = useRef({ points, onChange, readOnly });
  latest.current = { points, onChange, readOnly };

  useEffect(() => {
    if (!host.current || map.current) return undefined;
    const m = L.map(host.current).setView(ERODE_VIEW, 12);
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => {
      const { points: p, onChange: set, readOnly: ro } = latest.current;
      if (!ro) set([...p, [Number(e.latlng.lng.toFixed(6)), Number(e.latlng.lat.toFixed(6))]]);
    });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const g = layer.current;
    const m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    for (const o of others) L.polygon(o.ring.map(([lng, lat]) => [lat, lng] as [number, number]), { color: "#94a3b8", weight: 1, fillOpacity: 0.08, dashArray: "4" }).bindTooltip(`${o.name} (other zone)`).addTo(g);
    if (points.length >= 3) L.polygon(points.map(([lng, lat]) => [lat, lng] as [number, number]), { color: "#1d4ed8", weight: 2, fillOpacity: 0.15 }).addTo(g);
    else if (points.length === 2) L.polyline(points.map(([lng, lat]) => [lat, lng] as [number, number]), { color: "#1d4ed8", weight: 2 }).addTo(g);
    points.forEach(([lng, lat], i) => {
      const mk = L.circleMarker([lat, lng], { radius: 6, color: "#1d4ed8", fillColor: i === 0 ? "#16a34a" : "#fff", fillOpacity: 1, weight: 2 }).addTo(g);
      mk.bindTooltip(`Point ${i + 1}${readOnly ? "" : " — click to remove"}`);
      if (!readOnly) mk.on("click", (ev) => { L.DomEvent.stopPropagation(ev); const { points: p, onChange: set } = latest.current; set(p.filter((_, k) => k !== i)); });
    });
    if (!fitted.current && points.length >= 3) { m.fitBounds(L.latLngBounds(points.map(([lng, lat]) => [lat, lng] as [number, number])), { padding: [30, 30] }); fitted.current = true; }
  }, [points, others, readOnly]);

  return <div ref={host} className="h-[420px] w-full rounded-xl border border-slate-300" aria-label="Zone map" />;
}

const ringOf = (z: LtZone): Position[] | null => {
  const b = z.boundary as { type?: string; coordinates?: Position[][] } | null;
  if (!b || b.type !== "Polygon" || !Array.isArray(b.coordinates) || b.coordinates.length !== 1) return null;
  const r = b.coordinates[0]!;
  return r.slice(0, -1);
};

function ZonesTab({ zones, categories, tariff, toast }: { zones: LtZone[]; categories: VehicleCategory[]; tariff: Tariff | null | undefined; toast: (m: string, t?: "success" | "error") => void }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const current = zones.find((z) => z.id === editing) ?? null;
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [cats, setCats] = useState<string[]>([]);
  const [cash, setCash] = useState(false);
  const [dispatch, setDispatch] = useState<DispatchPolicy>(DEFAULT_DISPATCH);
  const [points, setPoints] = useState<Position[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ zone: LtZone; to: "active" | "inactive" } | null>(null);
  const [history, setHistory] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState("");
  const [quick, setQuick] = useState("");
  const [osmBusy, setOsmBusy] = useState(false);

  /** Fill the map with the outline OpenStreetMap holds for the zone's name. The admin must still check it before going live. */
  const loadOsm = async () => {
    setOsmBusy(true); setError("");
    try {
      const b = await osmBoundary(name.trim() || "Erode");
      setPoints(b.points);
      toast(`Loaded ${b.points.length} points from ${b.source}: ${b.title.split(",").slice(0, 2).join(",")}, about ${b.widthKm} × ${b.heightKm} km${b.parts > 1 ? `, largest of ${b.parts} parts` : ""}. ${Math.max(b.widthKm, b.heightKm) > 20 ? "That is larger than a city: trim it to the city limits on the map. " : ""}It is community map data, not an official survey: check it before activating.`, Math.max(b.widthKm, b.heightKm) > 20 ? "error" : "success");
    } catch (e) { setError(msg(e)); } finally { setOsmBusy(false); }
  };

  /**
   * One-click start for Erode: the zone (draft, with the OpenStreetMap outline) plus one DRAFT fare per vehicle type taken
   * from the current Local Pickup & Drop fares. Nothing goes live: you review, then press Make live and Activate.
   */
  const quickStart = async () => {
    setError(""); setQuick("Checking your current fare settings…");
    try {
      const city = localCities(tariff).find((c) => /erode/i.test(c.name));
      if (!city) throw new Error("There is no Local Pickup & Drop fare for Erode in your current fare settings. Add it under Pricing → Local fares first, then come back.");
      const free = tariff?.extraCharges?.freeWaitingMinutes ?? 0;
      const rows = categories.filter((c) => c.status === "Active").flatMap((c) => { const f = currentLocalFare(tariff, city.id, tariffClassOf(c)); return f ? [{ c, f }] : []; });
      if (!rows.length) throw new Error("None of your active vehicle types has an Erode Local Pickup & Drop fare yet (Pricing → Local fares).");
      setQuick("Loading the Erode boundary from OpenStreetMap…");
      const b = await osmBoundary("Erode");
      setQuick("Creating the Erode zone (draft)…");
      const z = await saveZone({ zoneId: "erode", name: "Erode", timezone: "Asia/Kolkata", categoryIds: rows.map((r) => r.c.id), cashEnabled: true, dispatch: DEFAULT_DISPATCH, boundary: { type: "Polygon", coordinates: [[...b.points, b.points[0]!]] }, reason: "Quick start from current fare settings" });
      for (const [i, r] of rows.entries()) {
        setQuick(`Saving fare ${i + 1} of ${rows.length}: ${r.c.name}…`);
        await saveFare({ zoneId: z.zoneId, categoryId: r.c.id, config: fareFromLocalFare(r.f, free), note: `Imported from current Local Pickup & Drop fares (${city.name}, ${classLabel(tariffClassOf(r.c))})` });
      }
      const big = Math.max(b.widthKm, b.heightKm) > 20;
      toast(`Erode is set up as a draft with ${rows.length} fare${rows.length === 1 ? "" : "s"}. ${big ? `The outline from OpenStreetMap is ${b.widthKm} × ${b.heightKm} km, bigger than the city: trim it to the city limits before activating. ` : ""}Check the boundary and fares, then make the fares live and activate the zone.`, big ? "error" : "success");
      setEditing(z.zoneId);
    } catch (e) { setError(msg(e)); } finally { setQuick(""); }
  };

  useEffect(() => {
    if (editing === "new") { setName(""); setTimezone("Asia/Kolkata"); setCats([]); setCash(false); setDispatch(DEFAULT_DISPATCH); setPoints([]); }
    else if (current) { setName(current.name); setTimezone(current.timezone); setCats(current.categoryIds); setCash(current.cashEnabled); setDispatch(current.dispatch); setPoints(ringOf(current) ?? []); }
    setError(""); setHistory(null);
  }, [editing, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const multi = !!current?.boundary && !ringOf(current);
  const others = useMemo(() => zones.filter((z) => z.id !== current?.id).flatMap((z) => { const r = ringOf(z); return r ? [{ id: z.id, name: z.name, ring: r }] : []; }), [zones, current?.id]);
  const num = (k: keyof DispatchPolicy, label: string, hint: string) => (
    <Field label={label} hint={hint}><input className={inputCls} type="number" min={0} value={dispatch[k]} onChange={(e) => setDispatch({ ...dispatch, [k]: Number(e.target.value) })} /></Field>
  );

  const save = async () => {
    setBusy(true); setError("");
    try {
      const closed = points.length >= 3 ? [...points, points[0]!] : null;
      const r = await saveZone({
        zoneId: current?.id, name, timezone, categoryIds: cats, cashEnabled: cash, dispatch,
        ...(multi ? {} : { boundary: closed ? { type: "Polygon" as const, coordinates: [closed] } : points.length ? null : current?.boundary ?? null }),
      });
      toast(`Zone saved as ${r.status}${r.boundaryVersion ? ` · boundary v${r.boundaryVersion}` : ""}.`);
      setEditing(r.zoneId);
    } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  const flip = async () => {
    if (!confirm) return;
    setBusy(true);
    try { await setZoneStatus(confirm.zone.id, confirm.to); toast(confirm.to === "active" ? "Zone is now live. Customers can book inside it." : "Zone switched off. Rides already booked continue."); setConfirm(null); }
    catch (e) { setConfirm(null); toast(msg(e), "error"); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-2">
        <Button variant="primary" onClick={() => setEditing("new")}>New service zone</Button>
        <p className="text-[12px] text-slate-500">A zone stays <b>draft</b> until its boundary is drawn and a fare is active. Pickup and drop must both be inside the same active zone.</p>
        {zones.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <strong className="text-[13px] text-blue-900">Quick start: Erode</strong>
            <p className="text-[12px] text-blue-900">Creates the Erode zone as a <b>draft</b> with its outline from OpenStreetMap, and one draft fare per vehicle type copied from your current <b>Local Pickup &amp; Drop</b> fares. Nothing goes live until you check it and press Make live and Activate.</p>
            <Button variant="primary" loading={!!quick} onClick={() => void quickStart()}>Set up Erode from current fares</Button>
            {quick ? <p className="text-[12px] text-blue-900">{quick}</p> : null}
            {error && !editing ? <ErrorBanner message={error} /> : null}
          </div>
        ) : null}
        {zones.map((z) => (
          <button key={z.id} type="button" onClick={() => setEditing(z.id)} className={`w-full rounded-xl border p-3 text-left ${editing === z.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between"><strong className="text-[14px]">{z.name}</strong><Pill s={z.status} /></div>
            <div className="mt-1 text-[12px] text-slate-500">Boundary v{z.boundaryVersion || "–"} · policy v{z.policyVersion} · {z.categoryIds.length} vehicle type(s){z.boundary ? "" : " · no boundary yet"}</div>
          </button>
        ))}
      </div>

      {editing ? (
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Zone name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Erode" /></Field>
            <Field label="Time zone" hint="Night charges follow this clock."><input className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)} /></Field>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold text-slate-600">Vehicle types available in this zone</div>
            <div className="flex flex-wrap gap-2">
              {categories.filter((c) => c.status === "Active").map((c) => (
                <label key={c.id} className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] ${cats.includes(c.id) ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300"}`}>
                  <input type="checkbox" className="mr-1" checked={cats.includes(c.id)} onChange={() => setCats(cats.includes(c.id) ? cats.filter((x) => x !== c.id) : [...cats, c.id])} />{c.name}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={cash} onChange={(e) => setCash(e.target.checked)} /> Allow cash payment in this zone <span className="text-slate-500">(online payment also needs the payment keys to be configured)</span></label>
          <div className="grid gap-3 sm:grid-cols-4">
            {num("radiusStartMeters", "First search radius (m)", "Nearest drivers first.")}
            {num("radiusStepMeters", "Widen by (m)", "When nobody is inside.")}
            {num("radiusMaxMeters", "Largest radius (m)", "Search never goes beyond.")}
            {num("offerTtlSeconds", "Offer time (s)", "Per driver.")}
            {num("searchTimeoutSeconds", "Give up after (s)", "Then: no driver available.")}
            {num("locationMaxAgeSeconds", "Fresh location (s)", "Older = not offered.")}
            {num("arrivalRadiusMeters", "Arrival radius (m)", "Driver must be this close.")}
            {num("quoteTtlSeconds", "Quote valid (s)", "Fare lock time.")}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-[12px] font-semibold text-slate-600">Boundary {current ? `(version ${current.boundaryVersion || "–"})` : ""}</div>
              <div className="flex gap-2">
                <Button size="sm" loading={osmBusy} onClick={() => void loadOsm()} disabled={multi}>Load outline from OpenStreetMap</Button>
                <Button size="sm" onClick={() => setPoints(points.slice(0, -1))} disabled={multi || !points.length}>Undo last point</Button>
                <Button size="sm" onClick={() => setPoints([])} disabled={multi || !points.length}>Clear</Button>
              </div>
            </div>
            {multi ? <p className="mb-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-800">This zone has several areas or holes. It is shown on the map but can only be changed by uploading a new boundary through support.</p> : null}
            <ZoneMap points={points} onChange={setPoints} others={others} readOnly={multi} />
            <p className="mt-1 text-[12px] text-slate-500">Click the map to add corner points in order (green = first). Click a point to remove it. Use the official, verified boundary: the system never guesses one. Points exactly on the edge count as inside. {points.length ? `${points.length} point(s).` : ""}</p>
            <p className="text-[12px] text-slate-500">Rule: pickup and drop must be inside. The road route may briefly leave the area; that is allowed and does not change the fare.</p>
          </div>

          {error ? <ErrorBanner message={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => void save()}>Save zone</Button>
            {current && current.status !== "active" ? <Button disabled={busy} onClick={() => setConfirm({ zone: current, to: "active" })}>Activate</Button> : null}
            {current && current.status === "active" ? <Button variant="danger" disabled={busy} onClick={() => setConfirm({ zone: current, to: "inactive" })}>Switch off</Button> : null}
            {current ? <Button variant="ghost" onClick={() => void auditFor("lt_zone", current.id).then(setHistory).catch((e) => toast(msg(e), "error"))}>Change history</Button> : null}
          </div>
          {history ? <HistoryList rows={history} /> : null}
        </div>
      ) : <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 p-10 text-[13px] text-slate-500">Choose a zone, or create one.</div>}

      {confirm ? (
        <ConfirmDialog
          title={confirm.to === "active" ? `Activate “${confirm.zone.name}”?` : `Switch off “${confirm.zone.name}”?`}
          message={confirm.to === "active" ? "Customers inside the boundary can book Local Taxi straight away. Check the boundary and the fares first." : "No new bookings are accepted. Rides already booked or in progress carry on."}
          confirmLabel={confirm.to === "active" ? "Activate" : "Switch off"} danger={confirm.to === "inactive"} busy={busy} onConfirm={() => void flip()} onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function HistoryList({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="text-[12px] text-slate-500">No changes recorded yet.</p>;
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-[12px]"><thead className="bg-slate-50"><tr><th className="p-2">When</th><th className="p-2">Who</th><th className="p-2">What</th><th className="p-2">Old → new</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="border-t border-slate-100 align-top">
            <td className="p-2 whitespace-nowrap">{r.at?.toMillis ? new Date(r.at.toMillis()).toLocaleString("en-IN") : "—"}</td><td className="p-2">{r.performedByName || r.performedBy}</td>
            <td className="p-2">{r.action.replace(/_/g, " ")}{r.reason ? ` — ${r.reason}` : ""}</td>
            <td className="p-2 max-w-[320px] break-words text-slate-500">{JSON.stringify(r.previous ?? null).slice(0, 140)} → {JSON.stringify(r.next ?? null).slice(0, 140)}</td>
          </tr>))}</tbody></table>
    </div>
  );
}

// ── Fares ──────────────────────────────────────────────────────────────────────────────────────────────────────────
interface FareForm {
  base: string; includedKm: string; perKm: string; perMin: string; minimum: string; freeWait: string; waitPerMin: string; pickup: string; platform: string; commission: string; distCap: string;
  nightOn: boolean; nightStart: string; nightEnd: string; nightPct: string; surgeOn: boolean; surgeX: string; surgeMax: string; surgeEnd: string;
  cancelFee: string; cancelGrace: string; taxOn: boolean; taxPct: string; rounding: FareConfig["rounding"];
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const paise = (v: string) => Math.round(Number(v || 0) * 100);
const SAMPLE_FORM: FareForm = {
  base: "50", includedKm: "2", perKm: "12", perMin: "1.5", minimum: "80", freeWait: "3", waitPerMin: "2", pickup: "0", platform: "0", commission: "15", distCap: "150",
  nightOn: false, nightStart: "22:00", nightEnd: "06:00", nightPct: "20", surgeOn: false, surgeX: "1.5", surgeMax: "2", surgeEnd: "", cancelFee: "30", cancelGrace: "2", taxOn: false, taxPct: "5", rounding: "nearest_rupee",
};
const formFromConfig = (c: FareConfig): FareForm => ({
  base: String(c.baseFarePaise / 100), includedKm: String(c.includedMeters / 1000), perKm: String(c.perKmPaise / 100), perMin: String(c.perMinutePaise / 100), minimum: String(c.minimumFarePaise / 100),
  freeWait: String(c.freeWaitingSeconds / 60), waitPerMin: String(c.waitingPerMinutePaise / 100), pickup: String(c.pickupChargePaise / 100), platform: String(c.platformFeePaise / 100),
  commission: String(c.commissionBps / 100), distCap: String(c.maxDistanceOverQuoteBps / 100), nightOn: c.night.enabled, nightStart: fromMin(c.night.startMinute), nightEnd: fromMin(c.night.endMinute),
  nightPct: String(c.night.bps / 100), surgeOn: c.surge.enabled, surgeX: String(c.surge.multiplierBps / 10000), surgeMax: String(c.surge.maxBps / 10000),
  surgeEnd: c.surge.effectiveToMs ? new Date(c.surge.effectiveToMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "", cancelFee: String(c.cancellation.feePaise / 100),
  cancelGrace: String(c.cancellation.graceSeconds / 60), taxOn: c.tax.enabled, taxPct: String(c.tax.bps / 100), rounding: c.rounding,
});
const configFromForm = (f: FareForm): FareConfig => ({
  currency: "INR", baseFarePaise: paise(f.base), includedMeters: Math.round(Number(f.includedKm || 0) * 1000), perKmPaise: paise(f.perKm), perMinutePaise: paise(f.perMin), minimumFarePaise: paise(f.minimum),
  freeWaitingSeconds: Math.round(Number(f.freeWait || 0) * 60), waitingPerMinutePaise: paise(f.waitPerMin), pickupChargePaise: paise(f.pickup),
  night: { enabled: f.nightOn, startMinute: toMin(f.nightStart), endMinute: toMin(f.nightEnd), bps: Math.round(Number(f.nightPct || 0) * 100) },
  surge: { enabled: f.surgeOn, multiplierBps: Math.round(Number(f.surgeX || 1) * 10000), maxBps: Math.round(Number(f.surgeMax || 1.5) * 10000), effectiveFromMs: null, effectiveToMs: f.surgeEnd ? new Date(f.surgeEnd).getTime() : null },
  cancellation: { feePaise: paise(f.cancelFee), graceSeconds: Math.round(Number(f.cancelGrace || 0) * 60) }, tax: { enabled: f.taxOn, bps: Math.round(Number(f.taxPct || 0) * 100) },
  platformFeePaise: paise(f.platform), rounding: f.rounding, commissionBps: Math.round(Number(f.commission || 0) * 100), maxDistanceOverQuoteBps: Math.round(Number(f.distCap || 100) * 100),
});

function FaresTab({ zones, fares, categories, tariff, toast }: { zones: LtZone[]; fares: LtFare[]; categories: VehicleCategory[]; tariff: Tariff | null | undefined; toast: (m: string, t?: "success" | "error") => void }) {
  const [zoneId, setZoneId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [form, setForm] = useState<FareForm>(SAMPLE_FORM);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [isSample, setIsSample] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sim, setSim] = useState({ km: "5", minutes: "12", waiting: "0", at: "" });
  const [simOut, setSimOut] = useState<FareBreakdown | null>(null);
  const [history, setHistory] = useState<AuditRow[] | null>(null);
  const [activate, setActivate] = useState<LtFare | null>(null);
  const zone = zones.find((z) => z.id === zoneId);
  const cats = categories.filter((c) => zone?.categoryIds.includes(c.id));
  // Current fare settings (Pricing → Local fares) for the chosen city and vehicle type, to compare against and start from.
  const cities = localCities(tariff);
  const [cityId, setCityId] = useState("");
  const category = categories.find((c) => c.id === categoryId);
  const cls = category ? tariffClassOf(category) : null;
  const current = cls && cityId ? currentLocalFare(tariff, cityId, cls) : null;
  const [compare, setCompare] = useState<{ km: number; now: number; lt: number | null }[]>([]);
  useEffect(() => { if (cities.length && !cities.some((c) => c.id === cityId)) setCityId((cities.find((c) => zone && c.name.toLowerCase() === zone.name.toLowerCase()) ?? cities[0]!).id); }, [cities.length, zone?.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const versions = fares.filter((f) => f.zoneId === zoneId && f.categoryId === categoryId).sort((a, b) => b.version - a.version);
  useEffect(() => { if (!zoneId && zones[0]) setZoneId(zones[0].id); }, [zones, zoneId]);
  useEffect(() => { if (zone && !zone.categoryIds.includes(categoryId)) setCategoryId(zone.categoryIds[0] ?? ""); }, [zone, categoryId]);
  const set = (k: keyof FareForm, v: string | boolean) => setForm({ ...form, [k]: v } as FareForm);
  const text = (k: keyof FareForm, label: string, hint?: string, step = "any") => <Field label={label} hint={hint}><input className={inputCls} type="number" step={step} min={0} value={String(form[k])} onChange={(e) => set(k, e.target.value)} /></Field>;

  // Side by side: what the current tariff charges for a few trip lengths versus these Local Taxi settings (3 min per km assumed).
  useEffect(() => {
    if (!current) { setCompare([]); return undefined; }
    let live = true;
    const t = window.setTimeout(() => {
      const kms = [2, 4, 6, 8, 10, 15];
      void Promise.all(kms.map(async (km) => {
        let lt: number | null = null;
        try { lt = (await simulateFare({ config: configFromForm(form), distanceMeters: km * 1000, rideSeconds: km * 180, waitingSeconds: 0, timezone: zone?.timezone, atMs: new Date().setHours(12, 0, 0, 0) })).totalPaise / 100; } catch { lt = null; }
        return { km, now: currentFareRupees(current, km), lt };
      })).then((rows) => live && setCompare(rows));
    }, 500);
    return () => { live = false; window.clearTimeout(t); };
  }, [form, current?.customerRate, current?.minKm, zone?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const useCurrent = () => {
    if (!current) return;
    setForm(formFromConfig(fareFromLocalFare(current, tariff?.extraCharges?.freeWaitingMinutes ?? 0)));
    setIsSample(false); setEditingId(undefined);
    setNote(`Imported from current Local Pickup & Drop fares (${cities.find((c) => c.id === cityId)?.name ?? ""}, ${cls ? classLabel(cls) : ""})`);
    toast("Filled from your current fare settings. Review, then save as draft.");
  };

  const simulate = async () => {
    setError("");
    try { setSimOut(await simulateFare({ config: configFromForm(form), distanceMeters: Math.round(Number(sim.km) * 1000), rideSeconds: Math.round(Number(sim.minutes) * 60), waitingSeconds: Math.round(Number(sim.waiting) * 60), atMs: sim.at ? new Date(sim.at).getTime() : undefined, timezone: zone?.timezone })); }
    catch (e) { setSimOut(null); setError(msg(e)); }
  };
  const save = async () => {
    setBusy(true); setError("");
    try { const r = await saveFare({ zoneId, categoryId, config: configFromForm(form), fareId: editingId, note, sample: isSample }); toast(`Saved as draft version ${r.version}. It is not live until you activate it.`); setEditingId(r.fareId); }
    catch (e) { setError(msg(e)); } finally { setBusy(false); }
  };
  const doActivate = async () => {
    if (!activate) return;
    setBusy(true);
    try { await activateFare(activate.id); toast(`Version ${activate.version} is now the live fare. New quotes use it; rides already booked keep theirs.`); setActivate(null); }
    catch (e) { setActivate(null); toast(msg(e), "error"); } finally { setBusy(false); }
  };

  if (!zones.length) return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-[13px] text-slate-500">Create a service zone first (Service zones tab), then set its fares here.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label="Zone"><select className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>{zones.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.status})</option>)}</select></Field>
        <Field label="Vehicle type"><select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      {!categoryId ? <p className="text-[13px] text-slate-500">This zone has no vehicle types yet. Add some on the Service zones tab.</p> : (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <strong className="text-[14px]">{editingId ? `Editing draft ${editingId.split("__v")[1] ? `v${editingId.split("__v")[1]}` : ""}` : "New version"}</strong>
              <Button size="sm" onClick={() => { setForm(SAMPLE_FORM); setIsSample(true); setEditingId(undefined); }}>Load development sample</Button>
            </div>
            {isSample ? <p className="rounded-lg bg-amber-50 p-2 text-[12px] text-amber-800">Development sample: these are placeholder numbers, not approved business rates. Production blocks activating a sample.</p> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              {text("base", "Base fare (₹)", "Covers the included distance.")}{text("includedKm", "Included distance (km)")}{text("perKm", "Per extra km (₹)")}
              {text("perMin", "Per ride minute (₹)", "Waiting is not counted here.")}{text("minimum", "Minimum fare (₹)")}{text("pickup", "Pickup charge (₹)", "0 = none.")}
              {text("freeWait", "Free waiting (min)")}{text("waitPerMin", "Waiting per min (₹)", "After the free time.")}{text("platform", "Platform fee (₹)", "Customer pays; not taxed.")}
              {text("commission", "Platform commission (%)", "Taken from the driver's share.")}{text("distCap", "Distance cap (% of quote)", "Final distance never exceeds this.")}
              {text("cancelFee", "Cancellation fee (₹)")}{text("cancelGrace", "Free cancel after driver assigned (min)")}
              <Field label="Rounding"><select className={inputCls} value={form.rounding} onChange={(e) => set("rounding", e.target.value)}><option value="none">None (to the paisa)</option><option value="nearest_rupee">Nearest ₹1</option><option value="nearest_five">Nearest ₹5</option><option value="ceil_rupee">Up to the next ₹1</option></select></Field>
            </div>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={form.nightOn} onChange={(e) => set("nightOn", e.target.checked)} /> Night surcharge</label>
              {form.nightOn ? <div className="mt-2 grid gap-3 sm:grid-cols-3"><Field label="From"><input className={inputCls} type="time" value={form.nightStart} onChange={(e) => set("nightStart", e.target.value)} /></Field><Field label="To" hint="Earlier than “From” = crosses midnight."><input className={inputCls} type="time" value={form.nightEnd} onChange={(e) => set("nightEnd", e.target.value)} /></Field>{text("nightPct", "Extra (%)", "On the metered fare, by ride start time.")}</div> : null}
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={form.surgeOn} onChange={(e) => set("surgeOn", e.target.checked)} /> High-demand multiplier</label>
              {form.surgeOn ? <div className="mt-2 grid gap-3 sm:grid-cols-3">{text("surgeX", "Multiplier (×)", "1.0 – 3.0")}{text("surgeMax", "Limit (×)")}<Field label="Ends at" hint="Required, so it cannot stay on by mistake."><input className={inputCls} type="datetime-local" value={form.surgeEnd} onChange={(e) => set("surgeEnd", e.target.value)} /></Field></div> : null}
            </fieldset>
            <fieldset className="rounded-lg border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={form.taxOn} onChange={(e) => set("taxOn", e.target.checked)} /> Add taxes <span className="font-normal text-slate-500">(off until your accountant confirms the rate)</span></label>
              {form.taxOn ? <div className="mt-2 max-w-[200px]">{text("taxPct", "Tax rate (%)")}</div> : null}
            </fieldset>
            <Field label="Note for the change history"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this change" /></Field>
            {error ? <ErrorBanner message={error} /> : null}
            <div className="flex flex-wrap gap-2"><Button variant="primary" loading={busy} onClick={() => void save()}>Save as draft</Button><Button variant="ghost" onClick={() => void auditFor("lt_fare", `${zoneId}__${categoryId}`).then(setHistory).catch((e) => toast(msg(e), "error"))}>Change history</Button></div>
            {history ? <HistoryList rows={history} /> : null}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <strong className="text-[14px]">Current fare settings</strong>
              <p className="text-[12px] text-slate-500">Your saved Local Pickup &amp; Drop fare (Pricing → Local fares). Compare it with this version, or start from it.</p>
              {cities.length === 0 ? <p className="mt-2 text-[12px] text-slate-500">No Local Pickup &amp; Drop fares are saved yet.</p> : (
                <>
                  <div className="mt-2"><Field label="City"><select className={inputCls} value={cityId} onChange={(e) => setCityId(e.target.value)}>{cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field></div>
                  {current ? (
                    <div className="mt-2 text-[12px]">
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span className="text-slate-500">Vehicle class</span><b>{cls ? CLASS_LABEL[cls] : "—"}</b>
                        <span className="text-slate-500">Minimum km</span><b>{current.minKm} km</b>
                        <span className="text-slate-500">Customer rate</span><b>₹{current.customerRate}/km</b>
                        <span className="text-slate-500">Extra km rate</span><b>₹{current.extraKmRate}/km</b>
                        <span className="text-slate-500">Waiting</span><b>₹{current.waitingPerHour}/hour</b>
                        <span className="text-slate-500">Partner rate</span><b>₹{current.partnerRate}/km</b>
                      </div>
                      <div className="mt-2"><Button size="sm" variant="primary" onClick={useCurrent}>Use as starting point</Button></div>
                      <table className="mt-3 w-full text-left"><thead><tr className="text-slate-500"><th className="py-1">Trip</th><th>Current</th><th>Local Taxi</th><th>Diff</th></tr></thead>
                        <tbody>{compare.map((r) => (
                          <tr key={r.km} className="border-t border-slate-100"><td className="py-1">{r.km} km</td><td>₹{r.now.toLocaleString("en-IN")}</td><td>{r.lt === null ? "…" : `₹${r.lt.toLocaleString("en-IN")}`}</td>
                            <td className={r.lt === null ? "" : r.lt > r.now ? "text-amber-700" : r.lt < r.now ? "text-emerald-700" : "text-slate-500"}>{r.lt === null ? "" : r.lt === r.now ? "same" : `${r.lt > r.now ? "+" : "−"}₹${Math.abs(Math.round((r.lt - r.now) * 100) / 100).toLocaleString("en-IN")}`}</td></tr>
                        ))}</tbody></table>
                      <p className="mt-1 text-slate-500">Current fares are before GST. Local Taxi shows the customer total from the numbers on the left (3 minutes per km assumed, daytime).</p>
                    </div>
                  ) : <p className="mt-2 text-[12px] text-amber-700">No Local Pickup &amp; Drop fare is saved for this city and vehicle class. Add it under Pricing → Local fares, or enter Local Taxi fares by hand.</p>}
                </>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <strong className="text-[14px]">Fare simulator</strong>
              <p className="text-[12px] text-slate-500">Prices a trip with the numbers on the left, exactly as the server will. Nothing is saved.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Distance (km)"><input className={inputCls} type="number" value={sim.km} onChange={(e) => setSim({ ...sim, km: e.target.value })} /></Field>
                <Field label="Ride time (min)"><input className={inputCls} type="number" value={sim.minutes} onChange={(e) => setSim({ ...sim, minutes: e.target.value })} /></Field>
                <Field label="Waiting (min)"><input className={inputCls} type="number" value={sim.waiting} onChange={(e) => setSim({ ...sim, waiting: e.target.value })} /></Field>
                <Field label="Ride starts at"><input className={inputCls} type="datetime-local" value={sim.at} onChange={(e) => setSim({ ...sim, at: e.target.value })} /></Field>
              </div>
              <div className="mt-2"><Button onClick={() => void simulate()}>Calculate</Button></div>
              {simOut ? (
                <div className="mt-3 text-[13px]">
                  {simOut.lines.map((l) => <div key={l.code} className="flex justify-between border-b border-slate-100 py-1"><span>{l.label}</span><span>{rupees(l.amountPaise)}</span></div>)}
                  <div className="flex justify-between py-1 font-bold"><span>Customer pays</span><span>{rupees(simOut.totalPaise)}</span></div>
                  <div className="text-[12px] text-slate-500">Driver earns {rupees(simOut.driverEarningsPaise)} · platform commission {rupees(simOut.commissionPaise)}{simOut.nightApplied ? " · night rate applied" : ""}{simOut.surgeApplied ? " · high demand applied" : ""}{simOut.minimumApplied ? " · minimum fare applied" : ""}</div>
                </div>
              ) : null}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <strong className="text-[14px]">Versions</strong>
              {versions.length === 0 ? <p className="mt-1 text-[12px] text-slate-500">No saved versions yet.</p> : null}
              {versions.map((v) => (
                <div key={v.id} className="mt-2 rounded-lg border border-slate-200 p-2 text-[12px]">
                  <div className="flex items-center justify-between"><b>Version {v.version}</b><Pill s={v.status} /></div>
                  <div className="text-slate-500">Base {rupees(v.config.baseFarePaise)} · {rupees(v.config.perKmPaise)}/km · min {rupees(v.config.minimumFarePaise)}{v.sample ? " · development sample" : ""}</div>
                  <div className="mt-1 flex gap-2">
                    {v.status === "draft" ? <Button size="sm" onClick={() => { setForm(formFromConfig(v.config)); setEditingId(v.id); setIsSample(!!v.sample); setNote(v.note ?? ""); }}>Edit</Button> : <Button size="sm" onClick={() => { setForm(formFromConfig(v.config)); setEditingId(undefined); setIsSample(!!v.sample); }}>Use as template</Button>}
                    {v.status === "draft" || v.status === "scheduled" ? <Button size="sm" variant="primary" onClick={() => setActivate(v)}>Make live</Button> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {activate ? <ConfirmDialog title={`Make version ${activate.version} live?`} message="New quotes use this fare immediately. The current live version is retired. Rides already booked keep the fare they were booked with." confirmLabel="Make live" busy={busy} onConfirm={() => void doActivate()} onCancel={() => setActivate(null)} /> : null}
    </div>
  );
}

// ── Drivers ────────────────────────────────────────────────────────────────────────────────────────────────────────
function DriversTab({ zones, categories, states, drivers, toast }: { zones: LtZone[]; categories: VehicleCategory[]; states: LtDriverState[]; drivers: Driver[]; toast: (m: string, t?: "success" | "error") => void }) {
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<{ id: string; name: string; zoneIds: string[]; categoryIds: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const stateOf = (id: string) => states.find((s) => s.id === id);
  const rows = drivers.filter((d) => !q || `${d.name} ${d.phone}`.toLowerCase().includes(q.toLowerCase())).slice(0, 80);
  const flip = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try { await setDriverEligibility(edit.id, edit.zoneIds, edit.categoryIds); toast("Driver eligibility saved."); setEdit(null); } catch (e) { toast(msg(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <input className={`${inputCls} max-w-sm`} placeholder="Search drivers by name or phone" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="text-[12px] text-slate-500">A driver can go online for Local Taxi only when approved here and enabled for a zone and vehicle type. Removing all zones takes them offline.</p>
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-[13px]"><thead className="bg-slate-50 text-[12px]"><tr><th className="p-2">Driver</th><th className="p-2">Enabled for</th><th className="p-2">Status</th><th className="p-2">Last location</th><th className="p-2" /></tr></thead>
          <tbody>{rows.map((d) => { const s = stateOf(d.id); return (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="p-2"><b>{d.name}</b><div className="text-[11px] text-slate-500">{d.phone}</div></td>
              <td className="p-2 text-[12px]">{s?.zoneIds?.length ? s.zoneIds.map((z) => zones.find((x) => x.id === z)?.name ?? z).join(", ") : <span className="text-slate-400">not enabled</span>}{s?.categoryIds?.length ? ` · ${s.categoryIds.map((c) => categories.find((x) => x.id === c)?.name ?? c).join(", ")}` : ""}</td>
              <td className="p-2">{s?.activeRideId ? <Pill s="on a ride" /> : s?.online ? <Pill s={s.available ? "active" : "draft"} /> : <Pill s="inactive" />}</td>
              <td className="p-2 text-[12px]">{ago(s?.location?.atMs)}</td>
              <td className="p-2 text-right"><Button size="sm" onClick={() => setEdit({ id: d.id, name: d.name, zoneIds: s?.zoneIds ?? [], categoryIds: s?.categoryIds ?? [] })}>Set zones</Button></td>
            </tr>); })}
            {rows.length === 0 ? <tr><td className="p-4 text-slate-500" colSpan={5}>No drivers found.</td></tr> : null}</tbody></table>
      </div>
      {edit ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5">
            <strong className="text-[15px]">Local Taxi access · {edit.name}</strong>
            <div><div className="mb-1 text-[12px] font-semibold text-slate-600">Zones</div><div className="flex flex-wrap gap-2">{zones.map((z) => <label key={z.id} className="rounded-full border border-slate-300 px-3 py-1 text-[12px]"><input type="checkbox" className="mr-1" checked={edit.zoneIds.includes(z.id)} onChange={() => setEdit({ ...edit, zoneIds: flip(edit.zoneIds, z.id) })} />{z.name}</label>)}</div></div>
            <div><div className="mb-1 text-[12px] font-semibold text-slate-600">Vehicle types</div><div className="flex flex-wrap gap-2">{categories.filter((c) => c.status === "Active").map((c) => <label key={c.id} className="rounded-full border border-slate-300 px-3 py-1 text-[12px]"><input type="checkbox" className="mr-1" checked={edit.categoryIds.includes(c.id)} onChange={() => setEdit({ ...edit, categoryIds: flip(edit.categoryIds, c.id) })} />{c.name}</label>)}</div></div>
            <div className="flex justify-end gap-2"><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save</Button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Rides ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const ACTIVE = ["searching", "assigned", "driver_arriving", "driver_arrived", "in_progress"];
function RidesTab({ rides, states, drivers, toast }: { rides: LtRide[]; states: LtDriverState[]; drivers: Driver[]; toast: (m: string, t?: "success" | "error") => void }) {
  const [filter, setFilter] = useState<"live" | "all">("live");
  const [open, setOpen] = useState<LtRide | null>(null);
  const [events, setEvents] = useState<RideEvent[] | null>(null);
  const [driverId, setDriverId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = rides.filter((r) => filter === "all" || ACTIVE.includes(r.status));
  useEffect(() => { setEvents(null); setDriverId(""); setReason(""); if (open) void rideEvents(open.id).then(setEvents).catch((e) => toast(msg(e), "error")); }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const freeDrivers = states.filter((s) => s.online && s.available && !s.activeRideId && open?.zone && s.zoneIds?.includes(open.zone.id));
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast(ok); } catch (e) { toast(msg(e), "error"); } finally { setBusy(false); } };
  const live = open ? rides.find((r) => r.id === open.id) ?? open : null;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-2">
        <div className="flex gap-2"><Button size="sm" variant={filter === "live" ? "primary" : "secondary"} onClick={() => setFilter("live")}>Live</Button><Button size="sm" variant={filter === "all" ? "primary" : "secondary"} onClick={() => setFilter("all")}>All recent</Button></div>
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-[13px]"><thead className="bg-slate-50 text-[12px]"><tr><th className="p-2">Ride</th><th className="p-2">Status</th><th className="p-2">Driver</th><th className="p-2">Fare</th><th className="p-2">Payment</th></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} onClick={() => setOpen(r)} className={`cursor-pointer border-t border-slate-100 ${live?.id === r.id ? "bg-blue-50" : ""}`}>
                <td className="p-2"><b>{r.pickup?.name} → {r.drop?.name}</b><div className="text-[11px] text-slate-500">{r.customerName || r.customerId} · {r.categoryName} · {r.zone?.name} · {new Date(r.createdAtMs).toLocaleString("en-IN")}</div></td>
                <td className="p-2"><Pill s={r.status} /></td><td className="p-2">{r.driverName || "—"}</td>
                <td className="p-2">{rupees(r.final?.totalPaise ?? r.estimate?.totalPaise ?? 0)}{r.final ? "" : <span className="text-[11px] text-slate-400"> est.</span>}</td>
                <td className="p-2 text-[12px]">{r.paymentMethod} · {r.paymentStatus.replace(/_/g, " ")}</td>
              </tr>))}
              {shown.length === 0 ? <tr><td className="p-4 text-slate-500" colSpan={5}>{filter === "live" ? "No rides in progress." : "No rides yet."}</td></tr> : null}</tbody></table>
        </div>
      </div>
      {live ? (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-[13px]">
          <div className="flex items-center justify-between"><strong>Ride {live.id.slice(-8)}</strong><Pill s={live.status} /></div>
          <div className="text-slate-600">Fare version {live.fare?.version ?? "–"}{live.fare?.sample ? " (development sample)" : ""} · {live.paymentMethod} · {live.paymentStatus.replace(/_/g, " ")}{live.cancellationFeePaise ? ` · cancellation fee ${rupees(live.cancellationFeePaise)}` : ""}</div>
          {live.status === "searching" ? (
            <div><div className="mb-1 text-[12px] font-semibold text-slate-600">Assign manually</div>
              <div className="flex gap-2"><select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}><option value="">Choose an available driver</option>{freeDrivers.map((s) => <option key={s.id} value={s.id}>{drivers.find((d) => d.id === s.id)?.name ?? s.driverName ?? s.id}</option>)}</select>
                <Button variant="primary" disabled={!driverId} loading={busy} onClick={() => void run(() => assignRide(live.id, driverId), "Driver assigned.")}>Assign</Button></div>
              {freeDrivers.length === 0 ? <p className="mt-1 text-[12px] text-slate-500">No driver is online and free in this zone.</p> : null}
            </div>) : null}
          {ACTIVE.includes(live.status) && live.status !== "in_progress" ? (
            <div><div className="mb-1 text-[12px] font-semibold text-slate-600">Cancel this ride</div>
              <div className="flex gap-2"><input className={inputCls} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} /><Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={() => void run(() => adminCancelRide(live.id, reason), "Ride cancelled.")}>Cancel ride</Button></div></div>) : null}
          <div><div className="mb-1 text-[12px] font-semibold text-slate-600">Timeline</div>
            {events === null ? <p className="text-[12px] text-slate-500">Loading…</p> : events.length === 0 ? <p className="text-[12px] text-slate-500">No events.</p> : (
              <ol className="max-h-56 space-y-1 overflow-auto text-[12px]">{events.map((e) => <li key={e.id} className="border-l-2 border-slate-200 pl-2"><b>{e.to ? e.to.replace(/_/g, " ") : e.type.replace(/_/g, " ")}</b> · {e.actorRole} · {new Date(e.atMs).toLocaleTimeString("en-IN")}</li>)}</ol>)}</div>
        </div>
      ) : <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-[13px] text-slate-500">Select a ride to see its timeline and controls.</div>}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function LocalTaxi() {
  const [tab, setTab] = useState<Tab>("zones");
  const [zones, setZones] = useState<LtZone[]>([]);
  const [fares, setFares] = useState<LtFare[]>([]);
  const [states, setStates] = useState<LtDriverState[]>([]);
  const [rides, setRides] = useState<LtRide[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [errors, setErrors] = useState<Partial<Record<Tab, string>>>({});
  const [retry, setRetry] = useState(0);
  const { toast, show } = useToast(6000);
  const { tariff } = useTariff();

  useEffect(() => {
    const err = (t: Tab) => (m: string) => setErrors((e) => ({ ...e, [t]: m }));
    const un = [
      watchZones(setZones, err("zones")), watchFares(setFares, err("fares")), watchDriverStates(setStates, err("drivers")), watchRides(setRides, err("rides")),
      subscribeDrivers(setDrivers, err("drivers")), subscribeVehicleCategories(setCategories, err("zones")),
    ];
    setErrors({});
    return () => un.forEach((u) => u());
  }, [retry]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[18px] font-bold text-slate-900">Local Taxi</h2>
        <p className="text-[13px] text-slate-500">On-demand city rides inside service zones you define. Fares are calculated on the server from the zone’s live fare version.</p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" role="tablist">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${tab === t.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>{t.label}</button>)}
      </div>
      {errors[tab] ? <ErrorBanner message={errors[tab]!} onRetry={() => setRetry((n) => n + 1)} /> : null}
      {tab === "zones" ? <ZonesTab zones={zones} categories={categories} tariff={tariff} toast={show} /> : null}
      {tab === "fares" ? <FaresTab zones={zones} fares={fares} categories={categories} tariff={tariff} toast={show} /> : null}
      {tab === "drivers" ? <DriversTab zones={zones} categories={categories} states={states} drivers={drivers} toast={show} /> : null}
      {tab === "rides" ? <RidesTab rides={rides} states={states} drivers={drivers} toast={show} /> : null}
      <Toast toast={toast} />
    </div>
  );
}
