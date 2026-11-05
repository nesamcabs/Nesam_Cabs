import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, type Timestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { db, storage } from "../services/firebase";
import { callFunction } from "../services/callables";
import { subscribeVendors } from "../services/adminFirestoreService";
import { useCan } from "../components/AccessContext";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../components/FormKit";
import { formatDateTime12 } from "../utils/time";
import type { Vendor } from "../types";

// Office desk for requests that partners (owner-drivers and vendors) send from the Driver and Partner apps:
// duty cancellation (with the charge quoted when the request was submitted), bank-detail changes and document
// renewals. Also the security deposit of each partner and their working-wallet recharges.
// Every decision goes through decidePartnerRequest / setSecurityDeposit (functions/src/partnerOps.ts).

type RequestType = "cancellation" | "bank_change" | "document_renewal";
type RequestStatus = "Pending" | "Approved" | "Declined";

interface PartnerRequest {
  id: string;
  type: RequestType;
  status: RequestStatus;
  partyType: "driver" | "vendor";
  partyId: string;
  partyName: string;
  bookingId: string;
  bookingCode: string;
  route: string;
  pickupAt: Date | null;
  acceptedAt: Date | null;
  requestedAt: Date | null;
  reasonLabel: string;
  details: string;
  quotedPenalty: number;
  ruleLabel: string;
  finalPenalty: number | null;
  adminReason: string;
  decidedByName: string;
  decidedAt: Date | null;
  accountHolder: string;
  accountLast4: string;
  ifsc: string;
  note: string;
  entityType: string;
  entityName: string;
  documentLabel: string;
  expiry: string;
  previousExpiry: string;
  filePath: string;
  fileName: string;
}

interface Deposit { id: string; partyType: string; partyId: string; amount: number; status: string; reference: string; updatedAt: Date | null }
interface Recharge { id: string; kind: "recharge" | "dues"; partyType: string; partyName: string; amount: number; status: string; paymentId: string; createdAt: Date | null; applied: number; held: number; review: boolean }

const dateOf = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === "function" ? (v as Timestamp).toDate() : null);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rupee = (v: number) => `₹${v.toLocaleString("en-IN")}`;

function toRequest(id: string, d: Record<string, unknown>): PartnerRequest {
  return {
    id, type: (s(d.type) || "cancellation") as RequestType, status: (s(d.status) || "Pending") as RequestStatus,
    partyType: d.partyType === "vendor" ? "vendor" : "driver", partyId: s(d.partyId), partyName: s(d.partyName),
    bookingId: s(d.bookingId), bookingCode: s(d.bookingCode), route: s(d.route), pickupAt: dateOf(d.pickupAt), acceptedAt: dateOf(d.acceptedAt),
    requestedAt: dateOf(d.requestedAt) ?? dateOf(d.createdAt), reasonLabel: s(d.reasonLabel), details: s(d.details), quotedPenalty: n(d.quotedPenalty),
    ruleLabel: s(d.ruleLabel), finalPenalty: typeof d.finalPenalty === "number" ? d.finalPenalty : null, adminReason: s(d.adminReason),
    decidedByName: s(d.decidedByName), decidedAt: dateOf(d.decidedAt), accountHolder: s(d.accountHolder), accountLast4: s(d.accountLast4), ifsc: s(d.ifsc), note: s(d.note),
    entityType: s(d.entityType), entityName: s(d.entityName), documentLabel: s(d.documentLabel), expiry: s(d.expiry), previousExpiry: s(d.previousExpiry),
    filePath: s(d.filePath), fileName: s(d.fileName),
  };
}

const TYPE_LABEL: Record<RequestType, string> = { cancellation: "Duty cancellation", bank_change: "Bank change", document_renewal: "Document renewal" };
const PILL: Record<RequestStatus, string> = {
  Pending: "bg-warn-bg border-warn-line text-warn",
  Approved: "bg-ok-bg border-ok-line text-ok",
  Declined: "bg-neutral-bg border-line text-muted",
};
const DEPOSIT_STATUSES = ["Not paid", "Active", "Refund requested", "Refunded", "Adjusted"] as const;

type Tab = "pending" | "cancellation" | "bank_change" | "document_renewal" | "deposits" | "recharges";

