import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, type LinkProps } from 'react-router-dom';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'dark' | 'ghost' | 'danger' | 'text';
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
  /** Icon after the label (e.g. an arrow). */
  trailing?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, loading, icon, trailing, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={btnClass(variant, size, block, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
      {trailing && !loading ? <Icon name={trailing} size={size === 'sm' ? 15 : 17} /> : null}
    </button>
  );
});

export function LinkButton({
  variant = 'secondary',
  size = 'md',
  block,
  icon,
  trailing,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; block?: boolean; icon?: string; trailing?: string }) {
  return (
    <Link className={btnClass(variant, size, block, className)} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children}
      {trailing ? <Icon name={trailing} size={size === 'sm' ? 15 : 17} /> : null}
    </Link>
  );
}

export function IconButton({ icon, label, outline, size = 18, className = '', ...rest }: { icon: string; label: string; outline?: boolean; size?: number } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label={label} title={label} className={`icon-btn ${outline ? 'icon-btn--outline' : ''} ${className}`} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}

/** The square back control used at the start of every page title. */
export function BackButton({ to, onClick, label = 'Back' }: { to?: string; onClick?: () => void; label?: string }) {
  const navigate = useNavigate();
  const go = () => {
    if (onClick) return onClick();
    // Prefer real history (browser Back semantics); fall back to the parent page on a deep link.
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate(to ?? '/book');
  };
  return (
    <button type="button" className="back-btn" aria-label={label} title={label} onClick={go}>
      <Icon name="arrow-left" size={17} />
    </button>
  );
}

// ── Fields ────────────────────────────────────────────────────────────────

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  className?: string;
}

