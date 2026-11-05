import { useEffect, useState } from "react";
import { getDownloadURL, ref as storageRef } from "firebase/storage";
import { storage } from "../../services/firebase";
import type { Booking } from "../../types";
import { Modal } from "../Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../FormKit";
import { ActionError } from "../../services/callables";
import { sendVerificationCode, verifyCustomerCode, type ChannelResult } from "../../services/bookingOpsService";
import { formatDateTime12, toDate } from "../../utils/time";
import { PaymentBadge } from "./BookingBadges";
import { paymentOf } from "../../domain/bookingFlow";

const rupees = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;
const when = (v: unknown) => formatDateTime12(toDate(v as never)) || "—";

// ── Payments ──────────────────────────────────────────────────────────────

export interface PaymentRow {
  id: string;
  amount: number;
  method: string;
  kind?: string;
  status?: string;
  collectorType?: string;
  collectorName?: string;
  reference?: string;
  notes?: string;
  paymentDate?: unknown;
  enteredByName?: string;
  voidReason?: string;
}

const COLLECTOR: Record<string, string> = { admin: "Admin / office", driver: "Driver", vendor: "Vendor", staff: "Staff", system: "System" };

export function PaymentsPanel({
  booking, rows, error, canRecord, canVoid, onRecord, onVoid, onRefund,
}: {
  booking: Booking; rows: PaymentRow[] | null; error: string | null; canRecord: boolean; canVoid: boolean;
  onRecord: () => void; onVoid: (r: PaymentRow) => void; onRefund: () => void;
}) {
  const pay = paymentOf(booking);
  const sorted = [...(rows ?? [])].sort((a, b) => (toDate(a.paymentDate as never)?.getTime() ?? 0) - (toDate(b.paymentDate as never)?.getTime() ?? 0));
  const legacy = (rows?.length ?? 0) === 0 && pay.totalPaid > 0;
  return (
    <div className="bg-white rounded-xl border border-line shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">Payments</h3>
        <PaymentBadge status={pay.status} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs font-semibold text-muted uppercase">Amount due</dt><dd className="font-bold text-ink">{rupees(pay.amountDue)}</dd></div>
        <div><dt className="text-xs font-semibold text-muted uppercase">Total paid</dt><dd className="font-bold text-green-700">{rupees(pay.totalPaid)}</dd></div>
        <div><dt className="text-xs font-semibold text-muted uppercase">Balance due</dt><dd className={`font-bold ${pay.balanceDue > 0 ? "text-brand" : "text-ink"}`}>{rupees(pay.balanceDue)}</dd></div>
        <div><dt className="text-xs font-semibold text-muted uppercase">Advance</dt><dd className="font-bold text-ink">{rupees(pay.advancePaid)}</dd></div>
        {pay.partnerCashHeld > 0 && <div className="col-span-2"><dt className="text-xs font-semibold text-muted uppercase">Collected directly by driver / vendor</dt><dd className="font-bold text-ink">{rupees(pay.partnerCashHeld)}</dd></div>}
      </dl>
      {error && <Notice tone="error">{error}</Notice>}
      {rows === null && !error && <p className="text-sm text-muted" role="status">Loading payment history…</p>}
      {legacy && <Notice tone="info">This booking was marked paid before payments were recorded one by one, so there is no itemised history.</Notice>}
      {sorted.length > 0 && (
        <ul className="divide-y divide-line border border-line rounded-lg">
          {sorted.map((r) => (
            <li key={r.id} className={`p-3 text-sm space-y-0.5 ${r.status === "Voided" ? "bg-gray-50 text-faint" : ""}`}>
              <div className="flex justify-between gap-2">
                <span className={`font-semibold ${r.status === "Voided" ? "line-through" : "text-ink"}`}>{rupees(r.amount)} · {r.method}{r.kind ? ` · ${r.kind}` : ""}</span>
                {r.status === "Voided" ? <span className="text-xs font-semibold text-red-700">Voided</span> : canVoid && <button onClick={() => onVoid(r)} className="text-xs font-semibold text-red-700 hover:underline">Void</button>}
              </div>
              <div className="text-xs text-muted">{when(r.paymentDate)} · collected by {COLLECTOR[r.collectorType ?? ""] ?? r.collectorType}{r.collectorName ? ` (${r.collectorName})` : ""}</div>
              {r.reference && <div className="text-xs text-muted">Ref: {r.reference}</div>}
              {r.notes && <div className="text-xs text-muted">{r.notes}</div>}
              {r.status === "Voided" && r.voidReason && <div className="text-xs">Reason: {r.voidReason}</div>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {canRecord && !["Cancelled", "Rejected"].includes(booking.status) && pay.balanceDue > 0 && <button onClick={onRecord} className={primaryBtn}>Record payment</button>}
        {canRecord && booking.refund && booking.refund.status !== "Not Applicable" && <button onClick={onRefund} className={secondaryBtn}>Refund: {booking.refund.status}</button>}
      </div>
      {booking.refund && booking.refund.status !== "Not Applicable" && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 text-sm text-purple-900 space-y-0.5">
          <div className="font-semibold">Refund {booking.refund.status.toLowerCase()} · {rupees(booking.refund.amount)}</div>
          {booking.refund.method && <div className="text-xs">Method: {booking.refund.method}{booking.refund.reference ? ` · ${booking.refund.reference}` : ""}</div>}
          {booking.refund.processedAt != null && <div className="text-xs">Processed {when(booking.refund.processedAt)} by {booking.refund.processedByName}</div>}
        </div>
      )}
      {booking.cancellation && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-0.5">
          <div className="font-semibold">{booking.cancellation.rejected ? "Rejected" : "Cancelled"} by {booking.cancellation.cancelledBy?.name || booking.cancellation.cancelledBy?.type || "—"} · {when(booking.cancellation.at)}</div>
          {booking.cancellation.reason && <div className="text-xs">Reason: {booking.cancellation.reason}</div>}
          {(booking.cancellation.charge ?? 0) > 0 && <div className="text-xs">Cancellation charge: {rupees(booking.cancellation.charge ?? 0)}</div>}
        </div>
      )}
    </div>
  );
}

// ── Assignment history ────────────────────────────────────────────────────

export interface AssignmentRow {
  id: string;
  action: string;
  oldDriver?: { name?: string; vehicleNumber?: string } | null;
  newDriver?: { name?: string; vehicleNumber?: string } | null;
  changedByName?: string;
  reason?: string;
  at?: unknown;
}

export function AssignmentHistory({ rows }: { rows: AssignmentRow[] | null }) {
  if (!rows || rows.length === 0) return <p className="text-sm text-muted">No assignment changes recorded.</p>;
  const sorted = [...rows].sort((a, b) => (toDate(b.at as never)?.getTime() ?? 0) - (toDate(a.at as never)?.getTime() ?? 0));
  const label = (a: string) => (a === "assign" ? "Assigned" : a === "reassign" ? "Reassigned" : "Assignment removed");
  return (
    <ul className="space-y-2">
      {sorted.map((r) => (
        <li key={r.id} className="text-sm border-l-2 border-brand pl-3">
          <div className="font-semibold text-ink">{label(r.action)} · {when(r.at)}</div>
          <div className="text-body">
            {r.oldDriver ? `${r.oldDriver.name || "—"}${r.oldDriver.vehicleNumber ? ` (${r.oldDriver.vehicleNumber})` : ""}` : "—"} → {r.newDriver ? `${r.newDriver.name || "—"}${r.newDriver.vehicleNumber ? ` (${r.newDriver.vehicleNumber})` : ""}` : "no driver"}
          </div>
          <div className="text-xs text-muted">By {r.changedByName || "—"}{r.reason?.trim() ? ` — ${r.reason}` : ""}</div>
        </li>
      ))}
    </ul>
  );
}

// ── Vehicle verification ──────────────────────────────────────────────────

interface Signal { code: string; message: string; weight: number }
interface PhotoInfo { path: string; capturedAtMs?: number; riskLevel?: string; riskScore?: number; signals?: Signal[]; instruction?: string; code?: string; gps?: { lat: number; lng: number } | null }
export interface VerificationDoc {
  status: string;
  riskLevel?: string;
  riskScore?: number;
  flagged?: boolean;
  odometerReading?: number;
  submittedAt?: unknown;
  photos?: Partial<Record<"front" | "rear" | "interior", PhotoInfo>>;
  vehicleNumber?: string;
}

const RISK_CLS: Record<string, string> = { low: "bg-green-50 text-green-800 border-green-300", medium: "bg-amber-50 text-amber-900 border-amber-300", high: "bg-red-50 text-red-800 border-red-300" };

function StoragePhoto({ path, label }: { path: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getDownloadURL(storageRef(storage, path)).then((u) => live && setUrl(u)).catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [path]);
  if (failed) return <div className="aspect-[4/3] rounded-lg bg-gray-100 flex items-center justify-center text-xs text-muted p-2 text-center">Photo could not be loaded</div>;
  if (!url) return <div className="aspect-[4/3] rounded-lg bg-gray-100 animate-pulse" aria-label={`Loading ${label}`} />;
  return (
    <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label} className="aspect-[4/3] w-full object-cover rounded-lg border border-line" /></a>
  );
}

export function VehicleVerificationPanel({ doc, error }: { doc: VerificationDoc | null | undefined; error: string | null }) {
  if (error) return <Notice tone="error">{error}</Notice>;
  if (doc === undefined) return <p className="text-sm text-muted" role="status">Loading verification…</p>;
  if (!doc || (doc.status !== "Submitted" && doc.status !== "InProgress" && doc.status !== "Superseded")) return <p className="text-sm text-muted">No vehicle photos have been submitted for this trip yet.</p>;
  const slots: ["front" | "rear" | "interior", string][] = [["front", "Vehicle front"], ["rear", "Vehicle rear"], ["interior", "Dashboard / interior"]];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`px-2 py-0.5 rounded border text-xs font-bold ${RISK_CLS[doc.riskLevel ?? "low"]}`}>{(doc.riskLevel ?? "low").toUpperCase()} fraud risk{doc.riskScore !== undefined ? ` (${doc.riskScore})` : ""}</span>
        <span className="text-muted">{doc.status === "Submitted" ? `Submitted ${when(doc.submittedAt)}` : doc.status === "Superseded" ? "Superseded — driver or trip changed" : "In progress"}{doc.odometerReading ? ` · odometer ${doc.odometerReading.toLocaleString("en-IN")} km` : ""}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {slots.map(([slot, label]) => {
          const p = doc.photos?.[slot];
          return (
            <div key={slot} className="space-y-1">
              <div className="text-xs font-semibold text-body">{label}</div>
              {p ? <StoragePhoto path={p.path} label={label} /> : <div className="aspect-[4/3] rounded-lg border border-dashed border-line-strong flex items-center justify-center text-xs text-muted">Not captured</div>}
              {p && (
                <div className="text-xs text-muted space-y-0.5">
                  <div>{p.capturedAtMs ? formatDateTime12(new Date(p.capturedAtMs)) : "—"}{p.gps ? ` · ${p.gps.lat.toFixed(4)}, ${p.gps.lng.toFixed(4)}` : ""}</div>
                  {p.instruction && <div>Asked: “{p.instruction}” · code {p.code}</div>}
                  {(p.signals ?? []).filter((s) => s.weight >= 15).map((s) => <div key={s.code} className="text-amber-800">⚠ {s.message}</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Risk flags are signals for review — they are not proof that a photo is genuine or fake.</p>
    </div>
  );
}

// ── Customer verification code ────────────────────────────────────────────

export function VerifyCustomerModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (text: string) => void }) {
  const hasEmail = !!booking.customerEmail;
  const [channels, setChannels] = useState({ whatsapp: true, sms: true, email: hasEmail });
  const [sent, setSent] = useState<ChannelResult[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const chosen = (Object.keys(channels) as (keyof typeof channels)[]).filter((k) => channels[k]);
    if (!chosen.length) return setError("Choose at least one channel.");
    setBusy(true);
    setError(null);
    try {
      const r = await sendVerificationCode(booking.id, chosen);
      setSent(r.sent);
    } catch (e) {
      setError(e instanceof ActionError ? e.message : "The code could not be sent.");
    } finally {
      setBusy(false);
    }
  };
  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyCustomerCode(booking.id, code.trim());
      onDone("Customer verified.");
    } catch (e) {
      setError(e instanceof ActionError ? e.message : "The code could not be checked.");
      setBusy(false);
    }
  };
  const statusText = (s: ChannelResult) => (s.status === "sent" ? "sent" : s.status === "not_configured" ? "not set up on the server" : `failed${s.error ? ` — ${s.error}` : ""}`);
  return (
    <Modal title="Verify customer" subtitle={`${booking.customer} · ${booking.phone}`} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} disabled={busy} className={secondaryBtn}>Close</button>{sent ? <button onClick={verify} disabled={busy || code.trim().length !== 6} className={primaryBtn}>{busy ? "Checking…" : "Verify code"}</button> : <button onClick={send} disabled={busy} className={primaryBtn}>{busy ? "Sending…" : "Send code"}</button>}</>}>
      <div className="space-y-3 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {!sent ? (
          <>
            <p>Send a 6-digit code to the customer. They read it back to you to confirm their contact details.</p>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={channels.whatsapp} onChange={(e) => setChannels({ ...channels, whatsapp: e.target.checked })} className="w-4 h-4 accent-brand" />WhatsApp {booking.customerWhatsapp?.e164 ? `(${booking.customerWhatsapp.e164})` : ""}</label>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={channels.sms} onChange={(e) => setChannels({ ...channels, sms: e.target.checked })} className="w-4 h-4 accent-brand" />SMS ({booking.phone})</label>
            <label className={`flex items-center gap-2 font-semibold ${hasEmail ? "" : "text-faint"}`}><input type="checkbox" disabled={!hasEmail} checked={channels.email} onChange={(e) => setChannels({ ...channels, email: e.target.checked })} className="w-4 h-4 accent-brand" />Email {hasEmail ? `(${booking.customerEmail})` : "— no email on this booking"}</label>
          </>
        ) : (
          <>
            <ul className="space-y-1">{sent.map((s) => <li key={s.channel} className={s.status === "sent" ? "text-green-800" : "text-red-800"}><strong className="capitalize">{s.channel}</strong>: {statusText(s)}</li>)}</ul>
            <Field label="Code the customer reads out" required><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className={`${inputCls} text-xl tracking-widest font-mono`} /></Field>
            <p className="text-xs text-muted">The code expires in 10 minutes and allows 5 tries.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
