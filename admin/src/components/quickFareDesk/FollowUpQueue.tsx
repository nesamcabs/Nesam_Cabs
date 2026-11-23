import { CalendarClock, CircleCheck, ClockAlert, Eye, LoaderCircle, ShieldAlert } from "lucide-react";
import {
  DESK_BRANDS,
  QUEUE_FILTERS,
  clock12,
  ddmmyyyy,
  deskAddOnLabels,
  deskFuelLabel,
  formatINR,
  istDateOf,
  istTimeOf,
  reminderLabel,
  scheduleLabel,
  spacedPhone,
  type DeskQueueRow,
  type QueueFilter,
} from "../../domain/quickFareDesk";
import type { NumberView } from "../../services/customerDirectoryService";

const pickupOf = (ms: number | null) => (ms ? `${ddmmyyyy(istDateOf(ms))}, ${clock12(istTimeOf(ms))}` : "");

function Badge({ row, nowMs }: { row: DeskQueueRow; nowMs: number }) {
  if (row.status === "due") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">
        <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" aria-hidden="true" />Due Now
      </span>
    );
  }
  if (row.status === "booked") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Booked ✓</span>;
  if (row.status === "lost") return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700">Lost • {row.lostReason || "Closed"}</span>;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200" title={reminderLabel(row, nowMs)}>
      <CalendarClock className="w-3 h-3" aria-hidden="true" />{row.followUpAtMs ? scheduleLabel(row.followUpAtMs) : "Upcoming"}
    </span>
  );
}

