import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Icon from "./Icon";

interface DataTableProps {
  /** Accessible name for the scroll region and table. */
  label: string;
  /** Minimum table width in px; below this the single viewport scrolls horizontally. */
  minWidth?: number;
  /** Fixed layout: column widths come from <colgroup>/<col>, so they are deterministic. */
  fixed?: boolean;
  /** Let the table grow with its content instead of capping the viewport height. */
  fitContent?: boolean;
  /** Hide the scroll helper bar (use for short tables that never overflow). */
  hideTools?: boolean;
  /** Column holding the row actions; enables the "Show actions" jump when it is off-screen. */
  hasActions?: boolean;
  children: ReactNode;
}

/**
 * The one table shell for the admin: exactly one scroll viewport, sticky header inside it, actions
 * column in normal table flow, and prev/next/"Show actions" controls when columns overflow.
 */
export default function DataTable({ label, minWidth = 840, fixed, fitContent, hideTools, hasActions, children }: DataTableProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState({ overflow: false, atStart: true, atEnd: true });

  const measure = useCallback(() => {
    const el = host.current;
    if (!el) return;
    const overflow = el.scrollWidth - el.clientWidth > 1;
    setState({ overflow, atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const table = el.querySelector("table");
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [measure, children]);

  const scrollBy = (dir: -1 | 1) => {
    const el = host.current;
    if (el) el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.7), behavior: "smooth" });
  };
  const scrollEnd = () => {
    const el = host.current;
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  };

  const showTools = !hideTools && state.overflow;

  return (
    <div>
      <div className="ds-table-tools" hidden={!showTools}>
        <span>
          <Icon name="move-horizontal" />
          Scroll to see all columns
        </span>
        <div>
          <button type="button" aria-label="Scroll columns left" disabled={state.atStart} onClick={() => scrollBy(-1)}>
            <Icon name="chevron-left" />
          </button>
          <button type="button" aria-label="Scroll columns right" disabled={state.atEnd} onClick={() => scrollBy(1)}>
            <Icon name="chevron-right" />
          </button>
          {hasActions && (
            <button type="button" data-scroll="end" disabled={state.atEnd} onClick={scrollEnd}>
              Show actions
              <Icon name="arrow-right" />
            </button>
          )}
        </div>
      </div>
      <div
        ref={host}
        className="ds-table-host"
        data-fit={fitContent ? "content" : undefined}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={measure}
      >
        <table className="ds-table" data-layout={fixed ? "fixed" : undefined} style={{ "--ds-table-min": `${minWidth}px` } as CSSProperties}>
          {children}
        </table>
      </div>
    </div>
  );
}
