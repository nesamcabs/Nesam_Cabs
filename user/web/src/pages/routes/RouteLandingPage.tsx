import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBooking } from '@/state/Booking';
import { useSeo } from '@/lib/seo';
import { routeSeo } from '@/seo/pages';
import { Icon } from '@/components/Icon';
import { ALL_ROUTES, findRouteBySlug } from './routesData';
import { formatINR } from '@core/utils/format';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';

export function RouteLandingPage() {
  const { routeId } = useParams<{ routeId: string }>();
  const navigate = useNavigate();
  const { update } = useBooking();

  const route = findRouteBySlug(routeId || '');

  useSeo(route ? routeSeo(route) : { title: 'Route not found', noindex: true });

  if (!route) {
    return (
      <div className="page lp-missing">
        <h1>Route Not Found</h1>
        <p className="muted">We couldn’t find the route you were looking for.</p>
        <Link to="/" className="btn btn--primary">
          Back to Booking
        </Link>
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
    <article className="route-page lp">
      {/* Breadcrumb Trail */}
      <nav className="wrap lp-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link to="/#routes">Routes</Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page">
            {route.origin} to {route.destination}
          </li>
        </ol>
      </nav>

      {/* Hero Section */}
      <header className="lp-hero">
        <div className="lp-hero__inner">
          <h1>{route.h1}</h1>
          <p className="lp-hero__lead">{route.summary}</p>

          <ul className="lp-facts">
            <li>
              <Icon name="route" size={20} />
              <span>
                <small>Distance</small>
                <strong>{route.distanceKm} KM</strong>
              </span>
            </li>
            <li>
              <Icon name="clock" size={20} />
              <span>
                <small>Driving Time</small>
                <strong>~{route.duration}</strong>
              </span>
            </li>
            <li>
              <Icon name="verified" size={20} />
              <span>
                <small>Return Fare</small>
                <strong>₹0 (Zero Return)</strong>
              </span>
            </li>
          </ul>

          <div className="lp-actions">
            <button type="button" className="btn btn--sun btn--lg" onClick={() => handleBookNow('One Way')}>
              Book One-Way Drop Taxi <Icon name="arrow-right" size={18} />
            </button>
            <button type="button" className="btn btn--ghost-light btn--lg" onClick={() => handleBookNow('Round Trip')}>
              Book Round Trip Cab
            </button>
            <a href={`tel:${SUPPORT_PHONE}`} className="btn btn--ghost-light btn--lg">
              <Icon name="phone" size={18} /> Call {SUPPORT_PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </header>

      {/* Pricing Comparison Table */}
      <section className="band" aria-labelledby="sec-pricing-rates">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-pricing-rates">
              Transparent Fare Chart: {route.origin} to {route.destination}
            </h2>
            <p className="sec-head__text">
              Fares calculated based on official owner-approved Tariff v2 rates. Applicable GST and driver allowance are included upfront; your booking shows the exact GST. Tolls at actuals.
            </p>
          </header>

          <div className="lp-table-wrap">
            <table className="lp-table">
              <thead>
                <tr>
                  <th>Vehicle Category</th>
                  <th>Popular Models</th>
                  <th>Seating</th>
                  <th>Rate / KM</th>
                  <th>Driver Allowance</th>
                  <th>Est. One-Way Fare*</th>
                  <th className="lp-table__end">Action</th>
                </tr>
              </thead>
              <tbody>
                {route.estimates.map((est) => (
                  <tr key={est.category}>
                    <td className="lp-table__cat">{est.category}</td>
                    <td>{est.model}</td>
                    <td>{est.seats}</td>
                    <td>₹{est.perKm} / KM</td>
                    <td>₹{est.driverBata}</td>
                    <td className="lp-table__fare">{formatINR(est.estimatedOneWay)}</td>
                    <td className="lp-table__end">
                      <button type="button" className="btn btn--sm btn--primary" onClick={() => handleBookNow('One Way')}>
                        Book
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted lp-note">
            *Estimated fare includes distance charges ({route.distanceKm} km), driver allowance and applicable GST. State permits, tolls, and parking paid at actuals with receipts.
          </p>
        </div>
      </section>

      {/* Route Overview & Highway Details */}
      <section className="band band--paper" aria-labelledby="sec-overview">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-overview">
              Travelling from {route.origin} to {route.destination}
            </h2>
          </header>
          <div className="lp-prose">
            {route.overview.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

          {/* Key Stops */}
          <div className="lp-stops">
            <h3>Popular Attractions &amp; Pitstops on this Route</h3>
            <div className="lp-grid">
              {route.keyStops.map((stop) => (
                <div key={stop.name} className="lp-tile">
                  <strong>{stop.name}</strong>
                  <p>{stop.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose NESAM Cabs Strip */}
      <section className="band" aria-labelledby="sec-why-nesam-cabs">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-why-nesam-cabs">The NESAM Cabs Difference on South Indian Highways</h2>
          </header>
          <ul className="lp-grid lp-grid--why">
            <li className="lp-tile">
              <h3>Zero Return Fare</h3>
              <p>
                Pay strictly for the distance from {route.origin} to {route.destination}. No return fare surprises.
              </p>
            </li>
            <li className="lp-tile">
              <h3>Verified Drivers</h3>
              <p>Full commercial licenses, highway route experience, and background-verified drivers.</p>
            </li>
            <li className="lp-tile">
              <h3>Boarding Security Code</h3>
              <p>Every trip has an exclusive 4-digit boarding code. Your journey only begins once you are safely seated.</p>
            </li>
            <li className="lp-tile">
              <h3>Pay Driver in Cash or UPI</h3>
              <p>Zero advance payments required during booking. Pay your driver via Google Pay, PhonePe, or Cash upon arrival.</p>
            </li>
          </ul>
        </div>
      </section>

      {/* Route FAQs (Native details + name="faq" as per modern-web-guidance) */}
      <section className="band band--paper" aria-labelledby="sec-route-faqs">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-route-faqs">
              {route.origin} to {route.destination} Cab FAQs
            </h2>
          </header>
          <div className="faq lp-faq">
            {route.faqs.map((faq) => (
              <details key={faq.q} name="faq" className="faq__item">
                <summary>
                  <span>{faq.q}</span>
                  <span className="faq__icon">
                    <Icon name="add" size={18} />
                  </span>
                </summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Other Popular Routes */}
      <section className="band" aria-labelledby="sec-other-routes">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-other-routes">Other Popular South India Cabs &amp; Drop Taxi Routes</h2>
          </header>
          <ul className="lp-grid">
            {otherRoutes.map((r) => (
              <li key={r.id}>
                <Link to={`/routes/${r.slug}`} className="lp-link-card">
                  <strong>
                    {r.origin} → {r.destination}
                  </strong>
                  <span>
                    {r.distanceKm} KM · ~{r.duration} · From ₹{r.estimates[0].estimatedOneWay}
                  </span>
                  <em>
                    View Route &amp; Pricing <Icon name="arrow-right" size={16} />
                  </em>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </article>
  );
}
