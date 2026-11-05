import { useEffect, useMemo, useState } from "react";
import type { Booking, PaymentTransaction } from "../types";
import { subscribePayments, subscribePayoutRequests } from "../services/adminFirestoreService";
import { subscribeLedger, subscribeWallets, walletKey, type LedgerEntry, type PayoutRequest, type Wallet } from "../services/earningsService";
import { markRegister, nextClosingRef, addRegisterEntry, subscribeRegister, today, type RegisterEntry } from "../services/accountsService";
import { subscribeBusinessAccounts, type BusinessAccount } from "../services/businessService";
import { useBookings, useCustomers, useOfficeData } from "../hooks/useOfficeData";
import { useCan } from "../components/AccessContext";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, toneForStatus } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import { resolveAdminDestination } from "../config/adminNavigation";
import { RefundModal } from "../components/booking/BookingActions";
import Statement from "../components/accounts/Statement";
import { BankEntryForm, ExpenseForm, RefundRequestForm, SupplierBillForm, TaxPaymentForm, type AccountRef } from "../components/accounts/RegisterForms";
import { paymentOf } from "../domain/bookingFlow";
import { refDateTime, rupee } from "../domain/officeStage";
import { exportRows } from "../utils/exportData";
import { bookingPickupDate, isoDateIST, toDate } from "../utils/time";

const TABS = ["Overview", "Collections", "Partner payouts", "Wallet & deposit", "Expenses & bills", "Bank & cash", "Tax payments", "Statements", "Reconciliation", "Refunds", "Daily closing"] as const;
type Tab = (typeof TABS)[number];
type Sheet = "expense" | "bill" | "bank" | "recon" | "tax" | "refund" | "closing" | null;

const dayOf = (v: unknown) => { const d = toDate(v as never); return d ? isoDateIST(d) : ""; };
const inRange = (day: string, from: string, to: string) => !!day && (!from || day >= from) && (!to || day <= to);

