import DateTime12Input from "./DateTime12Input";
import { useMemo, useState } from "react";
import type { VehicleCategory } from "../types";
import { calculateBookingFare, isOutstation, OUTSTATION_THRESHOLD_KM, toEngineCategory } from "../services/bookingFareEngine";

const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * What customers are actually charged: the booking server prices every app
 * and web booking from the active vehicle categories' fares.
 */
export default function AppFarePreview({ categories }: { categories: VehicleCategory[] }) {
  const active = useMemo(() => categories.filter((c) => c.status === "Active").sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99)), [categories]);
  const priced = useMemo(() => active.map((c) => ({ c, e: toEngineCategory(c) })), [active]);
  const bookable = priced.filter((p) => p.e);
  const [categoryId, setCategoryId] = useState("");
  const [distance, setDistance] = useState("");
  const [minutes, setMinutes] = useState("");
  const [tripType, setTripType] = useState<"One Way" | "Round Trip">("One Way");
  const [pickup, setPickup] = useState(nowLocal);
  const [discount, setDiscount] = useState("");

  const selected = bookable.find((p) => p.c.id === categoryId)?.e ?? bookable[0]?.e ?? null;
  const km = Number(distance);
  const mins = Number(minutes);
  const pickupDate = new Date(pickup);
  const inputError =
    !distance || !(km > 0) ? "Enter the one-way road distance." : minutes !== "" && !(mins >= 0) ? "Enter a valid duration." : Number.isNaN(pickupDate.getTime()) ? "Enter the pickup date and time." : "";
  const result =
    selected && !inputError
      ? calculateBookingFare({ category: selected, distanceKm: km, durationMin: mins || 0, tripType, pickupTime: pickupDate, discount: Number(discount) || 0 })
      : null;

  const cls = "w-full p-2 border border-line rounded-xl text-xs focus:border-brand focus:outline-none bg-white";

  return (
    <div className="bg-white rounded-2xl border border-line p-4 sm:p-5 space-y-4 shadow-xs">
      <div>
        <h2 className="text-sm font-bold text-ink">Customer App Fares (booking engine)</h2>
        <p className="text-[11px] text-muted">
          Customer app and web bookings are priced by the server from these vehicle category fares — edit them in Fleet → Vehicle Categories. Fare rules below do not change app prices.
        </p>
      </div>

      {active.length > 0 && bookable.length === 0 && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
          No active category has a per-km rate, so the booking server is pricing customer rides with its built-in default rates. Set the category fares to control prices.
        </div>
      )}
      {active.length === 0 && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
          No active vehicle categories. The booking server is pricing customer rides with its built-in default rates until categories are configured.
        </div>
      )}

      {priced.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-[11px]">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-[10px] uppercase text-faint">
                {["Category", "Base fare / km", "Per km", "Outstation per km", "Time (per min)", "Night charge", "Outstation allowance / 12h", "Minimum fare"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {priced.map(({ c, e }) => (
                <tr key={c.id} className="border-b border-hover last:border-0">
                  <td className="px-3 py-2 font-semibold text-ink">
                    {c.name}
                    {!e && <span className="ml-2 text-[10px] font-bold text-red-600">Not bookable — no per-km rate</span>}
                  </td>
                  {e ? (
                    <>
                      <td className="px-3 py-2">{rupees(e.fare.baseFare)} incl. {e.fare.baseKm} km</td>
                      <td className="px-3 py-2">₹{e.fare.perKmRate}</td>
                      <td className="px-3 py-2">{e.fare.outstationPerKmRate ? `₹${e.fare.outstationPerKmRate}` : "Same as per km"}</td>
                      <td className="px-3 py-2">₹{e.fare.perMinuteRate.toFixed(2)}</td>
                      <td className="px-3 py-2">{rupees(e.fare.nightCharge)}</td>
                      <td className="px-3 py-2">{rupees(e.fare.driverAllowance)}</td>
                      <td className="px-3 py-2">{rupees(e.fare.minimumFare)}</td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-faint" colSpan={7}>—</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bookable.length > 0 && (
        <div className="space-y-3 border-t border-line-soft pt-4">
          <div className="text-[12px] font-bold text-ink">Preview a customer fare</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <label className="block">
              <span className="block text-[10px] font-semibold text-muted mb-1">Category</span>
              <select value={selected ? selected.id : ""} onChange={(ev) => setCategoryId(ev.target.value)} className={cls}>
                {bookable.map(({ c }) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold text-muted mb-1">One-way distance (km)</span>
              <input inputMode="decimal" value={distance} onChange={(ev) => setDistance(ev.target.value.replace(/[^\d.]/g, ""))} className={cls} />
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold text-muted mb-1">Drive time (minutes)</span>
              <input inputMode="numeric" value={minutes} onChange={(ev) => setMinutes(ev.target.value.replace(/\D/g, ""))} className={cls} />
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold text-muted mb-1">Trip type</span>
              <select value={tripType} onChange={(ev) => setTripType(ev.target.value as "One Way" | "Round Trip")} className={cls}>
                <option>One Way</option>
                <option>Round Trip</option>
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold text-muted mb-1">Pickup (IST)</span>
              <DateTime12Input value={pickup} onChange={setPickup} />
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold text-muted mb-1">Coupon discount (₹)</span>
              <input inputMode="numeric" value={discount} onChange={(ev) => setDiscount(ev.target.value.replace(/\D/g, ""))} className={cls} />
            </label>
          </div>
          {inputError && distance !== "" && <p className="text-[11px] text-red-600">{inputError}</p>}
          {result && (
            <div className="bg-gray-50 border border-line rounded-xl p-4 text-xs space-y-2">
              <div className="flex flex-wrap justify-between gap-2 border-b border-gray-200 pb-2">
                <span className="text-muted">
                  {isOutstation(km) ? `Outstation (over ${OUTSTATION_THRESHOLD_KM} km one way)` : "Local"} • {result.distanceKm} km billed
                </span>
                <span>
                  Customer pays <strong className="text-base text-brand">{rupees(result.total)}</strong> (incl. {Math.round(result.gstRate * 100)}% GST)
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  ["Base fare", result.baseFare],
                  ["Distance", result.distanceFare],
                  ["Time", result.timeFare],
                  ["Night charge", result.nightCharge],
                  ["Driver allowance", result.driverAllowance],
                  ["Minimum fare top-up", result.minimumFareAdjustment],
                  ["Discount", -result.discount],
                  ["GST", result.gst],
                ].map(([label, amount]) => (
                  <div key={label as string} className="flex justify-between bg-white px-3 py-1.5 rounded-lg border border-gray-200">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-semibold">{(amount as number) < 0 ? `-${rupees(-(amount as number))}` : rupees(amount as number)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-faint">Road distance and time come from the routing service when a customer books; tolls are added after the trip.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
