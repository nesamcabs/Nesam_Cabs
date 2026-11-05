import { Link, useNavigate, useParams } from 'react-router-dom';
import { useBooking } from '@/state/Booking';
import { useSeo } from '@/lib/seo';
import { serviceSeo } from '@/seo/pages';
import { Icon } from '@/components/Icon';
import { ALL_SERVICES, findServiceBySlug } from './servicesData';
import { ALL_ROUTES } from '../routes/routesData';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';

export function ServiceLandingPage() {
  const { serviceId } = useParams<{ serviceId: string }>();
  const navigate = useNavigate();
  const { update } = useBooking();

  const service = findServiceBySlug(serviceId || '');

  useSeo(service ? serviceSeo(service) : { title: 'Service not found', noindex: true });

  if (!service) {
    return (
      <div className="page lp-missing">
        <h1>Service Not Found</h1>
        <p className="muted">We couldn’t find the service you were looking for.</p>
        <Link to="/" className="btn btn--primary">
          Back to Booking
        </Link>
      </div>
    );
  }

  const handleBookNow = () => {
    update({ tripType: service.tripType });
    navigate('/book');
  };

  const otherServices = ALL_SERVICES.filter((s) => s.id !== service.id);

  return (
    <article className="service-page lp">
      {/* Breadcrumb Trail */}
      <nav className="wrap lp-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link to="/#services">Services</Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page">{service.h1}</li>
        </ol>
      </nav>

      {/* Hero Header */}
      <header className="lp-hero">
        <div className="lp-hero__inner">
          <h1>{service.h1}</h1>
          <p className="lp-hero__lead">{service.lead}</p>

          <div className="lp-actions">
            <button type="button" className="btn btn--sun btn--lg" onClick={handleBookNow}>
              Plan &amp; Book {service.tripType} <Icon name="arrow-right" size={18} />
            </button>
            <a href={`tel:${SUPPORT_PHONE}`} className="btn btn--ghost-light btn--lg">
              <Icon name="phone" size={18} /> Call {SUPPORT_PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </header>

      {/* Key Value Propositions */}
      <section className="band" aria-labelledby="sec-features">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-features">Why Choose NESAM Cabs for {service.tripType}</h2>
          </header>
          <div className="lp-grid lp-grid--why">
            {service.features.map((f) => (
              <div key={f.title} className="lp-tile">
                <strong>{f.title}</strong>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Detailed Overview */}
      <section className="band band--paper" aria-labelledby="sec-detailed-overview">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-detailed-overview">How Our {service.tripType} Works</h2>
          </header>
          <div className="lp-prose">
            {service.overview.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>

          {/* Pricing Rules */}
          <div className="lp-rules">
            <h3>Tariff &amp; Billing Policy</h3>
            <ul>
              {service.pricingRules.map((rule) => (
                <li key={rule.title}>
                  <strong>{rule.title}</strong>
                  <span>{rule.detail}</span>
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
            <h2 id="sec-faqs">Frequently Asked Questions</h2>
          </header>
          <div className="faq lp-faq">
            {service.faqs.map((faq) => (
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

      {/* Top Routes for this service */}
      <section className="band band--paper" aria-labelledby="sec-featured-routes">
        <div className="wrap">
          <header className="sec-head">
            <h2 id="sec-featured-routes">Book {service.tripType} on Top Routes</h2>
          </header>
          <ul className="lp-grid">
            {ALL_ROUTES.slice(0, 4).map((r) => (
              <li key={r.id}>
                <Link to={`/routes/${r.slug}`} className="lp-link-card">
                  <strong>
                    {r.origin} → {r.destination}
                  </strong>
                  <span>
                    {r.distanceKm} KM · ~{r.duration}
                  </span>
                  <em>
                    View Route Details <Icon name="arrow-right" size={16} />
                  </em>
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
            <h2 id="sec-other-services">Explore More NESAM Cabs Services</h2>
          </header>
          <div className="lp-grid">
            {otherServices.map((s) => (
              <Link key={s.id} to={`/services/${s.slug}`} className="lp-link-card">
                <strong>{s.h1}</strong>
                <span>{s.lead}</span>
                <em>
                  Learn more <Icon name="arrow-right" size={16} />
                </em>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </article>
  );
}
