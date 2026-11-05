import { useEffect, useMemo, useState } from "react";
import type { Booking, Vendor } from "../types";
import { subscribeBookings, subscribePayoutRequests, subscribeVendors } from "../services/adminFirestoreService";
import {
  inRange,
  monthlyFromLedger,
  payoutRequestedAt,
  subscribeLedger,
  subscribeWallets,
  summarizePartner,
  tripDate,
  tripEarningStatus,
  tripPayout,
  walletKey,
  type DateRange,
  type LedgerEntry,
  type PayoutRequest,
  type Wallet,
} from "../services/earningsService";
import { normalizeVendorStatus, VENDOR_STATUS_META } from "../utils/vendorStatus";
import { formatINR, parseAmount } from "../utils/analytics";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import PayoutActionModal from "../components/PayoutActionModal";

type Preset = "this-month" | "last-month" | "last-30" | "all" | "custom";
type VendorDoc = Vendor & {
  business?: { businessName?: string; vendorName?: string; gstNumber?: string; address?: { city?: string } };
  contactPerson?: string;
};

const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const dateLabel = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const vendorName = (v: VendorDoc) => v.companyName || v.business?.businessName || v.name || v.id;

function rangeFor(preset: Preset, from: string, to: string): DateRange {
  const now = new Date();
  if (preset === "this-month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
  if (preset === "last-month") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999) };
  if (preset === "last-30") return { from: new Date(now.getTime() - 30 * 86400000), to: null };
  if (preset === "custom") return { from: from ? new Date(`${from}T00:00:00`) : null, to: to ? new Date(`${to}T23:59:59.999`) : null };
  return { from: null, to: null };
}

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const content = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const payoutStyle: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-700 border-amber-200",
  Deferred: "bg-blue-50 text-blue-700 border-blue-200",
  Paid: "bg-green-50 text-green-700 border-green-200",
  Rejected: "bg-red-50 text-red-700 border-red-200",
  Cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

