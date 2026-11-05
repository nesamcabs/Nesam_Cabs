import { useState, useEffect, useMemo } from "react";
import {
  AreaChart,
  Area,
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
} from "recharts";
import { Booking, Driver, Vehicle, Customer, PenaltyRecord } from "../types";
import { StatusBadge, PaymentBadge, BookingSourceBadge, bookingSourceRowCls } from "../components/booking/BookingBadges";
import OperationsSection from "../components/dashboard/OperationsSection";
import OfficeDashboard from "../components/dashboard/OfficeDashboard";
import StaffDashboard from "../components/dashboard/StaffDashboard";
import { useAccess } from "../components/AccessContext";
import type { NavBadges } from "../hooks/useNavBadges";
import type { CategoryEstimate, QuickTrip } from "../components/booking/QuickFare";
import type { Enquiry } from "../services/enquiryService";
import { useNow } from "../hooks/useNow";
import { useOperationsSettings } from "../hooks/useOperationsSettings";
import { paymentOf } from "../domain/bookingFlow";
import { ErrorBanner, Toast, useToast } from "../components/Feedback";
import {
  subscribeBookings,
  subscribeDrivers,
  subscribeVehicles,
  subscribeCustomers,
  subscribePenalties,
} from "../services/adminFirestoreService";
import {
  parseAmount,
  bookingDate,
  isPaid,
  formatINR,
} from "../utils/analytics";
import { formatDateTime12, formatShortDateTime12, formatHourLabel } from "../utils/time";

const categoryColors: Record<string, string> = {
  "Airport Taxi": "#c1232c",
  "Outstation Cab": "#3B82F6",
  "One Way Taxi": "#10B981",
  "Local Rental": "#F59E0B",
  "Tour Package": "#8B5CF6",
};

interface DashboardProps {
  onNavigate: (page: string, tab?: string) => void;
  onSelectBooking: (id: string) => void;
  onNewBooking: () => void;
  onProceed: (trip: QuickTrip, categoryId: string, estimates: CategoryEstimate[]) => void;
  onEnquirySaved: (e: Enquiry) => void;
  badges?: NavBadges;
}

/**
 * One dashboard for every admin. The Master account keeps the full overview. Staff get sections
 * composed from their effective access; the full business overview needs every area it reads
 * (bookings, people, fleet and finance), the booking / dispatch board needs bookings.
 */
export default function Dashboard(props: DashboardProps) {
  const access = useAccess();
  if (access.isSuper) return <MasterDashboard {...props} />;
  const has = (p: (typeof access.permissions)[number]) => access.permissions.includes(p);
  const fullOverview = has("operations") && has("people") && has("fleet") && has("finance");
  const workspace = fullOverview ? (
    <MasterDashboard {...props} />
  ) : has("operations") ? (
    <OfficeDashboard onNavigate={props.onNavigate} onSelectBooking={props.onSelectBooking} onNewBooking={props.onNewBooking} onProceed={props.onProceed} onEnquirySaved={props.onEnquirySaved} />
  ) : null;
  return <StaffDashboard access={access} badges={props.badges} onNavigate={props.onNavigate} onNewBooking={props.onNewBooking} workspace={workspace} />;
}

