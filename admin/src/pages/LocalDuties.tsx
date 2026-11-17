import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { db } from "../services/firebase";
import { ErrorBanner } from "../components/Feedback";
import { Badge, DataTable, EmptyState, KpiCard, KpiGrid, PageHeader, toneForStatus } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import { rupee } from "../domain/officeStage";
import { formatDateTime12 } from "../utils/time";

// Local duties (local_shifts): the continuous Hourly Rental / Pickup & Drop duties fleet partners plan and drivers run from the
// Drive page. Read-only here: the duty is run by the driver and the fleet partner; staff see what is on the road, what was
// done and the cash in hand. Firestore rules allow staff to read local_shifts; every write goes through the local-duty functions.

interface Duty {
  id: string;
  cityName: string;
  driverName: string;
  driverPhone: string;
  vendorName: string;
  vehicleNumber: string;
  vehicleCategory: string;
  services: string[];
  radiusKm: number;
  startsAt: Date | null;
  endsAt: Date | null;
  startedAt: Date | null;
  status: string;
  paused: boolean;
  endRequested: boolean;
  verified: boolean;
  flagged: boolean;
  releases: number;
  byRole: string;
  stats: { orders: number; completed: number; active: number; km: number; fare: number; collected: number; cashInHand: number; balanceDue: number };
}

type Tab = "running" | "planned" | "closed" | "all";

const dateOf = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === "function" ? (v as Timestamp).toDate() : null);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const SERVICE_LABEL: Record<string, string> = { rental: "Hourly Rental", pickup_drop: "Pickup & Drop" };

function mapDuty(id: string, d: Record<string, unknown>): Duty {
  const st = (d.stats && typeof d.stats === "object" ? d.stats : {}) as Record<string, unknown>;
  const ver = (d.verification && typeof d.verification === "object" ? d.verification : {}) as Record<string, unknown>;
  return {
    id,
    cityName: s(d.cityName) || "—",
    driverName: s(d.driverName) || "Driver",
    driverPhone: s(d.driverPhone),
    vendorName: s(d.vendorName) || "—",
    vehicleNumber: s(d.vehicleNumber) || "—",
    vehicleCategory: s(d.vehicleCategory),
    services: Array.isArray(d.services) ? (d.services as unknown[]).filter((x): x is string => typeof x === "string") : [],
    radiusKm: n(d.radiusKm),
    startsAt: dateOf(d.startsAt),
    endsAt: dateOf(d.endsAt),
    startedAt: dateOf(d.startedAt),
    status: s(d.status) || "Scheduled",
    paused: d.paused === true,
    endRequested: !!d.endRequestedAt,
    verified: ver.status === "Submitted",
    flagged: ver.flagged === true,
    releases: n(d.releases),
    byRole: s(d.createdByRole),
    stats: { orders: n(st.orders), completed: n(st.completed), active: n(st.active), km: n(st.km), fare: n(st.fare), collected: n(st.collected), cashInHand: n(st.cashInHand), balanceDue: n(st.balanceDue) },
  };
}

const tabOf = (d: Duty): Exclude<Tab, "all"> => (d.status === "Active" ? "running" : d.status === "Scheduled" ? "planned" : "closed");
const stamp = (d: Date | null) => (d ? formatDateTime12(d) : "—");
const statusText = (d: Duty) => (d.status === "Active" ? (d.endRequested ? "Ending" : d.paused ? "On break" : "On duty") : d.status === "Ended" ? "Closed" : d.status === "Missed" ? "Not started" : d.status);

