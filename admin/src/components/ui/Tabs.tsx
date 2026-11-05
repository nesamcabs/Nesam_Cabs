import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  count?: number;
  disabled?: boolean;
}

interface TabsProps<T extends string> {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}

/** Underline tabs with arrow/Home/End keyboard navigation (roving tabindex). */
export default function Tabs<T extends string>({ tabs, value, onChange, label, className = "" }: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.map((t, i) => (t.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    const current = enabled.indexOf(tabs.findIndex((t) => t.id === value));
    let next = -1;
    if (e.key === "ArrowRight") next = enabled[(current + 1) % enabled.length];
    else if (e.key === "ArrowLeft") next = enabled[(current - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className={`ds-tabs ${className}`} onKeyDown={onKeyDown}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          disabled={t.disabled}
          className="ds-tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {typeof t.count === "number" && <span className="ds-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
