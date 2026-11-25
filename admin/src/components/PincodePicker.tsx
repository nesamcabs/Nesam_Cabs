import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./ui/Icon";
import type { PincodeList } from "../domain/pincodes";

/**
 * Pick which pincodes of a city / district a setting covers. Every pincode starts ticked: all of them means the whole city
 * (one setting that covers everything inside it); fewer means only those pincodes, one setting each.
 * The list is drawn on the page body so a card that hides its overflow cannot cut it off.
 */
export default function PincodePicker({ list, selected, onChange, disabled, cityChosen, label = "Pincodes" }: {
  /** undefined while loading, null when this place has no pincode list. */
  list: PincodeList | null | undefined;
  selected: string[];
  onChange: (pins: string[]) => void;
  disabled?: boolean;
  cityChosen: boolean;
  label?: string;
}) {
  const id = useId();
  const box = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState({ left: 0, top: 0, width: 300, height: 320 });
  const pins = list?.pins ?? [];
  const chosen = useMemo(() => new Set(selected), [selected]);
  const text = q.trim().toLowerCase();
  const shown = useMemo(() => pins.filter((p) => !text || p.pin.includes(text) || p.name.toLowerCase().includes(text)), [pins, text]);
  const usable = cityChosen && !disabled && !!list && pins.length > 0;
  const visible = open && usable;

  const summary = !cityChosen ? "Choose a city first"
    : list === undefined ? "Loading pincodes…"
    : !list || !pins.length ? "No pincode list: whole city"
    : selected.length === pins.length ? `All ${pins.length} pincodes`
    : selected.length === 0 ? "None selected"
    : `${selected.length} of ${pins.length} pincodes`;

  useEffect(() => { if (!usable) setOpen(false); }, [usable]);
  useEffect(() => { if (!open) setQ(""); }, [open]);
  useLayoutEffect(() => {
    if (!visible) return undefined;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 260 && above > below;
      const height = Math.max(220, Math.min(380, up ? above : below));
      setAt({ left: Math.min(r.left, Math.max(8, window.innerWidth - 328)), top: up ? Math.max(8, r.top - 6 - height) : r.bottom + 6, width: Math.max(r.width, 320), height });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return undefined;
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); box.current?.focus(); } };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [visible]);

  const toggle = (pin: string) => onChange(chosen.has(pin) ? selected.filter((p) => p !== pin) : [...selected, pin]);
  const shownPins = shown.map((p) => p.pin);
  const allShownOn = shownPins.length > 0 && shownPins.every((p) => chosen.has(p));

  return (
    <>
      <button ref={box} type="button" className="ds-select w-full text-left" disabled={!usable} aria-label={label} aria-haspopup="dialog" aria-expanded={visible} aria-controls={id}
        title={list?.parent ? `Post offices named after this town, in ${list.parent}` : "Every pincode inside this city / district. All ticked = the whole city; fewer = only those pincodes."}
        onClick={() => setOpen((o) => !o)}>
        <span className={`block truncate pr-5 ${usable ? "" : "text-slate-500"}`}>{summary}</span>
      </button>
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute bottom-[11px] right-3 text-slate-600" />
      {visible && createPortal(
        <div ref={panel} id={id} role="dialog" aria-label={label} className="fixed z-[300] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          style={{ left: at.left, top: at.top, width: at.width, maxHeight: at.height }}>
          <div className="border-b border-slate-100 p-2">
            <input className="ds-input w-full" type="search" autoFocus placeholder="Search pincode or place" aria-label="Search pincodes" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
              <span className="text-slate-600" aria-live="polite">{selected.length} of {pins.length} selected</span>
              <span className="flex gap-3">
                <button type="button" className="fm-linkbtn" onClick={() => onChange(allShownOn ? selected.filter((p) => !shownPins.includes(p)) : [...new Set([...selected, ...shownPins])])}>
                  {text ? (allShownOn ? "Clear shown" : "Select shown") : allShownOn ? "Clear all" : "Select all"}
                </button>
              </span>
            </div>
            {list?.parent && <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11.5px] leading-snug text-slate-600">Only post offices named after this town, inside {list.parent}. For every pincode of {list.parent}, choose {list.parent} as the city.</p>}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="group" aria-label="Pincodes">
            {shown.length === 0 ? <li className="px-3 py-2 text-[13px] text-slate-500">No pincode matches.</li> : shown.map((p) => (
              <li key={p.pin}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-slate-50">
                  <input type="checkbox" checked={chosen.has(p.pin)} onChange={() => toggle(p.pin)} />
                  <span className="font-semibold tabular-nums text-slate-800">{p.pin}</span>
                  <span className="truncate text-slate-500">{p.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>, document.body)}
    </>
  );
}
