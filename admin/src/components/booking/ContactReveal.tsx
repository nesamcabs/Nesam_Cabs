import { useEffect, useState } from "react";
import type { Booking } from "../../types";
import { ActionError, callFunction } from "../../services/callables";
import { DEFAULT_POLICY, requestReveal, subscribePolicy } from "../../services/privacyService";
import { useStaffFlag } from "../AccessContext";
import { Button } from "../ui";

/**
 * Customer contact for a Staff ID. The raw number is never part of the page data for a Staff ID
 * (the rules refuse booking_contacts); getCustomerContact decides and logs each reveal: a booking
 * this person handled (when granted), or a Master-approved request that is used once. The number
 * is shown for the policy's reveal window and then cleared from memory.
 */
export default function ContactReveal({ booking }: { booking: Booking }) {
  const canRequest = useStaffFlag("privacy", "requestApproval");
  const canCopy = useStaffFlag("privacy", "copyAfterReveal");
  const [seconds, setSeconds] = useState(DEFAULT_POLICY.revealSeconds);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => subscribePolicy((p) => setSeconds(p.revealSeconds)), []);
  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setRevealed(null), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [revealed, seconds]);

  const reveal = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await callFunction<{ bookingId: string; platform: string }, { phone: string }>("getCustomerContact", { bookingId: booking.id, platform: "admin" });
      setRevealed(r.phone);
    } catch (e) {
      setMessage(e instanceof ActionError ? e.message : "The number could not be revealed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (busy) return;
    if (purpose.trim().length < 5) { setMessage("Give the purpose (at least 5 characters)."); return; }
    setBusy(true);
    setMessage(null);
    try {
      await requestReveal({ bookingId: booking.id, bookingCode: booking.bookingId || booking.id, customerId: booking.customerId, field: "phone", purpose: purpose.trim() });
      setAsking(false);
      setPurpose("");
      setMessage("Request sent to the Master account. Reveal the number here once it is approved.");
    } catch {
      setMessage("The request was not sent. Your Staff ID may not include requesting customer access.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 p-3 rounded-lg border border-line bg-surface-2 text-xs space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-ink">{revealed ?? (booking.phoneMasked || "Protected number")}</strong>
        {revealed && <span className="text-faint">· clears in {seconds}s</span>}
        {revealed && canCopy && <Button size="sm" variant="ghost" icon="copy" onClick={() => void navigator.clipboard?.writeText(revealed)}>Copy</Button>}
        {!revealed && <Button size="sm" icon="eye" loading={busy} onClick={() => void reveal()}>Reveal number</Button>}
        {!revealed && canRequest && !asking && <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Request access</Button>}
      </div>
      {asking && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} placeholder="Purpose, e.g. confirm pickup point" className="flex-1 min-w-[200px] p-2 border border-line rounded-lg" />
          <Button size="sm" variant="primary" loading={busy} onClick={() => void ask()}>Send request</Button>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
        </div>
      )}
      {message && <p role="status" className="text-muted">{message}</p>}
      <p className="text-faint">Full customer contact is Master-only. Every reveal is logged under your Staff ID.</p>
    </div>
  );
}
