import { useState, type FormEvent, type ReactNode } from "react";
import type { Booking } from "../../types";
import { EXPENSE_CATEGORIES, addRegisterEntry, today, verifyOpeningBalance, type RegisterEntry } from "../../services/accountsService";
import { Modal } from "../Feedback";
import { Button, Icon } from "../ui";
import { rupee } from "../../domain/officeStage";

export interface AccountRef { type: "customer" | "vendor" | "driver" | "business"; id: string; name: string }

function Form({ title, eyebrow, submit, note, busy, error, onClose, onSubmit, children }: {
  title: string; eyebrow?: string; submit: string; note?: string; busy: boolean; error: string | null; onClose: () => void; onSubmit: (e: FormEvent) => void; children: ReactNode;
}) {
  return (
    <Modal title={title} eyebrow={eyebrow} onClose={onClose} busy={busy} footNote={note} footer={<Button variant="primary" type="submit" form="register-form" loading={busy}>{submit}</Button>}>
      <form id="register-form" onSubmit={onSubmit} className="ds-form-grid" noValidate>
        {error && <div className="ds-error" role="alert" data-span="2"><Icon name="circle-alert" />{error}</div>}
        {children}
      </form>
    </Modal>
  );
}

function useSubmit(onDone: (t: string) => void, openingToVerify?: RegisterEntry) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (check: () => string | null, entry: () => Omit<RegisterEntry, "id">, ok: string, file?: File | null) => {
    if (busy) return;
    const why = check();
    if (why) return setError(why);
    setBusy(true);
    setError(null);
    try {
      if (openingToVerify) await verifyOpeningBalance(openingToVerify);
      else await addRegisterEntry(entry(), file);
      onDone(ok);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "The entry was not saved. Check your permissions and try again.");
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

const DateField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <label className="ds-field">
    <span>{label}</span>
    <input className="ds-input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    <span className="flex gap-3 text-[10px]">
      <button type="button" className="ds-link" style={{ fontSize: 10 }} onClick={() => onChange(today())}>Today</button>
      <button type="button" className="ds-link" style={{ fontSize: 10 }} onClick={() => onChange(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86400000)))}>Tomorrow</button>
    </span>
  </label>
);

export function ExpenseForm({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ date: today(), category: EXPENSE_CATEGORIES[0] as string, payee: "", reference: "", taxable: "", tax: "", remarks: "" });
  const [file, setFile] = useState<File | null>(null);
  const s = useSubmit(onDone);
  return (
    <Form title="Record expense" submit="Save expense" note="Input credit remains unreviewed" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!f.payee.trim() ? "Enter the payee / supplier." : !f.reference.trim() ? "Enter the bill reference." : !(Number(f.taxable) > 0) ? "Enter the expense before tax." : null),
      () => ({ kind: "expense", date: f.date, category: f.category, payee: f.payee.trim(), reference: f.reference.trim(), taxable: Number(f.taxable), tax: Number(f.tax) || 0, amount: Number(f.taxable) + (Number(f.tax) || 0), remarks: f.remarks.trim(), itcStatus: "Unreviewed" }),
      "Expense recorded.", file); }}>
      <DateField label="Bill date" value={f.date} onChange={(date) => setF({ ...f, date })} />
      <label className="ds-field"><span>Category</span><select className="ds-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="ds-field"><span>Payee / supplier</span><input className="ds-input" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></label>
      <label className="ds-field"><span>Bill reference</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-field"><span>Expense before tax · ₹</span><input className="ds-input" type="number" min={0} value={f.taxable} onChange={(e) => setF({ ...f, taxable: e.target.value })} /></label>
      <label className="ds-field"><span>Tax recorded · ₹</span><input className="ds-input" type="number" min={0} value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Remarks · optional</span><input className="ds-input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Upload bill · optional</span><input type="file" accept=".pdf,.xlsx,.xls,.csv,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span className="text-[11px] text-faint">PDF, spreadsheet or image · Up to 750 KB per file</span></label>
    </Form>
  );
}

