import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Invoice } from "../types";
import { subscribeInvoices, subscribeSettings } from "../services/adminFirestoreService";
import { companyFromSettings } from "../services/invoiceService";
import { addRegisterEntry, subscribeRegister, today, type RegisterEntry } from "../services/accountsService";
import { useBookings } from "../hooks/useOfficeData";
import { useCan } from "../components/AccessContext";
import { Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import { TaxPaymentForm } from "../components/accounts/RegisterForms";
import { exportRows, type Cell } from "../utils/exportData";
import { rupee } from "../domain/officeStage";
import { paymentOf } from "../domain/bookingFlow";
import { bookingPickupDate, isoDateIST } from "../utils/time";
import ReportsAnalytics from "./ReportsAnalytics";

type Top = "GST Reports" | "GST Payment History" | "Income Tax Reports" | "Business analytics";
type Inner = "Sales register" | "Purchases & ITC" | "GSTR working" | "Filing record";
type ItTab = "Overview" | "Revenue" | "Expenses" | "Partner payouts" | "Tax payments" | "Documents & reconciliation";

/** "2026-27" for a date in Apr 2026 – Mar 2027. */
const fyOf = (iso: string) => { const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)); const s = m >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
const monthsOf = (fy: string) => { const s = Number(fy.slice(0, 4)); return Array.from({ length: 12 }, (_, i) => { const m = ((i + 3) % 12) + 1; return `${m >= 4 ? s : s + 1}-${String(m).padStart(2, "0")}`; }); };
const QUARTERS = ["Q1 Apr–Jun", "Q2 Jul–Sep", "Q3 Oct–Dec", "Q4 Jan–Mar"] as const;

