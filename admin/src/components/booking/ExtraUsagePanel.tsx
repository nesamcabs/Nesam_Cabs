import { useEffect, useState } from "react";
import type { Booking } from "../../types";
import { recordExtraUsage, reviewExtraUsage } from "../../services/bookingOpsService";
import { ActionError } from "../../services/callables";
import { useCan, useCanDo } from "../AccessContext";
import { Field, Notice, inputCls, primaryBtn, secondaryBtn } from "../FormKit";

/**
 * Extra usage on a trip: waiting at each stop, hill travel and roof carrier.
 * Staff record what happened (or the driver / vendor did); finance reviews a specific revision. The server prices it from the
 * rates saved on THIS booking and posts it to the customer's amount due and the partner's settlement on approval — nothing
 * typed here is an amount. "Not recorded" and "none" are different answers.
 */
type Tri = "" | "yes" | "no";
type WaitMode = "" | "none" | "stops";
interface StopRow { stopId: string; minutes: string }

const inr = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const triOf = (v: boolean | null | undefined): Tri => (v === true ? "yes" : v === false ? "no" : "");

export default function ExtraUsagePanel({ booking }: { booking: Booking }) {
  const completed = booking.status === "Completed";
  const live = booking.status === "Ongoing" || completed;
  const canRecord = useCanDo("Bookings", "edit");
  const hasFinance = useCan("finance");
  const canApprove = useCanDo("Accounts", "approve");
  const canReview = hasFinance && canApprove && canRecord;
  const u = booking.extraUsage;
  const approved = booking.extraCharges;
  const revision = u?.revision ?? 0;
  const locked = u?.status === "approved";

  const [wait, setWait] = useState<WaitMode>("");
  const [stops, setStops] = useState<StopRow[]>([{ stopId: "stop-1", minutes: "0" }]);
  const [hill, setHill] = useState<Tri>("");
  const [carrier, setCarrier] = useState<Tri>("");
  const [note, setNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);

  // Start the form from the latest recorded revision (an unfinished edit is kept while the revision is unchanged).
  useEffect(() => {
    const x = u?.usage;
    setWait(x?.stops == null ? "" : x.stops.length === 0 ? "none" : "stops");
    setStops(x?.stops && x.stops.length ? x.stops.map((s) => ({ stopId: s.stopId, minutes: String(s.waitedMinutes) })) : [{ stopId: "stop-1", minutes: "0" }]);
    setHill(triOf(x?.hill));
    setCarrier(triOf(x?.carrier));
  }, [revision]); // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown) => {
    const reasons = (e instanceof ActionError ? (e.details as { reasons?: string[] } | undefined)?.reasons : undefined) ?? [];
    setMsg({ tone: reasons.length ? "warn" : "error", text: e instanceof ActionError ? e.message : "That did not go through." });
  };

  const problem = (): string | null => {
    if (wait === "stops") {
      const ids = new Set<string>();
      for (const s of stops) {
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(s.stopId.trim())) return "Each stop needs a short name (letters, digits, - or _).";
        if (ids.has(s.stopId.trim())) return `Stop "${s.stopId.trim()}" is listed twice.`;
        ids.add(s.stopId.trim());
        const m = Number(s.minutes);
        if (s.minutes.trim() === "" || !Number.isInteger(m) || m < 0 || m > 1440) return `Waiting at "${s.stopId.trim()}" must be whole minutes (0 if none).`;
      }
    }
    if (wait === "" && hill === "" && carrier === "") return "Record waiting, hill travel or roof carrier.";
    return null;
  };

  const save = async () => {
    const p = problem();
    if (p) return setMsg({ tone: "error", text: p });
    setBusy(true);
    setMsg(null);
    try {
      const r = await recordExtraUsage({
        bookingId: booking.id, expectedRevision: revision, note: note.trim(),
        usage: {
          stops: wait === "" ? null : wait === "none" ? [] : stops.map((s) => ({ stopId: s.stopId.trim(), waitedMinutes: Number(s.minutes) })),
          hill: hill === "" ? null : hill === "yes", carrier: carrier === "" ? null : carrier === "yes",
        },
      });
      setNote("");
      setMsg({ tone: "ok", text: `Recorded as revision ${r.revision}. Finance reviews it before anything is billed.` });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const review = async (decision: "approve" | "reject") => {
    if (decision === "reject" && reviewNote.trim().length < 5) return setMsg({ tone: "error", text: "Give a short reason for rejecting." });
    setBusy(true);
    setMsg(null);
    try {
      const r = await reviewExtraUsage({ bookingId: booking.id, revision, decision, note: reviewNote.trim() });
      setReviewNote("");
      setMsg({ tone: "ok", text: r.status === "approved" ? `Approved. ${inr(r.customerTotalPaise ?? 0)} is added to the customer's amount due and the partner's credit is posted to settlement.` : "Rejected. A new revision can be recorded." });
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const statusText = !u ? "Nothing recorded" : u.status === "approved" ? `Approved (revision ${u.revision})` : u.status === "rejected" ? `Rejected (revision ${u.revision})` : `Waiting for review (revision ${u.revision})`;

  return (
    <section className="bg-white rounded-xl border border-line p-4 space-y-3" aria-labelledby="extra-usage-h">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id="extra-usage-h" className="text-[15px] font-bold text-ink">Extra usage · waiting, hills &amp; roof carrier</h3>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full border bg-gray-100 text-gray-700 border-gray-300">{statusText}</span>
      </div>

      {approved && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <div><dt className="text-xs font-semibold text-muted uppercase">Waiting</dt><dd className="font-semibold text-ink">{inr(approved.customer.waitingPaise)}{approved.waiting?.billedMinutes != null ? ` · ${approved.waiting.billedMinutes} min billed` : ""}</dd></div>
          <div><dt className="text-xs font-semibold text-muted uppercase">Hill travel</dt><dd className="font-semibold text-ink">{inr(approved.customer.hillPaise)}</dd></div>
          <div><dt className="text-xs font-semibold text-muted uppercase">Roof carrier</dt><dd className="font-semibold text-ink">{inr(approved.customer.carrierPaise)}</dd></div>
          <div><dt className="text-xs font-semibold text-muted uppercase">GST on extras</dt><dd className="font-semibold text-ink">{inr(approved.customer.gstPaise)}</dd></div>
          <div><dt className="text-xs font-semibold text-muted uppercase">Billed to customer</dt><dd className="font-semibold text-ink">{inr(approved.customer.totalPaise)}</dd></div>
          <div><dt className="text-xs font-semibold text-muted uppercase">Approved by</dt><dd className="font-semibold text-ink">{approved.approvedByName ?? "—"}</dd></div>
        </dl>
      )}
      {u?.status === "rejected" && u.reviewNote && <Notice tone="warn">Rejected: {u.reviewNote}</Notice>}
      {u?.status === "submitted" && u.submittedByName && <p className="text-xs text-muted">Recorded by {u.submittedByName}{u.submittedRole ? ` (${u.submittedRole})` : ""}.</p>}

      {!live && <p className="text-[12px] text-muted">Extra usage can be recorded once the trip has started.</p>}
      {locked && <p className="text-[12px] text-muted">Approved extra charges are final. They have been posted to the customer&rsquo;s amount due and the partner&rsquo;s settlement.</p>}

      {live && !locked && canRecord && (
        <div className="grid gap-3 max-w-[560px]">
          <Field label="Waiting" hint="Free waiting is applied to each stop on its own. “Not recorded” is different from “No waiting”.">
            <select className={inputCls} value={wait} disabled={busy} onChange={(e) => setWait(e.target.value as WaitMode)}>
              <option value="">Not recorded</option>
              <option value="none">No waiting at any stop</option>
              <option value="stops">Waiting at stops…</option>
            </select>
          </Field>
          {wait === "stops" && (
            <div className="grid gap-2">
              {stops.map((s, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label={i === 0 ? "Stop" : ""} className="flex-1"><input className={inputCls} value={s.stopId} disabled={busy} maxLength={40} onChange={(e) => setStops((r) => r.map((x, j) => (j === i ? { ...x, stopId: e.target.value } : x)))} aria-label={`Stop ${i + 1} name`} /></Field>
                  <Field label={i === 0 ? "Minutes waited" : ""} className="w-[140px]"><input className={`${inputCls} tabular-nums`} type="number" min={0} max={1440} step={1} value={s.minutes} disabled={busy} onChange={(e) => setStops((r) => r.map((x, j) => (j === i ? { ...x, minutes: e.target.value } : x)))} aria-label={`Minutes waited at stop ${i + 1}`} /></Field>
                  <button type="button" className={secondaryBtn} disabled={busy || stops.length === 1} onClick={() => setStops((r) => r.filter((_, j) => j !== i))} aria-label={`Remove stop ${i + 1}`}>Remove</button>
                </div>
              ))}
              <div><button type="button" className={secondaryBtn} disabled={busy || stops.length >= 20} onClick={() => setStops((r) => [...r, { stopId: `stop-${r.length + 1}`, minutes: "0" }])}>Add stop</button></div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Hill travel"><select className={inputCls} value={hill} disabled={busy} onChange={(e) => setHill(e.target.value as Tri)}><option value="">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
            <Field label="Roof carrier used"><select className={inputCls} value={carrier} disabled={busy} onChange={(e) => setCarrier(e.target.value as Tri)}><option value="">Not recorded</option><option value="yes">Yes</option><option value="no">No</option></select></Field>
          </div>
          <Field label="Note (optional)"><input className={inputCls} value={note} disabled={busy} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
          <div><button type="button" className={primaryBtn} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : u ? "Save new revision" : "Record usage"}</button></div>
        </div>
      )}

      {u?.status === "submitted" && canReview && (
        <div className="grid gap-2 max-w-[560px] border-t border-line pt-3">
          <p className="text-sm font-semibold text-ink">Review revision {u.revision}</p>
          <Field label="Reason (required to reject)"><input className={inputCls} value={reviewNote} disabled={busy} maxLength={300} onChange={(e) => setReviewNote(e.target.value)} /></Field>
          <div className="flex gap-2">
            <button type="button" className={primaryBtn} disabled={busy || !completed} onClick={() => void review("approve")}>Approve and bill</button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => void review("reject")}>Reject</button>
          </div>
          {!completed && <p className="text-[11px] text-muted">Approval is available once the trip is completed.</p>}
        </div>
      )}

      {msg && <Notice tone={msg.tone === "warn" ? "warn" : msg.tone}>{msg.text}</Notice>}
    </section>
  );
}
