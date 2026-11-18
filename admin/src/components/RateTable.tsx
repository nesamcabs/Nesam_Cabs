import { Fragment, type ReactNode } from "react";
import { Button, Icon } from "./ui";

// One look for every fare setting on Service & Fare Settings: a card with a title, a table with the rates down the side and the
// vehicles across the top, and a footer with the reason and Save. Styles: the "fm-" rules in index.css.

export type Tone = "ok" | "warn" | "off";
export interface RateColumn { key: string; name: string; status?: { tone: Tone; text: string; title?: string } }
export interface RateCell {
  value?: string;
  onChange?: (value: string) => void;
  /** Grey text shown in an empty box (the shared / inherited value). */
  placeholder?: string;
  /** A value typed for this scope (shown dark and bold). */
  own?: boolean;
  bad?: boolean;
  title?: string;
  /** A small amber dot, with this text as its tooltip. */
  dot?: string;
  /** Read-only text instead of a box. */
  display?: ReactNode;
  /** An on / off switch instead of a number box. */
  checked?: boolean;
  onToggle?: (on: boolean) => void;
  step?: string;
}
export interface RateRow { key: string; label: string; unit?: string; required?: boolean; cell: (column: string) => RateCell }
export interface RateGroup { title: string; rows: RateRow[] }

export function RateTable({ label, columns, groups, disabled, corner = "" }: { label: string; columns: RateColumn[]; groups: RateGroup[]; disabled?: boolean; corner?: string }) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <div className="fm-scroll">
        <table className="fm-table" aria-label={label}>
          <thead>
            <tr>
              <th className="fm-corner" scope="col">{corner}</th>
              {columns.map((c) => (
                <th key={c.key} scope="col" className="fm-vehicle">
                  <span className="fm-vehicle__name">{c.name}</span>
                  {/* Only a problem is flagged here; a vehicle that is fine shows just its name. */}
                  {c.status && c.status.tone !== "ok" ? <span className={`fm-chip fm-chip--${c.status.tone}`} title={c.status.title}>{c.status.text}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.filter((g) => g.rows.length).map((g) => (
              <Fragment key={g.title}>
                {g.title ? <tr className="fm-group"><th colSpan={columns.length + 1} scope="colgroup">{g.title}</th></tr> : null}
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="fm-field">
                      <span className="fm-field__row">
                        <span className="fm-field__label">{r.label}{r.required ? <b className="fm-req" title="Required">*</b> : null}</span>
                        {r.unit ? <span className="fm-field__unit">{r.unit}</span> : null}
                      </span>
                    </th>
                    {columns.map((c) => {
                      const cell = r.cell(c.key);
                      return (
                        <td key={c.key}>
                          {cell.display !== undefined ? <span className="fm-readonly" title={cell.title}>{cell.display}</span>
                            : cell.onToggle ? (
                              <label className="fm-switch" title={cell.title}>
                                <input type="checkbox" checked={!!cell.checked} onChange={(e) => cell.onToggle?.(e.target.checked)} aria-label={`${r.label} for ${c.name}`} />
                                <span aria-hidden="true" />
                              </label>
                            ) : (
                              <input type="number" min={0} step={cell.step ?? "any"} inputMode="decimal"
                                className={`fm-input ${cell.own ? "is-own" : ""} ${cell.bad ? "is-bad" : ""}`}
                                aria-label={`${r.label} for ${c.name}`} title={cell.title || undefined}
                                placeholder={cell.placeholder ?? "—"} value={cell.value ?? ""}
                                onChange={(e) => cell.onChange?.(e.target.value)} />
                            )}
                          {cell.dot ? <span className="fm-dot" title={cell.dot} aria-hidden="true" /> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </fieldset>
  );
}

/** The card every setting sits in: title and one line of help, an optional control on the right, the content, then the footer. */
export function SettingCard({ title, description, aside, children, footer, id, label }: {
  title: ReactNode; description?: ReactNode; aside?: ReactNode; children?: ReactNode; footer?: ReactNode; id?: string; label?: string;
}) {
  return (
    <section className="fm-card" id={id} aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <div className="fm-head">
        <div className="min-w-0" style={{ flex: "1 1 260px" }}>
          <div className="fm-title">{title}</div>
          {description ? <p className="fm-sub">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
      {footer}
    </section>
  );
}

/** Padding for content that is not a table (fields, notes). */
export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`fm-body ${className}`}>{children}</div>;
}

/** "Switch on for customers" as a small toggle. */
export function OnSwitch({ checked, onChange, disabled, label = "On for customers" }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <label className={`fm-onswitch ${checked ? "is-on" : ""}`}>
      <span className="fm-switch">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden="true" />
      </span>
      {label}
    </label>
  );
}

/** Footer: legend or note on the left, reason and Save on the right, the result underneath. */
export function SaveBar({ reason, onReason, onSave, busy, disabled, message, saveLabel = "Save changes", note }: {
  reason?: string; onReason?: (v: string) => void; onSave: () => void; busy?: boolean; disabled?: boolean;
  message?: { ok: boolean; text: string } | null; saveLabel?: string; note?: ReactNode;
}) {
  return (
    <div className="fm-foot">
      <div className="fm-foot__row">
        <div className="fm-foot__note">{note}</div>
        <div className="fm-foot__actions">
          {onReason ? <input className="ds-input fm-reason" placeholder="Reason for change" aria-label="Reason for change" value={reason ?? ""} maxLength={300} onChange={(e) => onReason(e.target.value)} /> : null}
          <Button variant="primary" icon="check" onClick={onSave} loading={busy} disabled={disabled}>{saveLabel}</Button>
        </div>
      </div>
      {message ? <p className={message.ok ? "fm-msg fm-msg--ok" : "fm-msg fm-msg--bad"} role="status"><Icon name={message.ok ? "circle-check" : "circle-alert"} size={13} /> {message.text}</p> : null}
    </div>
  );
}

/** Problems listed under a table. */
export function Problems({ items }: { items: string[] }) {
  if (!items.length) return null;
  return <ul className="fm-problems" role="status">{items.map((p) => <li key={p}><Icon name="circle-alert" size={13} /> {p}</li>)}</ul>;
}

/** The legend for tables whose empty boxes inherit a shared value. */
export function SharedLegend() {
  return (
    <span className="fm-legend-inline" aria-hidden="true">
      <span><b className="fm-key fm-key--own">14</b> Own price</span>
      <span><b className="fm-key">14</b> Shared price</span>
      <span><b className="fm-req">*</b> Required</span>
    </span>
  );
}
