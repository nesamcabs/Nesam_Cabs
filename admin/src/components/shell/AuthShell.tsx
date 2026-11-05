import type { ReactNode } from "react";
import Icon, { type IconName } from "../ui/Icon";

interface AuthShellProps {
  icon?: IconName;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Small line under the form (links, legal text). */
  footer?: ReactNode;
}

/** Two-panel layout shared by sign-in and request-access (reference `en-login`). */
export default function AuthShell({ icon = "shield-user", title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="ds-auth">
      <div className="ds-auth-card">
        <aside className="ds-auth-aside">
          <div className="ds-auth-lockup">
            <img src="/icons/logo.png" alt="" />
            <span>
              <strong>NESAM</strong>
              <small>SUPER ADMIN</small>
            </span>
          </div>
          <div className="ds-auth-pitch">
            <span className="ds-eyebrow">OFFICE WORKSPACE</span>
            <h2>
              One workspace.
              <br />
              Every journey.
            </h2>
            <p>
              Bookings, partners and accounts.
              <br />
              Controlled from one place.
            </p>
          </div>
          <div className="ds-auth-note">
            <Icon name="shield-check" />
            <span>
              Staff access only
              <small>Every action is permission-checked and recorded</small>
            </span>
          </div>
        </aside>
        <main className="ds-auth-main">
          <span className="ds-auth-icon">
            <Icon name={icon} size={19} />
          </span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {children}
          {footer && <div className="ds-auth-foot">{footer}</div>}
        </main>
      </div>
    </div>
  );
}