export default function VendorFinance() {
  const [activeTab, setActiveTab] = useState<"ledger" | "payouts" | "monthly">("ledger");
  const [vendors, setVendors] = useState<VendorDoc[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [wallets, setWallets] = useState<Map<string, Wallet>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const [preset, setPreset] = useState<Preset>("this-month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | "APPROVED" | "SUSPENDED">("All");
  const [payoutFilter, setPayoutFilter] = useState<"Open" | "Paid" | "Rejected" | "All">("Open");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [action, setAction] = useState<{ kind: "pay" | "reject" | "defer"; payout: PayoutRequest } | null>(null);
  const { toast, show } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => {
      setLoadError(m);
      setLoading(false);
    };
    const unsubs = [
      subscribeVendors((v) => {
        setVendors(v as VendorDoc[]);
        setLoading(false);
      }, fail),
      subscribeBookings(setBookings, fail),
      subscribePayoutRequests(setPayouts, fail),
      subscribeLedger(setLedger, fail),
      subscribeWallets(setWallets, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const rangeError = preset === "custom" && customFrom && customTo && customFrom > customTo ? "The start date is after the end date." : "";
  const vendorPayouts = useMemo(() => payouts.filter((p) => p.vendorId), [payouts]);

  const rows = useMemo(
    () =>
      vendors
        .filter((v) => {
          const st = normalizeVendorStatus(v);
          return st === "APPROVED" || st === "SUSPENDED" || bookings.some((b) => b.assignedVendorId === v.id);
        })
        .map((v) => ({ vendor: v, status: normalizeVendorStatus(v), s: summarizePartner("vendor", v.id, bookings, ledger, wallets.get(walletKey("vendor", v.id)), range) }))
        .sort((a, b) => b.s.earnings - a.s.earnings || vendorName(a.vendor).localeCompare(vendorName(b.vendor))),
    [vendors, bookings, ledger, wallets, range],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (statusFilter === "All" || r.status === statusFilter) &&
        (!q || [vendorName(r.vendor), r.vendor.phone, r.vendor.gstin, r.vendor.business?.vendorName, r.vendor.contactPerson].some((v) => (v || "").toLowerCase().includes(q))),
    );
  }, [rows, search, statusFilter]);

  const kpis = useMemo(() => {
    const gross = rows.reduce((s, r) => s + r.s.grossFares, 0);
    const earnings = rows.reduce((s, r) => s + r.s.earnings, 0);
    const open = vendorPayouts.filter((p) => !p.status || p.status === "Pending" || p.status === "Deferred");
    return {
      gross,
      earnings,
      platform: rows.reduce((s, r) => s + r.s.platformShare, 0),
      openCount: open.length,
      openAmount: open.reduce((s, p) => s + parseAmount(p.amount), 0),
      paidOut: vendorPayouts.filter((p) => p.status === "Paid").reduce((s, p) => s + parseAmount(p.amount), 0),
    };
  }, [rows, vendorPayouts]);

  const shownPayouts = useMemo(
    () =>
      vendorPayouts
        .filter((p) => {
          const st = p.status || "Pending";
          if (payoutFilter === "Open") return st === "Pending" || st === "Deferred";
          return payoutFilter === "All" || st === payoutFilter;
        })
        .sort((a, b) => (payoutRequestedAt(b)?.getTime() ?? 0) - (payoutRequestedAt(a)?.getTime() ?? 0)),
    [vendorPayouts, payoutFilter],
  );

  const monthly = useMemo(() => monthlyFromLedger("vendor", ledger, vendorPayouts), [ledger, vendorPayouts]);

  const detail = detailId ? rows.find((r) => r.vendor.id === detailId) ?? null : null;
  // Share of the pre-GST fare (partner payout + platform revenue) kept by the platform.
  const commissionPct = (s: { platformShare: number; earnings: number }) =>
    s.platformShare + s.earnings > 0 ? `${((s.platformShare / (s.platformShare + s.earnings)) * 100).toFixed(1)}%` : "—";

  const exportLedger = () =>
    downloadCsv(
      `nesam_vendor_finance_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Vendor", "GSTIN", "Status", "Completed Trips", "Gross Fares", "Vendor Earnings", "Approved Tolls", "Platform Share", "Effective Commission", "Cash Trips", "Cash Collected", "Available", "Reserved For Payouts", "Paid Out"],
      filteredRows.map((r) => [
        vendorName(r.vendor),
        r.vendor.gstin || r.vendor.business?.gstNumber || "",
        VENDOR_STATUS_META[r.status].label,
        r.s.completedTrips,
        r.s.grossFares,
        r.s.earnings,
        r.s.tolls,
        r.s.platformShare,
        commissionPct(r.s),
        r.s.cashTrips,
        r.s.cashCollected,
        r.s.available,
        r.s.reserved,
        r.s.paidOut,
      ]),
    );

  return (
    <div className="p-6 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div>
        <h1 className="text-[20px] font-bold text-ink">Vendor Finance</h1>
        <p className="text-[13px] text-muted">Fleet vendors earn the payout agreed for each trip (fixed when the trip is finalized) plus approved tolls. All figures come from the partner ledger kept by the server.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Gross Fares on Vendor Trips (period)", value: formatINR(kpis.gross), color: "#c1232c" },
          { label: "Vendor Earnings (period)", value: formatINR(kpis.earnings), color: "#111" },
          { label: `Open Payout Requests (${kpis.openCount})`, value: formatINR(kpis.openAmount), color: "#F59E0B" },
          { label: "Paid Out to Vendors (all time)", value: formatINR(kpis.paidOut), color: "#10B981" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[20px] font-bold" style={{ color: s.color }}>{loading ? "—" : s.value}</div>
            <div className="text-[11px] text-faint mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-white rounded-xl border border-line p-1 w-fit shadow-sm">
          {[
            { key: "ledger" as const, label: "Vendor Ledger" },
            { key: "payouts" as const, label: `Payout Requests (${kpis.openCount})` },
            { key: "monthly" as const, label: "Monthly Summary" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-5 py-2 rounded-lg text-[13px] font-semibold transition-all cursor-pointer ${activeTab === t.key ? "text-white shadow-sm" : "text-muted hover:text-ink"}`}
              style={activeTab === t.key ? { background: "#c1232c" } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>
        {activeTab === "ledger" && (
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Period" value={preset} onChange={(e) => setPreset(e.target.value as Preset)} className="px-3 py-2 text-[12px] border border-line rounded-lg bg-white">
              <option value="this-month">This month</option>
              <option value="last-month">Last month</option>
              <option value="last-30">Last 30 days</option>
              <option value="all">All time</option>
              <option value="custom">Custom range</option>
            </select>
            {preset === "custom" && (
              <>
                <input type="date" aria-label="From" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-2 py-1.5 text-[12px] border border-line rounded-lg" />
                <input type="date" aria-label="To" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-2 py-1.5 text-[12px] border border-line rounded-lg" />
              </>
            )}
            {rangeError && <span className="text-[11px] text-red-600">{rangeError}</span>}
          </div>
        )}
      </div>

      {activeTab === "ledger" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line bg-surface-2">
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendor, contact, GSTIN…" className="px-3 py-1.5 text-[12px] border border-line rounded-lg min-w-[220px]" />
              <select aria-label="Vendor status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white">
                <option value="All">All vendors</option>
                <option value="APPROVED">Approved</option>
                <option value="SUSPENDED">Suspended</option>
              </select>
            </div>
            <button onClick={exportLedger} disabled={filteredRows.length === 0} className="text-[12px] font-semibold px-4 py-2 rounded-lg border border-line bg-white text-brand hover:bg-brand-soft disabled:opacity-40">
              📥 Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {["Vendor", "Status", "Trips", "Gross Fares", "Vendor Earnings", "Tolls", "Platform Share", "Commission", "Available", "Reserved", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ vendor: v, status, s }) => (
                  <tr key={v.id} className="border-b border-hover last:border-0 hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <div className="text-[12px] font-semibold text-ink">{vendorName(v)}</div>
                      <div className="text-[10px] text-faint">{v.gstin || v.business?.gstNumber || "GSTIN not provided"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${VENDOR_STATUS_META[status].badge}`}>{VENDOR_STATUS_META[status].label}</span>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-bold">{s.completedTrips}</td>
                    <td className="px-4 py-3 text-[12px]">{rupees(s.grossFares)}</td>
                    <td className="px-4 py-3 text-[12px] font-bold text-green-700">
                      {rupees(s.earnings)}
                      {s.awaitingFinance > 0 && <div className="text-[10px] font-normal text-amber-700">{s.awaitingFinance} trip(s) awaiting fare verification</div>}
                    </td>
                    <td className="px-4 py-3 text-[12px]">{rupees(s.tolls)}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: "#c1232c" }}>{rupees(s.platformShare)}</td>
                    <td className="px-4 py-3 text-[12px] text-muted">{commissionPct(s)}</td>
                    <td className={`px-4 py-3 text-[12px] font-bold ${s.available < 0 ? "text-red-700" : ""}`}>
                      {rupees(s.available)}
                      {s.pending > 0 && <div className="text-[10px] font-normal text-faint">+{rupees(s.pending)} awaiting payment</div>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-amber-700">{s.reserved ? rupees(s.reserved) : "—"}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailId(v.id)} className="text-[11px] px-2.5 py-1 rounded-md border border-line hover:bg-brand-soft text-brand font-medium">Details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filteredRows.length === 0 && (
              <div className="py-12 text-center text-[13px] text-faint">{rows.length === 0 ? "No approved vendors yet." : "No vendors match your filters."}</div>
            )}
            {loading && <div className="py-12 text-center text-[13px] text-faint">Loading vendor finance…</div>}
          </div>
          <div className="px-5 py-3 text-[11px] text-faint border-t border-line-soft">
            Commission is the platform's share of the pre-GST fare on credited trips in the period. Cash fares collected by the vendor's drivers are debited from the balance, which can therefore go negative.
          </div>
        </div>
      )}

      {activeTab === "payouts" && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(["Open", "Paid", "Rejected", "All"] as const).map((f) => (
              <button key={f} onClick={() => setPayoutFilter(f)} className={`px-3 py-1 rounded-lg text-[11px] font-semibold ${payoutFilter === f ? "bg-ink text-white" : "bg-white border border-line text-muted"}`}>
                {f === "Open" ? "Pending & deferred" : f}
              </button>
            ))}
          </div>
          {shownPayouts.map((p) => {
            const v = vendors.find((x) => x.id === p.vendorId);
            const bal = p.vendorId ? wallets.get(walletKey("vendor", p.vendorId)) ?? null : null;
            const status = p.status || "Pending";
            const open = status === "Pending" || status === "Deferred";
            return (
              <div key={p.id} className="bg-white rounded-xl border border-line shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-ink">{p.vendorName || (v ? vendorName(v) : p.vendorId)}</div>
                  <div className="text-[11px] text-faint">Requested {dateLabel(payoutRequestedAt(p))} • {p.method || "—"}: <span className="font-mono">{p.details || "—"}</span></div>
                  {bal && open && (
                    <div className="text-[11px] text-muted mt-0.5">Balance after reserving requests {rupees(bal.available)} • reserved incl. this request {rupees(bal.reserved)} • paid out {rupees(bal.paidOut)}</div>
                  )}
                  {p.utr && <div className="text-[11px] text-green-700 mt-0.5">UTR {p.utr}</div>}
                  {p.adminNote && <div className="text-[11px] text-muted mt-0.5">Note: {p.adminNote}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[16px] font-bold text-ink">{rupees(parseAmount(p.amount))}</div>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${payoutStyle[status] || payoutStyle.Cancelled}`}>{status}</span>
                  </div>
                  {open && (
                    <div className="flex gap-2">
                      <button onClick={() => setAction({ kind: "pay", payout: p })} className="text-[12px] font-semibold px-3 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700">Mark Paid</button>
                      {status === "Pending" && <button onClick={() => setAction({ kind: "defer", payout: p })} className="text-[12px] font-semibold px-3 py-2 rounded-lg border border-line text-muted hover:bg-hover">Defer</button>}
                      <button onClick={() => setAction({ kind: "reject", payout: p })} className="text-[12px] font-semibold px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50">Reject</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!loading && shownPayouts.length === 0 && <div className="bg-white rounded-xl border border-line py-14 text-center text-[13px] text-faint">No vendor payout requests in this view.</div>}
        </div>
      )}

      {activeTab === "monthly" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[13px] font-bold text-ink">Vendor Trips by Month</div>
              <p className="text-[11px] text-faint">Platform GST on customer fares is reported in Reports & Analytics → GST Summary.</p>
            </div>
            <button
              onClick={() =>
                downloadCsv("nesam_vendor_monthly.csv", ["Month", "Completed Trips", "Gross Fares", "Vendor Earnings incl. Tolls", "Paid Out"], monthly.map((m) => [m.label, m.trips, m.gross, m.earnings, m.paid]))
              }
              disabled={monthly.length === 0}
              className="text-[12px] font-semibold px-4 py-2 rounded-lg border border-line bg-white text-brand hover:bg-brand-soft disabled:opacity-40"
            >
              📥 Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {["Month", "Completed Trips", "Gross Fares", "Vendor Earnings (incl. tolls)", "Paid Out"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.label} className="border-b border-hover last:border-0">
                    <td className="px-4 py-3 text-[12px] font-semibold">{m.label}</td>
                    <td className="px-4 py-3 text-[12px]">{m.trips}</td>
                    <td className="px-4 py-3 text-[12px]">{rupees(m.gross)}</td>
                    <td className="px-4 py-3 text-[12px] font-bold">{rupees(m.earnings)}</td>
                    <td className="px-4 py-3 text-[12px]">{rupees(m.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {monthly.length === 0 && <div className="py-12 text-center text-[13px] text-faint">No completed vendor trips or payouts yet.</div>}
          </div>
        </div>
      )}

      {detail && (
        <Modal title={vendorName(detail.vendor)} subtitle={`Vendor ID ${detail.vendor.id}`} onClose={() => setDetailId(null)} size="xl">
          <div className="space-y-4 text-[12px]">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                ["Contact", detail.vendor.business?.vendorName || detail.vendor.contactPerson || detail.vendor.owner || "—"],
                ["Phone", detail.vendor.phone || "—"],
                ["GSTIN", detail.vendor.gstin || detail.vendor.business?.gstNumber || "Not provided"],
                ["City", detail.vendor.business?.address?.city || detail.vendor.city || "—"],
                ["Available to withdraw", rupees(detail.s.available)],
                ["Reserved for payouts", rupees(detail.s.reserved)],
                ["Paid out (all time)", rupees(detail.s.paidOut)],
                ["Cash collected (period)", rupees(detail.s.cashCollected)],
              ].map(([k, val]) => (
                <div key={k} className="p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                  <div className="text-[10px] text-gray-500">{k}</div>
                  <div className="font-semibold text-gray-900 break-words">{val}</div>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="bg-surface-2 border-b border-line text-[10px] uppercase text-faint">
                    {["Completed", "Booking", "Route", "Fare", "Vendor Payout", "Tolls", "Payment", "Ledger"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings
                    .filter((b) => b.assignedVendorId === detail.vendor.id && b.status === "Completed" && inRange(tripDate(b), range))
                    .sort((a, b) => (tripDate(b)?.getTime() ?? 0) - (tripDate(a)?.getTime() ?? 0))
                    .map((b) => (
                      <tr key={b.id} className="border-b border-hover">
                        <td className="px-3 py-2">{dateLabel(tripDate(b))}</td>
                        <td className="px-3 py-2 font-mono text-brand">{b.bookingId || b.id}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{b.pickup} → {b.drop}</td>
                        <td className="px-3 py-2">{rupees(parseAmount(b.fare))}</td>
                        <td className="px-3 py-2">{tripPayout(b) !== null ? rupees(tripPayout(b)!) : "Not finalized"}</td>
                        <td className="px-3 py-2">{b.tollCharges ? `${rupees(Number(b.tollCharges))}${b.tollsApproved ? "" : " (not approved)"}` : "—"}</td>
                        <td className="px-3 py-2">{b.paymentMethod || "—"} • {b.payment === "Paid" ? "Paid" : "Pending"}</td>
                        <td className="px-3 py-2">{tripEarningStatus(ledger, b.id) || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {action && (
        <PayoutActionModal
          kind={action.kind}
          payout={action.payout}
          onClose={() => setAction(null)}
          onDone={(msg) => {
            setAction(null);
            show(msg);
          }}
        />
      )}
    </div>
  );
}
