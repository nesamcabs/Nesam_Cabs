import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Button from "./ui/Button";
import Icon from "./ui/Icon";

export type ToastType = "success" | "error";
export interface ToastState {
  message: string;
  type: ToastType;
}

/** One toast at a time; a new message replaces the current one. */
export function useToast(durationMs = 3500) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (message: string, type: ToastType = "success") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ message, type });
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, show };
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div role={toast.type === "error" ? "alert" : "status"} className="ds-toast" data-type={toast.type}>
      <Icon name={toast.type === "success" ? "circle-check" : "circle-alert"} size={16} />
      <span>{toast.message}</span>
    </div>
  );
}

interface ModalProps {
  title: string;
  subtitle?: string;
  /** Small caps line above the title; the reference labels every control sheet this way. */
  eyebrow?: string;
  onClose: () => void;
  /** Blocks closing (backdrop, Escape, ✕) while a save is in flight. */
  busy?: boolean;
  size?: "md" | "lg" | "xl";
  /**
   * Every reference control sheet opens from the right; `centered` keeps a small centred dialog
   * (confirmations). `drawer` is accepted for older call sites and means the default.
   */
  centered?: boolean;
  drawer?: boolean;
  /** Extra-wide sheet (tables, documents). */
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** Left side of the footer (e.g. "Customer fare stays unchanged"). */
  footNote?: ReactNode;
}

const MAX_WIDTH = { md: 480, lg: 672, xl: 896 };
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Dialog with focus trap, Escape-to-close and focus restore. Used for modals and drawers alike. */
/** Inside this provider, wide tool views (the ones opened from a settings menu) render in the page itself, not as a side drawer. */
const InlineModalContext = createContext(false);
export const InlineModals = InlineModalContext.Provider;

export function Modal({ title, subtitle, eyebrow = "NESAM MASTER CONTROL", onClose, busy, size = "md", centered, wide, children, footer, footNote }: ModalProps) {
  const inline = useContext(InlineModalContext) && !!wide;
  const drawer = !centered;
  const dialog = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = dialog.current;
    // Land on the first control inside the body; fall back to the dialog itself.
    const first = el?.querySelector<HTMLElement>(".ds-dialog-body " + FOCUSABLE.split(",").join(", .ds-dialog-body "));
    (first ?? el)?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (e.key === "Escape" && dialogs[dialogs.length - 1] === dialog.current) {
        e.preventDefault();
        if (!busy) onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy]);

  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !dialog.current) return;
    const items = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const firstItem = items[0];
    const lastItem = items[items.length - 1];
    if (e.shiftKey && document.activeElement === firstItem) {
      e.preventDefault();
      lastItem.focus();
    } else if (!e.shiftKey && document.activeElement === lastItem) {
      e.preventDefault();
      firstItem.focus();
    }
  };

  // Rendered into the page body so no parent card (containment, transforms) can displace the popup.
  if (inline) {
    return (
      <section className="ds-inline-sheet" aria-label={title}>
        <header className="ds-inline-sheet__head">
          <div className="min-w-0">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </header>
        <div className="ds-inline-sheet__body">{children}</div>
        {(footer || footNote) && (
          <div className="ds-inline-sheet__foot">
            {footNote && <span className="ds-dialog-footnote">{footNote}</span>}
            {footer}
          </div>
        )}
      </section>
    );
  }

  return createPortal(
    <div
      className={`ds-overlay ${drawer ? "ds-drawer-overlay" : ""}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={trap}
        className={`ds-dialog ${drawer ? "ds-drawer" : ""}`}
        data-wide={wide || size === "xl" ? "true" : undefined}
        data-size={size}
        style={drawer ? undefined : { maxWidth: MAX_WIDTH[size] }}
      >
        <div className="ds-dialog-head">
          <div className="min-w-0">
            {eyebrow && <span className="ds-dialog-eyebrow">{eyebrow}</span>}
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <Button variant="ghost" iconOnly icon="x" onClick={onClose} disabled={busy} aria-label="Close" />
        </div>
        <div className="ds-dialog-body">{children}</div>
        {(footer || footNote) && (
          <div className="ds-dialog-foot">
            {footNote && <span className="ds-dialog-footnote">{footNote}</span>}
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, busy, error, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      busy={busy}
      centered
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={busy}>
            {busy ? "Please wait…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] text-body space-y-3">
        <div>{message}</div>
        {error && (
          <div role="alert" className="ds-error" style={{ margin: 0 }}>
            <Icon name="circle-alert" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** Inline error banner used for load failures. */
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="ds-error" style={{ justifyContent: "space-between", margin: 0 }}>
      <span className="flex items-center gap-2">
        <Icon name="circle-alert" />
        {message}
      </span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