/** Master Admin Accounts: collections, payouts, wallets, expenses and verified payment records. */
export default function Accounts({ onNavigate, initialTab }: { onNavigate: (p: string, tab?: string) => void; initialTab?: string }) {
  const [first, ...rest] = (resolveAdminDestination("accounts", initialTab).tab ?? "").split(":");
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(first) ? (first as Tab) : "Overview");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [register, setRegister] = useState<RegisterEntry[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [wallets, setWallets] = useState<Map<string, Wallet>>(new Map());
  const [business, setBusiness] = useState<BusinessAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<Booking | null>(null);
  const bookings = useBookings().rows ?? [];
  const customers = useCustomers().rows ?? [];
  const data = useOfficeData();
  const canFinance = useCan("finance");
  const { toast, show } = useToast(7000);

  useEffect(() => {
    const u = [
      subscribeRegister(setRegister, setError), subscribePayments(setPayments, () => setPayments([])), subscribePayoutRequests(setPayouts as never, () => setPayouts([])),
      subscribeLedger(setLedger, () => setLedger([])), subscribeWallets(setWallets, () => setWallets(new Map())), subscribeBusinessAccounts(setBusiness, () => undefined),
    ];
    return () => u.forEach((x) => x());
  }, []);

  const done = (t: string) => { setSheet(null); show(t); };
  const by = (k: RegisterEntry["kind"]) => register.filter((r) => r.kind === k && inRange(r.date, from, to)).sort((a, b) => b.date.localeCompare(a.date));
  const receipts = payments.filter((p) => String(p.status).toLowerCase() === "success" && inRange(dayOf((p as PaymentTransaction & { createdAt?: unknown }).createdAt ?? p.date), from, to));
  const closedBills = bookings.filter((b) => b.status === "Completed" && inRange(dayOf(bookingPickupDate(b)), from, to));
  const payoutOf = (b: Booking) => (typeof b.finance?.partnerPayout === "number" ? b.finance.partnerPayout : Number(b.vendorPayout || b.driverPayout) || 0);
  const kpi = {
    collections: receipts.reduce((s, p) => s + (Number(String(p.amount).replace(/[^\d.]/g, "")) || 0), 0),
    payouts: closedBills.reduce((s, b) => s + payoutOf(b), 0),
    expenses: [...by("expense"), ...by("supplier_bill")].reduce((s, r) => s + r.amount, 0),
    tax: by("tax").reduce((s, r) => s + r.amount, 0),
  };
  const exportRegister = () => exportRows("Accounts register", ["Date", "Register", "Payee / account", "Reference", "Amount", "Status", "Recorded by"], register.map((r) => [r.date, r.kind.replace(/_/g, " "), r.payee || r.accountName || r.account || "", r.reference || "", r.amount, r.status || r.itcStatus || r.matchStatus || "", r.createdByName || ""]), "xlsx");

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {error && <ErrorBanner message={error} />}
      <PageHeader title="Accounts" subtitle="Collections, payouts, wallets, expenses and verified payment records." actions={<Button icon="download" onClick={exportRegister}>Export register</Button>} />
      <StageBar label="Accounts" tabs={TABS.map((t) => ({ id: t, label: t }))} value={tab} onChange={setTab} />

      {["Overview", "Collections", "Partner payouts", "Expenses & bills", "Bank & cash", "Tax payments"].includes(tab) && (
        <div className="ds-filterbar">
          <label className="ds-field"><span>From</span><input type="date" className="ds-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="ds-field"><span>To</span><input type="date" className="ds-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <Button variant="ghost" icon="rotate-ccw" onClick={() => { setFrom(""); setTo(""); }}>Clear dates</Button>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" icon="file-text" className="text-brand" onClick={() => onNavigate("full-final", "Bill review")}>Bill review</Button>
            <Button variant="ghost" icon="shield-alert" className="text-brand" onClick={() => onNavigate("penalties")}>Penalties</Button>
            <Button variant="ghost" icon="copy" onClick={() => onNavigate("full-final")}>F&amp;F records</Button>
          </div>
        </div>
      )}

      {tab === "Overview" && (
        <section className="ds-panel ds-panel-pad">
          <div className="ds-kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {([["NESAM collections", kpi.collections, "Recorded receipts"], ["Partner payout working", kpi.payouts, "Verified closed trip bills"], ["Expenses & purchases", kpi.expenses, "Recorded bills · ITC unreviewed"], ["Tax payments", kpi.tax, "Verified references"]] as const).map(([l, v, n]) => (
              <div key={l} className="ds-kpi"><span className="ds-kpi-label">{l}</span><span className="ds-kpi-value">{rupee(v)}</span><span className="ds-kpi-note">{n}</span></div>
            ))}
          </div>
          {canFinance && (
            <div className="flex flex-wrap gap-2 mb-4">
              <Button icon="receipt-text" onClick={() => setSheet("expense")}>Record expense</Button>
              <Button icon="landmark" onClick={() => setSheet("bank")}>Bank / cash entry</Button>
              <Button icon="badge-indian-rupee" onClick={() => setSheet("tax")}>Record tax payment</Button>
              <Button icon="chart-no-axes-combined" onClick={() => onNavigate("reports", "GST Reports")}>Open GST reports</Button>
            </div>
          )}
          <p className="ds-note mb-5"><Icon name="info" size={14} /> Customer receipts, vendor payout working and tax deposits are separate registers. They are not a final profit calculation.</p>
          <h2 className="text-[17px] font-bold text-ink mb-3" style={{ fontFamily: "var(--font-display)" }}>Recent recorded tax payments</h2>
          <TaxTable rows={by("tax").slice(0, 5)} />
        </section>
      )}

      {tab === "Collections" && (
        <section className="ds-panel ds-panel-pad">
          <h2 className="text-[17px] font-bold text-ink">Customer collections</h2>
          <p className="text-[12px] text-muted mb-3">Office / online receipts recorded against bookings. Driver collections appear in verified trip bill working.</p>
          {receipts.length === 0 ? <EmptyState /> : (
            <DataTable label="Customer collections" minWidth={760} hideTools>
              <thead><tr><th>Date</th><th>Receipt</th><th>Booking</th><th className="ds-num">Amount</th><th>Method</th><th>Reference</th></tr></thead>
              <tbody>{receipts.map((p) => {
                const x = p as PaymentTransaction & { createdAt?: unknown; reference?: string; collectorName?: string };
                return <tr key={p.id}><td>{dayOf(x.createdAt ?? p.date)}</td><td>{p.id.slice(-10)}</td><td>{p.bookingId}</td><td className="ds-num">{rupee(Number(String(p.amount).replace(/[^\d.]/g, "")) || 0)}</td><td>{p.method}</td><td>{x.reference || p.gateway || "—"}</td></tr>;
              })}</tbody>
            </DataTable>
          )}
        </section>
      )}

      {tab === "Partner payouts" && (
        <section className="ds-panel ds-panel-pad">
          <p className="ds-note mb-3">Agreed payouts below are working liabilities from verified closed bills. Bank settlement entries stay separate.</p>
          {closedBills.length === 0 ? <EmptyState /> : (
            <DataTable label="Partner payouts" minWidth={860}>
              <thead><tr><th>Booking</th><th>Bill date</th><th>Partner ID</th><th>Partner</th><th className="ds-num">Agreed payout</th><th className="ds-num">Driver collected</th><th className="ds-num">NESAM advance</th></tr></thead>
              <tbody>{closedBills.map((b) => {
                const pay = paymentOf(b);
                return <tr key={b.id}><td>{b.bookingId || b.id}</td><td>{dayOf(bookingPickupDate(b))}</td><td>{(b.assignedVendorId || b.assignedDriverId || "").slice(0, 12)}</td><td>{b.assignedVendorName || b.assignedDriverName || "—"}</td><td className="ds-num">{payoutOf(b)}</td><td className="ds-num">{pay.partnerCashHeld}</td><td className="ds-num">{pay.advancePaid}</td></tr>;
              })}</tbody>
            </DataTable>
          )}
          <h3 className="text-[14px] font-bold text-ink mt-5 mb-2">Recorded bank settlements</h3>
          {(() => {
            const paid = payouts.filter((p) => /paid/i.test(String(p.status)));
            const recorded = register.filter((r) => r.kind === "settlement");
            if (!paid.length && !recorded.length) return <EmptyState />;
            return (
              <DataTable label="Recorded bank settlements" minWidth={700} hideTools>
                <thead><tr><th>Date</th><th>Partner</th><th className="ds-num">Amount</th><th>Reference</th><th>Source</th></tr></thead>
                <tbody>
                  {paid.map((p) => <tr key={p.id}><td>{p.processedAt?.slice(0, 10) || dayOf(p.createdAt)}</td><td>{p.vendorName || p.driverName}</td><td className="ds-num">{rupee(Number(p.amount))}</td><td>{p.utr || "—"}</td><td>Payout request</td></tr>)}
                  {recorded.map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.accountName}</td><td className="ds-num">{rupee(r.amount)}</td><td>{r.reference}</td><td>{r.description}</td></tr>)}
                </tbody>
              </DataTable>
            );
          })()}
        </section>
      )}

      {tab === "Wallet & deposit" && <WalletDeposit wallets={wallets} ledger={ledger} register={register} vendors={data.vendors.map((v) => ({ id: v.id, name: v.companyName || v.name }))} />}

      {tab === "Expenses & bills" && (
        <section className="ds-panel ds-panel-pad">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div><h2 className="text-[17px] font-bold text-ink">Expenses &amp; supplier bills</h2><p className="text-[12px] text-muted">Record each bill once. GST eligibility is reviewed separately.</p></div>
            {canFinance && <div className="flex gap-2"><Button icon="plus" onClick={() => setSheet("expense")}>Add expense</Button><Button icon="plus" onClick={() => setSheet("bill")}>Add supplier bill</Button></div>}
          </div>
          {(() => {
            const rows = [...by("expense"), ...by("supplier_bill")].sort((a, b) => b.date.localeCompare(a.date));
            if (!rows.length) return <EmptyState />;
            return (
              <DataTable label="Expenses and bills" minWidth={1040}>
                <thead><tr><th>Date</th><th>Payee</th><th>Category</th><th>Bill reference</th><th className="ds-num">Taxable</th><th className="ds-num">Tax recorded</th><th className="ds-num">Total</th><th>ITC review</th><th>Source</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id}><td>{r.date}</td><td>{r.payee}</td><td>{r.category}</td><td>{r.reference}</td><td className="ds-num">{rupee(r.taxable ?? r.amount)}</td><td className="ds-num">{rupee(r.tax ?? 0)}</td><td className="ds-num">{rupee(r.amount)}</td>
                    <td>{canFinance ? <select className="ds-select" style={{ minHeight: 30 }} value={r.itcStatus ?? "Unreviewed"} onChange={(e) => markRegister(r.id, { itcStatus: e.target.value as RegisterEntry["itcStatus"] }).then(() => show("ITC review saved."))}><option>Unreviewed</option><option>Eligible</option><option>Ineligible</option></select> : r.itcStatus}</td>
                    <td>{r.kind === "expense" ? "Expense" : "Supplier bill"}{r.fileName && <small>{r.fileName}</small>}</td></tr>
                ))}</tbody>
              </DataTable>
            );
          })()}
        </section>
      )}

      {tab === "Bank & cash" && (
        <section className="ds-panel ds-panel-pad">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div><h2 className="text-[17px] font-bold text-ink">Bank &amp; cash entries</h2><p className="text-[12px] text-muted">Record account movements and attach year-end reconciliation separately.</p></div>
            {canFinance && <Button icon="plus" onClick={() => setSheet("bank")}>Add entry</Button>}
          </div>
          {by("bank").length === 0 ? <EmptyState /> : (
            <DataTable label="Bank and cash" minWidth={760} hideTools>
              <thead><tr><th>Date</th><th>Account</th><th>Direction</th><th className="ds-num">Amount</th><th>Description</th><th>Reference</th></tr></thead>
              <tbody>{by("bank").map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.account}</td><td><Badge tone={r.direction === "Money in" ? "green" : "amber"}>{r.direction}</Badge></td><td className="ds-num">{rupee(r.amount)}</td><td>{r.description}</td><td>{r.reference}</td></tr>)}</tbody>
            </DataTable>
          )}
        </section>
      )}

      {tab === "Tax payments" && (
        <section className="ds-panel ds-panel-pad">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div><h2 className="text-[17px] font-bold text-ink">Tax payment register</h2><p className="text-[12px] text-muted">One payment record is shared with GST and Income Tax reports.</p></div>
            {canFinance && <Button icon="plus" onClick={() => setSheet("tax")}>Record tax payment</Button>}
          </div>
          <p className="ds-note mb-3">Cash ledger deposit and liability discharged are tracked separately. A deposit alone does not mark a GST return as paid.</p>
          <TaxTable rows={by("tax")} />
        </section>
      )}

      {tab === "Statements" && <StatementPicker initial={rest.join(":")} customers={customers.map((c) => ({ type: "customer" as const, id: c.id, name: c.name, code: `NSM-CU-${c.id.slice(0, 6).toUpperCase()}` }))} business={business.map((b) => ({ type: "business" as const, id: b.id, name: b.name, code: b.code }))} vendors={data.vendors.map((v) => ({ type: "vendor" as const, id: v.id, name: v.companyName || v.name, code: `NSM-VN-${v.id.slice(0, 6).toUpperCase()}` }))} drivers={data.drivers.map((d) => ({ type: "driver" as const, id: d.id, name: d.name, code: d.licenseNumber || d.id.slice(0, 10) }))} />}

      {tab === "Reconciliation" && <Reconciliation entries={register.filter((r) => r.kind === "recon")} payments={payments} canFinance={canFinance} onNew={() => setSheet("recon")} onToast={show} />}

      {tab === "Refunds" && <Refunds bookings={bookings} requests={register.filter((r) => r.kind === "refund_request")} canFinance={canFinance} onNew={() => setSheet("refund")} onProcess={setRefunding} onToast={show} />}

      {tab === "Daily closing" && <DailyClosing bookings={bookings} payments={payments} closings={register.filter((r) => r.kind === "closing")} canFinance={canFinance} onToast={show} />}


      {sheet === "expense" && <ExpenseForm onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "bill" && <SupplierBillForm onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "bank" && <BankEntryForm onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "recon" && <BankEntryForm recon onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "tax" && <TaxPaymentForm onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "refund" && <RefundRequestForm bookings={bookings.filter((b) => paymentOf(b).totalPaid > 0)} onClose={() => setSheet(null)} onDone={done} />}
      {refunding && <RefundModal booking={refunding} onClose={() => setRefunding(null)} onDone={(t) => { setRefunding(null); show(t); }} />}
    </div>
  );
}

