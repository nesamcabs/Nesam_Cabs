import { useEffect, useState } from 'react';
import { subscribePublicContent, type PublicContent } from '@core/services/catalogService';
import { SUPPORT_PHONE } from '@core/config/constants';
import { formatINR } from '@core/utils/format';

export interface PublicContentProps {
  brand?: string;
}

export function detectBrand(explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  if (typeof document !== 'undefined') {
    const title = document.title.toLowerCase();
    if (title.includes('one way')) return 'One Way Car Rentals';
    if (title.includes('people taxi')) return 'People Taxi';
  }
  return 'NESAM';
}

function SectionHeading({ title, id, eyebrow }: { title: string; id: string; eyebrow?: string }) {
  return (
    <header className="sec-head sec-heading">
      <h2 id={id}>{title}</h2>
    </header>
  );
}

export function ReviewsSection({ brand }: PublicContentProps = {}) {
  const brandName = detectBrand(brand);
  const [reviews, setReviews] = useState<PublicContent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => subscribePublicContent('reviews', (rows) => { setReviews(rows); setError(''); }, setError), []);

  return (
    <section className="band reviews" aria-labelledby="reviews-title">
      <div className="wrap reviews__wrap">
        <header className="sec-head sec-heading">
          <h2 id="reviews-title">Customer reviews</h2>
          <p className="sec-head__text">Real feedback from travellers who journeyed with {brandName}</p>
        </header>

        {error ? <p role="status" className="muted small reviews-error">{error}</p> : null}

        {reviews.length > 0 ? (
          <div className="reviews__grid" aria-label="Published customer reviews">
            {reviews.slice(0, 6).map((r) => (
              <article key={r.id} className="review-card">
                <div className="review-card__head">
                  <div className="review-card__user">
                    <span className="review-card__avatar" aria-hidden="true">
                      {r.name ? r.name.charAt(0).toUpperCase() : '★'}
                    </span>
                    <div>
                      <strong className="review-card__name">{r.name || 'Verified Rider'}</strong>
                      <span className="review-card__tag">Verified trip</span>
                    </div>
                  </div>
                  <div className="review-card__stars" aria-label={`Rating: ${r.rating || 5} out of 5`}>
                    {'★'.repeat(Math.max(1, Math.min(5, Number(r.rating) || 5)))}
                  </div>
                </div>
                <p className="review-card__text">“{r.text}”</p>
                {r.response ? (
                  <div className="review-card__reply">
                    <strong>{brandName}:</strong>
                    <p>{r.response}</p>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="reviews__empty">
            <span className="reviews__mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
              </svg>
            </span>
            <div className="reviews__empty-body">
              <h3>Your journey. Your words.</h3>
              <p>Travelled with {brandName}? We would love to hear about your experience.</p>
              <small>Customer reviews will appear here once published.</small>
            </div>
            <a className="btn btn--primary reviews__cta" href="/support?topic=feedback">
              Share feedback <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

export function CatalogSection({ brand }: PublicContentProps = {}) {
  const brandName = detectBrand(brand);
  const [services, setServices] = useState<PublicContent[]>([]);
  const [packages, setPackages] = useState<PublicContent[]>([]);
  const [places, setPlaces] = useState<PublicContent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const off = [
      subscribePublicContent('services', setServices, setError),
      subscribePublicContent('tour_packages', setPackages, setError),
      subscribePublicContent('locations', setPlaces, setError),
    ];
    return () => off.forEach((f) => f());
  }, []);

  if (!services.length && !packages.length && !places.length && !error) return null;

  const href = (s: PublicContent) =>
    s.onlineBookingEnabled
      ? s.serviceType === 'Airport Taxi'
        ? '/book?service=airport'
        : s.serviceType === 'Local Rental'
          ? '/book?service=rental'
          : ['One Way Taxi', 'Outstation Cab'].includes(s.serviceType ?? '')
            ? '/book?service=outstation'
            : null
      : null;

  return (
    <section className="band catalog-band" aria-labelledby="catalog-title">
      <div className="wrap catalog-wrap">
        <header className="sec-head sec-heading">
          <h2 id="catalog-title">Services, tours &amp; destinations</h2>
        </header>

        {error ? <p role="status" className="muted small">{error}</p> : null}

        {services.length > 0 ? (
          <div className="catalog-group">
            <h3>Our services</h3>
            <ul className="catalog-cards">
              {services.map((s) => (
                <li key={s.id} className="catalog-item">
                  <strong>{s.name}</strong>
                  <p>{s.description}</p>
                  {href(s) ? (
                    <a className="btn btn--secondary btn--sm" href={href(s)!}>
                      Check availability →
                    </a>
                  ) : (
                    <a className="btn btn--secondary btn--sm" href={`tel:${SUPPORT_PHONE}`}>
                      Enquire with {brandName}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {packages.length > 0 ? (
          <div className="catalog-group">
            <h3>Tour packages</h3>
            <ul className="catalog-cards">
              {packages.map((p) => (
                <li key={p.id} className="catalog-item">
                  <strong>{p.name}</strong>
                  <p>{p.description}</p>
                  {p.basePrice != null ? (
                    <p className="catalog-price">Starting from {formatINR(p.basePrice)} · final price confirmed by {brandName}</p>
                  ) : null}
                  <a className="btn btn--secondary btn--sm" href={`tel:${SUPPORT_PHONE}`}>
                    Enquire about this package
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {places.length > 0 ? (
          <div className="catalog-group catalog-places">
            <h3>Destinations we serve</h3>
            <p className="catalog-places-list">
              {places.map((p) => [p.name, p.city, p.state].filter(Boolean).join(', ')).join(' · ')}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
