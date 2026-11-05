import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../services/firebase";
import { subscribeMarketplace, subscribeDrivers } from "../services/adminFirestoreService";
import { awardBid, rejectBid, postBooking, assignIndependentDriver } from "../services/marketplaceService";
import type { MarketplaceTrip, Driver } from "../types";
import { useCan } from "../components/AccessContext";
import { Toast, useToast } from "../components/Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../components/FormKit";
import PostingOptions, { postingPayload, usePostingOptions } from "../components/booking/PostingOptions";

interface MarketplaceProps {
  onSelectBooking?: (bookingId: string) => void;
}

interface BidRecord {
  id: string;
  vendorId?: string;
  vendorName?: string;
  vendorCounterRate?: number;
  biddingNote?: string;
  status: string;
  submittedAt?: any;
  [key: string]: any;
}

const rupees = (n: number | string) => {
  const num = typeof n === "number" ? n : Number(String(n).replace(/[^\d.]/g, "")) || 0;
  return `₹${Math.round(num).toLocaleString("en-IN")}`;
};

const addressText = (v: any): string => {
  if (!v) return "—";
  if (typeof v === "string") return v.trim() || "—";
  return v.address || v.name || v.city || "—";
};

const STATUS_STYLE: Record<string, { label: string; chip: string; dot: string }> = {
  Open: { label: "Open for claims", chip: "bg-emerald-50 text-emerald-800 border-emerald-300", dot: "bg-emerald-500" },
  Bidding: { label: "Bidding active", chip: "bg-amber-50 text-amber-800 border-amber-300", dot: "bg-amber-500" },
  Assigned: { label: "Assigned", chip: "bg-blue-50 text-blue-800 border-blue-300", dot: "bg-blue-500" },
  Closed: { label: "Closed", chip: "bg-gray-100 text-gray-700 border-gray-300", dot: "bg-gray-400" },
};

