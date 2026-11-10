// The sections under the booking console: what the site offers and why to trust it.
// Every card either fills the console (so a visitor is one tap from fares) or links somewhere real.
// Layout language: centred headings, pastel cards, a bento of routes, round destination avatars and a fleet carousel.
import { Link } from 'react-router-dom';
import { SCHEDULED_CANCELLATION_FEE, SCHEDULED_FREE_CANCEL_BEFORE_MS, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { formatINR } from '@core/utils/format';
import { Icon } from '@/components/Icon';
import { useBooking } from '@/state/Booking';
import { ASSURANCE, CORRIDORS, DESTINATIONS, FAQS, FEATURES, IMG, MORE_CORRIDORS, SERVICES, STEPS, type Corridor, type Destination, type Service } from './content';
import { findRouteBySlug } from '../routes/routesData';
import { categoryName, categoryPhoto } from '@/lib/categories';

function SectionHead({ eyebrow, title, text, action, id }: { eyebrow: string; title: string; text?: string; action?: React.ReactNode; id?: string }) {
  return (
    <header className="sec-head">
      <h2 id={id}>{title}</h2>
      {action}
    </header>
  );
}

/** A corridor's route guide, at its canonical slug (e.g. /routes/chennai-to-pondicherry). */
const routeHref = (corridorId: string) => `/routes/${findRouteBySlug(corridorId)?.slug ?? corridorId}`;

/** The marketing page for each service, where one exists. */
const SERVICE_PAGE: Record<string, string> = {
  'one-way': 'one-way-drop-taxi',
  'round-trip': 'outstation-round-trip',
  airport: 'airport-taxi',
  'local-rental': 'local-rental',
  pilgrimage: 'pilgrimage-tours',
};

export function TrustStrip() {
  return (
    <section className="band band--strip" aria-label="Why riders choose NESAM Cabs">
      <ul className="wrap strip">
        {FEATURES.map((f) => (
          <li key={f.title} className="strip__item">
            <img src={IMG(f.image)} alt={f.title} width={84} height={84} loading="lazy" />
            <div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ServicesSection({ onPick }: { onPick: (s: Service) => void }) {
  return (
    <section className="band" aria-labelledby="sec-services" id="sec-services-band">
      <div className="wrap">
        <SectionHead
          eyebrow="Ways to travel"
          id="sec-services"
          title="A ride for every kind of journey"
          text="Choose a starting point and we’ll set up your trip. You’ll see the fare for every vehicle before you book."
        />
        <ul className="services" id="services">
          {SERVICES.map((s) => {
            const serviceSlug = SERVICE_PAGE[s.id] ?? null;
            return (
              <li key={s.id} id={s.id} className="svc">
                <button type="button" className="service" onClick={() => onPick(s)}>
                  <span className="service__media">
                    <img src={IMG(s.image)} alt={`NESAM Cabs - ${s.title}`} width={724} height={543} loading="lazy" />
                  </span>
                  <span className="service__body">
                    <strong>{s.title}</strong>
                    <span>{s.text}</span>
                  </span>
                  <span className="service__go" aria-hidden="true">
                    <Icon name="arrow-right" size={20} />
                  </span>
                </button>
                {serviceSlug ? (
                  <Link to={`/services/${serviceSlug}`} className="service__more">
                    Service details &amp; tariff <Icon name="arrow-right" size={14} />
                  </Link>
                ) : null}
              </li>
            );
          })}
          <li className="services__call">
            <a className="service service--call" href={`tel:${SUPPORT_PHONE}`}>
              <span className="service__body">
                <strong>Multi-day tours, weddings, corporate fleets</strong>
                <span>Tell our team what you need and we’ll arrange it.</span>
              </span>
              <span className="service__phone">
                <Icon name="phone" size={22} />
                <span className="num">{SUPPORT_PHONE_DISPLAY}</span>
              </span>
            </a>
          </li>
        </ul>
      </div>
    </section>
  );
}

export function RoutesSection({ onRoute }: { onRoute: (c: Corridor) => void }) {
  return (
    <section className="band band--paper" aria-labelledby="sec-routes">
      <div className="wrap">
        <SectionHead
          eyebrow="Popular routes"
          id="sec-routes"
          title="Favourite drives across the south"
          text="Pick a route to fill in your trip, then choose the day and time. Distances and times are approximate; your exact fare is shown before you book."
        />
        <ul className="routes" id="routes">
          {CORRIDORS.map((c) => (
            <li key={c.id} id={c.id}>
              <button type="button" className="route-card" onClick={() => onRoute(c)} aria-label={`Plan ${c.origin} to ${c.destination}, about ${c.km}`}>
                {c.image ? <img src={IMG(c.image)} alt={`${c.origin} to ${c.destination} outstation drop taxi route`} width={768} height={512} loading="lazy" /> : null}
                <span className="route-card__shade" aria-hidden="true" />
                <span className="route-card__body">
                  <span className="route-card__title">
                    {c.origin}
                    <Icon name="arrow-right" size={22} />
                    {c.destination}
                  </span>
                  <span className="route-card__meta">
                    <span>
                      <Icon name="route" size={16} /> {c.km}
                    </span>
                    <span>
                      <Icon name="clock" size={16} /> ~{c.duration}
                    </span>
                  </span>
                </span>
                <span className="route-card__cta">
                  Plan this trip <Icon name="arrow-right" size={18} />
                </span>
              </button>
              <Link to={routeHref(c.id)} className="route-guide">
                Route guide &amp; tariff <Icon name="arrow-right" size={14} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="more-routes" role="group" aria-label="More routes">
          <span className="more-routes__label">More routes</span>
          {MORE_CORRIDORS.map((c) => (
            <Link key={c.id} to={routeHref(c.id)} className="chip">
              {c.origin} <Icon name="arrow-right" size={15} /> {c.destination}
              <span className="chip__count">{c.km}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function DestinationsSection({ onPick }: { onPick: (d: Destination) => void }) {
  return (
    <section className="band" aria-labelledby="sec-destinations" id="sec-destinations-band">
      <div className="wrap">
        <SectionHead eyebrow="Destinations" id="sec-destinations" title="Where will you go next?" text="Tap a destination to set it as your drop and pick up from there." />
        <ul className="destinations" id="destinations">
          {DESTINATIONS.map((d) => (
            <li key={d.id} id={`destination-${d.id}`}>
              <button type="button" className="destination" onClick={() => onPick(d)}>
                <img src={IMG(d.image)} alt={`${d.name} outstation taxi destination - ${d.tagline}`} width={768} height={512} loading="lazy" />
                <span className="destination__shade" aria-hidden="true" />
                <span className="destination__body">
                  <strong>{d.name}</strong>
                  <small>{d.tagline}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FALLBACK_FLEET = [
  { art: 'hatchback', name: 'Hatchback', text: 'Compact and economical for solo and couple trips.' },
  { art: 'sedan', name: 'Sedan', text: 'Comfortable cruising for small families.' },
  { art: 'premium-sedan', name: 'Premium sedan', text: 'A more refined ride for business and occasions.' },
  { art: 'suv', name: 'SUV', text: 'Extra room and presence for longer drives.' },
  { art: 'mpv', name: 'MPV', text: 'Seven-seat comfort with space for luggage.' },
  { art: 'passenger-van', name: 'Passenger van', text: 'Groups and extended families, together.' },
  { art: 'minibus', name: 'Mini bus', text: 'Weddings, tours and larger gatherings.' },
  { art: 'tourist-coach', name: 'Tourist coach', text: 'Big groups, long itineraries.' },
];

export function FleetSection({ onPick }: { onPick: () => void }) {
  const { categories } = useBooking();
  const live = categories.slice(0, 8);
  return (
    <section className="band band--paper" aria-labelledby="sec-fleet">
      <div className="wrap">
        <SectionHead
          eyebrow="Our fleet"
          id="sec-fleet-title"
          title="The right vehicle for your group"
          text="From a quick drop to a full-group tour. Fares for each vehicle are shown once you enter your trip."
          action={
            <button type="button" className="btn btn--primary" onClick={onPick}>
              Get fares <Icon name="arrow-right" size={18} />
            </button>
          }
        />
      </div>
      <ul className="fleet" id="sec-fleet">
        {live.length
          ? live.map((c) => (
              <li key={c.id} id={`vehicle-${c.id}`} className="vehicle">
                {/* The photo uploaded for this category in the admin panel (NESAM Cabs' own image); the site's art only stands in until one is uploaded. */}
                <img src={categoryPhoto(c)} alt={`NESAM Cabs ${c.name} - ${c.seats} seater cab`} width={320} height={210} loading="lazy" decoding="async" />
                <div className="vehicle__body">
                  <strong>{categoryName(c)}</strong>
                  <span className="vehicle__seats">
                    <Icon name="passengers" size={16} /> {c.seats} seats
                  </span>
                </div>
              </li>
            ))
          : FALLBACK_FLEET.map((v) => (
              <li key={v.art} id={`vehicle-${v.art}`} className="vehicle">
                <img src={`/vehicles/${v.art}.webp`} alt={`NESAM Cabs ${v.name} rental`} width={320} height={210} loading="lazy" />
                <div className="vehicle__body">
                  <strong>{v.name}</strong>
                </div>
              </li>
            ))}
      </ul>
    </section>
  );
}

export function HowSection() {
  return (
    <section className="band band--dark" aria-labelledby="sec-how" id="sec-how-band">
      <div className="wrap how">
        <div className="how__photo">
          <img src={IMG('photography/about-fleet')} alt="NESAM Cabs verified drivers and premium vehicle fleet" width={1448} height={1086} loading="lazy" />
        </div>
        <div className="how__body">
          <h2 id="sec-how">Booked in minutes. Handled with care.</h2>
          <ol className="how__steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="how__num">{i + 1}</span>
                <div className="how__card">
                  <img src={IMG(s.image)} alt={s.title} width={96} height={96} loading="lazy" />
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function AssuranceSection() {
  return (
    <section className="band" aria-labelledby="sec-safe" id="sec-safe-band">
      <div className="wrap assure">
        <div className="assure__collage" aria-hidden="true">
          <img className="assure__a" src={IMG('photography/trust-driver')} alt="Verified commercial driver with NESAM Cabs" width={724} height={543} loading="lazy" />
          <img className="assure__b" src={IMG('photography/trust-interior')} alt="Clean and sanitized AC car interior" width={724} height={543} loading="lazy" />
          <img className="assure__c" src={IMG('photography/trust-support')} alt="NESAM Cabs 24/7 customer care team support" width={724} height={543} loading="lazy" />
        </div>
        <div className="assure__body">
          <h2 id="sec-safe">Built for long journeys and peace of mind</h2>
          <p className="sec-head__text">From the moment your driver is assigned to the receipt in your inbox, every step is visible to you.</p>
          <ul className="assure__list">
            {ASSURANCE.map((a) => (
              <li key={a.title}>
                <span className="assure__icon">
                  <Icon name={a.icon} size={24} />
                </span>
                <div>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Banners() {
  const freeHours = Math.round(SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000);
  return (
    <section className="band band--paper" aria-label="Offers and help">
      <div className="wrap banners">
        <Link className="banner banner--offer" to="/offers" style={{ backgroundImage: `url(${IMG('backgrounds/offer-background')})` }}>
          <strong>Promo codes and festival savings</strong>
          <span>See what’s live and apply a code at checkout.</span>
          <span className="banner__cta">
            View offers <Icon name="arrow-right" size={18} />
          </span>
        </Link>
        <a className="banner banner--call" href={`tel:${SUPPORT_PHONE}`} style={{ backgroundImage: `url(${IMG('backgrounds/app-promotion-background')})` }}>
          <strong>Family trip, pilgrimage or group tour?</strong>
          <span>
            Call us on {SUPPORT_PHONE_DISPLAY}. Cancel free until {freeHours} hour before pickup, then a {formatINR(SCHEDULED_CANCELLATION_FEE)} fee applies.
          </span>
          <span className="banner__cta">
            <Icon name="phone" size={18} /> Call NESAM Cabs
          </span>
        </a>
      </div>
    </section>
  );
}

export function FaqSection() {
  return (
    <section className="band" aria-labelledby="sec-faq" id="sec-faq-band">
      <div className="wrap faq-band">
        <div className="faq-band__intro">
          <h2 id="sec-faq">Questions, answered</h2>
          <p className="sec-head__text">Still unsure about something? Our team is a call away.</p>
          <Link className="btn btn--secondary" to="/support">
            <Icon name="support" size={18} /> Help &amp; support
          </Link>
        </div>
        <div className="faq" id="faq">
          {FAQS.map((f) => (
            <details key={f.q} className="faq__item">
              <summary>
                <span>{f.q}</span>
                <span className="faq__icon">
                  <Icon name="add" size={18} />
                </span>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
