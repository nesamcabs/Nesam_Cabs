import { useEffect, useMemo, useState, type ReactNode } from "react";
import Button from "./Button";
import Tabs, { type TabItem } from "./Tabs";

/** Stage tabs with an optional action on the right (reference "or-stage-bar"). */
export function StageBar<T extends string>({ tabs, value, onChange, label, aside }: {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  aside?: ReactNode;
}) {
  return (
    <div className="ds-stage-bar">
      <Tabs tabs={tabs} value={value} onChange={onChange} label={label} className="ds-stage-tabs" />
      {aside && <div className="ds-stage-aside">{aside}</div>}
    </div>
  );
}

/** "N matching records" on the left, an optional Sort select on the right. */
export function ListCaption<S extends string>({ count, loading, sort, sortOptions, onSort, children, noun = "matching records" }: {
  count: number;
  /** Text after the count ("matching records", "trips", "accounts …"). */
  noun?: string;
  loading?: boolean;
  sort?: S;
  sortOptions?: ReadonlyArray<readonly [S, string]>;
  onSort?: (s: S) => void;
  children?: ReactNode;
}) {
  return (
    <div className="ds-toolbar-count">
      <strong role="status">{loading ? "Loading records…" : `${count} ${noun}`}</strong>
      <div className="flex items-center gap-3">
        {children}
        {sortOptions && onSort && (
          <label className="flex items-center gap-2">
            Sort
            <select value={sort} onChange={(e) => onSort(e.target.value as S)} aria-label="Sort records" className="ds-select" style={{ minHeight: 30 }}>
              {sortOptions.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

/** Client-side paging with the reference page sizes (10 / 20 / 50). Resets to page 1 when `resetKey` changes. */
export function usePaging<T>(rows: T[], resetKey: unknown, initialSize = 10) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const key = JSON.stringify(resetKey);
  useEffect(() => setPage(1), [key, size]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const slice = useMemo(() => rows.slice((current - 1) * size, current * size), [rows, current, size]);
  return { slice, page: current, pages, size, setSize, setPage, total: rows.length };
}

/** "Showing 1–10 of 23 · 23 total in this tab" + Rows · Previous · 1 / 3 · Next. */
export function Pager({ paging, tabTotal, noun = "in this tab" }: {
  paging: ReturnType<typeof usePaging<unknown>>;
  /** Records in the tab before filters; defaults to the filtered count. */
  tabTotal?: number;
  noun?: string;
}) {
  const { page, pages, size, setSize, setPage, total } = paging;
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <div className="ds-table-foot">
      <span>
        Showing <b>{from}–{to}</b> of <b>{total}</b> · {tabTotal ?? total} total {noun}
      </span>
      <div className="ds-pager">
        <label className="flex items-center gap-2">
          Rows
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Rows per page" className="ds-select" style={{ minHeight: 30 }}>
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        <Button size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>Previous</Button>
        <strong>{page} / {pages}</strong>
        <Button size="sm" onClick={() => setPage(page + 1)} disabled={page >= pages}>Next</Button>
      </div>
    </div>
  );
}

/** White card section with a heading row (reference dashboard / page sections). */
export function Section({ title, subtitle, actions, children, className = "", flush }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Let a table run edge to edge under the heading. */
  flush?: boolean;
}) {
  return (
    <section className={`ds-panel ds-section ${className}`} data-flush={flush ? "true" : undefined}>
      {(title || actions) && (
        <div className="ds-section-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="ds-section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Label / value pairs (reference detail grids). */
export function FactGrid({ items, cols = 2 }: { items: ReadonlyArray<readonly [ReactNode, ReactNode]>; cols?: 1 | 2 | 3 | 4 }) {
  return (
    <dl className="ds-facts" data-cols={cols}>
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v === "" || v === null || v === undefined ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}
