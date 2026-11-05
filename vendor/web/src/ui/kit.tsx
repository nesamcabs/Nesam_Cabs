import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { initials, placeDetail, placeName } from './format';

export const Brand: React.FC<{ label?: string; onClick?: () => void }> = ({ label = 'PARTNER', onClick }) => (
  <div className="v-brand vx-brand" role="img" aria-label="NESAM Partner" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
    <span className="v-brand-logo vx-brand__mark"><img src="/brand/nesam-emblem.jpg" alt="" width={512} height={497} decoding="async" /></span>
    <div className="v-wordmark vx-brand__text">
      <div className="vx-brand__name">NESAM</div>
      <small className="vx-brand__label">{label}</small>
    </div>
  </div>
);

export type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue';
export const Badge: React.FC<{ tone?: Tone; icon?: IconName; children: React.ReactNode }> = ({ tone = 'gray', icon, children }) => (
  <span className={`vx-badge${tone === 'gray' ? '' : ` vx-badge--${tone}`}`}>{icon && <Icon name={icon} />}{children}</span>
);

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'dark' | 'danger' | 'ghost';
  size?: 'md' | 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
}
export const Button: React.FC<BtnProps> = ({ variant = 'secondary', size = 'md', block, loading, icon, disabled, className = '', children, type = 'button', ...rest }) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={['vx-btn', variant !== 'secondary' && `vx-btn--${variant}`, size === 'sm' && 'vx-btn--sm', block && 'vx-btn--block', className].filter(Boolean).join(' ')}
    {...rest}
  >
    {loading ? <i className="vx-spin" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
    {children}
  </button>
);

export const Banner: React.FC<{ tone?: 'info' | 'ok' | 'warn' | 'err'; children: React.ReactNode; action?: { label: string; onClick: () => void } }> = ({ tone = 'info', children, action }) => (
  <div className={`vx-banner${tone === 'info' ? '' : ` vx-banner--${tone}`}`} role={tone === 'err' ? 'alert' : 'status'}>
    <Icon name={tone === 'ok' ? 'check' : tone === 'info' ? 'info' : 'alert'} />
    <div>{children}</div>
    {action && <button type="button" onClick={action.onClick}>{action.label}</button>}
  </div>
);

export const Empty: React.FC<{ icon: IconName; title: string; children?: React.ReactNode; action?: React.ReactNode }> = ({ icon, title, children, action }) => (
  <div className="vx-empty">
    <Icon name={icon} />
    <strong>{title}</strong>
    {children && <p>{children}</p>}
    {action && <div className="vx-actions" style={{ justifyContent: 'center' }}>{action}</div>}
  </div>
);

export const Loader: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="vx-loader" role="status"><i aria-hidden="true" />{label}</div>
);

export const Avatar: React.FC<{ name: string; photoUrl?: string; large?: boolean; grey?: boolean; icon?: IconName }> = ({ name, photoUrl, large, grey, icon }) => (
  <span className={`vx-avatar${large ? ' vx-avatar--lg' : ''}${grey ? ' vx-avatar--grey' : ''}`} aria-hidden="true">
    {photoUrl ? <img src={photoUrl} alt="" /> : icon ? <Icon name={icon} /> : initials(name)}
  </span>
);

export const KV: React.FC<{ label: string; children: React.ReactNode; total?: boolean }> = ({ label, children, total }) => (
  <div className={`vx-kv${total ? ' vx-kv--total' : ''}`}><span>{label}</span><strong>{children}</strong></div>
);

export const Stat: React.FC<{ value: React.ReactNode; label: string; tone?: 'accent' | 'good' }> = ({ value, label, tone }) => (
  <div className={`vx-stat${tone ? ` vx-stat--${tone}` : ''}`}><div className="vx-stat__value">{value}</div><div className="vx-stat__label">{label}</div></div>
);

export const RouteStack: React.FC<{ pickup: string; drop: string }> = ({ pickup, drop }) => (
  <div className="vx-route">
    <div className="vx-route__stop"><strong>{placeName(pickup)}</strong>{placeDetail(pickup) && <small>{placeDetail(pickup)}</small>}</div>
    <div className="vx-route__stop"><strong>{placeName(drop)}</strong>{placeDetail(drop) && <small>{placeDetail(drop)}</small>}</div>
  </div>
);

