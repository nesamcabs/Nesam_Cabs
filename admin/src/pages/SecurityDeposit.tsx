import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { db, auth } from "../services/firebase";
import { callFunction } from "../services/callables";
import { describeDataError, subscribeVendors } from "../services/adminFirestoreService";
import { useCan } from "../components/AccessContext";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../components/FormKit";
import { formatDateTime12 } from "../utils/time";
import type { Vendor } from "../types";

// Security deposit desk. Two things live here:
//   1. The policy: whether a refundable security deposit is mandatory for vendors and how much (settings/security_deposit). The
//      Partner app reads it and shows the deposit as required on the Wallet, with what is still to pay.
//   2. What each partner has paid (partner_deposits, written by setSecurityDeposit and by the online top-up in the Partner app).
// Recording or correcting a partner's deposit goes through setSecurityDeposit (functions/src/partnerOps.ts); the policy is a
// settings document, writable by finance.

const DEPOSIT_STATUSES = ["Not paid", "Active", "Refund requested", "Refunded", "Adjusted"] as const;
const MAX_AMOUNT = 1000000;

interface Deposit { id: string; partyType: string; partyId: string; amount: number; status: string; reference: string; updatedAt: Date | null }
interface Policy { vendorRequired: boolean; vendorAmount: number; message: string; updatedAt: Date | null }

const dateOf = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === "function" ? (v as Timestamp).toDate() : null);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rupee = (v: number) => `₹${v.toLocaleString("en-IN")}`;
const APPROVED = ["Approved", "APPROVED", "Active"];

const PILL = {
  ok: "bg-ok-bg border-ok-line text-ok",
  warn: "bg-warn-bg border-warn-line text-warn",
  bad: "bg-red-50 border-red-200 text-red-700",
  neutral: "bg-neutral-bg border-line text-muted",
} as const;

interface Row { key: string; deposit: Deposit | null; partyType: "vendor" | "driver"; partyId: string; name: string; paid: number; required: number; due: number; state: "Complete" | "Partly paid" | "Not paid" | "Refund requested" | "Refunded" | "Adjusted" | "Not required" }

