// The suggestions themselves: shortcuts, saved and recent places, popular cities and the
// State › District › City › Area tree. Used by the full-screen search page and the desktop dropdown.
import { Fragment, type ReactNode } from 'react';
import { directory, KIND_LABEL, norm, type TreeRow } from './model';
import { PlaceIcon } from './PlaceIcon';
import type { Suggestions } from './usePlaceSuggestions';

export interface Shortcut {
  id: 'current' | 'map';
  title: string;
  subtitle: string;
  busy?: boolean;
  onClick: () => void;
}

/** Bolds the part of a name that matches what is typed. */
function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  const at = q.length >= 2 ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/** "6 towns" / "9 areas" under a branch. */
function countLabel(row: TreeRow): string {
  const n = row.node.children?.length ?? 0;
  if (!n) return '';
  const word = row.node.kind === 'state' ? (row.node.children?.some((c) => c.kind === 'district') ? 'district' : 'place') : row.node.kind === 'district' ? 'place' : 'area';
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function SuggestionList({
  model,
  query,
  active,
  idPrefix,
  shortcuts,
  selectedId,
  onActive,
  onPick,
  notices,
}: {
  model: Suggestions;
  query: string;
  /** Index into `model.rows` highlighted by the arrow keys; -1 for none. */
  active: number;
  idPrefix: string;
  shortcuts: Shortcut[];
  selectedId?: string;
  onActive?: (i: number) => void;
  onPick: (row: TreeRow) => void;
  notices?: ReactNode;
}) {
  let index = -1;
  const q = query.trim();

  const press = (row: TreeRow) => (row.node.place ? onPick(row) : model.toggle(row));

  const renderRow = (row: TreeRow, tree: boolean) => {
    index += 1;
    const i = index;
    const { node } = row;
    const branch = !node.place;
    const count = countLabel(row);
    // A town already carries its district and state in the tree, so its second line says what kind of place it is.
    const sub = branch ? count : node.subtitle ?? (tree ? KIND_LABEL[node.kind] : '');
    const alias = q.length >= 2 && node.aka?.length && !norm(node.title).includes(norm(q)) ? node.aka.find((a) => norm(a).startsWith(norm(q))) : undefined;
    return (
      <div
        key={node.id}
        className={`ps-row ${branch ? 'ps-row--branch' : ''} ${row.depth ? 'ps-row--child' : ''} ${i === active ? 'is-active' : ''} ${node.place && selectedId === node.place.id ? 'is-selected' : ''}`}
        data-kind={node.kind}
        data-i={i}
        onMouseEnter={() => onActive?.(i)}
      >
        {row.depth > 0 ? (
          <span className="ps-guides" aria-hidden="true">
            {row.guides.map((on, g) => (
              <i key={g} className={on ? 'ps-guide ps-guide--line' : 'ps-guide'} />
            ))}
            <i className={`ps-guide ps-guide--elbow ${row.last ? 'is-last' : ''}`} />
          </span>
        ) : null}
        <div
          id={`${idPrefix}-${i}`}
          role="option"
          aria-selected={i === active}
          aria-expanded={branch ? row.open : undefined}
          tabIndex={-1}
          className="ps-row__main"
          onClick={() => press(row)}
        >
          <span className="ps-ico">
            <PlaceIcon kind={node.kind} />
          </span>
          <span className="ps-row__text">
            <strong>
              <Marked text={node.title} query={q} />
              {alias ? <em> ({alias})</em> : null}
            </strong>
            {sub ? <small>{sub}</small> : null}
          </span>
          {node.kind === 'state' || node.kind === 'district' || node.kind === 'main' ? <span className="ps-tag">{KIND_LABEL[node.kind]}</span> : null}
          {branch && row.expandable ? (
            <span className={`ps-chev ${row.open ? 'is-open' : ''}`}>
              <PlaceIcon kind="chevron" size={16} />
            </span>
          ) : null}
        </div>
        {!branch && row.expandable ? (
          <button
            type="button"
            tabIndex={-1}
            className={`ps-more ${row.open ? 'is-open' : ''}`}
            aria-expanded={row.open}
            aria-label={`${row.open ? 'Hide' : 'Show'} places in ${node.title}`}
            title={`${row.open ? 'Hide' : 'Show'} places in ${node.title}`}
            onClick={() => model.toggle(row)}
          >
            <span>{node.children!.length}</span>
            <PlaceIcon kind="chevron" size={14} />
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <>
      {notices}
      {shortcuts.length ? (
        <div className="ps-shortcuts">
          {shortcuts.map((s) => (
            <button key={s.id} type="button" className="ps-shortcut" data-kind={s.id} onClick={s.onClick} disabled={s.busy}>
              <span className="ps-ico">{s.busy ? <span className="spinner" aria-hidden="true" /> : <PlaceIcon kind={s.id} />}</span>
              <span className="ps-row__text">
                <strong>{s.title}</strong>
                <small>{s.subtitle}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {model.sections.map((s) => (
        <Fragment key={s.id}>
          <p className="ps-head" role="presentation">
            {s.title}
          </p>
          {s.id === 'browse' ? (
            <div className="ps-tabs" role="group" aria-label="State">
              {directory().map((st) => (
                <button key={st.id} type="button" className={`ps-tab ${st.id === model.stateTab ? 'is-on' : ''}`} aria-pressed={st.id === model.stateTab} onClick={() => model.setStateTab(st.id)}>
                  {st.title}
                </button>
              ))}
            </div>
          ) : null}
          {s.layout === 'chips' ? (
            <div className="ps-chips">
              {s.rows.map((row) => {
                index += 1;
                const i = index;
                return (
                  <button
                    key={row.node.id}
                    id={`${idPrefix}-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    tabIndex={-1}
                    className={`ps-chip ${i === active ? 'is-active' : ''}`}
                    data-kind={row.node.kind}
                    data-i={i}
                    title={row.node.subtitle}
                    onMouseEnter={() => onActive?.(i)}
                    onClick={() => onPick(row)}
                  >
                    <PlaceIcon kind={row.node.kind} size={16} />
                    <span>{row.node.title}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={`ps-list ${s.layout === 'tree' ? 'ps-list--tree' : ''}`}>{s.rows.map((row) => renderRow(row, s.layout === 'tree'))}</div>
          )}
        </Fragment>
      ))}

      {model.searching ? (
        <div className="ps-loading" role="status">
          <span className="sr-only">Searching…</span>
          <i />
          <i />
          <i />
        </div>
      ) : model.status ? (
        <div className="ps-empty" role="status">
          <PlaceIcon kind="search" size={22} />
          <p>{model.status}</p>
          {model.failed ? (
            <button type="button" className="ps-tab is-on" onClick={model.retry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
