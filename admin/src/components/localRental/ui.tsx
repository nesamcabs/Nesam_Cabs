import { useState, type ReactNode } from "react";
import { Button, Icon } from "../ui";
import type { IconName } from "../ui/Icon";

// Small, consistent pieces of the Local & Rental workspace: white panels with a subtle border, the crimson segmented tabs, the
// status pills and the footer that carries the scope, the required reason and Save.

export function Panel({ title, aside, children, className = "", label }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      {(title || aside) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <h3 className="text-[17px] font-bold text-slate-900">{title}</h3> : <span />}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** Segmented control. `variant` "solid" = filled crimson (main tabs), "outline" = outlined crimson (sub views). */
export function Seg<T extends string>({ value, options, onChange, label, variant = "solid", disabledReason }: {
  value: T; options: { id: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void; label: string; variant?: "solid" | "outline"; disabledReason?: string;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1" role="tablist" aria-label={label}>
      {options.map((o) => {
        const on = o.id === value;
        const cls = on
          ? variant === "solid" ? "bg-[#991b1b] text-white shadow-sm" : "border border-[#b91c1c] bg-white text-[#b91c1c] shadow-sm"
          : "text-slate-700 hover:bg-white";
        return (
          <button key={o.id} type="button" role="tab" aria-selected={on} disabled={o.disabled} title={o.disabled ? o.title ?? disabledReason : o.title}
            className={`min-h-[34px] rounded-md px-4 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${cls}`} onClick={() => onChange(o.id)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const TONES = {
  ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  info: "bg-sky-50 text-sky-800 ring-sky-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  mixed: "bg-violet-50 text-violet-800 ring-violet-200",
  off: "bg-slate-100 text-slate-600 ring-slate-200",
  bad: "bg-red-50 text-red-800 ring-red-200",
} as const;
export type Tone = keyof typeof TONES;
export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return <span title={title} className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function Hint({ children, icon = "info" }: { children: ReactNode; icon?: IconName }) {
  return <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-slate-600"><Icon name={icon} size={14} className="mt-[2px] shrink-0 text-slate-500" /><span>{children}</span></p>;
}

export function Collapsible({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} size={18} className="text-slate-500" />
        <span className="flex-1 text-[15px] font-bold text-slate-900">{title}</span>
        <Icon name="chevron-down" size={16} className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="space-y-4 border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

/** Footer: where the change applies, the required reason, Save. Success is shown only after the server confirmed the save. */
export function Footer({ scopeText, reason, onReason, onSave, saveLabel, busy, disabled, message, note = "New quotes use updated rates. Existing bookings retain saved fares." }: {
  scopeText: string; reason: string; onReason: (v: string) => void; onSave: () => void; saveLabel: string; busy: boolean; disabled: boolean;
  message: { ok: boolean; text: string } | null; note?: string;
}) {
  return (
    // Sticky: the reason and Save stay in view while the tables scroll.
    <div className="sticky bottom-0 z-20 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="min-w-0 truncate text-[14px] text-slate-900" title={scopeText}>{scopeText}</strong>
        <span className="hidden h-6 w-px bg-slate-300 md:block" />
        <label className="flex min-w-0 flex-1 basis-[260px] flex-wrap items-center gap-x-3 gap-y-1">
          <span className="whitespace-nowrap text-[13.5px] font-semibold text-slate-700">Reason for change</span>
          <input className="ds-input min-w-0 flex-1 basis-[200px]" value={reason} maxLength={300} placeholder="Enter a reason for this change…" onChange={(e) => onReason(e.target.value)} />
        </label>
        <Button variant="primary" icon="save" onClick={onSave} loading={busy} disabled={disabled}>{saveLabel}</Button>
      </div>
      <div className="mt-2"><Hint>{note}</Hint></div>
      {message && <p className={`mt-2 text-[13px] font-semibold ${message.ok ? "text-emerald-700" : "text-red-700"}`} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </div>
  );
}

/** A failed read: what failed and why, with Retry. Never shown as an empty result; saving stays off until the read succeeds. */
export function LoadFailure({ what, failure, onRetry }: { what: string; failure: { denied: boolean; error: string | null }; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-[13.5px] text-red-900" role="alert">
      <Icon name="circle-alert" size={18} className="mt-[1px] shrink-0" />
      <div className="min-w-0 flex-1">
        <strong className="block">{what} could not be loaded.</strong>
        <span>{failure.denied ? "Access was denied by the database rules for this account. Nothing is shown or saved until they can be read." : failure.error ?? "The read failed."}</span>
      </div>
      <Button size="sm" onClick={onRetry}>Retry</Button>
    </div>
  );
}

export const cellInput = "ds-input h-[34px] w-full min-w-[78px] text-right tabular-nums";
