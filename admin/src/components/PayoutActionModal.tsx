import { useState } from "react";
import { PayoutActionError, deferPayout, markPayoutPaid, rejectPayout, type PayoutRequest } from "../services/earningsService";
import { auth } from "../services/firebase";
import { parseAmount } from "../utils/analytics";
import { Modal } from "./Feedback";

const rupees = (n: number) => { const v = Math.round(n * 100) / 100; return `₹${v.toLocaleString("en-IN", Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };

/** Mark paid (with UTR), defer or reject a driver / vendor payout request. */export default function PayoutActionModal({
  kind,
  payout,
  onClose,
  onDone,
}: {
  kind: "pay" | "reject" | "defer";
  payout: PayoutRequest;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = payout.driverName || payout.vendorName || "the partner";
  const amount = rupees(parseAmount(payout.amount));
  const copy = {
    pay: { title: `Mark ${amount} as paid`, label: "Bank / UPI transfer reference (UTR) *", button: "Mark Paid", done: `Payout of ${amount} to ${name} marked paid.` },
    reject: { title: `Reject ${amount} request`, label: "Reason shown to the partner *", button: "Reject Request", done: `Payout request from ${name} rejected; the amount is released back to their balance.` },
    defer: { title: `Defer ${amount} request`, label: "Note for the partner *", button: "Defer", done: `Payout request from ${name} deferred.` },
  }[kind];

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const actor = auth.currentUser?.uid || "";
    try {
      if (kind === "pay") await markPayoutPaid(payout, text, actor);
      else if (kind === "reject") await rejectPayout(payout, text, actor);
      else await deferPayout(payout, text, actor);
      onDone(copy.done);
    } catch (e) {
      setError(e instanceof PayoutActionError ? e.message : "Could not update the payout. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={copy.title}
      subtitle={`${name} • ${payout.method || "—"} ${payout.details || ""}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className="px-4 py-2 border border-line rounded-lg text-[12px] font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
          <button onClick={() => void submit()} disabled={busy} className={`px-5 py-2 rounded-lg text-[12px] font-bold text-white disabled:opacity-50 ${kind === "reject" ? "bg-red-600 hover:bg-red-700" : "bg-brand hover:opacity-90"}`}>
            {busy ? "Saving…" : copy.button}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-[12px]">
        {error && <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-semibold">{error}</div>}
        {kind === "pay" && <p className="text-gray-600">Record the transfer only after the money has been sent from the company account. The partner sees the reference in their app.</p>}
        <label className="block">
          <span className="text-[11px] font-bold text-gray-800">{copy.label}</span>
          {kind === "pay" ? (
            <input value={text} onChange={(e) => setText(e.target.value)} maxLength={60} className="mt-1 w-full p-2.5 border border-line rounded-lg font-mono" />
          ) : (
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={300} className="mt-1 w-full p-2.5 border border-line rounded-lg" />
          )}
        </label>
      </div>
    </Modal>
  );
}
