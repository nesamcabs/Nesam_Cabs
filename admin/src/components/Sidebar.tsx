import { canAccessPage, type AdminAccess } from "../config/permissions";
import type { NavBadges } from "../hooks/useNavBadges";
import { NAV_GROUPS } from "./shell/navConfig";
import Icon from "./ui/Icon";

interface SidebarProps {
  activePage: string;
  onNavigate: (page: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Mobile drawer state (below 1024px the sidebar slides over the page). */
  mobileOpen: boolean;
  onCloseMobile: () => void;
  userName?: string | null;
  userEmail?: string | null;
  access: AdminAccess;
  badges: NavBadges;
  /** First page this admin may open (the brand link). */
  homePage?: string;
}

/** Count shown beside a nav item; 0 means nothing to flag. */
function badgeFor(id: string, b: NavBadges): number {
  switch (id) {
    case "bookings": return b.newBookings;
    case "trips": return b.trips;
    case "marketplace": return b.marketplace;
    case "vendors": return b.vendors;
    case "drivers": return b.drivers;
    case "notifications": return b.notifications;
    case "support": return b.support;
    default: return 0;
  }
}

export default function Sidebar({ activePage, onNavigate, collapsed, onToggleCollapse, mobileOpen, onCloseMobile, userName, userEmail, access, badges, homePage = "dashboard" }: SidebarProps) {
  const groups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => canAccessPage(access, i.id)) }))
    .filter((g) => g.items.length > 0);
  const displayName = userName || userEmail?.split("@")[0] || "Admin";

  return (
    <>
      {mobileOpen && <div className="ds-scrim" onClick={onCloseMobile} aria-hidden="true" />}
      <aside className="ds-sidebar" data-collapsed={collapsed} data-open={mobileOpen} aria-label="Primary">
        <div className="flex items-start">
          <a
            className="ds-brand"
            href="#dashboard"
            onClick={(e) => {
              e.preventDefault();
              onNavigate(homePage);
            }}
            aria-label={access.isSuper ? "NESAM Super Admin — dashboard" : "NESAM office workspace — home"}
          >
            <img src="/icons/logo.png" alt="" />
            {!collapsed && (
              <span>
                <strong>NESAM</strong>
                <small>{access.isSuper ? "SUPER ADMIN" : "OFFICE"}</small>
              </span>
            )}
          </a>
        </div>
        <button
          type="button"
          className="ds-collapse"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={16} />
        </button>

        <nav className="ds-nav sidebar-scroll" aria-label="Master workspace">
          {groups.map((group) => (
            <div key={group.label} role="group" aria-label={group.label}>
              <div className="ds-nav-group" aria-hidden="true">
                {collapsed ? "·" : group.label}
              </div>
              {group.items.map((item) => {
                const count = badgeFor(item.id, badges);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="ds-nav-item"
                    data-page={item.id}
                    aria-current={activePage === item.id || (activePage === "new-booking" && item.id === "bookings") ? "page" : undefined}
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? `${item.label}${count ? `, ${count} pending` : ""}` : undefined}
                    onClick={() => onNavigate(item.id)}
                  >
                    <Icon name={item.icon} />
                    {!collapsed && <span>{item.label}</span>}
                    {count > 0 && <span className="ds-nav-count">{count > 99 ? "99+" : count}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ds-master-tag">
          <Icon name="shield-check" />
          {!collapsed && (
            <span>
              <strong>{access.isSuper ? "Master account" : access.roleName}</strong>
              <small title={userEmail ?? undefined}>{userEmail || displayName}</small>
            </span>
          )}
        </div>
      </aside>
    </>
  );
}
