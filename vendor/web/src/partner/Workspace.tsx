// NESAM Partner workspace — the client reference (NESAM_Complete_Vendor.html, vendor role) wired to live data.
// Navigation: Bookings · Fleet · Trips · Earnings · Wallet, with 24/7 Helpdesk, Profile and Notifications in the header.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePartner } from '../state/Partner';
import { NotificationPopups } from '../components/NotificationPopups';
import type { PartnerNotification } from '../notificationTypes';
import { Icon } from './Icon';
import { Btn, Dialog, Empty } from './ui';
import { vendorCode, dayTime } from './format';
import { TripsScreen, DutyDetail } from './screens/Trips';
import { BookingsScreen, BookingDetail, AssignWizard } from './screens/Bookings';
import { FleetScreen, AddEntity, LinkingScreen, DocumentsScreen } from './screens/Fleet';
import { EarningsScreen, WalletScreen, PenaltyNotice, PenaltiesScreen } from './screens/Money';
import { HelpdeskScreen, AccountScreen, BusinessScreen } from './screens/Help';

export type Section = 'Bookings' | 'Fleet' | 'Trips' | 'Earnings' | 'Wallet' | 'Helpdesk' | 'Account';
export type View =
  | { kind: 'home' }
  | { kind: 'duty'; id: string }
  | { kind: 'booking'; id: string }
  | { kind: 'assign'; id: string }
  | { kind: 'add'; what: 'car' | 'driver' }
  | { kind: 'linking' }
  | { kind: 'documents' }
  | { kind: 'penalty'; id: string; returnTo?: string }
  | { kind: 'penalties' }
  | { kind: 'business' };

interface Place { section: Section; view: View; tab?: string }

interface WorkspaceValue {
  place: Place;
  go: (section: Section, tab?: string) => void;
  open: (view: View, section?: Section) => void;
  back: () => void;
  home: () => void;
  say: (message: string) => void;
  fail: (message: string) => void;
}

const Ctx = createContext<WorkspaceValue | null>(null);
export const useWorkspace = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('Workspace context missing');
  return v;
};

const NAV: [string, Section, string][] = [
  ['Bookings', 'Bookings', 'Bookings'], ['Fleet', 'Fleet', 'Fleet'], ['Trips', 'Trips', 'Trips'], ['Earnings', 'Earnings', 'Earnings'], ['Wallet', 'Wallet', 'Wallet'],
];

const HOME: Place = { section: 'Trips', view: { kind: 'home' } };

/** Where a notification's call-to-action leads. */
function placeFor(n: PartnerNotification): Place {
  if (n.category === 'penalties') return { section: 'Wallet', view: { kind: 'penalties' } };
  if (n.bookingId && ['trips', 'trip', 'booking-detail', 'bookings'].includes(n.ctaPage)) return { section: 'Bookings', view: { kind: 'booking', id: n.bookingId } };
  switch (n.ctaPage) {
    case 'marketplace': case 'dashboard': return { section: 'Trips', view: { kind: 'home' } };
    case 'wallet': case 'payouts': return { section: 'Wallet', view: { kind: 'home' } };
    case 'earnings': return { section: 'Earnings', view: { kind: 'home' } };
    case 'profile': case 'requests': return { section: 'Account', view: { kind: 'home' } };
    case 'documents': return { section: 'Fleet', view: { kind: 'documents' } };
    case 'links': case 'partner-links': return { section: 'Fleet', view: { kind: 'linking' } };
    case 'drivers': return { section: 'Fleet', view: { kind: 'home' }, tab: 'Drivers' };
    case 'vehicles': case 'fleet': return { section: 'Fleet', view: { kind: 'home' } };
    default: return n.bookingId ? { section: 'Bookings', view: { kind: 'booking', id: n.bookingId } } : { section: 'Bookings', view: { kind: 'home' } };
  }
}

