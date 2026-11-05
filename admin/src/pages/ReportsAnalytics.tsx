import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import type { Booking, Vendor } from "../types";
import { subscribeBookings, subscribeVendors } from "../services/adminFirestoreService";
import { formatINR, formatPct, GST_RATE, monthlyGstSummary, parseAmount, pctChange } from "../utils/analytics";
import { subscribeLedger, summarizePartner, tripDate, type LedgerEntry } from "../services/earningsService";
import { toDate } from "../services/paymentService";
import { normalizeVendorStatus, VENDOR_STATUS_META } from "../utils/vendorStatus";
import { ErrorBanner } from "../components/Feedback";

const COLORS = ["#c1232c", "#111111", "#444444", "#777777", "#AAAAAA", "#F59E0B", "#10B981"];

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const content = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthStart = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1);
/** Booking date used for demand metrics (when it was booked). */
const bookedOn = (b: Booking) => toDate(b.createdAt) ?? (b.date ? toDate(b.date) : null);
const isPaid = (b: Booking) => b.payment === "Paid" || b.paymentStatus === "Paid";
const serviceOf = (b: Booking) => (b.service || b.serviceType || "Unspecified").trim() || "Unspecified";
const vendorName = (v: Vendor) => v.companyName || (v as Vendor & { business?: { businessName?: string } }).business?.businessName || v.name || v.id;

interface PeriodStats {
  bookings: number;
  completed: number;
  cancelled: number;
  completedRevenue: number;
  collected: number;
}

function periodStats(bookings: Booking[], key: string): PeriodStats {
  const s: PeriodStats = { bookings: 0, completed: 0, cancelled: 0, completedRevenue: 0, collected: 0 };
  for (const b of bookings) {
    const booked = bookedOn(b);
    if (booked && monthKey(booked) === key) {
      s.bookings += 1;
      if (b.status === "Cancelled") s.cancelled += 1;
    }
    if (b.status === "Completed") {
      const done = tripDate(b);
      if (done && monthKey(done) === key) {
        s.completed += 1;
        s.completedRevenue += parseAmount(b.fare);
        if (isPaid(b)) s.collected += parseAmount(b.fare) + Number(b.tollCharges || 0);
      }
    }
  }
  return s;
}

