import { useEffect, useMemo, useState } from "react";
import { subscribeToCollection } from "../services/adminFirestoreService";
import { Notice } from "./FormKit";

interface Due {
  id: string;
  bookingCode?: string;
  partnerType?: string;
  partnerName?: string;
  amount: number;
  status: string;
  channel?: string;
  dueAt?: any;
  reference?: string;
  overdueAt?: any;
}

const FILTERS = ["Open", "Overdue", "On Hold", "Failed", "Paid", "All"] as const;
const when = (v: any) => {
  const d: Date | null = v?.toDate?.() ?? null;
  return d ? d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) : "—";
};

/** Partner payouts NESAM owes, ordered by when they fall due (completion + 4 hours). Open one to pay or hold it. */
export default function SettlementQueue({ onOpenBooking }: { onOpenBooking?: (id: string) => void }) {
  const [rows, setRows] = useState<Due[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Open");
  useEffect(() => subscribeToCollection<Due>("settlement_dues", setRows, (m) => { setError(m); setRows([]); }), []);

  const now = Date.now();
  const shown = useMemo(() => {
    const list = (rows ?? []).filter((r) => {
      const overdue = (r.dueAt?.toMillis?.() ?? Infinity) < now && !["Paid", "Wallet"].includes(r.status);
      if (filter === "All") return true;
      if (filter === "Paid") return r.status === "Paid";
      if (filter === "Overdue") return overdue;
      if (filter === "On Hold" || filter === "Failed") return r.status === filter;
      return ["Due", "Processing", "Failed", "On Hold"].includes(r.status);
    });
    return list.sort((a, b) => (a.dueAt?.toMillis?.() ?? 0) - (b.dueAt?.toMillis?.() ?? 0));
  }, [rows, filter, now]);

  const total = shown.filter((r) => r.status !== "Paid").reduce((s, r) => s + r.amount, 0);
  return (
    <div className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === f ? "bg-brand text-white border-brand" : "bg-white text-body border-line-strong"}`}>{f}</button>
        ))}
        <span className="ml-auto text-sm font-semibold text-ink">Outstanding in view: ₹{total.toLocaleString("en-IN")}</span>
      </div>
      <div className="bg-white rounded-xl border border-line overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead><tr className="text-left text-xs text-muted uppercase"><th className="p-3">Booking</th><th>Partner</th><th>Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="p-6 text-center text-muted">Loading…</td></tr>}
            {rows !== null && shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">No settlements in this view.</td></tr>}
            {shown.map((r) => {
              const overdue = (r.dueAt?.toMillis?.() ?? Infinity) < now && !["Paid", "Wallet"].includes(r.status);
              return (
                <tr key={r.id} className="border-t border-line-soft">
                  <td className="p-3 font-semibold">{r.bookingCode || r.id}</td>
                  <td>{r.partnerName || r.partnerType}<div className="text-xs text-muted capitalize">{r.partnerType}</div></td>
                  <td className="font-bold">₹{r.amount.toLocaleString("en-IN")}</td>
                  <td className={overdue ? "text-red-700 font-semibold" : ""}>{when(r.dueAt)}{overdue ? " · overdue" : ""}</td>
                  <td>{r.status}{r.channel === "wallet" ? " (wallet)" : ""}{r.reference ? <div className="text-xs text-muted">{r.reference}</div> : null}</td>
                  <td className="pr-3 text-right">{onOpenBooking && <button onClick={() => onOpenBooking(r.id)} className="text-brand font-semibold hover:underline">Open</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
