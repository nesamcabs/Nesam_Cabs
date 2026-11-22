import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const TONE = {
  crimson: "bg-crimson-50 text-[#991B1B]",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
} as const;

/**
 * Desk dialog: centred on desktop, a bottom sheet on phones. Focus moves inside on open, Tab stays inside,
 * Escape closes the top-most dialog (unless busy), and focus returns to the control that opened it.
 */
export default function DeskDialog({ title, subtitle, icon, tone = "slate", size = "md", busy, onClose, children }: {
  title: string;
  subtitle?: ReactNode;
  icon?: IconName;
  tone?: keyof typeof TONE;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = box.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(`.dk-dialog__body ${FOCUSABLE.split(",").join(", .dk-dialog__body ")}`);
    (first ?? el)?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (open[open.length - 1] !== el) return;
      e.preventDefault();
      if (!busyRef.current) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (!items.length) return e.preventDefault();
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const width = size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-lg" : "sm:max-w-md";
  return (
    <div className="qfd-layer fixed inset-0 z-50 bg-slate-900/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
        className={`dk-dialog w-full ${width} bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col fade-slide-in`}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${TONE[tone]}`}><Icon name={icon} size={16} /></span>}
            <div className="min-w-0">
              <h3 id={titleId} className="text-sm sm:text-base font-extrabold text-slate-900">{title}</h3>
              {subtitle && <p className="text-[12px] font-semibold text-slate-500 truncate">{subtitle}</p>}
            </div>
          </div>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="dk-iconbtn w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="dk-dialog__body overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
