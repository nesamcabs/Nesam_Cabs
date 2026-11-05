import { useMemo, useState } from "react";
import type { Booking, Driver, Vehicle, Vendor } from "../../types";
import { ConfirmDialog, Modal } from "../Feedback";
import PostingOptions, { postingPayload, usePostingOptions } from "./PostingOptions";
import { Field, Notice, inputCls, inputErrCls, primaryBtn, secondaryBtn } from "../FormKit";
import {
  assignDriver, assignVendor, approveBooking, cancelBooking, publishToMarketplace, recordPayment, rejectBooking, updateRefund, voidPayment,
  type CollectorType, type PaymentMethodName,
} from "../../services/bookingOpsService";
import { ActionError } from "../../services/callables";
import { paymentOf, refundNext } from "../../domain/bookingFlow";
import { formatDateTime12 } from "../../utils/time";

const rupees = (n: number) => `₹${Math.round(n * 100) / 100 === Math.round(n) ? Math.round(n).toLocaleString("en-IN") : (Math.round(n * 100) / 100).toLocaleString("en-IN")}`;
const code = (b: Booking) => b.bookingId || b.id;
const msg = (e: unknown, fallback: string) => (e instanceof ActionError ? e.message : fallback);

// ── Approve ───────────────────────────────────────────────────────────────

export function ApproveDialog({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await approveBooking(booking.id, note);
      const failed = r.customerChannels.filter((c) => c.status !== "sent");
      onDone(`${code(booking)} approved — it is not visible to partners yet. Now choose how to fulfil it: publish to the marketplace, assign a vendor, or assign an owner driver.${failed.length ? ` Customer message issue: ${failed.map((f) => `${f.channel} ${f.status === "not_configured" ? "not set up" : "failed"}`).join(", ")}.` : ""}`);
    } catch (e) {
      setError(msg(e, "The booking was not approved."));
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title="Approve booking" confirmLabel="Approve" busy={busy} error={error} onConfirm={go} onCancel={onClose}
      message={
        <div className="space-y-3">
          <p>Approving <strong>{code(booking)}</strong> confirms the request is valid and tells the customer it is being arranged. It does <strong>not</strong> publish the booking: afterwards you choose to publish it to the marketplace, assign a vendor, or assign an owner driver.</p>
          <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} /></Field>
        </div>
      }
    />
  );
}

// ── Reject ────────────────────────────────────────────────────────────────

export function RejectDialog({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (reason.trim().length < 5) return setError("Give the reason for rejecting this booking (at least 5 characters).");
    setBusy(true);
    setError(null);
    try {
      await rejectBooking(booking.id, reason.trim());
      onDone(`${code(booking)} rejected.`);
    } catch (e) {
      setError(msg(e, "The booking was not rejected."));
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title="Reject booking" confirmLabel="Reject booking" danger busy={busy} error={error} onConfirm={go} onCancel={onClose}
      message={
        <div className="space-y-3">
          <p>The customer is told the booking could not be accepted. Any amount already paid becomes a pending refund.</p>
          <Field label="Reason" required><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputCls} /></Field>
        </div>
      }
    />
  );
}

// ── Assign / change / reassign / remove driver ────────────────────────────

interface AssignProps {
  booking: Booking;
  drivers: Driver[];
  vehicles: Vehicle[];
  vendors: Vendor[];
  onClose: () => void;
  onDone: (text: string) => void;
}

