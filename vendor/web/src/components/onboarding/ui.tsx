// Form primitives for sign-in and the application wizard, in the NESAM Partner (vx) look. Same props as before so the
// wizard steps need no change. Screens that use them sit inside a <div className="vx"> root.
import React from 'react';
import { AlertCircle, WifiOff } from 'lucide-react';

export const RED = '#D92535';

interface FieldShellProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

export const FieldShell: React.FC<FieldShellProps> = ({ label, htmlFor, required, error, hint, children }) => (
  <div className="vx-field">
    <label htmlFor={htmlFor} className="vx-field__label">
      {label}
      {required && <b> *</b>}
    </label>
    {children}
    {error ? (
      <p id={`${htmlFor}-error`} role="alert" className="vx-err">{error}</p>
    ) : hint ? (
      <p className="vx-hint">{hint}</p>
    ) : null}
  </div>
);

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  prefix?: string;
}

export const TextField: React.FC<TextFieldProps> = ({ id, label, value, onChange, error, hint, prefix, required, className = '', ...rest }) => (
  <FieldShell label={label} htmlFor={id} required={required} error={error} hint={hint}>
    {prefix ? (
      <div className="vx-phone">
        <span>{prefix}</span>
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} {...rest} />
      </div>
    ) : (
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={`vx-input ${className}`.trim()} {...rest} />
    )}
  </FieldShell>
);

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
}

export const SelectField: React.FC<SelectFieldProps> = ({ id, label, value, onChange, options, placeholder, error, required, disabled }) => (
  <FieldShell label={label} htmlFor={id} required={required} error={error}>
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} className="vx-select">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </FieldShell>
);

export const ErrorBanner: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) =>
  message ? (
    <div role="alert" className="vx-banner vx-banner--err">
      <AlertCircle className="vx-icon" />
      <div>{message}</div>
      {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
    </div>
  ) : null;

export const OfflineBanner: React.FC = () => (
  <div className="vx-banner vx-banner--warn" role="status">
    <WifiOff className="vx-icon" />
    <div>You’re offline. Changes can’t be saved until your connection is back.</div>
  </div>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}

export const Button: React.FC<ButtonProps> = ({ loading, variant = 'primary', disabled, children, className = '', type = 'button', ...rest }) => (
  <button type={type} disabled={disabled || loading} className={`vx-btn${variant === 'primary' ? ' vx-btn--primary' : ''} ${className}`.trim()} {...rest}>
    {loading && <i className="vx-spin" aria-hidden="true" />}
    {children}
  </button>
);

export const FullScreenLoader: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="vx">
    <div className="vx-loader" role="status" style={{ minHeight: '100vh' }}><i aria-hidden="true" />{label}</div>
  </div>
);