export function FieldShell({ label, hint, error, children, className = '' }: FieldShellProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field ${error ? 'is-invalid' : ''} ${className}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p className="field__error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  prefix?: string;
  wrapperClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hint, error, prefix, wrapperClassName, className = '', ...rest }, ref) {
  return (
    <FieldShell label={label} hint={hint} error={error} className={wrapperClassName}>
      {({ id, describedBy, invalid }) => {
        const input = <input ref={ref} id={id} className={`input ${className}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />;
        return prefix ? (
          <div className="input-affix">
            <span aria-hidden="true">{prefix}</span>
            {input}
          </div>
        ) : (
          input
        );
      }}
    </FieldShell>
  );
});

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
}

export function TextArea({ label, hint, error, className = '', ...rest }: TextAreaProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <textarea id={id} className={`textarea ${className}`} aria-invalid={invalid || undefined} aria-describedby={describedBy} {...rest} />}
    </FieldShell>
  );
}

export function Checkbox({ checked, onChange, children, invalid, describedBy, id }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; invalid?: boolean; describedBy?: string; id?: string }) {
  return (
    <label className={`check ${invalid ? 'is-invalid' : ''}`}>
      <input id={id} type="checkbox" checked={checked} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

// ── Segmented control (radio semantics) ───────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Underlined text tabs (the reference's journey tabs). Real tab semantics with arrow-key movement. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
  variant = 'line',
}: {
  value: T;
  options: { value: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  variant?: 'line' | 'boxed';
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => {
    const n = (i + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div className={`tabs tabs--${variant} ${className}`} role="tablist" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
          className={`tab ${value === o.value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') move(i + 1);
            else if (e.key === 'ArrowLeft') move(i - 1);
          }}
        >
          {o.label}
          {o.count != null ? <span className="tab__count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ── Feedback ──────────────────────────────────────────────────────────────

export function Notice({ tone = 'info', children, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode; action?: ReactNode }) {
  const icon = tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'information';
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} size={17} />
      <div className="notice__body">
        <div>{children}</div>
        {action ? <div className="notice__action">{action}</div> : null}
      </div>
    </div>
  );
}

export function Badge({ tone, dot, children }: { tone?: 'red' | 'green' | 'amber' | 'blue' | 'neutral'; dot?: boolean; children: ReactNode }) {
  return <span className={['badge', tone && `badge--${tone}`, dot && 'badge--dot'].filter(Boolean).join(' ')}>{children}</span>;
}

export function EmptyState({ art, title, children, action, icon }: { art?: string; title: string; children?: ReactNode; action?: ReactNode; icon?: string }) {
  return (
    <div className="empty">
      {icon ? (
        <span className="empty__icon" aria-hidden="true">
          <Icon name={icon} size={24} />
        </span>
      ) : art ? (
        <img src={`/art/${art}.webp`} alt="" width={160} height={160} loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')} />
      ) : null}
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action ? <div className="empty__action">{action}</div> : null}
    </div>
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

export function Avatar({ name, photoUrl, size = 44 }: { name: string; photoUrl?: string; size?: number }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 1)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?';
  if (photoUrl) {
    return <img className="avatar" style={{ ['--size' as string]: `${size}px` }} src={photoUrl} alt="" referrerPolicy="no-referrer" />;
  }
  return (
    <span className="avatar" style={{ ['--size' as string]: `${size}px` }} aria-hidden="true">
      {initials}
    </span>
  );
}

// ── Dialog: centred on desktop; a bottom sheet (or a full page) on phones ───

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  footer,
  dismissible = true,
  wide = false,
  subtitle,
  variant = 'sheet',
  className = '',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dismissible?: boolean;
  wide?: boolean;
  subtitle?: ReactNode;
  /** sheet: bottom sheet on phones · page: full screen on phones (location search). */
  variant?: 'sheet' | 'page';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(`.dialog__body :is(${FOCUSABLE})`) ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      // Return focus to whatever opened the dialog (if it is still on the page).
      if (previous && document.contains(previous)) previous.focus?.();
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
    <div className={`overlay overlay--${variant}`} onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()} onKeyDown={onKey}>
      <div className={`dialog dialog--${variant} ${wide ? 'dialog--wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="dialog__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p className="dialog__sub">{subtitle}</p> : null}
          </div>
          {dismissible ? <IconButton icon="close" label="Close" outline onClick={onClose} /> : null}
        </div>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

// ── Page title: square back control, title and a one-line subtitle ─────────

export function PageHead({
  eyebrow,
  title,
  children,
  actions,
  back,
  backTo,
}: {
  eyebrow?: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Custom back control (rare). */
  back?: ReactNode;
  /** Where Back goes when there is no history (deep link). Omit for no back control. */
  backTo?: string;
}) {
  return (
    <header className="page-head">
      {back ?? (backTo ? <BackButton to={backTo} /> : null)}
      <div className="page-head__text">
        {eyebrow && /^Step \d/.test(eyebrow) ? <p className="eyebrow eyebrow--muted">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {/* Plain-text subtitles are left out for a cleaner page; links and buttons passed in still show. */}
        {children && typeof children !== 'string' ? <div className="page-head__sub">{children}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

/** Three short bars under the title of the booking flow. */
export function FlowSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flow-steps" role="img" aria-label={`Step ${current} of 3`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={n <= current ? 'is-on' : ''} />
      ))}
    </div>
  );
}

/** A plain white card. */
export function Card({ title, action, children, className = '', as: Tag = 'section', id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; as?: 'section' | 'div' | 'article'; id?: string }) {
  const headId = useId();
  return (
    <Tag className={`card ${className}`} aria-labelledby={title ? headId : undefined} id={id}>
      {title || action ? (
        <header className="card__head">
          {title ? <h2 id={headId}>{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

/** A tappable row with an icon tile, title, supporting line and chevron (account lists, help). */
export function ListRow({
  icon,
  title,
  text,
  to,
  href,
  onClick,
  trailing,
  tone,
  external,
}: {
  icon: string;
  title: ReactNode;
  text?: ReactNode;
  to?: string;
  href?: string;
  onClick?: () => void;
  trailing?: ReactNode;
  tone?: 'red' | 'danger';
  external?: boolean;
}) {
  const inner = (
    <>
      <span className="list-row__icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="list-row__text">
        <strong>{title}</strong>
        {text ? <small>{text}</small> : null}
      </span>
      {trailing}
      {to || href || onClick ? <Icon name="chevron-right" size={16} className="list-row__chev" /> : null}
    </>
  );
  const cls = `list-row ${tone ? `list-row--${tone}` : ''}`;
  if (to)
    return (
      <Link className={cls} to={to}>
        {inner}
      </Link>
    );
  if (href)
    return (
      <a className={cls} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}
