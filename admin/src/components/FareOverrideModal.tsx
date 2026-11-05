import { useState } from "react";
import type { Booking } from "../types";
import { Modal } from "./Feedback";
import { AdminBookingError, fareOverrideBlocker, overrideBookingFare } from "../services/adminBookingService";
import { parseAmount } from "../utils/analytics";

const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };

/** Changes a booking's fare through the server (reason required, audited). */
export default function FareOverrideModal({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (fare: number) => void }) {
  const current = parseAmount(booking.fare);
  const legacy = booking.fareVerified !== true;
  const [fare, setFare] = useState(legacy && current > 0 ? String(Math.round(current)) : "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ fare?: string; reason?: string; form?: string }>({});
  const blocker = fareOverrideBlocker(booking);
  const payout = Math.max(Number(booking.driverPayout) || 0, Number(booking.vendorPayout) || 0);

  const submit = async () => {
    if (busy || blocker) return;
    const n = Number(fare);
    const e: typeof errors = {};
    if (!/^\d+$/.test(fare) || !(n >= 1) || n > 1000000) e.fare = "Enter the fare in whole rupees.";
    else if (n === current && !legacy) e.fare = "This is the current fare.";
    else if (n < payout) e.fare = `Cannot be below the ₹${payout} agreed with the partner.`;
    if (reason.trim().length < 10) e.reason = "Give a reason of at least 10 characters.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      onDone(await overrideBookingFare(booking.id, n, reason));
    } catch (ex) {
      setErrors({ form: ex instanceof AdminBookingError ? ex.message : "The fare was not changed. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={legacy ? "Verify / set fare" : "Change fare"}
      subtitle={`Booking ${booking.bookingId || booking.id}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 border border-line text-muted rounded-lg text-xs font-semibold disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={busy || !!blocker} className="px-4 py-2 bg-brand text-white rounded-lg text-xs font-semibold disabled:opacity-60">
            {busy ? "Saving…" : "Save fare"}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-xs">
        {blocker && <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">{blocker}</div>}
        {errors.form && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">{errors.form}</div>}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
            <div className="text-faint">Current fare</div>
            <div className="font-bold text-sm">{current > 0 ? rupees(current) : "—"}</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
            <div className="text-faint">Calculated by the booking engine</div>
            <div className="font-bold text-sm">
              {booking.fareOverride?.calculatedFare != null
                ? rupees(booking.fareOverride.calculatedFare)
                : booking.fareBreakdown?.total && !booking.fareOverride
                  ? rupees(booking.fareBreakdown.total)
                  : "Not available"}
            </div>
          </div>
        </div>
        {legacy && <p className="text-amber-700">This fare was entered without the booking engine. Confirm or correct it; the change is recorded.</p>}
        <label className="block">
          <span className="block text-[11px] font-semibold text-muted mb-1">New fare (₹, incl. GST) *</span>
          <input value={fare} onChange={(e) => setFare(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={!!blocker} className="w-full p-2 border border-line rounded-lg text-xs" />
          {errors.fare && <p className="text-[10px] text-red-600 mt-1">{errors.fare}</p>}
        </label>
        <label className="block">
          <span className="block text-[11px] font-semibold text-muted mb-1">Reason *</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} disabled={!!blocker} className="w-full p-2 border border-line rounded-lg text-xs" />
          {errors.reason && <p className="text-[10px] text-red-600 mt-1">{errors.reason}</p>}
        </label>
        <p className="text-[10px] text-faint">An open marketplace offer is updated to the partner share of the new fare; payouts already agreed with a partner do not change.</p>
      </div>
    </Modal>
  );
}
