import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Booking, MasterLocation, TravelService, VehicleCategory } from "../types";
import {
  BUSINESS_STATUSES, BUSINESS_TYPES, createBusiness, createCredential, recordBusinessPayment, revokeCredential, saveContractRates, subscribeBusinessAccounts,
  subscribeBusinessPayments, subscribeCredentials, updateBusiness, validateBusiness,
  type BusinessAccount, type BusinessCredential, type BusinessInput, type BusinessPayment, type ContractRate,
} from "../services/businessService";
import { subscribeLocations, subscribeServices, subscribeVehicleCategories } from "../services/adminFirestoreService";
import { useBookings } from "../hooks/useOfficeData";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, PageHeader, Tabs, TableSkeleton, toneForStatus } from "../components/ui";
import { StageBar } from "../components/ui/ListKit";
import { Initials } from "../components/ui/RecordKit";
import { exportRows } from "../utils/exportData";
import { fareOf, refDateTime, rupee } from "../domain/officeStage";
import { bookingPickupDate, isoDateIST } from "../utils/time";

const TABS = ["Active", "On hold", "Inactive", "All"] as const;
type Tab = (typeof TABS)[number];
const bizOf = (b: Booking) => (b as Booking & { businessAccountId?: string; businessBilledTo?: string });

/** Company charges post after the trip is completed (verified final bill) or a confirmed cancellation charge. */
function chargesOf(acc: BusinessAccount, bookings: Booking[]) {
  return bookings
    .filter((b) => bizOf(b).businessAccountId === acc.id && bizOf(b).businessBilledTo !== "Passenger pays")
    .filter((b) => b.status === "Completed" || (b.status === "Cancelled" && (b.cancellation?.charge ?? 0) > 0));
}
function reservedOf(acc: BusinessAccount, bookings: Booking[]) {
  return bookings
    .filter((b) => bizOf(b).businessAccountId === acc.id && bizOf(b).businessBilledTo !== "Passenger pays" && ["Pending", "Approved", "Confirmed", "Assigned", "Ongoing"].includes(b.status))
    .reduce((s, b) => s + fareOf(b), 0);
}

