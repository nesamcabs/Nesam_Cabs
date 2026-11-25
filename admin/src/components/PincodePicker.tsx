import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./ui/Icon";
import { kmText, pincodeGroups, type PincodeEntry, type PincodeList } from "../domain/pincodes";

/**
 * Pick which pincodes of a city / district a setting covers. Every pincode starts ticked: all of them means the whole city
 * (one setting that covers everything inside it); fewer means only those pincodes, one setting each.
 * The city's own pincodes and the nearest ones are listed first, marked and with their distance; the rest of the district follows.
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
  const groups = useMemo(() => pincodeGroups(shown), [shown]);
  const all = useMemo(() => pincodeGroups(pins), [pins]);
  // Two headed groups only when the city has pincodes of its own / nearby AND others; otherwise one plain list.
  const grouped = all.top.length > 0 && all.rest.length > 0;
  const city = list?.city ?? "the city";
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
      const height = Math.max(220, Math.min(420, up ? above : below));
      setAt({ left: Math.min(r.left, Math.max(8, window.innerWidth - 348)), top: up ? Math.max(8, r.top - 6 - height) : r.bottom + 6, width: Math.max(r.width, 340), height });
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
  const allOn = (rows: readonly PincodeEntry[]) => rows.length > 0 && rows.every((p) => chosen.has(p.pin));
  const toggleMany = (rows: readonly PincodeEntry[]) => {
    const pinsOf = rows.map((p) => p.pin);
    onChange(allOn(rows) ? selected.filter((p) => !pinsOf.includes(p)) : [...new Set([...selected, ...pinsOf])]);
  };
  const nearbyOnly = all.top.length > 0 && !(selected.length === all.top.length && allOn(all.top));

  const row = (p: PincodeEntry) => (
    <li key={p.pin} className={p.tier < 2 && grouped ? "bg-emerald-50/60" : ""}>
      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-slate-50">
        <input type="checkbox" checked={chosen.has(p.pin)} onChange={() => toggle(p.pin)} />
        <span className="font-semibold tabular-nums text-slate-800">{p.pin}</span>
        <span className="min-w-0 flex-1 truncate text-slate-500">{p.name}</span>
        {p.tier === 0 && grouped && <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-emerald-800">City</span>}
        {kmText(p.km) && <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{p.tier === 0 && p.km === 0 ? "centre" : kmText(p.km)}</span>}
      </label>
    </li>
  );
  const head = (title: string, count: number, rows: readonly PincodeEntry[], tone: "near" | "rest") => (
    <li role="presentation" className={`flex items-center justify-between gap-2 border-y px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide ${tone === "near" ? "border-emerald-200 bg-emerald-100 text-emerald-900" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
      <span className="truncate">{title} · {count}</span>
      <button type="button" className="fm-linkbtn !text-[11px] normal-case" onClick={() => toggleMany(rows)}>{allOn(rows) ? "Clear" : "Select"}</button>
    </li>
  );

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
                {grouped && nearbyOnly && <button type="button" className="fm-linkbtn" onClick={() => onChange(all.top.map((p) => p.pin))}>{city} &amp; nearby only</button>}
                <button type="button" className="fm-linkbtn" onClick={() => toggleMany(shown)}>{text ? (allOn(shown) ? "Clear shown" : "Select shown") : allOn(pins) ? "Clear all" : "Select all"}</button>
              </span>
            </div>
            {list?.parent && <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-[11.5px] leading-snug text-slate-600">Only post offices named after this town, inside {list.parent}. For every pincode of {list.parent}, choose {list.parent} as the city.</p>}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto pb-1" role="group" aria-label="Pincodes">
            {shown.length === 0 ? <li className="px-3 py-2 text-[13px] text-slate-500">No pincode matches.</li>
              : grouped ? (
                <>
                  {groups.top.length > 0 && <>{head(`${city} & nearby`, groups.top.length, groups.top, "near")}{groups.top.map(row)}</>}
                  {groups.rest.length > 0 && <>{head(`Other pincodes in ${city}`, groups.rest.length, groups.rest, "rest")}{groups.rest.map(row)}</>}
                </>
              ) : shown.map(row)}
          </ul>
        </div>, document.body)}
    </>
  );
}