function MasterDashboard({
  onNavigate,
  onSelectBooking,
  onNewBooking,
  onProceed,
  onEnquirySaved,
}: DashboardProps) {
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [livePenalties, setLivePenalties] = useState<PenaltyRecord[]>([]);
  const now = useNow(30000);
  const ops = useOperationsSettings();
  const { toast } = useToast(9000);
  const [revenueTab, setRevenueTab] = useState("month");
  const [liveBookings, setLiveBookings] = useState<Booking[]>([]);
  const [liveDrivers, setLiveDrivers] = useState<Driver[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>([]);
  const [liveCustomers, setLiveCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    setLoadError(null);
    setLoaded(false);
    const unsub1 = subscribeBookings((d) => { setLiveBookings(d); setLoaded(true); }, setLoadError);
    const unsub2 = subscribeDrivers(setLiveDrivers, setLoadError);
    const unsub3 = subscribeVehicles(setLiveVehicles, setLoadError);
    const unsub4 = subscribeCustomers(setLiveCustomers, setLoadError);
    const unsub5 = subscribePenalties(setLivePenalties, setLoadError);
    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
    };
  }, [retryKey]);

  const activeTripsCount = liveBookings.filter(
    (b) =>
      b.status === "Ongoing" ||
      b.status === "In Progress" ||
      b.status === "Assigned",
  ).length;

  // Revenue chart — computed live from bookings for the selected window.
  const revenueData = useMemo(() => {
    const now = new Date();
    const buckets: { label: string; start: Date; end: Date }[] = [];
    if (revenueTab === "year") {
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        buckets.push({
          label: start.toLocaleString("en-US", { month: "short" }),
          start,
          end,
        });
      }
    } else if (revenueTab === "week") {
      for (let i = 6; i >= 0; i--) {
        const start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - i,
        );
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        buckets.push({
          label: start.toLocaleString("en-US", { weekday: "short" }),
          start,
          end,
        });
      }
    } else if (revenueTab === "today") {
      for (let h = 0; h < 24; h += 3) {
        const start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          h,
        );
        const end = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          h + 3,
        );
        buckets.push({ label: formatHourLabel(h), start, end });
      }
    } else {
      // month — last 30 days
      for (let i = 29; i >= 0; i--) {
        const start = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() - i,
        );
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
        buckets.push({
          label: `${start.getDate()}/${start.getMonth() + 1}`,
          start,
          end,
        });
      }
    }
    return buckets.map((bk) => {
      const inRange = liveBookings.filter((b) => {
        const d = bookingDate(b);
        return d !== null && d >= bk.start && d < bk.end;
      });
      const total = inRange.reduce((s, b) => s + parseAmount(b.fare), 0);
      const tour = inRange
        .filter((b) =>
          (b.service || b.serviceType || "").toLowerCase().includes("tour"),
        )
        .reduce((s, b) => s + parseAmount(b.fare), 0);
      return { month: bk.label, total, booking: total - tour, tour };
    });
  }, [liveBookings, revenueTab]);

  const hasRevenue = revenueData.some((d) => d.total > 0);

  const totalRevenue = useMemo(
    () =>
      liveBookings.filter(isPaid).reduce((s, b) => s + parseAmount(b.fare), 0),
    [liveBookings],
  );

  const monthRevenue = useMemo(() => {
    const n = new Date();
    return liveBookings
      .filter((b) => {
        const d = bookingDate(b);
        return (
          d !== null &&
          d.getMonth() === n.getMonth() &&
          d.getFullYear() === n.getFullYear() &&
          isPaid(b)
        );
      })
      .reduce((s, b) => s + parseAmount(b.fare), 0);
  }, [liveBookings]);
  const availableVehiclesCount = liveVehicles.filter(
    (v) => v.status === "Available" || v.status === "Active",
  ).length;
  const availableDriversCount = liveDrivers.filter(
    (d) => d.status === "Online" || d.status === "Available",
  ).length;

  const kpiCards = [
    {
      title: "Total Bookings",
      value: liveBookings.length.toLocaleString(),
      sub: `Live synced from Firestore`,
      icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
    },
    {
      title: "Active Trips",
      value: activeTripsCount.toString(),
      sub: `${liveDrivers.length} registered drivers`,
      live: true,
      icon: "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
    },
    {
      title: "Total Customers",
      value: liveCustomers.length.toLocaleString(),
      sub: `Registered users`,
      icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    },
    {
      title: "Total Revenue",
      value: formatINR(totalRevenue),
      sub: `This month: ${formatINR(monthRevenue)}`,
      icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
      accent: true,
    },
    {
      title: "Available Vehicles",
      value: availableVehiclesCount.toString(),
      sub: `${liveVehicles.length} registered vehicles`,
      icon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
    },
    {
      title: "Available Drivers",
      value: availableDriversCount.toString(),
      sub: `${liveDrivers.length} total registered`,
      icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    },
  ];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-line rounded-xl p-3 shadow-xl text-[12px]">
          <div className="font-semibold text-ink mb-2">{label}</div>
          {payload.map((p: any, i: number) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: p.color }}
              />
              <span className="text-muted">{p.name}:</span>
              <span className="font-semibold text-ink">
                ₹{(p.value / 1000).toFixed(0)}K
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="ds-page-body space-y-6">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <OfficeDashboard onNavigate={onNavigate} onSelectBooking={onSelectBooking} onNewBooking={onNewBooking} onProceed={onProceed} onEnquirySaved={onEnquirySaved} />

      <h2 className="text-lg font-bold text-ink pt-2">Today &amp; tomorrow</h2>
      <OperationsSection bookings={liveBookings} penalties={livePenalties} now={now} thresholds={ops} loading={!loaded && !loadError} onNavigate={onNavigate} onSelectBooking={onSelectBooking} />

      <h2 className="text-lg font-bold text-ink pt-2">Business overview</h2>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((card, i) => (
          <div
            key={i}
            className={`rounded-xl p-4 border ${card.accent ? "border-brand/20" : "border-line"} bg-white shadow-sm hover:shadow-md transition-shadow cursor-default`}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${card.accent ? "" : "bg-brand-soft"}`}
                style={card.accent ? { background: "#c1232c" } : {}}
              >
                <svg
                  className={`w-[18px] h-[18px] ${card.accent ? "text-white" : "text-brand"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.75}
                >
                  {card.icon.split(" M").map((d, idx) => (
                    <path
                      key={idx}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d={idx === 0 ? d : "M" + d}
                    />
                  ))}
                </svg>
              </div>
              {card.live && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full badge-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <div className="text-[22px] font-bold text-ink leading-tight">
              {card.value}
            </div>
            <div className="text-[11px] font-medium text-ink mt-1 leading-tight">
              {card.title}
            </div>
            <div className="text-[10px] text-faint mt-0.5">{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Revenue Chart + Booking Distribution */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue Area Chart */}
        <div className="xl:col-span-2 bg-white rounded-xl border border-line shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-[15px] font-bold text-ink">
                Revenue Overview
              </h2>
              <p className="text-[12px] text-faint mt-0.5">
                Monthly breakdown by service type
              </p>
            </div>
            <div className="flex gap-1 bg-hover rounded-lg p-1">
              {["today", "week", "month", "year"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRevenueTab(tab)}
                  className={`px-3 py-1 rounded text-[11px] font-semibold transition-all capitalize ${
                    revenueTab === tab
                      ? "text-white shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                  style={revenueTab === tab ? { background: "#c1232c" } : {}}
                >
                  {tab === "today"
                    ? "Today"
                    : tab === "week"
                      ? "Week"
                      : tab === "month"
                        ? "Month"
                        : "Year"}
                </button>
              ))}
            </div>
          </div>
          {!hasRevenue && (
            <div className="h-[240px] flex flex-col items-center justify-center text-center">
              <svg
                className="w-10 h-10 text-line mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <p className="text-[13px] font-medium text-faint">
                No revenue recorded for this period
              </p>
              <p className="text-[11px] text-subtle mt-0.5">
                Chart populates as bookings come in
              </p>
            </div>
          )}
          {hasRevenue && (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart
              data={revenueData}
              margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c1232c" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#c1232c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11, fill: "#999" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#999" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `₹${v / 1000}K`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="#c1232c"
                strokeWidth={2.5}
                fill="url(#redGrad)"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="booking"
                name="Bookings"
                stroke="#111111"
                strokeWidth={1.5}
                fill="none"
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="tour"
                name="Tours"
                stroke="#888888"
                strokeWidth={1.5}
                fill="none"
                dot={false}
                strokeDasharray="4 2"
              />
            </AreaChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* Booking Distribution Pie */}
        <div className="bg-white rounded-xl border border-line shadow-sm p-5">
          <div className="mb-5">
            <h2 className="text-[15px] font-bold text-ink">Booking Types</h2>
            <p className="text-[12px] text-faint mt-0.5">
              Distribution by service
            </p>
          </div>
          {(() => {
            const categories = [
              "Airport Taxi",
              "Outstation Cab",
              "One Way Taxi",
              "Local Rental",
              "Tour Package",
            ];
            const catData = categories.map((cat) => ({
              name: cat,
              value: liveBookings.filter((b) =>
                (b.service || b.serviceType || "").includes(cat),
              ).length,
              color: categoryColors[cat] || "#c1232c",
            }));
            const hasCatData = catData.some((c) => c.value > 0);
            if (!hasCatData) {
              return (
                <div className="h-[220px] flex flex-col items-center justify-center text-center">
                  <svg
                    className="w-10 h-10 text-line mb-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                    />
                  </svg>
                  <p className="text-[13px] font-medium text-faint">
                    No bookings yet
                  </p>
                </div>
              );
            }
            return (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={catData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {catData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: any) => [v.toLocaleString(), ""]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-2 mt-2">
                  {catData.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ background: item.color }}
                        />
                        <span className="text-[11px] text-muted">
                          {item.name}
                        </span>
                      </div>
                      <span className="text-[11px] font-semibold text-ink">
                        {item.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Pending",
            count: liveBookings.filter((b) => b.status === "Pending").length,
            color: "#F59E0B",
          },
          {
            label: "Confirmed",
            count: liveBookings.filter((b) => b.status === "Confirmed").length,
            color: "#3B82F6",
          },
          {
            label: "Ongoing",
            count: liveBookings.filter(
              (b) => b.status === "Ongoing" || b.status === "Trip Started",
            ).length,
            color: "#c1232c",
          },
          {
            label: "Completed",
            count: liveBookings.filter((b) => b.status === "Completed").length,
            color: "#10B981",
          },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-white rounded-xl border border-line shadow-sm p-4"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: s.color + "15" }}
              >
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ background: s.color }}
                />
              </div>
              <div>
                <div className="text-[20px] font-bold text-ink">
                  {s.count.toLocaleString()}
                </div>
                <div className="text-[11px] text-faint">
                  {s.label} Bookings
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Recent Bookings Table */}
      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div>
            <h2 className="text-[15px] font-bold text-ink">
              Recent Bookings
            </h2>
            <p className="text-[12px] text-faint mt-0.5">
              Latest booking activity
            </p>
          </div>
          <button
            onClick={() => onNavigate("bookings")}
            className="text-[12px] font-semibold px-4 py-2 rounded-lg border border-line text-brand hover:bg-brand-soft transition-colors"
          >
            View All
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="bg-surface-2 border-b border-line">
                {[
                  "Booking ID",
                  "Customer",
                  "Service",
                  "Pickup → Drop",
                  "Date & Time",
                  "Driver",
                  "Fare",
                  "Payment",
                  "Status",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {liveBookings.slice(0, 6).map((b, i) => (
                <tr
                  key={i}
                  className={`table-row border-b border-hover last:border-0 ${bookingSourceRowCls(b)}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[12px] font-mono font-semibold"
                      style={{ color: "#c1232c" }}
                    >
                      {b.bookingId || b.id}
                    </span>
                    <BookingSourceBadge booking={b} size="sm" />
                  </div>
                  </td>
                  <td className="px-4 py-3 text-[12px] font-medium text-ink">
                    {b.customer}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted">
                    {b.service}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[11px] text-ink">{b.pickup}</div>
                    <div className="text-[11px] text-faint">→ {b.drop}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-[11px] text-ink">{b.date}</div>
                    <div className="text-[11px] text-faint">{b.time}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted">
                    {b.driver}
                  </td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-ink">
                    {b.fare}
                  </td>
                  <td className="px-4 py-3">
                    <PaymentBadge status={paymentOf(b).status} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onSelectBooking(b.id)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-line hover:bg-brand-soft text-brand transition-colors">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
