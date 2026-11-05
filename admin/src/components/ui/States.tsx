import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";
import Button from "./Button";

export function EmptyState({
  title = "No matching records",
  hint = "Try another filter or return when new records arrive.",
  icon = "inbox",
  action,
}: {
  title?: string;
  hint?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="ds-empty" role="status">
      <Icon name={icon} />
      <strong>{title}</strong>
      <span>{hint}</span>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="ds-error" role="alert">
      <Icon name="circle-alert" />
      <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" icon="rotate-ccw" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function PermissionDenied({ area, roleName }: { area: string; roleName: string }) {
  return (
    <div className="ds-panel ds-panel-pad" style={{ maxWidth: 460, margin: "40px auto" }}>
      <div className="ds-empty" role="alert">
        <Icon name="shield-check" />
        <strong>No access to {area}</strong>
        <span>Your access ({roleName}) does not include this area. Ask the Master account (super admin) to change it in Staff &amp; Access.</span>
      </div>
    </div>
  );
}

export function Skeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number }) {
  return <span className="ds-skeleton" style={{ width, height }} aria-hidden="true" />;
}

/** Placeholder rows while a collection subscription loads. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div role="status" aria-label="Loading" style={{ display: "grid", gap: 14, padding: 20 }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16 }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} height={16} />
          ))}
        </div>
      ))}
    </div>
  );
}