export default function PartnerRequests({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const [requests, setRequests] = useState<PartnerRequest[]>([]);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [recharges, setRecharges] = useState<Recharge[]>([]);
  const [duePayments, setDuePayments] = useState<Recharge[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [tab, setTab] = useState<Tab>("pending");
  const [selected, setSelected] = useState<string | null>(null);
  const [depositFor, setDepositFor] = useState<Partial<Deposit> | null>(null);
  const { toast, show } = useToast(6000);
  const canFinance = useCan("finance");

  useEffect(() => {
    setLoadError("");
    const fail = () => setLoadError("Partner requests could not be loaded. Check your access and connection.");
    const unsubs = [
      onSnapshot(query(collection(db, "partner_requests"), orderBy("createdAt", "desc"), limit(400)), (snap) => {
        setRequests(snap.docs.map((d) => toRequest(d.id, d.data())));
        setLoading(false);
      }, () => { fail(); setLoading(false); }),
      subscribeVendors(setVendors),
    ];
    if (canFinance) {
      unsubs.push(onSnapshot(collection(db, "partner_deposits"), (snap) => setDeposits(snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, partyType: s(x.partyType), partyId: s(x.partyId), amount: n(x.amount), status: s(x.status) || "Not paid", reference: s(x.reference), updatedAt: dateOf(x.updatedAt) };
      })), () => undefined));
      unsubs.push(onSnapshot(query(collection(db, "wallet_recharges"), orderBy("createdAt", "desc"), limit(200)), (snap) => setRecharges(snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, kind: "recharge" as const, partyType: s(x.partyType), partyName: s(x.partyName), amount: n(x.amount), status: s(x.status), paymentId: s(x.paymentId), createdAt: dateOf(x.createdAt), applied: 0, held: 0, review: false };
      })), () => undefined));
      unsubs.push(onSnapshot(query(collection(db, "due_payments"), orderBy("createdAt", "desc"), limit(200)), (snap) => setDuePayments(snap.docs.map((d) => {
        const x = d.data();
        const paymentIds = [s(x.paymentId), ...(Array.isArray(x.unmatchedPaymentIds) ? x.unmatchedPaymentIds.map(s) : [])].filter(Boolean);
        return {
          id: d.id, kind: "dues" as const, partyType: s(x.partyType), partyName: s(x.partyName),
          amount: n(x.totalCapturedPaise ?? x.capturedPaise) / 100, status: s(x.status),
          paymentId: [...new Set(paymentIds)].join(", "), createdAt: dateOf(x.createdAt),
          applied: n(x.totalAppliedPaise ?? x.appliedPaise) / 100,
          held: n(x.totalHeldPaise ?? x.heldPaise) / 100, review: x.reconciliation === "review",
        };
      })), () => undefined));
    }
    return () => unsubs.forEach((u) => u());
  }, [retryKey, canFinance]);

  const payments = useMemo(
    () => [...recharges, ...duePayments].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
    [recharges, duePayments],
  );
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.companyName || id;
  const pending = requests.filter((r) => r.status === "Pending");
  const list = useMemo(() => {
    if (tab === "pending") return pending;
    return requests.filter((r) => r.type === tab);
  }, [tab, requests, pending]);
  const current = requests.find((r) => r.id === selected) || null;

  const tabs: [Tab, string, number?][] = [
    ["pending", "Needs decision", pending.length],
    ["cancellation", "Cancellations"],
    ["bank_change", "Bank changes"],
    ["document_renewal", "Document renewals"],
    ...(canFinance ? ([["deposits", "Security deposits"], ["recharges", "Payments", duePayments.filter((r) => r.review).length]] as [Tab, string, number?][]) : []),
  ];

  return (
    <div className="p-4 md:p-6 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}
      <div>
        <h1 className="text-xl font-bold text-ink">Partner requests</h1>
        <p className="text-sm text-muted">
          Duty cancellations, bank changes and document renewals sent from the Driver and Partner apps. A duty stays with the partner until you approve its cancellation;
          the charge shown is the one quoted when the request was submitted — you can apply or waive it.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Needs decision", value: pending.length, tone: pending.length ? "text-amber-700" : "" },
          { label: "Cancellation requests", value: pending.filter((r) => r.type === "cancellation").length, tone: "" },
          { label: "Bank & document requests", value: pending.filter((r) => r.type !== "cancellation").length, tone: "" },
          { label: "All requests", value: requests.length, tone: "" },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-line shadow-sm p-4">
            <div className={`text-2xl font-bold ${c.tone || "text-ink"}`}>{loading ? "—" : c.value}</div>
            <div className="text-sm text-muted mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map(([id, label, count]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${tab === id ? "bg-ink text-white border-ink" : "bg-white text-body border-line-strong hover:bg-gray-50"}`}>
            {label}{count ? <span className="ml-2 text-xs bg-white/20 rounded-full px-1.5 py-0.5">{count}</span> : null}
          </button>
        ))}
      </div>

      {tab !== "deposits" && tab !== "recharges" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          {loading && <div className="py-12 text-center text-sm text-muted" role="status">Loading requests…</div>}
          {!loading && list.length === 0 && <div className="py-12 text-center text-sm text-muted">{tab === "pending" ? "Nothing is waiting for the office." : "No requests yet."}</div>}
          {!loading && list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2">
                  <tr><th className="px-4 py-2.5">Request</th><th className="px-4 py-2.5">Partner</th><th className="px-4 py-2.5">Details</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Asked</th><th className="px-4 py-2.5" /></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{TYPE_LABEL[r.type]}</div>
                        <div className="text-xs text-muted">{r.type === "cancellation" ? r.bookingCode : r.type === "document_renewal" ? `${r.documentLabel} · ${r.entityName}` : `Account ending ${r.accountLast4}`}</div>
                      </td>
                      <td className="px-4 py-3 text-body">{r.partyName || r.partyId}<div className="text-xs text-muted">{r.partyType === "vendor" ? "Vendor" : "Owner-driver"}</div></td>
                      <td className="px-4 py-3 text-body max-w-[22rem]">
                        {r.type === "cancellation" ? <>{r.reasonLabel} · potential charge {rupee(r.quotedPenalty)}<div className="text-xs text-muted">{r.ruleLabel}</div></>
                          : r.type === "document_renewal" ? <>New expiry {r.expiry}{r.previousExpiry ? <span className="text-muted"> (was {r.previousExpiry.slice(0, 10)})</span> : null}</>
                          : <>{r.accountHolder} · {r.ifsc}</>}
                      </td>
                      <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${PILL[r.status]}`}>{r.status}</span></td>
                      <td className="px-4 py-3 text-xs text-muted whitespace-nowrap">{formatDateTime12(r.requestedAt) || "—"}</td>
                      <td className="px-4 py-3 text-right"><button className={secondaryBtn} onClick={() => setSelected(r.id)}>{r.status === "Pending" ? "Review" : "View"}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "deposits" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted">Held separately from the working wallet; refunded at full &amp; final settlement.</span>
            <button className={primaryBtn} onClick={() => setDepositFor({ partyType: "vendor", partyId: "", amount: 0, status: "Active", reference: "" })}>Record a deposit</button>
          </div>
          {deposits.length === 0 ? <div className="py-12 text-center text-sm text-muted">No security deposits recorded.</div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2"><tr><th className="px-4 py-2.5">Partner</th><th className="px-4 py-2.5">Paid</th><th className="px-4 py-2.5">Applied to dues</th><th className="px-4 py-2.5">Held for review</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Reference</th><th className="px-4 py-2.5">Updated</th><th className="px-4 py-2.5" /></tr></thead>
              <tbody className="divide-y divide-line">
                {deposits.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-3">{d.partyType === "vendor" ? vendorName(d.partyId) : d.partyId}<div className="text-xs text-muted">{d.partyType}</div></td>
                    <td className="px-4 py-3 font-semibold">{rupee(d.amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded-md border text-xs font-semibold ${d.status === "Refund requested" ? PILL.Pending : d.status === "Active" ? PILL.Approved : PILL.Declined}`}>{d.status}</span></td>
                    <td className="px-4 py-3 text-muted">{d.reference || "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDateTime12(d.updatedAt) || "—"}</td>
                    <td className="px-4 py-3 text-right"><button className={secondaryBtn} onClick={() => setDepositFor(d)}>Update</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "recharges" && (
        <div className="bg-white rounded-xl border border-line shadow-sm overflow-hidden">
          {payments.length === 0 ? <div className="py-12 text-center text-sm text-muted">No partner payments yet.</div> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted bg-surface-2"><tr><th className="px-4 py-2.5">Partner</th><th className="px-4 py-2.5">Amount</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Payment</th><th className="px-4 py-2.5">Started</th></tr></thead>
              <tbody className="divide-y divide-line">
                {payments.map((r) => (
                  <tr key={r.kind + r.id}>
                    <td className="px-4 py-3">{r.partyName}<div className="text-xs text-muted">{r.partyType} · {r.kind === "dues" ? "Outstanding dues" : "Wallet recharge"}</div></td>
                    <td className="px-4 py-3 font-semibold">{rupee(r.amount)}</td>
                    <td className="px-4 py-3">{r.kind === "dues" && r.status !== "created" ? rupee(r.applied) : "—"}</td>
                    <td className={`px-4 py-3 ${r.held > 0 ? "font-semibold text-amber-700" : ""}`}>{r.held > 0 ? rupee(r.held) : "—"}</td>
                    <td className="px-4 py-3">
                      {r.kind === "dues"
                        ? r.status === "applied" ? r.review ? "Dues cleared · extra payment needs review" : "Dues cleared"
                          : r.status === "partly_applied" ? "Partly applied · needs finance review"
                          : r.status === "held" ? "Nothing applied · needs finance review"
                          : r.status === "failed" ? "Payment failed" : r.status === "superseded" ? "Superseded · not offered for payment" : "Awaiting payment"
                        : r.status === "credited" ? "Credited to wallet" : r.status === "failed" ? "Payment failed" : "Awaiting payment"}
                      {r.review ? <div className="text-xs text-amber-700">Held money is not withdrawable. Resolution (refund or release) is not enabled: the policy is not approved yet.</div> : null}
                    </td>
                    <td className="px-4 py-3 text-muted">{r.paymentId || r.id}</td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDateTime12(r.createdAt) || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {current && <RequestSheet request={current} onClose={() => setSelected(null)} onOpenBooking={onOpenBooking} onDone={(m) => { show(m); setSelected(null); }} onError={(m) => show(m, "error")} />}
      {depositFor && <DepositSheet initial={depositFor} vendors={vendors} onClose={() => setDepositFor(null)} onDone={(m) => { show(m); setDepositFor(null); }} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-2 border-b border-line text-sm"><span className="text-muted">{label}</span><span className="text-ink font-medium text-right">{children}</span></div>;
}

function RequestSheet({ request: r, onClose, onDone, onError, onOpenBooking }: { request: PartnerRequest; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void; onOpenBooking?: (id: string) => void }) {
  const [reason, setReason] = useState("");
  const [penalty, setPenalty] = useState<"apply" | "waive">(r.quotedPenalty > 0 ? "apply" : "waive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const pending = r.status === "Pending";

  useEffect(() => {
    if (!r.filePath) return;
    getDownloadURL(storageRef(storage, r.filePath)).then(setFileUrl).catch(() => setFileUrl(""));
  }, [r.filePath]);

  const decide = async (decision: "approve" | "decline") => {
    setError("");
    if (reason.trim().length < 5) { setError("Give a short reason (at least 5 characters). The partner sees it."); return; }
    setBusy(true);
    try {
      await callFunction("decidePartnerRequest", { requestId: r.id, decision, reason: reason.trim(), ...(r.type === "cancellation" && decision === "approve" ? { penalty } : {}) });
      onDone(decision === "approve" ? (r.type === "cancellation" ? `Duty released from ${r.partyName}. Assign it again from the booking.` : "Request approved.") : "Request declined.");
    } catch (e) {
      const m = (e as Error).message;
      setError(m);
      onError(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={TYPE_LABEL[r.type]} subtitle={`${r.partyName} · ${r.partyType === "vendor" ? "Vendor" : "Owner-driver"}`} onClose={onClose} busy={busy} size="lg"
      footer={pending ? (
        <div className="flex flex-wrap gap-2 justify-end">
          <button className={secondaryBtn} disabled={busy} onClick={() => decide("decline")}>Decline</button>
          <button className={primaryBtn} disabled={busy} onClick={() => decide("approve")}>{busy ? "Saving…" : r.type === "cancellation" ? "Approve cancellation" : "Approve"}</button>
        </div>
      ) : undefined}>
      <div className="space-y-4">
        {r.type === "cancellation" && (
          <>
            <div>
              <Row label="Booking">{r.bookingId && onOpenBooking ? <button className="text-brand font-semibold" onClick={() => onOpenBooking(r.bookingId)}>{r.bookingCode}</button> : r.bookingCode}</Row>
              <Row label="Route">{r.route}</Row>
              <Row label="Pickup">{formatDateTime12(r.pickupAt) || "—"}</Row>
              <Row label="Accepted">{formatDateTime12(r.acceptedAt) || "—"}</Row>
              <Row label="Requested">{formatDateTime12(r.requestedAt) || "—"}</Row>
              <Row label="Reason">{r.reasonLabel}</Row>
              <Row label="Quoted charge">{rupee(r.quotedPenalty)} <span className="text-muted font-normal">· {r.ruleLabel}</span></Row>
            </div>
            <div className="text-sm"><div className="text-muted mb-1">What happened</div><p className="text-ink whitespace-pre-wrap">{r.details}</p></div>
            {pending && (
              <>
                <Notice tone="info">Approving releases the duty back to “approved, awaiting fulfilment”. It is not re-published — assign or publish it again from the booking.</Notice>
                {r.quotedPenalty > 0 && (
                  <fieldset className="space-y-2">
                    <legend className="text-[12px] font-medium text-muted mb-1">Cancellation charge</legend>
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="penalty" checked={penalty === "apply"} onChange={() => setPenalty("apply")} /> Apply {rupee(r.quotedPenalty)} — debited from the partner wallet</label>
                    <label className="flex items-center gap-2 text-sm"><input type="radio" name="penalty" checked={penalty === "waive"} onChange={() => setPenalty("waive")} /> Waive — valid reason accepted</label>
                  </fieldset>
                )}
              </>
            )}
          </>
        )}
        {r.type === "bank_change" && (
          <div>
            <Row label="Account holder">{r.accountHolder}</Row>
            <Row label="New account ending">•••• {r.accountLast4}</Row>
            <Row label="IFSC">{r.ifsc}</Row>
            {r.note && <Row label="Note">{r.note}</Row>}
            {pending && <div className="mt-3"><Notice tone="warn">Verify the new account against a cancelled cheque or bank statement before approving.</Notice></div>}
          </div>
        )}
        {r.type === "document_renewal" && (
          <div>
            <Row label={r.entityType === "vehicle" ? "Vehicle" : "Driver"}>{r.entityName}</Row>
            <Row label="Document">{r.documentLabel}</Row>
            <Row label="Current expiry">{r.previousExpiry ? r.previousExpiry.slice(0, 10) : "—"}</Row>
            <Row label="New expiry">{r.expiry}</Row>
            <Row label="Renewed document">{fileUrl ? <a className="text-brand font-semibold" href={fileUrl} target="_blank" rel="noopener noreferrer">{r.fileName || "Open file"}</a> : "Loading…"}</Row>
          </div>
        )}
        {!pending && (
          <div>
            <Row label="Decision">{r.status}{r.decidedByName ? ` · ${r.decidedByName}` : ""}</Row>
            <Row label="Decided">{formatDateTime12(r.decidedAt) || "—"}</Row>
            {r.type === "cancellation" && r.status === "Approved" && <Row label="Charge">{rupee(r.finalPenalty ?? 0)}</Row>}
            <Row label="Office reason">{r.adminReason || "—"}</Row>
          </div>
        )}
        {pending && (
          <Field label="Reason (shown to the partner)" required error={error || null}>
            <textarea className={inputCls} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: Breakdown confirmed with photos; charge waived." />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function DepositSheet({ initial, vendors, onClose, onDone }: { initial: Partial<Deposit>; vendors: Vendor[]; onClose: () => void; onDone: (m: string) => void }) {
  const [partyType, setPartyType] = useState(initial.partyType === "driver" ? "driver" : "vendor");
  const [partyId, setPartyId] = useState(initial.partyId || "");
  const [amount, setAmount] = useState(String(initial.amount ?? ""));
  const [status, setStatus] = useState(initial.status || "Active");
  const [reference, setReference] = useState(initial.reference || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = !!initial.id;

  const save = async () => {
    setError("");
    const value = Number(amount);
    if (!partyId) { setError("Choose the partner."); return; }
    if (!Number.isSafeInteger(value) || value < 0) { setError("Enter the deposit in whole rupees."); return; }
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
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.id}</option>)}
            </select>
          </Field>
        ) : !editing ? (
          <Field label="Driver ID" required hint="The driver's account ID (Driver Partners → driver → ID).">
            <input className={inputCls} value={partyId} onChange={(e) => setPartyId(e.target.value.trim())} />
          </Field>
        ) : null}
        <Field label="Amount (₹)" required><input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></Field>
        <Field label="Status">
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>{DEPOSIT_STATUSES.map((x) => <option key={x}>{x}</option>)}</select>
        </Field>
        <Field label="Receipt / reference"><input className={inputCls} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} /></Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
