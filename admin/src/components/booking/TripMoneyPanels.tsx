import DateTime12Input from "../DateTime12Input";
import { useEffect, useState } from "react";
import type { Booking } from "../../types";
import { Modal } from "../Feedback";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../FormKit";
import { subscribeToDocument } from "../../services/adminFirestoreService";
import { overrideReachedPickup, updateSettlement } from "../../services/bookingOpsService";
import { ActionError } from "../../services/callables";

const rupees = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN")}`;
const when = (v: any): string => {
  const d: Date | null = v?.toDate?.() ?? (v ? new Date(v) : null);
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—";
};
const msg = (e: unknown, f: string) => (e instanceof ActionError ? e.message : f);

const MODEL_LABEL: Record<string, string> = {
  one_way_standard: "Standard one-way tariff",
  round_trip_calendar: "Round trip — Indian calendar days",
  city_drop_package: "Local city drop package",
  rental_time: "Local rental (time)",
  local_pickup_drop: "Local Pickup & Drop (city fare)",
  rental_package: "Local rental package",
  fixed_route: "Fixed route fare",
  airport_transfer: "Airport transfer (base fare + extra KM)",
  business_contract_per_km: "Business contract (per KM)",
  legacy_category: "Vehicle category fares",
};

/** How the quote was built and what the final invoice is, from the locked snapshot on the booking. */
export function PricingPanel({ booking }: { booking: Booking }) {
  const p = booking.pricing;
  const f = booking.finalFare;
  if (!p && !f) return null;
  return (
    <section className="bg-white rounded-xl border border-line p-4 space-y-3">
      <h3 className="text-[15px] font-bold text-ink">Pricing record</h3>
      {p && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-xs font-semibold text-muted uppercase">Tariff</dt><dd className="font-semibold text-ink">{MODEL_LABEL[p.model] ?? p.model}{p.tariffVersion ? ` · v${p.tariffVersion}` : ""}</dd></div>
          <div><dt className="text-xs font-semibold text-muted uppercase">Included distance</dt><dd className="font-semibold text-ink">{p.includedKm} km</dd></div>
          {p.model === "round_trip_calendar" && (
            <>
              <div><dt className="text-xs font-semibold text-muted uppercase">Dates charged</dt><dd className="font-semibold text-ink">{p.pickupDate} → {p.endDate}</dd></div>
              <div><dt className="text-xs font-semibold text-muted uppercase">Billable days</dt><dd className="font-semibold text-ink">{p.days} × {p.minKmPerDay} km minimum</dd></div>
            </>
          )}
          <div><dt className="text-xs font-semibold text-muted uppercase">Extra km rate</dt><dd className="font-semibold text-ink">{rupees(p.extraKmRatePaise / 100)}/km</dd></div>
          {p.partner && <div><dt className="text-xs font-semibold text-muted uppercase">Normal partner payout (quote)</dt><dd className="font-semibold text-ink">{rupees(p.partner.basePaise / 100)}</dd></div>}
        </dl>
      )}
      {p && p.gates?.length > 0 && (
        <Notice tone="info">
          <div className="text-xs font-semibold mb-1">Open business decisions affecting this quote</div>
          <ul className="list-disc ml-4 text-xs space-y-0.5">{p.gates.map((g) => <li key={g}>{g}</li>)}</ul>
        </Notice>
      )}
      {f && (
        <div className="rounded-lg bg-surface-2 border border-line p-3 text-sm space-y-1">
          <div className="font-semibold text-ink">Final invoice (from the driver’s total kilometres)</div>
          <div className="flex justify-between"><span>Total km driven</span><strong>{f.totalKm} km</strong></div>
          <div className="flex justify-between"><span>Quoted / included</span><strong>{f.quotedKm} / {f.includedKm} km</strong></div>
          <div className="flex justify-between"><span>Extra km charged</span><strong>{f.extraKm} km</strong></div>
          {f.extraDays > 0 && <div className="flex justify-between"><span>Extra calendar days</span><strong>{f.extraDays}</strong></div>}
          <div className="flex justify-between"><span>Quoted fare → final fare</span><strong>{rupees(Number(f.quotedFare))} → {rupees(f.finalFare)}</strong></div>
        </div>
      )}
      {booking.distanceDiscrepancy && (
        <Notice tone="warn">
          The driver entered {booking.distanceDiscrepancy.enteredKm} km but the odometer shows {booking.distanceDiscrepancy.odometerKm} km. Review before releasing the payout.
        </Notice>
      )}
    </section>
  );
}

