import type { ReactNode } from "react";
import Icon, { type IconName } from "./Icon";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: IconName;
  /** Makes the card a button (e.g. jump to the filtered list). */
  onClick?: () => void;
}

export default function KpiCard({ label, value, note, icon, onClick }: KpiCardProps) {
  const body = (
    <>
      <span className="ds-kpi-label">
        {icon && <Icon name={icon} />}
        {label}
      </span>
      <span className="ds-kpi-value">{value}</span>
      {note && <span className="ds-kpi-note">{note}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className="ds-kpi" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="ds-kpi">{body}</div>
  );
}

export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="ds-kpi-grid">{children}</div>;
}