const BID_STATUS_STYLE: Record<string, string> = {
  "Pending Review": "bg-amber-50 text-amber-800 border-amber-200",
  Accepted: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Awarded: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-50 text-red-800 border-red-200",
  Withdrawn: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function Marketplace({ onSelectBooking }: MarketplaceProps) {
  const canFinance = useCan("finance");
  const canOperations = useCan("operations");
  const { toast, show: showToast } = useToast();

  const [trips, setTrips] = useState<MarketplaceTrip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "Open" | "Bidding" | "Assigned" | "Closed">("All");

  const [expanded, setExpanded] = useState<string>("");
  const [bids, setBids] = useState<BidRecord[]>([]);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState("");

  const [bookingCode, setBookingCode] = useState("");
  const [payout, setPayout] = useState("");
  const [driverId, setDriverId] = useState("");

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showPostingForm, setShowPostingForm] = useState(false);
  const posting = usePostingOptions();

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    const unsubMarketplace = subscribeMarketplace(
      (data) => {
        setTrips(data);
        setLoading(false);
      },
      (err) => {
        setLoadError(err || "Failed to load marketplace trips.");
        setLoading(false);
      }
    );
    const unsubDrivers = subscribeDrivers(
      (d) => setDrivers(d),
      () => {}
    );
    return () => {
      unsubMarketplace();
      unsubDrivers();
    };
  }, []);

  useEffect(() => {
    setBids([]);
    setDriverId("");
    setBidsError("");
    if (!expanded) {
      setBidsLoading(false);
      return;
    }
    setBidsLoading(true);
    return onSnapshot(
      collection(db, "marketplace_trips", expanded, "bids"),
      (snap) => {
        setBids(snap.docs.map((d) => ({ ...d.data(), id: d.id } as BidRecord)));
        setBidsLoading(false);
      },
      () => {
        setBidsError("Could not load bids for this trip. Check permissions and retry.");
        setBidsLoading(false);
      }
    );
  }, [expanded]);

  const act = async (work: () => Promise<void>, successMessage?: string) => {
    if (busy) return;
    setBusy(true);
    setActionError("");
    try {
      await work();
      if (successMessage) showToast(successMessage, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Action failed. Please retry.";
      setActionError(msg);
      showToast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const handlePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = bookingCode.trim();
    if (!code) return;
    const customPayout = payout.trim() ? Number(payout) : null;
    const opts = postingPayload(posting.value);
    if (!opts.ok) {
      setActionError(opts.error);
      return;
    }
    await act(async () => {
      await postBooking(code, customPayout, opts.data);
      posting.reset();
      setBookingCode("");
      setPayout("");
      setShowPostingForm(false);
    }, `Booking ${code} posted to marketplace successfully.`);
  };

  const eligibleDrivers = useMemo(
    () =>
      drivers.filter(
        (d: any) =>
          d.status === "Approved" &&
          d.presenceStatus === "Online" &&
          !d.vendorId &&
          d.fleetStatus !== "Suspended"
      ),
    [drivers]
  );

  const stats = useMemo(() => {
    const total = trips.length;
    const openCount = trips.filter((t) => t.status === "Open").length;
    const biddingCount = trips.filter((t) => t.status === "Bidding").length;
    const assignedCount = trips.filter((t) => t.status === "Assigned").length;
    const closedCount = trips.filter((t) => t.status === "Closed").length;
    return { total, openCount, biddingCount, assignedCount, closedCount };
  }, [trips]);

  const filteredTrips = useMemo(() => {
    const q = search.trim().toLowerCase();
    return trips.filter((t) => {
      if (statusFilter !== "All" && t.status !== statusFilter) return false;
      if (q) {
        const id = (t.bookingId || t.id || "").toLowerCase();
        const p = addressText(t.pickup).toLowerCase();
        const d = addressText(t.drop).toLowerCase();
        const cat = String(t.vehicleCategory || t.vehicleType || "").toLowerCase();
        if (!id.includes(q) && !p.includes(q) && !d.includes(q) && !cat.includes(q)) return false;
      }
      return true;
    });
  }, [trips, statusFilter, search]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <Toast toast={toast} />

      {/* Header and Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-ink">Open Trip Marketplace</h1>
          <p className="text-sm text-muted mt-0.5">
            Publish approved bookings to eligible independent drivers and partner vendors, review bids, and award assignments. Approving a booking does not publish it — you publish it here or from the booking.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPostingForm((prev) => !prev)}
            className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm ${
              showPostingForm
                ? "bg-gray-100 text-body border border-line-strong hover:bg-gray-200"
                : primaryBtn
            }`}
          >
            {showPostingForm ? "✕ Close Post Panel" : "+ Post Booking to Marketplace"}
          </button>
        </div>
      </div>

      {actionError && (
        <Notice tone="error">
          <div className="font-semibold">{actionError}</div>
        </Notice>
      )}
      {loadError && (
        <Notice tone="error">
          <div className="font-semibold">{loadError}</div>
        </Notice>
      )}

      {/* Collapsible / Dedicated "Post booking to marketplace" section */}
      {showPostingForm && (
        <section
          aria-label="Post booking form"
          className="bg-white rounded-2xl border border-line shadow-sm p-5 space-y-4 transition-all"
        >
          <div className="flex items-center justify-between pb-3 border-b border-line-soft">
            <div>
              <h2 className="text-base font-bold text-ink">Post Booking to Open Marketplace</h2>
              <p className="text-xs text-muted mt-0.5">
                The booking must be fare-verified and approved. Partners will receive real-time notifications based on eligibility.
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-50 text-brand border border-red-200">
              Operations Action
            </span>
          </div>

          <form onSubmit={handlePost} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field
                label="Booking Code or Document ID"
                required
                hint="e.g. NT261005-EW69X (Must be fare-verified & approved)"
              >
                <input
                  required
                  value={bookingCode}
                  onChange={(e) => setBookingCode(e.target.value)}
                  placeholder="Enter Booking ID"
                  className={inputCls}
                />
              </Field>

              {canFinance ? (
                <Field
                  label="Partner Payout (₹, Optional)"
                  hint="Leave empty to use automatic commission policy payout"
                >
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={payout}
                    onChange={(e) => setPayout(e.target.value)}
                    placeholder="Auto from commission policy"
                    className={inputCls}
                  />
                </Field>
              ) : (
                <div className="bg-gray-50 rounded-xl p-3 border border-line flex flex-col justify-center">
                  <span className="text-xs font-semibold text-muted">Partner Payout</span>
                  <span className="text-xs text-faint mt-1">
                    Derived automatically from the active Commission Policy (Finance restricted).
                  </span>
                </div>
              )}

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={busy || !bookingCode.trim()}
                  className={`w-full md:w-auto ${primaryBtn} h-[42px] flex items-center justify-center gap-2`}
                >
                  {busy ? "Broadcasting…" : "Broadcast to Marketplace →"}
                </button>
              </div>
            </div>

            <PostingOptions value={posting.value} onChange={posting.set} />

            <p className="text-xs text-faint bg-gray-50 rounded-lg p-2.5 border border-gray-100">
              ℹ️ When posted, vendors will see this trip under their Marketplace offers. If no custom payout is specified by Finance, the platform commission rule calculates the offer rate automatically.
            </p>
          </form>
        </section>
      )}

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: "All Marketplace", count: stats.total, color: "text-ink" },
          { label: "Open for Claims", count: stats.openCount, color: "text-emerald-700" },
          { label: "Bids Active", count: stats.biddingCount, color: "text-amber-700" },
          { label: "Assigned", count: stats.assignedCount, color: "text-blue-700" },
          { label: "Closed", count: stats.closedCount, color: "text-gray-500" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-xs p-3.5 flex flex-col">
            <span className="text-xs font-medium text-muted">{s.label}</span>
            <span className={`text-2xl font-extrabold mt-1 ${s.color}`}>{loading ? "…" : s.count}</span>
          </div>
        ))}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-line shadow-xs p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Booking ID, Route, Vehicle…"
              aria-label="Search marketplace trips"
              className={`${inputCls} pl-8`}
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">
              🔍
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className={`${inputCls} !w-auto text-xs py-2`}
              aria-label="Filter by status"
            >
              <option value="All">All Statuses ({trips.length})</option>
              <option value="Open">Open ({stats.openCount})</option>
              <option value="Bidding">Bidding ({stats.biddingCount})</option>
              <option value="Assigned">Assigned ({stats.assignedCount})</option>
              <option value="Closed">Closed ({stats.closedCount})</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-medium text-muted">
          Showing <strong>{filteredTrips.length}</strong> of {trips.length} trips
        </div>
      </div>

      {/* Trips List / Table Container */}
      <div className="space-y-3.5">
        {loading && (
          <div className="bg-white rounded-2xl border border-line p-12 text-center text-sm text-muted shadow-xs" role="status">
            <div className="inline-block w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin mb-2" />
            <p>Loading marketplace listings…</p>
          </div>
        )}

        {!loading && filteredTrips.length === 0 && (
          <div className="bg-white rounded-2xl border border-line p-12 text-center space-y-2 shadow-xs">
            <div className="text-3xl">🚖</div>
            <h3 className="text-base font-bold text-ink">No Marketplace Trips Found</h3>
            <p className="text-sm text-muted max-w-md mx-auto">
              {search || statusFilter !== "All"
                ? "No trips matched your search or status criteria. Try resetting the filters."
                : "No trips are currently posted on the marketplace. Verified bookings can be broadcast using the button above."}
            </p>
            {(search || statusFilter !== "All") && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatusFilter("All");
                }}
                className={`mt-2 ${secondaryBtn}`}
              >
                Reset Filters
              </button>
            )}
          </div>
        )}

        {!loading &&
          filteredTrips.map((trip) => {
            const isExpanded = expanded === trip.id;
            const tripStatus = STATUS_STYLE[trip.status] || {
              label: trip.status,
              chip: "bg-gray-100 text-gray-700 border-gray-300",
              dot: "bg-gray-400",
            };
            const pickupAddr = addressText(trip.pickup);
            const dropAddr = addressText(trip.drop);
            const payoutAmount = rupees(trip.offeredPayout);
            const code = trip.bookingId || trip.id;
            const vehicle = trip.vehicleCategory || trip.vehicleType || "Standard";

            return (
              <article
                key={trip.id}
                className={`bg-white rounded-2xl border transition-all shadow-xs ${
                  isExpanded ? "border-brand ring-1 ring-brand/20" : "border-line hover:border-[#D0D0D0]"
                }`}
              >
                {/* Trip Card Summary Header */}
                <div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  {/* Left Column: ID, Category & Route */}
                  <div className="space-y-2 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <strong className="text-base font-bold text-ink tracking-tight">{code}</strong>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200">
                        {vehicle}
                      </span>
                      {trip.distanceKm ? (
                        <span className="text-xs text-muted font-medium">· {trip.distanceKm} km</span>
                      ) : null}
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200">
                        {trip.mode === "bid_review" ? "Bids reviewed by NESAM" : trip.mode === "accept_offer" ? "Accept current offer" : "Offer or bid (older post)"}
                      </span>
                      {trip.escalation?.enabled ? (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                          Escalating +{trip.escalation.stepPercent ?? 5}% / {trip.escalation.intervalMinutes ?? 60} min · step {trip.escalation.step ?? 0}
                        </span>
                      ) : null}
                      {onSelectBooking && (
                        <button
                          type="button"
                          onClick={() => onSelectBooking(trip.id)}
                          className="text-xs text-brand hover:underline font-semibold"
                          title="View complete booking details"
                        >
                          View booking ↗
                        </button>
                      )}
                    </div>

                    {/* Route Display */}
                    <div className="flex items-start gap-2 text-sm text-body">
                      <div className="flex flex-col items-center mt-1 shrink-0">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-100" />
                        <span className="w-0.5 h-4 bg-gray-300 my-0.5" />
                        <span className="w-2.5 h-2.5 rounded-xs bg-brand ring-2 ring-red-100" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="font-medium truncate" title={pickupAddr}>
                          <span className="text-xs text-faint uppercase font-semibold mr-1.5">Pickup:</span>
                          {pickupAddr}
                        </div>
                        <div className="font-medium truncate" title={dropAddr}>
                          <span className="text-xs text-faint uppercase font-semibold mr-1.5">Drop:</span>
                          {dropAddr}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Payout, Status Badge & Expand Action */}
                  <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center gap-3 shrink-0 pt-3 md:pt-0 border-t md:border-t-0 border-line-soft">
                    <div className="text-left md:text-right">
                      <div className="text-xs text-faint font-semibold uppercase">Offered Payout</div>
                      <div className="text-xl md:text-2xl font-extrabold text-ink">{payoutAmount}</div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${tripStatus.chip}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${tripStatus.dot}`} />
                        {tripStatus.label}
                      </span>

                      <button
                        type="button"
                        onClick={() => setExpanded(isExpanded ? "" : trip.id)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                          isExpanded
                            ? "bg-red-50 text-brand border-red-200"
                            : "bg-white text-body border-line-strong hover:bg-gray-50"
                        }`}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "Hide Review ▲" : "Review Bids & Assign ▼"}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Drawer: Bids and Driver Assignment */}
                {isExpanded && (
                  <div className="border-t border-line bg-surface-2 p-4 md:p-5 rounded-b-2xl space-y-5 animate-in fade-in duration-150">
                    {/* Bids Section */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-ink uppercase tracking-wide flex items-center gap-2">
                          <span>Vendor Bids</span>
                          <span className="text-xs bg-gray-200 text-gray-800 px-2 py-0.5 rounded-full font-semibold">
                            {bids.length}
                          </span>
                        </h3>
                        {bidsLoading && <span className="text-xs text-gray-500">Refreshing bids…</span>}
                      </div>

                      {bidsError && (
                        <div className="p-2.5 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200">
                          {bidsError}
                        </div>
                      )}

                      {!bidsLoading && bids.length === 0 && (
                        <div className="bg-white rounded-xl border border-dashed border-line-strong p-4 text-center text-xs text-faint">
                          No vendor bids received yet for this listing.
                        </div>
                      )}

                      {bids.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {bids.map((b) => {
                            const bStatus = b.status || "Pending Review";
                            const statusCls = BID_STATUS_STYLE[bStatus] || "bg-gray-100 text-gray-700 border-gray-200";
                            const canReview = bStatus === "Pending Review" && ["Open", "Bidding"].includes(trip.status);

                            return (
                              <div
                                key={b.id}
                                className="bg-white rounded-xl border border-line p-3.5 shadow-2xs space-y-2.5"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-sm font-bold text-ink">{b.vendorName || (b.bidderType === "driver" ? "Owner driver" : "Partner Vendor")}{b.bidderType === "driver" ? " · owner-driver" : ""}</div>
                                    <div className="text-xs text-muted font-mono mt-0.5">ID: {b.vendorId || b.id}</div>
                                  </div>
                                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${statusCls}`}>
                                    {bStatus}
                                  </span>
                                </div>

                                <div className="flex items-baseline justify-between pt-1 border-t border-line-soft">
                                  <span className="text-xs text-muted font-medium">Counter Offer:</span>
                                  <span className="text-base font-extrabold text-brand">
                                    {rupees(b.vendorCounterRate || 0)}
                                  </span>
                                </div>

                                {b.biddingNote ? (
                                  <p className="text-xs text-muted bg-gray-50 rounded-md p-2 italic">
                                    "{b.biddingNote}"
                                  </p>
                                ) : null}

                                {canReview && (
                                  <div className="flex items-center gap-2 pt-2 border-t border-line-soft">
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void act(
                                          () => awardBid(trip.id, b.id),
                                          `Bid from ${b.vendorName || "vendor"} awarded successfully.`
                                        )
                                      }
                                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-all text-center"
                                    >
                                      ✓ Award Bid
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={() =>
                                        void act(
                                          () => rejectBid(trip.id, b.id),
                                          `Bid from ${b.vendorName || "vendor"} rejected.`
                                        )
                                      }
                                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-50 transition-all text-center"
                                    >
                                      ✕ Reject
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Direct Independent Driver Assignment Section */}
                    {["Open", "Bidding"].includes(trip.status) && (
                      <div className="pt-3 border-t border-line space-y-2.5">
                        <h4 className="text-xs font-bold text-ink uppercase tracking-wide">
                          Direct Assignment (Independent Driver)
                        </h4>
                        <div className="flex flex-wrap items-center gap-2.5">
                          <select
                            aria-label="Select independent driver"
                            value={driverId}
                            onChange={(e) => setDriverId(e.target.value)}
                            className={`${inputCls} flex-1 min-w-[240px] text-xs py-2 bg-white`}
                          >
                            <option value="">Choose available independent driver ({eligibleDrivers.length} online)</option>
                            {eligibleDrivers.map((d: any) => (
                              <option key={d.id} value={d.id}>
                                {d.name} {d.phone ? `(${d.phone})` : ""} · {d.vehicleType || "Driver"}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            disabled={busy || !driverId}
                            onClick={() =>
                              void act(
                                () => assignIndependentDriver(trip.id, driverId),
                                "Independent driver assigned successfully."
                              )
                            }
                            className={`px-4 py-2 rounded-lg text-xs font-bold text-white bg-brand hover:bg-brand-dark disabled:opacity-50 transition-all`}
                          >
                            Assign Driver Now
                          </button>
                        </div>
                        <p className="text-[11px] text-faint">
                          Assigning directly immediately locks the trip and dispatches it to the driver's mobile dashboard.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
      </div>
    </div>
  );
}
