import type { ReactNode } from "react";

/** One input style for every admin form: readable size, clear border, visible focus and disabled state. */
export const inputCls =
  "w-full min-h-[38px] px-3 py-2 border border-[#d9dfe7] rounded-lg text-[13px] bg-white text-ink placeholder-faint transition-[border-color,box-shadow] hover:border-[#c4ccd8] focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/15 disabled:bg-neutral-bg disabled:text-muted";
export const inputErrCls = "border-bad";

export function Field({
  label, required, hint, error, children, className = "",
}: { label: string; required?: boolean; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[12px] font-medium text-muted mb-1.5">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-muted mt-1">{hint}</span>}
      {error && <span role="alert" className="block text-xs font-semibold text-bad mt-1">{error}</span>}
    </label>
  );
}

export function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</h4>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function Notice({ tone, children }: { tone: "error" | "warn" | "info" | "ok"; children: ReactNode }) {
  const cls = {
    error: "bg-bad-bg border-bad-line text-bad",
    warn: "bg-warn-bg border-warn-line text-warn",
    info: "bg-info-bg border-info-line text-info",
    ok: "bg-ok-bg border-ok-line text-ok",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`px-3.5 py-3 rounded-lg border text-[13px] ${cls}`}>
      {children}
    </div>
  );
}

export const primaryBtn = "ds-btn ds-btn-primary";
export const secondaryBtn = "ds-btn ds-btn-secondary";
export const darkBtn = "ds-btn bg-ink text-white border-ink hover:bg-ink-2";
