import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** A rate box: blank means 0 / not set. What is being typed is kept until the box is left, so "1." can be typed. */
export function NumberBox({ value, onChange, label, className = "", integer, disabled, placeholder = "0", step, max }: {
  value: number; onChange: (n: number) => void; label: string; className?: string; integer?: boolean; disabled?: boolean; placeholder?: string; step?: number; max?: number;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  // What was typed is shown only while it still means the saved number: a value changed from outside ("Use inherited", Discard)
  // replaces it at once.
  const current = typed !== null && Number(typed) === value;
  return (
    <input type="number" inputMode="decimal" min={0} max={max} step={step ?? "any"} aria-label={label} title={label} disabled={disabled} placeholder={placeholder}
      className={`lf-num ${className}`}
      value={current ? typed : value ? String(value) : ""}
      onWheel={(e) => e.currentTarget.blur()}
      onBlur={() => setTyped(null)}
      onChange={(e) => {
        const raw = e.target.value;
        setTyped(raw);
        const n = raw === "" ? 0 : Number(raw);
        if (!Number.isFinite(n)) return;
        const bounded = Math.min(max ?? 1_000_000, Math.max(0, n));
        onChange(integer ? Math.round(bounded) : Math.round(bounded * 100) / 100);
      }} />
  );
}

export function Accordion({ open, onToggle, icon, title, badge, children }: { open: boolean; onToggle: () => void; icon: ReactNode; title: string; badge?: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
      <button type="button" aria-expanded={open} onClick={onToggle} className="w-full px-5 py-3.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50/70 transition-colors">
        <span className="flex items-center gap-2.5 flex-wrap">
          {icon}
          <span className="text-xs font-bold text-slate-900">{title}</span>
          {badge ? <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">{badge}</span> : null}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="border-t border-slate-100">{children}</div>}
    </div>
  );
}

export const rupees = (n: number): string => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const hourLabel = (h: number): string => `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:00 ${h % 24 < 12 ? "AM" : "PM"}`;
export const selectClass = "w-full h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:border-[#991B1B]";