export default function BusinessAccounts({ onQuote }: { onQuote: (businessId: string) => void }) {
  const [rows, setRows] = useState<BusinessAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Active");
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<BusinessAccount | "new" | null>(null);
  const [payments, setPayments] = useState<Map<string, number>>(new Map());
  const bookings = useBookings().rows ?? [];
  const { toast, show } = useToast(7000);
  useEffect(() => subscribeBusinessAccounts(setRows, setError), []);
  // Receipt totals per account (for "due" in the list).
  useEffect(() => {
    if (!rows) return;
    const unsubs = rows.map((r) => subscribeBusinessPayments(r.id, (p) => setPayments((m) => new Map(m).set(r.id, p.reduce((s, x) => s + (Number(x.amount) || 0), 0)))));
    return () => unsubs.forEach((u) => u());
  }, [rows?.map((r) => r.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = rows ?? [];
  const counts = Object.fromEntries(TABS.map((t) => [t, t === "All" ? all.length : all.filter((r) => r.status === t).length])) as Record<Tab, number>;
  const shown = all.filter((r) => tab === "All" || r.status === tab).sort((a, b) => a.name.localeCompare(b.name));
  const dueOf = (a: BusinessAccount) => chargesOf(a, bookings).reduce((s, b) => s + (b.status === "Completed" ? fareOf(b) : b.cancellation?.charge ?? 0), 0) - (payments.get(a.id) ?? 0);
  const current = all.find((r) => r.id === viewing) ?? null;

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {error && <ErrorBanner message={error} />}
      <PageHeader title="Business accounts" subtitle="Travel agencies, hotels and corporate booking accounts." actions={<Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Add business</Button>} />
      <StageBar label="Account status" tabs={TABS.map((t) => ({ id: t, label: t, count: counts[t] }))} value={tab} onChange={setTab} />
      <div className="ds-toolbar-count"><strong>{shown.length} accounts · B2B stays separate from passenger contact</strong></div>
      {rows === null ? <div className="ds-panel"><TableSkeleton rows={3} cols={5} /></div> : shown.length === 0 ? <div className="ds-panel"><EmptyState /></div> : (
        <DataTable label="Business accounts" minWidth={1040} fixed hasActions>
          <colgroup><col style={{ width: 250 }} /><col style={{ width: 220 }} /><col style={{ width: 170 }} /><col style={{ width: 220 }} /><col style={{ width: 100 }} /><col style={{ width: 160 }} /></colgroup>
          <thead><tr><th>BUSINESS / ID</th><th>TYPE / CONTACT</th><th>PAYMENT TERMS</th><th>OUTSTANDING / RESERVED</th><th>STATUS</th><th className="ds-actions">ACTIONS</th></tr></thead>
          <tbody>{shown.map((a) => {
            const due = dueOf(a);
            const reserved = reservedOf(a, bookings);
            const available = a.paymentTerms === "Credit" ? Math.max(0, a.creditLimit - Math.max(0, due) - reserved) : Math.max(0, -due - reserved);
            return (
              <tr key={a.id}>
                <td><div className="ds-person"><Initials name={a.name} /><div><strong>{a.name}</strong><small>{a.code}</small></div></div></td>
                <td><strong>{a.type}</strong><small>{a.contactName} · {a.phone}</small></td>
                <td><strong>{a.paymentTerms}</strong><small>{a.paymentTerms === "Credit" ? `Limit ${rupee(a.creditLimit)}` : "Verified funds before company-paid booking"}</small></td>
                <td><strong>{rupee(Math.max(0, due))} due</strong><small>{rupee(reserved)} booking reserve · {rupee(available)} available</small></td>
                <td><Badge tone={toneForStatus(a.status === "On hold" ? "hold" : a.status)}>{a.status}</Badge></td>
                <td className="ds-actions"><div><Button size="sm" onClick={() => setViewing(a.id)}>View</Button><Button size="sm" variant="ghost" onClick={() => onQuote(a.id)}>Quote</Button></div></td>
              </tr>
            );
          })}</tbody>
        </DataTable>
      )}
      {current && <BusinessProfile a={current} bookings={bookings} onClose={() => setViewing(null)} onEdit={() => setEditing(current)} onQuote={() => onQuote(current.id)} onToast={show} />}
      {editing && <BusinessForm a={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); show(t); }} />}
    </div>
  );
}

type PTab = "Overview" | "Contract rates" | "Bookings" | "Accounts" | "API access";