function TaxTable({ rows }: { rows: RegisterEntry[] }) {
  if (!rows.length) return <EmptyState />;
  return (
    <DataTable label="Tax payments" minWidth={820} hideTools>
      <thead><tr><th>TAX / PERIOD</th><th>PAYMENT DATE</th><th className="ds-num">AMOUNT</th><th className="ds-num">LIABILITY SETTLED</th><th>REFERENCE / STATUS</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.taxType}</strong><small>{r.period} · {r.purpose}</small></td><td>{r.date}</td><td className="ds-num">{rupee(r.amount)}</td><td className="ds-num">{rupee(r.liabilitySettled ?? 0)}</td><td>{r.reference}<div><Badge tone="green">{r.status || "Verified"}</Badge></div></td></tr>)}</tbody>
    </DataTable>
  );
}

type Acc = AccountRef & { code: string };

function StatementPicker({ initial, customers, business, vendors, drivers }: { initial: string; customers: Acc[]; business: Acc[]; vendors: Acc[]; drivers: Acc[] }) {
  const all = [...customers, ...business, ...vendors, ...drivers];
  const [key, setKey] = useState(initial && all.some((a) => `${a.type}:${a.id}` === initial) ? initial : all[0] ? `${all[0].type}:${all[0].id}` : "");
  useEffect(() => { if (!key && all[0]) setKey(`${all[0].type}:${all[0].id}`); }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initial && all.some((a) => `${a.type}:${a.id}` === initial)) setKey(initial); }, [initial, all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const acc = all.find((a) => `${a.type}:${a.id}` === key);
  const opt = (a: Acc) => <option key={`${a.type}:${a.id}`} value={`${a.type}:${a.id}`}>{a.name} · {a.code}</option>;
  return (
    <section className="ds-panel ds-panel-pad">
      <h2 className="text-[17px] font-bold text-ink">Full account statement</h2>
      <p className="text-[12px] text-muted mb-3">Debit increases the amount owed to NESAM; credit reduces it. Deposit stays separate.</p>
      <label className="ds-field mb-4" style={{ maxWidth: 460 }}><span>Account</span>
        <select className="ds-select" value={key} onChange={(e) => setKey(e.target.value)}>
          {customers.length > 0 && <optgroup label="Customers">{customers.map(opt)}</optgroup>}
          {business.length > 0 && <optgroup label="Business accounts">{business.map(opt)}</optgroup>}
          {vendors.length > 0 && <optgroup label="Vendors">{vendors.map(opt)}</optgroup>}
          {drivers.length > 0 && <optgroup label="Drivers">{drivers.map(opt)}</optgroup>}
        </select>
      </label>
      {acc ? <Statement key={key} account={acc} code={acc.code} /> : <EmptyState />}
    </section>
  );
}