/** Local duties across all fleets and owner-drivers: who is on duty, where, what they have done and the cash they hold. */
export default function LocalDuties() {
  const [raw, setRaw] = useState<Duty[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("running");
  const [city, setCity] = useState("All");

  useEffect(
    () =>
      onSnapshot(
        query(collection(db, "local_shifts"), orderBy("startsAt", "desc"), limit(300)),
        (snap) => setRaw(snap.docs.map((x) => mapDuty(x.id, x.data()))),
        (err) => {
          setRaw([]);
          setError(err.message || "Local duties could not be loaded.");
        },
      ),
    [],
  );

  const all = useMemo(() => raw ?? [], [raw]);
  const cities = useMemo(() => Array.from(new Set(all.map((d) => d.cityName))).sort(), [all]);
  const counts = { running: 0, planned: 0, closed: 0, all: all.length } as Record<Tab, number>;
  all.forEach((d) => counts[tabOf(d)]++);
  const rows = all.filter((d) => (tab === "all" || tabOf(d) === tab) && (city === "All" || d.cityName === city));
  const running = all.filter((d) => d.status === "Active");
  const cash = running.reduce((sum, d) => sum + d.stats.cashInHand, 0);
  const orders = all.filter((d) => d.status === "Active" || d.status === "Ended").reduce((sum, d) => sum + d.stats.completed, 0);
  const labels: Record<Tab, string> = { running: "Running", planned: "Planned", closed: "Closed", all: "All" };

  return (
    <div className="ds-page-body">
      {error && <ErrorBanner message={error} />}
      <PageHeader title="Local duties" />
      <KpiGrid>
        <KpiCard label="On duty now" value={String(running.filter((d) => !d.paused).length)} note={`${running.filter((d) => d.paused).length} on a break`} />
        <KpiCard label="Planned" value={String(counts.planned)} note="Waiting to start" />
        <KpiCard label="Orders completed" value={String(orders)} note="Running and closed duties" />
        <KpiCard label="Cash with drivers" value={rupee(cash)} note="Running duties, to settle" />
      </KpiGrid>
      <StageBar label="Duty status" tabs={(["running", "planned", "closed", "all"] as const).map((t) => ({ id: t, label: labels[t], count: counts[t] }))} value={tab} onChange={setTab} />
      <div className="ds-filterbar">
        <label className="ds-field" style={{ minWidth: 240 }}>
          <span>City</span>
          <select className="ds-select" value={city} onChange={(e) => setCity(e.target.value)}>
            <option value="All">All</option>
            {cities.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="ds-toolbar-count"><strong>{rows.length} duties</strong></div>
      <p className="ds-note mb-3">Fleet partners plan duties from the vendor app; the driver does the photo check and starts the duty from Drive. Orders taken on a duty open in Bookings.</p>
      {raw === null ? (
        <p className="text-[12px] text-muted">Loading local duties…</p>
      ) : rows.length === 0 ? (
        <div className="ds-panel"><EmptyState /></div>
      ) : (
        <DataTable label="Local duties" minWidth={1100} fixed>
          <colgroup><col style={{ width: 170 }} /><col style={{ width: 200 }} /><col style={{ width: 170 }} /><col style={{ width: 190 }} /><col style={{ width: 200 }} /><col style={{ width: 150 }} /></colgroup>
          <thead><tr><th>CITY · WINDOW (IST)</th><th>DRIVER / FLEET</th><th>VEHICLE</th><th>ORDERS</th><th className="ds-num">FARE / CASH IN HAND</th><th>STATUS</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="ds-row-stripe" data-tone={d.status === "Active" ? "green" : d.status === "Scheduled" ? "amber" : undefined}>
                <td><strong>{d.cityName}</strong><small>{stamp(d.startsAt)}</small><small>to {stamp(d.endsAt)}</small></td>
                <td>
                  <strong>{d.driverName}</strong>
                  <small>{d.vendorName}</small>
                  {d.driverPhone && <small>{d.driverPhone}</small>}
                </td>
                <td><strong>{d.vehicleNumber}</strong><small>{d.vehicleCategory}</small><small>{d.services.map((x) => SERVICE_LABEL[x] ?? x).join(" + ")} · {d.radiusKm} km</small></td>
                <td>
                  <strong>{d.stats.completed} done{d.stats.active ? ` · ${d.stats.active} in hand` : ""}</strong>
                  <small>{Math.round(d.stats.km * 10) / 10} km{d.releases ? ` · ${d.releases} handed back` : ""}</small>
                </td>
                <td className="ds-num">
                  <strong>{rupee(d.stats.fare)}</strong>
                  <small>Collected {rupee(d.stats.collected)}</small>
                  <small>Cash in hand {rupee(d.stats.cashInHand)}{d.stats.balanceDue > 0 ? ` · due ${rupee(d.stats.balanceDue)}` : ""}</small>
                </td>
                <td>
                  <Badge tone={toneForStatus(d.status === "Active" ? "Active" : d.status === "Scheduled" ? "Pending" : d.status === "Ended" ? "Completed" : "Cancelled")}>{statusText(d)}</Badge>
                  <small>{d.status === "Scheduled" ? (d.verified ? "Photo check done" : "Photo check pending") : d.startedAt ? `Started ${stamp(d.startedAt)}` : ""}</small>
                  {d.flagged && <Badge tone="amber">Photos flagged</Badge>}
                  <small>{d.byRole === "driver" ? "Set by driver" : d.byRole === "vendor" ? "Planned by fleet" : ""}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
