import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Icon from "../ui/Icon";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack: symbol[] = [];

/**
 * The reference's backdrop with a right-hand drawer or a centred dialog. Focus moves in, Tab stays inside,
 * Escape closes only the top layer, and focus returns to the control that opened it.
 */
export function Layer({ kind, title, onClose, busy, children, labelledBy }: { kind: "drawer" | "dialog"; title: string; onClose: () => void; busy?: boolean; children: ReactNode; labelledBy?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const me = useRef(Symbol("layer"));
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const id = me.current;
    stack.push(id);
    const el = panel.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE) ?? el)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape" && !busyRef.current) { e.preventDefault(); e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="cd-layer" data-kind={kind} onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy} tabIndex={-1} className={kind === "drawer" ? "cd-drawer cd-drawer-in" : "cd-dialog cd-fade-in"}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CloseButton({ onClick, label = "Close", disabled }: { onClick: () => void; label?: string; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center shrink-0 disabled:opacity-50">
      <Icon name="x" size={16} />
    </button>
  );
}

export function CdToast({ message, tone }: { message: string; tone: "success" | "error" }) {
  return createPortal(
    <div className="cd-toast cd-fade-in" role={tone === "error" ? "alert" : "status"}>
      <Icon name={tone === "error" ? "circle-alert" : "shield-check"} size={16} className={tone === "error" ? "text-red-400 shrink-0" : "text-emerald-400 shrink-0"} />
      <span>{message}</span>
    </div>,
    document.body,
  );
}

export const useTitleId = () => `cd-${useId().replace(/:/g, "")}`;