export function AssignDriverModal({ booking, drivers, vehicles, vendors, onClose, onDone }: AssignProps) {
  const hasDriver = !!booking.assignedDriverId;
  const hasVendorOnly = !hasDriver && !!booking.assignedVendorId;
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [reason, setReason] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [search, setSearch] = useState("");

  const vendorName = (id?: string) => vendors.find((v) => v.id === id)?.companyName || vendors.find((v) => v.id === id)?.name || "";
  const eligible = useMemo(
    () =>
      drivers
        .filter((d) => d.status === "Approved" && d.fleetStatus !== "Suspended")
        .filter((d) => !search.trim() || `${d.name} ${d.phone} ${d.vehicleNumber ?? ""} ${d.assignedVehicleNumber ?? ""}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => Number(b.presenceStatus === "Online") - Number(a.presenceStatus === "Online") || (a.name || "").localeCompare(b.name || "")),
    [drivers, search],
  );
  const chosen = drivers.find((d) => d.id === driverId);
  // Vehicles of the chosen driver's owner that are approved and in service.
  const ownerVehicles = useMemo(
    () => vehicles.filter((v) => (v.vendorId || "") === (chosen?.vendorId || "") && v.docStatus === "Approved" && !["Inactive", "Maintenance"].includes(v.status || "") && (!v.assignedDriverId || v.assignedDriverId === driverId)),
    [vehicles, chosen, driverId],
  );
  const pairedVehicle = chosen?.assignedVehicleId ? vehicles.find((v) => v.id === chosen.assignedVehicleId) : undefined;
  const effectiveVehicle = vehicles.find((v) => v.id === (vehicleId || chosen?.assignedVehicleId));
  const oldVehicle = booking.assignedVehicleNumber || "—";
  const action = removing ? "remove" : hasDriver ? "reassign" : "assign";

  const submit = async (force = false) => {
    if (!removing && !driverId) return setError("Choose a driver.");
    if (action !== "assign" && reason.trim().length < 5) return setError("Give the reason for changing the assignment (at least 5 characters).");
    setBusy(true);
    setError(null);
    try {
      await assignDriver({ bookingId: booking.id, driverId: removing ? "" : driverId, vehicleId: vehicleId || undefined, reason: reason.trim(), force });
      onDone(removing ? `Assignment removed from ${code(booking)}. It is approved and awaiting fulfilment again — choose a new route.` : `${chosen?.name || "Driver"} ${hasDriver ? "now assigned to" : "assigned to"} ${code(booking)}.`);
    } catch (e) {
      setConflict(e instanceof ActionError && (e.details as { conflict?: boolean } | undefined)?.conflict === true);
      setError(msg(e, "The assignment was not changed."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={removing ? "Remove assignment" : hasDriver ? "Change / reassign driver" : "Assign driver"}
      subtitle={`Booking ${code(booking)} · ${booking.pickup} → ${booking.drop}`}
      onClose={onClose} busy={busy} size="lg"
      footer={
        <>
          <button onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button>
          {conflict && <button onClick={() => submit(true)} disabled={busy} className="px-4 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-semibold disabled:opacity-60">Assign anyway</button>}
          <button onClick={() => submit(false)} disabled={busy} className={removing ? "px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-60" : primaryBtn}>
            {busy ? "Saving…" : removing ? "Remove assignment" : hasDriver ? "Reassign driver" : "Assign driver"}
          </button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {(hasDriver || hasVendorOnly) && (
          <div className="rounded-lg border border-line bg-gray-50 p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><div className="text-xs font-semibold text-muted uppercase">Current driver</div><div className="font-semibold text-ink">{booking.assignedDriverName || booking.driver || (hasVendorOnly ? `Held by ${booking.assignedVendorName || "a vendor"} (no driver yet)` : "—")}</div></div>
            <div><div className="text-xs font-semibold text-muted uppercase">Current vehicle</div><div className="font-semibold text-ink">{oldVehicle}</div></div>
          </div>
        )}
        {booking.status === "Pending" && <Notice tone="warn">Approve this booking before assigning a driver.</Notice>}
        {hasDriver && (
          <label className="flex items-center gap-2 font-semibold text-body">
            <input type="checkbox" checked={removing} onChange={(e) => { setRemoving(e.target.checked); setError(null); }} className="w-4 h-4 accent-brand" />
            Remove the assignment only (the booking returns to approved, awaiting fulfilment)
          </label>
        )}
        {!removing && (
          <>
            <Field label="Find driver"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or vehicle number" className={inputCls} /></Field>
            <Field label="New driver" required>
              <select value={driverId} onChange={(e) => { setDriverId(e.target.value); setVehicleId(""); setConflict(false); }} size={Math.min(8, Math.max(3, eligible.length))} className={`${inputCls} h-auto`}>
                {eligible.length === 0 && <option value="" disabled>No approved drivers match.</option>}
                {eligible.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.presenceStatus === "Online" ? "● " : "○ "}{d.name} · {d.phone} · {d.assignedVehicleNumber || d.vehicleNumber || "no vehicle"}{d.vendorId ? ` · fleet: ${vendorName(d.vendorId) || "vendor"}` : " · independent"}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-muted mt-1">● online   ○ offline — only approved, non-suspended drivers are listed.</span>
            </Field>
            {chosen && (
              <Field label="Vehicle" hint={pairedVehicle ? `Paired vehicle: ${pairedVehicle.vehicleNumber}` : "This driver has no paired vehicle record."}>
                <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls}>
                  <option value="">{pairedVehicle ? `Use paired vehicle (${pairedVehicle.vehicleNumber})` : "No vehicle record"}</option>
                  {ownerVehicles.filter((v) => v.id !== pairedVehicle?.id).map((v) => <option key={v.id} value={v.id}>{v.vehicleNumber} · {v.category}</option>)}
                </select>
              </Field>
            )}
          </>
        )}
        {(action !== "assign" || reason) && (
          <Field label={`Reason for ${removing ? "removal" : hasDriver ? "reassignment" : "assignment"}`} required={action !== "assign"}>
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Driver unavailable, customer request" className={`${inputCls} ${error && action !== "assign" && reason.trim().length < 5 ? inputErrCls : ""}`} />
          </Field>
        )}
        {action === "assign" && !reason && <button type="button" onClick={() => setReason(" ")} className="text-xs text-brand font-semibold hover:underline">+ Add a reason (optional)</button>}

        {(chosen || removing) && (
          <div className="rounded-lg border-2 border-[#F5D0D0] bg-brand-soft p-3 space-y-1" aria-label="Summary of the change">
            <div className="text-xs font-bold uppercase text-brand">Review the change</div>
            {removing ? (
              <div>{booking.assignedDriverName || booking.driver || "The current driver"} ({oldVehicle}) will be removed and the booking returns to <strong>Approved</strong>.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
                  <div><span className="text-muted">Current driver:</span> <strong>{booking.assignedDriverName || booking.driver || "none"}</strong></div>
                  <div><span className="text-muted">Current vehicle:</span> <strong>{oldVehicle}</strong></div>
                  <div><span className="text-muted">New driver:</span> <strong>{chosen?.name}</strong></div>
                  <div><span className="text-muted">New vehicle:</span> <strong>{effectiveVehicle?.vehicleNumber || chosen?.assignedVehicleNumber || chosen?.vehicleNumber || "—"}</strong></div>
                </div>
                {chosen?.presenceStatus !== "Online" && <div className="text-amber-800">This driver is currently offline.</div>}
              </>
            )}
            <div className="text-xs text-muted">The change, who made it, when and why is kept permanently in the booking’s assignment history.</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Fulfilment: publish / assign vendor ───────────────────────────────────

export function PublishDialog({ booking, canSetPayout, onClose, onDone }: { booking: Booking; canSetPayout: boolean; onClose: () => void; onDone: (text: string) => void }) {
  const [payout, setPayout] = useState("");
  const options = usePostingOptions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    const manual = payout.trim() ? Number(payout) : undefined;
    if (manual !== undefined && (!Number.isSafeInteger(manual) || manual <= 0)) return setError("Enter the payout in whole rupees, or leave it blank to use the commission policy.");
    const opts = postingPayload(options.value);
    if (!opts.ok) return setError(opts.error);
    setBusy(true);
    setError(null);
    try {
      const r = await publishToMarketplace(booking.id, manual, opts.data);
      onDone(`${code(booking)} published at ${rupees(r.offeredPayout)} payout. ${r.partnersNotified} driver/vendor${r.partnersNotified === 1 ? "" : "s"} notified.`);
    } catch (e) {
      setError(msg(e, "The booking was not published."));
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog
      title="Publish to marketplace" confirmLabel="Publish to Open Duties" busy={busy} error={error} onConfirm={go} onCancel={onClose}
      message={
        <div className="space-y-3">
          <p><strong>{code(booking)}</strong> becomes visible in Open Duties to eligible approved owner drivers and vendors, and they are notified. The first valid claim (or an awarded bid) takes it.</p>
          {canSetPayout ? (
            <Field label="Partner payout (₹)" hint="Leave blank to use the commission policy offer."><input value={payout} onChange={(e) => setPayout(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={inputCls} /></Field>
          ) : (
            <p className="text-xs text-muted">The payout comes from the commission policy. Setting it by hand needs finance access.</p>
          )}
          <PostingOptions value={options.value} onChange={options.set} />
        </div>
      }
    />
  );
}

export function AssignVendorModal({ booking, vendors, canSetPayout, onClose, onDone }: { booking: Booking; vendors: Vendor[]; canSetPayout: boolean; onClose: () => void; onDone: (text: string) => void }) {
  const eligible = useMemo(
    () => vendors.filter((v) => ["APPROVED", "Approved", "Active"].includes(String(v.status))).sort((a, b) => (a.companyName || a.name || "").localeCompare(b.companyName || b.name || "")),
    [vendors],
  );
  const [vendorId, setVendorId] = useState("");
  const [payout, setPayout] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = eligible.find((v) => v.id === vendorId);
  const go = async () => {
    if (!vendorId) return setError("Choose a vendor.");
    const manual = payout.trim() ? Number(payout) : undefined;
    if (manual !== undefined && (!Number.isSafeInteger(manual) || manual <= 0)) return setError("Enter the payout in whole rupees, or leave it blank to use the commission policy.");
    setBusy(true);
    setError(null);
    try {
      const r = await assignVendor({ bookingId: booking.id, vendorId, ...(manual !== undefined ? { payout: manual } : {}), reason: reason.trim() });
      onDone(`${code(booking)} reserved to ${r.vendorName} at ${rupees(r.payout)} payout. The vendor now assigns a driver and vehicle.`);
    } catch (e) {
      setError(msg(e, "The vendor was not assigned."));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Assign vendor" subtitle={`Booking ${code(booking)} · ${booking.pickup} → ${booking.drop}`} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button><button onClick={go} disabled={busy} className={primaryBtn}>{busy ? "Assigning…" : "Assign vendor"}</button></>}
    >
      <div className="space-y-4 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        <Notice tone="info">The vendor holds the booking and then assigns its own driver and vehicle. The customer is told a partner has confirmed and driver details will follow — not that a driver is assigned.</Notice>
        <Field label="Approved vendor" required>
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className={inputCls}>
            <option value="">Choose a vendor…</option>
            {eligible.map((v) => <option key={v.id} value={v.id}>{v.companyName || v.name}{v.phone ? ` · ${v.phone}` : ""}</option>)}
          </select>
        </Field>
        {canSetPayout ? (
          <Field label="Agreed payout (₹)" hint="Leave blank to use the commission policy offer."><input value={payout} onChange={(e) => setPayout(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={inputCls} /></Field>
        ) : (
          <p className="text-xs text-muted">The payout comes from the commission policy. Setting it by hand needs finance access.</p>
        )}
        <Field label="Note (optional)"><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Regular partner for this route" className={inputCls} /></Field>
        {chosen && <p className="text-xs text-muted">After assigning, only {chosen.companyName || chosen.name}’s own drivers can be given this booking.</p>}
      </div>
    </Modal>
  );
}

// ── Cancel ────────────────────────────────────────────────────────────────

export function CancelBookingModal({ booking, canCharge, onClose, onDone }: { booking: Booking; canCharge: boolean; onClose: () => void; onDone: (text: string) => void }) {
  const pay = paymentOf(booking);
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState("0");
  const [refundEligible, setRefundEligible] = useState(true);
  const [refundAmount, setRefundAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chargeN = Number(charge) || 0;
  const refundable = Math.max(0, pay.totalPaid - chargeN);
  const amountN = refundAmount.trim() === "" ? refundable : Number(refundAmount);

  const go = async () => {
    if (reason.trim().length < 5) return setError("Give the cancellation reason (at least 5 characters).");
    if (!Number.isFinite(chargeN) || chargeN < 0) return setError("Enter the cancellation charge (0 or more).");
    if (refundEligible && refundable > 0 && !(amountN > 0 && amountN <= refundable + 0.005)) return setError(`The refund must be between ₹1 and ${rupees(refundable)}.`);
    setBusy(true);
    setError(null);
    try {
      const r = await cancelBooking({
        bookingId: booking.id, reason: reason.trim(), cancellationCharge: chargeN, refundEligible: refundEligible && refundable > 0,
        ...(refundEligible && refundable > 0 ? { refundAmount: amountN, refundMethod: method } : {}),
      });
      onDone(`${code(booking)} cancelled.${r.refundAmount > 0 ? ` Refund of ${rupees(r.refundAmount)} is pending.` : ""}`);
    } catch (e) {
      setError(msg(e, "The booking was not cancelled."));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Cancel booking" subtitle={`${code(booking)} · ${booking.customer}`} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} disabled={busy} className={secondaryBtn}>Keep booking</button><button onClick={go} disabled={busy} className="px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-60">{busy ? "Cancelling…" : "Cancel booking"}</button></>}
    >
      <div className="space-y-3 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        <Field label="Cancellation reason" required><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputCls} /></Field>
        <div className="rounded-lg border border-line bg-gray-50 p-3 flex justify-between"><span>Customer has paid</span><strong>{rupees(pay.totalPaid)}</strong></div>
        {canCharge ? (
          <Field label="Cancellation charge (₹)" hint="Deducted from what the customer paid."><input value={charge} onChange={(e) => setCharge(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className={inputCls} /></Field>
        ) : (
          <Notice tone="info">No cancellation charge is applied. A charge needs finance access.</Notice>
        )}
        {pay.totalPaid > 0 && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={refundEligible} onChange={(e) => setRefundEligible(e.target.checked)} className="w-4 h-4 accent-brand" />Customer is eligible for a refund</label>
            {refundEligible && refundable > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Refund amount (₹)" hint={`Up to ${rupees(refundable)}`}><input value={refundAmount} onChange={(e) => setRefundAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder={String(refundable)} inputMode="decimal" className={inputCls} /></Field>
                <Field label="Refund method"><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}><option>UPI</option><option>Bank Transfer</option><option>Cash</option></select></Field>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────

export function RecordPaymentModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (text: string) => void }) {
  const pay = paymentOf(booking);
  const [amount, setAmount] = useState(pay.balanceDue > 0 ? String(pay.balanceDue) : "");
  const [method, setMethod] = useState<PaymentMethodName>("Cash");
  const [collector, setCollector] = useState<CollectorType>("admin");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useMemo(() => `pay_${crypto.randomUUID().replace(/-/g, "")}`, []);
  const n = Number(amount);

  const go = async () => {
    if (!(n > 0)) return setError("Enter the amount received.");
    if (n > pay.balanceDue + 0.005) return setError(`The amount is more than the balance due (${rupees(pay.balanceDue)}).`);
    if (method !== "Cash" && reference.trim().length < 4) return setError(`Enter the ${method === "UPI" ? "UPI transaction" : "transfer"} reference.`);
    setBusy(true);
    setError(null);
    try {
      await recordPayment({ bookingId: booking.id, amount: n, method, collectorType: collector, reference: reference.trim(), notes: notes.trim(), requestId });
      onDone(`${rupees(n)} recorded for ${code(booking)}.`);
    } catch (e) {
      setError(msg(e, "The payment was not recorded."));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Record payment" subtitle={`${code(booking)} · balance due ${rupees(pay.balanceDue)}`} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button><button onClick={go} disabled={busy || pay.balanceDue <= 0} className={primaryBtn}>{busy ? "Saving…" : "Record payment"}</button></>}
    >
      <div className="space-y-3 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {pay.balanceDue <= 0 && <Notice tone="ok">This booking is fully paid.</Notice>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Amount received (₹)" required><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className={inputCls} /></Field>
          <Field label="Payment method" required>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethodName)} className={inputCls}><option>Cash</option><option>UPI</option><option>Bank Transfer</option></select>
          </Field>
          <Field label="Collected by" required>
            <select value={collector} onChange={(e) => setCollector(e.target.value as CollectorType)} className={inputCls}>
              <option value="admin">Admin / office</option>
              {booking.assignedDriverId && <option value="driver">Driver — {booking.assignedDriverName || booking.driver}</option>}
              {booking.assignedVendorId && <option value="vendor">Vendor — {booking.assignedVendorName}</option>}
              <option value="staff">Other staff</option>
            </select>
          </Field>
          {method !== "Cash" && <Field label={method === "UPI" ? "UPI transaction ID" : "Transfer reference"} required><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className={inputCls} /></Field>}
        </div>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} className={inputCls} /></Field>
        <p className="text-xs text-muted">Each payment is its own permanent record. Earlier payments are never overwritten; a mistake is voided with a reason, not edited.</p>
      </div>
    </Modal>
  );
}

export function VoidPaymentDialog({ booking, paymentId, amountLabel, onClose, onDone }: { booking: Booking; paymentId: string; amountLabel: string; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (reason.trim().length < 10) return setError("Give a reason of at least 10 characters.");
    setBusy(true);
    setError(null);
    try {
      await voidPayment(booking.id, paymentId, reason.trim());
      onDone("Payment voided. It stays in the history.");
    } catch (e) {
      setError(msg(e, "The payment was not voided."));
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog title="Void payment" confirmLabel="Void payment" danger busy={busy} error={error} onConfirm={go} onCancel={onClose}
      message={<div className="space-y-3"><p>Void the <strong>{amountLabel}</strong> payment? It no longer counts toward the amount paid, but the record is kept.</p><Field label="Reason" required><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputCls} /></Field></div>} />
  );
}

// ── Refund processing ─────────────────────────────────────────────────────

export function RefundModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (text: string) => void }) {
  const r = booking.refund;
  const options = refundNext(r?.status) as ("Processing" | "Completed" | "Failed" | "Rejected")[];
  const [status, setStatus] = useState<"Processing" | "Completed" | "Failed" | "Rejected">(options[0] ?? "Processing");
  const [method, setMethod] = useState(r?.method || "UPI");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateRefund({ bookingId: booking.id, status, method, reference: reference.trim(), note: note.trim() });
      onDone(`Refund marked ${status.toLowerCase()}.`);
    } catch (e) {
      setError(msg(e, "The refund was not updated."));
      setBusy(false);
    }
  };
  return (
    <Modal title="Process refund" subtitle={`${code(booking)} · ${rupees(r?.amount ?? 0)} · currently ${r?.status ?? "—"}`} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button><button onClick={go} disabled={busy || options.length === 0} className={primaryBtn}>{busy ? "Saving…" : "Update refund"}</button></>}>
      <div className="space-y-3 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        {options.length === 0 ? <Notice tone="info">This refund is {r?.status?.toLowerCase()} and can no longer be changed.</Notice> : (
          <>
            <Field label="New status" required><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={inputCls}>{options.map((o) => <option key={o}>{o}</option>)}</select></Field>
            {status === "Completed" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Refund method" required><select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}><option>UPI</option><option>Bank Transfer</option><option>Cash</option></select></Field>
                {method !== "Cash" && <Field label="Transaction reference" required><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className={inputCls} /></Field>}
              </div>
            )}
            <Field label={status === "Rejected" ? "Reason for rejecting" : "Note"} required={status === "Rejected"}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={inputCls} /></Field>
          </>
        )}
        {(r?.history?.length ?? 0) > 0 && (
          <div><div className="text-xs font-bold uppercase text-muted mb-1">History</div>
            <ul className="text-xs text-body space-y-1">{r!.history!.map((h, i) => <li key={i}>{h.status} · {rupees(h.amount)}{h.reference ? ` · ${h.reference}` : ""} · {h.byName} · {formatDateTime12(h.at)}</li>)}</ul></div>
        )}
      </div>
    </Modal>
  );
}
