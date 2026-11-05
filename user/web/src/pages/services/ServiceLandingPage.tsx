import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBooking } from '@/state/Booking';
import { useSeo } from '@/lib/seo';
import { Icon } from '@/components/Icon';
import { ALL_SERVICES, findServiceBySlug } from './servicesData';
import { ALL_ROUTES } from '../routes/routesData';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';

export function ServiceLandingPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const { update } = useBooking();

  const service = findServiceBySlug(serviceId || '');

  useSeo(
    service
      ? {
          title: service.title,
          description: service.metaDescription,
          keywords: service.keywords,
          canonical: `/services/${service.slug}`,
          ogImage: `https://nesamcabs.com${service.image}`,
          breadcrumbs: [
            { name: 'Home', path: '/' },
            { name: 'Services', path: '/#services' },
            { name: service.title.split('|')[0].trim(), path: `/services/${service.slug}` },
          ],
          schema: [
            {
              '@type': 'Service',
              name: service.h1,
              description: service.metaDescription,
              provider: {
                '@type': 'TaxiService',
                name: 'NESAM Cabs',
                telephone: '+919025099990',
                url: 'https://nesamcabs.com/',
              },
            },
            {
              '@type': 'FAQPage',
              mainEntity: service.faqs.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: f.a,
                },
              })),
            },
          ],
        }
      : {
          title: 'Service Not Found · NESAM Cabs',
          description: 'The requested travel service could not be found. Explore our outstation cabs and airport taxi services.',
          noindex: true,
        },
  );

  if (!service) {
    return (
      <div className="page wrap" style={{ padding: '48px 16px', textAlign: 'center' }}>
        <h1>Service Not Found</h1>
        <p className="muted">We couldn’t find the service you were looking for.</p>
        <div style={{ marginTop: '24px' }}>
          <Link to="/book" className="btn btn--primary">
            Back to Booking
          </Link>
        </div>
      </div>
    );
  }

  const handleBookNow = () => {
    update({ tripType: service.tripType });
    navigate('/book');
  };

  const otherServices = ALL_SERVICES.filter((s) => s.id !== service.id);

  return (
    <article className="service-page">
      {/* Breadcrumb Trail */}
      <nav className="wrap" aria-label="Breadcrumb" style={{ padding: '16px 0 8px' }}>
        <ol
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '8px',
            listStyle: 'none',
            fontSize: '0.85rem',
            color: '#64748b',
          }}
        >
          <li>
            <Link to="/" style={{ color: '#64748b', textDecoration: 'none' }}>
              Home
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link to="/#services" style={{ color: '#64748b', textDecoration: 'none' }}>
              Services
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li style={{ color: '#0f172a', fontWeight: 600 }}>{service.h1}</li>
        </ol>
      </nav>

      {/* Hero Header */}
      <header className="band band--dark">
        <div className="wrap" style={{ padding: '36px 0 48px' }}>
          <div style={{ maxWidth: '820px' }}>
            <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', lineHeight: 1.2, marginBottom: '16px', color: '#fff' }}>
              {service.h1}
            </h1>
            <p style={{ fontSize: '1.2rem', color: '#cbd5e1', lineHeight: 1.6, marginBottom: '28px' }}>
              {service.lead}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleBookNow}
                style={{ padding: '14px 28px', fontSize: '1.05rem', fontWeight: 700 }}
              >
                Plan &amp; Book {service.tripType} <Icon name="arrow-right" size={18} />
              </button>
              <a
                href={`tel:${SUPPORT_PHONE}`}
                className="btn"
                style={{
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.3)',
                  color: '#fff',
                  padding: '14px 20px',
                }}
              >
                <Icon name="phone" size={18} /> Call {SUPPORT_PHONE_DISPLAY}
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Key Value Propositions */}
      <section className="band" aria-labelledby="sec-features">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-features">Why Choose NESAM for {service.tripType}</h2>
            </div>
          </header>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '24px',
            }}
          >
            {service.features.map((f) => (
              <div
                key={f.title}
                style={{
                  background: '#f8fafc',
                  padding: '24px',
                  borderRadius: '12px',
                  borderLeft: '4px solid var(--red)',
                }}
              >
                <strong style={{ display: 'block', fontSize: '1.15rem', color: '#0f172a', marginBottom: '8px' }}>
                  {f.title}
                </strong>
                <p style={{ color: '#64748b', fontSize: '0.95rem', lineHeight: 1.5 }}>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed Overview */}
      <section className="band band--paper" aria-labelledby="sec-detailed-overview">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-detailed-overview">How Our {service.tripType} Works</h2>
            </div>
          </header>
          <div style={{ maxWidth: '840px', lineHeight: 1.8, fontSize: '1.05rem', color: '#334155' }}>
            {service.overview.map((para, i) => (
              <p key={i} style={{ marginBottom: '16px' }}>
                {para}
              </p>
            ))}
          </div>

          {/* Pricing Rules */}
          <div style={{ marginTop: '36px', background: '#fff', padding: '28px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '1.3rem', color: '#0f172a', marginBottom: '16px' }}>
              Tariff &amp; Billing Policy
            </h3>
            <ul style={{ listStyle: 'none', padding: 0 }}>
              {service.pricingRules.map((rule) => (
                <li
                  key={rule.title}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <strong style={{ color: '#1e293b' }}>{rule.title}</strong>
                  <span style={{ color: '#64748b' }}>{rule.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Service FAQs (Native details + name="faq") */}
      <section className="band" aria-labelledby="sec-faqs">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-faqs">Frequently Asked Questions</h2>
            </div>
          </header>
          <div style={{ maxWidth: '840px', margin: '0 auto' }}>
            {service.faqs.map((faq) => (
              <details
                key={faq.q}
                name="faq"
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  marginBottom: '12px',
                  padding: '16px 20px',
                }}
              >
                <summary style={{ fontWeight: 600, fontSize: '1.05rem', color: '#0f172a', cursor: 'pointer' }}>
                  {faq.q}
                </summary>
                <p style={{ marginTop: '12px', color: '#475569', lineHeight: 1.6, fontSize: '0.95rem' }}>
                  {faq.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Top Routes for this service */}
      <section className="band band--paper" aria-labelledby="sec-featured-routes">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-featured-routes">Book {service.tripType} on Top Routes</h2>
            </div>
          </header>
          <ul
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '20px',
              listStyle: 'none',
              padding: 0,
            }}
          >
            {ALL_ROUTES.slice(0, 4).map((r) => (
              <li key={r.id}>
                <Link
                  to={`/routes/${r.slug}`}
                  style={{
                    display: 'block',
                    background: '#fff',
                    borderRadius: '10px',
                    padding: '20px',
                    border: '1px solid #e2e8f0',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <strong style={{ display: 'block', color: '#0f172a', fontSize: '1.1rem', marginBottom: '6px' }}>
                    {r.origin} → {r.destination}
                  </strong>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    {r.distanceKm} KM · ~{r.duration}
                  </span>
                  <div style={{ marginTop: '10px', color: 'var(--red)', fontWeight: 600, fontSize: '0.9rem' }}>
                    View Route Details →
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Other Services */}
      <section className="band" aria-labelledby="sec-other-services">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-other-services">Explore More NESAM Cabs Services</h2>
            </div>
          </header>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '20px',
            }}
          >
            {otherServices.map((s) => (
              <Link
                key={s.id}
                to={`/services/${s.slug}`}
                style={{
                  display: 'block',
                  background: '#f8fafc',
                  padding: '20px',
                  borderRadius: '10px',
                  textDecoration: 'none',
                  color: 'inherit',
                  border: '1px solid #e2e8f0',
                }}
              >
                <strong style={{ display: 'block', color: '#0f172a', fontSize: '1.1rem', marginBottom: '8px' }}>
                  {s.h1}
                </strong>
                <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5 }}>{s.lead}</p>
                <span style={{ display: 'inline-block', marginTop: '10px', color: 'var(--red)', fontWeight: 600, fontSize: '0.9rem' }}>
                  Learn more →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </article>
  );
}

