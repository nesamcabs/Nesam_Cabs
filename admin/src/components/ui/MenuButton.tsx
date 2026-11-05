import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Icon, { type IconName } from "./Icon";

export interface MenuItem {
  label: string;
  icon?: IconName;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface MenuButtonProps {
  /** Accessible name of the trigger, e.g. "More actions for NSM-1501". */
  label: string;
  items: MenuItem[];
  buttonLabel?: string;
  /** Compact "⋮" trigger for tight action cells. */
  iconOnly?: boolean;
}

/**
 * Overflow menu for row actions. The panel is positioned with fixed coordinates so it is never
 * clipped by the table's scroll viewport; it closes on outside press, Escape, scroll and resize.
 */
export default function MenuButton({ label, items, buttonLabel = "More", iconOnly }: MenuButtonProps) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  const close = useCallback((restoreFocus: boolean) => {
    setPos(null);
    if (restoreFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const dismiss = () => close(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open, close]);

  const toggle = () => {
    if (open) return close(false);
    const r = trigger.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };

  const onPanelKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const enabled = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "ArrowDown" ? (i + 1) % enabled.length : (i - 1 + enabled.length) % enabled.length;
    enabled[next]?.focus();
  };

  return (
    <>
      <button ref={trigger} type="button" className={`ds-btn ds-btn-sm ${iconOnly ? "ds-btn-ghost ds-btn-icon" : "ds-btn-secondary"}`} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={iconOnly ? buttonLabel : undefined} onClick={toggle}>
        {iconOnly ? <Icon name="ellipsis-vertical" size={15} /> : <>{buttonLabel}<Icon name="chevron-down" size={13} /></>}
      </button>
      {open && (
        <div ref={panel} role="menu" aria-label={label} className="ds-menu" style={{ top: pos.top, right: pos.right }} onKeyDown={onPanelKey}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              className="ds-menu-item"
              data-danger={it.danger || undefined}
              onClick={() => {
                close(false);
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={14} />}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
