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

/** One row of the trips list: booking, route, vehicle, payout, status, action (stacked on phones). */
const ROW = "md:grid md:grid-cols-[minmax(130px,1fr)_minmax(200px,2fr)_minmax(110px,0.9fr)_100px_130px_130px] md:items-center md:gap-4";

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
    <div className="w-full min-w-0 space-y-4">
      <Toast toast={toast} />

      {/* Header and Title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg md:text-xl font-bold text-ink">Open Trip Marketplace</h1>
          <p className="text-[13px] text-muted">Publish approved bookings to partners and review bids. Approving a booking does not publish it.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowPostingForm((prev) => !prev)}
          className={`px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-all shadow-sm shrink-0 ${
            showPostingForm ? "bg-gray-100 text-body border border-line-strong hover:bg-gray-200" : primaryBtn
          }`}
        >
          {showPostingForm ? "✕ Close" : "+ Post booking"}
        </button>
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
                  hint="Leave empty to use the tariff's partner payout"
                >
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={payout}
                    onChange={(e) => setPayout(e.target.value)}
                    placeholder="Auto from tariff"
                    className={inputCls}
                  />
                </Field>
              ) : (
                <div className="bg-gray-50 rounded-xl p-3 border border-line flex flex-col justify-center">
                  <span className="text-xs font-semibold text-muted">Partner Payout</span>
                  <span className="text-xs text-faint mt-1">
                    Taken automatically from the tariff's partner rate (Finance restricted).
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
              ℹ️ When posted, vendors will see this trip under their Marketplace offers. If no custom payout is specified by Finance, the offer is the tariff's partner payout.
            </p>
          </form>
        </section>
      )}

      {/* Status tabs (with counts) and search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-2">
          {([
            ["All", "All", stats.total],
            ["Open", "Open for claims", stats.openCount],
            ["Bidding", "Bids active", stats.biddingCount],
            ["Assigned", "Assigned", stats.assignedCount],
            ["Closed", "Closed", stats.closedCount],
          ] as const).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={statusFilter === id}
              onClick={() => setStatusFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold border ${statusFilter === id ? "bg-ink text-white border-ink" : "bg-white text-body border-line-strong hover:bg-gray-50"}`}
            >
              {label}
              <span className={`ml-2 text-[11px] rounded-full px-1.5 py-0.5 ${statusFilter === id ? "bg-white/20" : "bg-gray-100 text-muted"}`}>{loading ? "…" : count}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search booking ID, route or vehicle"
          aria-label="Search marketplace trips"
          className={`${inputCls} !w-full sm:!w-72`}
        />
      </div>

      {/* Trips as a compact list */}
      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className={`hidden ${ROW} px-4 py-2 bg-surface-2 border-b border-line text-[11px] uppercase tracking-wide text-muted font-semibold`}>
          <span>Booking</span><span>Route</span><span>Vehicle</span><span className="text-right">Payout</span><span>Status</span><span className="text-right">Action</span>
        </div>

        {loading && (
          <div className="py-12 text-center text-sm text-muted" role="status">
            <div className="inline-block w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin mb-2" />
            <p>Loading marketplace listings…</p>
          </div>
        )}

        {!loading && filteredTrips.length === 0 && (
          <div className="py-12 text-center space-y-1.5">
            <h3 className="text-sm font-bold text-ink">No marketplace trips found</h3>
            <p className="text-[13px] text-muted max-w-md mx-auto">
              {search || statusFilter !== "All"
                ? "Nothing matches your search or status. Try resetting the filters."
                : "No trips are posted yet. Verified bookings can be posted with the button above."}
            </p>
            {(search || statusFilter !== "All") && (
              <button type="button" onClick={() => { setSearch(""); setStatusFilter("All"); }} className={`mt-1 ${secondaryBtn}`}>
                Reset filters
              </button>
            )}
          </div>
        )}

        <div className="divide-y divide-line">
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
            const modeText = trip.mode === "bid_review" ? "Bids reviewed by NESAM" : trip.mode === "accept_offer" ? "Accept current offer" : "Offer or bid";
            const escalation = trip.escalation?.enabled ? ` · +${trip.escalation.stepPercent ?? 5}% / ${trip.escalation.intervalMinutes ?? 60} min (step ${trip.escalation.step ?? 0})` : "";

            return (
              <article key={trip.id} className={isExpanded ? "bg-red-50/30" : ""}>
                <div className={`px-4 py-2.5 space-y-1 md:space-y-0 hover:bg-surface-2 ${ROW}`}>
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink">{code}</div>
                    {onSelectBooking && (
                      <button type="button" onClick={() => onSelectBooking(trip.id)} className="text-[11px] font-semibold text-brand hover:underline" title="View complete booking details">
                        View booking ↗
                      </button>
                    )}
                  </div>

                  <div className="min-w-0 text-[13px] text-body">
                    <div className="truncate" title={`${pickupAddr} → ${dropAddr}`}>
                      {pickupAddr} <span className="text-faint">→</span> {dropAddr}
                    </div>
                    <div className="text-[11px] text-muted truncate">{modeText}{escalation}</div>
                  </div>

                  <div className="min-w-0 text-[13px] text-body">
                    <div className="truncate">{vehicle}</div>
                    {trip.distanceKm ? <div className="text-[11px] text-muted">{trip.distanceKm} km</div> : null}
                  </div>

                  <div className="md:text-right">
                    <span className="text-[11px] text-faint uppercase font-semibold md:hidden mr-1.5">Payout</span>
                    <span className="text-[15px] font-extrabold text-ink">{payoutAmount}</span>
                  </div>

                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${tripStatus.chip}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${tripStatus.dot}`} />
                      {tripStatus.label}
                    </span>
                  </div>

                  <div className="md:text-right pt-1 md:pt-0">
                    <button
                      type="button"
                      onClick={() => setExpanded(isExpanded ? "" : trip.id)}
                      className={`px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-all ${
                        isExpanded ? "bg-red-50 text-brand border-red-200" : "bg-white text-body border-line-strong hover:bg-gray-50"
                      }`}
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? "Hide ▲" : "Bids & assign ▼"}
                    </button>
                  </div>
                </div>

                {/* Expanded Drawer: Bids and Driver Assignment */}
                {isExpanded && (
                  <div className="border-t border-line bg-surface-2 p-4 space-y-4 animate-in fade-in duration-150">
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
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
    </div>
  );
}
