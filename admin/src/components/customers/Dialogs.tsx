import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Booking, Customer } from "../../types";
import Icon from "../ui/Icon";
import { ActionError } from "../../services/callables";
import { recordPayment, type PaymentMethodName } from "../../services/bookingOpsService";
import { findCustomersByMobile, NOTE_MIN, REVEAL_CATEGORIES, saveCustomerProfile, type CustomerInput } from "../../services/customerDirectoryService";
import { inr, isActiveStatus, isBlockedStatus, joinCompanyGstin, parseIndianMobile, splitCompanyGstin } from "../../domain/customerDirectory";
import { paymentOf } from "../../domain/bookingFlow";
import { CloseButton, Layer, useTitleId } from "./Layer";
import { BTN_ACTION, BTN_PRIMARY, BTN_SECONDARY, FIELD, FIELD_LABEL } from "./Parts";
import { customerCodeOf } from "./CustomerTable";

const msg = (e: unknown, fallback: string) => (e instanceof ActionError || e instanceof Error ? e.message : fallback);

// ── 1. Mandatory reason to view a number ─────────────────────────────────────────

export function RevealDialog({ customer, actor, onClose, onReveal }: {
  customer: Customer; actor: string; onClose: () => void;
  /** Resolves when the server has logged the view and returned the number; rejects (number stays masked) otherwise. */
  onReveal: (category: string, note: string) => Promise<void>;
}) {
  const titleId = useTitleId();
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = note.trim();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!category) return setError("Select a reason category.");
    if (trimmed.length < NOTE_MIN) return setError(`Enter a note of at least ${NOTE_MIN} characters (${trimmed.length} so far).`);
    setBusy(true);
    setError(null);
    try {
      await onReveal(category, trimmed);
    } catch (err) {
      setError(msg(err, "The number could not be revealed. It stays masked."));
      setBusy(false);
    }
  };
  return (
    <Layer kind="dialog" title="Mandatory reason required" labelledBy={titleId} onClose={onClose} busy={busy}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 bg-amber-50/60 rounded-t-[16px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0"><Icon name="eye" size={16} /></div>
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm leading-5 font-bold text-slate-900">Mandatory Reason Required</h3>
            <p className="text-[11px] leading-4 text-slate-600 break-words">{customer.name} ({customerCodeOf(customer)}) • Logging under {actor}</p>
          </div>
        </div>
        <CloseButton onClick={onClose} disabled={busy} />
      </div>
      <form onSubmit={submit} className="p-5 space-y-3.5 text-xs" noValidate>
        {error && <div role="alert" className="px-3 py-2 rounded-[12px] bg-red-50 border border-red-200 text-red-700 font-medium">{error}</div>}
        <div>
          <label htmlFor="cd-rr-cat" className={FIELD_LABEL}>Reason Category *</label>
          <select id="cd-rr-cat" data-autofocus required value={category} onChange={(e) => setCategory(e.target.value)} className={`${FIELD} font-semibold px-2.5`}>
            <option value="">-- Select valid reason --</option>
            {REVEAL_CATEGORIES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cd-rr-note" className={FIELD_LABEL}>Detailed Note (Min {NOTE_MIN} characters) *</label>
          <input id="cd-rr-note" required maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., Caller asked for Madurai round-trip quote confirmation" className={FIELD} aria-describedby="cd-rr-count" />
          <p id="cd-rr-count" className="mt-1 text-[11px] text-slate-400">{trimmed.length}/{NOTE_MIN} characters minimum</p>
        </div>
        <button type="submit" disabled={busy} className={`w-full py-2.5 rounded-[12px] shadow-xs ${BTN_PRIMARY}`}>{busy ? "Logging…" : "Log Reason & Reveal Number"}</button>
      </form>
    </Layer>
  );
}

// ── 2. Add / edit customer ───────────────────────────────────────────────────────

export const LEAD_SOURCES = ["Google Search", "WhatsApp Direct", "Repeat / Referral", "Justdial", "Airport Walk-in"] as const;
/** Reference cab choices, then the vehicle categories the office has set up. */
export const REFERENCE_CABS = ["Any Cab", "Hatchback", "Sedan", "SUV (Ertiga)", "Innova", "Innova Crysta"] as const;
export const cabChoices = (categories: string[], current?: string) =>
  [...new Set([...REFERENCE_CABS, ...categories.filter(Boolean), ...(current ? [current] : [])])];

type Group = "New" | "VIP" | "Corporate";

export function CustomerFormDialog({ customer, all, cabs, onClose, onSaved, onShowExisting }: {
  customer: Customer | null; all: Customer[]; cabs: string[]; onClose: () => void; onSaved: (text: string) => void;
  /** Opens a customer who already holds the typed mobile (instead of creating a duplicate). */
  onShowExisting?: (id: string) => void;
}) {
  const titleId = useTitleId();
  const editing = !!customer;
  const [f, setF] = useState(() => ({
    name: customer?.name ?? "",
    phone: "",
    email: customer?.email && customer.email !== "N/A" ? customer.email : "",
    city: customer?.city ?? "",
    gender: customer?.gender ?? "",
    notes: customer?.notes ?? "",
    group: "New" as Group,
    vip: customer?.isVip === true,
    corporate: customer?.isCorporate === true,
    lead: customer ? customer.leadSource ?? "" : (LEAD_SOURCES[0] as string),
    cab: customer?.preferredCab ?? (editing ? "" : "Any Cab"),
    driver: customer?.preferredDriver ?? "",
    companyGstin: joinCompanyGstin(customer?.company, customer?.gstin),
    status: customer && isBlockedStatus(customer.status) ? "Blocked" : "Active",
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupIds, setDupIds] = useState<string[]>([]);
  // The same identity rule as the server: a supported spelling of one 10-digit mobile, never a truncated longer number.
  const key = parseIndianMobile(f.phone) ?? "";

  // Duplicate check as the number is typed — by mobile only, never by name. The server answers with ids only; the
  // save re-checks inside a transaction. Existing records are reported, never merged or deleted here.
  useEffect(() => {
    if (editing || !key) { setDupIds([]); return; }
    let live = true;
    const t = window.setTimeout(() => { findCustomersByMobile(key).then((r) => live && setDupIds(r.ids)).catch(() => live && setDupIds([])); }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [key, editing]);
  const dup = dupIds.length ? all.find((c) => dupIds.includes(c.id)) : undefined;
  // Company / GSTIN belong to corporate (GST) customers; an edited record that already holds them always shows them.
  const showGst = editing ? f.corporate || !!(customer?.company || customer?.gstin) : f.group === "Corporate";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Enter the customer name.");
    if (!editing && !key) return setError("Enter a valid 10-digit Indian mobile number (+91, 0 and spaces are fine).");
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError("Enter a valid email address.");
    if (dupIds.length) return setError(`A customer with this mobile already exists${dup ? ` (${dup.name})` : ""}.`);
    const parsed = splitCompanyGstin(showGst ? f.companyGstin : "");
    if (showGst && /^[0-9A-Z]{15}$/i.test(f.companyGstin.trim()) && !parsed.gstin) return setError("Enter a valid 15-character GSTIN.");
    const common: CustomerInput = { name: f.name.trim(), city: f.city.trim(), preferredCab: f.cab === "Any Cab" ? "" : f.cab };
    // On an edit, company / GSTIN are sent only when the field was changed, so an untouched value is never re-parsed or overwritten.
    const cgChanged = showGst && f.companyGstin.trim() !== joinCompanyGstin(customer?.company, customer?.gstin);
    const input: CustomerInput = editing
      ? {
        ...common, customerId: customer!.id, email: f.email.trim(), gender: f.gender, notes: f.notes.trim(), preferredDriver: f.driver.trim(),
        isVip: f.vip, isCorporate: f.corporate,
        ...(cgChanged ? { company: parsed.company, gstin: parsed.gstin } : {}),
        ...(f.lead !== (customer!.leadSource ?? "") ? { leadSource: f.lead } : {}),
        ...(f.status !== (isBlockedStatus(customer!.status) ? "Blocked" : "Active") ? { status: f.status as "Active" | "Blocked" } : {}),
      }
      : { ...common, phone: f.phone, leadSource: f.lead, isVip: f.group === "VIP", isCorporate: f.group === "Corporate", company: parsed.company, gstin: parsed.gstin };
    setBusy(true);
    setError(null);
    try {
      await saveCustomerProfile(input);
      onSaved(editing ? `Saved ${f.name.trim()}.` : `Customer ${f.name.trim()} added!`);
    } catch (err) {
      setError(msg(err, "The customer was not saved. Check your connection and permissions, then try again."));
      setBusy(false);
    }
  };

  const historicalLead = editing && f.lead && !(LEAD_SOURCES as readonly string[]).includes(f.lead);
  const cabList = cabChoices(cabs, f.cab);
  const half = "col-span-2 sm:col-span-1";
  const req = <span className="text-crimson-800" aria-hidden="true"> *</span>;
  return (
    <Layer kind="dialog" size="form" title={editing ? "Edit customer" : "Add customer"} labelledBy={titleId} onClose={onClose} busy={busy}>
      <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h3 id={titleId} className="text-base leading-6 font-bold text-slate-900">{editing ? "Edit Customer" : "Add Customer"}</h3>
          <p className="text-xs leading-4 text-slate-500 mt-0.5">{editing ? `${customerCodeOf(customer!)} · the mobile number cannot be changed here` : "Fields marked * are required."}</p>
        </div>
        <CloseButton onClick={onClose} disabled={busy} />
      </div>
      <form id="cd-customer-form" onSubmit={save} className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-5 text-xs" noValidate aria-busy={busy}>
        {error && <div role="alert" className="px-3 py-2 rounded-[12px] bg-red-50 border border-red-200 text-red-700 font-medium">{error}</div>}

        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <legend className="sr-only">Customer details</legend>
          <div className={half}>
            <label htmlFor="cd-f-name" className={FIELD_LABEL}>Full name{req}</label>
            <input id="cd-f-name" data-autofocus required aria-required="true" maxLength={80} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g., Ramesh Kumar" className={FIELD} />
          </div>
          <div className={half}>
            <label htmlFor="cd-f-phone" className={FIELD_LABEL}>Mobile number{editing ? "" : req}</label>
            {editing
              ? <input id="cd-f-phone" disabled value={customer!.phoneMasked || "No number on file"} className={FIELD} />
              : <input id="cd-f-phone" type="tel" inputMode="tel" autoComplete="off" required aria-required="true" maxLength={20} value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile (+91 optional)" className={FIELD} aria-describedby="cd-f-dup" />}
            <p id="cd-f-dup" role="status" className="text-[11px] mt-1 text-red-700 empty:hidden">
              {dup ? `Already registered · ${dup.name} (${customerCodeOf(dup)})` : dupIds.length ? "Already registered to another customer" : ""}
              {dupIds.length > 1 && ` · ${dupIds.length} records share this number — review them; nothing is merged automatically.`}
            </p>
            {dup && onShowExisting && <button type="button" onClick={() => onShowExisting(dup.id)} className="mt-1 text-[11px] font-semibold text-crimson-800 hover:underline">Open existing customer</button>}
          </div>
          {editing ? (
            <>
              <div className={half}><label htmlFor="cd-f-status" className={FIELD_LABEL}>Status</label>
                <select id="cd-f-status" value={f.status} onChange={(e) => set("status", e.target.value)} className={`${FIELD} px-2.5`}><option>Active</option><option>Blocked</option></select>
                {customer && !isActiveStatus(customer.status) && !isBlockedStatus(customer.status) && <p className="text-[11px] text-slate-500 mt-1">Current status “{customer.status}” is kept unless you change it.</p>}</div>
              <fieldset className={half}><legend className={FIELD_LABEL}>Customer type</legend>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-h-10">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.vip} onChange={(e) => set("vip", e.target.checked)} />VIP</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={f.corporate} onChange={(e) => set("corporate", e.target.checked)} />Corporate (GST)</label>
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <div className={half}><label htmlFor="cd-f-group" className={FIELD_LABEL}>Customer type</label>
                <select id="cd-f-group" value={f.group} onChange={(e) => set("group", e.target.value as Group)} className={`${FIELD} px-2.5`}><option value="New">New</option><option value="VIP">Regular / VIP</option><option value="Corporate">Corporate (GST)</option></select></div>
              <div className={half}><label htmlFor="cd-f-lead" className={FIELD_LABEL}>Lead source</label>
                <select id="cd-f-lead" value={f.lead} onChange={(e) => set("lead", e.target.value)} className={`${FIELD} px-2.5`}>{LEAD_SOURCES.map((l) => <option key={l}>{l}</option>)}</select></div>
            </>
          )}
          {showGst && (
            <div className="col-span-2">
              <label htmlFor="cd-f-gst" className={FIELD_LABEL}>Company / GSTIN · optional</label>
              <input id="cd-f-gst" maxLength={140} value={f.companyGstin} onChange={(e) => set("companyGstin", e.target.value)} placeholder="e.g., 33AABCN1234F1Z5 • Company name" className={FIELD} aria-describedby="cd-f-gst-hint" />
              <p id="cd-f-gst-hint" className="text-[11px] text-slate-500 mt-1">Enter the company name, the 15-character GSTIN, or both.</p>
            </div>
          )}
        </fieldset>

        <div role="group" aria-labelledby="cd-f-optional" className="pt-4 border-t border-slate-100">
          <h4 id="cd-f-optional" className="text-[11px] leading-4 font-bold text-slate-700 mb-3">Optional details</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <div className={half}><label htmlFor="cd-f-city" className={FIELD_LABEL}>Primary city</label><input id="cd-f-city" maxLength={60} value={f.city} onChange={(e) => set("city", e.target.value)} placeholder="e.g., Madurai" className={FIELD} /></div>
          <div className={half}><label htmlFor="cd-f-cab" className={FIELD_LABEL}>Preferred cab</label>
            <select id="cd-f-cab" value={f.cab} onChange={(e) => set("cab", e.target.value)} className={`${FIELD} px-2.5`}>{editing && <option value="">Not set</option>}{cabList.map((c) => <option key={c}>{c}</option>)}</select></div>
          {editing && (
            <>
              <div className={half}><label htmlFor="cd-f-email" className={FIELD_LABEL}>Email</label><input id="cd-f-email" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} className={FIELD} /></div>
              <div className={half}><label htmlFor="cd-f-gender" className={FIELD_LABEL}>Gender</label>
                <select id="cd-f-gender" value={f.gender} onChange={(e) => set("gender", e.target.value)} className={`${FIELD} px-2.5`}><option value="">Not specified</option><option>Male</option><option>Female</option><option>Other</option></select></div>
              <div className={half}><label htmlFor="cd-f-lead2" className={FIELD_LABEL}>Lead source</label>
                <select id="cd-f-lead2" value={f.lead} onChange={(e) => set("lead", e.target.value)} className={`${FIELD} px-2.5`}><option value="">Not recorded</option>{historicalLead && <option>{f.lead}</option>}{LEAD_SOURCES.map((l) => <option key={l}>{l}</option>)}</select></div>
              <div className={half}><label htmlFor="cd-f-driver" className={FIELD_LABEL}>Preferred driver</label><input id="cd-f-driver" maxLength={60} value={f.driver} onChange={(e) => set("driver", e.target.value)} placeholder="e.g., Murugan S" className={FIELD} /></div>
              <div className="col-span-2"><label htmlFor="cd-f-notes" className={FIELD_LABEL}>Admin note</label><textarea id="cd-f-notes" rows={2} maxLength={300} value={f.notes} onChange={(e) => set("notes", e.target.value)} className={`${FIELD} h-auto py-2 resize-y`} /></div>
            </>
          )}
          </div>
        </div>
      </form>
      <div className="px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/60 rounded-b-[16px] flex items-center justify-end gap-2.5 shrink-0">
        <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>Cancel</button>
        <button type="submit" form="cd-customer-form" disabled={busy} className={`${BTN_ACTION} ${BTN_PRIMARY}`}>
          {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />}
          {busy ? "Saving…" : editing ? "Save changes" : "Save Customer"}
        </button>
      </div>
    </Layer>
  );
}

// ── 3. Mark paid: settles through the existing recordPayment flow ──────────────

type ItemState = { state: "idle" | "busy" | "done" | "failed"; error?: string };

export function MarkPaidDialog({ customer, items, onClose, onChanged }: {
  customer: Customer; items: Booking[]; onClose: () => void; onChanged: (text: string) => void;
}) {
  const titleId = useTitleId();
  // The list is frozen when the dialog opens so rows stay put while the live bookings refresh underneath.
  const [list] = useState(() => items.map((b) => ({ b, due: paymentOf(b).balanceDue })));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(list.map((x) => x.b.id)));
  const [method, setMethod] = useState<PaymentMethodName>("Cash");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [state, setState] = useState<Record<string, ItemState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per booking for the life of this dialog: a retry or a second click can never record twice.
  const ids = useRef(new Map<string, string>());
  const keyFor = (id: string) => { if (!ids.current.has(id)) ids.current.set(id, `pay_${crypto.randomUUID().replace(/-/g, "")}`); return ids.current.get(id)!; };

  const todo = list.filter((x) => picked.has(x.b.id) && state[x.b.id]?.state !== "done");
  const total = todo.reduce((n, x) => n + x.due, 0);
  const doneTotal = list.filter((x) => state[x.b.id]?.state === "done").reduce((n, x) => n + x.due, 0);

  const run = async () => {
    if (busy || !todo.length) return;
    if (method !== "Cash" && reference.trim().length < 4) return setError(`Enter the ${method === "UPI" ? "UPI transaction" : "transfer"} reference.`);
    setBusy(true);
    setError(null);
    let ok = 0, failed = 0;
    for (const { b, due } of todo) {
      setState((s) => ({ ...s, [b.id]: { state: "busy" } }));
      try {
        await recordPayment({ bookingId: b.id, amount: due, method, collectorType: "admin", reference: reference.trim(), notes: notes.trim() || `Settled from customer directory`, requestId: keyFor(b.id) });
        ok++;
        setState((s) => ({ ...s, [b.id]: { state: "done" } }));
      } catch (e) {
        failed++;
        setState((s) => ({ ...s, [b.id]: { state: "failed", error: msg(e, "Not recorded.") } }));
      }
    }
    setBusy(false);
    if (ok) onChanged(failed ? `${ok} recorded, ${failed} not recorded — retry the rest.` : `${inr(todo.reduce((n, x) => n + x.due, 0))} recorded for ${customer.name}.`);
    if (failed) setError(`${failed} booking${failed === 1 ? "" : "s"} could not be recorded. Nothing was recorded twice; retry when ready.`);
  };

  const allDone = list.length > 0 && list.every((x) => state[x.b.id]?.state === "done");
  return (
    <Layer kind="dialog" title="Mark paid" labelledBy={titleId} onClose={onClose} busy={busy}>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm leading-5 font-bold text-slate-900">Record settlement</h3>
          <p className="text-[11px] leading-4 text-slate-500 break-words">{customer.name} ({customerCodeOf(customer)}) · recorded through Accounts, one receipt per booking</p>
        </div>
        <CloseButton onClick={onClose} disabled={busy} />
      </div>
      <div className="p-5 space-y-3.5 text-xs">
        {error && <div role="alert" className="px-3 py-2 rounded-[12px] bg-red-50 border border-red-200 text-red-700 font-medium">{error}</div>}
        {list.length === 0 ? <p className="text-slate-500">No outstanding balance on completed trips.</p> : (
          <ul className="border border-slate-200 rounded-[12px] divide-y divide-slate-100 overflow-hidden">
            {list.map(({ b, due }) => {
              const st = state[b.id];
              return (
                <li key={b.id} className="p-3 flex items-start gap-2.5">
                  <input type="checkbox" aria-label={`Include ${b.bookingId || b.id}`} className="mt-0.5" checked={picked.has(b.id) || st?.state === "done"} disabled={busy || st?.state === "done"}
                    onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900 break-words">{b.bookingId || b.id} · {b.pickup} → {b.drop}</p>
                    <p className="text-[11px] text-slate-500">Balance due {inr(due)}</p>
                    {st?.state === "failed" && <p className="text-[11px] text-red-700 mt-0.5">{st.error}</p>}
                  </div>
                  <span className={`text-[11px] font-bold shrink-0 ${st?.state === "done" ? "text-emerald-700" : st?.state === "failed" ? "text-red-700" : "text-slate-400"}`}>
                    {st?.state === "done" ? "Recorded" : st?.state === "busy" ? "Recording…" : st?.state === "failed" ? "Failed" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!allDone && list.length > 0 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1"><label htmlFor="cd-mp-method" className={FIELD_LABEL}>Payment method</label>
                <select id="cd-mp-method" value={method} disabled={busy} onChange={(e) => setMethod(e.target.value as PaymentMethodName)} className={`${FIELD} px-2.5`}><option>Cash</option><option>UPI</option><option>Bank Transfer</option></select></div>
              {method !== "Cash" && <div className="col-span-2 sm:col-span-1"><label htmlFor="cd-mp-ref" className={FIELD_LABEL}>{method === "UPI" ? "UPI transaction ID" : "Transfer reference"}</label><input id="cd-mp-ref" maxLength={120} value={reference} disabled={busy} onChange={(e) => setReference(e.target.value)} className={FIELD} /></div>}
            </div>
            <div><label htmlFor="cd-mp-notes" className={FIELD_LABEL}>Notes</label><input id="cd-mp-notes" maxLength={300} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} className={FIELD} /></div>
            <p className="text-[11px] text-slate-500">Each payment is its own permanent record. A mistake is voided with a reason from the booking, not edited.</p>
          </>
        )}
        {doneTotal > 0 && <p role="status" className="text-emerald-700 font-semibold">{inr(doneTotal)} recorded so far.</p>}
        {allDone
          ? <button type="button" onClick={onClose} className={`w-full py-2.5 rounded-[12px] ${BTN_PRIMARY}`}>Done</button>
          : <button type="button" onClick={() => void run()} disabled={busy || !todo.length} className={`w-full py-2.5 rounded-[12px] ${BTN_PRIMARY}`}>
            {busy ? "Recording…" : Object.values(state).some((s) => s.state === "failed") ? `Retry ${todo.length} booking${todo.length === 1 ? "" : "s"} · ${inr(total)}` : `Confirm and record ${inr(total)} (${todo.length} booking${todo.length === 1 ? "" : "s"})`}
          </button>}
      </div>
    </Layer>
  );
}
