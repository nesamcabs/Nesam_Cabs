import { useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import type { Booking, Invoice } from "../types";
import { subscribeBookings, subscribeInvoices, subscribeSettings, subscribeToDocument } from "../services/adminFirestoreService";
import {
  InvoiceActionError,
  amountInWords,
  buildInvoiceLines,
  companyFromSettings,
  companyProblems,
  createInvoice,
  invoiceBlocker,
  livePaymentStatus,
  voidInvoice,
  type BillingDetails,
} from "../services/invoiceService";
import { auth, db } from "../services/firebase";
import { ConfirmDialog, ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { useCan } from "../components/AccessContext";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader } from "../components/ui";
import MenuButton from "../components/ui/MenuButton";
import { GST_STATES, stateOfGstin, gstSplit } from "../domain/gstStates";

function formatCurrency(n: number): string {
  return "₹" + (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const actionError = (e: unknown) =>
  e instanceof InvoiceActionError ? e.message : "Something went wrong. Please try again.";

const invoiceTime = (inv: Invoice) => new Date(inv.invoiceDate || 0).getTime() || 0;

const SERVICES = ["One Way", "Round Trip", "Airport", "Multicity", "Local Rental", "Local Pickup & Drop"] as const;
interface TaxPolicyEntry {
  services: Record<string, { classification: "Passenger transportation" | "Vehicle rental"; sac: string }>;
  approved: boolean;
  reference: string;
  approvedByName?: string;
}
export interface TaxPolicy extends TaxPolicyEntry {
  stateOverrides?: Record<string, TaxPolicyEntry>;
}
const DEFAULT_POLICY: TaxPolicy = {
  services: Object.fromEntries(SERVICES.map((s) => [s, { classification: s === "Local Rental" ? "Vehicle rental" : "Passenger transportation", sac: s === "Local Rental" ? "996601" : "996412" }])),
  approved: false,
  reference: "",
};
const policyEntry = (entry: TaxPolicyEntry): TaxPolicyEntry => ({ services: { ...DEFAULT_POLICY.services, ...entry.services }, approved: entry.approved === true, reference: entry.reference || "", approvedByName: entry.approvedByName || "" });
const effectiveTaxPolicy = (policy: TaxPolicy, state: string) => policyEntry(policy.stateOverrides?.[state] ?? policy);

interface Draft extends BillingDetails {
  id: string;
  bookingId: string;
  documentType: string;
  recipientState: string;
  boardingState: string;
  createdBy: string;
  updatedAt?: unknown;
}

/** Payment words used in the reference list. */
const paymentWord = (p: string) => (p === "Paid" ? "Paid" : p === "Partially Paid" ? "Part paid" : "Due");

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [policy, setPolicy] = useState<TaxPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [docStatus, setDocStatus] = useState("All");
  const [payStatus, setPayStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [create, setCreate] = useState<Draft | "new" | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const canFinance = useCan("finance");
  const { toast, show } = useToast();

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    const fail = (m: string) => { setLoadError(m); setLoading(false); };
    const unsubs = [
      subscribeInvoices((data) => { setInvoices(data); setLoading(false); }, fail),
      subscribeBookings(setBookings, fail),
      subscribeSettings((data) => setSettings(data || {})),
      subscribeToDocument<TaxPolicy>("settings/tax_policy", (p) => setPolicy(p ? { ...DEFAULT_POLICY, ...p, services: { ...DEFAULT_POLICY.services, ...(p.services ?? {}) } } : DEFAULT_POLICY), () => undefined),
      onSnapshot(collection(db, "invoice_drafts"), (s) => setDrafts(s.docs.map((d) => ({ ...(d.data() as Omit<Draft, "id">), id: d.id }))), () => setDrafts([])),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const company = useMemo(() => companyFromSettings(settings), [settings]);
  const missingCompany = companyProblems(company);
  const paymentByInvoice = useMemo(() => {
    const byId = new Map(bookings.map((b) => [b.id, b]));
    const byCode = new Map(bookings.map((b) => [b.bookingId || b.id, b]));
    return new Map(invoices.map((inv) => [inv.id, livePaymentStatus(inv, byId.get(inv.bookingDocumentId || "") ?? byId.get(inv.bookingId) ?? byCode.get(inv.bookingId))]));
  }, [invoices, bookings]);
  const paymentOf = (inv: Invoice) => paymentByInvoice.get(inv.id) ?? inv.paymentStatus;

  type Row = { key: string; number: string; date: string; billTo: string; booking: string; document: "Draft" | "Issued" | "Voided"; payment: string; total: number; balance: number; inv?: Invoice; draft?: Draft };
  const rows = useMemo<Row[]>(() => {
    const q = search.trim().toLowerCase();
    const issued: Row[] = invoices.map((inv) => {
      const pay = paymentOf(inv);
      return { key: inv.id, number: inv.invoiceNumber, date: inv.invoiceDate, billTo: inv.customerSnapshot?.name || "—", booking: inv.bookingId, document: inv.invoiceStatus === "Cancelled" ? "Voided" : "Issued", payment: paymentWord(pay), total: inv.grandTotal, balance: pay === "Paid" ? 0 : inv.balanceAmount ?? inv.grandTotal, inv };
    });
    const draftRows: Row[] = drafts.map((d) => {
      const b = bookings.find((x) => x.id === d.bookingId);
      const lines = b ? buildInvoiceLines(b) : null;
      return { key: d.id, number: "Draft", date: "", billTo: d.name || b?.customer || "—", booking: b?.bookingId || d.bookingId, document: "Draft", payment: b && (b.payment === "Paid" || b.paymentStatus === "Paid") ? "Paid" : "Due", total: lines?.grandTotal ?? 0, balance: lines?.grandTotal ?? 0, draft: d };
    });
    return [...draftRows, ...issued]
      .filter((r) => docStatus === "All" || r.document === docStatus)
      .filter((r) => payStatus === "All" || r.payment === payStatus)
      .filter((r) => !q || [r.number, r.booking, r.billTo].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (a.document === "Draft" ? -1 : b.document === "Draft" ? 1 : (invoiceTime(b.inv!) - invoiceTime(a.inv!)) || b.number.localeCompare(a.number)));
  }, [invoices, drafts, bookings, docStatus, payStatus, search, paymentByInvoice]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmVoid = async () => {
    if (!voidTarget || voiding) return;
    setVoiding(true);
    setVoidError(null);
    try {
      await voidInvoice(voidTarget, voidReason, auth.currentUser?.uid || "");
      show(`Invoice ${voidTarget.invoiceNumber} voided. The trip can be invoiced again.`);
      setVoidTarget(null);
    } catch (e) {
      setVoidError(actionError(e));
    } finally {
      setVoiding(false);
    }
  };

  return (
    <div className="ds-page-body">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #printable-invoice, #printable-invoice * { visibility: visible; }
          #printable-invoice { position: absolute; left: 0; top: 0; width: 100%; max-height: none !important; overflow: visible !important; background: white; color: black; padding: 20px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}
      {missingCompany.length > 0 && <p className="ds-note mb-3">Invoices cannot be issued until Settings → Company has {missingCompany.join(", ")}.</p>}
      <PageHeader title="Invoices" subtitle="Document lifecycle and collection status are tracked separately." actions={canFinance ? <><Button variant="primary" icon="plus" onClick={() => setCreate("new")}>Create invoice</Button><Button icon="settings-2" onClick={() => setShowPolicy(true)}>Tax automation</Button></> : undefined} />
      <div className="ds-filterbar">
        <div className="ds-search" style={{ flex: "1 1 280px" }}><Icon name="search" /><input className="ds-input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice, booking or customer" aria-label="Search invoices" /></div>
        <label className="ds-field"><span>Document status</span><select className="ds-select" value={docStatus} onChange={(e) => setDocStatus(e.target.value)}>{["All", "Draft", "Issued", "Voided"].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="ds-field"><span>Payment status</span><select className="ds-select" value={payStatus} onChange={(e) => setPayStatus(e.target.value)}>{["All", "Paid", "Part paid", "Due"].map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      {loading ? <p className="text-[12px] text-muted">Loading invoices…</p> : rows.length === 0 ? (
        <div className="ds-panel"><EmptyState title="No invoices in this view" hint="Create an invoice from a completed trip or change the filters." /></div>
      ) : (
        <DataTable label="Invoices" minWidth={980} fixed hasActions>
          <colgroup><col style={{ width: 190 }} /><col style={{ width: 220 }} /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 160 }} /><col style={{ width: 190 }} /></colgroup>
          <thead><tr><th>INVOICE / DATE</th><th>BILL TO / BOOKING</th><th>DOCUMENT</th><th>PAYMENT</th><th className="ds-num">TOTAL / BALANCE</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.key} className={r.document === "Voided" ? "opacity-60" : undefined}>
              <td><strong>{r.number}</strong><small>{r.date || "Not issued"}</small></td>
              <td><strong>{r.billTo}</strong><small>{r.booking}</small></td>
              <td><Badge tone={r.document === "Issued" ? "blue" : r.document === "Draft" ? "amber" : "neutral"}>{r.document}</Badge></td>
              <td><Badge tone={r.payment === "Paid" ? "green" : r.payment === "Part paid" ? "amber" : "red"}>{r.payment}</Badge></td>
              <td className="ds-num"><strong>{formatCurrency(r.total)}</strong><small>Balance {formatCurrency(r.balance)}</small></td>
              <td className="ds-actions"><div>
                {r.inv && <Button size="sm" onClick={() => setSelectedInvoice(r.inv!)}>View / Print</Button>}
                {r.draft && canFinance && <Button size="sm" variant="primary" onClick={() => setCreate(r.draft!)}>Continue draft</Button>}
                {r.inv && r.document === "Issued" && canFinance && <MenuButton iconOnly label={`More for ${r.number}`} items={[{ label: "Void invoice", icon: "ban", danger: true, onSelect: () => { setVoidReason(""); setVoidError(null); setVoidTarget(r.inv!); } }]} />}
                {r.draft && canFinance && <MenuButton iconOnly label="More for draft" items={[{ label: "Discard draft", icon: "trash-2", danger: true, onSelect: () => deleteDoc(doc(db, "invoice_drafts", r.draft!.id)).then(() => show("Draft discarded.")) }]} />}
              </div></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}

      {create && (
        <CreateInvoiceModal
          bookings={bookings}
          invoices={invoices}
          draft={create === "new" ? null : create}
          companyReady={missingCompany.length === 0}
          company={company}
          policy={policy}
          onClose={() => setCreate(null)}
          onDone={(text) => { setCreate(null); show(text); }}
        />
      )}
      {showPolicy && <TaxPolicyDialog policy={policy} onClose={() => setShowPolicy(false)} onSaved={() => { setShowPolicy(false); show("Approved tax policy saved."); }} />}
      {voidTarget && (
        <ConfirmDialog
          title={`Void invoice ${voidTarget.invoiceNumber}?`}
          message={
            <div className="space-y-2">
              <p>Voided invoices are kept for tax records and cannot be reissued under the same number. The trip can then be invoiced again.</p>
              <label className="ds-field"><span>Reason *</span><textarea rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={300} className="ds-input" /></label>
            </div>
          }
          confirmLabel="Void Invoice"
          danger
          busy={voiding}
          error={voidError}
          onConfirm={confirmVoid}
          onCancel={() => setVoidTarget(null)}
        />
      )}
      {selectedInvoice && <InvoicePreview invoice={selectedInvoice} payment={paymentOf(selectedInvoice)} onClose={() => setSelectedInvoice(null)} />}
    </div>
  );
}

function CreateInvoiceModal({ bookings, invoices, draft, companyReady, company, policy, onClose, onDone }: {
  bookings: Booking[];
  invoices: Invoice[];
  draft: Draft | null;
  companyReady: boolean;
  company: ReturnType<typeof companyFromSettings>;
  policy: TaxPolicy;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [bookingId, setBookingId] = useState(draft?.bookingId ?? "");
  const [docType, setDocType] = useState(draft?.documentType ?? "Tax invoice");
  const [billing, setBilling] = useState<BillingDetails>({ name: draft?.name ?? "", gstin: draft?.gstin ?? "", address: draft?.address ?? "", email: draft?.email ?? "" });
  const [recipientState, setRecipientState] = useState(draft?.recipientState ?? "");
  const [boardingState, setBoardingState] = useState(draft?.boardingState ?? "");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState<"draft" | "issue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eligible = useMemo(() => bookings.filter((b) => !invoiceBlocker(b, invoices)).sort((a, b) => String(b.bookingId || b.id).localeCompare(String(a.bookingId || a.id))), [bookings, invoices]);
  const booking = eligible.find((b) => b.id === bookingId) || bookings.find((b) => b.id === bookingId) || null;
  const lines = booking ? buildInvoiceLines(booking) : null;
  const serviceName = (booking?.service || "").trim().toLowerCase();
  const svc = SERVICES.find(service => service.toLowerCase() === serviceName)
    ?? (serviceName === "airport taxi" ? "Airport" : serviceName === "one way drop" ? "One Way" : undefined);
  const supplierState = stateOfGstin(company.gstin) ?? "";
  const effectivePolicy = effectiveTaxPolicy(policy, supplierState);
  const rule = svc ? effectivePolicy.services[svc] : undefined;
  const registered = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(billing.gstin.trim().toUpperCase());
  const recipientCode = registered ? stateOfGstin(billing.gstin) ?? recipientState : recipientState;
  // Passenger transport (IGST Act 12(9)): registered recipient's state, else where the passenger boards.
  const placeOfSupply = rule?.classification === "Vehicle rental" ? recipientCode || supplierState : registered ? recipientCode : boardingState;
  const taxSplit = gstSplit(supplierState, placeOfSupply);
  const name = (code: string) => GST_STATES.find(([c]) => c === code)?.[1] ?? "Not determined";
  const problems = [
    !effectivePolicy.approved && "Approve the applicable state / common service classification and SAC in Tax automation.",
    (!rule || !/^\d{6,8}$/.test(rule.sac)) && "Review the approved service SAC in Tax automation.",
    !company.gstin && "Review the supplier GSTIN, registered state and billing address.",
    !placeOfSupply && "Select the recipient / boarding state to determine the place of supply.",
    booking && booking.status !== "Completed" && "Issue is enabled only after the final trip bill is ready.",
  ].filter(Boolean) as string[];

  const saveDraft = async () => {
    if (!booking) return setError("Choose the completed booking.");
    setBusy("draft");
    try {
      await setDoc(doc(db, "invoice_drafts", draft?.id ?? `draft-${booking.id}`), { bookingId: booking.id, documentType: docType, ...billing, recipientState, boardingState, createdBy: auth.currentUser?.uid ?? "", updatedAt: serverTimestamp() });
      onDone("Invoice draft saved.");
    } catch {
      setError("The draft was not saved.");
      setBusy(null);
    }
  };
  const issue = async () => {
    if (!booking) return setError("Choose the completed booking.");
    if (problems.length) return setError(problems[0]);
    if (!verified) return setError("Confirm the office verified the customer / supplier locations and tax determination.");
    setBusy("issue");
    setError(null);
    try {
      const { invoiceNumber } = await createInvoice({ booking, company, billing, actorId: auth.currentUser?.uid || "", extra: { documentType: docType, recipientState: name(recipientCode), boardingState: name(boardingState), placeOfSupply: name(placeOfSupply), taxSplit, sac: rule?.sac, classification: rule?.classification, taxPolicyState: policy.stateOverrides?.[supplierState] ? supplierState : "common", taxPolicyReference: effectivePolicy.reference } });
      if (draft) await deleteDoc(doc(db, "invoice_drafts", draft.id)).catch(() => undefined);
      onDone(`${docType} ${invoiceNumber} issued.`);
    } catch (e) {
      setError(actionError(e));
      setBusy(null);
    }
  };
  const stateSelect = (value: string, set: (v: string) => void, placeholder: string) => (
    <select className="ds-select" value={value} onChange={(e) => set(e.target.value)}><option value="">{placeholder}</option>{GST_STATES.map(([c, n]) => <option key={c} value={c}>{n} ({c})</option>)}</select>
  );

  return (
    <Modal title="Create invoice" onClose={onClose} busy={!!busy} size="lg" footNote="Document status and payment status are tracked separately." footer={<><Button onClick={saveDraft} loading={busy === "draft"} disabled={!!busy}>Save draft</Button><Button variant="primary" onClick={issue} loading={busy === "issue"} disabled={!!busy || !companyReady}>Issue invoice</Button></>}>
      <div className="ds-form-grid">
        {error && <div className="ds-error" role="alert" data-span="2"><Icon name="circle-alert" />{error}</div>}
        <label className="ds-field" data-span="2"><span>Completed booking</span>
          <select className="ds-select" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
            <option value="">{eligible.length ? "Choose a completed trip without an invoice" : "No completed trips are waiting for an invoice"}</option>
            {eligible.map((b) => <option key={b.id} value={b.id}>{b.bookingId || b.id} · {b.pickup} → {b.drop}</option>)}
          </select>
        </label>
        <label className="ds-field"><span>Document type</span><select className="ds-select" value={docType} onChange={(e) => setDocType(e.target.value)}><option>Tax invoice</option><option>Bill</option><option>Pro forma</option></select></label>
        <label className="ds-field"><span>Bill to · Customer / Company</span><input className="ds-input" value={billing.name} placeholder={booking?.customer} onChange={(e) => setBilling({ ...billing, name: e.target.value })} /></label>
        <label className="ds-field"><span>Customer GSTIN · If registered</span><input className="ds-input" maxLength={15} value={billing.gstin} onChange={(e) => setBilling({ ...billing, gstin: e.target.value.toUpperCase() })} /></label>
        <label className="ds-field"><span>Billing email</span><input className="ds-input" value={billing.email} onChange={(e) => setBilling({ ...billing, email: e.target.value })} /></label>
        <label className="ds-field" data-span="2"><span>Billing address</span><input className="ds-input" value={billing.address} onChange={(e) => setBilling({ ...billing, address: e.target.value })} /></label>
        <label className="ds-field"><span>Recipient state · Address on record</span>{stateSelect(recipientState, setRecipientState, "Select state")}</label>
        <label className="ds-field"><span>Outward boarding state</span>{stateSelect(boardingState, setBoardingState, "Verify boarding state")}</label>
        <section className="ds-panel ds-panel-pad" data-span="2">
          <div className="flex items-center justify-between mb-2"><strong className="text-[13px] text-ink">Automatic tax determination</strong><Badge tone={problems.length ? "amber" : "green"}>{problems.length ? "Review required" : "Ready"}</Badge></div>
          <dl className="ds-facts" data-cols={3}>
            <div><dt>Classification / SAC</dt><dd>{rule?.classification ?? "—"} · {effectivePolicy.approved ? rule?.sac : "Pending approval"}</dd></div>
            <div><dt>Policy scope</dt><dd>{policy.stateOverrides?.[supplierState] ? name(supplierState) : "Common default"} · {effectivePolicy.reference || "No review reference"}</dd></div>
            <div><dt>Supplier state</dt><dd>{supplierState ? `${name(supplierState)} (${supplierState})` : "Not determined"}</dd></div>
            <div><dt>Recipient GST status</dt><dd>{registered ? "Registered" : "Unregistered"}</dd></div>
            <div><dt>Place of supply</dt><dd>{placeOfSupply ? `${name(placeOfSupply)} (${placeOfSupply})` : "Not determined"}</dd></div>
            <div><dt>Tax split</dt><dd>{taxSplit}</dd></div>
            <div><dt>Saved fare / GST</dt><dd>{lines ? `${formatCurrency(lines.taxableAmount)} / ${formatCurrency(lines.totalTax)}` : "—"}</dd></div>
          </dl>
          {problems.length > 0 && <ul className="text-[11px] text-warn mt-3 list-disc ml-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </section>
        {booking && lines && <p className="text-[11px] text-muted" data-span="2">Invoice total {formatCurrency(lines.grandTotal)} · {amountInWords(lines.grandTotal)}</p>}
        <label className="ds-check" data-span="2"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />Office verified the customer / supplier locations and tax determination</label>
        <p className="text-[11px] text-faint" data-span="2">Save a draft while details are being checked. Issue is enabled only after the final trip bill and approved tax determination are ready.</p>
      </div>
    </Modal>
  );
}

export function TaxPolicyDialog({ policy, onClose, onSaved }: { policy: TaxPolicy; onClose: () => void; onSaved: () => void }) {
  const canFinance = useCan("finance");
  const canSystem = useCan("system");
  const [scope, setScope] = useState("");
  const [p, setP] = useState<TaxPolicyEntry>(() => policyEntry(policy));
  const [baseline, setBaseline] = useState(() => JSON.stringify(policyEntry(policy)));
  const [savedSignature, setSavedSignature] = useState(() => JSON.stringify(policyEntry(policy)));
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedEntry = scope ? policy.stateOverrides?.[scope] : policy;
  const dirty = JSON.stringify(p) !== baseline;
  const changeScope = (next: string) => {
    if (busy || (dirty && !window.confirm("Discard unsaved changes before switching tax-policy state?"))) return;
    const entry = next ? policy.stateOverrides?.[next] : policy;
    const draft = entry ? policyEntry(entry) : { ...policyEntry(policy), approved: false, reference: "", approvedByName: "" };
    setScope(next); setP(draft); setBaseline(JSON.stringify(draft)); setSavedSignature(JSON.stringify(entry ? policyEntry(entry) : null)); setOk(false); setError(null);
  };
  const edit = (next: TaxPolicyEntry) => { setP(next); setOk(false); setError(null); };
  const save = async () => {
      if (busy || (!canFinance && !canSystem)) return;
    if (p.reference.trim().length < 3) return setError("Record the accountant / tax-policy review reference.");
    if (!ok) return setError("Confirm the accountant approved the classifications and SAC codes.");
    if (SERVICES.some(service => !/^\d{6,8}$/.test(p.services[service]?.sac || ""))) return setError("Enter a 6–8 digit SAC code for every service.");
    setBusy(true);
    setError(null);
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, "settings", "tax_policy");
        const snap = await tx.get(ref);
        const current = snap.exists() ? snap.data() as TaxPolicy : DEFAULT_POLICY;
        const currentEntry = scope ? current.stateOverrides?.[scope] : current;
        if (JSON.stringify(currentEntry ? policyEntry(currentEntry) : null) !== savedSignature) throw new Error("This policy was updated by another user. Close and reopen the editor before saving.");
        const saved = { ...p, reference: p.reference.trim(), approved: true, approvedByName: auth.currentUser?.displayName || auth.currentUser?.email || "", updatedAt: serverTimestamp() };
        tx.set(ref, scope ? { stateOverrides: { [scope]: saved }, updatedAt: serverTimestamp() } : saved, { merge: true });
      });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "The policy was not saved."); setBusy(false); }
  };
  return (
      <Modal title="Tax automation · Approved policy" onClose={onClose} busy={busy} size="lg" footer={<Button variant="primary" loading={busy} disabledReason={canFinance || canSystem ? undefined : "Saving tax policy needs finance or system access."} onClick={save}>Save approved policy</Button>}>
      <p className="text-[12px] text-muted mb-3">Classify passenger transportation and vehicle rental separately. The engine uses the approved classification, supplier location, recipient GST status and boarding / return locations.</p>
      <label className="ds-field mb-3"><span>Policy scope · Supplier registration state</span><select className="ds-select" value={scope} disabled={busy} onChange={e => changeScope(e.target.value)}><option value="">Common default · All states without an override</option>{GST_STATES.map(([code, name]) => <option key={code} value={code}>{name} ({code}){policy.stateOverrides?.[code] ? " · Configured" : ""}</option>)}</select></label>
      <p className="text-[12px] text-muted mb-3">{scope ? `Editing ${GST_STATES.find(([code]) => code === scope)?.[1]}. ${savedEntry ? "This state's saved policy is loaded." : "Common classifications are copied as a starting point; this state needs its own approval before saving."}` : "Editing the shared fallback. Existing state overrides remain unchanged."} New invoices select this policy using the supplier GSTIN state. Issued invoices keep their saved details.</p>
      {error && <div className="ds-error" role="alert">{error}</div>}
      <DataTable label="Service classification" minWidth={600} hideTools>
        <thead><tr><th>SERVICE</th><th>CLASSIFICATION</th><th>APPROVED SAC</th><th>REVIEW</th></tr></thead>
        <tbody>{SERVICES.map((s) => {
          const r = p.services[s];
          return (
            <tr key={s}>
              <td>{s}</td>
              <td><select className="ds-select" disabled={busy} value={r.classification} onChange={(e) => edit({ ...p, services: { ...p.services, [s]: { ...r, classification: e.target.value as TaxPolicy["services"][string]["classification"] } } })}><option>Passenger transportation</option><option>Vehicle rental</option></select></td>
              <td><input className="ds-input" disabled={busy} style={{ width: 110 }} value={r.sac} onChange={(e) => edit({ ...p, services: { ...p.services, [s]: { ...r, sac: e.target.value.replace(/\D/g, "").slice(0, 8) } } })} /></td>
              <td><Badge tone={p.approved && !dirty ? "green" : "amber"}>{p.approved && !dirty ? "Approved" : "Pending"}</Badge></td>
            </tr>
          );
        })}</tbody>
      </DataTable>
      <label className="ds-field mt-4"><span>Accountant / tax-policy review reference</span><input className="ds-input" disabled={busy} value={p.reference} onChange={(e) => edit({ ...p, reference: e.target.value })} /></label>
      <label className="ds-check mt-3"><input type="checkbox" disabled={busy} checked={ok} onChange={(e) => setOk(e.target.checked)} />Accountant approved the selected scope's service classifications and SAC codes</label>
      <p className="text-[11px] text-faint mt-3">Passenger transport: IGST Act 12(9). Rental: approved classification and applicable general place-of-supply rule. Return transportation is evaluated as a separate journey. GST rates continue to come from the saved trip tax configuration.</p>
    </Modal>
  );
}

function InvoicePreview({ invoice: inv, payment, onClose }: { invoice: Invoice; payment: string; onClose: () => void }) {
  const ratePct = ((inv.gstRate > 1 ? inv.gstRate / 100 : (Number.isFinite(inv.gstRate) ? inv.gstRate : 0.05)) * 100) / 2;
  const tolls = (inv.items || []).filter((i) => !i.sacCode).reduce((s, i) => s + (i.amount || 0), 0);
  const paid = payment === "Paid";
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden my-6" role="dialog" aria-modal="true" aria-label={`Invoice ${inv.invoiceNumber}`}>
        <div className="no-print px-6 py-4 border-b border-line flex items-center justify-between bg-surface-2">
          <span className="text-[14px] font-bold text-ink">Tax Invoice {inv.invoiceNumber}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[12px] font-semibold hover:bg-gray-800 cursor-pointer">
              Print / Save as PDF
            </button>
            <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-sm">✕</button>
          </div>
        </div>

        <div id="printable-invoice" className="p-8 space-y-6 text-ink bg-white max-h-[75vh] overflow-y-auto relative">
          {inv.invoiceStatus === "Cancelled" && (
            <div className="border-2 border-red-500 text-red-600 font-black text-center py-2 rounded-lg tracking-widest">
              VOID{(inv as Invoice & { voidReason?: string }).voidReason ? ` — ${(inv as Invoice & { voidReason?: string }).voidReason}` : ""}
            </div>
          )}
          <div className="flex justify-between gap-6 border-b pb-6">
            <div>
              <div className="text-[20px] font-black text-brand tracking-wide uppercase">{inv.companySnapshot?.name}</div>
              <div className="text-[11px] text-gray-600 max-w-sm mt-1 whitespace-pre-line">{inv.companySnapshot?.address}</div>
              <div className="text-[11px] text-gray-600 mt-1">
                {[inv.companySnapshot?.phone && `Phone: ${inv.companySnapshot.phone}`, inv.companySnapshot?.email && `Email: ${inv.companySnapshot.email}`].filter(Boolean).join(" • ")}
              </div>
              <div className="text-[11px] font-bold text-gray-900 mt-1">GSTIN: {inv.companySnapshot?.gstin}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[18px] font-black text-gray-900 tracking-wider">TAX INVOICE</div>
              <div className="text-[13px] font-mono font-bold text-brand mt-2">{inv.invoiceNumber}</div>
              <div className="text-[11px] text-gray-600 mt-0.5">Date: {inv.invoiceDate}</div>
              <div className="text-[11px] text-gray-600">Booking: {inv.bookingId}</div>
              <div className="mt-2">
                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold border ${paid ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800 border-amber-200"}`}>
                  {paid ? "PAID" : "PAYMENT PENDING"}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6 bg-gray-50 p-4 rounded-xl border border-gray-200 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider block mb-1">Billed To</span>
              <div className="text-sm font-bold text-gray-900">{inv.customerSnapshot?.name}</div>
              {inv.customerSnapshot?.gstin && <div className="text-gray-700 font-semibold">GSTIN: {inv.customerSnapshot.gstin}</div>}
              {inv.customerSnapshot?.phone && <div className="text-gray-600">Phone: {inv.customerSnapshot.phone}</div>}
              {inv.customerSnapshot?.email && <div className="text-gray-600">Email: {inv.customerSnapshot.email}</div>}
              {inv.customerSnapshot?.address && <div className="text-gray-600">Address: {inv.customerSnapshot.address}</div>}
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider block mb-1">Trip Details</span>
              <div className="text-gray-900 font-semibold">{inv.tripSnapshot?.service || "Passenger transport"}{inv.tripSnapshot?.vehicle ? ` (${inv.tripSnapshot.vehicle})` : ""}</div>
              <div className="text-gray-600">Route: {inv.tripSnapshot?.pickup} → {inv.tripSnapshot?.drop}</div>
              <div className="text-gray-600">Travel: {inv.tripSnapshot?.travelDate} {inv.tripSnapshot?.travelTime}</div>
              {inv.tripSnapshot?.vehicleNumber && <div className="text-gray-600">Vehicle: {inv.tripSnapshot.vehicleNumber}</div>}
              {inv.tripSnapshot?.driverName && <div className="text-gray-600">Driver: {inv.tripSnapshot.driverName}</div>}
              {Number(inv.tripSnapshot?.distanceKm) > 0 && <div className="text-gray-600">Distance: {inv.tripSnapshot?.distanceKm} km</div>}
            </div>
          </div>

          <div className="border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-100 border-b text-gray-700 font-bold uppercase text-[10px]">
                  <th className="px-4 py-2.5 text-left">#</th>
                  <th className="px-4 py-2.5 text-left">Description</th>
                  <th className="px-4 py-2.5 text-center">SAC</th>
                  <th className="px-4 py-2.5 text-right">Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {(inv.items || []).map((item, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="px-4 py-2.5 text-gray-500">{idx + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{item.description}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-gray-600">{item.sacCode || "—"}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-6 text-xs pt-2">
            <div>
              <span className="text-[10px] font-bold uppercase text-gray-500 tracking-wider block mb-1">Amount in Words</span>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 font-semibold text-gray-900 italic">{amountInWords(inv.grandTotal)}</div>
              {inv.terms && <p className="mt-4 text-[10px] text-gray-500">{inv.terms}</p>}
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-gray-600"><span>Subtotal:</span><span className="font-semibold text-gray-900">{formatCurrency(inv.subtotal)}</span></div>
              {inv.discount > 0 && <div className="flex justify-between text-gray-600"><span>Discount:</span><span className="font-semibold text-emerald-600">- {formatCurrency(inv.discount)}</span></div>}
              <div className="flex justify-between text-gray-600"><span>Taxable value:</span><span className="font-semibold text-gray-900">{formatCurrency(inv.taxableAmount)}</span></div>
              {inv.taxSplit === 'IGST' || (inv.igst ?? 0) > 0 ? <div className="flex justify-between text-gray-600"><span>IGST ({Math.round(inv.gstRate * 10000) / 100}%):</span><span className="font-semibold text-gray-900">{formatCurrency(inv.igst ?? 0)}</span></div> : <>
                <div className="flex justify-between text-gray-600"><span>CGST ({ratePct}%):</span><span className="font-semibold text-gray-900">{formatCurrency(inv.cgst)}</span></div>
                <div className="flex justify-between text-gray-600"><span>{inv.taxSplit === 'CGST + UTGST' || (inv.utgst ?? 0) > 0 ? 'UTGST' : 'SGST'} ({ratePct}%):</span><span className="font-semibold text-gray-900">{formatCurrency(inv.taxSplit === 'CGST + UTGST' || (inv.utgst ?? 0) > 0 ? inv.utgst! : inv.sgst)}</span></div>
              </>}
              {tolls > 0 && <div className="flex justify-between text-gray-600"><span>Tolls (non-taxable):</span><span className="font-semibold text-gray-900">{formatCurrency(tolls)}</span></div>}
              <div className="flex justify-between text-gray-900 font-bold border-t pt-2 text-sm"><span>Grand Total:</span><span className="text-brand">{formatCurrency(inv.grandTotal)}</span></div>
              <div className="flex justify-between text-gray-600 pt-1"><span>Paid:</span><span className="font-semibold">{formatCurrency(paid ? inv.grandTotal : 0)}</span></div>
              <div className="flex justify-between text-gray-600"><span>Balance due:</span><span className="font-semibold">{formatCurrency(paid ? 0 : inv.grandTotal)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