function BusinessProfile({ a, bookings, onClose, onEdit, onQuote, onToast }: { a: BusinessAccount; bookings: Booking[]; onClose: () => void; onEdit: () => void; onQuote: () => void; onToast: (t: string) => void }) {
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const runAction = async (action: () => Promise<unknown>, message: string) => {
    if (actionBusy) return;
    setActionBusy(true); setActionError(null);
    try { await action(); onToast(message); }
    catch (err) { setActionError(err instanceof Error ? err.message : "The change failed. Please try again."); }
    finally { setActionBusy(false); }
  };
  const [tab, setTab] = useState<PTab>("Overview");
  const [pays, setPays] = useState<BusinessPayment[]>([]);
  const [creds, setCreds] = useState<BusinessCredential[]>([]);
  const [sheet, setSheet] = useState<"pay" | "rate" | "cred" | "inspect" | null>(null);
  const [month, setMonth] = useState(isoDateIST(new Date()).slice(0, 7));
  useEffect(() => { const a1 = subscribeBusinessPayments(a.id, setPays); const a2 = subscribeCredentials(a.id, setCreds); return () => { a1(); a2(); }; }, [a.id]);
  const linked = bookings.filter((b) => bizOf(b).businessAccountId === a.id).sort((x, y) => (bookingPickupDate(y)?.getTime() ?? 0) - (bookingPickupDate(x)?.getTime() ?? 0));
  const charges = chargesOf(a, bookings);
  const received = pays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const charged = charges.reduce((s, b) => s + (b.status === "Completed" ? fareOf(b) : b.cancellation?.charge ?? 0), 0);
  const balance = charged - received;
  const reserved = reservedOf(a, bookings);
  const available = a.paymentTerms === "Credit" ? Math.max(0, a.creditLimit - Math.max(0, balance) - reserved) : Math.max(0, -balance - reserved);

  // Monthly statement: opening from everything before the month, then the month's entries.
  const statement = useMemo(() => {
    const entries = [
      ...charges.map((b) => ({ date: isoDateIST(bookingPickupDate(b) ?? new Date()), entry: b.status === "Completed" ? "Trip charge" : "Cancellation charge", ref: b.bookingId || b.id, debit: b.status === "Completed" ? fareOf(b) : b.cancellation?.charge ?? 0, credit: 0 })),
      ...pays.map((p) => ({ date: p.paidOn || isoDateIST(p.at?.toDate?.() ?? new Date()), entry: `Receipt · ${p.method}`, ref: p.reference, debit: 0, credit: Number(p.amount) || 0 })),
    ].sort((x, y) => x.date.localeCompare(y.date));
    const opening = entries.filter((e) => e.date < `${month}-01`).reduce((s, e) => s + e.debit - e.credit, 0);
    const inMonth = entries.filter((e) => e.date.startsWith(month));
    let run = opening;
    const rows = inMonth.map((e) => ({ ...e, balance: (run += e.debit - e.credit) }));
    const debits = inMonth.reduce((s, e) => s + e.debit, 0);
    const credits = inMonth.reduce((s, e) => s + e.credit, 0);
    return { opening, rows, debits, credits, closing: opening + debits - credits };
  }, [charges, pays, month]);
  const exportStatement = (fmt: "xlsx" | "print") => exportRows(`${a.name} statement ${month}`, ["Date", "Entry", "Booking / reference", "Debit", "Credit", "Balance"], [
    [`${month}-01`, "Opening balance", "—", "", "", statement.opening], ...statement.rows.map((r) => [r.date, r.entry, r.ref, r.debit || "", r.credit || "", r.balance]), [`${month}-31`, "Closing balance", "—", statement.debits, statement.credits, statement.closing],
  ], fmt);

  return (
    <Modal title="Business account" onClose={onClose} busy={actionBusy} wide>
      {actionError && <div className="ds-error" role="alert">{actionError}</div>}
      <div className="ds-profile-head">
        <Initials name={a.name} />
        <div><strong>{a.name}</strong><small>{a.code} · {a.type}</small></div>
        <Badge tone={toneForStatus(a.status === "On hold" ? "hold" : a.status)}>{a.status}</Badge>
      </div>
      <Tabs<PTab> label="Business account" value={tab} onChange={setTab} tabs={(["Overview", "Contract rates", "Bookings", "Accounts", "API access"] as const).map((t) => ({ id: t, label: t }))} />
      {tab === "Overview" && (
        <>
          <dl className="ds-facts" data-cols={2}>
            {([
              ["Business ID", a.code], ["Business type", a.type], ["Contact", `${a.contactName} · ${a.phone}`], ["Email", a.email || "Not supplied"],
              ["Billing address", a.billingAddress], ["GSTIN", a.gstin || "Not supplied"], ["Payment terms", a.paymentTerms], ["Default billed to", a.billedTo],
              ["Credit limit", a.paymentTerms === "Credit" ? rupee(a.creditLimit) : "Prepaid"], ["Account balance", `${rupee(Math.abs(balance))} · ${balance > 0 ? "Due" : balance < 0 ? "Advance" : "Settled"}`],
              ["Booking reserves", rupee(reserved)], ["Available for new company-paid booking", rupee(available)],
            ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="flex flex-wrap gap-2 mt-5">
            <Button icon="pencil" onClick={onEdit}>Edit account</Button>
            <Button icon="calculator" onClick={onQuote}>Quote for business</Button>
            <Button icon="plus" onClick={onQuote} disabled={a.status !== "Active"}>New booking</Button>
            <Button icon="receipt-indian-rupee" onClick={() => setSheet("pay")}>Record payment</Button>
          </div>
          <p className="text-[11px] text-faint mt-4">Matching active contracts apply before standard fares. Company-paid bookings reserve available credit on the server; inactive or on-hold accounts cannot create bookings.</p>
        </>
      )}
      {tab === "Contract rates" && (
        <>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><strong className="text-[15px] text-ink">Business contract rates</strong><p className="text-[12px] text-muted">Active contract → Public fixed route → Standard fare. Zones match place or city names exactly; duplicate matching contracts are refused.</p></div>
            <Button icon="plus" onClick={() => setSheet("rate")}>Add contract rate</Button>
          </div>
          {(a.contractRates ?? []).length === 0 ? <EmptyState /> : (
            <DataTable label="Contract rates" minWidth={820} fixed hasActions>
              <thead><tr><th>ROUTE</th><th>SERVICE / CAR</th><th>CUSTOMER RATE</th><th>PARTNER PAYOUT</th><th>STATUS</th><th className="ds-actions">ACTION</th></tr></thead>
              <tbody>{(a.contractRates ?? []).map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.pickupZone} → {r.dropZone}</strong></td>
                  <td><strong>{r.service}</strong><small>{r.category}</small></td>
                  <td><strong>{rupee(r.customerRate)}{r.contractType === "Per km" ? " / km" : ""}</strong><small>{r.contractType} · {r.priceEntered}</small></td>
                  <td>{rupee(r.partnerPayout)}</td>
                  <td><Badge tone={r.active ? "green" : "neutral"}>{r.active ? "Active" : "Inactive"}</Badge>{r.peak && <small>Peak adjustment</small>}</td>
                  <td className="ds-actions"><div><Button size="sm" disabled={actionBusy} onClick={() => void runAction(() => saveContractRates(a.id, (a.contractRates ?? []).map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)), `${r.active ? "Deactivated" : "Activated"} ${r.pickupZone} → ${r.dropZone}`), "Contract rate updated.")}>{r.active ? "Deactivate" : "Activate"}</Button></div></td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
          <p className="text-[11px] text-faint mt-3">Extra stops use the normal applicable route / service fare. Peak adjustment is off unless enabled on this contract.</p>
        </>
      )}
      {tab === "Bookings" && <BusinessBookings rows={linked} onNew={onQuote} />}
      {tab === "Accounts" && (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div><strong className="text-[15px] text-ink">Monthly business statement</strong><p className="text-[12px] text-muted">Company charges, verified receipts and account balance.</p></div>
            <div className="flex gap-2"><Button icon="printer" onClick={() => exportStatement("print")}>Save as PDF</Button><Button icon="sheet" onClick={() => exportStatement("xlsx")}>Export Excel</Button><Button variant="primary" icon="receipt-indian-rupee" onClick={() => setSheet("pay")}>Record payment</Button></div>
          </div>
          <div className="flex flex-wrap items-end gap-4 mb-3">
            <label className="ds-field"><span>Month</span><input type="month" className="ds-input" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
            <span className="text-[12px] text-body">Opening {rupee(statement.opening)} · Debits {rupee(statement.debits)} · Credits {rupee(statement.credits)} · Closing {rupee(statement.closing)}</span>
          </div>
          <DataTable label="Business statement" minWidth={760} hideTools>
            <thead><tr><th>DATE</th><th>ENTRY</th><th>BOOKING / REFERENCE</th><th className="ds-num">DEBIT</th><th className="ds-num">CREDIT</th><th className="ds-num">BALANCE</th></tr></thead>
            <tbody>
              <tr><td>{month}-01</td><td><strong>Opening balance</strong></td><td>—</td><td className="ds-num">—</td><td className="ds-num">—</td><td className="ds-num">{rupee(statement.opening)}</td></tr>
              {statement.rows.map((r, i) => <tr key={i}><td>{r.date}</td><td>{r.entry}</td><td>{r.ref}</td><td className="ds-num">{r.debit ? rupee(r.debit) : "—"}</td><td className="ds-num">{r.credit ? rupee(r.credit) : "—"}</td><td className="ds-num">{rupee(r.balance)}</td></tr>)}
              <tr><td>{month}-{String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate())}</td><td><strong>Closing balance</strong></td><td>—</td><td className="ds-num">{rupee(statement.debits)}</td><td className="ds-num">{rupee(statement.credits)}</td><td className="ds-num">{rupee(statement.closing)}</td></tr>
            </tbody>
          </DataTable>
          <p className="text-[11px] text-faint mt-3">Positive balance: company owes NESAM. Negative balance: prepaid / credit balance. Active booking estimates are reserved separately; charges post after verified final bill or confirmed cancellation. Passenger-paid trips are excluded from company debt.</p>
        </>
      )}
      {tab === "API access" && (
        <>
          <div className="ds-note mb-4"><strong>API integration · Not connected</strong><br />Credentials are issued and logged here. External booking calls need the NESAM partner API to be connected for this business.</div>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><strong className="text-[15px] text-ink">Business API access</strong><p className="text-[12px] text-muted">Separate credentials and scopes for this business.</p></div>
            <Button icon="key-round" disabledReason="The external B2B booking API is not connected yet." onClick={() => setSheet("cred")}>Create credential</Button>
          </div>
          {creds.length === 0 ? <EmptyState /> : (
            <DataTable label="API credentials" minWidth={700} fixed hasActions>
              <thead><tr><th>CREDENTIAL</th><th>SCOPES</th><th>STATUS / EXPIRY</th><th className="ds-actions">ACTIONS</th></tr></thead>
              <tbody>{creds.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.label}</strong><small>••••{c.last4} · {c.createdByName}</small></td>
                  <td>{c.scopes.join(", ")}</td>
                  <td><Badge tone={c.status === "Active" ? "green" : "red"}>{c.status}</Badge><small>Expires {c.expiresAt}</small></td>
                  <td className="ds-actions"><div>{c.status === "Active" && <Button size="sm" disabled={actionBusy} onClick={() => void runAction(() => revokeCredential(a.id, c.id), "Credential revoked.")}>Revoke</Button>}</div></td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
          <h3 className="text-[13px] font-bold text-ink mt-5 mb-2">Request log</h3>
          <EmptyState title="No API requests recorded" hint="Requests appear here once the partner API is connected." />
          <div className="flex gap-2 mt-4">
            <Button icon="file-json" onClick={() => exportRows("NESAM business API contract", ["Endpoint", "Method", "Scope", "Purpose"], [["/v1/quotes", "POST", "quotes:write", "Get a fare estimate"], ["/v1/bookings", "POST", "bookings:write", "Create a business booking"], ["/v1/bookings/{id}", "GET", "bookings:read", "Booking status and driver details"], ["/v1/statement", "GET", "accounts:read", "Monthly business statement"]], "print")}>Download API contract</Button>
            <Button icon="eye" onClick={() => setSheet("inspect")}>Inspect business access</Button>
          </div>
        </>
      )}
      {sheet === "pay" && <ReceiptForm a={a} existing={pays} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); onToast("Company receipt recorded."); }} />}
      {sheet === "rate" && <RateForm a={a} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); onToast("Contract rate saved."); }} />}
      {sheet === "cred" && <CredentialForm a={a} onClose={() => setSheet(null)} />}
      {sheet === "inspect" && (
        <Modal title="Business access · Read only" onClose={() => setSheet(null)} wide>
          <p className="ds-note mb-4">Master inspection · This business’s bookings and account statement only.</p>
          <BusinessBookings rows={linked} />
        </Modal>
      )}
    </Modal>
  );
}