function WalletDeposit({ wallets, ledger, register, vendors }: { wallets: Map<string, Wallet>; ledger: LedgerEntry[]; register: RegisterEntry[]; vendors: { id: string; name: string }[] }) {
  const [id, setId] = useState("");
  const v = vendors.find((x) => x.id === id) ?? vendors[0];
  if (!v) return <div className="ds-panel"><EmptyState /></div>;
  const w = wallets.get(walletKey("vendor", v.id));
  const dep = register.filter((r) => r.kind === "deposit" && r.accountType === "vendor" && r.accountId === v.id).reduce((s, r) => s + r.amount, 0);
  const tx = [
    ...ledger.filter((e) => e.actorType === "vendor" && e.actorId === v.id).map((e) => ({ at: e.createdAt, label: e.type === "trip_earning" ? "Trip payout credit" : e.type.replace(/_/g, " "), ref: e.bookingCode || e.payoutRequestId, amt: e.direction === "credit" ? e.netAmount : -e.netAmount })),
    ...register.filter((r) => ["settlement", "adjustment", "opening"].includes(r.kind) && r.accountType === "vendor" && r.accountId === v.id).map((r) => ({ at: new Date(r.date), label: r.kind === "opening" ? "Opening working wallet" : r.description || r.kind, ref: r.reference ?? "", amt: r.kind === "opening" ? -r.amount : r.direction === "Credit" ? r.amount : -r.amount })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return (
    <section className="ds-panel ds-panel-pad">
      <label className="ds-field mb-4" style={{ maxWidth: 400 }}><span>Vendor</span><select className="ds-select" value={v.id} onChange={(e) => setId(e.target.value)}>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name} · NSM-VN-{x.id.slice(0, 6).toUpperCase()}</option>)}</select></label>
      <div className="ds-kpi-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div className="ds-kpi"><span className="ds-kpi-label">Working wallet</span><span className="ds-kpi-value">{rupee(w ? w.available + w.pending : 0)}</span><span className="ds-kpi-note">Separate operating balance</span></div>
        <div className="ds-kpi"><span className="ds-kpi-label">Security deposit</span><span className="ds-kpi-value">{rupee(dep)}</span><span className="ds-kpi-note">{dep ? "Active · Refund at F&F only" : "Not recorded"}</span></div>
      </div>
      {tx.length === 0 ? <EmptyState /> : (
        <DataTable label="Wallet transactions" minWidth={640} hideTools>
          <thead><tr><th>Date · IST</th><th>Transaction</th><th>Duty / reference</th><th className="ds-num">Debit / credit</th></tr></thead>
          <tbody>{tx.map((t, i) => <tr key={i}><td>{refDateTime(t.at)}</td><td>{t.label}</td><td>{t.ref || "—"}</td><td className="ds-num" style={{ color: t.amt >= 0 ? "var(--color-ok)" : "var(--color-bad)" }}>{t.amt >= 0 ? "+" : "−"}{rupee(Math.abs(t.amt))}</td></tr>)}</tbody>
        </DataTable>
      )}
    </section>
  );
}

