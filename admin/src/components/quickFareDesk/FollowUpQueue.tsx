import Icon from "../ui/Icon";
import {
  DESK_BRANDS,
  QUEUE_FILTERS,
  deskFollowUpStatus,
  deskReminderLabel,
  formatINR,
  maskPhone,
  type DeskFollowUp,
  type DeskRevealEntry,
  type QueueFilter,
} from "../../domain/quickFareDesk";
import { formatTime12 } from "../../utils/time";

const EMPTY: Record<QueueFilter, string> = {
  all: "No follow-ups yet. Get a fare and choose Follow-up to add one.",
  due: "Nothing is due now.",
  upcoming: "No upcoming follow-ups.",
  booked: "No booking drafts yet.",
  lost: "No lost enquiries.",
};

export function FollowUpQueue({ rows, nowMs, filter, onFilter, counts, revealed, canBook, onReveal, onHide, onSnooze, onLost, onBook }: {
  rows: DeskFollowUp[];
  nowMs: number;
  filter: QueueFilter;
  onFilter: (f: QueueFilter) => void;
  counts: Record<QueueFilter, number>;
  revealed: Record<string, true>;
  canBook: boolean;
  onReveal: (f: DeskFollowUp) => void;
  onHide: (f: DeskFollowUp) => void;
  onSnooze: (f: DeskFollowUp) => void;
  onLost: (f: DeskFollowUp) => void;
  onBook: (f: DeskFollowUp) => void;
}) {
  const shown = filter === "all" ? rows : rows.filter((r) => deskFollowUpStatus(r, nowMs) === filter);
  return (
    <section id="followUpQueueSection" className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden scroll-mt-4" aria-labelledby="fuQueueTitle">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center"><Icon name="clock-alert" size={16} /></span>
          <h2 id="fuQueueTitle" className="text-sm font-extrabold text-slate-900">Follow-ups</h2>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl flex-wrap" role="group" aria-label="Filter follow-ups">
          {QUEUE_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${filter === f.id ? "font-extrabold bg-white text-slate-900 shadow-xs" : "font-semibold text-slate-600 hover:text-slate-900"}`}>
              {f.id === "booked" ? "Drafts" : f.label}<span className="ml-1 text-[10px] text-slate-400">{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="p-8 text-center text-xs font-semibold text-slate-500">{EMPTY[filter]}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((f) => {
            const s = deskFollowUpStatus(f, nowMs);
            const isRev = !!revealed[f.id];
            const label = deskReminderLabel(f, nowMs);
            return (
              <li key={f.id} className="px-5 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`dk-status dk-status--${s}`}>{s === "due" && <span className="dk-status__dot" aria-hidden="true" />}{label}</span>
                    <span className="text-sm font-extrabold text-slate-900">{f.name || "Caller (name not given)"}</span>
                    <span className={`text-xs font-bold tabular-nums ${isRev ? "text-emerald-700" : "text-slate-500"}`}>{isRev ? f.mobile : maskPhone(f.mobile)}</span>
                    {isRev ? (
                      <>
                        <a href={`tel:${f.mobile}`} className="dk-mini dk-mini--ok"><Icon name="phone" size={12} />Call</a>
                        <button type="button" className="dk-mini" onClick={() => onHide(f)}><Icon name="eye-off" size={12} />Hide</button>
                      </>
                    ) : (
                      <button type="button" className="dk-mini dk-mini--warn" onClick={() => onReveal(f)} aria-label={`View number of ${f.name || "caller"}`}><Icon name="eye" size={12} />View #</button>
                    )}
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{DESK_BRANDS[f.trip.source].name}</span>
                  </div>
                  <p className="text-[12.5px] font-semibold text-slate-800">
                    {f.trip.tripLabel} · {f.trip.route} · <span className="text-slate-500">{f.trip.pickupLabel}</span> ·{" "}
                    <strong className="text-[#991B1B] font-extrabold">{f.quote.vehicle} {formatINR(f.quote.fare)}</strong>
                    {f.quote.manual && <span className="dk-draftbadge ml-1.5">Draft quote</span>}
                  </p>
                  {f.note && <p className="text-[11.5px] text-slate-500 italic">“{f.note}”</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  {f.state === "open" ? (
                    <>
                      <button type="button" onClick={() => onLost(f)} className="h-8 px-3 rounded-[10px] text-xs font-bold text-[#991B1B] bg-white border border-red-200 hover:bg-red-50">Lost</button>
                      <button type="button" onClick={() => onSnooze(f)} className="h-8 px-3 rounded-[10px] text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 flex items-center gap-1"><Icon name="alarm-clock" size={13} />Snooze +15m</button>
                      {canBook && (
                        <button type="button" onClick={() => onBook(f)} className="h-8 px-3.5 rounded-[10px] text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5"><Icon name="check" size={14} />Book</button>
                      )}
                    </>
                  ) : f.state === "draft" ? (
                    <span className="text-xs font-bold text-emerald-700 flex items-center gap-1"><Icon name="file-check-2" size={14} />Draft {f.draftRef}</span>
                  ) : (
                    <span className="text-xs font-semibold text-slate-400">Closed</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function RevealHistory({ rows }: { rows: DeskRevealEntry[] }) {
  return (
    <section className="bg-white rounded-2xl border border-amber-200/90 shadow-sm overflow-hidden" aria-labelledby="revealTitle">
      <div className="px-5 py-3 bg-amber-50/60 border-b border-amber-200/70 flex flex-wrap items-center justify-between gap-2">
        <h2 id="revealTitle" className="text-xs font-extrabold text-amber-950 flex items-center gap-2"><Icon name="shield-alert" size={16} className="text-amber-700" />Number views · session history</h2>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">This browser session</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-4 text-[11.5px] text-slate-500">No numbers viewed in this session.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-2 px-5">Viewed by</th><th className="py-2 px-4">Caller</th><th className="py-2 px-4">Reason</th><th className="py-2 px-5 text-right">Time (IST)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 px-5 font-bold text-slate-900">{r.staff}</td>
                  <td className="py-2 px-4 font-semibold text-[#991B1B]">{r.caller}</td>
                  <td className="py-2 px-4 text-slate-700">{r.reason}</td>
                  <td className="py-2 px-5 text-right text-[11px] font-bold text-slate-500 tabular-nums">{formatTime12(new Date(r.atMs))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 py-2 border-t border-slate-100 text-[10.5px] text-slate-400">Kept in this browser session only; it is not a permanent audit record.</p>
    </section>
  );
}
