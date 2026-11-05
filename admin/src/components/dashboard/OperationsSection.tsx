import { useMemo } from "react";
import type { Booking, PenaltyRecord } from "../../types";
import { AlertBadge, StatusBadge } from "../booking/BookingBadges";
import { paymentOf, penaltyStatusOf, unassignedSeverity, type UnassignedThresholds } from "../../domain/bookingFlow";
import { bookingPickupDate, dayOffsetIST, formatTime12, relativeFromNow } from "../../utils/time";

interface Props {
  bookings: Booking[];
  penalties: PenaltyRecord[];
  now: Date;
  thresholds: UnassignedThresholds;
  loading: boolean;
  onNavigate: (page: string) => void;
  onSelectBooking: (id: string) => void;
}

const OPEN = ["Pending", "Approved", "Confirmed", "Assigned", "Ongoing"];

function TripCard({ b, now, thresholds, onOpen }: { b: Booking; now: Date; thresholds: UnassignedThresholds; onOpen: () => void }) {
  const p = bookingPickupDate(b);
  const sev = unassignedSeverity(b, p?.getTime() ?? null, now.getTime(), thresholds);
  return (
    <li>
      <button type="button" onClick={onOpen} className={`w-full text-left p-3 rounded-lg border hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand ${sev === "critical" ? "border-red-300 bg-red-50" : sev === "warning" ? "border-amber-300 bg-amber-50" : "border-line bg-white"}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="text-base font-bold text-ink">{p ? formatTime12(p) : b.time}</div>
          <StatusBadge status={b.status} />
        </div>
        <div className="text-sm font-semibold text-ink mt-0.5">{b.customer}</div>
        <div className="text-sm text-body truncate">{b.pickup} → {b.drop}</div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted">
          <span>{b.vehicleCategory || b.vehicle}</span>
          <span className={b.assignedDriverId ? "" : "font-semibold text-red-700"}>{b.assignedDriverName || b.driver || (b.assignedVendorName ? `Vendor: ${b.assignedVendorName}` : "No driver assigned")}</span>
          {p && b.status !== "Completed" && <span>{relativeFromNow(p, now)}</span>}
        </div>
        {sev !== "none" && sev !== "normal" && <div className="mt-1"><AlertBadge severity={sev} /></div>}
      </button>
    </li>
  );
}

function TripColumn({ title, subtitle, rows, now, thresholds, loading, onSelect }: { title: string; subtitle: string; rows: Booking[]; now: Date; thresholds: UnassignedThresholds; loading: boolean; onSelect: (id: string) => void }) {
  return (
    <section className="bg-white rounded-xl border border-line shadow-sm p-4" aria-label={title}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-[15px] font-bold text-ink">{title}</h3>
        <span className="text-xs text-muted">{subtitle} · {rows.length} trip{rows.length === 1 ? "" : "s"}</span>
      </div>
      {loading ? <p className="text-sm text-muted" role="status">Loading…</p> : rows.length === 0 ? <p className="text-sm text-muted py-4 text-center">No trips scheduled.</p> : (
        <ul className="space-y-2 max-h-[26rem] overflow-auto pr-1">{rows.map((b) => <TripCard key={b.id} b={b} now={now} thresholds={thresholds} onOpen={() => onSelect(b.id)} />)}</ul>
      )}
    </section>
  );
}

/**
 * The operational part of the dashboard: what needs action now (counts that
 * open the right screen), today's and tomorrow's trips, and bookings with a
 * pickup coming up and no driver.
 */
export default function OperationsSection({ bookings, penalties, now, thresholds, loading, onNavigate, onSelectBooking }: Props) {
  const data = useMemo(() => {
    const today: Booking[] = [], tomorrow: Booking[] = [], unassigned: { b: Booking; sev: "warning" | "critical" }[] = [];
    let pending = 0, approved = 0, ongoing = 0, completedToday = 0, paymentsDue = 0, paymentsDueAmount = 0, refundsPending = 0, refundsPendingAmount = 0;
    for (const b of bookings) {
      const p = bookingPickupDate(b);
      const offset = p ? dayOffsetIST(p, now) : null;
      if (b.status === "Pending") pending++;
      if (b.status === "Approved") approved++;
      if (b.status === "Ongoing") ongoing++;
      if (b.status === "Completed" && p && dayOffsetIST(p, now) === 0) completedToday++;
      if (OPEN.includes(b.status) && p) {
        if (offset === 0) today.push(b);
        else if (offset === 1) tomorrow.push(b);
      }
      const sev = unassignedSeverity(b, p?.getTime() ?? null, now.getTime(), thresholds);
      if (sev === "warning" || sev === "critical") unassigned.push({ b, sev });
      const pay = paymentOf(b);
      if (b.status === "Completed" && pay.balanceDue > 0) { paymentsDue++; paymentsDueAmount += pay.balanceDue; }
      if (b.refund && (b.refund.status === "Pending" || b.refund.status === "Processing")) { refundsPending++; refundsPendingAmount += b.refund.amount; }
    }
    const byPickup = (a: Booking, c: Booking) => (bookingPickupDate(a)?.getTime() ?? 0) - (bookingPickupDate(c)?.getTime() ?? 0);
    today.sort(byPickup);
    tomorrow.sort(byPickup);
    unassigned.sort((x, y) => (x.sev === y.sev ? byPickup(x.b, y.b) : x.sev === "critical" ? -1 : 1));
    const penaltiesOpen = penalties.filter((p) => ["Pending", "Disputed", "Acknowledged"].includes(penaltyStatusOf(p.status))).length;
    return { today, tomorrow, unassigned, pending, approved, ongoing, completedToday, paymentsDue, paymentsDueAmount, refundsPending, refundsPendingAmount, penaltiesOpen };
  }, [bookings, penalties, now, thresholds]);

  const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
  const critical = data.unassigned.filter((u) => u.sev === "critical").length;
  const cards: { label: string; value: string; sub?: string; tone: "red" | "amber" | "blue" | "green" | "neutral"; go: string }[] = [
    { label: "Today’s trips", value: String(data.today.length), tone: "blue", go: "bookings" },
    { label: "Tomorrow’s trips", value: String(data.tomorrow.length), tone: "blue", go: "bookings" },
    { label: "Pending approval", value: String(data.pending), sub: data.pending ? "Needs review" : undefined, tone: data.pending ? "amber" : "neutral", go: "bookings" },
    { label: "Approved", value: String(data.approved), sub: "Open to partners", tone: "neutral", go: "bookings" },
    { label: "Unassigned trips", value: String(data.unassigned.length), sub: critical ? `${critical} urgent` : undefined, tone: critical ? "red" : data.unassigned.length ? "amber" : "neutral", go: "bookings" },
    { label: "Ongoing trips", value: String(data.ongoing), tone: "green", go: "trips" },
    { label: "Completed today", value: String(data.completedToday), tone: "green", go: "bookings" },
    { label: "Pending payments", value: String(data.paymentsDue), sub: data.paymentsDue ? rupees(data.paymentsDueAmount) : undefined, tone: data.paymentsDue ? "amber" : "neutral", go: "payments" },
    { label: "Pending refunds", value: String(data.refundsPending), sub: data.refundsPending ? rupees(data.refundsPendingAmount) : undefined, tone: data.refundsPending ? "amber" : "neutral", go: "bookings" },
    { label: "Open penalties", value: String(data.penaltiesOpen), tone: data.penaltiesOpen ? "amber" : "neutral", go: "penalties" },
  ];
  const tone = { red: "border-red-300 bg-red-50 text-red-800", amber: "border-amber-300 bg-amber-50 text-amber-900", blue: "border-blue-200 bg-blue-50 text-blue-900", green: "border-green-200 bg-green-50 text-green-900", neutral: "border-line bg-white text-ink" };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={() => onNavigate(c.go)} className={`text-left rounded-xl border p-3.5 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-brand ${tone[c.tone]}`}>
            <div className="text-2xl font-extrabold leading-tight">{loading ? "…" : c.value}</div>
            <div className="text-sm font-semibold mt-0.5">{c.label}</div>
            {c.sub && <div className="text-xs font-semibold opacity-80 mt-0.5">{c.sub}</div>}
          </button>
        ))}
      </div>

      {data.unassigned.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-white shadow-sm p-4" aria-label="Bookings without a driver">
          <h3 className="text-[15px] font-bold text-ink mb-1">⚠ Pickup coming up — no driver assigned</h3>
          <p className="text-xs text-muted mb-3">Warning within {thresholds.warningHours} h of pickup, urgent within {thresholds.criticalHours} h. Change these in Settings.</p>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {data.unassigned.slice(0, 6).map(({ b, sev }) => {
              const p = bookingPickupDate(b);
              return (
                <li key={b.id}>
                  <button type="button" onClick={() => onSelectBooking(b.id)} className={`w-full text-left p-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-brand ${sev === "critical" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
                    <div className="flex justify-between gap-2"><span className="font-bold text-ink">{p ? formatTime12(p) : b.time} · {b.bookingId || b.id}</span><AlertBadge severity={sev} label={p ? relativeFromNow(p, now).replace(/^in /, "") : undefined} /></div>
                    <div className="text-sm text-body truncate">{b.customer} · {b.pickup} → {b.drop}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          {data.unassigned.length > 6 && <button onClick={() => onNavigate("bookings")} className="mt-2 text-sm font-semibold text-brand hover:underline">View all {data.unassigned.length}</button>}
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <TripColumn title="Today’s trips" subtitle={new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "2-digit", month: "short" })} rows={data.today} now={now} thresholds={thresholds} loading={loading} onSelect={onSelectBooking} />
        <TripColumn title="Tomorrow’s trips" subtitle={new Date(now.getTime() + 86400000).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "2-digit", month: "short" })} rows={data.tomorrow} now={now} thresholds={thresholds} loading={loading} onSelect={onSelectBooking} />
      </div>
    </div>
  );
}