function BusinessBookings({ rows, onNew }: { rows: Booking[]; onNew?: () => void }) {
  return (
    <>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div><strong className="text-[15px] text-ink">Business bookings</strong><p className="text-[12px] text-muted">Only bookings linked to this business account.</p></div>
        {onNew && <Button icon="plus" onClick={onNew}>New booking</Button>}
      </div>
      {rows.length === 0 ? <EmptyState /> : (
        <DataTable label="Business bookings" minWidth={820} fixed>
          <thead><tr><th>PICKUP DATE / TIME</th><th>BOOKING / ROUTE</th><th>SERVICE / CAR</th><th>BILL TO / FARE</th><th>STATUS</th></tr></thead>
          <tbody>{rows.map((b) => (
            <tr key={b.id}>
              <td>{refDateTime(bookingPickupDate(b))}</td>
              <td><strong>{b.bookingId || b.id}</strong><small>{b.pickup} → {b.drop}</small></td>
              <td><strong>{b.service}</strong><small>{b.vehicleCategory || b.vehicle}</small></td>
              <td><strong>{bizOf(b).businessBilledTo || "Company pays"}</strong><small>{rupee(fareOf(b))}</small></td>
              <td><Badge tone={toneForStatus(b.status)}>{b.status}</Badge></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
    </>
  );
}

const EMPTY: BusinessInput = { name: "", type: "Travel agency", contactName: "", phone: "", email: "", gstin: "", paymentTerms: "Prepaid", creditLimit: 0, billedTo: "Company pays", status: "Active", billingAddress: "", reason: "" };

function BusinessForm({ a, onClose, onSaved }: { a: BusinessAccount | null; onClose: () => void; onSaved: (t: string) => void }) {
  const [f, setF] = useState<BusinessInput>(a ? { name: a.name, type: a.type, contactName: a.contactName, phone: a.phone, email: a.email, gstin: a.gstin, paymentTerms: a.paymentTerms, creditLimit: a.creditLimit, billedTo: a.billedTo, status: a.status, billingAddress: a.billingAddress, reason: "" } : EMPTY);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const why = validateBusiness(f);
    if (why) return setError(why);
    if (!ok) return setError("Confirm you verified the business contact, billing details and payment terms.");
    setBusy(true);
    try {
      if (a) await updateBusiness(a.id, f, f.reason ?? "");
      else await createBusiness(f);
      onSaved(a ? "Business account updated." : "Business account created.");
    } catch {
      setError("The business account was not saved.");
      setBusy(false);
    }
  };
  const set = (p: Partial<BusinessInput>) => setF({ ...f, ...p });
  return (
    <Modal title={a ? "Edit business account" : "Add business account"} onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="biz-form" loading={busy}>Save business account</Button>}>
      <form id="biz-form" onSubmit={save} className="ds-form-grid" noValidate>
        {error && <div className="ds-error" role="alert" data-span="2">{error}</div>}
        <label className="ds-field" data-span="2"><span>Business name</span><input className="ds-input" value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="ds-field"><span>Business type</span><select className="ds-select" value={f.type} onChange={(e) => set({ type: e.target.value as BusinessInput["type"] })}>{BUSINESS_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="ds-field"><span>Authorised contact</span><input className="ds-input" value={f.contactName} onChange={(e) => set({ contactName: e.target.value })} /></label>
        <label className="ds-field"><span>Contact mobile</span><input className="ds-input" type="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
        <label className="ds-field"><span>Business email</span><input className="ds-input" type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></label>
        <label className="ds-field"><span>GSTIN · if supplied</span><input className="ds-input" value={f.gstin} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} /></label>
        <label className="ds-field"><span>Payment terms</span><select className="ds-select" value={f.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value as BusinessInput["paymentTerms"] })}><option>Prepaid</option><option>Credit</option></select></label>
        {f.paymentTerms === "Credit" && <label className="ds-field"><span>Approved credit limit · ₹</span><input className="ds-input" type="number" min={1} value={f.creditLimit || ""} onChange={(e) => set({ creditLimit: Number(e.target.value) })} /></label>}
        <label className="ds-field"><span>Default billed to</span><select className="ds-select" value={f.billedTo} onChange={(e) => set({ billedTo: e.target.value as BusinessInput["billedTo"] })}><option>Company pays</option><option>Passenger pays</option></select></label>
        <label className="ds-field"><span>Account status</span><select className="ds-select" value={f.status} onChange={(e) => set({ status: e.target.value as BusinessInput["status"] })}>{BUSINESS_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="ds-field" data-span="2"><span>Billing address</span><input className="ds-input" value={f.billingAddress} onChange={(e) => set({ billingAddress: e.target.value })} /></label>
        <label className="ds-field" data-span="2"><span>Reason / approval reference</span><input className="ds-input" value={f.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
        <label className="ds-check" data-span="2"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I verified the business contact, billing details and payment terms.</label>
      </form>
    </Modal>
  );
}

function ReceiptForm({ a, existing, onClose, onSaved }: { a: BusinessAccount; existing: BusinessPayment[]; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(isoDateIST(new Date()));
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Bank Transfer");
  const [ref, setRef] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!(n > 0)) return setError("Enter the amount received.");
    if (ref.trim().length < 4) return setError("Enter the bank / payment reference.");
    if (existing.some((p) => p.reference.trim().toLowerCase() === ref.trim().toLowerCase())) return setError("This reference is already credited. The same reference cannot be credited twice.");
    if (!ok) return setError("Confirm you verified the company payment in the bank / collection records.");
    setBusy(true);
    try { await recordBusinessPayment(a.id, n, method, ref.trim(), date); onSaved(); } catch { setError("The receipt was not recorded."); setBusy(false); }
  };
  return (
    <Modal title="Record company receipt" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="receipt-form" loading={busy}>Record verified payment</Button>}>
      <form id="receipt-form" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}><span>Bank receipt</span><strong>Record a new verified receipt</strong><small>{a.name} · {a.code}</small></div>
        <label className="ds-field"><span>Payment date</span><input className="ds-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="ds-field"><span>Amount received · ₹</span><input className="ds-input" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label className="ds-field"><span>Method</span><select className="ds-select" value={method} onChange={(e) => setMethod(e.target.value)}><option>Bank Transfer</option><option>UPI</option><option>Cheque</option></select></label>
        <label className="ds-field"><span>Bank / payment reference</span><input className="ds-input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="ds-check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I verified the company payment in the bank / collection records.</label>
        <p className="text-[11px] text-faint">This records a completed receipt. No actual payment is initiated. The same reference cannot be credited twice.</p>
      </form>
    </Modal>
  );
}