function Reconciliation({ entries, payments, canFinance, onNew, onToast }: { entries: RegisterEntry[]; payments: PaymentTransaction[]; canFinance: boolean; onNew: () => void; onToast: (t: string) => void }) {
  const [status, setStatus] = useState("All");
  const [matching, setMatching] = useState<RegisterEntry | null>(null);
  const [ref, setRef] = useState("");
  const rows = entries.filter((e) => status === "All" || (e.matchStatus ?? "Unmatched") === status).sort((a, b) => b.date.localeCompare(a.date));
  const match = async () => {
    if (!matching) return;
    const p = payments.find((x) => x.id === ref || x.bookingId === ref || (x as PaymentTransaction & { reference?: string }).reference === ref);
    const amt = p ? Number(String(p.amount).replace(/[^\d.]/g, "")) || 0 : 0;
    const ms: RegisterEntry["matchStatus"] = !p ? "Unmatched" : Math.abs(amt - matching.amount) < 0.01 && matching.direction === "Money in" ? "Matched" : "Amount mismatch";
    if (!p) return onToast("No receipt, settlement or refund has that reference.");
    await markRegister(matching.id, { matchStatus: ms, matchedRef: ref });
    setMatching(null);
    onToast(ms === "Matched" ? "Entry matched." : "Amount or direction does not agree · marked as mismatch.");
  };
  return (
    <section className="ds-panel ds-panel-pad">
      <p className="text-[12px] text-muted">Verified registers and daily office controls.</p>
      <div className="flex flex-wrap items-start justify-between gap-3 my-3">
        <div><h2 className="text-[17px] font-bold text-ink">Payment reconciliation</h2><p className="text-[12px] text-muted">Compare recorded bank / gateway movements with customer receipts, settlements and refunds.</p></div>
        {canFinance && <Button icon="plus" onClick={onNew}>Record bank / gateway entry</Button>}
      </div>
      <p className="ds-note mb-3">Matching records does not transfer money. Amount and direction must both agree.</p>
      <label className="ds-field mb-3" style={{ maxWidth: 220 }}><span>Status</span><select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value)}>{["All", "Unmatched", "Matched", "Amount mismatch"].map((s) => <option key={s}>{s}</option>)}</select></label>
      {rows.length === 0 ? <EmptyState /> : (
        <DataTable label="Reconciliation" minWidth={760} hasActions hideTools>
          <thead><tr><th>DATE / ACCOUNT</th><th>REFERENCE</th><th className="ds-num">AMOUNT / DIRECTION</th><th>STATUS</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.date}</strong><small>{r.account}</small></td><td>{r.reference}<small>{r.description}</small></td><td className="ds-num"><strong>{rupee(r.amount)}</strong><small>{r.direction}</small></td><td><Badge tone={r.matchStatus === "Matched" ? "green" : r.matchStatus === "Amount mismatch" ? "red" : "amber"}>{r.matchStatus ?? "Unmatched"}</Badge>{r.matchedRef && <small>{r.matchedRef}</small>}</td><td className="ds-actions"><div>{canFinance && r.matchStatus !== "Matched" && <Button size="sm" onClick={() => { setMatching(r); setRef(""); }}>Match</Button>}</div></td></tr>)}</tbody>
        </DataTable>
      )}
      {matching && (
        <Modal title="Match bank / gateway entry" onClose={() => setMatching(null)} footer={<Button variant="primary" onClick={match}>Match entry</Button>}>
          <p className="ds-note mb-3">{matching.date} · {matching.account} · {rupee(matching.amount)} · {matching.direction}</p>
          <label className="ds-field"><span>Receipt / booking / payment reference</span><input className="ds-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        </Modal>
      )}
    </section>
  );
}

