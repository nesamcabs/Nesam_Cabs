// About NESAM: the company details this site already publishes (legal name, service area, contact).
import { Link } from 'react-router-dom';
import { COMPANY_LEGAL_NAME, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { Card, ListRow, PageHead } from '@/components/ui';
import { AccountLayout } from '@/components/AccountLayout';
import { CONTACT } from '@/lib/contact';
import { useSeo } from '@/lib/seo';

export function AboutPage() {
  useSeo({
    title: 'About NESAM Cabs',
    description: 'NESAM Tours and Travels Private Limited — outstation cabs, one-way drop taxis, round trips, airport transfers and local rentals across Tamil Nadu and South India.',
    canonical: '/about',
  });
  return (
    <AccountLayout>
      <PageHead backTo="/account" title="About NESAM">
        Cabs &amp; car rentals across Tamil Nadu and South India.
      </PageHead>
      <Card title={COMPANY_LEGAL_NAME}>
        <p className="about-text">
          NESAM runs outstation cabs, one-way drop taxis, round trips, airport transfers and local hourly rentals across Tamil Nadu, Puducherry, Bengaluru and
          beyond. Every fare is shown before you book, every booking is reviewed by our team, and you pay your driver in cash or by UPI after the trip.
        </p>
        <address className="about-text">
          {COMPANY_LEGAL_NAME}
          <br />
          {CONTACT.addressLine}
        </address>
      </Card>
      <div className="card card--list acct-list">
        <ListRow icon="phone" title={`Call ${SUPPORT_PHONE_DISPLAY}`} text="Bookings and trip support" href={`tel:${SUPPORT_PHONE}`} />
        <ListRow icon="email" title={CONTACT.email} text="Write to NESAM" href={`mailto:${CONTACT.email}`} />
        <ListRow icon="location-pin" title="Get directions" text={CONTACT.addressLine} href={CONTACT.mapsUrl} external />
        <ListRow icon="document" title="Terms & privacy" text="Customer terms and privacy policy" to="/legal" />
      </div>
      <p className="muted small">
        Looking for a route? See <Link to="/routes/chennai-to-pondicherry">Chennai to Pondicherry</Link> or <Link to="/services/one-way-drop-taxi">one-way drop taxi</Link>.
      </p>
    </AccountLayout>
  );
}