/** Master Admin Reports & GST: GST working reports, verified tax payments and Income Tax preparation. */
export default function ReportsGst({ initialTab, onNavigate }: { initialTab?: string; onNavigate: (p: string, tab?: string) => void }) {
  const [top, setTop] = useState<Top>(["GST Reports", "GST Payment History", "Income Tax Reports", "Business analytics"].includes(initialTab ?? "") ? (initialTab as Top) : "GST Reports");
  const [inner, setInner] = useState<Inner>("Sales register");
  const [it, setIt] = useState<ItTab>("Overview");
  const now = today();
  const [fy, setFy] = useState(fyOf(now));
  const [cycle, setCycle] = useState<"Monthly" | "Quarterly">("Monthly");
  const [month, setMonth] = useState(now.slice(0, 7));
  const [quarter, setQuarter] = useState<string>(QUARTERS[Math.floor(((Number(now.slice(5, 7)) + 8) % 12) / 3)]);
  const [period, setPeriod] = useState({ fy, cycle, month, quarter });
  const [form, setForm] = useState<"GSTR-1" | "GSTR-3B">("GSTR-3B");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [register, setRegister] = useState<RegisterEntry[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [sheet, setSheet] = useState<"tax" | "filing" | null>(null);
  const bookings = useBookings().rows ?? [];
  const canFinance = useCan("finance");
  const { toast, show } = useToast(6000);
  useEffect(() => { const u = [subscribeInvoices(setInvoices, () => undefined), subscribeRegister(setRegister, () => undefined), subscribeSettings((s) => setSettings(s || {}))]; return () => u.forEach((x) => x()); }, []);
  const company = companyFromSettings(settings);
  const gstinOk = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(company.gstin);
  const fys = Array.from({ length: 4 }, (_, i) => { const s = Number(fyOf(now).slice(0, 4)) - 2 + i; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; });

  // Months in the generated period.
  const periodMonths = useMemo(() => {
    const ms = monthsOf(period.fy);
    if (period.cycle === "Monthly") return [period.month];
    const q = QUARTERS.indexOf(period.quarter as (typeof QUARTERS)[number]);
    return ms.slice(q * 3, q * 3 + 3);
  }, [period]);
  const periodLabel = period.cycle === "Monthly" ? period.month : `${period.fy} ${period.quarter}`;
  const inPeriod = (iso: string) => periodMonths.some((m) => iso.startsWith(m));
  const sales = invoices.filter((i) => i.invoiceStatus === "Issued" && inPeriod(i.invoiceDate || ""));
  const purchases = register.filter((r) => (r.kind === "expense" || r.kind === "supplier_bill") && inPeriod(r.date));
  const utgstOf = (i: Invoice) => i.utgst || 0;
  const igstOf = (i: Invoice) => Number((i as Invoice & { igst?: number }).igst) || 0;
  const totals = sales.reduce((s, i) => ({ taxable: s.taxable + (i.taxableAmount || 0), cgst: s.cgst + (i.cgst || 0), sgst: s.sgst + (i.sgst || 0), utgst: s.utgst + utgstOf(i), igst: s.igst + igstOf(i) }), { taxable: 0, cgst: 0, sgst: 0, utgst: 0, igst: 0 });
  const itc = purchases.filter((r) => r.itcStatus === "Eligible").reduce((s, r) => s + (r.tax ?? 0), 0);
  const outputTax = totals.cgst + totals.sgst + totals.utgst + totals.igst;
  const gstPaid = register.filter((r) => r.kind === "tax" && r.taxType === "GST" && periodMonths.includes(r.period ?? ""));
  const discharged = gstPaid.filter((r) => r.purpose === "Liability discharged").reduce((s, r) => s + (r.liabilitySettled ?? r.amount), 0);
  const filings = register.filter((r) => r.kind === "filing" && r.period === periodLabel);
  const filed = (f: string) => filings.find((r) => r.description === f);

  const salesRows: Cell[][] = sales.map((i) => [i.invoiceNumber, i.invoiceDate, i.customerSnapshot?.name ?? "", i.customerSnapshot?.gstin ?? "", i.taxableAmount, i.cgst, i.sgst, utgstOf(i), igstOf(i), i.grandTotal]);
  const purchaseRows: Cell[][] = purchases.map((r) => [r.reference ?? "", r.date, r.payee ?? "", r.gstin ?? "", r.taxable ?? r.amount, r.tax ?? 0, r.amount, r.itcStatus ?? "Unreviewed"]);
  const workingRows: Cell[][] = [
    ["Outward taxable supplies", totals.taxable], ["Output CGST", totals.cgst], ["Output SGST", totals.sgst], ["Output UTGST", totals.utgst], ["Output IGST", totals.igst],
    ["Eligible ITC (reviewed)", itc], ["Net tax payable", Math.max(0, outputTax - itc)], ["Liability discharged (recorded)", discharged],
  ];
  const exportGst = (fmt: "xlsx" | "csv" | "print") => {
    if (inner === "Purchases & ITC") return exportRows(`Purchases ITC ${periodLabel}`, ["Document", "Date", "Supplier", "GSTIN", "Taxable", "Tax", "Total", "ITC review"], purchaseRows, fmt);
    if (inner === "GSTR working") return exportRows(`${form} working ${periodLabel}`, ["Line", "Amount"], workingRows, fmt);
    exportRows(`Sales register ${periodLabel}`, ["Document", "Date", "Customer", "GSTIN", "Taxable", "CGST", "SGST", "UTGST", "IGST", "Total"], salesRows, fmt);
  };

  // Income Tax (financial year)
  const fyInvoices = invoices.filter((i) => i.invoiceStatus === "Issued" && fyOf(i.invoiceDate || "1900-01-01") === period.fy);
  const fyExpenses = register.filter((r) => (r.kind === "expense" || r.kind === "supplier_bill") && fyOf(r.date) === period.fy);
  const fyPayouts = bookings.filter((b) => b.status === "Completed" && fyOf(isoDateIST(bookingPickupDate(b) ?? new Date())) === period.fy);
  const fyTax = register.filter((r) => r.kind === "tax" && fyOf(r.date) === period.fy);
  const docs = register.filter((r) => r.fileName && fyOf(r.date) === period.fy);
  const payoutOf = (b: (typeof bookings)[number]) => (typeof b.finance?.partnerPayout === "number" ? b.finance.partnerPayout : Number(b.vendorPayout || b.driverPayout) || 0);
  const itSpec: Record<Exclude<ItTab, "Overview" | "Documents & reconciliation">, { headers: string[]; rows: Cell[][] }> = {
    Revenue: { headers: ["Invoice", "Date", "Customer", "Taxable", "Tax", "Total"], rows: fyInvoices.map((i) => [i.invoiceNumber, i.invoiceDate, i.customerSnapshot?.name ?? "", i.taxableAmount, i.totalTax, i.grandTotal]) },
    Expenses: { headers: ["Date", "Payee", "Category", "Bill reference", "Taxable", "Tax recorded", "Total", "ITC review"], rows: fyExpenses.map((r) => [r.date, r.payee ?? "", r.category ?? "", r.reference ?? "", r.taxable ?? r.amount, r.tax ?? 0, r.amount, r.itcStatus ?? ""]) },
    "Partner payouts": { headers: ["Booking", "Bill date", "Partner ID", "Partner", "Agreed payout", "Driver collected", "NESAM advance"], rows: fyPayouts.map((b) => [b.bookingId || b.id, isoDateIST(bookingPickupDate(b) ?? new Date()), (b.assignedVendorId || b.assignedDriverId || "").slice(0, 12), b.assignedVendorName || b.assignedDriverName || "", payoutOf(b), paymentOf(b).partnerCashHeld, paymentOf(b).advancePaid]) },
    "Tax payments": { headers: ["Tax / period", "Payment date", "Amount", "Liability settled", "Reference"], rows: fyTax.map((r) => [`${r.taxType} ${r.period}`, r.date, r.amount, r.liabilitySettled ?? 0, r.reference ?? ""]) },
  };
  const exportIt = (fmt: "xlsx" | "csv" | "print") => {
    const t = it === "Overview" || it === "Documents & reconciliation" ? "Revenue" : it;
    exportRows(`Income Tax ${t} FY ${period.fy}`, itSpec[t].headers, itSpec[t].rows, fmt);
  };
  const caPack = () => {
    for (const k of Object.keys(itSpec) as (keyof typeof itSpec)[]) exportRows(`CA pack ${k} FY ${period.fy}`, itSpec[k].headers, itSpec[k].rows, "xlsx");
    show("CA pack downloaded: revenue, expenses, partner payouts and tax payments workbooks.");
  };

  const filters = (
    <>
      <div className="ds-filterbar">
        <label className="ds-field" style={{ minWidth: 240 }}><span>Company</span><select className="ds-select"><option>{company.name || "Company not configured"}</option></select></label>
        <label className="ds-field"><span>GSTIN</span><input className="ds-input" readOnly value={company.gstin || "Not configured"} /></label>
        <label className="ds-field"><span>Financial year</span><select className="ds-select" value={fy} onChange={(e) => { setFy(e.target.value); setMonth(monthsOf(e.target.value)[0]); }}>{fys.map((f) => <option key={f}>{f}</option>)}</select></label>
        {top === "GST Reports" && <label className="ds-field"><span>Filing cycle</span><select className="ds-select" value={cycle} onChange={(e) => setCycle(e.target.value as typeof cycle)}><option>Monthly</option><option>Quarterly</option></select></label>}
        {top === "GST Reports" && (cycle === "Monthly"
          ? <label className="ds-field"><span>Month</span><select className="ds-select" value={month} onChange={(e) => setMonth(e.target.value)}>{monthsOf(fy).map((m) => <option key={m}>{m}</option>)}</select></label>
          : <label className="ds-field"><span>Quarter</span><select className="ds-select" value={quarter} onChange={(e) => setQuarter(e.target.value)}>{QUARTERS.map((q) => <option key={q}>{q}</option>)}</select></label>)}
        <Button variant="primary" icon="filter" onClick={() => setPeriod({ fy, cycle, month, quarter })}>Generate report</Button>
      </div>
      <p className="ds-note mb-4"><Icon name="info" size={14} /> Preparation reports · Filing and tax payment are completed externally. Uploaded receipts and acknowledgements record the outcome.</p>
    </>
  );
  const exportBtns = (fn: (f: "xlsx" | "csv" | "print") => void) => <><Button icon="sheet" onClick={() => fn("xlsx")}>Excel</Button><Button icon="download" onClick={() => fn("csv")}>CSV</Button><Button variant="ghost" icon="printer" onClick={() => fn("print")}>Print / Save PDF</Button></>;
  const table = (headers: string[], rows: Cell[][], numericFrom = 99) => rows.length === 0 ? <EmptyState /> : (
    <DataTable label="Report" minWidth={Math.max(720, headers.length * 120)}>
      <thead><tr>{headers.map((h, i) => <th key={h} className={i >= numericFrom ? "ds-num" : undefined}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j >= numericFrom ? "ds-num" : undefined}>{typeof c === "number" ? rupee(c) : c}</td>)}</tr>)}</tbody>
    </DataTable>
  );

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader title="Reports & GST" subtitle="GST working reports, verified tax payments and annual Income Tax preparation." />
      <StageBar label="Reports" tabs={(["GST Reports", "GST Payment History", "Income Tax Reports", "Business analytics"] as const).map((t) => ({ id: t, label: t }))} value={top} onChange={setTop} />
      {top === "Business analytics" ? <ReportsAnalytics /> : filters}

      {top === "GST Reports" && (
        <section className="ds-panel ds-panel-pad">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div><h2 className="text-[18px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>GST Reports</h2><p className="text-[12px] text-muted">{periodLabel} · {gstinOk ? company.gstin : "GSTIN setup pending"}</p></div>
            <div className="flex gap-2">{exportBtns(exportGst)}</div>
          </div>
          <div className="ds-gst-cards">
            {(["GSTR-1", "GSTR-3B"] as const).map((f) => <div key={f}><strong>{f}</strong> <Badge tone={filed(f) ? "green" : "amber"}>{filed(f) ? "Filed" : "Pending"}</Badge><small>{filed(f) ? `ARN ${filed(f)!.reference} · ${filed(f)!.date}` : "Acknowledgement pending"}</small></div>)}
            <div><strong>Tax payment</strong> <Badge tone={discharged >= Math.max(0, outputTax - itc) && outputTax > 0 ? "green" : "amber"}>{discharged >= Math.max(0, outputTax - itc) && outputTax > 0 ? "Paid" : "Review required"}</Badge><small>{discharged ? `${rupee(discharged)} liability discharged` : "Liability review required"}</small></div>
          </div>
          <div className="flex items-end gap-3 my-4"><label className="ds-field"><span>Return form</span><select className="ds-select" value={form} onChange={(e) => setForm(e.target.value as typeof form)}><option>GSTR-1</option><option>GSTR-3B</option></select></label><span className="text-[11px] text-muted pb-2">Current working copy</span></div>
          <div className="ds-kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {([["Taxable value", totals.taxable], ["CGST", totals.cgst], ["SGST", totals.sgst], ["UTGST", totals.utgst], ["IGST", totals.igst]] as const).map(([k, v]) => <div key={k} className="ds-kpi"><span className="ds-kpi-label">{k}</span><span className="ds-kpi-value">{rupee(v)}</span></div>)}
          </div>
          <StageBar label="GST report" tabs={(["Sales register", "Purchases & ITC", "GSTR working", "Filing record"] as const).map((t) => ({ id: t, label: t }))} value={inner} onChange={setInner} />
          {inner === "Sales register" && table(["Document", "Date", "Customer", "GSTIN", "Taxable", "CGST", "SGST", "UTGST", "IGST", "Total"], salesRows, 4)}
          {inner === "Purchases & ITC" && table(["Document", "Date", "Supplier", "GSTIN", "Taxable", "Tax", "Total", "ITC review"], purchaseRows.map((r) => [...r.slice(0, 7), String(r[7])]), 4)}
          {inner === "GSTR working" && (
            <>
              {table(["Line", "Amount"], workingRows, 1)}
              <p className="text-[11px] text-faint mt-3">Working copy for {form}. ITC counts only bills reviewed as Eligible in Accounts → Expenses &amp; bills.</p>
            </>
          )}
          {inner === "Filing record" && (
            <>
              <div className="flex justify-end mb-3">{canFinance && <Button icon="upload" onClick={() => setSheet("filing")}>Record filing acknowledgement</Button>}</div>
              {filings.length === 0 ? <EmptyState /> : table(["Return", "Period", "Filed on", "ARN / acknowledgement", "Recorded by"], filings.map((r) => [r.description ?? "", r.period ?? "", r.date, r.reference ?? "", r.createdByName ?? ""]))}
            </>
          )}
        </section>
      )}

      {top === "GST Payment History" && (
        <section className="ds-panel ds-panel-pad">
          <div className="flex flex-wrap justify-end gap-2 mb-3">{canFinance && <Button icon="plus" onClick={() => setSheet("tax")}>Record tax payment</Button>}<Button icon="wallet-cards" onClick={() => onNavigate("accounts", "Tax payments")}>Open Accounts register</Button></div>
          <p className="ds-note mb-3">Rows are included by selected tax period or payment date. The period column identifies what the payment relates to. Quarterly filers can still record monthly tax deposits.</p>
          {(() => {
            const rows = register.filter((r) => r.kind === "tax" && r.taxType === "GST" && (fyOf(r.date) === period.fy || monthsOf(period.fy).includes(r.period ?? ""))).sort((a, b) => b.date.localeCompare(a.date));
            return rows.length === 0 ? <EmptyState /> : (
              <DataTable label="GST payment history" minWidth={760} hideTools>
                <thead><tr><th>TAX / PERIOD</th><th>PAYMENT DATE</th><th className="ds-num">AMOUNT</th><th className="ds-num">LIABILITY SETTLED</th><th>REFERENCE / STATUS</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.taxType}</strong><small>{r.period} · {r.purpose}</small></td><td>{r.date}</td><td className="ds-num">{rupee(r.amount)}</td><td className="ds-num">{rupee(r.liabilitySettled ?? 0)}</td><td>{r.reference}<div><Badge tone="green">{r.status || "Verified"}</Badge></div></td></tr>)}</tbody>
              </DataTable>
            );
          })()}
        </section>
      )}

      {top === "Income Tax Reports" && (
        <section className="ds-panel ds-panel-pad">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div><h2 className="text-[18px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>Income Tax Reports</h2><p className="text-[12px] text-muted">FY {period.fy} · {gstinOk ? company.gstin : "GSTIN setup pending"}</p></div>
            <div className="flex flex-wrap gap-2">{exportBtns(exportIt)}<Button variant="primary" icon="package" onClick={caPack}>Download CA Pack</Button></div>
          </div>
          <StageBar label="Income tax" tabs={(["Overview", "Revenue", "Expenses", "Partner payouts", "Tax payments", "Documents & reconciliation"] as const).map((t) => ({ id: t, label: t }))} value={it} onChange={setIt} />
          {it === "Overview" && (
            <>
              <div className="ds-kpi-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                <div className="ds-kpi"><span className="ds-kpi-label">Issued invoice value · ex GST</span><span className="ds-kpi-value">{rupee(fyInvoices.reduce((s, i) => s + (i.taxableAmount || 0), 0))}</span><span className="ds-kpi-note">Before accountant revenue classification</span></div>
                <div className="ds-kpi"><span className="ds-kpi-label">Recorded expenses · ex GST</span><span className="ds-kpi-value">{rupee(fyExpenses.reduce((s, r) => s + (r.taxable ?? r.amount), 0))}</span><span className="ds-kpi-note">Recorded bills only</span></div>
                <div className="ds-kpi"><span className="ds-kpi-label">Partner payout working</span><span className="ds-kpi-value">{rupee(fyPayouts.reduce((s, b) => s + payoutOf(b), 0))}</span><span className="ds-kpi-note">Classification by accountant</span></div>
                <div className="ds-kpi"><span className="ds-kpi-label">Supporting documents</span><span className="ds-kpi-value">{docs.length}</span><span className="ds-kpi-note">Financial year specific</span></div>
              </div>
              <p className="ds-note mb-4">Profit, taxable income, Trial Balance and Balance Sheet are not calculated from bookings alone. Full accounting entries / reconciled statements are required.</p>
              <h3 className="text-[14px] font-bold text-ink mb-2">CA preparation checklist</h3>
              <CaChecklist register={register} fy={period.fy} />
            </>
          )}
          {it !== "Overview" && it !== "Documents & reconciliation" && table(itSpec[it].headers, itSpec[it].rows, it === "Revenue" ? 3 : it === "Expenses" ? 4 : it === "Partner payouts" ? 4 : 2)}
          {it === "Documents & reconciliation" && (
            <>
              <CaChecklist register={register} fy={period.fy} />
              <h3 className="text-[14px] font-bold text-ink mt-5 mb-2">Supporting documents</h3>
              {docs.length === 0 ? <EmptyState title="No documents uploaded for this year" /> : table(["Date", "Register", "Reference", "File"], docs.map((r) => [r.date, r.kind.replace(/_/g, " "), r.reference ?? "", r.fileName ?? ""]))}
            </>
          )}
        </section>
      )}

      {sheet === "tax" && <TaxPaymentForm onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
      {sheet === "filing" && <FilingForm period={periodLabel} onClose={() => setSheet(null)} onDone={(t) => { setSheet(null); show(t); }} />}
    </div>
  );
}

