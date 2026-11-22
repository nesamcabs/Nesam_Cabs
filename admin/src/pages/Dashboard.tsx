import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
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
} from "recharts";
import type { Booking, Driver, Vehicle, Customer, PenaltyRecord, MarketplaceTrip } from "../types";
import { StatusBadge, PaymentBadge, BookingSourceBadge, bookingSourceRowCls } from "../components/booking/BookingBadges";
import OperationsSection from "../components/dashboard/OperationsSection";
import OfficeDashboard from "../components/dashboard/OfficeDashboard";
import StaffDashboard from "../components/dashboard/StaffDashboard";
import { useAccess } from "../components/AccessContext";
import type { NavBadges } from "../hooks/useNavBadges";
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
  subscribeMarketplace,
} from "../services/adminFirestoreService";
import { approveBooking } from "../services/bookingOpsService";
import {
  formatINR,
  parseAmount,
  bookingDate,
  isPaid,
  bookingTaxable,
} from "../utils/analytics";
import { formatDateTime12, formatShortDateTime12, formatHourLabel } from "../utils/time";
import {
  buildRows,
  stageCounts,
  sourceCounts,
  deskStageOf,
  inScope,
  filterRows,
  scheduleSplit,
  periodWindow,
  revenueSummary,
  changeOf,
  changeLabel,
  pipelineValue,
  assigneeOf,
  buildDutySlip,
  serviceKeyOf,
  SERVICE_PILLS,
  SERVICE_KEYS,
  SERVICE_NAME,
  SOURCE_NAME,
  SOURCE_ORDER,
  type SourceScope,
  type DeskStage,
  type TripRow,
  type Period,
  type StageFilter,
  type ServicePill,
  type TripFilters,
  NO_TRIP_FILTERS,
} from "../domain/commandDesk";
import { getBookingSourceDisplay } from "../domain/bookingSource";
import { fareOf, rupee } from "../domain/officeStage";

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
  badges?: NavBadges;
}

/**
 * One dashboard for every admin. The Master account keeps the full overview and command center.
 * Staff get sections composed from their effective access; the full business overview needs every
 * area it reads (bookings, people, fleet and finance), the booking / dispatch board needs bookings.
 */
export default function Dashboard(props: DashboardProps) {
  const access = useAccess();
  if (access.isSuper) return <MasterDashboard {...props} />;
  const has = (p: (typeof access.permissions)[number]) => access.permissions.includes(p);
  const fullOverview = has("operations") && has("people") && has("fleet") && has("finance");
  const workspace = fullOverview ? (
    <MasterDashboard {...props} />
  ) : has("operations") ? (
    <OfficeDashboard onNavigate={props.onNavigate} onSelectBooking={props.onSelectBooking} onNewBooking={props.onNewBooking} />
  ) : null;
  return <StaffDashboard access={access} badges={props.badges} onNavigate={props.onNavigate} onNewBooking={props.onNewBooking} workspace={workspace} />;
}

type DashboardView = "command" | "trips" | "analytics" | "dispatch";

