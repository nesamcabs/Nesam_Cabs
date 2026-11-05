import { Suspense, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useCustomerData } from '@/state/CustomerData';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { useInbox } from '@/state/Inbox';
import { useAuth } from '@/state/Auth';
import { useBooking } from '@/state/Booking';
import { useOnline } from '@/lib/hooks';
import { SERVICES, parseService, serviceHref, serviceOfTrip, type ServiceId } from '@/lib/services';
import { CONTACT } from '@/lib/contact';
import { PageLoader } from './ui';
import { Icon } from './Icon';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { FloatingCallButton } from './FloatingCallButton';
import { SideDrawer } from './SideDrawer';
import { AiChatbot } from './AiChatbot';

export function Brand({ light = false, to = '/book' }: { light?: boolean; to?: string }) {
  return (
    <Link to={to} className={`brand ${light ? 'brand--light' : ''}`} aria-label="NESAM Cabs — booking home">
      <img className="brand__img" src="/nesam/logo-sm.webp" alt="NESAM Cabs" width={130} height={42} />
    </Link>
  );
}

/** Booking steps, booking confirmation and trip details carry their own Back/Home bar on phones. */
const FLOW = [/^\/book\/(ride|confirm|done\/[^/]+)$/, /^\/ride\//, /^\/trips\/[^/]+$/];

function AppDownload() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="app-dl" ref={root}>
      <button ref={trigger} type="button" className="app-dl__trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls="app-dl-panel" onClick={() => setOpen((o) => !o)}>
        <Icon name="travel-app" size={17} />
        <span>Get the NESAM App</span>
        <Icon name="chevron-down" size={13} />
      </button>
      {open ? (
        <section className="app-dl__panel" id="app-dl-panel" role="dialog" aria-labelledby="app-dl-title">
          <button type="button" className="app-dl__close" aria-label="Close" onClick={() => setOpen(false)}>
            <Icon name="close" size={15} />
          </button>
          <span className="app-dl__mark">
            <Icon name="travel-app" size={22} />
          </span>
          <h2 id="app-dl-title">NESAM in your pocket</h2>
          <p>Bookings and trip updates, together.</p>
          <div className="app-dl__stores">
            <div>
              <strong>Google Play</strong>
              <span>Coming soon</span>
            </div>
            <div>
              <strong>App Store</strong>
              <span>Coming soon</span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function NotificationsLink({ compact = false }: { compact?: boolean }) {
  const { unreadCount } = useInbox();
  return (
    <NavLink to="/notifications" className={({ isActive }) => `head-action ${compact ? 'head-action--icon' : ''} ${isActive ? 'is-active' : ''}`} aria-label={compact ? `Notifications${unreadCount ? `, ${unreadCount} unread` : ''}` : undefined}>
      <span className="head-action__icon">
        <Icon name="notifications" size={compact ? 22 : 17} />
        {unreadCount > 0 ? (
          <em className="count" aria-hidden={compact || undefined}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </em>
        ) : null}
      </span>
      {compact ? null : <span>Notifications{unreadCount > 0 ? <span className="sr-only">, {unreadCount} unread</span> : null}</span>}
    </NavLink>
  );
}

const ACCOUNT_PATHS = /^\/(account|trips|notifications|offers|support|legal|about)(\/|$)/;

/** Phone navigation: the four services and Account (the reference's final order). */
/** The bottom bar: Outstation, the main service, sits in the middle (raised and filled). */
const BAR_ORDER: ServiceId[] = ['airport', 'rental', 'outstation', 'multicity'];
const barServices = () => BAR_ORDER.flatMap((id) => SERVICES.find((s) => s.id === id) ?? []);

function BottomNav() {
  const location = useLocation();
  const [params] = useSearchParams();
  const { draft } = useBooking();
  const onHome = location.pathname === '/book' || location.pathname === '/';
  const current: ServiceId | null = onHome ? (parseService(params.get('service')) ?? serviceOfTrip(draft.tripType)) : null;
  const accountActive = ACCOUNT_PATHS.test(location.pathname) && !location.pathname.startsWith('/notifications') && !location.pathname.startsWith('/support');
  return (
    <nav className="bottom-nav" aria-label="Services and account">
      {barServices().map((s) => (
        <Link key={s.id} to={serviceHref(s.id)} className={`bottom-nav__item ${s.id === 'outstation' ? 'bottom-nav__item--main' : ''} ${current === s.id ? 'is-active' : ''}`} aria-current={current === s.id ? 'page' : undefined}>
          <span className="bottom-nav__symbol">
            <Icon name={s.icon} size={24} />
          </span>
          <span className="bottom-nav__label">{s.label}</span>
        </Link>
      ))}
      <Link to="/account" className={`bottom-nav__item ${accountActive ? 'is-active' : ''}`} aria-current={accountActive ? 'page' : undefined}>
        <span className="bottom-nav__symbol">
          <Icon name="travel-account" size={24} />
        </span>
        <span className="bottom-nav__label">Account</span>
      </Link>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner wrap">
        <div className="footer__grid">
          <div className="footer__brand">
            <img className="footer__logo" src="/nesam/logo.webp" alt="NESAM Cabs" width={180} height={58} loading="lazy" />
            <p className="footer__tag">Cabs &amp; Car Rentals</p>
            <address>
              {COMPANY_LEGAL_NAME}
              <br />
              {CONTACT.addressLine}
            </address>
            <a className="footer__phone num" href={`tel:${SUPPORT_PHONE}`}>
              {SUPPORT_PHONE_DISPLAY}
            </a>
            <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
            <a className="footer__map" href={CONTACT.mapsUrl} target="_blank" rel="noopener noreferrer">
              Get directions <Icon name="arrow-up-right" size={13} />
            </a>
          </div>
          <nav aria-label="Our services">
            <h2>Our services</h2>
            <Link to="/services/one-way-drop-taxi">One Way</Link>
            <Link to="/services/outstation-round-trip">Round Trip</Link>
            <Link to="/services/airport-taxi">Airport Transfers</Link>
            <Link to={serviceHref('multicity')}>Multicity</Link>
            <Link to="/services/local-rental">Local Rental</Link>
            <Link to="/services/pilgrimage-tours">Temple &amp; Pilgrimage Tours</Link>
          </nav>
          <nav aria-label="Bookings and help">
            <h2>Bookings &amp; help</h2>
            <Link to="/trips">My Bookings</Link>
            <Link to="/account/payments">Payments</Link>
            <Link to="/offers">Offers</Link>
            <Link to="/support">Help &amp; Support</Link>
            <Link to="/book#faq">Frequently asked questions</Link>
          </nav>
          <nav aria-label="Company">
            <h2>Company</h2>
            <Link to="/about">About NESAM</Link>
            <Link to="/support?topic=cancellation">Cancellation &amp; Refunds</Link>
            <Link to="/legal#terms">Terms &amp; Conditions</Link>
            <Link to="/legal#privacy">Privacy &amp; Location</Link>
            <Link to="/legal#cancellation">Cancellation Policy</Link>
            <Link to="/legal#refund">Refund Policy</Link>
            <Link to="/legal#payment">Fare &amp; Payment Policy</Link>
            <Link to="/legal#deletion">Account &amp; Data Deletion</Link>
          </nav>
          <nav aria-label="Popular routes" className="footer__routes">
            <h2>Popular routes</h2>
            <Link to="/routes/chennai-to-pondicherry">Chennai to Pondicherry</Link>
            <Link to="/routes/chennai-to-bangalore">Chennai to Bangalore</Link>
            <Link to="/routes/coimbatore-to-ooty">Coimbatore to Ooty</Link>
            <Link to="/routes/madurai-to-rameshwaram">Madurai to Rameshwaram</Link>
            <Link to="/routes/bangalore-to-mysore">Bangalore to Mysore</Link>
          </nav>
        </div>
        <div className="footer__bottom">
          <p>
            © {new Date().getFullYear()} {COMPANY_LEGAL_NAME.toUpperCase()}
          </p>
          <p>
            Fares shown before you book <span aria-hidden="true">·</span> Pay your driver by cash or UPI
          </p>
        </div>
      </div>
    </footer>
  );
}

export function Shell() {
  const { profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const { online, recovered } = useOnline();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // The menu closes whenever the page changes.
  useEffect(() => setMenuOpen(false), [location.pathname]);
  const flow = FLOW.some((re) => re.test(location.pathname));
  const bookActive = location.pathname === '/book' || location.pathname.startsWith('/book/');
  const accountActive = ACCOUNT_PATHS.test(location.pathname) && !location.pathname.startsWith('/notifications') && !location.pathname.startsWith('/support');

  // New page → start at the top and move focus to the page (keyboard and screen-reader users).
  // A hash (e.g. /book#faq) scrolls to that section instead.
  useEffect(() => {
    if (location.hash) {
      const el = document.getElementById(location.hash.slice(1));
      if (el) {
        window.setTimeout(() => el.scrollIntoView({ block: 'start' }), 60);
        return;
      }
    }
    window.scrollTo({ top: 0 });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [location.pathname, location.hash]);

  return (
    <div className={`shell ${flow ? 'shell--flow' : 'shell--nav'}`}>
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
          <Icon name="offline" size={15} /> You’re offline. Bookings and live updates resume when you reconnect.
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
          <nav className="topbar__nav" aria-label="Main">
            <Link to="/book" className={`topbar__book ${bookActive ? 'is-active' : ''}`} aria-current={bookActive ? 'page' : undefined}>
              <Icon name="car" size={16} /> Book a cab
            </Link>
            <NavLink to="/trips" className={({ isActive }) => `topbar__link ${isActive ? 'is-active' : ''}`}>
              My bookings
            </NavLink>
            <NavLink to="/offers" className={({ isActive }) => `topbar__link ${isActive ? 'is-active' : ''}`}>
              Offers
            </NavLink>
            <NavLink to="/about" className={({ isActive }) => `topbar__link ${isActive ? 'is-active' : ''}`}>
              About
            </NavLink>
          </nav>
          <div className="topbar__actions">
            <AppDownload />
            <NotificationsLink />
            <NavLink to="/support" className={({ isActive }) => `head-action ${isActive ? 'is-active' : ''}`}>
              <Icon name="support" size={17} />
              <span>24/7 Support</span>
            </NavLink>
            {profile ? (
              <Link to="/account" className={`head-action head-action--account ${accountActive ? 'is-active' : ''}`}>
                <Icon name="profile" size={17} />
                <span className="truncate">Account</span>
              </Link>
            ) : (
              <button type="button" className="head-action head-action--account" onClick={() => openLoginModal({ title: 'Continue with mobile' })}>
                <Icon name="profile" size={17} />
                <span>Sign in</span>
              </button>
            )}
          </div>
          <div className="topbar__mobile">
            <NotificationsLink compact />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="main">
        <Suspense fallback={<PageLoader />}>
          <RouteErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </RouteErrorBoundary>
        </Suspense>
      </main>

      <Footer />
      {!flow ? <BottomNav /> : null}
      <SideDrawer open={menuOpen} onClose={() => setMenuOpen(false)} brand={<Brand />} />
      <FloatingCallButton />
      <AiChatbot />
    </div>
  );
}