/** Audited exception to the pickup GPS gate. */
export function ReachedOverrideDialog({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (text: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (reason.trim().length < 10) return setError("Give the reason (at least 10 characters). It is kept on the trip record.");
    setBusy(true);
    setError(null);
    try {
      await overrideReachedPickup(booking.id, reason.trim());
      onDone("Pickup marked as reached by staff. The reason is recorded on the trip.");
    } catch (e) {
      setError(msg(e, "The trip was not updated."));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Mark pickup reached (staff exception)" subtitle={booking.bookingId || booking.id} onClose={onClose} busy={busy}
      footer={<><button onClick={onClose} disabled={busy} className={secondaryBtn}>Cancel</button><button onClick={go} disabled={busy} className={primaryBtn}>{busy ? "Saving…" : "Mark reached"}</button></>}
    >
      <div className="space-y-3 text-sm">
        {error && <Notice tone="error">{error}</Notice>}
        <Notice tone="warn">Use this only when the driver’s GPS cannot confirm the pickup (no signal, phone fault). The normal path needs a fresh, accurate location inside the pickup radius.</Notice>
        <Field label="Reason" required><textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={inputCls} /></Field>
      </div>
    </Modal>
  );
}

interface Settlement {
  amount: number;
  entitlement: number;
  collectedByPartner: number;
  status: string;
  channel?: string;
  dueAt?: any;
  completedAt?: any;
  partnerType: string;
  partnerName?: string;
  reference?: string;
  hold?: { reason: string; owner: string; deadline: any };
  failure?: { reason: string };
  overdueAt?: any;
}

/** The partner settlement for a completed trip: due 4 hours after completion, with its progress. */
export function SettlementPanel({ booking, canFinance }: { booking: Booking; canFinance: boolean }) {
  const [s, setS] = useState<Settlement | null | undefined>(undefined);
  const [action, setAction] = useState<"" | "paid" | "failed" | "hold">("");
  const [ref, setRef] = useState("");
  const [method, setMethod] = useState<"UPI" | "Bank Transfer">("UPI");
  const [reason, setReason] = useState("");
  const [owner, setOwner] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToDocument<Settlement>(`settlement_dues/${booking.id}`, setS, () => setS(null)), [booking.id]);
  if (booking.status !== "Completed") return null;
  if (s === undefined) return null;
  if (s === null) {
    return (
      <section className="bg-white rounded-xl border border-line p-4 text-sm text-muted">
        <h3 className="text-[15px] font-bold text-ink mb-1">Partner settlement</h3>
        No payout is due yet. It is created once the customer’s invoice is fully paid and the partner’s entitlement exceeds what they collected themselves.
      </section>
    );
  }
  const overdue = s.dueAt?.toMillis?.() < Date.now() && !["Paid", "Wallet"].includes(s.status);
  const run = async (i: Parameters<typeof updateSettlement>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await updateSettlement(i);
      setAction("");
      setRef("");
      setReason("");
    } catch (e) {
      setError(msg(e, "The settlement was not updated."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-white rounded-xl border border-line p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-ink">Partner settlement</h3>
        <span className={`text-xs font-bold px-2 py-0.5 rounded border ${s.status === "Paid" ? "bg-emerald-50 border-emerald-300 text-emerald-800" : overdue ? "bg-red-50 border-red-300 text-red-700" : "bg-amber-50 border-amber-300 text-amber-800"}`}>
          {s.status}{overdue ? " · overdue" : ""}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs font-semibold text-muted uppercase">Pay {s.partnerType}</dt><dd className="font-bold text-ink">{rupees(s.amount)}</dd></div>
        <div><dt className="text-xs font-semibold text-muted uppercase">Due</dt><dd className="font-semibold text-ink">{when(s.dueAt)}</dd></div>
        <div><dt className="text-xs font-semibold text-muted uppercase">Entitlement</dt><dd>{rupees(s.entitlement)}</dd></div>
        <div><dt className="text-xs font-semibold text-muted uppercase">Collected by partner</dt><dd>− {rupees(s.collectedByPartner)}</dd></div>
        {s.reference && <div className="col-span-2"><dt className="text-xs font-semibold text-muted uppercase">Transfer reference</dt><dd className="font-semibold">{s.reference}</dd></div>}
      </dl>
      {s.hold && <Notice tone="warn"><div className="text-xs"><strong>On hold:</strong> {s.hold.reason} · owner {s.hold.owner} · resolve by {when(s.hold.deadline)}. The original due time is kept.</div></Notice>}
      {s.failure && <Notice tone="error"><div className="text-xs"><strong>Failed:</strong> {s.failure.reason}</div></Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {canFinance && s.status !== "Paid" && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {s.status !== "Processing" && <button disabled={busy} onClick={() => run({ bookingId: booking.id, action: "processing" })} className={secondaryBtn}>Mark processing</button>}
            <button disabled={busy} onClick={() => setAction("paid")} className={primaryBtn}>Record payout…</button>
            <button disabled={busy} onClick={() => setAction("failed")} className={secondaryBtn}>Transfer failed…</button>
            {s.status === "On Hold" ? <button disabled={busy} onClick={() => run({ bookingId: booking.id, action: "release" })} className={secondaryBtn}>Release hold</button> : <button disabled={busy} onClick={() => setAction("hold")} className={secondaryBtn}>Put on hold…</button>}
          </div>
          {action === "paid" && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <Field label="Method"><select value={method} onChange={(e) => setMethod(e.target.value as "UPI" | "Bank Transfer")} className={inputCls}><option>UPI</option><option>Bank Transfer</option></select></Field>
              <Field label="Transfer reference" required hint="A payout is not Paid without the bank / UPI reference."><input value={ref} onChange={(e) => setRef(e.target.value)} className={inputCls} /></Field>
              <button disabled={busy || ref.trim().length < 6} onClick={() => run({ bookingId: booking.id, action: "paid", reference: ref.trim(), method })} className={primaryBtn}>{busy ? "Saving…" : "Confirm payout paid"}</button>
            </div>
          )}
          {action === "failed" && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <Field label="What went wrong" required><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
              <button disabled={busy || reason.trim().length < 5} onClick={() => run({ bookingId: booking.id, action: "failed", reason: reason.trim() })} className={primaryBtn}>Record failure</button>
            </div>
          )}
          {action === "hold" && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <Field label="Reason" required><input value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} /></Field>
              <Field label="Owner" required><input value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls} /></Field>
              <Field label="Resolve by" required><DateTime12Input value={deadline} onChange={setDeadline} /></Field>
              <button disabled={busy || reason.trim().length < 5 || !owner.trim() || !deadline} onClick={() => run({ bookingId: booking.id, action: "hold", reason: reason.trim(), holdOwner: owner.trim(), holdDeadline: new Date(deadline).toISOString() })} className={primaryBtn}>Put on hold</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