function MasterDashboard({
  onNavigate,
  onSelectBooking,
  onNewBooking,
}: DashboardProps) {
  const [activeView, setActiveView] = useState<DashboardView>("command");
  const [sourceScope, setSourceScope] = useState<SourceScope>("ALL");
  const [cmdPeriod, setCmdPeriod] = useState<Period>("Today");
  const [analyticsPeriod, setAnalyticsPeriod] = useState<Period>("Month");
  const [filters, setFilters] = useState<TripFilters>(NO_TRIP_FILTERS);
  const [globalSearch, setGlobalSearch] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const now = useNow(30000);
  const ops = useOperationsSettings();
  const { toast, show: showToast } = useToast(9000);

  const [liveBookings, setLiveBookings] = useState<Booking[]>([]);
  const [liveDrivers, setLiveDrivers] = useState<Driver[]>([]);
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>([]);
  const [liveCustomers, setLiveCustomers] = useState<Customer[]>([]);
  const [livePenalties, setLivePenalties] = useState<PenaltyRecord[]>([]);
  const [liveMarketplace, setLiveMarketplace] = useState<MarketplaceTrip[]>([]);

  useEffect(() => {
    setLoadError(null);
    setLoaded(false);
    const u1 = subscribeBookings((d) => { setLiveBookings(d); setLoaded(true); }, setLoadError);
    const u2 = subscribeDrivers(setLiveDrivers, setLoadError);
    const u3 = subscribeVehicles(setLiveVehicles, setLoadError);
    const u4 = subscribeCustomers(setLiveCustomers, setLoadError);
    const u5 = subscribePenalties(setLivePenalties, setLoadError);
    const u6 = subscribeMarketplace(setLiveMarketplace, () => {});
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, [retryKey]);

  // Index marketplace trips by bookingId
  const marketById = useMemo(() => {
    const m = new Map<string, MarketplaceTrip>();
    for (const t of liveMarketplace) if (t.bookingId) m.set(t.bookingId, t);
    return m;
  }, [liveMarketplace]);

  // Pure domain calculations from commandDesk
  const allRows = useMemo(() => buildRows(liveBookings, marketById), [liveBookings, marketById]);
  const scopedRows = useMemo(() => allRows.filter((r) => inScope(r.b, sourceScope)), [allRows, sourceScope]);
  const scopedBookings = useMemo(() => liveBookings.filter((b) => inScope(b, sourceScope)), [liveBookings, sourceScope]);
  const stageC = useMemo(() => stageCounts(scopedRows), [scopedRows]);
  const srcC = useMemo(() => sourceCounts(liveBookings), [liveBookings]);

  // Pipeline Gross Value
  const pipelineGross = useMemo(() => pipelineValue(scopedRows), [scopedRows]);

  // Schedules (Today & Tomorrow)
  const { today: todayTrips, tomorrow: tomorrowTrips } = useMemo(() => scheduleSplit(scopedRows, now), [scopedRows, now]);

  // Command Desk Revenue Window & Summary
  const cmdWin = useMemo(() => periodWindow(cmdPeriod, now), [cmdPeriod, now]);
  const cmdSummary = useMemo(() => revenueSummary(scopedBookings, cmdWin.start, cmdWin.end, cmdWin.buckets), [scopedBookings, cmdWin]);
  const cmdPrevSummary = useMemo(() => revenueSummary(scopedBookings, cmdWin.prevStart, cmdWin.prevEnd), [scopedBookings, cmdWin]);
  const cmdChange = useMemo(() => changeOf(cmdSummary.booked, cmdPrevSummary.booked), [cmdSummary.booked, cmdPrevSummary.booked]);

  // Analytics Revenue Window & Summary
  const anWin = useMemo(() => periodWindow(analyticsPeriod, now), [analyticsPeriod, now]);
  const anSummary = useMemo(() => revenueSummary(scopedBookings, anWin.start, anWin.end, anWin.buckets), [scopedBookings, anWin]);

  // All Trips Explorer Rows
  const effectiveFilters = useMemo<TripFilters>(() => {
    return {
      stage: filters.stage,
      service: filters.service,
      search: globalSearch.trim() || filters.search,
    };
  }, [filters, globalSearch]);
  const tripsFiltered = useMemo(() => filterRows(allRows, sourceScope, effectiveFilters), [allRows, sourceScope, effectiveFilters]);

  // Actions
  const handleApproveDuty = useCallback(async (bookingId: string) => {
    if (approvingId) return;
    setApprovingId(bookingId);
    try {
      await approveBooking(bookingId);
      showToast(`Duty ${bookingId} approved successfully!`);
    } catch (err: any) {
      showToast(err.message || `Failed to approve ${bookingId}`, "error");
    } finally {
      setApprovingId(null);
    }
  }, [approvingId, showToast]);

  const handleCopyDutySlip = useCallback(async (r: TripRow) => {
    const pickupText = r.b.date ? `${r.b.date} ${r.b.time || ""}` : "Scheduled";
    const payout = r.market?.offeredPayout != null ? Number(r.market.offeredPayout) || null : null;
    const text = buildDutySlip(r.b, { pickupText, payout });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast(`Duty Slip copied for ${r.b.bookingId || r.b.id}!`);
      } else {
        showToast("Clipboard not available in this browser", "error");
      }
    } catch {
      showToast("Could not copy duty slip to clipboard", "error");
    }
  }, [showToast]);

  const handleStageCardClick = (stage: DeskStage) => {
    setFilters((f) => ({ ...f, stage }));
    setActiveView("trips");
  };

  // The desk toolbar lives in the global Header (#dashboard-topbar-slot) on desktop (≥1366px).
  // The slot is rendered by the app shell, so it exists before this page mounts.
  const [topbarTarget, setTopbarTarget] = useState<HTMLElement | null>(() => document.getElementById("dashboard-topbar-slot"));
  useEffect(() => {
    setTopbarTarget(document.getElementById("dashboard-topbar-slot"));
  }, []);

  // "All Trips" and "Revenue & GST" are drill-downs opened from the Command Desk
  // (stage cards, "Full Explorer →", "GST & Revenue Report →"), so the Command Desk
  // tab stays highlighted while they are open.
  const deskTab = activeView === "dispatch" ? "dispatch" : "command";
  const pillCls = (on: boolean) =>
    `px-2 min-[1440px]:px-3 h-7 rounded-lg text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#991B1B] ${
      on ? "bg-white text-[#991B1B] font-bold shadow-2xs" : "text-slate-600 hover:text-slate-900 font-medium"
    }`;

  const deskToolbar = (
    <div className="flex items-center gap-1.5 min-[1440px]:gap-2 min-w-0 whitespace-nowrap">
      <nav aria-label="Dashboard views" className="flex shrink-0 items-center bg-slate-100 p-0.5 rounded-xl gap-0.5">
        <button
          type="button"
          onClick={() => setActiveView("command")}
          aria-current={deskTab === "command" ? "page" : undefined}
          className={pillCls(deskTab === "command")}
        >
          Command Desk
        </button>
        <button
          type="button"
          onClick={() => setActiveView("dispatch")}
          aria-current={deskTab === "dispatch" ? "page" : undefined}
          className={pillCls(deskTab === "dispatch")}
        >
          Dispatch Desk
        </button>
      </nav>

      <input
        type="search"
        value={globalSearch}
        onChange={(e) => setGlobalSearch(e.target.value)}
        placeholder="Search trips…"
        title="Search by booking ID, route or customer"
        aria-label="Search dashboard trips by booking ID, route or customer"
        className="w-32 shrink-0 min-[1440px]:w-44 min-[1920px]:w-52 h-8 px-2.5 text-xs font-medium bg-slate-50 border border-slate-200/90 rounded-lg focus:bg-white focus:border-[#991B1B] focus:outline-none transition-colors"
      />

      <select
        aria-label="Filter by Booking Source"
        title="Filter by Booking Source"
        value={sourceScope}
        onChange={(e) => setSourceScope(e.target.value as SourceScope)}
        className="w-36 min-w-28 min-[1440px]:w-44 min-[1920px]:w-52 h-8 pl-2 pr-6 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200/90 text-slate-700 text-xs font-semibold truncate cursor-pointer focus:outline-none focus:border-[#991B1B] transition-colors"
      >
        <option value="ALL">All Sources ({liveBookings.length})</option>
        <option value="nesam">Nesam Cabs ({srcC.nesam})</option>
        <option value="people_taxi">PeopleTaxi.in ({srcC.people_taxi})</option>
        <option value="onewaycarrentals">One Way Car Rentals ({srcC.onewaycarrentals})</option>
      </select>
    </div>
  );

  return (
    <div className="space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      {/* Desk toolbar: portalled into the global Header on desktop (≥1366px, see .ds-header-slot).
          Below that width — or if the Header slot is missing — it renders inline here instead. */}
      {topbarTarget && createPortal(deskToolbar, topbarTarget)}
      <div className={topbarTarget ? "min-[1366px]:hidden" : undefined}>
        <div className="bg-white rounded-2xl border border-slate-200/90 px-3 py-2 shadow-2xs overflow-x-auto">{deskToolbar}</div>
      </div>

      {/* ========================================================= */}
      {/* VIEW 1: COMMAND DESK                                      */}
      {/* ========================================================= */}
      {activeView === "command" && (
        <div className="space-y-5 fade-in">
          {/* 5-Stage Dispatch Pipeline */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <button
              type="button"
              onClick={() => handleStageCardClick("new")}
              className="p-3.5 rounded-2xl bg-white border border-slate-200/90 hover:border-amber-400 text-left shadow-2xs transition-all hover:shadow-xs group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-700">1. New Bookings</span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 group-hover:scale-110 transition-transform" />
              </div>
              <p className="text-2xl font-extrabold text-slate-900 mt-1.5">{stageC.new}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Awaiting office review</p>
            </button>

            <button
              type="button"
              onClick={() => handleStageCardClick("publish")}
              className="p-3.5 rounded-2xl bg-white border border-slate-200/90 hover:border-blue-400 text-left shadow-2xs transition-all hover:shadow-xs group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">2. To Publish</span>
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 group-hover:scale-110 transition-transform" />
              </div>
              <p className="text-2xl font-extrabold text-slate-900 mt-1.5">{stageC.publish}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Ready for partner pool</p>
            </button>

            <button
              type="button"
              onClick={() => handleStageCardClick("published")}
              className="p-3.5 rounded-2xl bg-white border border-indigo-200/90 hover:border-indigo-400 text-left shadow-2xs transition-all hover:shadow-xs group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">3. Published</span>
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 group-hover:scale-110 transition-transform" />
              </div>
              <p className="text-2xl font-extrabold text-slate-900 mt-1.5">{stageC.published}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Open vendor bidding</p>
            </button>

            <button
              type="button"
              onClick={() => handleStageCardClick("assign")}
              className="p-3.5 rounded-2xl bg-white border border-crimson-200 hover:border-[#991B1B] text-left shadow-2xs transition-all hover:shadow-xs group cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#991B1B]">4. Assign Pending</span>
                <span className="w-2.5 h-2.5 rounded-full bg-[#991B1B] animate-pulse" />
              </div>
              <p className="text-2xl font-extrabold text-[#991B1B] mt-1.5">{stageC.assign}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Needs driver &amp; cab</p>
            </button>

            <button
              type="button"
              onClick={() => handleStageCardClick("ontrip")}
              className="p-3.5 rounded-2xl bg-white border border-slate-200/90 hover:border-emerald-400 text-left shadow-2xs transition-all hover:shadow-xs group cursor-pointer col-span-2 sm:col-span-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">5. On Trip</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 group-hover:scale-110 transition-transform" />
              </div>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1.5">{stageC.ontrip}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Active duties on road</p>
            </button>
          </section>

          {/* Action-First 2-Column Workbench */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Left: New Bookings Queue */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    New Bookings (Review &amp; Approve)
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => handleStageCardClick("new")}
                  className="text-[11px] font-semibold text-[#991B1B] hover:underline"
                >
                  View All ({stageC.new})
                </button>
              </div>
              <div className="p-4 space-y-2.5 flex-1 max-h-[360px] overflow-y-auto">
                {scopedRows.filter((r) => r.stage === "new").length === 0 ? (
                  <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center p-4 text-slate-400">
                    <p className="text-xs font-bold text-slate-700">No new bookings awaiting review</p>
                    <p className="text-[11px] mt-0.5">New bookings appear here immediately for office review.</p>
                  </div>
                ) : (
                  scopedRows.filter((r) => r.stage === "new").slice(0, 5).map((r) => (
                    <div
                      key={r.b.id}
                      className="p-3 rounded-xl border border-slate-200/90 hover:bg-slate-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-[#991B1B]">{r.b.bookingId || r.b.id}</span>
                          <BookingSourceBadge booking={r.b} size="sm" />
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700">
                            {r.b.service || r.b.serviceType || "Taxi"}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 mt-1 truncate">
                          {r.b.pickup} → {r.b.drop}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {r.b.customer || r.b.customerName} • {r.b.date} ({r.b.time}) • {formatINR(fareOf(r.b))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={approvingId === r.b.id}
                          onClick={() => handleApproveDuty(r.b.id)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors disabled:opacity-50"
                        >
                          {approvingId === r.b.id ? "Approving..." : "Approve Duty"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSelectBooking(r.b.id)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors"
                        >
                          View
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Right: Assignment Priority Queue */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#991B1B] animate-pulse" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Assignment Priority (Own Cab / Vendor)
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => handleStageCardClick("assign")}
                  className="text-[11px] font-semibold text-[#991B1B] hover:underline"
                >
                  Open Queue ({stageC.assign})
                </button>
              </div>
              <div className="p-4 space-y-2.5 flex-1 max-h-[360px] overflow-y-auto">
                {scopedRows.filter((r) => r.stage === "assign").length === 0 ? (
                  <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-center p-4 text-slate-400">
                    <p className="text-xs font-bold text-slate-700">All accepted duties are allocated</p>
                    <p className="text-[11px] mt-0.5">Duties needing cab &amp; driver assignment appear here.</p>
                  </div>
                ) : (
                  scopedRows.filter((r) => r.stage === "assign").slice(0, 5).map((r) => (
                    <div
                      key={r.b.id}
                      className="p-3 rounded-xl border border-crimson-100 bg-crimson-50/20 hover:bg-crimson-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold text-[#991B1B]">{r.b.bookingId || r.b.id}</span>
                          <BookingSourceBadge booking={r.b} size="sm" />
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                            Needs Allocation
                          </span>
                        </div>
                        <p className="text-xs font-bold text-slate-900 mt-1 truncate">
                          {r.b.pickup} → {r.b.drop}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          Pickup: <strong>{r.b.date} {r.b.time}</strong> • Fare: {formatINR(fareOf(r.b))}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSelectBooking(r.b.id)}
                          className="px-3.5 py-1.5 rounded-lg text-[11px] font-bold bg-[#991B1B] hover:bg-[#7F1D1D] text-white shadow-2xs transition-colors"
                        >
                          Assign Driver / Cab
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Quick Operational Strip */}
          <section className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white border border-slate-200/90 text-xs shadow-2xs">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleStageCardClick("publish")}
                className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-800 font-semibold border border-blue-200/80 hover:bg-blue-100 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <span>To Publish</span>
                <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-bold">
                  {stageC.publish}
                </span>
              </button>
              <span className="text-slate-300">|</span>
              <span className="text-slate-600 font-medium">
                Sources: <strong className="text-[#991B1B]">Nesam Cabs ({srcC.nesam})</strong> •{" "}
                <strong className="text-emerald-700">PeopleTaxi.in ({srcC.people_taxi})</strong> •{" "}
                <strong className="text-blue-700">One Way Car Rentals ({srcC.onewaycarrentals})</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setActiveView("analytics")}
              className="text-xs font-bold text-[#991B1B] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>GST &amp; Revenue Report →</span>
            </button>
          </section>

          {/* Latest Revenue Overview & Brand Source Performance */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col justify-between space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900">Latest Revenue Overview</h3>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                      cmdChange.kind === "up" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : cmdChange.kind === "down" ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-50 text-slate-700 border-slate-200"
                    }`}>
                      {changeLabel(cmdChange)}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2.5 mt-1">
                    <p className="text-xl font-extrabold tracking-tight text-slate-900">
                      {formatINR(cmdSummary.booked)}
                    </p>
                    <p className="text-[11px] font-medium text-slate-500">
                      Pipeline Gross: {formatINR(pipelineGross)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
                  {(["Today", "Week", "Month"] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCmdPeriod(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        cmdPeriod === p
                          ? "bg-[#991B1B] text-white shadow-2xs"
                          : "text-slate-600 hover:text-slate-900 font-medium"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Area Trend Chart */}
              <div className="h-36 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={cmdWin.buckets.map((b, i) => ({ label: b.label, amount: cmdSummary.buckets[i] ?? 0 }))}
                    margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="cmdRedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#991B1B" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#991B1B" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                    <Tooltip formatter={(val: any) => [formatINR(Number(val) || 0), "Revenue"]} />
                    <Area type="monotone" dataKey="amount" stroke="#991B1B" strokeWidth={2} fill="url(#cmdRedGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Service-Wise Market Ticker Strip (NSE/BSE style) */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 pt-2 border-t border-slate-100">
                {SERVICE_KEYS.map((k) => (
                  <div key={k} className="p-2 rounded-xl bg-slate-50 border border-slate-200/70 text-center">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">{SERVICE_NAME[k]}</p>
                    <p className="text-xs font-extrabold text-slate-900 mt-0.5">
                      {formatINR(cmdSummary.byService[k])}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Revenue by Booking Source */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs flex flex-col justify-between space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Revenue by Booking Source</h3>
                  <p className="text-[11px] text-slate-500">Nesam Cabs vs PeopleTaxi.in vs One Way Car Rentals</p>
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                  3 Channels
                </span>
              </div>

              <div className="space-y-3.5">
                {SOURCE_ORDER.map((s) => {
                  const bkg = cmdSummary.bySource[s];
                  const totalBooked = Math.max(1, cmdSummary.booked);
                  const pct = Math.round((bkg.booked / totalBooked) * 100);
                  const colorCls = s === "nesam" ? "bg-[#991B1B]" : s === "people_taxi" ? "bg-emerald-600" : "bg-blue-600";
                  return (
                    <div key={s} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-800">{SOURCE_NAME[s]}</span>
                        <span className="font-extrabold text-slate-900">
                          {formatINR(bkg.booked)} <span className="text-[11px] text-slate-400 font-normal">({bkg.count} trips • {pct}%)</span>
                        </span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${colorCls} transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 text-xs flex items-center justify-between">
                <span className="text-slate-600">Total Bookings in Window:</span>
                <span className="font-bold text-slate-900">{cmdSummary.count} bookings</span>
              </div>
            </div>
          </section>

          {/* Side-by-Side Today & Tomorrow Schedule */}
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Today */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Today's Schedule</h3>
                <span className="text-[11px] font-medium text-slate-500">{todayTrips.length} active trips</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                {todayTrips.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs">No active pickups scheduled for today.</div>
                ) : (
                  todayTrips.map((r) => {
                    const as = assigneeOf(r);
                    return (
                      <div key={r.b.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-[#991B1B]">{r.b.bookingId || r.b.id}</span>
                            <span className="text-[11px] font-semibold text-slate-700">{r.b.time || "Scheduled"}</span>
                            <BookingSourceBadge booking={r.b} size="sm" />
                          </div>
                          <p className="text-xs font-semibold text-slate-900 truncate mt-0.5">{r.b.pickup} → {r.b.drop}</p>
                          <p className="text-[11px] text-slate-500 truncate">{as.primary} {as.secondary ? `(${as.secondary})` : ""}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-extrabold text-slate-900">{formatINR(fareOf(r.b))}</p>
                          <button
                            type="button"
                            onClick={() => onSelectBooking(r.b.id)}
                            className="mt-1 text-[11px] font-semibold text-[#991B1B] hover:underline"
                          >
                            Manage →
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Tomorrow */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Tomorrow's Schedule</h3>
                <span className="text-[11px] font-medium text-slate-500">{tomorrowTrips.length} upcoming trips</span>
              </div>
              <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                {tomorrowTrips.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs">No active pickups scheduled for tomorrow.</div>
                ) : (
                  tomorrowTrips.map((r) => {
                    const as = assigneeOf(r);
                    return (
                      <div key={r.b.id} className="p-3.5 flex items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-bold text-[#991B1B]">{r.b.bookingId || r.b.id}</span>
                            <span className="text-[11px] font-semibold text-slate-700">{r.b.time || "Scheduled"}</span>
                            <BookingSourceBadge booking={r.b} size="sm" />
                          </div>
                          <p className="text-xs font-semibold text-slate-900 truncate mt-0.5">{r.b.pickup} → {r.b.drop}</p>
                          <p className="text-[11px] text-slate-500 truncate">{as.primary} {as.secondary ? `(${as.secondary})` : ""}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-extrabold text-slate-900">{formatINR(fareOf(r.b))}</p>
                          <button
                            type="button"
                            onClick={() => onSelectBooking(r.b.id)}
                            className="mt-1 text-[11px] font-semibold text-[#991B1B] hover:underline"
                          >
                            Manage →
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>

          {/* Active & Recent Bookings Table */}
          <section className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Active &amp; Recent Bookings</h3>
                <p className="text-[11px] text-slate-500">Live operational duties across all three brands</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveView("trips")}
                className="text-xs font-bold text-[#991B1B] hover:underline cursor-pointer"
              >
                Full Explorer →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-5">Booking ID &amp; Source</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Service</th>
                    <th className="py-3 px-4">Route</th>
                    <th className="py-3 px-4">Pickup</th>
                    <th className="py-3 px-4">Driver / Vendor</th>
                    <th className="py-3 px-4">Fare</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {scopedRows.slice(0, 8).map((r) => {
                    const as = assigneeOf(r);
                    return (
                      <tr key={r.b.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-bold text-[#991B1B]">{r.b.bookingId || r.b.id}</span>
                            <BookingSourceBadge booking={r.b} size="sm" />
                          </div>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {r.b.customer || r.b.customerName || "Customer"}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {r.b.service || r.b.serviceType || "Taxi"}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{r.b.pickup}</p>
                          <p className="text-[11px] text-slate-500">→ {r.b.drop}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{r.b.date}</p>
                          <p className="text-[11px] text-slate-500">{r.b.time}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-800">{as.primary}</p>
                          {as.secondary && <p className="text-[11px] text-slate-500">{as.secondary}</p>}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {formatINR(fareOf(r.b))}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={r.b.status} />
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyDutySlip(r)}
                              className="px-2 py-1 rounded text-[11px] font-semibold border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors"
                              title="Copy WhatsApp Duty Slip"
                            >
                              Slip
                            </button>
                            <button
                              type="button"
                              onClick={() => onSelectBooking(r.b.id)}
                              className="px-2.5 py-1 rounded text-[11px] font-bold bg-[#991B1B] hover:bg-[#7F1D1D] text-white transition-colors"
                            >
                              Manage
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW 2: ALL TRIPS EXPLORER                                */}
      {/* ========================================================= */}
      {activeView === "trips" && (
        <div className="space-y-4 fade-in">
          {/* Filter Bar & Tabs */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 space-y-3 shadow-2xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: "all" as StageFilter, label: "All Trips", count: scopedRows.length },
                  { id: "new" as StageFilter, label: "New bookings", count: stageC.new },
                  { id: "publish" as StageFilter, label: "To publish", count: stageC.publish },
                  { id: "published" as StageFilter, label: "Published", count: stageC.published },
                  { id: "assign" as StageFilter, label: "Assign pending", count: stageC.assign },
                  { id: "ontrip" as StageFilter, label: "Ongoing", count: stageC.ontrip },
                  { id: "assigned" as StageFilter, label: "Assigned", count: stageC.assigned },
                  { id: "completed" as StageFilter, label: "Completed", count: stageC.completed },
                  { id: "cancelled" as StageFilter, label: "Cancelled", count: stageC.cancelled },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, stage: t.id }))}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                      filters.stage === t.id
                        ? "bg-[#991B1B] text-white shadow-2xs"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
                    }`}
                  >
                    <span>{t.label}</span>
                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                      filters.stage === t.id ? "bg-white/20 text-white" : "bg-white text-slate-700 font-bold"
                    }`}>
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>
              <span className="text-xs font-semibold text-slate-500">
                {tripsFiltered.length} matching records
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2.5 border-t border-slate-100">
              <div className="flex items-center gap-1.5 flex-wrap">
                {SERVICE_PILLS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFilters((f) => ({ ...f, service: p }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      filters.service === p
                        ? "bg-slate-900 text-white"
                        : "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200/80"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  placeholder="Filter by ID, city, customer..."
                  className="h-8 px-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#991B1B] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => { setFilters(NO_TRIP_FILTERS); setGlobalSearch(""); }}
                  className="h-8 px-3 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Full Trips Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-3 px-5">Booking ID &amp; Source</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Route</th>
                  <th className="py-3 px-4">Pickup</th>
                  <th className="py-3 px-4">Driver / Vendor</th>
                  <th className="py-3 px-4">Fare</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tripsFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No bookings match the selected filters.
                    </td>
                  </tr>
                ) : (
                  tripsFiltered.map((r) => {
                    const as = assigneeOf(r);
                    return (
                      <tr key={r.b.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-bold text-[#991B1B]">{r.b.bookingId || r.b.id}</span>
                            <BookingSourceBadge booking={r.b} size="sm" />
                          </div>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {r.b.customer || r.b.customerName || "Customer"}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {r.b.service || r.b.serviceType || "Taxi"}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{r.b.pickup}</p>
                          <p className="text-[11px] text-slate-500">→ {r.b.drop}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-900">{r.b.date}</p>
                          <p className="text-[11px] text-slate-500">{r.b.time}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-800">{as.primary}</p>
                          {as.secondary && <p className="text-[11px] text-slate-500">{as.secondary}</p>}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {formatINR(fareOf(r.b))}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={r.b.status} />
                        </td>
                        <td className="py-3 px-5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCopyDutySlip(r)}
                              className="px-2 py-1 rounded text-[11px] font-semibold border border-slate-200 hover:bg-slate-100 text-slate-700 transition-colors"
                              title="Copy WhatsApp Duty Slip"
                            >
                              Slip
                            </button>
                            <button
                              type="button"
                              onClick={() => onSelectBooking(r.b.id)}
                              className="px-2.5 py-1 rounded text-[11px] font-bold bg-[#991B1B] hover:bg-[#7F1D1D] text-white transition-colors"
                            >
                              Manage
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW 3: REVENUE & GST ANALYTICS                           */}
      {/* ========================================================= */}
      {activeView === "analytics" && (
        <div className="space-y-5 fade-in">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Bookings</p>
              <p className="text-2xl font-extrabold text-slate-900 mt-1">{scopedBookings.length}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active On-Road Trips</p>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">{stageC.ontrip}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pipeline Gross Value</p>
              <p className="text-2xl font-extrabold text-[#991B1B] mt-1">{formatINR(pipelineGross)}</p>
            </div>
          </div>

          {/* Revenue Chart + Booking Types Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Revenue Overview</h3>
                  <p className="text-xs font-semibold text-emerald-700">Total in Period: {formatINR(anSummary.booked)}</p>
                </div>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                  {(["Today", "Week", "Month", "Year"] as Period[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setAnalyticsPeriod(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                        analyticsPeriod === p
                          ? "bg-[#991B1B] text-white shadow-2xs"
                          : "text-slate-600 hover:text-slate-900 font-medium"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={anWin.buckets.map((b, i) => ({ label: b.label, amount: anSummary.buckets[i] ?? 0 }))}
                    margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                    <Tooltip formatter={(val: any) => [formatINR(Number(val) || 0), "Revenue"]} />
                    <Bar dataKey="amount" fill="#991B1B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Booking Types Distribution */}
            <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
              <h3 className="text-sm font-bold text-slate-900">Booking Types Split</h3>
              <div className="space-y-3">
                {[
                  "Airport Taxi",
                  "Outstation Cab",
                  "One Way Taxi",
                  "Local Rental",
                  "Tour Package",
                ].map((cat) => {
                  const count = scopedBookings.filter((b) => (b.service || b.serviceType || "").includes(cat)).length;
                  const total = Math.max(1, scopedBookings.length);
                  const pct = Math.round((count / total) * 100);
                  const color = categoryColors[cat] || "#991B1B";
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-800">{cat}</span>
                        <span className="font-bold text-slate-900">{count} trips ({pct}%)</span>
                      </div>
                      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* GST Breakdown & Tax Compliance Card */}
          <section className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">GST Compliance &amp; Tax Summary (5% Standard)</h3>
                <p className="text-[11px] text-slate-500">Government GST collection on transport passenger services (CGST 2.5% + SGST 2.5%)</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("reports-gst")}
                className="text-xs font-bold text-[#991B1B] hover:underline"
              >
                Detailed GST Ledger →
              </button>
            </div>

            {(() => {
              const totalGross = anSummary.booked;
              const taxable = Math.round(totalGross / 1.05);
              const totalGst = totalGross - taxable;
              const cgst = Math.round(totalGst / 2);
              const sgst = totalGst - cgst;
              return (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Gross Taxable Value</p>
                    <p className="text-lg font-extrabold text-slate-900 mt-1">{formatINR(taxable)}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">CGST (2.5%)</p>
                    <p className="text-lg font-extrabold text-slate-900 mt-1">{formatINR(cgst)}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">SGST (2.5%)</p>
                    <p className="text-lg font-extrabold text-slate-900 mt-1">{formatINR(sgst)}</p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/80">
                    <p className="text-[10px] font-bold text-emerald-700 uppercase">Total GST Output (5%)</p>
                    <p className="text-lg font-extrabold text-emerald-800 mt-1">{formatINR(totalGst)}</p>
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW 4: DISPATCH DESK (PRESERVED OPERATIONS & OFFICE)      */}
      {/* ========================================================= */}
      {activeView === "dispatch" && (
        <div className="space-y-6 fade-in">
          <OfficeDashboard
            onNavigate={onNavigate}
            onSelectBooking={onSelectBooking}
            onNewBooking={onNewBooking}
          />
          <OperationsSection
            bookings={liveBookings}
            penalties={livePenalties}
            now={now}
            thresholds={ops}
            loading={!loaded && !loadError}
            onNavigate={onNavigate}
            onSelectBooking={onSelectBooking}
          />
        </div>
      )}
    </div>
  );
}