export function SupplierBillForm({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ payee: "", reference: "", date: today(), taxable: "", tax: "", gstin: "" });
  const s = useSubmit(onDone);
  return (
    <Form title="Record supplier bill" eyebrow="NESAM" submit="Save bill" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!f.payee.trim() || !f.reference.trim() ? "Enter the supplier and bill reference." : !(Number(f.taxable) > 0) ? "Enter the taxable value." : f.tax === "" ? "Enter the tax amount (0 if none)." : f.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin) ? "Enter a valid supplier GSTIN or leave it blank." : null),
      () => ({ kind: "supplier_bill", date: f.date, payee: f.payee.trim(), reference: f.reference.trim(), taxable: Number(f.taxable), tax: Number(f.tax), amount: Number(f.taxable) + Number(f.tax), gstin: f.gstin, category: "Supplier bill", itcStatus: "Unreviewed" }),
      "Supplier bill recorded."); }}>
      <label className="ds-field"><span>Supplier / vendor name *</span><input className="ds-input" value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></label>
      <label className="ds-field"><span>Bill reference *</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-field"><span>Bill date *</span><input className="ds-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="ds-field"><span>Taxable value *</span><input className="ds-input" type="number" min={0} value={f.taxable} onChange={(e) => setF({ ...f, taxable: e.target.value })} /></label>
      <label className="ds-field"><span>Tax amount *</span><input className="ds-input" type="number" min={0} value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} /></label>
      <label className="ds-field"><span>Supplier GSTIN · optional</span><input className="ds-input" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></label>
    </Form>
  );
}

export function BankEntryForm({ recon, onClose, onDone }: { recon?: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ date: today(), account: "Bank" as NonNullable<RegisterEntry["account"]>, direction: "Money in" as NonNullable<RegisterEntry["direction"]>, amount: "", reference: "", description: "" });
  const s = useSubmit(onDone);
  return (
    <Form title={recon ? "Bank / gateway entry" : "Bank / cash entry"} submit="Save entry" note="Recorded entry · no transfer initiated" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!(Number(f.amount) > 0) ? "Enter the amount." : f.reference.trim().length < 3 ? "Enter the bank / voucher reference." : null),
      () => ({ kind: recon ? "recon" : "bank", date: f.date, account: f.account, direction: f.direction, amount: Number(f.amount), reference: f.reference.trim(), description: f.description.trim(), ...(recon ? { matchStatus: "Unmatched" as const } : {}) }),
      "Entry recorded."); }}>
      <DateField label="Transaction date" value={f.date} onChange={(date) => setF({ ...f, date })} />
      <label className="ds-field"><span>Account</span><select className="ds-select" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value as typeof f.account })}><option>Bank</option><option>Cash</option><option>Payment gateway</option></select></label>
      <label className="ds-field"><span>Direction</span><select className="ds-select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value as typeof f.direction })}><option>Money in</option><option>Money out</option></select></label>
      <label className="ds-field"><span>Amount · ₹</span><input className="ds-input" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="ds-field"><span>Bank / voucher reference</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-field"><span>Description</span><input className="ds-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
    </Form>
  );
}

export function TaxPaymentForm({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ taxType: "GST" as NonNullable<RegisterEntry["taxType"]>, period: today().slice(0, 7), gstin: "", purpose: "Cash ledger deposit" as NonNullable<RegisterEntry["purpose"]>, date: today(), amount: "", settled: "", reference: "" });
  const [file, setFile] = useState<File | null>(null);
  const [ok, setOk] = useState(false);
  const s = useSubmit(onDone);
  return (
    <Form title="Record verified tax payment" submit="Record payment" note="Recording this does not file a return" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!(Number(f.amount) > 0) ? "Enter the payment / ledger utilisation amount." : f.reference.trim().length < 4 ? "Enter the challan / CIN / payment reference." : Number(f.settled) > Number(f.amount) ? "Liability settled cannot exceed the payment." : !ok ? "Confirm you verified the payment, period, reference and liability utilisation." : null),
      () => ({ kind: "tax", date: f.date, taxType: f.taxType, period: f.period, gstin: f.gstin, purpose: f.purpose, amount: Number(f.amount), liabilitySettled: Number(f.settled) || 0, reference: f.reference.trim(), status: "Verified" }),
      "Tax payment recorded.", file); }}>
      <label className="ds-field"><span>Tax type</span><select className="ds-select" value={f.taxType} onChange={(e) => setF({ ...f, taxType: e.target.value as typeof f.taxType })}><option>GST</option><option>Income Tax / Advance Tax</option><option>TDS</option></select></label>
      <label className="ds-field"><span>Tax period / financial year</span><input className="ds-input" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></label>
      <label className="ds-field"><span>GSTIN on receipt</span><input className="ds-input" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} /></label>
      <label className="ds-field"><span>Payment purpose</span><select className="ds-select" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value as typeof f.purpose })}><option>Cash ledger deposit</option><option>Liability discharged</option></select></label>
      <label className="ds-field"><span>Payment date</span><input className="ds-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="ds-field"><span>Payment / ledger utilisation · ₹</span><input className="ds-input" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="ds-field"><span>Liability settled · ₹</span><input className="ds-input" type="number" min={0} value={f.settled} onChange={(e) => setF({ ...f, settled: e.target.value })} /></label>
      <label className="ds-field"><span>Challan / CIN / payment reference</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Upload payment receipt</span><input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <label className="ds-check" data-span="2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I verified the payment, period, reference and liability utilisation.</label>
    </Form>
  );
}

