import { useEffect, useMemo, useState } from "react";
import { collectionGroup, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "../services/firebase";
import { subscribeMarketplace } from "../services/adminFirestoreService";
import { awardBid, rejectBid } from "../services/marketplaceService";
import { useCan } from "../components/AccessContext";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";
import { inputCls } from "../components/FormKit";
import { formatDateTime12 } from "../utils/time";
import type { MarketplaceTrip } from "../types";

// Every counter-offer vendors (and owner-drivers) have sent on open duties, in one list: who bid, how it compares with the
// offered payout, and Award / Reject for the ones still under review. Bids live under marketplace_trips/{trip}/bids and are
// read as a collection group (admins only); Award / Reject go through the same server functions as the Marketplace page.

interface Bid {
  key: string;
  id: string;
  tripId: string;
  bookingCode: string;
  vendorId: string;
  vendorName: string;
  ownerDriver: boolean;
  offered: number;
  counter: number;
  note: string;
  consent: boolean;
  status: string;
  submittedAt: Date | null;
}

type Tab = "pending" | "awarded" | "closed" | "all";

const dateOf = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === "function" ? (v as Timestamp).toDate() : null);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(/[^\d.]/g, "")) || 0);
const rupee = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const place = (v: unknown): string => {
  if (!v) return "—";
  if (typeof v === "string") return v.trim() || "—";
  const o = v as { address?: string; name?: string; city?: string };
  return o.city || o.name || o.address || "—";
};

const PENDING = "Pending Review";
const isAwarded = (st: string) => st === "Accepted" || st === "Awarded";
const isClosed = (st: string) => ["Rejected", "Withdrawn", "Outbid"].includes(st);

const STATUS_CHIP: Record<string, string> = {
  [PENDING]: "bg-amber-50 text-amber-800 border-amber-200",
  Accepted: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Awarded: "bg-emerald-50 text-emerald-800 border-emerald-200",
  Rejected: "bg-red-50 text-red-800 border-red-200",
  Withdrawn: "bg-gray-100 text-gray-600 border-gray-200",
  Outbid: "bg-gray-100 text-gray-600 border-gray-200",
};

const GRID = "md:grid md:grid-cols-[minmax(130px,1fr)_minmax(180px,1.6fr)_minmax(150px,1.3fr)_minmax(150px,1.1fr)_minmax(120px,0.9fr)_190px] md:items-center md:gap-4";

