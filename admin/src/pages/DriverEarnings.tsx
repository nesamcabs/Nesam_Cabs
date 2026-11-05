import { useEffect, useMemo, useState } from "react";
import type { Booking, Driver, Vendor } from "../types";
import { subscribeBookings, subscribeDrivers, subscribePayoutRequests, subscribeVendors } from "../services/adminFirestoreService";
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
import { formatINR, parseAmount } from "../utils/analytics";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import PayoutActionModal from "../components/PayoutActionModal";

type Preset = "this-month" | "last-month" | "last-30" | "all" | "custom";

const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const dateLabel = (d: Date | null) =>
  d ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function rangeFor(preset: Preset, from: string, to: string): DateRange {
  const now = new Date();
  if (preset === "this-month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
  if (preset === "last-month") {
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999) };
  }
  if (preset === "last-30") return { from: new Date(now.getTime() - 30 * 86400000), to: null };
  if (preset === "custom") {
    return {
      from: from ? new Date(`${from}T00:00:00`) : null,
      to: to ? new Date(`${to}T23:59:59.999`) : null,
    };
  }
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

export default function DriverEarnings() {
  const [activeTab, setActiveTab] = useState<"earnings" | "payouts" | "monthly">("earnings");
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
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
  const [driverType, setDriverType] = useState<"All" | "Independent" | "Fleet">("All");
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
      subscribeDrivers((d) => {
        setDrivers(d);
        setLoading(false);
      }, fail),
      subscribeVendors(setVendors, fail),
      subscribeBookings(setBookings, fail),
      subscribePayoutRequests(setPayouts, fail),
      subscribeLedger(setLedger, fail),
      subscribeWallets(setWallets, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const rangeError = preset === "custom" && customFrom && customTo && customFrom > customTo ? "The start date is after the end date." : "";
  const vendorName = useMemo(() => {
    const m = new Map(vendors.map((v) => [v.id, v.companyName || (v as Vendor & { business?: { businessName?: string } }).business?.businessName || v.name || "Vendor"]));
    return (id?: string) => (id ? m.get(id) || "Vendor" : "");
  }, [vendors]);
  const driverPayouts = useMemo(() => payouts.filter((p) => p.driverId), [payouts]);

  const rows = useMemo(
    () =>
      drivers
        .filter((d) => d.status === "Approved" || bookings.some((b) => b.assignedDriverId === d.id))
        .map((d) => ({ driver: d, fleet: !!d.vendorId, s: summarizePartner("driver", d.id, bookings, ledger, wallets.get(walletKey("driver", d.id)), range) }))
        .sort((a, b) => b.s.earnings - a.s.earnings || b.s.completedTrips - a.s.completedTrips || (a.driver.name || "").localeCompare(b.driver.name || "")),
    [drivers, bookings, ledger, wallets, range],
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (driverType === "All" || (driverType === "Fleet") === r.fleet) &&
        (!q || [r.driver.name, r.driver.phone, vendorName(r.driver.vendorId)].some((v) => (v || "").toLowerCase().includes(q))),
    );
  }, [rows, search, driverType, vendorName]);

  const kpis = useMemo(() => {
    const open = driverPayouts.filter((p) => p.status === "Pending" || p.status === "Deferred" || !p.status);
    return {
      earningDrivers: rows.filter((r) => r.s.earnings > 0).length,
      earnings: rows.reduce((s, r) => s + r.s.earnings + r.s.tolls, 0),
      openCount: open.length,
      openAmount: open.reduce((s, p) => s + parseAmount(p.amount), 0),
      paidOut: driverPayouts.filter((p) => p.status === "Paid").reduce((s, p) => s + parseAmount(p.amount), 0),
    };
  }, [rows, driverPayouts]);

  const shownPayouts = useMemo(
    () =>
      driverPayouts
        .filter((p) => {
          const st = p.status || "Pending";
          if (payoutFilter === "Open") return st === "Pending" || st === "Deferred";
          if (payoutFilter === "All") return true;
          return st === payoutFilter;
        })
        .sort((a, b) => (payoutRequestedAt(b)?.getTime() ?? 0) - (payoutRequestedAt(a)?.getTime() ?? 0)),
    [driverPayouts, payoutFilter],
  );

  const monthly = useMemo(() => monthlyFromLedger("driver", ledger, driverPayouts), [ledger, driverPayouts]);

  const driverById = (id?: string) => drivers.find((d) => d.id === id);
  const detail = detailId ? rows.find((r) => r.driver.id === detailId) ?? null : null;

  const exportLedger = () =>
    downloadCsv(
      `nesam_driver_earnings_${new Date().toISOString().slice(0, 10)}.csv`,
      ["Driver", "Phone", "Type", "Vendor", "Completed Trips", "Earning Trips", "Gross Fares", "Driver Earnings", "Approved Tolls", "Platform Share", "Cash Trips", "Available to Withdraw", "Pending Payouts", "Paid Out"],
      filteredRows.map((r) => [
        r.driver.name || "",
        r.driver.phone || "",
        r.fleet ? "Fleet" : "Independent",
        vendorName(r.driver.vendorId),
        r.s.completedTrips,
        r.s.earningTrips,
        r.s.grossFares,
        r.s.earnings,
        r.s.tolls,
        r.s.platformShare,
        r.s.cashTrips,
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
        <h1 className="text-[20px] font-bold text-ink">Driver Earnings & Payouts</h1>
        <p className="text-[13px] text-muted">
          Independent drivers earn the accepted trip payout plus approved tolls. Fleet drivers' trips are paid to their vendor (see Vendor Finance).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Drivers with Earnings (period)", value: String(kpis.earningDrivers), color: "#c1232c" },
          { label: "Driver Earnings incl. Tolls (period)", value: formatINR(kpis.earnings), color: "#111" },
          { label: `Open Payout Requests (${kpis.openCount})`, value: formatINR(kpis.openAmount), color: "#F59E0B" },
          { label: "Paid Out to Drivers (all time)", value: formatINR(kpis.paidOut), color: "#10B981" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className="text-[22px] font-bold" style={{ color: s.color }}>{loading ? "—" : s.value}</div>
            <div className="text-[11px] text-faint mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-white rounded-xl border border-line p-1 w-fit shadow-sm">
          {[
            { key: "earnings" as const, label: "Driver Earnings Ledger" },
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
        {activeTab === "earnings" && (
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

      {activeTab === "earnings" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line bg-surface-2">
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search driver, phone, vendor…" className="px-3 py-1.5 text-[12px] border border-line rounded-lg min-w-[220px]" />
              <select aria-label="Driver type" value={driverType} onChange={(e) => setDriverType(e.target.value as typeof driverType)} className="px-3 py-1.5 text-[12px] border border-line rounded-lg bg-white">
                <option value="All">All drivers</option>
                <option value="Independent">Independent</option>
                <option value="Fleet">Fleet (vendor)</option>
              </select>
            </div>
            <button onClick={exportLedger} disabled={filteredRows.length === 0} className="text-[12px] font-semibold px-4 py-2 rounded-lg border border-line bg-white text-brand hover:bg-brand-soft disabled:opacity-40">
              📥 Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {["Driver", "Type", "Trips", "Gross Fares", "Driver Earnings", "Tolls", "Platform Share", "Available", "Pending Payout", ""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ driver: d, fleet, s }) => (
                  <tr key={d.id} className="border-b border-hover hover:bg-gray-50/60 last:border-0">
                    <td className="px-4 py-3">
                      <div className="text-[12px] font-bold text-ink">{d.name || "Driver"}</div>
                      <div className="text-[10px] text-faint">{d.phone || d.id}</div>
                    </td>
                    <td className="px-4 py-3 text-[12px] text-muted">{fleet ? `Fleet — ${vendorName(d.vendorId)}` : "Independent"}</td>
                    <td className="px-4 py-3 text-[12px] font-bold text-ink">{s.completedTrips}</td>
                    <td className="px-4 py-3 text-[12px] text-ink">{fleet ? "—" : rupees(s.grossFares)}</td>
                    <td className="px-4 py-3 text-[12px] font-bold text-green-700">
                      {fleet ? <span className="text-[11px] font-normal text-faint">Paid via vendor</span> : rupees(s.earnings)}
                      {!fleet && s.awaitingFinance > 0 && <div className="text-[10px] font-normal text-amber-700">{s.awaitingFinance} trip(s) awaiting fare verification</div>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-body">{fleet ? "—" : rupees(s.tolls)}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: "#c1232c" }}>{fleet ? "—" : rupees(s.platformShare)}</td>
                    <td className={`px-4 py-3 text-[12px] font-bold ${s.available < 0 ? "text-red-700" : "text-ink"}`}>
                      {fleet ? "—" : rupees(s.available)}
                      {!fleet && s.pending > 0 && <div className="text-[10px] font-normal text-faint">+{rupees(s.pending)} awaiting payment</div>}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-amber-700">{s.reserved ? rupees(s.reserved) : "—"}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setDetailId(d.id)} className="text-[11px] px-2.5 py-1 rounded-md border border-line hover:bg-brand-soft text-brand font-semibold">
                        Trips
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filteredRows.length === 0 && (
              <div className="py-12 text-center text-[13px] text-faint">{rows.length === 0 ? "No approved drivers yet." : "No drivers match your filters."}</div>
            )}
            {loading && <div className="py-12 text-center text-[13px] text-faint">Loading driver earnings…</div>}
          </div>
          <div className="px-5 py-3 text-[11px] text-faint border-t border-line-soft">
            Figures come from the partner ledger kept by the server. "Available" is withdrawable: earnings and approved tolls on trips whose payment is verified, minus cash fares the driver collected and payout requests. It can be negative when cash collected exceeds earnings.
          </div>
        </div>
      )}

      {activeTab === "payouts" && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(["Open", "Paid", "Rejected", "All"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setPayoutFilter(f)}
                className={`px-3 py-1 rounded-lg text-[11px] font-semibold ${payoutFilter === f ? "bg-ink text-white" : "bg-white border border-line text-muted"}`}
              >
                {f === "Open" ? "Pending & deferred" : f}
              </button>
            ))}
          </div>
          {shownPayouts.map((p) => {
            const d = driverById(p.driverId);
            const bal = p.driverId ? wallets.get(walletKey("driver", p.driverId)) ?? null : null;
            const status = p.status || "Pending";
            const open = status === "Pending" || status === "Deferred";
            return (
              <div key={p.id} className="bg-white rounded-xl border border-line shadow-sm p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-ink">{p.driverName || d?.name || p.driverId}</div>
                  <div className="text-[11px] text-faint">
                    Requested {dateLabel(payoutRequestedAt(p))} • {p.method || "—"}: <span className="font-mono">{p.details || "—"}</span>
                  </div>
                  {bal && open && (
                    <div className="text-[11px] text-muted mt-0.5">
                      Balance after reserving requests {rupees(bal.available)} • reserved incl. this request {rupees(bal.reserved)} • paid out {rupees(bal.paidOut)}
                    </div>
                  )}
                  {p.utr && <div className="text-[11px] text-green-700 mt-0.5">UTR {p.utr} • {p.processedAt ? dateLabel(new Date(p.processedAt)) : ""}</div>}
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
                      {status === "Pending" && (
                        <button onClick={() => setAction({ kind: "defer", payout: p })} className="text-[12px] font-semibold px-3 py-2 rounded-lg border border-line text-muted hover:bg-hover">Defer</button>
                      )}
                      <button onClick={() => setAction({ kind: "reject", payout: p })} className="text-[12px] font-semibold px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50">Reject</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!loading && shownPayouts.length === 0 && (
            <div className="bg-white rounded-xl border border-line py-14 text-center text-[13px] text-faint">No payout requests in this view.</div>
          )}
        </div>
      )}

      {activeTab === "monthly" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-line bg-surface-2">
            <div className="text-[13px] font-bold text-ink">Independent Driver Earnings by Month</div>
            <p className="text-[11px] text-faint">
              TDS is not deducted by the platform. The 1% column is a reference for Section 194C compliance on amounts actually paid out.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {["Month", "Completed Trips", "Earned (incl. tolls)", "Paid Out", "1% TDS on Paid Out (reference)"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold text-faint uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr key={m.label} className="border-b border-hover last:border-0">
                    <td className="px-4 py-3 text-[12px] font-bold text-ink">{m.label}</td>
                    <td className="px-4 py-3 text-[12px]">{m.trips}</td>
                    <td className="px-4 py-3 text-[12px] font-semibold">{rupees(m.earnings)}</td>
                    <td className="px-4 py-3 text-[12px]">{rupees(m.paid)}</td>
                    <td className="px-4 py-3 text-[12px] text-muted">{rupees(m.paid * 0.01)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {monthly.length === 0 && <div className="py-12 text-center text-[13px] text-faint">No completed independent-driver trips or payouts yet.</div>}
          </div>
        </div>
      )}

      {detail && (
        <Modal title={`${detail.driver.name || "Driver"} — Trips`} subtitle={detail.fleet ? `Fleet driver of ${vendorName(detail.driver.vendorId)}` : "Independent driver"} onClose={() => setDetailId(null)} size="xl">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] min-w-[700px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line text-[10px] uppercase text-faint">
                  {["Completed", "Booking", "Route", "Fare", "Driver Share", "Tolls", "Payment", "Ledger"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bookings
                  .filter((b) => b.assignedDriverId === detail.driver.id && b.status === "Completed" && inRange(tripDate(b), range))
                  .sort((a, b) => (tripDate(b)?.getTime() ?? 0) - (tripDate(a)?.getTime() ?? 0))
                  .map((b) => {
                    const fleetTrip = !!b.assignedVendorId;
                    return (
                      <tr key={b.id} className="border-b border-hover">
                        <td className="px-3 py-2">{dateLabel(tripDate(b))}</td>
                        <td className="px-3 py-2 font-mono text-brand">{b.bookingId || b.id}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{b.pickup} → {b.drop}</td>
                        <td className="px-3 py-2">{rupees(parseAmount(b.fare))}</td>
                        <td className="px-3 py-2">{fleetTrip ? "Vendor trip" : tripPayout(b) !== null ? rupees(tripPayout(b)!) : "Not finalized"}</td>
                        <td className="px-3 py-2">{b.tollCharges ? `${rupees(Number(b.tollCharges))}${b.tollsApproved ? "" : " (not approved)"}` : "—"}</td>
                        <td className="px-3 py-2">{b.paymentMethod || "—"} • {b.payment === "Paid" ? "Paid" : "Pending"}</td>
                        <td className="px-3 py-2">{fleetTrip ? "—" : tripEarningStatus(ledger, b.id) || "—"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
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