export default function SecurityDeposit() {
  const canFinance = useCan("finance");
  const { toast, show } = useToast(6000);
  const [policy, setPolicy] = useState<Policy | null | undefined>(undefined);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "complete" | "refund">("all");
  const [depositFor, setDepositFor] = useState<Partial<Deposit> | null>(null);

  // Form for the policy
  const [required, setRequired] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setLoadError("");
    const fail = () => setLoadError("The security deposit data could not be loaded. Check your access and connection.");
    const unsubs = [
      onSnapshot(doc(db, "settings", "security_deposit"), (snap) => {
        const d = snap.data();
        setPolicy(d ? { vendorRequired: d.vendorRequired === true, vendorAmount: n(d.vendorAmount), message: s(d.message), updatedAt: dateOf(d.updatedAt) } : null);
      }, () => { fail(); setPolicy(null); }),
      onSnapshot(collection(db, "partner_deposits"), (snap) => setDeposits(snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, partyType: s(x.partyType), partyId: s(x.partyId), amount: n(x.amount), status: s(x.status) || "Not paid", reference: s(x.reference), updatedAt: dateOf(x.updatedAt) };
      })), fail),
      subscribeVendors(setVendors, fail),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  // Fill the form from the stored policy until the office starts editing.
  useEffect(() => {
    if (policy === undefined || dirty) return;
    setRequired(policy?.vendorRequired ?? false);
    setAmount(policy ? String(policy.vendorAmount) : "");
    setMessage(policy?.message ?? "");
  }, [policy, dirty]);

  const requiredAmount = policy?.vendorRequired ? policy.vendorAmount : 0;

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(deposits.map((d) => [d.id, d]));
    const out: Row[] = [];
    for (const v of vendors.filter((x) => APPROVED.includes(x.status))) {
      const d = byId.get(`vendor_${v.id}`) ?? null;
      byId.delete(`vendor_${v.id}`);
      out.push(rowOf("vendor", v.id, v.companyName || v.name || v.id, d, requiredAmount));
    }
    // Vendors no longer in the approved list and owner-drivers keep their deposit rows (no requirement applies to drivers here).
    for (const d of byId.values()) {
      const vendor = d.partyType === "vendor" ? vendors.find((v) => v.id === d.partyId) : undefined;
      out.push(rowOf(d.partyType === "vendor" ? "vendor" : "driver", d.partyId, d.partyType === "vendor" ? vendor?.companyName || d.partyId : d.partyId, d, d.partyType === "vendor" ? requiredAmount : 0));
    }
    return out;
  }, [deposits, vendors, requiredAmount]);

  const shown = rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (q && !`${r.name} ${r.partyId}`.toLowerCase().includes(q)) return false;
    if (filter === "due") return r.due > 0 && r.partyType === "vendor" && r.state !== "Refund requested" && r.state !== "Refunded" && r.state !== "Adjusted";
    if (filter === "complete") return r.state === "Complete";
    if (filter === "refund") return r.state === "Refund requested";
    return true;
  });
  const vendorRows = rows.filter((r) => r.partyType === "vendor");
  const completeCount = vendorRows.filter((r) => r.state === "Complete").length;
  const dueCount = vendorRows.filter((r) => r.due > 0 && ["Not paid", "Partly paid"].includes(r.state)).length;
  const held = deposits.filter((d) => d.status === "Active").reduce((sum, d) => sum + d.amount, 0);

  const value = Number(amount);
  const problem = required && (!amount || !Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT) ? `Enter the required deposit in whole rupees (up to ${rupee(MAX_AMOUNT)}).` : null;
  const stored = policy ? { required: policy.vendorRequired, amount: policy.vendorAmount, message: policy.message } : { required: false, amount: 0, message: "" };
  const changed = dirty && (required !== stored.required || (required && value !== stored.amount) || message.trim() !== stored.message);

  const savePolicy = async () => {
    if (problem || busy || !canFinance) return;
    setBusy(true); setFormError("");
    try {
      await setDoc(doc(db, "settings", "security_deposit"), {
        vendorRequired: required,
        vendorAmount: required ? value : (policy?.vendorAmount ?? 0),
        message: message.trim().slice(0, 240),
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid ?? "",
      }, { merge: true });
      setDirty(false);
      show(required ? `Security deposit is now mandatory: ${rupee(value)} for every vendor.` : "Security deposit is no longer mandatory.");
    } catch (e) {
      setFormError(describeDataError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}
      <div>
        <h1 className="text-xl font-bold text-ink">Security deposit</h1>
        <p className="text-sm text-muted">
          Set the refundable deposit every vendor must hold with NESAM. It is kept apart from the working wallet and refunded at full &amp; final settlement.
          The Partner app shows it as mandatory, with the amount still to pay.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Required per vendor", value: policy === undefined ? "—" : policy?.vendorRequired ? rupee(policy.vendorAmount) : "Not set", tone: policy?.vendorRequired ? "text-ink" : "text-muted" },
          { label: "Vendors complete", value: `${completeCount} / ${vendorRows.length}`, tone: "text-ok" },
          { label: "Vendors with deposit due", value: dueCount, tone: dueCount ? "text-amber-700" : "" },
          { label: "Deposits held", value: rupee(held), tone: "" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className={`text-2xl font-bold ${c.tone || "text-ink"}`}>{c.value}</div>
            <div className="text-sm text-muted mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      <section className="bg-white rounded-xl border border-line shadow-sm">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-ink flex items-center gap-2"><span className="w-1 h-4 rounded-full bg-brand" />Deposit policy</h2>
            <p className="text-sm text-muted mt-1">Applies to every vendor. Changing the amount updates what each vendor still has to pay; deposits already received are not touched.</p>
          </div>
          <span className={`inline-block px-2.5 py-1 rounded-md border text-xs font-semibold whitespace-nowrap ${policy?.vendorRequired ? PILL.ok : PILL.neutral}`}>
            {policy === undefined ? "Loading…" : policy?.vendorRequired ? "Mandatory for vendors" : "Not mandatory"}
          </span>
        </div>

        <div className="p-5 space-y-4">
          {!canFinance && <Notice tone="info">You can view the policy. Changing it needs finance permission.</Notice>}
          <fieldset disabled={!canFinance || busy || policy === undefined} className="border-0 p-0 m-0 grid grid-cols-1 lg:grid-cols-[minmax(280px,360px)_1fr] gap-x-8 gap-y-5">
            <div className="space-y-4">
              <label className={`flex items-start gap-3 rounded-lg border p-3.5 cursor-pointer ${required ? "border-brand bg-brand-soft/40" : "border-line bg-surface-2"}`}>
                <input type="checkbox" className="w-4 h-4 mt-0.5 accent-brand" checked={required} onChange={(e) => { setRequired(e.target.checked); setDirty(true); setFormError(""); }} />
                <span>
                  <span className="block text-sm font-semibold text-ink">Security deposit is mandatory</span>
                  <span className="block text-xs text-muted mt-0.5">Vendors see it as required on their Wallet until it is fully paid.</span>
                </span>
              </label>
              <Field label="Required deposit (₹)" required={required} hint={required ? "Whole rupees. Vendors pay this in full or in parts." : "Turn the option on to set an amount."}>
                <input className={inputCls} inputMode="numeric" value={amount} disabled={!required} placeholder="e.g. 25000"
                  onChange={(e) => { setAmount(e.target.value.replace(/\D/g, "").slice(0, 7)); setDirty(true); setFormError(""); }} />
              </Field>
            </div>
            <Field label="Note shown to vendors (optional)" hint="One or two lines on the Wallet, for example why it is needed or how to pay." className="flex flex-col">
              <textarea className={`${inputCls} min-h-[150px] flex-1 resize-y`} maxLength={240} value={message} onChange={(e) => { setMessage(e.target.value); setDirty(true); }} />
              <span className="block text-right text-xs text-muted mt-1">{message.length} / 240</span>
            </Field>
          </fieldset>
          {(problem && dirty) && <Notice tone="error">{problem}</Notice>}
          {formError && <Notice tone="error">{formError}</Notice>}
        </div>

        <div className="px-5 py-3 border-t border-line bg-surface-2 rounded-b-xl flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs text-muted">{policy?.updatedAt ? `Last saved ${formatDateTime12(policy.updatedAt)}` : policy === null ? "No policy saved yet." : ""}</span>
          <div className="flex gap-2">
            {dirty && <button className={secondaryBtn} disabled={busy} onClick={() => { setDirty(false); setFormError(""); }}>Reset</button>}
            <button className={primaryBtn} disabled={!canFinance || !changed || !!problem || busy} onClick={savePolicy}>{busy ? "Saving…" : "Save policy"}</button>
          </div>
        </div>
      </section>

      <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-line bg-surface-2 flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${inputCls} !w-56`} placeholder="Search vendor or ID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search deposits" />
            <select className={`${inputCls} !w-44`} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter deposits">
              <option value="all">All partners</option>
              <option value="due">Deposit due</option>
              <option value="complete">Complete</option>
              <option value="refund">Refund requested</option>
            </select>
          </div>
          {canFinance && <button className={primaryBtn} onClick={() => setDepositFor({ partyType: "vendor", partyId: "", amount: 0, status: "Active", reference: "" })}>Record a deposit</button>}
        </div>
        {shown.length === 0 ? <div className="py-12 text-center text-sm text-muted">No partners match.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2">
                <tr><th className="px-4 py-2.5">Partner</th><th className="px-4 py-2.5">Required</th><th className="px-4 py-2.5">Paid</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Reference</th><th className="px-4 py-2.5">Updated</th><th className="px-4 py-2.5" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((r) => (
                  <tr key={r.key} className="hover:bg-surface-2">
                    <td className="px-4 py-3"><div className="font-semibold text-ink">{r.name}</div><div className="text-xs text-muted">{r.partyType === "vendor" ? "Vendor" : "Owner-driver"}</div></td>
                    <td className="px-4 py-3 text-body">{r.partyType === "vendor" && requiredAmount ? rupee(r.required) : "—"}</td>
                    <td className="px-4 py-3 font-semibold">{rupee(r.paid)}</td>
                    <td className={`px-4 py-3 ${r.due > 0 ? "font-semibold text-amber-700" : "text-muted"}`}>{r.due > 0 ? rupee(r.due) : "—"}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${pillOf(r.state)}`}>{r.state}</span></td>
                    <td className="px-4 py-3 text-muted">{r.deposit?.reference || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{formatDateTime12(r.deposit?.updatedAt ?? null) || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {canFinance && <button className={secondaryBtn} onClick={() => setDepositFor(r.deposit ?? { partyType: r.partyType, partyId: r.partyId, amount: 0, status: "Active", reference: "" })}>{r.deposit ? "Update" : "Record"}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {depositFor && <DepositSheet initial={depositFor} vendors={vendors} onClose={() => setDepositFor(null)} onDone={(m) => { show(m); setDepositFor(null); }} />}
    </div>
  );
}

function rowOf(partyType: "vendor" | "driver", partyId: string, name: string, deposit: Deposit | null, requiredAmount: number): Row {
  const paid = deposit && ["Active", "Refund requested"].includes(deposit.status) ? deposit.amount : 0;
  const required = partyType === "vendor" ? requiredAmount : 0;
  const status = deposit?.status ?? "Not paid";
  let state: Row["state"];
  if (status === "Refund requested" || status === "Refunded" || status === "Adjusted") state = status;
  else if (!required) state = paid > 0 ? "Complete" : "Not required";
  else state = paid >= required ? "Complete" : paid > 0 ? "Partly paid" : "Not paid";
  return { key: `${partyType}_${partyId}`, deposit, partyType, partyId, name, paid, required, due: Math.max(0, required - paid), state };
}

function pillOf(state: Row["state"]): string {
  if (state === "Complete") return PILL.ok;
  if (state === "Partly paid" || state === "Refund requested") return PILL.warn;
  if (state === "Not paid") return PILL.bad;
  return PILL.neutral;
}

function DepositSheet({ initial, vendors, onClose, onDone }: { initial: Partial<Deposit>; vendors: Vendor[]; onClose: () => void; onDone: (m: string) => void }) {
  const [partyType, setPartyType] = useState(initial.partyType === "driver" ? "driver" : "vendor");
  const [partyId, setPartyId] = useState(initial.partyId || "");
  const [amount, setAmount] = useState(String(initial.amount ?? ""));
  const [status, setStatus] = useState(initial.status && initial.status !== "Not paid" ? initial.status : "Active");
  const [reference, setReference] = useState(initial.reference || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = !!initial.partyId;

  const save = async () => {
    setError("");
    const value = Number(amount);
    if (!partyId) { setError("Choose the partner."); return; }
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT) { setError("Enter the deposit in whole rupees."); return; }
    setBusy(true);
    try {
      await callFunction("setSecurityDeposit", { partyType, partyId, amount: value, status, reference: reference.trim() });
      onDone("Security deposit saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={editing ? "Update security deposit" : "Record a security deposit"} onClose={onClose} busy={busy} centered
      footer={<div className="flex gap-2 justify-end"><button className={secondaryBtn} onClick={onClose} disabled={busy}>Cancel</button><button className={primaryBtn} onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>}>
      <div className="space-y-3">
        {!editing && (
          <Field label="Partner type">
            <select className={inputCls} value={partyType} onChange={(e) => { setPartyType(e.target.value as "vendor" | "driver"); setPartyId(""); }}>
              <option value="vendor">Vendor</option>
              <option value="driver">Owner-driver</option>
            </select>
          </Field>
        )}
        {!editing && partyType === "vendor" ? (
          <Field label="Vendor" required>
            <select className={inputCls} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              <option value="">Select a vendor</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name || v.id}</option>)}
            </select>
          </Field>
        ) : !editing ? (
          <Field label="Driver ID" required hint="The driver's account ID (Driver Partners → driver → ID).">
            <input className={inputCls} value={partyId} onChange={(e) => setPartyId(e.target.value.trim())} />
          </Field>
        ) : null}
        <Field label="Amount held (₹)" required hint="The total deposit held for this partner, not the amount being added."><input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{DEPOSIT_STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Receipt / reference"><input className={inputCls} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