const CHECKLIST = ["Trial Balance", "Profit & Loss", "Balance Sheet", "Bank reconciliation", "AIS / tax credits", "TDS reconciliation"] as const;

function CaChecklist({ register, fy }: { register: RegisterEntry[]; fy: string }) {
  const closings = register.filter((r) => r.kind === "closing" && fyOf(r.date) === fy && r.status === "Verified").length;
  const recon = register.filter((r) => r.kind === "recon" && fyOf(r.date) === fy);
  const status = (d: (typeof CHECKLIST)[number]) => {
    if (d === "Bank reconciliation") return recon.length ? `${recon.filter((r) => r.matchStatus === "Matched").length} / ${recon.length} entries matched` : "Required from accounts";
    if (d === "TDS reconciliation") return register.some((r) => r.kind === "tax" && r.taxType === "TDS" && fyOf(r.date) === fy) ? "TDS payments recorded" : "Required from accounts";
    return closings && d === "Trial Balance" ? `${closings} verified daily closings · statements required` : "Required from accounts";
  };
  return (
    <DataTable label="CA preparation checklist" minWidth={520} hideTools>
      <thead><tr><th>DOCUMENT / RECONCILIATION</th><th>STATUS</th></tr></thead>
      <tbody>{CHECKLIST.map((d) => <tr key={d}><td>{d}</td><td><Badge tone={/Required/.test(status(d)) ? "amber" : "green"}>{status(d)}</Badge></td></tr>)}</tbody>
    </DataTable>
  );
}

