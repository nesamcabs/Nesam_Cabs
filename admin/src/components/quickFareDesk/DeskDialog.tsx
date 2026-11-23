import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const TONE = {
  amber: "bg-amber-50 text-amber-700",
  amberStrong: "bg-amber-100 text-amber-800",
  emerald: "bg-emerald-50 text-emerald-700",
  crimson: "bg-crimson-50 text-[#991B1B]",
} as const;

const WIDTH = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" } as const;
/** Literal class names (Tailwind only generates what it can read in the source). */
const SHEET_WIDTH = { sm: "sm:max-w-sm", md: "sm:max-w-md", lg: "sm:max-w-lg", xl: "sm:max-w-xl" } as const;

/**
 * Desk dialog in the reference's two forms: "sheet" (a bottom sheet on phones, centred from `sm`) and "center".
 * Focus moves inside on open and stays inside, Escape closes the top-most dialog (not while busy), and focus
 * returns to the control that opened it. The body scrolls on short screens.
 */
export default function DeskDialog({ title, subtitle, icon, tone, variant = "sheet", size = "md", header = "default", busy, onClose, children }: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof TONE;
  variant?: "sheet" | "center";
  size?: keyof typeof WIDTH;
  /** "amber": tinted header (number reveal); "handle": grab handle and large title (rental duration); "plain": no icon box. */
  header?: "default" | "amber" | "handle" | "plain";
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
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(`[data-dialog-body] :is(${FOCUSABLE})`);
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

  const sheet = variant === "sheet";
  const close = (
    <button type="button" aria-label="Close" disabled={busy} onClick={onClose}
      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors disabled:opacity-40 ${header === "handle" ? "text-slate-500 hover:bg-slate-100" : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"}`}>
      <X className={header === "handle" ? "w-5 h-5" : "w-4 h-4"} aria-hidden="true" />
    </button>
  );

  return (
    <div
      className={`qfd-layer fixed inset-0 z-50 bg-slate-900/50 flex justify-center ${sheet ? "items-end sm:items-center p-0 sm:p-4" : "items-center p-4"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={trap}
        className={`w-full ${sheet ? `${SHEET_WIDTH[size]} rounded-t-3xl ${header === "handle" ? "sm:rounded-3xl" : "sm:rounded-2xl"} max-h-[92dvh]` : `${WIDTH[size]} rounded-2xl max-h-[calc(100dvh-2rem)]`} bg-white shadow-2xl overflow-hidden flex flex-col fade-slide-in focus:outline-none`}
      >
        {header === "handle" ? (
          <>
            <div className="pt-3 pb-1 flex justify-center shrink-0" aria-hidden="true"><span className="w-11 h-1 rounded-full bg-slate-300/80" /></div>
            <div className="px-5 pt-2 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <h3 id={titleId} className="text-base font-bold text-slate-900">{title}</h3>
                {close}
              </div>
              {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
            </div>
          </>
        ) : (
          <div className={`px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0 ${header === "amber" ? "bg-amber-50/60" : ""}`}>
            <div className={`flex items-center min-w-0 ${header === "amber" ? "gap-2" : "gap-2.5"}`}>
              {icon && header !== "plain" && <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${TONE[tone ?? "amber"]}`} aria-hidden="true">{icon}</div>}
              <div className="min-w-0">
                <h3 id={titleId} className="text-sm font-bold text-slate-900">{title}</h3>
                {subtitle && <p className={`text-[11px] ${header === "amber" ? "text-slate-600" : "text-slate-500"}`}>{subtitle}</p>}
              </div>
            </div>
            {close}
          </div>
        )}
        <div data-dialog-body className="overflow-y-auto overscroll-contain min-h-0">{children}</div>
      </div>
    </div>
  );
}