export function FollowUpQueue({ rows, filter, onFilter, nowMs, loading, error, revealed, canReveal, canBook, busy, onReveal, onSnooze, onLost, onBook }: {
  rows: DeskQueueRow[];
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  nowMs: number;
  loading: boolean;
  error: string | null;
  /** Numbers the server released after a logged reason, by enquiry id (hidden again when the reveal ends). */
  revealed: Record<string, string>;
  canReveal: boolean;
  canBook: boolean;
  /** Enquiries with a save in flight. */
  busy: ReadonlySet<string>;
  onReveal: (r: DeskQueueRow) => void;
  onSnooze: (r: DeskQueueRow) => void;
  onLost: (r: DeskQueueRow) => void;
  onBook: (r: DeskQueueRow) => void;
}) {
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  return (
    <section id="followUpQueueSection" className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden scroll-mt-4" aria-labelledby="qfQueueTitle">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0" aria-hidden="true"><ClockAlert className="w-4 h-4" /></div>
          <div className="min-w-0">
            <h2 id="qfQueueTitle" className="text-sm font-bold text-slate-900">Follow-Up Queue &amp; Alerts</h2>
            <p className="text-[11px] text-slate-500">Track callers who asked for a fare — call back when alert triggers &amp; convert to booking</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl flex-wrap" role="group" aria-label="Filter follow-ups">
          {QUEUE_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}
              className={`px-3 py-1 rounded-lg text-xs ${filter === f.id ? "font-semibold bg-white text-slate-900 shadow-xs" : "font-medium text-slate-600 hover:text-slate-900"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100" role="list" aria-label="Follow-ups" aria-busy={loading || undefined}>
        {error && <div role="alert" className="px-5 py-3 text-xs font-medium text-red-700 bg-red-50">Follow-ups could not be loaded: {error}</div>}
        {loading && !rows.length ? (
          <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2" role="status"><LoaderCircle className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />Loading follow-ups…</div>
        ) : shown.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">No follow-ups in this filter.</div>
        ) : shown.map((r) => {
          const phone = revealed[r.id];
          const open = r.status === "due" || r.status === "upcoming";
          const working = busy.has(r.id);
          const pickup = pickupOf(r.pickupAtMs);
          return (
            <div key={r.id} role="listitem" className="px-5 py-3.5 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge row={r} nowMs={nowMs} />
                  <span className="text-sm font-bold text-slate-900">{r.name || "Enquiry Caller"}</span>
                  {phone ? (
                    <a href={`tel:${phone}`} className="text-xs font-semibold text-emerald-700 hover:underline">{spacedPhone(phone)}</a>
                  ) : r.masked ? (
                    <span className="text-xs font-semibold text-slate-600">{r.masked}</span>
                  ) : (
                    <span className="text-xs font-medium text-slate-400">No number</span>
                  )}
                  {!phone && r.masked && (
                    <button type="button" disabled={!canReveal} onClick={() => onReveal(r)} aria-label={`View number of ${r.name || "caller"}`}
                      title={canReveal ? "Mandatory reason required to view the full number" : "Your Staff ID does not include viewing full customer numbers"}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 disabled:opacity-50 disabled:cursor-not-allowed">
                      <Eye className="w-3 h-3" aria-hidden="true" /><span>View #</span>
                    </button>
                  )}
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{DESK_BRANDS[r.brand].name}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-700 font-medium">
                  <span>
                    {r.route}
                    {pickup && <> • <span className="text-slate-500">{pickup}</span></>}
                    {(r.vehicle || r.fare !== null) && <> • <strong className="text-[#991B1B]">{r.vehicle || "Vehicle"}{r.fare !== null ? ` (${formatINR(r.fare)})` : ""}</strong></>}
                  </span>
                  {r.manual && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-900 text-white">Draft quote</span>}
                  {r.fromDesk && !r.manual && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{deskFuelLabel(r.fuel)}</span>}
                  {r.fromDesk && !r.manual && deskAddOnLabels(r.addOns).map((a) => (
                    <span key={a} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-crimson-50 text-[#991B1B] border border-crimson-200/70">{a}</span>
                  ))}
                </div>
                {r.note && <p className="text-[11px] text-slate-500 italic">“{r.note}”</p>}
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                {open ? (
                  <>
                    <button type="button" disabled={working} onClick={() => onLost(r)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-red-700 bg-red-100/90 border border-red-200 hover:bg-red-200/80 transition-colors disabled:opacity-50">Lost</button>
                    <button type="button" disabled={working} onClick={() => onSnooze(r)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50">Snooze +15m</button>
                    {canBook && (
                      <button type="button" disabled={working} onClick={() => onBook(r)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-xs flex items-center gap-1 disabled:opacity-50">
                        <CircleCheck className="w-3.5 h-3.5" aria-hidden="true" /><span>Fare OK • Book</span>
                      </button>
                    )}
                  </>
                ) : r.status === "booked" ? (
                  <span className="text-xs font-semibold text-emerald-700">Converted to Booking{r.bookingId ? ` (${r.bookingId})` : ""}</span>
                ) : (
                  <span className="text-xs font-medium text-slate-400">Closed ({r.lostReason || "Lost"})</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const viewTime = (ms: number, nowMs: number) => {
  if (!ms) return "—";
  const t = clock12(istTimeOf(ms));
  return istDateOf(ms) === istDateOf(nowMs) ? t : `${ddmmyyyy(istDateOf(ms))}, ${t}`;
};

/** The server's number-view ledger (customer_number_views), limited to desk enquiries. Nothing here is local. */
export function NumberViewLog({ rows, scope, loading, error, nowMs, onRetry }: {
  rows: NumberView[];
  scope: "all" | "own" | null;
  loading: boolean;
  error: string | null;
  nowMs: number;
  onRetry: () => void;
}) {
  return (
    <section className="bg-white rounded-2xl border border-amber-200/90 shadow-xs overflow-hidden" aria-labelledby="qfViewLogTitle">
      <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-200/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
          <h2 id="qfViewLogTitle" className="text-xs font-bold text-amber-950">Caller Number View Log (Mandatory Reason Required)</h2>
        </div>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900" title="A number is released only after the server has saved the view and its reason">100% Audited</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <th scope="col" className="py-2 px-5">Staff Account</th>
              <th scope="col" className="py-2 px-4">Caller</th>
              <th scope="col" className="py-2 px-4">Mandatory Reason Given</th>
              <th scope="col" className="py-2 px-5 text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 px-5 font-semibold text-slate-900">{r.viewedBy}{r.viewedByRole ? <span className="font-medium text-slate-400"> ({r.viewedByRole})</span> : null}</td>
                <td className="py-2 px-4 font-medium text-[#991B1B]">{r.customer || "Enquiry Caller"} ({r.customerCode})</td>
                <td className="py-2 px-4 text-slate-700">{r.reason}</td>
                <td className="py-2 px-5 text-right text-[11px] font-semibold text-slate-500 whitespace-nowrap">{viewTime(r.atMs, nowMs)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="py-3 px-5 text-[11px] text-slate-400">
                  {loading ? "Loading the view log…" : error ? (
                    <span className="text-red-700">The view log could not be loaded: {error} <button type="button" onClick={onRetry} className="underline font-semibold">Retry</button></span>
                  ) : "No caller numbers viewed yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {scope === "own" && <p className="px-5 py-2 border-t border-slate-100 text-[10px] text-slate-400">Showing the numbers you viewed. The Master account sees every staff member's views.</p>}
    </section>
  );
}
