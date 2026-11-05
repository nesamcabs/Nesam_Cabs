// The side menu opened by the hamburger button in the header: the footer's links (services, routes,
// help and company) in one simple list, with the support phone at the bottom.
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Icon } from './Icon';
interface MenuLink {
  to: string;
  label: string;
}

/** The everyday links, as plain rows with an icon. */
const QUICK: { to: string; label: string; icon: string }[] = [
  { to: '/book', label: 'Book a cab', icon: 'car' },
  { to: '/trips', label: 'My bookings', icon: 'trip-history' },
  { to: '/offers', label: 'Offers', icon: 'offers' },
  { to: '/support', label: 'Help & support', icon: 'support' },
];

const GROUPS: { title: string; links: MenuLink[] }[] = [
  {
    title: 'Services',
    links: [
      { to: '/services/one-way-drop-taxi', label: 'One-way drop taxi' },
      { to: '/services/outstation-round-trip', label: 'Round trips' },
      { to: '/services/airport-taxi', label: 'Airport transfers' },
      { to: '/services/local-rental', label: 'Local rental' },
      { to: '/services/pilgrimage-tours', label: 'Temple & pilgrimage tours' },
      { to: '/?service=multicity', label: 'Multicity itineraries' },
    ],
  },
  {
    title: 'Popular routes',
    links: [
      { to: '/routes/chennai-to-pondicherry', label: 'Chennai to Pondicherry' },
      { to: '/routes/chennai-to-bangalore', label: 'Chennai to Bangalore' },
      { to: '/routes/coimbatore-to-ooty', label: 'Coimbatore to Ooty' },
      { to: '/routes/madurai-to-rameshwaram', label: 'Madurai to Rameshwaram' },
      { to: '/routes/bangalore-to-mysore', label: 'Bangalore to Mysore' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About NESAM' },
      { to: '/support?topic=cancellation', label: 'Cancellation & refunds' },
      { to: '/legal#terms', label: 'Terms & conditions' },
      { to: '/legal#privacy', label: 'Privacy & location' },
      { to: '/legal#cancellation', label: 'Cancellation policy' },
      { to: '/legal#refund', label: 'Refund policy' },
      { to: '/legal#deletion', label: 'Account & data deletion' },
    ],
  },
];

const FOCUSABLE = 'a[href],button:not([disabled]),summary';

export function SideDrawer({ open, onClose, brand }: { open: boolean; onClose: () => void; brand: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="drawer" onKeyDown={onKey}>
      <div className="drawer__backdrop" onClick={onClose} />
      <div className="drawer__panel" role="dialog" aria-modal="true" aria-label="Menu" ref={panel}>
        <div className="drawer__head">
          <span onClick={onClose}>{brand}</span>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="Close menu" data-autofocus>
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="drawer__body" aria-label="Menu">
          <ul className="drawer__quick">
            {QUICK.map((q) => (
              <li key={q.to}>
                <Link to={q.to} onClick={onClose}>
                  <Icon name={q.icon} size={18} /> {q.label}
                </Link>
              </li>
            ))}
          </ul>
          {GROUPS.map((g) => (
            <details key={g.title} className="drawer__group">
              <summary>
                {g.title}
                <Icon name="chevron-down" size={16} />
              </summary>
              <ul className="drawer__links">
                {g.links.map((l) => (
                  <li key={l.to + l.label}>
                    <Link to={l.to} onClick={onClose}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </nav>

        <div className="drawer__foot">
          <a className="drawer__call" href={`tel:${SUPPORT_PHONE}`}>
            <Icon name="phone" size={16} /> Call {SUPPORT_PHONE_DISPLAY}
          </a>
          <p className="drawer__copy">
            © {new Date().getFullYear()} {COMPANY_LEGAL_NAME}
          </p>
        </div>
      </div>
    </div>
  );
}
