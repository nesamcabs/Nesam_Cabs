import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: IconName;
  /** Square icon-only button; `aria-label` is then required. */
  iconOnly?: boolean;
  loading?: boolean;
  /** When set the button is disabled and this text explains why (title + accessible description). */
  disabledReason?: string;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
}

/** Reference button: 35px, 7px radius, hover/active/focus/disabled/loading states. Defaults to type="button". */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, iconOnly, loading, disabledReason, disabled, className = "", type = "button", children, ...rest },
  ref,
) {
  const reasonId = useId();
  const off = Boolean(disabled || loading || disabledReason);
  return (
    <>
      <button
        ref={ref}
        type={type}
        disabled={off}
        aria-busy={loading || undefined}
        aria-describedby={disabledReason ? reasonId : rest["aria-describedby"]}
        title={disabledReason ?? rest.title}
        className={`ds-btn ds-btn-${variant} ${size === "sm" ? "ds-btn-sm" : ""} ${iconOnly ? "ds-btn-icon" : ""} ${className}`}
        {...rest}
      >
        {loading ? <span className="ds-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === "sm" ? 14 : 15} /> : null}
        {children}
      </button>
      {disabledReason && (
        <span id={reasonId} className="sr-only">
          {disabledReason}
        </span>
      )}
    </>
  );
});

export default Button;
