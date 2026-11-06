import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useCustomerData } from '@core/context/CustomerData';
import { formatPhone } from '@core/utils/format';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { useInbox } from '@/state/Inbox';
import { useAuth } from '@/state/Auth';
import { useBooking } from '@/state/Booking';
import { useOnline } from '@/lib/hooks';
import { scrollToBookingForm } from '@/lib/scrollToForm';
import { SERVICES, parseService, serviceHref, serviceOfTrip, type ServiceId } from '@/lib/services';
import { Avatar, Button, Dialog, PageLoader } from './ui';
import { Icon } from './Icon';
import { RideBanner } from './RideBanner';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { FloatingCallButton } from './FloatingCallButton';
import { SideDrawer } from './SideDrawer';
import { AiChatbot } from './AiChatbot';
import { ALL_ROUTES } from '@/pages/routes/routesData';

export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <Link to="/" className={`brand ${compact ? 'brand--compact' : ''} ${light ? 'brand--light' : ''}`} aria-label="NESAM Cabs — book a ride">
      <img
        src={compact ? '/nesam/emblem.webp' : '/nesam/logo.webp'}
        alt="NESAM Cabs"
        width={compact ? 44 : 192}
        height={compact ? 44 : 44}
        style={{ objectFit: 'contain' }}
      />
    </Link>
  );
}

const NAV = [
  { to: '/book', label: 'Book a ride', short: 'Book', icon: 'car' },
  { to: '/trips', label: 'My trips', short: 'Trips', icon: 'trip-history' },
  { to: '/notifications', label: 'Notifications', short: 'Alerts', icon: 'notifications' },
] as const;

import airportIcon from '@/assets/nav/airport-taxi.png';
import multicityIcon from '@/assets/nav/multicity.png';
import outstationIcon from '@/assets/nav/outstation.png';
import rentalIcon from '@/assets/nav/local-rentals.png';
import profileIcon from '@/assets/nav/profile.png';

/** Desktop header links. Account lives in the profile menu there. On phones the bottom bar holds the four
    services, and the header holds Notifications. Account and My trips are in the side menu. */
const TOP_NAV = [NAV[0], NAV[1], { to: '/offers', label: 'Offers', short: 'Offers', icon: 'offers' }, NAV[2]] as const;