export default function ReportsAnalytics() {
  const [activeTab, setActiveTab] = useState<"bookings" | "revenue" | "vendors" | "cancellations" | "gst">("bookings");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [period, setPeriod] = useState(() => monthKey(new Date()));

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => {
      setLoadError(m);
      setLoading(false);
    };
    const unsubs = [
      subscribeBookings((d) => {
        setBookings(d);
        setLoading(false);
      }, fail),
      subscribeVendors(setVendors, fail),
      subscribeLedger(setLedger, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const prevPeriod = useMemo(() => {
    const d = monthStart(period);
    d.setMonth(d.getMonth() - 1);
    return monthKey(d);
  }, [period]);
  const periodLabel = monthStart(period).toLocaleString("en-IN", { month: "long", year: "numeric" });
  const periodEnd = useMemo(() => {
    const d = monthStart(period);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }, [period]);

  const cur = useMemo(() => periodStats(bookings, period), [bookings, period]);
  const prev = useMemo(() => periodStats(bookings, prevPeriod), [bookings, prevPeriod]);
  const avg = (s: PeriodStats) => (s.completed ? s.completedRevenue / s.completed : 0);
  const rate = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

  const summaryCards = [
    { label: `Bookings Received (${periodLabel})`, value: cur.bookings.toLocaleString("en-IN"), change: pctChange(cur.bookings, prev.bookings), invert: false, color: "#c1232c" },
    { label: "Completed Trip Revenue", value: formatINR(cur.completedRevenue), change: pctChange(cur.completedRevenue, prev.completedRevenue), invert: false, color: "#111" },
    { label: "Payments Collected (completed trips)", value: formatINR(cur.collected), change: pctChange(cur.collected, prev.collected), invert: false, color: "#10B981" },
    { label: "Cancellations", value: `${cur.cancelled} (${rate(cur.cancelled, cur.bookings)})`, change: pctChange(cur.cancelled, prev.cancelled), invert: true, color: "#F59E0B" },
    { label: "Avg Completed Trip Value", value: formatINR(avg(cur)), change: pctChange(avg(cur), avg(prev)), invert: false, color: "#3B82F6" },
  ];

  const byService = useMemo(() => {
    const m = new Map<string, { name: string; thisMonth: number; lastMonth: number }>();
    for (const b of bookings) {
      const d = bookedOn(b);
      if (!d) continue;
      const k = monthKey(d);
      if (k !== period && k !== prevPeriod) continue;
      const name = serviceOf(b);
      const row = m.get(name) ?? { name, thisMonth: 0, lastMonth: 0 };
      if (k === period) row.thisMonth += 1;
      else row.lastMonth += 1;
      m.set(name, row);
    }
    return [...m.values()].sort((a, b) => b.thisMonth - a.thisMonth || b.lastMonth - a.lastMonth);
  }, [bookings, period, prevPeriod]);

  const revenueTrend = useMemo(() => {
    const out: { month: string; completed: number; collected: number; trips: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = monthStart(period);
      d.setMonth(d.getMonth() - i);
      const s = periodStats(bookings, monthKey(d));
      out.push({ month: d.toLocaleString("en-IN", { month: "short", year: "2-digit" }), completed: s.completedRevenue, collected: s.collected, trips: s.completed });
    }
    return out;
  }, [bookings, period]);

  const vendorRows = useMemo(() => {
    const range = { from: monthStart(period), to: periodEnd };
    return vendors
      .map((v) => ({ v, status: normalizeVendorStatus(v), s: summarizePartner("vendor", v.id, bookings, ledger, undefined, range) }))
      .filter((r) => r.status === "APPROVED" || r.s.completedTrips > 0)
      .sort((a, b) => b.s.grossFares - a.s.grossFares);
  }, [vendors, bookings, ledger, period, periodEnd]);

  const cancellationReasons = useMemo(() => {
    const cancelled = bookings.filter((b) => {
      const d = bookedOn(b);
      return b.status === "Cancelled" && d && monthKey(d) === period;
    });
    const counts = new Map<string, number>();
    for (const b of cancelled) {
      const x = b as Booking & { cancelReason?: string; cancellationReason?: string; cancelledBy?: string };
      const reason = (x.cancelReason || x.cancellationReason || "Not specified").trim();
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count, pct: cancelled.length ? `${Math.round((count / cancelled.length) * 100)}%` : "0%" }));
  }, [bookings, period]);

  const gstRows = useMemo(() => monthlyGstSummary(bookings), [bookings]);

  const monthOptions = useMemo(() => {
    const keys = new Set<string>([monthKey(new Date())]);
    for (const b of bookings) {
      const d = bookedOn(b) ?? tripDate(b);
      if (d) keys.add(monthKey(d));
    }
    return [...keys].sort().reverse();
  }, [bookings]);

  const handleExportReport = () => {
    if (activeTab === "bookings") {
      downloadCsv(`nesam_bookings_by_service_${period}.csv`, ["Service", periodLabel, "Previous month"], byService.map((b) => [b.name, b.thisMonth, b.lastMonth]));
    } else if (activeTab === "revenue") {
      downloadCsv(`nesam_revenue_trend_${period}.csv`, ["Month", "Completed Trips", "Completed Trip Revenue", "Collected"], revenueTrend.map((r) => [r.month, r.trips, r.completed, r.collected]));
    } else if (activeTab === "vendors") {
      downloadCsv(`nesam_vendor_report_${period}.csv`, ["Vendor", "Status", "Completed Trips", "Gross Fares", "Vendor Earnings", "Platform Share"], vendorRows.map((r) => [vendorName(r.v), VENDOR_STATUS_META[r.status].label, r.s.completedTrips, r.s.grossFares, r.s.earnings, r.s.platformShare]));
    } else if (activeTab === "cancellations") {
      downloadCsv(`nesam_cancellations_${period}.csv`, ["Cancellation Reason", "Bookings", "Share"], cancellationReasons.map((c) => [c.reason, c.count, c.pct]));
    } else {
      downloadCsv("nesam_gst_summary.csv", ["Month", "Completed Trips", "Taxable Value", "GST Rate", "GST Collected", "Gross (incl. GST)"], gstRows.map((g) => [g.month, g.trips, g.taxable, `${GST_RATE * 100}%`, g.gst, g.total]));
    }
  };

  const Empty = ({ text }: { text: string }) => <div className="py-16 text-center text-[13px] text-faint">{text}</div>;

  return (
    <div className="p-6 space-y-5">
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold text-ink">Reports & Business Analytics</h2>
          <p className="text-[12px] text-muted">All figures are calculated from live bookings, vendors and the partner ledger.</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Report month" value={period} onChange={(e) => setPeriod(e.target.value)} className="px-3 py-2 text-[12px] border border-line rounded-lg bg-white">
            {monthOptions.map((k) => (
              <option key={k} value={k}>{monthStart(k).toLocaleString("en-IN", { month: "long", year: "numeric" })}</option>
            ))}
          </select>
          <button onClick={handleExportReport} className="text-[12px] font-semibold px-4 py-2 rounded-lg border border-line bg-white text-brand hover:bg-brand-soft shadow-sm">
            📥 Export Active View (CSV)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {summaryCards.map((s) => {
          const good = s.change === null ? null : s.invert ? s.change <= 0 : s.change >= 0;
          return (
            <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
              <div className="text-[20px] font-bold" style={{ color: s.color }}>{loading ? "—" : s.value}</div>
              <div className="text-[11px] text-faint mt-0.5">{s.label}</div>
              <div className={`text-[11px] font-semibold mt-1 ${good === null ? "text-faint" : good ? "text-green-600" : "text-brand"}`}>
                {formatPct(s.change)}
                {s.change !== null && " vs previous month"}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1 bg-white rounded-xl border border-line p-1 w-fit shadow-sm">
        {[
          { key: "bookings" as const, label: "Bookings" },
          { key: "revenue" as const, label: "Revenue" },
          { key: "vendors" as const, label: "Vendor Reports" },
          { key: "cancellations" as const, label: "Cancellations" },
          { key: "gst" as const, label: "GST Summary" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-[12px] font-semibold transition-all cursor-pointer ${activeTab === t.key ? "text-white shadow-sm" : "text-muted hover:text-ink"}`}
            style={activeTab === t.key ? { background: "#c1232c" } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "bookings" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white rounded-xl border border-line shadow-sm p-5">
            <h3 className="text-[14px] font-bold text-ink mb-4">Bookings by Service — {periodLabel} vs previous month</h3>
            {byService.length === 0 ? (
              <Empty text="No bookings in these months." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={byService} barSize={24}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#999" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip formatter={(v, n) => [`${v} bookings`, String(n)]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                  <Legend formatter={(v) => <span className="text-[11px] text-muted">{v}</span>} />
                  <Bar dataKey="thisMonth" name={periodLabel} fill="#c1232c" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="lastMonth" name="Previous month" fill="#D4D4D4" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="bg-white rounded-xl border border-line shadow-sm p-5">
            <h3 className="text-[14px] font-bold text-ink mb-4">Service Mix — {periodLabel}</h3>
            {byService.filter((d) => d.thisMonth > 0).length === 0 ? (
              <Empty text="No bookings this month." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={byService.filter((d) => d.thisMonth > 0).map((d) => ({ name: d.name, value: d.thisMonth }))} cx="50%" cy="50%" innerRadius={55} outerRadius={90} dataKey="value" paddingAngle={3}>
                    {byService.filter((d) => d.thisMonth > 0).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend formatter={(v) => <span className="text-[11px] text-muted">{v}</span>} />
                  <Tooltip formatter={(v) => [`${v} bookings`, ""]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="mt-2 text-[11px] text-faint">
              Completion rate: {rate(cur.completed, cur.completed + cur.cancelled)} of trips that finished or were cancelled.
            </div>
          </div>
        </div>
      )}

      {activeTab === "revenue" && (
        <div className="bg-white rounded-xl border border-line shadow-sm p-5">
          <h3 className="text-[14px] font-bold text-ink mb-1">Revenue — last 6 months to {periodLabel}</h3>
          <p className="text-[11px] text-faint mb-4">Completed trip revenue is the GST-inclusive fare of trips completed in the month; collected is the verified payment on those trips (incl. tolls).</p>
          {revenueTrend.every((r) => r.completed === 0 && r.collected === 0) ? (
            <Empty text="No completed trips in this period." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={revenueTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#999" }} axisLine={false} tickLine={false} tickFormatter={(v) => formatINR(Number(v))} />
                <Tooltip formatter={(v, n) => [`₹${Math.round(Number(v)).toLocaleString("en-IN")}`, String(n)]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E5E5" }} />
                <Legend formatter={(v) => <span className="text-[11px] text-muted">{v}</span>} />
                <Line type="monotone" dataKey="completed" name="Completed trip revenue" stroke="#c1232c" strokeWidth={2.5} dot={{ r: 4, fill: "#c1232c" }} />
                <Line type="monotone" dataKey="collected" name="Collected" stroke="#111111" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {activeTab === "vendors" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <span className="text-[13px] font-bold text-ink">Vendor Performance — {periodLabel} ({vendorRows.length})</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {["Vendor", "Status", "Completed Trips", "Gross Fares", "Vendor Earnings", "Platform Share"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vendorRows.map(({ v, status, s }) => (
                  <tr key={v.id} className="border-b border-hover last:border-0 text-[12px] hover:bg-surface-2">
                    <td className="px-4 py-3 font-semibold text-ink">{vendorName(v)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${VENDOR_STATUS_META[status].badge}`}>{VENDOR_STATUS_META[status].label}</span>
                    </td>
                    <td className="px-4 py-3 font-semibold">{s.completedTrips}</td>
                    <td className="px-4 py-3">{formatINR(s.grossFares)}</td>
                    <td className="px-4 py-3 text-green-700 font-semibold">{formatINR(s.earnings)}</td>
                    <td className="px-4 py-3 text-brand">{formatINR(s.platformShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {vendorRows.length === 0 && <Empty text="No approved vendors or vendor trips yet." />}
          </div>
        </div>
      )}

      {activeTab === "cancellations" && (
        <div className="bg-white rounded-xl border border-line shadow-sm p-5">
          <h3 className="text-[14px] font-bold text-ink mb-4">Cancellation Reasons — bookings made in {periodLabel}</h3>
          {cancellationReasons.length === 0 ? (
            <Empty text="No cancellations for bookings made this month." />
          ) : (
            <div className="space-y-3">
              {cancellationReasons.map((r) => (
                <div key={r.reason} className="flex items-center justify-between p-3 rounded-lg bg-surface-2">
                  <div className="text-[13px] font-semibold text-ink">{r.reason}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-faint">{r.count} booking{r.count === 1 ? "" : "s"}</span>
                    <span className="text-[12px] font-bold text-brand px-2.5 py-0.5 rounded bg-red-50">{r.pct}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "gst" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-line">
            <h3 className="text-[14px] font-bold text-ink">GST on Completed Trips (SAC 9964)</h3>
            <p className="text-[12px] text-muted">Output GST contained in completed trip fares, using each booking's server fare breakdown. Filing is done outside the platform.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {["Month", "Completed Trips", "Taxable Value", "GST Rate", "GST Collected", "Gross (incl. GST)"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {gstRows.map((r) => (
                  <tr key={r.month} className="border-b border-hover last:border-0 text-[12px] hover:bg-surface-2">
                    <td className="px-4 py-3 font-semibold text-ink">{r.month}</td>
                    <td className="px-4 py-3">{r.trips}</td>
                    <td className="px-4 py-3">₹{r.taxable.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 font-semibold text-brand">{GST_RATE * 100}%</td>
                    <td className="px-4 py-3 font-bold">₹{r.gst.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-3 font-bold">₹{r.total.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {gstRows.length === 0 && <Empty text="No completed trips yet, so there is no GST to report." />}
          </div>
        </div>
      )}
    </div>
  );
}
