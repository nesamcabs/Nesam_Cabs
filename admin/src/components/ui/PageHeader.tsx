import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  /** Primary and secondary page actions, right-aligned (full width on phones). */
  actions?: ReactNode;
}

/**
 * Top of every page. The top bar already names the page, so the title, eyebrow and subtitle are not
 * repeated on screen: the title stays as the page's heading for screen readers, and only the page
 * actions show.
 */
export default function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {actions && (
        <div className="ds-title ds-title--actions">
          <div className="ds-title-actions">{actions}</div>
        </div>
      )}
    </>
  );
}