function FilingForm({ period, onClose, onDone }: { period: string; onClose: () => void; onDone: (t: string) => void }) {
  const [form, setForm] = useState("GSTR-1");
  const [date, setDate] = useState(today());
  const [arn, setArn] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (arn.trim().length < 6) return setError("Enter the ARN / acknowledgement number.");
    setBusy(true);
    try { await addRegisterEntry({ kind: "filing", date, amount: 0, period, description: form, reference: arn.trim(), status: "Filed" }, file); onDone(`${form} acknowledgement recorded.`); }
    catch (err) { setError(err instanceof Error ? err.message : "The filing record was not saved."); setBusy(false); }
  };
  return (
    <Modal title="Record filing acknowledgement" onClose={onClose} busy={busy} footNote="Filing is completed on the GST portal" footer={<Button variant="primary" type="submit" form="filing-form" loading={busy}>Save filing record</Button>}>
      <form id="filing-form" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <p className="ds-note">Period {period}</p>
        <label className="ds-field"><span>Return form</span><select className="ds-select" value={form} onChange={(e) => setForm(e.target.value)}><option>GSTR-1</option><option>GSTR-3B</option></select></label>
        <label className="ds-field"><span>Filed on</span><input className="ds-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="ds-field"><span>ARN / acknowledgement number</span><input className="ds-input" value={arn} onChange={(e) => setArn(e.target.value.toUpperCase())} /></label>
        <label className="ds-field"><span>Upload acknowledgement · optional</span><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      </form>
    </Modal>
  );
}
