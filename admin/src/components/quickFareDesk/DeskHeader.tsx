import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Icon from "../ui/Icon";
import { DESK_BRANDS, DESK_BRAND_LIST, type DeskBrand, type QueueFilter } from "../../domain/quickFareDesk";

/** Due · Upcoming · Sound: compact follow-up controls with real counts from the desk queue. */
export function FollowUpControls({ due, upcoming, soundOn, onFilter, onToggleSound }: {
  due: number;
  upcoming: number;
  soundOn: boolean;
  onFilter: (f: Extract<QueueFilter, "due" | "upcoming">) => void;
  onToggleSound: () => void;
}) {
  return (
    <div className="dk-ctrls" role="group" aria-label="Follow-up controls">
      <button type="button" className="dk-ctrl" data-tone={due > 0 ? "due" : undefined} onClick={() => onFilter("due")}
        aria-label={`${due} follow-up${due === 1 ? "" : "s"} due now. Show them in the queue.`} title="Show follow-ups due now">
        {due > 0 && <span className="dk-ctrl__ping" aria-hidden="true" />}
        <Icon name="bell-ring" size={16} />
        <span>Due</span>
        <b>{due}</b>
      </button>
      <button type="button" className="dk-ctrl" onClick={() => onFilter("upcoming")}
        aria-label={`${upcoming} upcoming follow-up${upcoming === 1 ? "" : "s"}. Show them in the queue.`} title="Show upcoming follow-ups">
        <Icon name="clock-3" size={16} />
        <span>Upcoming</span>
        <b>{upcoming}</b>
      </button>
      <button type="button" className="dk-ctrl" aria-pressed={soundOn} onClick={onToggleSound}
        aria-label={`Reminder sound ${soundOn ? "on" : "off"}. Turn it ${soundOn ? "off" : "on"}.`} title={`Reminder sound ${soundOn ? "on" : "off"}`}>
        <Icon name={soundOn ? "volume-2" : "volume-x"} size={16} />
        <span>Sound {soundOn ? "on" : "off"}</span>
      </button>
    </div>
  );
}

/** Booking source for new quotes. Saved enquiries keep the source they were quoted under. */
export function SourceSwitcher({ brand, onChange }: { brand: DeskBrand; onChange: (b: DeskBrand) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    wrap.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btn.current?.focus(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1) + items.length) % items.length]?.focus();
  };
  const meta = DESK_BRANDS[brand];
  return (
    <div className="relative shrink-0" ref={wrap} onKeyDown={onKey}>
      <button ref={btn} type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Booking source: ${meta.name}`}
        className="h-9 pl-2.5 pr-3 rounded-xl bg-white hover:bg-slate-50 border border-slate-200/90 flex items-center gap-2 transition-colors">
        <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${meta.dotClass} ${meta.ringClass}`} />
        <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">Source</span>
        <span className="text-xs font-bold text-slate-800">{meta.name}</span>
        <Icon name="chevrons-up-down" size={14} className="text-slate-400 shrink-0" />
      </button>
      {open && (
        <div role="listbox" aria-label="Booking source" className="absolute right-0 top-[calc(100%+6px)] z-40 w-56 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 fade-slide-in">
          {DESK_BRAND_LIST.map((k) => {
            const b = DESK_BRANDS[k];
            const on = brand === k;
            return (
              <button key={k} type="button" role="option" aria-selected={on} onClick={() => { onChange(k); setOpen(false); btn.current?.focus(); }}
                className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${on ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50"}`}>
                <span className="flex items-center gap-2 min-w-0">
                  <span className={`w-2 h-2 rounded-full ring-2 shrink-0 ${b.dotClass} ${b.ringClass}`} />
                  <span className={`text-xs truncate ${on ? "font-bold" : "font-semibold"}`}>{b.name}</span>
                </span>
                {on && <Icon name="check" size={14} className={b.bannerTone} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
