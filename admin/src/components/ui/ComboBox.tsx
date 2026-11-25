import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";

/**
 * A text box with a white list of choices, looking like the other dropdowns (the browser's own datalist popup is dark and
 * cannot be styled). Typing narrows the list and a value that is not listed is kept. The list is drawn on the page body so
 * a card that hides its overflow cannot cut it off.
 */
export default function ComboBox({ value, options, onChange, disabled, placeholder, label, title }: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Accessible name. */
  label: string;
  title?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const [at, setAt] = useState({ left: 0, top: 0, width: 0, height: 280 });
  // Opening an already filled box shows every choice; the list narrows once the person types.
  const text = typed ? value.trim().toLowerCase() : "";
  const shown = options.filter((o) => !text || o.toLowerCase().includes(text));
  const visible = open && !disabled && options.length > 0;

  useLayoutEffect(() => {
    if (!visible) return undefined;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const up = below < 180 && above > below;
      const height = Math.max(120, Math.min(280, up ? above : below));
      setAt({ left: r.left, top: up ? r.top - 6 - Math.min(height, list.current?.offsetHeight ?? height) : r.bottom + 6, width: r.width, height });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [visible, shown.length]);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [active]);

  const close = () => { setOpen(false); setTyped(false); setActive(-1); };
  const show = () => { if (!open) { setOpen(true); setTyped(false); setActive(-1); } };
  const choose = (option: string) => { onChange(option); close(); };

  return (
    <div ref={box} className="relative">
      <input className="ds-select w-full !pr-9" role="combobox" aria-label={label} aria-expanded={visible} aria-controls={id} aria-autocomplete="list"
        aria-activedescendant={visible && active >= 0 ? `${id}-${active}` : undefined}
        value={value} disabled={disabled} placeholder={placeholder} title={title} autoComplete="off"
        onFocus={show} onClick={show} onBlur={close}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setTyped(true); setActive(-1); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return show();
            setActive((i) => (shown.length ? (i + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length : -1));
          } else if (e.key === "Enter" && visible && shown[active] !== undefined) { e.preventDefault(); choose(shown[active]!); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); close(); }
        }} />
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-600" />
      {visible && createPortal(
        <ul ref={list} id={id} role="listbox" aria-label={label} onMouseDown={(e) => e.preventDefault()}
          className="fixed z-[300] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          style={{ left: at.left, top: at.top, minWidth: at.width, maxHeight: at.height }}>
          {shown.length === 0 ? <li className="px-3 py-2 text-[13px] text-slate-500">Not listed. It is added as you typed it.</li> : shown.map((o, i) => (
            <li key={o} id={`${id}-${i}`} role="option" aria-selected={i === active} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
              className={`cursor-pointer px-3 py-2 text-[13px] ${i === active ? "bg-slate-100 text-slate-900" : o === value ? "bg-[#FEF2F2] font-semibold text-[#9F1212]" : "text-slate-700"}`}>{o}</li>
          ))}
        </ul>, document.body)}
    </div>
  );
}