function Refunds({ bookings, requests, canFinance, onNew, onProcess, onToast }: { bookings: Booking[]; requests: RegisterEntry[]; canFinance: boolean; onNew: () => void; onProcess: (b: Booking) => void; onToast: (t: string) => void }) {
  const [status, setStatus] = useState("All");
  const label = (s: string) => (s === "Pending" ? "Pending approval" : s === "Completed" ? "Refunded" : s);
  const rows = [
    ...bookings.filter((b) => b.refund).map((b) => ({ key: b.id, ref: `Booking refund · ${b.bookingId || b.id}`, amount: b.refund!.amount, status: label(b.refund!.status), by: b.refund!.processedByName || "—", reference: b.refund!.reference || "", booking: b, request: null as RegisterEntry | null })),
    ...requests.map((r) => ({ key: r.id, ref: `${r.bookingCode} · ${r.description}`, amount: r.amount, status: r.status || "Pending approval", by: r.createdByName || "—", reference: r.verifiedByName ? `Approved by ${r.verifiedByName}` : "", booking: bookings.find((b) => b.id === r.bookingId) ?? null, request: r })),
  ].filter((r) => status === "All" || r.status === status);
  return (
    <section className="ds-panel ds-panel-pad">
      <p className="text-[12px] text-muted">Verified registers and daily office controls.</p>
      <div className="flex flex-wrap items-start justify-between gap-3 my-3">
        <div><h2 className="text-[17px] font-bold text-ink">Customer refunds</h2><p className="text-[12px] text-muted">Approval, payment processing and bank confirmation stay separate.</p></div>
        {canFinance && <Button icon="plus" onClick={onNew}>New refund</Button>}
      </div>
      <label className="ds-field mb-3" style={{ maxWidth: 220 }}><span>Status</span><select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value)}>{["All", "Pending approval", "Approved", "Processing", "Refunded", "Failed", "Rejected"].map((s) => <option key={s}>{s}</option>)}</select></label>
      {rows.length === 0 ? <EmptyState /> : (
        <DataTable label="Refunds" minWidth={760} hasActions hideTools>
          <thead><tr><th>REFUND / BOOKING</th><th className="ds-num">AMOUNT</th><th>STATUS</th><th>HANDLED BY / REFERENCE</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key}><td>{r.ref}</td><td className="ds-num">{rupee(r.amount)}</td><td><Badge tone={toneForStatus(r.status)}>{r.status}</Badge></td><td>{r.by}<small>{r.reference}</small></td>
              <td className="ds-actions"><div>
                {canFinance && r.request && r.status === "Pending approval" && <><Button size="sm" variant="primary" onClick={() => markRegister(r.request!.id, { status: "Approved" }).then(() => onToast("Refund approved. Process it from the booking's payments."))}>Approve</Button><Button size="sm" onClick={() => markRegister(r.request!.id, { status: "Rejected" }).then(() => onToast("Refund rejected."))}>Reject</Button></>}
                {canFinance && r.request && r.status === "Approved" && <Button size="sm" onClick={() => markRegister(r.request!.id, { status: "Refunded" }).then(() => onToast("Refund marked as paid."))}>Mark refunded</Button>}
                {canFinance && !r.request && r.booking && ["Pending approval", "Processing", "Failed"].includes(r.status) && <Button size="sm" onClick={() => onProcess(r.booking!)}>Update</Button>}
              </div></td></tr>
          ))}</tbody>
        </DataTable>
      )}
    </section>
  );
}