export const PartnerWorkspace: React.FC = () => {
  const p = usePartner();
  const [stack, setStack] = useState<Place[]>([HOME]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [bell, setBell] = useState(false);
  const [large, setLarge] = useState(() => { try { return localStorage.getItem('nesam-partner-text') === 'large'; } catch { return false; } });
  const place = stack[stack.length - 1]!;

  const move = useCallback((next: Place) => {
    setStack((s) => [...s.slice(-24), next]);
    setNotice('');
    setError('');
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const ws = useMemo<WorkspaceValue>(() => ({
    place,
    go: (section, tab) => move({ section, view: { kind: 'home' }, tab }),
    open: (view, section) => move({ section: section ?? place.section, view }),
    back: () => { setStack((s) => (s.length > 1 ? s.slice(0, -1) : [HOME])); setNotice(''); setError(''); },
    home: () => move(HOME),
    say: (m) => { setNotice(m); setError(''); },
    fail: (m) => { setError(m); setNotice(''); },
  }), [place, move]);

  useEffect(() => {
    const onText = (e: Event) => setLarge((e as CustomEvent<boolean>).detail);
    window.addEventListener('nesam-partner-text', onText);
    return () => window.removeEventListener('nesam-partner-text', onText);
  }, []);

  const unread = p.unread > 0 || p.penalties.some((x) => !x.acknowledged && x.status === 'Pending');
  const active: Section = place.section;
  const inner = place.view.kind !== 'home';

  const body = (() => {
    const v = place.view;
    switch (v.kind) {
      case 'duty': return <DutyDetail id={v.id} />;
      case 'booking': return <BookingDetail id={v.id} />;
      case 'assign': return <AssignWizard id={v.id} />;
      case 'add': return <AddEntity what={v.what} />;
      case 'linking': return <LinkingScreen />;
      case 'documents': return <DocumentsScreen />;
      case 'penalty': return <PenaltyNotice id={v.id} returnTo={v.returnTo} />;
      case 'penalties': return <PenaltiesScreen />;
      case 'business': return <BusinessScreen />;
      default:
        switch (place.section) {
          case 'Bookings': return <BookingsScreen initialTab={place.tab} />;
          case 'Fleet': return <FleetScreen initialTab={place.tab} />;
          case 'Earnings': return <EarningsScreen />;
          case 'Wallet': return <WalletScreen />;
          case 'Helpdesk': return <HelpdeskScreen />;
          case 'Account': return <AccountScreen />;
          default: return <TripsScreen />;
        }
    }
  })();

  const navButton = ([label, key, icon]: [string, Section, string]) => (
    <button key={key} type="button" aria-current={active === key ? 'page' : undefined} onClick={() => ws.go(key)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  );

  return (
    <Ctx.Provider value={ws}>
      <div id="nesam-complete-ux" data-vendor="true" className={large ? 'v-large' : undefined}>
        <div className="nx-preview">
          <div id="nx-phone" className="nx-phone">
            <header className="v-header">
              <button className="v-brand" type="button" aria-label="NESAM Partner Trips" onClick={ws.home}>
                <span className="v-brand-logo"><img src="/partner/logo.jpg" alt="NESAM" /></span>
                <span className="v-wordmark">NESAM<small>PARTNER</small></span>
              </button>
              <div className="w-header-actions">
                <button type="button" className="v-bell" aria-label={unread ? 'Notifications, unread' : 'Notifications'} onClick={() => setBell(true)}>
                  <Icon name="bell" />{unread ? <i /> : null}
                </button>
                <button type="button" className={`w-help ${active === 'Helpdesk' ? 'is-active' : ''}`} aria-label="24/7 Helpdesk" onClick={() => ws.go('Helpdesk')}>
                  <Icon name="headphones" /><span>24/7 <b>Helpdesk</b></span>
                </button>
                <button type="button" className={`w-profile ${active === 'Account' ? 'is-active' : ''}`} aria-label="Profile and My Business" onClick={() => ws.go('Account')}>
                  <Icon name="user-round" /><span>Profile</span>
                </button>
              </div>
            </header>
            <div className="v-layout">
              <aside className="v-sidebar">
                <nav className="v-nav v-side" aria-label="Main navigation">{NAV.map(navButton)}</nav>
                <div className="v-side-account">
                  <strong>{p.profile.companyName || 'Fleet partner'}</strong>
                  <span>{vendorCode(p.profile.id)}</span>
                  <small>Verified partner</small>
                </div>
              </aside>
              <main className="v-main" id="v-main" tabIndex={-1}>
                {inner || (place.section !== 'Trips') ? (
                  <div className="s-page-controls">
                    <button type="button" onClick={ws.back}><Icon name="arrow-left" /><span>Back</span></button>
                    <button type="button" onClick={ws.home}><Icon name="house" /><span>Home</span></button>
                  </div>
                ) : null}
                {notice ? <div className="v-feedback" role="status"><Icon name="circle-check" /><span>{notice}</span></div> : null}
                {error ? <div className="v-error" role="alert">{error}</div> : null}
                {p.loadError ? (
                  <div className="v-error" role="alert">{p.loadError} <button type="button" className="v-button v-text" onClick={p.retry}><span>Retry</span></button></div>
                ) : null}
                {body}
                <footer className="v-footer">
                  <span>NESAM · Nesam Tours &amp; Travels Private Limited</span>
                  <small>Partner workspace · Live data</small>
                </footer>
              </main>
            </div>
            <nav className="v-nav v-bottom" aria-label="Mobile navigation">{NAV.map(navButton)}</nav>
          </div>
        </div>
        {bell && <NotificationsDialog onClose={() => setBell(false)} onOpen={(pl) => { setBell(false); move(pl); }} />}
        <NotificationPopups notifications={p.notifications} onOpen={(n) => { p.actions.markRead(n.id); move(placeFor(n)); }} />
      </div>
    </Ctx.Provider>
  );
};

const NotificationsDialog: React.FC<{ onClose: () => void; onOpen: (p: Place) => void }> = ({ onClose, onOpen }) => {
  const p = usePartner();
  const notices = p.penalties.filter((x) => x.status === 'Pending' && !x.acknowledged);
  const recent = p.notifications.slice(0, 30);
  return (
    <Dialog title="Notifications" onClose={onClose}>
      {notices.map((x) => (
        <article key={x.id} className="v-notification">
          <strong>₹{x.amount.toLocaleString('en-IN')} penalty notice</strong>
          <p>{x.bookingCode ? `${x.bookingCode} · ` : ''}Acknowledgement required</p>
          <Btn style="text" icon="chevron-right" onClick={() => onOpen({ section: 'Wallet', view: { kind: 'penalty', id: x.id } })}>View notice</Btn>
        </article>
      ))}
      {recent.map((n) => (
        <article key={n.id} className="v-notification">
          <strong>{n.title}</strong>
          <p>{n.message ? `${n.message} · ` : ''}{n.createdAtMs ? dayTime(new Date(n.createdAtMs)) : n.time}</p>
          <Btn style="text" icon="chevron-right" onClick={() => { p.actions.markRead(n.id); onOpen(placeFor(n)); }}>{n.ctaLabel || (n.bookingId ? 'Open booking' : 'Open')}</Btn>
        </article>
      ))}
      {!notices.length && !recent.length ? <Empty title="You’re all caught up">Duty and office updates will appear here.</Empty> : null}
    </Dialog>
  );
};
