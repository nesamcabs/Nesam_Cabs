import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "green" | "amber" | "red" | "blue";

/** Maps the free-text statuses used across the admin onto a badge tone. */
export function toneForStatus(status: string | null | undefined): BadgeTone {
  const s = (status ?? "").toLowerCase();
  if (/(reject|cancel|block|fail|expired|suspend|overdue|declin|denied|inactive|closed|disputed|refund)/.test(s)) return "red";
  if (/(pending|awaiting|review|partial|hold|scheduled|assigned|in progress|ongoing|new|expiring|requested|unpaid)/.test(s)) return "amber";
  if (/(active|approved|completed|confirmed|paid|verified|accepted|delivered|resolved|success|live|open)/.test(s)) return "green";
  if (/(info|published|draft|vendor|app|returning)/.test(s)) return "blue";
  return "neutral";
}

export default function Badge({ tone = "neutral", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`ds-badge ${className}`} data-tone={tone === "neutral" ? undefined : tone}>
      {children}
    </span>
  );
}

/** Badge whose tone is derived from the status text. */
export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  return <Badge tone={toneForStatus(status)}>{label ?? (status || "—")}</Badge>;
}