export interface TabDef<T extends string> { id: T; label: string; count?: number; hot?: boolean }
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="vx-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="vx-tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className={`vx-tab__n${t.hot ? ' vx-tab__n--hot' : ''}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A labelled field wrapper. `children` is the control itself. */
export const Field: React.FC<{ label: string; htmlFor: string; required?: boolean; hint?: string; error?: string; children: React.ReactNode }> = ({ label, htmlFor, required, hint, error, children }) => (
  <div className="vx-field">
    <label className="vx-field__label" htmlFor={htmlFor}>{label}{required && <b> *</b>}</label>
    {children}
    {error ? <p className="vx-err" id={`${htmlFor}-err`} role="alert">{error}</p> : hint ? <p className="vx-hint">{hint}</p> : null}
  </div>
);

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; error?: string; hint?: string; plate?: boolean };
export const TextInput: React.FC<InputProps> = ({ id, label, error, hint, plate, required, className = '', ...rest }) => (
  <Field label={label} htmlFor={id} required={required} error={error} hint={hint}>
    <input id={id} className={`vx-input${plate ? ' vx-input--plate' : ''} ${className}`.trim()} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
  </Field>
);

export const PhoneInput: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; autoFocus?: boolean; onEnter?: () => void; disabled?: boolean }> = ({ id, label, value, onChange, error, hint, autoFocus, onEnter, disabled }) => (
  <Field label={label} htmlFor={id} error={error} hint={hint}>
    <div className="vx-phone">
      <span>+91</span>
      <input id={id} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} placeholder="90000 00000" value={value} autoFocus={autoFocus} disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && onEnter?.()} aria-invalid={!!error} />
    </div>
  </Field>
);

export const SelectInput: React.FC<{ id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string; error?: string; hint?: string; required?: boolean }> = ({ id, label, value, onChange, options, placeholder, error, hint, required }) => (
  <Field label={label} htmlFor={id} error={error} hint={hint} required={required}>
    <select id={id} className="vx-select" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </Field>
);

interface DialogProps { open: boolean; onClose: () => void; eyebrow: string; title: string; children: React.ReactNode; footer?: React.ReactNode; locked?: boolean }
/** A native <dialog>: closed by Escape, the ✕ button or the backdrop; focus returns to whatever opened it. */
export const Dialog: React.FC<DialogProps> = ({ open, onClose, eyebrow, title, children, footer, locked = false }) => {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);
  const handleClose = () => {
    if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
    onClose();
  };
  return (
    <dialog ref={ref} className="vx-dialog" aria-label={title} onClose={handleClose} onCancel={(e) => { if (locked) e.preventDefault(); }}
      onClick={(e) => {
        if (locked || e.target !== ref.current) return;
        const r = ref.current!.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) ref.current!.close();
      }}>
      {open && (
        <div className="vx-dialog__layout">
          <div className="vx-dialog__head">
            <div><div className="vx-dialog__eyebrow">{eyebrow}</div><h2>{title}</h2></div>
            <button type="button" className="vx-iconbtn" onClick={() => !locked && ref.current?.close()} aria-label="Close" disabled={locked}><Icon name="close" /></button>
          </div>
          <div className="vx-dialog__body">{children}</div>
          {footer ? <div className="vx-dialog__foot">{footer}</div> : null}
        </div>
      )}
    </dialog>
  );
};

export interface ToastState { kind: 'ok' | 'err'; text: string }
export function useToast(ms = 5000) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, kind: ToastState['kind'] = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ kind, text });
    timer.current = setTimeout(() => setToast(null), ms);
  }, [ms]);
  const dismiss = useCallback(() => setToast(null), []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { toast, show, dismiss };
}

export const Toast: React.FC<{ toast: ToastState | null; onDismiss: () => void }> = ({ toast, onDismiss }) =>
  toast ? (
    <div className={`vx-toast${toast.kind === 'err' ? ' vx-toast--err' : ''}`} role={toast.kind === 'err' ? 'alert' : 'status'}>
      <Icon name={toast.kind === 'err' ? 'alert' : 'check'} /><span>{toast.text}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss"><Icon name="close" /></button>
    </div>
  ) : null;
