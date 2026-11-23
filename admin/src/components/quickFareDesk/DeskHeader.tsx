import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BellRing, Check, ChevronsUpDown, CircleCheck } from "lucide-react";
import { DESK_BRANDS, DESK_BRAND_LIST, deskExtrasLabel, formatINR, type DeskBrand, type DeskQueueRow } from "../../domain/quickFareDesk";

/** "N Follow-ups Due" from the real queue; amber with a ping only while something is actually due. */
export function AlertPill({ due, onClick }: { due: number; onClick: () => void }) {
  const on = due > 0;
  return (
    <button type="button" onClick={onClick}
      aria-label={on ? `${due} follow-up${due > 1 ? "s" : ""} due. Show the follow-up queue.` : "No follow-ups due. Show the follow-up queue."}
      className={`h-9 px-3 rounded-xl flex items-center gap-2 transition-all ${on ? "bg-amber-50 hover:bg-amber-100/80 border border-amber-200/90 text-amber-800" : "bg-white hover:bg-slate-50 border border-slate-200 text-slate-600"}`}>
      <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
        {on && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />}
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-600" />
      </span>
      <BellRing className="w-3.5 h-3.5 text-amber-700" aria-hidden="true" />
      <span className="text-xs font-semibold" aria-live="polite">{on ? `${due} Follow-up${due > 1 ? "s" : ""} Due` : "No Due Alerts"}</span>
    </button>
  );
}

/** Booking source for new quotes. A saved enquiry keeps the source it was quoted under. */
export function SourceSwitcher({ brand, onChange }: { brand: DeskBrand; onChange: (b: DeskBrand) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    wrap.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  };
  const meta = DESK_BRANDS[brand];
  return (
    <div className="relative shrink-0" ref={wrap} onKeyDown={onKey}>
      <button ref={btn} type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Booking source: ${meta.name}`}
        className="h-9 pl-2.5 pr-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 flex items-center gap-2 transition-all shadow-xs focus:outline-none focus:ring-2 focus:ring-[#991B1B]/15">
        <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${meta.dotClass}`} aria-hidden="true" />
        <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">Source:</span>
        <span className="text-xs font-semibold text-slate-800">{meta.name}</span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" aria-label="Booking Source" className="absolute right-0 top-[calc(100%+6px)] z-40 w-52 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 fade-slide-in">
          <p className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400" aria-hidden="true">Booking Source</p>
          {DESK_BRAND_LIST.map((k) => {
            const b = DESK_BRANDS[k];
            const on = brand === k;
            return (
              <button key={k} type="button" role="option" aria-selected={on} onClick={() => { onChange(k); setOpen(false); btn.current?.focus(); }}
                className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-left ${on ? "bg-slate-100/90 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${b.dotClass}`} aria-hidden="true" />
                  <span className={`text-xs truncate ${on ? "font-semibold" : "font-medium"}`}>{b.name}</span>
                </span>
                {on && <Check className={`w-3.5 h-3.5 shrink-0 ${b.checkClass}`} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The most overdue follow-up, with Snooze and Book. Shown only while a follow-up is really due. */
export function DueBanner({ row, phone, busy, canBook, onSnooze, onBook }: {
  row: DeskQueueRow;
  /** The number, only while a reveal is active; otherwise the masked number is shown. */
  phone: string | null;
  busy: boolean;
  canBook: boolean;
  onSnooze: () => void;
  onBook: () => void;
}) {
  const extras = row.fromDesk && !row.manual ? ` [${deskExtrasLabel(row)}]` : "";
  const number = phone ?? row.masked;
  return (
    <section className="rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50/70 to-amber-50 border border-amber-200/90 p-3.5 sm:px-5 shadow-xs fade-slide-in" aria-label="Follow-up alert">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0" aria-hidden="true">
            <BellRing className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-600 text-white">Follow-up Alert</span>
              <span className="text-xs sm:text-sm font-bold text-slate-900 truncate">{row.name || "Enquiry Caller"}{number ? ` (${number})` : ""}</span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5 truncate">
              {row.route}{row.vehicle ? ` • ${row.vehicle}` : ""}{extras}{row.fare !== null ? ` (${formatINR(row.fare)})` : ""}{row.note ? ` — “${row.note}”` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button type="button" disabled={busy} onClick={onSnooze}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50">
            Snooze +15m
          </button>
          {canBook && (
            <button type="button" disabled={busy} onClick={onBook}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50">
              <CircleCheck className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Fare OK • Book Now</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