function RateForm({ a, onClose, onSaved }: { a: BusinessAccount; onClose: () => void; onSaved: () => void }) {
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [services, setServices] = useState<TravelService[]>([]);
  const [cats, setCats] = useState<VehicleCategory[]>([]);
  useEffect(() => { const u = [subscribeLocations(setLocations), subscribeServices(setServices), subscribeVehicleCategories(setCats)]; return () => u.forEach((x) => x()); }, []);
  const zones = Array.from(new Set(locations.filter((l) => l.status === "Active").map((l) => l.city || l.name))).sort();
  const [r, setR] = useState<Omit<ContractRate, "id">>({ pickupZone: "", dropZone: "", service: "One Way", category: "", contractType: "Fixed fare", priceEntered: "Including GST", customerRate: 0, partnerPayout: 0, active: true, peak: false, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<typeof r>) => setR({ ...r, ...p });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!r.pickupZone || !r.dropZone || !r.category) return setError("Choose the pickup zone, drop zone and car category.");
    if (!(r.customerRate > 0) || !(r.partnerPayout > 0)) return setError("Enter valid customer fare and partner payout.");
    if (r.contractType === "Fixed fare" && r.partnerPayout > r.customerRate) return setError("The partner payout cannot exceed the customer fare.");
    if (r.reason.trim().length < 3) return setError("Record the reason for this contract change.");
    setBusy(true);
    try {
      await saveContractRates(a.id, [...(a.contractRates ?? []), { ...r, id: `R${Date.now().toString(36)}`, updatedAt: new Date().toISOString() }], r.reason);
      onSaved();
    } catch { setError("The contract rate was not saved."); setBusy(false); }
  };
  return (
    <Modal title="Add B2B contract rate" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="rate-form" loading={busy}>Save contract rate</Button>}>
      <form id="rate-form" onSubmit={save} className="ds-form-grid" noValidate>
        {error && <div className="ds-error" role="alert" data-span="2">{error}</div>}
        <label className="ds-field"><span>Pickup zone</span><select className="ds-select" value={r.pickupZone} onChange={(e) => set({ pickupZone: e.target.value })}><option value="">Choose zone</option>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
        <label className="ds-field"><span>Drop zone</span><select className="ds-select" value={r.dropZone} onChange={(e) => set({ dropZone: e.target.value })}><option value="">Choose zone</option>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
        <label className="ds-field"><span>Service</span><select className="ds-select" value={r.service} onChange={(e) => set({ service: e.target.value })}>{["One Way", "Round Trip", "Airport", "Multicity", "Local Rental", "Local Pickup & Drop", ...services.map((s) => s.name)].filter((v, i, x) => x.indexOf(v) === i).map((s) => <option key={s}>{s}</option>)}</select></label>
        <label className="ds-field"><span>Car category</span><select className="ds-select" value={r.category} onChange={(e) => set({ category: e.target.value })}><option value="">Choose category</option>{cats.map((c) => <option key={c.id}>{c.name}</option>)}</select></label>
        <label className="ds-field"><span>Contract type</span><select className="ds-select" value={r.contractType} onChange={(e) => set({ contractType: e.target.value as ContractRate["contractType"] })}><option>Fixed fare</option><option>Per km</option></select></label>
        <label className="ds-field"><span>Price entered</span><select className="ds-select" value={r.priceEntered} onChange={(e) => set({ priceEntered: e.target.value as ContractRate["priceEntered"] })}><option>Including GST</option><option>Excluding GST</option></select></label>
        <label className="ds-field"><span>{r.contractType === "Fixed fare" ? "Customer fixed fare · ₹" : "Customer rate · ₹ / km"}</span><input className="ds-input" type="number" min={1} value={r.customerRate || ""} onChange={(e) => set({ customerRate: Number(e.target.value) })} /></label>
        <label className="ds-field"><span>{r.contractType === "Fixed fare" ? "Partner payout · ₹" : "Partner rate · ₹ / km"}</span><input className="ds-input" type="number" min={1} value={r.partnerPayout || ""} onChange={(e) => set({ partnerPayout: Number(e.target.value) })} /></label>
        <label className="ds-check"><input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} />Active</label>
        <label className="ds-check"><input type="checkbox" checked={r.peak} onChange={(e) => set({ peak: e.target.checked })} />Apply peak adjustment</label>
        <label className="ds-field" data-span="2"><span>Reason for this contract change</span><input className="ds-input" value={r.reason} onChange={(e) => set({ reason: e.target.value })} /></label>
      </form>
    </Modal>
  );
}

