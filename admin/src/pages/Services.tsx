import { useEffect, useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import type { TravelService, VehicleCategory } from "../types";
import { subscribeServices, subscribeVehicleCategories } from "../services/adminFirestoreService";
import { DEFAULT_SERVICES, ServiceActionError, seedDefaultServices } from "../services/serviceMasterService";
import { auth, db } from "../services/firebase";
import { ErrorBanner, Toast, useToast } from "../components/Feedback";
import { useCan, useCanDo } from "../components/AccessContext";

/**
 * The services customers can book, one row each — the same six as in Service & Fare Settings. Two switches per service: whether customers can
 * book it online (on every brand), and whether the office can book it. The booking server reads exactly these records on every quote and booking.
 * Which vehicles a service offers, and per-brand or per-place limits, are set in Service & Fare Settings → Booking rules.
 */
type Channel = "online" | "admin";
interface Row { key: string; label: string; hint: string; type: string }
const ROWS: Row[] = [
  { key: "oneWay", label: "One Way", hint: "A cab from the pickup to the drop; pay only for the way", type: "One Way Taxi" },
  { key: "roundTrip", label: "Round Trip", hint: "Out and back: 5-hour, 8-hour, full-day, next-day and multi-day packages", type: "Outstation Cab" },
  { key: "airport", label: "Airport Taxi", hint: "Airport pickups and drops", type: "Airport Taxi" },
  { key: "rental", label: "Local Rental", hint: "A cab and driver by the hour inside a city", type: "Local Rental" },
  { key: "pickupDrop", label: "Pickup & Drop", hint: "A trip from one place to another inside one city", type: "Local Pickup & Drop" },
  { key: "multicity", label: "Multicity", hint: "One cab through several cities", type: "Multicity" },
];
const FIELD: Record<Channel, "onlineBookingEnabled" | "adminBookingEnabled"> = { online: "onlineBookingEnabled", admin: "adminBookingEnabled" };

const recordOf = (services: TravelService[], type: string) => services.find((s) => s.serviceType === type);
/** On = a record exists, is Active and has the channel switched on. A service with no record yet is not managed here, and customers can still book it. */
const isOn = (s: TravelService | undefined, channel: Channel) => !s || (s.status === "Active" && (channel === "online" ? s.onlineBookingEnabled === true : s.adminBookingEnabled !== false));

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
      style={{ background: on ? "var(--color-brand)" : "#cfd6df" }}>
      <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition" style={{ transform: `translateX(${on ? 22 : 2}px)` }} />
    </button>
  );
}

export default function Services() {
  const [services, setServices] = useState<TravelService[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast, show } = useToast();
  const canEdit = useCan("system") && useCanDo("Settings", "edit");

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => { setLoadError(m); setLoading(false); };
    const a = subscribeServices((d) => { setServices(d); setLoading(false); }, fail);
    const b = subscribeVehicleCategories((d) => setCategories(d), fail);
    return () => { a(); b(); };
  }, [retry]);

  const activeCategories = useMemo(() => categories.filter((c) => c.status === "Active"), [categories]);
  const vehiclesOf = (s: TravelService | undefined) => {
    const ids = s?.allowedVehicleCategoryIds ?? [];
    if (!ids.length) return "All vehicles";
    const names = activeCategories.filter((c) => ids.includes(c.id)).map((c) => c.name);
    return names.length ? names.join(", ") : `${ids.length} vehicle${ids.length === 1 ? "" : "s"}`;
  };

  /** Switches one service on or off for customers and the office together. A service with no record yet gets the standard records first. */
  const toggle = async (row: Row, value: boolean) => {
    if (!canEdit || busy) return;
    setBusy(row.key);
    try {
      const uid = auth.currentUser?.uid || "";
      if (ROWS.some((r) => !recordOf(services, r.type))) await seedDefaultServices(services, uid);
      const idOf = (type: string) => recordOf(services, type)?.id ?? DEFAULT_SERVICES.find((d) => d.serviceType === type)!.id;
      await updateDoc(doc(db, "services", idOf(row.type)), { onlineBookingEnabled: value, adminBookingEnabled: value, ...(value ? { status: "Active" } : {}), updatedAt: serverTimestamp() });
      // The outstation record serves Round Trip only: One Way has its own record, so the two switches never move together.
      if (row.key === "oneWay" || row.key === "roundTrip") await updateDoc(doc(db, "services", idOf("Outstation Cab")), { "outstationOptions.roundTripAllowed": true, "outstationOptions.oneWayAllowed": false });
      show(value ? `${row.label} is on.` : `${row.label} is off — it shows as currently unavailable in all apps.`);
    } catch (e) {
      show(e instanceof ServiceActionError ? e.message : "That could not be saved. Please try again.", "error");
    } finally {
      setBusy(null);
    }
  };

  const notSetUp = ROWS.filter((r) => !recordOf(services, r.type)).length;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetry((n) => n + 1)} />}
      <div>
        <h1 className="text-xl font-bold text-ink">Services</h1>
        <p className="text-sm text-muted">One switch per service, for customers on all three sites and for the office. When a service is off it shows as “Currently unavailable” in every app and cannot be booked; bookings already made are not affected.</p>
      </div>
      {notSetUp > 0 && !loading ? (
        <p className="text-[12px] text-muted">{notSetUp} service{notSetUp === 1 ? "" : "s"} below {notSetUp === 1 ? "has" : "have"} not been set up yet and {notSetUp === 1 ? "is" : "are"} open to customers. Use any switch to set {notSetUp === 1 ? "it" : "them"} up.</p>
      ) : null}

      <div className="ds-panel" style={{ overflowX: "auto" }}>
        <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-faint" style={{ borderBottom: "1px solid var(--color-line)" }}>
              <th className="px-4 py-3 font-semibold">Service</th>
              <th className="px-4 py-3 font-semibold" style={{ width: 230 }}>Status</th>
              <th className="px-4 py-3 font-semibold">Vehicles</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-4 py-6 text-muted" role="status">Loading services…</td></tr>
            ) : ROWS.map((row) => {
              const rec = recordOf(services, row.type);
              const on = isOn(rec, "online") && isOn(rec, "admin");
              return (
                <tr key={row.key} style={{ borderBottom: "1px solid var(--color-line)" }}>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-ink">{row.label}</div>
                    <div className="text-[12px] text-muted">{row.hint}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Switch on={on} disabled={!canEdit || busy !== null} label={`${row.label} on or off`} onChange={(v) => void toggle(row, v)} />
                      <span className={`text-[12px] font-semibold ${on ? "text-ok" : "text-bad"}`}>{on ? "On" : "Currently unavailable"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted">{rec ? vehiclesOf(rec) : "All vehicles"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canEdit ? <p className="text-[12px] text-muted">Changing these switches needs Settings edit access.</p> : null}
    </div>
  );
}