export function OpeningForm({ account, existing, onClose, onDone }: { account: AccountRef; existing?: RegisterEntry; onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ date: existing?.date ?? today(), amount: existing ? String(existing.amount) : "", reference: existing?.reference ?? "" });
  const [ok, setOk] = useState(false);
  const s = useSubmit(onDone, existing);
  return (
    <Form title={existing ? "Verify recorded opening balance" : "Record opening balance"} submit={existing ? "Verify opening" : "Record verified opening"} busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (f.amount === "" || !Number.isFinite(Number(f.amount)) ? "Enter the signed opening balance." : f.reference.trim().length < 3 ? "Enter the statement / reconciliation reference." : !ok ? "Confirm you verified the opening balance and date." : null),
      () => ({ kind: "opening", status: "Verified", date: f.date, amount: Number(f.amount), reference: f.reference.trim(), accountType: account.type, accountId: account.id, accountName: account.name }),
      existing ? "Opening balance verified. No additional balance was posted." : "Verified opening balance recorded."); }}>
      <p className="ds-note" data-span="2">{account.name} · Positive = owed to NESAM. Negative = NESAM owes the account. Record the balance before the dated entries below.</p>
      {existing && <p className="ds-note" data-span="2">Review the original entry against your statement. Verification preserves its amount, date and reference; use a referenced adjustment for a balance correction.</p>}
      <label className="ds-field"><span>Opening date</span><input className="ds-input" type="date" readOnly={!!existing} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="ds-field"><span>Signed opening balance · ₹</span><input className="ds-input" type="number" step="0.01" readOnly={!!existing} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Statement / reconciliation reference</span><input className="ds-input" readOnly={!!existing} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-check" data-span="2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I verified the opening balance and date.</label>
    </Form>
  );
}

export function AdjustmentForm({ account, existing, onClose, onDone }: { account: AccountRef; existing: RegisterEntry[]; onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ date: today(), direction: "Debit" as "Debit" | "Credit", amount: "", explanation: "", reference: "" });
  const s = useSubmit(onDone);
  return (
    <Form title="Referenced account adjustment" submit="Record adjustment" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!(Number(f.amount) > 0) ? "Enter the amount." : f.explanation.trim().length < 5 ? "Explain the adjustment." : f.reference.trim().length < 3 ? "Enter a unique reference." : existing.some((x) => x.reference === f.reference.trim()) ? "This reference is already used." : null),
      () => ({ kind: "adjustment", date: f.date, direction: f.direction, amount: Number(f.amount), description: f.explanation.trim(), reference: f.reference.trim(), accountType: account.type, accountId: account.id, accountName: account.name }),
      "Adjustment recorded."); }}>
      <p className="ds-note" data-span="2">{account.name}</p>
      <label className="ds-field"><span>Entry date</span><input className="ds-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <div className="ds-field"><span>Direction</span><div className="ds-seg">{(["Debit", "Credit"] as const).map((d) => <button key={d} type="button" aria-pressed={f.direction === d} onClick={() => setF({ ...f, direction: d })}>{d}</button>)}</div></div>
      <label className="ds-field"><span>Amount · ₹</span><input className="ds-input" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="ds-field"><span>Unique reference</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Explanation</span><input className="ds-input" value={f.explanation} onChange={(e) => setF({ ...f, explanation: e.target.value })} /></label>
    </Form>
  );
}

