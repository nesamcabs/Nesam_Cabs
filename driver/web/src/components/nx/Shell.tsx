import React from 'react';
import { Brand } from './Brand';
import { Icon, IconSprite, type IconName } from './Icon';

export type ShellPage = 'home' | 'local' | 'trips' | 'earnings' | 'wallet' | 'profile' | 'notifications' | 'trip' | 'camera' | 'documents';

export interface NavItem {
  id: 'home' | 'local' | 'trips' | 'earnings' | 'wallet' | 'profile';
  label: string;
  icon: IconName;
}

export const NAV: NavItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'local', label: 'Local Taxi', icon: 'trip' },
  { id: 'trips', label: 'My Trips', icon: 'trip' },
  { id: 'earnings', label: 'Earnings', icon: 'chart' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];

const TITLES: Record<ShellPage, [string, string]> = {
  home: ['Dashboard', 'Your trips, ready when you are.'],
  local: ['Local Taxi', 'Go online and take rides in your service area.'],
  trips: ['My Trips', 'Upcoming duties & completed trips.'],
  earnings: ['Earnings', 'Credited earnings & pending reviews.'],
  wallet: ['Wallet', 'Balance, payouts & settlement status.'],
  profile: ['My Profile', 'Your vehicle, documents & preferences.'],
  notifications: ['Notifications', 'Trips, approvals, payments and penalties.'],
  trip: ['Trip Details', 'Start, navigate, board and close your trip.'],
  camera: ['Trip photos', 'Live trip-start photographs.'],
  documents: ['Update documents', 'Keep your licence and vehicle papers current.'],
};

/** Pages that keep a primary navigation item highlighted. */
const ACTIVE_NAV: Record<ShellPage, NavItem['id'] | ''> = {
  home: 'home',
  local: 'local',
  trips: 'trips',
  earnings: 'earnings',
  wallet: 'wallet',
  profile: 'profile',
  notifications: '',
  trip: 'trips',
  camera: 'trips',
  documents: 'profile',
};

interface ShellProps {
  page: ShellPage;
  /** Hides Earnings / Wallet for a vendor's employee driver. */
  fleetDriver: boolean;
  driver: { name: string; photoUrl: string };
  /** Assigned (upcoming) trips, shown on the My Trips item of the desktop rail. */
  tripCount: number;
  online: boolean;
  presenceLocked: boolean;
  presenceBusy: boolean;
  hasUnread: boolean;
  unreadCount: number;
  onNavigate: (id: NavItem['id']) => void;
  onToggleOnline: () => void;
  onOpenNotifications: () => void;
  onOpenSupport: () => void;
  toast: { kind: 'ok' | 'error'; text: string } | null;
  onDismissToast: () => void;
  children: React.ReactNode;
  /** Extra overlays (dialogs, modals) rendered inside the themed root. */
  overlays?: React.ReactNode;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'D';

export const Shell: React.FC<ShellProps> = ({
  page,
  fleetDriver,
  driver,
  tripCount,
  online,
  presenceLocked,
  presenceBusy,
  hasUnread,
  unreadCount,
  onNavigate,
  onToggleOnline,
  onOpenNotifications,
  onOpenSupport,
  toast,
  onDismissToast,
  children,
  overlays,
}) => {
  const [title, subtitle] = TITLES[page];
  const current = ACTIVE_NAV[page];
  const items = NAV.filter((n) => !fleetDriver || (n.id !== 'earnings' && n.id !== 'wallet'));

  const renderNav = (withCount: boolean) =>
    items.map((item) => (
      <button
        key={item.id}
        type="button"
        className={`nav-button ${current === item.id ? 'active' : ''}`}
        onClick={() => onNavigate(item.id)}
        aria-current={current === item.id ? 'page' : undefined}
      >
        <Icon name={item.icon} />
        <span className="nav-label">{item.label}</span>
        {withCount && item.id === 'trips' ? <span className="nav-count">{tripCount}</span> : null}
      </button>
    ));

  return (
    <div className="nx-root">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <IconSprite />
      <div className="app">
        <aside className="sidebar" aria-label="Main navigation">
          <Brand />
          <div className="nav-caption">YOUR WORKSPACE</div>
          <nav className="sidebar-nav" aria-label="Desktop pages">
            {renderNav(true)}
          </nav>
          <div className="sidebar-bottom">
            <div className="support-box">
              <Icon name="help" />
              <strong>We’re here for you.</strong>
              <p>Get help with your duties or payments.</p>
              <button type="button" className="text-button" onClick={onOpenSupport}>
                Contact NESAM <Icon name="arrow" className="icon-sm" />
              </button>
            </div>
            <button type="button" className="side-profile" onClick={() => onNavigate('profile')} style={{ background: 'none', width: '100%', textAlign: 'left', cursor: 'pointer' }} aria-label="Open your profile">
              <div className="avatar avatar-small" aria-hidden="true">
                {driver.photoUrl ? <img src={driver.photoUrl} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} /> : initials(driver.name)}
              </div>
              <div className="side-copy">
                <strong>{driver.name}</strong>
                <small>Verified driver</small>
              </div>
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div>
              <Brand variant="mobile" />
              <h1 id="page-title" className="home-title">
                {title}
              </h1>
              <p className="page-subtitle">{subtitle}</p>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="header-status"
                role="switch"
                aria-checked={online}
                aria-label={presenceLocked ? 'Duty status locked during a trip' : online ? 'Online. Go offline' : 'Offline. Go online'}
                onClick={onToggleOnline}
                disabled={presenceBusy}
                aria-disabled={presenceLocked}
              >
                <span className="status-dot" aria-hidden="true" />
                <span>{online ? 'Online' : 'Offline'}</span>
                <span className="header-toggle" aria-hidden="true" />
              </button>
              <button type="button" className="icon-button header-support" onClick={onOpenSupport} aria-label="Support and emergency SOS">
                <Icon name="help" />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={onOpenNotifications}
                aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              >
                <Icon name="bell" />
                {hasUnread ? <span className="notification-dot" aria-hidden="true" /> : null}
              </button>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
          <footer className="page-footer">
            <span>
              <Icon name="shield" />
              NESAM TOURS &amp; TRAVELS PRIVATE LIMITED
            </span>
            <span>Made for every mile.</span>
          </footer>
        </div>
      </div>
      <nav className="bottom-nav" aria-label="Mobile pages">
        {renderNav(false)}
      </nav>
      {overlays}
      <div className={`toast ${toast ? 'show' : ''}`} role={toast?.kind === 'error' ? 'alert' : 'status'} aria-live="polite" aria-atomic="true" onClick={onDismissToast}>
        {toast?.text}
      </div>
    </div>
  );
};
