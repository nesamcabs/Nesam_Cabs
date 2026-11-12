// About NESAM Cabs: what the brand offers, who runs it and how to reach it. Every fact here is already
// published elsewhere on this site (service pages, structured data, footer and support page).
import { Link } from 'react-router-dom';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { CONTACT } from '@/lib/contact';
import { useSeo } from '@/lib/seo';
import { ABOUT_SEO } from '@/seo/pages';

const BRAND = 'NESAM Cabs';

const FACTS = [
  { icon: 'receipt', title: 'Fare shown first', text: 'You see the price before you book.' },
  { icon: 'verified', title: 'Every booking reviewed', text: 'Our team confirms each trip.' },
  { icon: 'payment-card', title: 'Pay after the trip', text: 'Cash or UPI to your driver.' },
];

const SERVICES = [
  { to: '/services/one-way-drop-taxi', label: 'One-way drop taxi', icon: 'one-way' },
  { to: '/services/outstation-round-trip', label: 'Round trips', icon: 'round-trip' },
  { to: '/services/airport-taxi', label: 'Airport transfers', icon: 'outstation' },
  { to: '/services/local-rental', label: 'Local rental', icon: 'local-rental' },
  { to: '/services/pilgrimage-tours', label: 'Temple & pilgrimage tours', icon: 'tour-package' },
  { to: '/?service=multicity', label: 'Multicity itineraries', icon: 'route' },
];

const POLICIES = [
  { to: '/legal#terms', label: 'Terms & conditions' },
  { to: '/legal#privacy', label: 'Privacy & location' },
  { to: '/legal#cancellation', label: 'Cancellation policy' },
  { to: '/legal#refund', label: 'Refund policy' },
  { to: '/legal#payment', label: 'Fare & payment policy' },
];

function Row({ icon, label, sub, to, href, external }: { icon: string; label: string; sub?: string; to?: string; href?: string; external?: boolean }) {
  const inner = (
    <>
      <span className="about-row__icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="about-row__text">
        <strong>{label}</strong>
        {sub ? <small>{sub}</small> : null}
      </span>
      <Icon name={external ? 'external-link' : 'chevron-right'} size={16} />
    </>
  );
  if (to) {
    return (
      <Link className="about-row" to={to}>
        {inner}
      </Link>
    );
  }
  return (
    <a className="about-row" href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {inner}
    </a>
  );
}

export function AboutPage() {
  useSeo(ABOUT_SEO);
  return (
    <>
      <PageHead title={`About ${BRAND}`} />
      <div className="page about">
        <section className="about-hero" aria-label={`About ${BRAND}`}>
          <p className="about-hero__eyebrow">A unit of {COMPANY_LEGAL_NAME}</p>
          <h2>{BRAND}</h2>
          <p>Outstation cabs and one-way drops across Tamil Nadu, Bangalore and Pondicherry — simple booking, clear fares and a trip reviewed by our team.</p>
          <ul className="about-facts">
            {FACTS.map((f) => (
              <li key={f.title}>
                <span className="about-facts__icon">
                  <Icon name={f.icon} size={18} />
                </span>
                <span>
                  <strong>{f.title}</strong>
                  <small>{f.text}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="about-section" aria-labelledby="ab-book">
          <h2 id="ab-book" className="group__title">What you can book</h2>
          <div className="card card--list">
            {SERVICES.map((s) => (
              <Row key={s.to} icon={s.icon} label={s.label} to={s.to} />
            ))}
          </div>
        </section>

        <section className="about-section" aria-labelledby="ab-contact">
          <h2 id="ab-contact" className="group__title">Contact us</h2>
          <div className="card card--list">
            <Row icon="phone" label={`Call ${SUPPORT_PHONE_DISPLAY}`} sub="Bookings and trip support" href={`tel:${SUPPORT_PHONE}`} />
            <Row icon="email" label={CONTACT.email} sub="Write to us" href={`mailto:${CONTACT.email}`} />
            <Row icon="location-pin" label="Head office" sub={CONTACT.addressLine} href={CONTACT.mapsUrl} external />
            <Row icon="support" label="Help & support" sub="Raise a ticket or read the FAQs" to="/support" />
          </div>
        </section>

        <section className="about-section" aria-labelledby="ab-policies">
          <h2 id="ab-policies" className="group__title">Policies</h2>
          <div className="card card--list">
            {POLICIES.map((p) => (
              <Row key={p.to} icon="document" label={p.label} to={p.to} />
            ))}
          </div>
        </section>

        <p className="about-legal">
          © {new Date().getFullYear()} {COMPANY_LEGAL_NAME}. All rights reserved.
        </p>
      </div>
    </>
  );
}
