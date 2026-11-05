// About NESAM Cabs: what the brand offers, who runs it and how to reach it. Every fact here is already
// published elsewhere on this site (service pages, structured data, footer and support page).
import { Link } from 'react-router-dom';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Card, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { CONTACT } from '@/lib/contact';
import { useSeo } from '@/lib/seo';
import { ABOUT_SEO } from '@/seo/pages';

const SERVICES = [
  { to: '/services/one-way-drop-taxi', label: 'One-way drop taxi' },
  { to: '/services/outstation-round-trip', label: 'Round trips' },
  { to: '/services/airport-taxi', label: 'Airport transfers' },
  { to: '/services/local-rental', label: 'Local rental' },
  { to: '/services/pilgrimage-tours', label: 'Temple & pilgrimage tours' },
  { to: '/?service=multicity', label: 'Multicity itineraries' },
];

export function AboutPage() {
  useSeo(ABOUT_SEO);
  return (
    <>
      <PageHead
        eyebrow="Company"
        title="About NESAM Cabs"
        back={
          <Link to="/account" className="back-link">
            <Icon name="arrow-left" size={18} /> Account
          </Link>
        }
      >
        Outstation cabs and one-way drops across Tamil Nadu, Bangalore and Pondicherry.
      </PageHead>
      <div className="page stack">
        <Card>
          <h2>Who we are</h2>
          <p>
            NESAM Cabs is a customer booking brand of NESAM Tours and Travels Private Limited (&quot;A Unit of NESAM Tours and Travels Private Limited&quot;). Every fare is shown before you book, every booking is reviewed by our team, and you pay your driver in cash or by UPI after the trip.
          </p>
          <address>
            {COMPANY_LEGAL_NAME}
            <br />
            {CONTACT.addressLine}
          </address>
        </Card>
        <Card>
          <h2>What you can book</h2>
          <ul className="about-list">
            {SERVICES.map((s) => (
              <li key={s.to}>
                <Link to={s.to}>{s.label}</Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2>Contact</h2>
          <ul className="about-list">
            <li>
              Call <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE_DISPLAY}</a> for bookings and trip support
            </li>
            <li>
              Write to <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
            </li>
            <li>
              <a href={CONTACT.mapsUrl} target="_blank" rel="noopener noreferrer">
                Get directions to our head office
              </a>
            </li>
            <li>
              <Link to="/support">Help &amp; support tickets</Link>
            </li>
          </ul>
        </Card>
        <Card>
          <h2>Policies</h2>
          <p>
            Read the <Link to="/legal#terms">terms</Link>, <Link to="/legal#privacy">privacy and location policy</Link>, <Link to="/legal#cancellation">cancellation</Link>,{' '}
            <Link to="/legal#refund">refund</Link> and <Link to="/legal#payment">fare and payment</Link> policies that apply to every booking.
          </p>
        </Card>
        <p className="muted small">
          © {new Date().getFullYear()} {COMPANY_LEGAL_NAME}. All rights reserved.
        </p>
      </div>
    </>
  );
}