function CredentialForm({ a, onClose }: { a: BusinessAccount; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState(`${a.name} booking API`);
  const [scopes, setScopes] = useState<string[]>(["quotes:write", "bookings:write", "bookings:read"]);
  const [days, setDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ALL = ["quotes:write", "bookings:write", "bookings:read", "accounts:read"];
  return (
    <Modal title="Create API credential" onClose={onClose} busy={busy} footer={secret ? <Button variant="primary" onClick={onClose}>Done</Button> : <Button variant="primary" loading={busy} onClick={async () => {
      if (busy) return;
      if (!scopes.length || !Number.isInteger(days) || days < 1 || days > 365) { setError("Choose at least one scope and validity from 1 to 365 days."); return; }
      setBusy(true); setError(null);
      try { setSecret(await createCredential(a.id, label.trim() || "API credential", scopes, days)); }
      catch (err) { setError(err instanceof Error ? err.message : "Credential creation failed. Please try again."); }
      finally { setBusy(false); }
    }}>Create credential</Button>}>
      {error && <div className="ds-error" role="alert">{error}</div>}
      {secret ? (
        <div className="grid gap-3">
          <p className="ds-note">Copy this secret now. It is shown once; NESAM keeps only its fingerprint.</p>
          <code className="block p-3 rounded-lg bg-surface-2 border border-line text-[12px] break-all">{secret}</code>
          <Button icon="copy" onClick={() => navigator.clipboard.writeText(secret).catch(() => setError("Copy failed. Select and copy the secret shown above."))}>Copy secret</Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <label className="ds-field"><span>Credential name</span><input className="ds-input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
          <fieldset className="grid gap-2"><legend className="text-[11px] text-muted mb-1">Scopes</legend>{ALL.map((s) => <label key={s} className="ds-check"><input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />{s}</label>)}</fieldset>
          <label className="ds-field"><span>Valid for · days</span><input className="ds-input" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        </div>
      )}
    </Modal>
  );
}
