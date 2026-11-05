import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, type LinkProps, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const btnClass = (variant: Variant, size: Size, block?: boolean, extra?: string) =>
  ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', extra].filter(Boolean).join(' ');

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: string;
  iconTrailing?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, iconTrailing, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={btnClass(variant, size, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children}
      {!loading && iconTrailing ? <Icon name={iconTrailing} /> : null}
    </button>
  );
});

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  iconTrailing,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; block?: boolean; icon?: string; iconTrailing?: string }) {
  return (
    <Link className={btnClass(variant, size, block, className)} {...rest}>
      {icon ? <Icon name={icon} /> : null}
      {children}
      {iconTrailing ? <Icon name={iconTrailing} /> : null}
    </Link>
  );
}

export function IconButton({
  icon,
  label,
  outline,
  className = '',
  ...rest
}: { icon: string; label: string; outline?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={`icon-btn ${outline ? 'icon-btn--outline' : ''} ${className}`} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function BackButton({ to, onClick, label = 'Back' }: { to?: string; onClick?: () => void; label?: string }) {
  const navigate = useNavigate();
  const handle = () => {
    if (onClick) onClick();
    else if (to) navigate(to);
    else navigate(-1);
  };
  return (
    <button type="button" className="back-btn" onClick={handle} aria-label={label} title={label}>
      <Icon name="arrow-left" size={18} />
    </button>
  );
}

// ── Text input, textarea, select & FieldShell ──────────────────────────────

export function FieldShell({
  label,
  hint,
  error,
  children,
  className = '',
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${error ? 'is-invalid' : ''} ${className}`}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={`${id}-err`} className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface FieldBaseProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  required?: boolean;
  block?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldBaseProps>(function TextField(
  { label, hint, error, optional, required, block, id: explicitId, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const id = explicitId || autoId;
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={`field ${error ? 'is-invalid' : ''} ${block ? 'field--block' : ''} ${className}`}>
      {label ? (
        <label htmlFor={id} className="field__label">
          {label}
          {optional ? <span className="field__opt">Optional</span> : null}
        </label>
      ) : null}
      <input ref={ref} id={id} className="input" aria-invalid={!!error || undefined} aria-describedby={descId} required={required} {...rest} />
      {error ? (
        <p id={descId} className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldBaseProps>(function TextArea(
  { label, hint, error, optional, required, block, id: explicitId, className = '', rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const id = explicitId || autoId;
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={`field ${error ? 'is-invalid' : ''} ${block ? 'field--block' : ''} ${className}`}>
      {label ? (
        <label htmlFor={id} className="field__label">
          {label}
          {optional ? <span className="field__opt">Optional</span> : null}
        </label>
      ) : null}
      <textarea ref={ref} id={id} rows={rows} className="textarea" aria-invalid={!!error || undefined} aria-describedby={descId} required={required} {...rest} />
      {error ? (
        <p id={descId} className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldBaseProps>(function Select(
  { label, hint, error, optional, required, block, id: explicitId, className = '', children, ...rest },
  ref,
) {
  const autoId = useId();
  const id = explicitId || autoId;
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className={`field ${error ? 'is-invalid' : ''} ${block ? 'field--block' : ''} ${className}`}>
      {label ? (
        <label htmlFor={id} className="field__label">
          {label}
          {optional ? <span className="field__opt">Optional</span> : null}
        </label>
      ) : null}
      <div className="select-wrap">
        <select ref={ref} id={id} className="select" aria-invalid={!!error || undefined} aria-describedby={descId} required={required} {...rest}>
          {children}
        </select>
        <span className="select-arrow" aria-hidden="true">
          <Icon name="chevron-down" size={16} />
        </span>
      </div>
      {error ? (
        <p id={descId} className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={descId} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

// ── Checkbox & Radio ──────────────────────────────────────────────────────

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  onChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, description, children, className = '', id: explicitId, onChange, ...rest }, ref) {
    const autoId = useId();
    const id = explicitId || autoId;
    const body = children || (
      label || description ? (
        <span className="check__label">
          {label ? <strong>{label}</strong> : null}
          {description ? <small>{description}</small> : null}
        </span>
      ) : null
    );
    return (
      <label htmlFor={id} className={`check ${className}`}>
        <input
          ref={ref}
          id={id}
          type="checkbox"
          className="check__input"
          onChange={(e) => onChange?.(e.target.checked)}
          {...rest}
        />
        {body}
      </label>
    );
  },
);

export const Radio = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; description?: ReactNode }>(
  function Radio({ label, description, className = '', id: explicitId, ...rest }, ref) {
    const autoId = useId();
    const id = explicitId || autoId;
    return (
      <label htmlFor={id} className={`radio ${className}`}>
        <input ref={ref} id={id} type="radio" className="radio__input" {...rest} />
        <span className="radio__circle" aria-hidden="true" />
        {label || description ? (
          <span className="radio__label">
            {label ? <strong>{label}</strong> : null}
            {description ? <small>{description}</small> : null}
          </span>
        ) : null}
      </label>
    );
  },
);

// ── Segmented Control ─────────────────────────────────────────────────────

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className = '',
}: {
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          className={`segmented__btn ${opt.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.icon ? <Icon name={opt.icon} /> : null}
          <span>{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Cards & list rows ─────────────────────────────────────────────────────

export function Card({
  className = '',
  children,
  padding = 'md',
}: {
  className?: string;
  children: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}) {
  return <div className={`card ${padding !== 'md' ? `card--p-${padding}` : ''} ${className}`}>{children}</div>;
}

export function ListRow({
  icon,
  title,
  sub,
  right,
  onClick,
  to,
  className = '',
}: {
  icon?: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  to?: string;
  className?: string;
}) {
  const content = (
    <>
      {icon ? (
        <span className="list-row__icon">
          <Icon name={icon} size={20} />
        </span>
      ) : null}
      <div className="list-row__body">
        <strong>{title}</strong>
        {sub ? <small>{sub}</small> : null}
      </div>
      {right ? <div className="list-row__right">{right}</div> : <Icon name="chevron-right" size={16} className="list-row__chev" />}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`list-row list-row--interactive ${className}`}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`list-row list-row--interactive ${className}`}>
        {content}
      </button>
    );
  }
  return <div className={`list-row ${className}`}>{content}</div>;
}

// ── Badges, notices, chips ────────────────────────────────────────────────

export function Badge({
  variant,
  tone = 'neutral',
  dot,
  children,
}: {
  variant?: 'neutral' | 'brand' | 'green' | 'amber' | 'blue' | 'red' | 'sun';
  tone?: 'neutral' | 'brand' | 'green' | 'amber' | 'blue' | 'red' | 'sun' | string;
  dot?: boolean;
  children: ReactNode;
}) {
  const v = variant || tone || 'neutral';
  return (
    <span className={`badge badge--${v} ${dot ? 'badge--dot' : ''}`}>
      {children}
    </span>
  );
}

export function Notice({
  variant,
  tone = 'info',
  icon,
  action,
  children,
  className = '',
}: {
  variant?: 'info' | 'warning' | 'error' | 'success';
  tone?: 'info' | 'warning' | 'error' | 'success' | string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const v = variant || (tone as 'info' | 'warning' | 'error' | 'success') || 'info';
  const defaultIcon = v === 'error' ? 'circle-xmark' : v === 'warning' ? 'warning' : v === 'success' ? 'check' : 'info';
  return (
    <aside className={`notice notice--${v} ${className}`} role={v === 'error' ? 'alert' : 'status'}>
      <Icon name={icon || defaultIcon} size={18} />
      <div className="notice__body">
        <div>{children}</div>
        {action ? <div className="notice__action">{action}</div> : null}
      </div>
    </aside>
  );
}

export function Chip({
  active,
  onClick,
  children,
  icon,
  className = '',
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`chip ${active ? 'is-active' : ''} ${className}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

// ── Flow Steps ────────────────────────────────────────────────────────────

export function FlowSteps({ total = 3, current = 1 }: { total?: number; current: number }) {
  return (
    <div className="flow-steps" role="progressbar" aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < current ? 'is-on' : ''} />
      ))}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: string;
}

export function Tabs({
  items,
  active,
  onChange,
  variant = 'line',
  className = '',
}: {
  items: readonly TabItem[] | TabItem[];
  active: string;
  onChange: (id: string) => void;
  variant?: 'line' | 'boxed';
  className?: string;
}) {
  return (
    <div className={`tabs tabs--${variant} ${className}`} role="tablist">
      {items.map((t) => {
        const is = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={is}
            className={`tab ${is ? 'is-active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            {t.icon ? <Icon name={t.icon} size={16} /> : null}
            <span>{t.label}</span>
            {typeof t.count === 'number' ? <span className="tab__count">{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Avatar, Empty State, PageLoader ───────────────────────────────────────

export function Avatar({
  name,
  photoUrl,
  size = 40,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className="avatar" style={{ width: size, height: size }} />;
  }
  const initials = (name || '?')
    .split(' ')
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </span>
  );
}

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="page-loader" role="status">
      <div className="page-loader__inner">
        <Spinner />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function EmptyState({
  art,
  title,
  action,
  children,
}: {
  art?: string;
  title: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={art === 'error' ? 'circle-xmark' : 'route'} size={28} />
      </div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
  );
}

// ── Dialog (Modal / Bottom Sheet / Full page) ─────────────────────────────

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  dismissible = true,
  wide = false,
  variant = 'dialog',
  className = '',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  wide?: boolean;
  variant?: 'dialog' | 'sheet' | 'page';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Rendered into the page body so no parent card (containment, transforms) can displace the popup.
  return createPortal(
    <div
      className={`overlay overlay--${variant}`}
      onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}
      onKeyDown={onKey}
    >
      <div
        className={`dialog dialog--${variant} ${wide ? 'dialog--wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
      >
        <div className="dialog__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="dialog__sub">{subtitle}</p> : null}
          </div>
          {dismissible ? <IconButton icon="close" label="Close" onClick={onClose} /> : null}
        </div>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ── Page Head ─────────────────────────────────────────────────────────────

export function PageHead({
  eyebrow,
  title,
  children,
  actions,
  back,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <header className="page-head">
      {back}
      <div className="page-head__text">
        {eyebrow && /^Step \d/.test(eyebrow) ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {/* Plain-text subtitles are left out for a cleaner page; links and buttons passed in still show. */}
        {children && typeof children !== 'string' ? <div className="page-head__sub">{children}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}
