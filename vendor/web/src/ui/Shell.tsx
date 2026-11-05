import React from 'react';
import { Brand } from './kit';
import { Icon, IconSprite, type IconName } from './Icon';
import type { PageId } from '../state/Partner';

interface NavItem {
  id: PageId;
  label: string;
  icon: IconName;
}

const DESKTOP_NAV: NavItem[] = [
  { id: 'duties', label: 'Duties', icon: 'trip' },
  { id: 'vehicles', label: 'Vehicles', icon: 'car' },
  { id: 'drivers', label: 'Drivers', icon: 'users' },
  { id: 'payouts', label: 'Payments', icon: 'wallet' },
  { id: 'requests', label: 'Helpdesk', icon: 'swap' },
  { id: 'account', label: 'My Business', icon: 'user' },
];

const PHONE_NAV: NavItem[] = [
  { id: 'duties', label: 'Duties', icon: 'trip' },
  { id: 'vehicles', label: 'Fleet', icon: 'car' },
  { id: 'payouts', label: 'Payments', icon: 'wallet' },
  { id: 'requests', label: 'Helpdesk', icon: 'swap' },
  { id: 'account', label: 'Account', icon: 'user' },
];

export const TITLES: Record<PageId, [string, string]> = {
  duties: ['Bookings', 'Accept duties. Quote your payout. Assign your team.'],
  drivers: ['Drivers', 'Invite, link and manage verified drivers of your fleet.'],
  vehicles: ['Vehicles', 'Your cars, drivers and availability.'],
  requests: ['Helpdesk', 'Duty change requests and office support.'],
  payouts: ['Payments', 'Duty accounts and settlements.'],
  account: ['My Business', 'Your partner profile and account.'],
  alerts: ['Notifications', 'Trips, approvals, payments and penalties.'],
};

interface ShellProps {
  page: PageId;
  go: (page: PageId) => void;
  partnerName: string;
  partnerId: string;
  counts: { requests: number; unread: number; newDuties: number };
  children: React.ReactNode;
  overlays?: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  page,
  go,
  partnerName,
  partnerId,
  counts,
  children,
  overlays,
}) => {
  const [title, subtitle] = TITLES[page] || TITLES.duties;
  const active = page === 'alerts' ? '' : page;

  const countOf = (id: PageId) => {
    if (id === 'requests') return counts.requests;
    if (id === 'duties') return counts.newDuties;
    return 0;
  };

  return (
    <div className="nesam-vendor-app vx" data-vendor="true">
      <IconSprite />

      {/* Top Header matching reference .v-header */}
      <header className="v-header">
        <Brand onClick={() => go('duties')} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            type="button"
            className="v-bell"
            onClick={() => go('alerts')}
            aria-label={counts.unread ? `Notifications, ${counts.unread} unread` : 'Notifications'}
          >
            <Icon name="bell" />
            {counts.unread > 0 && <i />}
          </button>
        </div>
      </header>

      {/* Main layout with sidebar and content */}
      <div className="v-layout">
        <aside className="v-sidebar" aria-label="Main navigation">
          <nav className="v-nav v-side" aria-label="Sections">
            {DESKTOP_NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                aria-current={active === n.id ? 'page' : undefined}
                onClick={() => go(n.id)}
                title={n.label}
              >
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {countOf(n.id) > 0 && <span className="v-small-count">{countOf(n.id)}</span>}
              </button>
            ))}
          </nav>
          <div className="v-side-account">
            <strong>{partnerName}</strong>
            <span>{partnerId.slice(0, 12).toUpperCase()}</span>
            <small>Verified partner</small>
          </div>
        </aside>

        <main className="v-main" id="main">
          <div className="vx-page" style={{ padding: 0 }}>
            {children}
          </div>
          <footer className="v-footer">
            <span>NESAM · Nesam Tours & Travels Private Limited</span>
            <small>Interactive partner workspace · Live operational updates</small>
          </footer>
        </main>
      </div>

      {/* Mobile bottom navigation matching reference .v-nav.v-bottom */}
      <nav className="v-nav v-bottom" aria-label="Mobile navigation">
        {PHONE_NAV.map((n) => {
          const c = countOf(n.id);
          return (
            <button
              key={n.id}
              type="button"
              aria-current={active === n.id ? 'page' : undefined}
              onClick={() => go(n.id)}
            >
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {c > 0 && <span className="v-small-count">{c}</span>}
            </button>
          );
        })}
      </nav>

      {overlays}
    </div>
  );
};