function DailyClosing({ bookings, payments, closings, canFinance, onToast }: { bookings: Booking[]; payments: PaymentTransaction[]; closings: RegisterEntry[]; canFinance: boolean; onToast: (t: string) => void }) {
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<RegisterEntry | null>(null);
  const snapshot = useMemo(() => {
    const day = (b: Booking) => dayOf(bookingPickupDate(b));
    const onDay = bookings.filter((b) => day(b) === date);
    const pays = payments.filter((p) => String(p.status).toLowerCase() === "success" && dayOf((p as PaymentTransaction & { createdAt?: unknown }).createdAt ?? p.date) === date);
    const amt = (p: PaymentTransaction) => Number(String(p.amount).replace(/[^\d.]/g, "")) || 0;
    return [
      { register: "Bookings", value: String(onDay.length), basis: "Pickup date" },
      { register: "Confirmed / active", value: String(onDay.filter((b) => ["Approved", "Confirmed", "Assigned", "Ongoing"].includes(b.status)).length), basis: "Pickup date" },
      { register: "Cancelled", value: String(onDay.filter((b) => b.status === "Cancelled").length), basis: "Pickup date" },
      { register: "Completed", value: String(onDay.filter((b) => b.status === "Completed").length), basis: "Pickup date" },
      { register: "Office cash", value: rupee(pays.filter((p) => p.method === "Cash").reduce((s, p) => s + amt(p), 0)), basis: "Receipt date" },
      { register: "Online / bank receipts", value: rupee(pays.filter((p) => p.method !== "Cash").reduce((s, p) => s + amt(p), 0)), basis: "Receipt date" },
      { register: "Pending customer collection", value: rupee(onDay.filter((b) => b.status === "Completed").reduce((s, b) => s + paymentOf(b).balanceDue, 0)), basis: "Verified trip bills only" },
      { register: "Refunds paid", value: rupee(bookings.filter((b) => b.refund?.status === "Completed" && dayOf(b.refund.processedAt) === date).reduce((s, b) => s + b.refund!.amount, 0)), basis: "Verified refund date" },
      { register: "Pending refunds", value: String(bookings.filter((b) => b.refund && ["Pending", "Processing"].includes(b.refund.status)).length), basis: "Outstanding at preparation time" },
    ];
  }, [bookings, payments, date]);
  const prepare = async () => {
    setBusy(true);
    try {
      const ref = await nextClosingRef();
      await addRegisterEntry({ kind: "closing", date, amount: 0, reference: ref, snapshot, status: "Pending verification" });
      onToast(`Daily closing ${ref} prepared.`);
    } catch { onToast("The closing was not prepared.", ); } finally { setBusy(false); }
  };
  const rows = [...closings].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className="ds-panel ds-panel-pad">
      <p className="text-[12px] text-muted mb-2">Verified registers and daily office controls.</p>
      <p className="ds-note mb-3">Prepared snapshots stay unchanged after verification. Prepare a supplementary snapshot for later entries.</p>
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="ds-field"><span>Date</span><input type="date" className="ds-input" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {canFinance && <Button variant="primary" icon="clipboard-check" loading={busy} onClick={prepare}>Prepare closing</Button>}
      </div>
      {rows.length === 0 ? <EmptyState /> : (
        <DataTable label="Daily closings" minWidth={760} hasActions hideTools>
          <thead><tr><th>DATE / REFERENCE</th><th>PREPARED BY</th><th>VERIFIED BY</th><th>STATUS</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.date}</strong><small>{r.reference}</small></td><td>{r.createdByName}<small>{refDateTime(r.createdAt)}</small></td><td>{r.status === "Verified" ? r.verifiedByName : "Pending verification"}</td><td><Badge tone={r.status === "Verified" ? "green" : "amber"}>{r.status}</Badge></td><td className="ds-actions"><div><Button size="sm" onClick={() => setView(r)}>View</Button></div></td></tr>)}</tbody>
        </DataTable>
      )}
      {view && (
        <Modal title={`Daily closing · ${view.date}`} onClose={() => setView(null)} size="lg" footer={<>
          <Button icon="sheet" onClick={() => exportRows(`Daily closing ${view.date}`, ["Register", "Count / amount", "Basis"], (view.snapshot ?? []).map((x) => [x.register, x.value, x.basis]), "xlsx")}>Excel</Button>
          <Button icon="download" onClick={() => exportRows(`Daily closing ${view.date}`, ["Register", "Count / amount", "Basis"], (view.snapshot ?? []).map((x) => [x.register, x.value, x.basis]), "csv")}>CSV</Button>
          <Button icon="printer" onClick={() => exportRows(`Daily closing ${view.date}`, ["Register", "Count / amount", "Basis"], (view.snapshot ?? []).map((x) => [x.register, x.value, x.basis]), "print")}>Print / PDF</Button>
          {canFinance && view.status !== "Verified" && <Button variant="primary" onClick={() => markRegister(view.id, { status: "Verified" }).then(() => { setView(null); onToast("Closing verified."); })}>Verify closing</Button>}
        </>}>
          <dl className="ds-facts mb-4" data-cols={3}>
            <div><dt>Reference</dt><dd>{view.reference}</dd></div>
            <div><dt>Prepared by</dt><dd>{view.createdByName} · {refDateTime(view.createdAt)}</dd></div>
            <div><dt>Verified by</dt><dd>{view.status === "Verified" ? view.verifiedByName : "Pending verification"}</dd></div>
          </dl>
          <DataTable label="Closing snapshot" minWidth={520} hideTools>
            <thead><tr><th>Register</th><th>Count / amount</th><th>Basis</th></tr></thead>
            <tbody>{(view.snapshot ?? []).map((x) => <tr key={x.register}><td>{x.register}</td><td>{x.value}</td><td>{x.basis}</td></tr>)}</tbody>
          </DataTable>
        </Modal>
      )}
    </section>
  );
}