export default function VendorBids({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const canAct = useCan("operations");
  const { toast, show } = useToast(5000);
  const [raw, setRaw] = useState<Omit<Bid, "bookingCode">[]>([]);
  const [trips, setTrips] = useState<MarketplaceTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<{ bid: Bid; action: "award" | "reject" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    const unsubBids = onSnapshot(collectionGroup(db, "bids"), (snap) => {
      setRaw(snap.docs.map((d) => {
        const x = d.data();
        const tripId = d.ref.parent.parent?.id || s(x.tripId);
        return {
          key: `${tripId}/${d.id}`, id: d.id, tripId, vendorId: s(x.vendorId) || s(x.driverId), vendorName: s(x.vendorName),
          ownerDriver: x.bidderType === "driver", offered: n(x.offeredPayout), counter: n(x.vendorCounterRate), note: s(x.biddingNote),
          consent: x.autoAcceptConsent === true, status: s(x.status) || PENDING, submittedAt: dateOf(x.submittedAt),
        };
      }));
      setLoading(false);
    }, () => { setLoadError("Vendor bids could not be loaded. Check your access and connection."); setLoading(false); });
    const unsubTrips = subscribeMarketplace(setTrips, () => undefined);
    return () => { unsubBids(); unsubTrips(); };
  }, [retryKey]);

  const tripById = useMemo(() => new Map(trips.map((t) => [t.id, t])), [trips]);

  const bids = useMemo<Bid[]>(() => raw
    .map((b) => ({ ...b, bookingCode: tripById.get(b.tripId)?.bookingId || b.tripId }))
    .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0)), [raw, tripById]);

  const counts = useMemo(() => ({
    pending: bids.filter((b) => b.status === PENDING).length,
    awarded: bids.filter((b) => isAwarded(b.status)).length,
    closed: bids.filter((b) => isClosed(b.status)).length,
    all: bids.length,
  }), [bids]);

  const shown = bids.filter((b) => {
    if (tab === "pending" && b.status !== PENDING) return false;
    if (tab === "awarded" && !isAwarded(b.status)) return false;
    if (tab === "closed" && !isClosed(b.status)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const t = tripById.get(b.tripId);
    return `${b.bookingCode} ${b.vendorName} ${b.vendorId} ${place(t?.pickup)} ${place(t?.drop)}`.toLowerCase().includes(q);
  });

  const run = async () => {
    if (!confirm || busy) return;
    setBusy(true); setActionError("");
    try {
      await (confirm.action === "award" ? awardBid(confirm.bid.tripId, confirm.bid.id) : rejectBid(confirm.bid.tripId, confirm.bid.id));
      show(confirm.action === "award" ? `Bid from ${confirm.bid.vendorName || "the vendor"} awarded.` : `Bid from ${confirm.bid.vendorName || "the vendor"} rejected.`);
      setConfirm(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "The action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const tabs: [Tab, string][] = [["pending", "Needs review"], ["awarded", "Awarded"], ["closed", "Rejected / withdrawn"], ["all", "All bids"]];

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-ink">Vendor bids</h1>
          <p className="text-[13px] text-muted">Counter-offers on open duties. Award the one you accept; the duty then goes to that vendor.</p>
        </div>
        <input className={`${inputCls} !w-full sm:!w-72`} type="search" placeholder="Search booking, vendor or place" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bids" />
      </div>

      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-semibold border ${tab === id ? "bg-ink text-white border-ink" : "bg-white text-body border-line-strong hover:bg-gray-50"}`}>
            {label}
            <span className={`ml-2 text-[11px] rounded-full px-1.5 py-0.5 ${tab === id ? "bg-white/20" : "bg-gray-100 text-muted"} ${id === "pending" && counts.pending && tab !== id ? "!bg-amber-100 !text-amber-800" : ""}`}>{loading ? "…" : counts[id]}</span>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className={`hidden ${GRID} px-4 py-2 bg-surface-2 border-b border-line text-[11px] uppercase tracking-wide text-muted font-semibold`}>
          <span>Booking</span><span>Route</span><span>Vendor</span><span>Offer → Bid</span><span>Status</span><span className="text-right">Action</span>
        </div>

        {loading && <div className="py-12 text-center text-sm text-muted" role="status">Loading bids…</div>}
        {!loading && shown.length === 0 && (
          <div className="py-12 text-center text-sm text-muted">{tab === "pending" ? "No bids are waiting for review." : "No bids match."}</div>
        )}

        <ul className="divide-y divide-line">
          {shown.map((b) => {
            const trip = tripById.get(b.tripId);
            const open = !!trip && ["Open", "Bidding"].includes(trip.status);
            const canReview = canAct && b.status === PENDING && open;
            const offered = b.offered || n(trip?.offeredPayout);
            const diff = offered > 0 ? Math.round(((b.counter - offered) / offered) * 100) : null;
            return (
              <li key={b.key} className={`px-4 py-3 space-y-1.5 md:space-y-0 hover:bg-surface-2 ${GRID}`}>
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ink">{b.bookingCode}</div>
                  {onOpenBooking && <button type="button" onClick={() => onOpenBooking(b.tripId)} className="text-[11px] font-semibold text-brand hover:underline">View booking ↗</button>}
                </div>
                <div className="min-w-0 text-[13px] text-body">
                  <div className="truncate" title={`${place(trip?.pickup)} → ${place(trip?.drop)}`}>{trip ? <>{place(trip.pickup)} <span className="text-faint">→</span> {place(trip.drop)}</> : "Trip no longer listed"}</div>
                  {trip ? <div className="text-[11px] text-muted truncate">{[trip.vehicleCategory || trip.vehicleType, trip.distanceKm ? `${trip.distanceKm} km` : ""].filter(Boolean).join(" · ")}</div> : null}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-ink truncate">{b.vendorName || (b.ownerDriver ? "Owner-driver" : "Partner vendor")}</div>
                  <div className="text-[11px] text-muted truncate">{b.ownerDriver ? "Owner-driver · " : ""}{b.vendorId}</div>
                </div>
                <div>
                  <div className="text-[13px] text-muted">{offered ? rupee(offered) : "—"} <span className="text-faint">→</span> <strong className="text-brand text-sm">{rupee(b.counter)}</strong></div>
                  <div className="text-[11px] text-muted">
                    {diff !== null ? `${diff > 0 ? "+" : ""}${diff}% vs offer` : ""}{b.consent ? `${diff !== null ? " · " : ""}auto-accepts at this rate` : ""}
                  </div>
                </div>
                <div>
                  <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] font-bold ${STATUS_CHIP[b.status] || "bg-gray-100 text-gray-700 border-gray-200"}`}>{b.status}</span>
                  <div className="text-[11px] text-muted mt-0.5">{formatDateTime12(b.submittedAt) || ""}</div>
                </div>
                <div className="flex items-center gap-2 md:justify-end pt-1 md:pt-0">
                  {canReview ? (
                    <>
                      <button type="button" className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => { setActionError(""); setConfirm({ bid: b, action: "award" }); }}>Award</button>
                      <button type="button" className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-200 text-red-700 bg-red-50 hover:bg-red-100" onClick={() => { setActionError(""); setConfirm({ bid: b, action: "reject" }); }}>Reject</button>
                    </>
                  ) : b.status === PENDING && !open ? <span className="text-[11px] text-muted">Duty no longer open</span> : null}
                </div>
                {b.note ? <p className="md:col-span-6 text-xs text-muted bg-gray-50 rounded-md px-2.5 py-1.5 italic md:mt-1">“{b.note}”</p> : null}
              </li>
            );
          })}
        </ul>
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.action === "award" ? "Award this bid?" : "Reject this bid?"}
          message={confirm.action === "award"
            ? <>Award <strong>{confirm.bid.bookingCode}</strong> to <strong>{confirm.bid.vendorName || "this vendor"}</strong> at <strong>{rupee(confirm.bid.counter)}</strong>? The duty goes to them and other bids on it close.</>
            : <>Reject the {rupee(confirm.bid.counter)} bid from <strong>{confirm.bid.vendorName || "this vendor"}</strong> on {confirm.bid.bookingCode}?</>}
          confirmLabel={confirm.action === "award" ? "Award bid" : "Reject bid"}
          danger={confirm.action === "reject"}
          busy={busy}
          error={actionError}
          onConfirm={run}
          onCancel={() => { if (!busy) setConfirm(null); }}
        />
      )}
    </div>
  );
}