export function SettlementForm({ account, outstanding, onClose, onDone }: { account: AccountRef; outstanding: number; onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ direction: "Bank settlement paid", amount: "", date: today(), reference: "" });
  const [ok, setOk] = useState(false);
  const s = useSubmit(onDone);
  return (
    <Form title="Record partner settlement" submit="Record verified settlement" note="Records a completed payment only. This does not initiate a bank transfer. Security deposit is excluded." busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!(Number(f.amount) > 0) ? "Enter the settlement amount." : f.reference.trim().length < 4 ? "Enter the verified bank / payment reference." : !ok ? "Confirm you checked the bank transaction and the partner outstanding." : null),
      () => ({ kind: "settlement", date: f.date, direction: f.direction === "Bank settlement paid" ? "Debit" : "Credit", amount: Number(f.amount), reference: f.reference.trim(), description: f.direction, accountType: account.type, accountId: account.id, accountName: account.name }),
      "Settlement recorded."); }}>
      <p className="ds-note" data-span="2">{account.name} · Current balance {rupee(Math.abs(outstanding))} {outstanding > 0 ? "receivable from partner" : outstanding < 0 ? "payable to partner" : "settled"}</p>
      <label className="ds-field" data-span="2"><span>Settlement direction</span><select className="ds-select" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option>Bank settlement paid</option><option>Partner remittance received</option></select></label>
      <label className="ds-field"><span>Amount · ₹</span><input className="ds-input" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="ds-field"><span>Bank transaction date</span><input className="ds-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Verified bank / payment reference</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="ds-check" data-span="2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I checked the bank transaction and the partner outstanding.</label>
    </Form>
  );
}

export function DepositForm({ account, onClose, onDone }: { account: AccountRef; onClose: () => void; onDone: (t: string) => void }) {
  const [f, setF] = useState({ amount: "", date: today(), reference: "" });
  const s = useSubmit(onDone);
  return (
    <Form title="Record security deposit" submit="Record deposit" note="Separate from the working statement · Refund only at Full & Final settlement" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!(Number(f.amount) > 0) ? "Enter the deposit amount." : f.reference.trim().length < 4 ? "Enter the receipt reference." : null),
      () => ({ kind: "deposit", date: f.date, amount: Number(f.amount), reference: f.reference.trim(), accountType: account.type, accountId: account.id, accountName: account.name, status: "Active" }),
      "Security deposit recorded."); }}>
      <p className="ds-note" data-span="2">{account.name}</p>
      <label className="ds-field"><span>Amount · ₹</span><input className="ds-input" type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="ds-field"><span>Received on</span><input className="ds-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      <label className="ds-field" data-span="2"><span>Receipt reference</span><input className="ds-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
    </Form>
  );
}

export function RefundRequestForm({ bookings, onClose, onDone }: { bookings: Booking[]; onClose: () => void; onDone: (t: string) => void }) {
  const [id, setId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const s = useSubmit(onDone);
  const b = bookings.find((x) => x.id === id);
  return (
    <Form title="New customer refund" submit="Request approval" busy={s.busy} error={s.error} onClose={onClose} onSubmit={(e) => { e.preventDefault(); s.run(
      () => (!b ? "Select the customer booking." : !(Number(amount) > 0) ? "Enter the refund amount." : reason.trim().length < 5 ? "Record the refund reason." : null),
      () => ({ kind: "refund_request", date: today(), amount: Number(amount), bookingId: b!.id, bookingCode: b!.bookingId || b!.id, accountType: "customer", accountId: b!.customerId || "", accountName: b!.customer, description: reason.trim(), status: "Pending approval" }),
      "Refund sent for approval."); }}>
      <label className="ds-field" data-span="2"><span>Customer booking</span><select className="ds-select" value={id} onChange={(e) => setId(e.target.value)}><option value="">Select booking</option>{bookings.map((x) => <option key={x.id} value={x.id}>{x.bookingId || x.id} · {x.customer} · {x.pickup} → {x.drop}</option>)}</select></label>
      <label className="ds-field"><span>Refund amount · ₹</span><input className="ds-input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="ds-field"><span>Refund reason</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
    </Form>
  );
}
