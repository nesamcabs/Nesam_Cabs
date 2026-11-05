import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBooking } from '@/state/Booking';
import { useSeo } from '@/lib/seo';
import { Icon } from '@/components/Icon';
import { ALL_ROUTES, findRouteBySlug } from './routesData';
import { formatINR } from '@core/utils/format';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';

export function RouteLandingPage() {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { update } = useBooking();

  const route = findRouteBySlug(routeId || '');

  useSeo(
    route
      ? {
          title: route.title,
          description: route.metaDescription,
          keywords: route.keywords,
          canonical: `/routes/${route.slug}`,
          ogImage: `https://nesamcabs.com${route.image}`,
          breadcrumbs: [
            { name: 'Home', path: '/' },
            { name: 'Routes', path: '/#routes' },
            { name: `${route.origin} to ${route.destination}`, path: `/routes/${route.slug}` },
          ],
          schema: [
            {
              '@type': 'TouristTrip',
              name: route.h1,
              description: route.metaDescription,
              touristType: 'Outstation & Intercity Travellers',
              itinerary: {
                '@type': 'ItemList',
                itemListElement: route.keyStops.map((s, idx) => ({
                  '@type': 'ListItem',
                  position: idx + 1,
                  name: s.name,
                  description: s.description,
                })),
              },
            },
            {
              '@type': 'FAQPage',
              mainEntity: route.faqs.map((f) => ({
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
          title: 'Route Not Found · NESAM Cabs',
          description: 'The requested route could not be found. Explore our popular outstation routes across Tamil Nadu.',
          noindex: true,
        },
  );

  if (!route) {
    return (
      <div className="page wrap" style={{ padding: '48px 16px', textAlign: 'center' }}>
        <h1>Route Not Found</h1>
        <p className="muted">We couldn’t find the route you were looking for.</p>
        <div style={{ marginTop: '24px' }}>
          <Link to="/book" className="btn btn--primary">
            Back to Booking
          </Link>
        </div>
      </div>
    );
  }

  const handleBookNow = (tripType: 'One Way' | 'Round Trip' = 'One Way') => {
    update({
      pickup: route.pickup,
      drop: route.drop,
      tripType,
    });
    navigate('/book');
  };

  const otherRoutes = ALL_ROUTES.filter((r) => r.id !== route.id).slice(0, 4);

  return (
    <article className="route-page">
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
            <Link to="/#routes" style={{ color: '#64748b', textDecoration: 'none' }}>
              Routes
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li style={{ color: '#0f172a', fontWeight: 600 }}>
            {route.origin} to {route.destination}
          </li>
        </ol>
      </nav>

      {/* Hero Section */}
      <header className="band band--dark" style={{ position: 'relative', overflow: 'hidden' }}>
        <div className="wrap" style={{ position: 'relative', zIndex: 2, padding: '32px 0 48px' }}>
          <div style={{ maxWidth: '820px' }}>
            <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', lineHeight: 1.2, marginBottom: '16px', color: '#fff' }}>
              {route.h1}
            </h1>
            <p style={{ fontSize: '1.15rem', color: '#cbd5e1', lineHeight: 1.6, marginBottom: '24px' }}>
              {route.summary}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', marginBottom: '28px' }}>
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)',
                  padding: '10px 18px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <Icon name="route" size={20} />
                <span>
                  <small style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8' }}>Distance</small>
                  <strong>{route.distanceKm} KM</strong>
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)',
                  padding: '10px 18px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <Icon name="clock" size={20} />
                <span>
                  <small style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8' }}>Driving Time</small>
                  <strong>~{route.duration}</strong>
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  backdropFilter: 'blur(8px)',
                  padding: '10px 18px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                <Icon name="verified" size={20} />
                <span>
                  <small style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8' }}>Return Fare</small>
                  <strong>₹0 (Zero Return)</strong>
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => handleBookNow('One Way')}
                style={{ padding: '14px 28px', fontSize: '1rem', fontWeight: 700 }}
              >
                Book One-Way Drop Taxi <Icon name="arrow-right" size={18} />
              </button>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => handleBookNow('Round Trip')}
                style={{ padding: '14px 24px', fontSize: '1rem' }}
              >
                Book Round Trip Cab
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

      {/* Pricing Comparison Table */}
      <section className="band" aria-labelledby="sec-pricing-rates">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-pricing-rates">Transparent Fare Chart: {route.origin} to {route.destination}</h2>
              <p className="sec-head__text">
                Fares calculated based on official owner-approved Tariff v2 rates. Applicable GST and driver allowance are included upfront; your booking shows the exact GST. Tolls at actuals.
              </p>
            </div>
          </header>

          <div style={{ overflowX: 'auto', margin: '24px 0' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                background: '#fff',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                overflow: 'hidden',
                textAlign: 'left',
              }}
            >
              <thead>
                <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0', color: '#334155' }}>
                  <th style={{ padding: '16px' }}>Vehicle Category</th>
                  <th style={{ padding: '16px' }}>Popular Models</th>
                  <th style={{ padding: '16px' }}>Seating</th>
                  <th style={{ padding: '16px' }}>Rate / KM</th>
                  <th style={{ padding: '16px' }}>Driver Allowance</th>
                  <th style={{ padding: '16px' }}>Est. One-Way Fare*</th>
                  <th style={{ padding: '16px', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {route.estimates.map((est) => (
                  <tr key={est.category} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '16px', fontWeight: 700, color: '#0f172a' }}>{est.category}</td>
                    <td style={{ padding: '16px', color: '#475569' }}>{est.model}</td>
                    <td style={{ padding: '16px', color: '#475569' }}>{est.seats}</td>
                    <td style={{ padding: '16px', color: '#475569' }}>₹{est.perKm} / KM</td>
                    <td style={{ padding: '16px', color: '#475569' }}>₹{est.driverBata}</td>
                    <td style={{ padding: '16px', color: 'var(--red)', fontWeight: 700, fontSize: '1.1rem' }}>
                      {formatINR(est.estimatedOneWay)}
                    </td>
                    <td style={{ padding: '16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn--sm btn--primary"
                        onClick={() => handleBookNow('One Way')}
                      >
                        Book
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: '8px' }}>
            *Estimated fare includes distance charges ({route.distanceKm} km), driver allowance and applicable GST. State permits, tolls, and parking paid at actuals with receipts.
          </p>
        </div>
      </section>

      {/* Route Overview & Highway Details */}
      <section className="band band--paper" aria-labelledby="sec-overview">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-overview">Travelling from {route.origin} to {route.destination}</h2>
            </div>
          </header>
          <div style={{ maxWidth: '840px', lineHeight: 1.8, fontSize: '1.05rem', color: '#334155' }}>
            {route.overview.map((para, i) => (
              <p key={i} style={{ marginBottom: '16px' }}>
                {para}
              </p>
            ))}
          </div>

          {/* Key Stops */}
          <div style={{ marginTop: '40px' }}>
            <h3 style={{ fontSize: '1.4rem', marginBottom: '20px', color: '#0f172a' }}>
              Popular Attractions &amp; Pitstops on this Route
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '20px',
              }}
            >
              {route.keyStops.map((stop) => (
                <div
                  key={stop.name}
                  style={{
                    background: '#fff',
                    borderRadius: '10px',
                    padding: '20px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <strong style={{ display: 'block', fontSize: '1.1rem', color: '#0f172a', marginBottom: '8px' }}>
                    {stop.name}
                  </strong>
                  <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: 1.5 }}>{stop.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose NESAM Strip */}
      <section className="band" aria-labelledby="sec-why-nesam">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-why-nesam">The NESAM Difference on South Indian Highways</h2>
            </div>
          </header>
          <ul
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '24px',
              listStyle: 'none',
              padding: 0,
            }}
          >
            <li style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', borderLeft: '4px solid var(--red)' }}>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '8px', color: '#0f172a' }}>Zero Return Fare</h3>
              <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
                Pay strictly for the distance from {route.origin} to {route.destination}. No return fare surprises.
              </p>
            </li>
            <li style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', borderLeft: '4px solid var(--red)' }}>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '8px', color: '#0f172a' }}>Verified Drivers</h3>
              <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
                Full commercial licenses, highway route experience, and background-verified drivers.
              </p>
            </li>
            <li style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', borderLeft: '4px solid var(--red)' }}>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '8px', color: '#0f172a' }}>Boarding Security Code</h3>
              <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
                Every trip has an exclusive 4-digit boarding code. Your journey only begins once you are safely seated.
              </p>
            </li>
            <li style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', borderLeft: '4px solid var(--red)' }}>
              <h3 style={{ fontSize: '1.15rem', marginBottom: '8px', color: '#0f172a' }}>Pay Driver in Cash or UPI</h3>
              <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
                Zero advance payments required during booking. Pay your driver via Google Pay, PhonePe, or Cash upon arrival.
              </p>
            </li>
          </ul>
        </div>
      </section>

      {/* Route FAQs (Native details + name="faq" as per modern-web-guidance) */}
      <section className="band band--paper" aria-labelledby="sec-route-faqs">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-route-faqs">{route.origin} to {route.destination} Cab FAQs</h2>
            </div>
          </header>
          <div style={{ maxWidth: '840px', margin: '0 auto' }}>
            {route.faqs.map((faq) => (
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

      {/* Other Popular Routes */}
      <section className="band" aria-labelledby="sec-other-routes">
        <div className="wrap">
          <header className="sec-head">
            <div>
              <h2 id="sec-other-routes">Other Popular South India Cabs &amp; Drop Taxi Routes</h2>
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
            {otherRoutes.map((r) => (
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
                    {r.distanceKm} KM · ~{r.duration} · From ₹{r.estimates[0].estimatedOneWay}
                  </span>
                  <div style={{ marginTop: '12px', color: 'var(--red)', fontWeight: 600, fontSize: '0.9rem' }}>
                    View Route &amp; Pricing →
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </article>
  );
}