/** Active booking flow pages where the phone bottom tab bar steps aside for the sticky FlowBar. */
const FLOW = [/^\/book\/(ride|confirm|done\/[^/]+)$/, /^\/ride\//, /^\/local-taxi\/ride\//, /^\/trips\/[^/]+$/];
const IMMERSIVE = [/^\/ride\//, /^\/local-rentals(\/|$)/, /^\/trips\/[^/]+$/];

/** Phone bottom bar: the five services, each opening the booking form on that service. Outstation, the main
    service, is raised and filled in the middle. */
const BAR_ORDER: ServiceId[] = ['outstation', 'multicity', 'rental', 'airport'];
const barServices = () => BAR_ORDER.flatMap((id) => SERVICES.find((s) => s.id === id) ?? []);

/** The bottom bar's short names. */
const SHORT_LABEL: Partial<Record<ServiceId, string>> = { airport: 'Airport', multicity: 'Multicity', outstation: 'Outstation', rental: 'Local' };
const NAV_ICON: Partial<Record<ServiceId, string>> = { airport: airportIcon, multicity: multicityIcon, outstation: outstationIcon, rental: rentalIcon };

function BottomNav() {
  const location = useLocation();
  const [params] = useSearchParams();
  const { draft } = useBooking();
  const [profilePicked, setProfilePicked] = useState(false);
  useEffect(() => setProfilePicked(false), [location.pathname, params.toString()]); // any navigation moves the selection
  const onHome = location.pathname === '/book' || location.pathname === '/';
  // Local Taxi has its own pages (/local-taxi…): keep its tab lit there instead of leaving the bar looking like Outstation.
  const onLocal = /^\/local-taxi(\/|$)/.test(location.pathname);
  const onRentals = /^\/local-rentals(\/|$)/.test(location.pathname);
  const current: ServiceId | null = profilePicked ? null : onLocal ? 'local' : onRentals ? (params.get('mode') === 'pickup' ? 'pickup' : 'rental') : onHome ? (parseService(params.get('service')) ?? serviceOfTrip(draft.tripType)) : null;

  return (
    <nav className="tabbar" aria-label="Services">
      {barServices().map((s) => (
        <Link key={s.id} to={s.id === 'local' ? '/local-taxi' : serviceHref(s.id)} className={`tabbar__link ${s.id === 'outstation' ? 'tabbar__link--main' : ''} ${current === s.id || (s.id === 'rental' && current === 'pickup') ? 'is-active' : ''}`} aria-current={current === s.id || (s.id === 'rental' && current === 'pickup') ? 'page' : undefined}>
          <span className="tabbar__icon">
            <img className="tabbar__img" src={NAV_ICON[s.id]} alt="" width={s.id === 'outstation' ? 46 : 44} height={s.id === 'outstation' ? 46 : 44} draggable={false} />
          </span>
          <span className="tabbar__label">{SHORT_LABEL[s.id] ?? s.label}</span>
        </Link>
      ))}
      <ProfileTab picked={profilePicked} onPick={() => setProfilePicked(true)} />
    </nav>
  );
}

/** The fifth slot of the phone bottom bar: the account page when signed in, the sign-in sheet otherwise. */
function ProfileTab({ picked, onPick }: { picked: boolean; onPick: () => void }) {
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const location = useLocation();
  const on = /^\/account(\/|$)/.test(location.pathname);
  const inner = (
    <>
      <span className="tabbar__icon">
        <img className="tabbar__img" src={profileIcon} alt="" width={44} height={44} draggable={false} />
      </span>
      <span className="tabbar__label">Profile</span>
    </>
  );
  if (profile) {
    return (
      <Link to="/account" onClick={onPick} className={`tabbar__link ${on || picked ? 'is-active' : ''}`} aria-current={on ? 'page' : undefined}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" className={`tabbar__link tabbar__link--button ${picked ? 'is-active' : ''}`} onClick={() => { onPick(); openLoginModal({ title: 'Sign in to NESAM Cabs' }); }}>
      {inner}
    </button>
  );
}

function ProfileMenu() {
  const { profile } = useCustomerData();
  const { signOut, openLoginModal } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!profile) {
    return (
      <Button
        variant="primary"
        size="sm"
        onClick={() => openLoginModal({ title: 'Sign in to NESAM Cabs' })}
      >
        <Icon name="profile" size={16} /> Sign in
      </Button>
    );
  }

  const first = profile.name.split(' ')[0] || 'Account';
  return (
    <div className="menu" ref={root}>
      <button type="button" className="menu__trigger" aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu, ${first}`} title={profile.name} onClick={() => setOpen((o) => !o)}>
        <Avatar name={profile.name} photoUrl={profile.photoUrl} size={38} />
        <span className="menu__name">{first}</span>
        <Icon name="chevron-down" size={16} />
      </button>
      {open ? (
        <div className="menu__panel" role="menu">
          <div className="menu__who">
            <strong className="truncate">{profile.name}</strong>
            <span className="muted small">{formatPhone(profile.phone)}</span>
          </div>
          <Link role="menuitem" to="/account">
            <Icon name="profile" /> Account
          </Link>
          <Link role="menuitem" to="/account/places">
            <Icon name="saved-place" /> Saved places
          </Link>
          <Link role="menuitem" to="/account/payments">
            <Icon name="wallet" /> Payments
          </Link>
          <Link role="menuitem" to="/legal">
            <Icon name="document" /> Terms &amp; privacy
          </Link>
          <button role="menuitem" type="button" onClick={() => setConfirm(true)}>
            <Icon name="logout" /> Log out
          </button>
        </div>
      ) : null}
      {confirm ? (
        <Dialog
          title="Log out of NESAM Cabs?"
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Stay signed in
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  signOut().catch(() => {
                    setError('We couldn’t log you out. Please try again.');
                  })
                }
              >
                Log out
              </Button>
            </>
          }
        >
          <p className="muted">You’ll need to verify your mobile number again to sign back in.</p>
          {error ? <p className="field__error">{error}</p> : null}
        </Dialog>
      ) : null}
    </div>
  );
}

function Footer() {
  const scrollToConsole = () => scrollToBookingForm();

  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__cta">
          <div className="footer__cta-copy">
            <h3>Ready to travel? Book your cab online in seconds.</h3>
            <p className="footer__cta-sub">
              Verified drivers, upfront transparent fares, and air-conditioned cars across South India.
            </p>
          </div>
          <div className="footer__cta-actions">
            <Link to="/" className="btn btn--sun btn--lg" onClick={scrollToConsole}>
              Book a Ride Now <Icon name="arrow-right" size={18} />
            </Link>
            <a href={`tel:${SUPPORT_PHONE}`} className="btn btn--ghost-light btn--lg">
              <Icon name="phone" size={18} /> {SUPPORT_PHONE_DISPLAY}
            </a>
          </div>
        </div>
        <div className="footer__grid">
          <div className="footer__brand">
            <Brand light />
            <p className="muted">
              Tamil Nadu and South India's trusted cab network for outstation one-way drops, round trips, airport transfers, and hourly rentals.
            </p>
          </div>
          <nav className="footer__col" aria-label="Services">
            <h2>Services</h2>
            <ul>
              <li>
                <Link to="/services/one-way-drop-taxi">One Way Drop Taxi</Link>
              </li>
              <li>
                <Link to="/services/outstation-round-trip">Round Trips</Link>
              </li>
              <li>
                <Link to="/services/airport-taxi">Airport Transfers</Link>
              </li>
              <li>
                <Link to="/services/local-rental">Hourly City Rental</Link>
              </li>
              <li>
                <Link to="/services/pilgrimage-tours">Temple &amp; Pilgrimage Tours</Link>
              </li>
              <li>
                <Link to="/?service=multicity" onClick={scrollToConsole}>Multicity Itineraries</Link>
              </li>
            </ul>
          </nav>
          <nav className="footer__col" aria-label="Popular routes">
            <h2>Popular Routes</h2>
            <ul>
              {ALL_ROUTES.map((r) => (
                <li key={r.slug}>
                  <Link to={`/routes/${r.slug}`}>
                    {r.origin} to {r.destination}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <nav className="footer__col" aria-label="Support">
            <h2>Support</h2>
            <ul>
              <li>
                <Link to="/support">Help &amp; Support</Link>
              </li>
              <li>
                <Link to="/offers">Special Offers</Link>
              </li>
              <li>
                <a href={`tel:${SUPPORT_PHONE}`}>Call {SUPPORT_PHONE_DISPLAY}</a>
              </li>
            </ul>
          </nav>
          <nav className="footer__col" aria-label="Policies">
            <h2>Policies</h2>
            <ul>
              <li>
                <Link to="/about">About NESAM Cabs</Link>
              </li>
              <li>
                <Link to="/legal#terms">Terms &amp; Conditions</Link>
              </li>
              <li>
                <Link to="/legal#privacy">Privacy &amp; Location</Link>
              </li>
              <li>
                <Link to="/legal#cancellation">Cancellation Policy</Link>
              </li>
              <li>
                <Link to="/legal#refund">Refund Policy</Link>
              </li>
              <li>
                <Link to="/legal#payment">Fare &amp; Payment Policy</Link>
              </li>
              <li>
                <Link to="/legal#deletion">Account &amp; Data Deletion</Link>
              </li>
            </ul>
          </nav>
        </div>
        <div className="footer__legal">
          <span>© {new Date().getFullYear()} NESAM Cabs · A Unit of {COMPANY_LEGAL_NAME}</span>
          <span>Cash or UPI to your driver · nothing is charged when you book</span>
        </div>
      </div>
    </footer>
  );
}

/**
 * Publishes how much of the viewport's bottom edge is covered (floating tab bar, sticky flow bar,
 * bottom sheet) as --dock-h, so toasts and other floating UI always clear it. Measured from the
 * elements themselves, so safe-area insets and responsive visibility are accounted for.
 */
function useDockInset() {
  useEffect(() => {
    const root = document.documentElement;
    const SELECTOR = '.tabbar, .flow-bar, .done-actions, .overlay > .dialog';
    let frame = 0;
    let watched = new Set<HTMLElement>();
    const resize = new ResizeObserver(() => schedule());
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      let covered = 0;
      const present = new Set(Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)));
      for (const el of watched) if (!present.has(el)) resize.unobserve(el);
      for (const el of present) if (!watched.has(el)) resize.observe(el);
      watched = present;
      for (const el of present) {
        if (el.getClientRects().length === 0) continue;
        const r = el.getBoundingClientRect();
        // Only what touches the bottom edge matters; a near full-screen page covers everything, so ignore it.
        if (r.bottom < vh - 48 || r.top >= vh) continue;
        const height = vh - r.top;
        if (height < vh * 0.6) covered = Math.max(covered, height);
      }
      root.style.setProperty('--dock-h', `${Math.round(covered)}px`);
    };
    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    const mutate = new MutationObserver(schedule);
    mutate.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      mutate.disconnect();
      resize.disconnect();
      watched.clear();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
      root.style.removeProperty('--dock-h');
    };
  }, []);
}

export function Shell() {
  useDockInset();
  const { unreadCount } = useInbox();
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { online, recovered } = useOnline();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu closes whenever the page changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const isFlow = FLOW.some((re) => re.test(location.pathname));
  const isImmersive = IMMERSIVE.some((re) => re.test(location.pathname));
  const onMapPage = /^\/local-rentals(\/|$)/.test(location.pathname);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [location.pathname]);

  return (
    <div className={`shell ${isImmersive ? 'shell--immersive' : ''} ${isFlow ? '' : 'shell--dock'}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      {!online ? (
        <div className="net-banner" role="status">
          You’re offline. Bookings and live updates resume when you reconnect.
        </div>
      ) : recovered ? (
        <div className="net-banner net-banner--ok" role="status">
          Back online.
        </div>
      ) : null}

      <header className="topbar">
        <div className="topbar__inner">
          <button type="button" className="menu-btn" aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <Brand />
          <nav className="topnav" aria-label="Main">
            {TOP_NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                aria-label={n.to === '/notifications' && unreadCount > 0 ? `${n.label}, ${unreadCount} unread` : n.label}
                title={n.label}
                className={({ isActive }) => `topnav__link ${isActive || (n.to === '/book' && location.pathname === '/') ? 'is-active' : ''}`}
              >
                <Icon name={n.icon} size={19} />
                <span className="lbl-long">{n.label}</span>
                {n.to === '/notifications' && unreadCount > 0 ? (
                  <em className="count" aria-label={`${unreadCount} unread`}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </em>
                ) : null}
              </NavLink>
            ))}
          </nav>
          <RideBanner />
          <div className="topbar__right">
            <Link to="/support" className="help-link" aria-label="Help and support" title="Help">
              <Icon name="help" size={18} />
              <span className="help-link__text">Help</span>
            </Link>
            <a className="help-link help-link--phone" href={`tel:${SUPPORT_PHONE}`} aria-label={`Call NESAM Cabs support ${SUPPORT_PHONE_DISPLAY}`} title={SUPPORT_PHONE_DISPLAY}>
              <Icon name="phone" size={18} />
              <span className="num">{SUPPORT_PHONE_DISPLAY}</span>
            </a>
            <ProfileMenu />
          </div>
          <div className="topbar__mobile">
            {!profile ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => openLoginModal({ title: 'Sign in to NESAM Cabs' })}
              >
                Sign in
              </Button>
            ) : (
              <>
                <NavLink
                  to="/notifications"
                  className={({ isActive }) => `icon-btn icon-btn--badge ${isActive ? 'is-active' : ''}`}
                  aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
                  title="Notifications"
                >
                  <Icon name="notifications" size={20} />
                  {unreadCount > 0 ? <em className="count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</em> : null}
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>

      {/* The footer waits for the page: while a screen loads, only its placeholder shows. */}
      <Suspense
        fallback={
          <main id="main" tabIndex={-1} className="main">
            <PageLoader />
          </main>
        }
      >
        <main id="main" tabIndex={-1} className="main">
          <RouteErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
        {!isImmersive ? <Footer /> : null}
      </Suspense>

      {!isFlow ? <BottomNav /> : null}
      <SideDrawer open={menuOpen} onClose={() => setMenuOpen(false)} brand={<Brand />} />
      {/* The Local Rentals map keeps the header and the bottom bar; its sheet needs the corner free. */}
      {onMapPage ? null : <FloatingCallButton />}
      {onMapPage ? null : <AiChatbot />}
    </div>
  );
}
export default Shell;
