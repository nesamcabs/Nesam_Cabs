// The home page below (and beside) the booking form: popular routes, the photo sections (services,
// journeys, destinations, fleet, how it works, safety, offers), reviews, FAQ and the app. Nothing here
// is a price, a rating or a review: fares come from the booking server and reviews are shown only
// once NESAM publishes real ones (none are published yet).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { SCHEDULED_CANCELLATION_FEE, SCHEDULED_FREE_CANCEL_BEFORE_MS, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { formatINR } from '@core/utils/format';
import { Icon } from '@/components/Icon';
import { useBooking } from '@/state/Booking';
import { vehicleArtUrl } from '@/lib/vehicleArt';
import {
  ASSURANCE,
  CORRIDORS,
  DESTINATIONS,
  FEATURES,
  IMG,
  MORE_CORRIDORS,
  POPULAR_ROUTES,
  SERVICES,
  STEPS,
  type Corridor,
  type Destination,
  type PopularRoute,
  type Service,
} from './content';
import { categoryName } from '@/lib/categories';

export function HeroCopy() {
  // While the logo shows in the hero the header leaves its own out and puts "Book a cab" first; once the
  // page scrolls past it, the logo slides into the header and the button moves to the right.
  const logo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logo.current;
    const root = document.documentElement;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) root.dataset.heroLogo = entry.isIntersecting ? 'in' : 'out';
    }, { rootMargin: '-80px 0px 0px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      delete root.dataset.heroLogo;
    };
  }, []);

  return (
    <div className="hero-copy">
      <div className="hero-logo" ref={logo}>
        <img src="/nesam/logo.webp" alt="NESAM Cabs" width={300} height={96} />
      </div>
      <h1>
        Dependable cabs, <span className="hero-accent">for every journey.</span>
      </h1>
      {/* Wide screens only: one line of what NESAM does, then three plain commitments. Hidden on phones, where the form comes first. */}
      <p className="hero-lead">Outstation, airport and local rental cabs. See the fare before you book, and travel with a professional driver.</p>
      <ul className="hero-points">
        <li>Fare shown before you book</li>
        <li>Professional drivers</li>
        <li>24/7 booking support</li>
      </ul>
      {/* Decoration for tablets and wider: a route that runs around the booking card, pickup to drop. */}
      <svg className="hero-route" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path className="hero-route__line" d="M640 120 C 800 60, 960 110, 968 330 S 975 800, 930 940 S 800 962, 600 955 S 250 975, 40 955" />
        <path className="hero-route__comet" pathLength="100" d="M640 120 C 800 60, 960 110, 968 330 S 975 800, 930 940 S 800 962, 600 955 S 250 975, 40 955" />
      </svg>
      <span className="hero-pin hero-pin--a" aria-hidden="true" />
      <span className="hero-pin hero-pin--b" aria-hidden="true" />
    </div>
  );
}

function SectionHeading({ eyebrow, title, id, children }: { eyebrow?: string; title: string; id: string; children?: React.ReactNode }) {
  return (
    <div className="sec-heading">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}

export function PopularRoutes({ onPick }: { onPick: (r: PopularRoute) => void }) {
  const [all, setAll] = useState(false);
  return (
    <section className={`routes ${all ? 'routes--all' : ''}`} aria-labelledby="routes-title">
      <div className="routes__head">
        <div>
          <h2 id="routes-title" className="display-h">
            Popular routes
          </h2>
          <p>A few favourites from Chennai.</p>
        </div>
        <button type="button" className="routes__toggle" aria-expanded={all} aria-controls="routes-grid" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : 'View all routes'} <Icon name={all ? 'chevron-up' : 'arrow-right'} size={14} />
        </button>
      </div>
      <ul className="routes__grid" id="routes-grid">
        {POPULAR_ROUTES.map((r) => (
          <li key={r.id}>
            <button type="button" className="route-card" onClick={() => onPick(r)} aria-label={`Plan a trip from ${r.from} to ${r.to}`}>
              <span className="route-card__art">
                <img src={r.art} alt="" width={900} height={450} loading="lazy" />
              </span>
              <span className="route-card__body">
                <span className="route-card__name">
                  <span>{r.from}</span>
                  <Icon name="arrow-right" size={14} />
                  <strong>{r.to}</strong>
                </span>
                <span className="route-card__cta">
                  Plan trip <Icon name="arrow-right" size={12} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The phone home's short "why NESAM" list; on desktop the photo trust strip below takes its place. */
export function WhySection() {
  const items = [
    { icon: 'receipt', title: 'Clear fares', text: 'Know your inclusions, applicable GST and extra rates before you book.' },
    { icon: 'location-pin', title: 'Doorstep pickup', text: 'Choose the pickup address that works for your journey.' },
    { icon: 'support', title: 'Trip support', text: 'A direct line to NESAM for booking and journey assistance.' },
  ];
  return (
    <section className="why" aria-labelledby="why-title">
      <div className="why__intro">
        <h2 id="why-title" className="display-h">
          Travel with clarity.
        </h2>
      </div>
      <ul className="why__list">
        {items.map((i) => (
          <li key={i.title}>
            <Icon name={i.icon} size={20} />
            <h3>{i.title}</h3>
            <p>{i.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Photo sections (desktop) ────────────────────────────────────────────────
// Every card fills the booking form (so a visitor is one tap from fares) or links somewhere real.

function SectionHead({ eyebrow, title, text, id, action }: { eyebrow: string; title: string; text?: string; id: string; action?: React.ReactNode }) {
  return (
    <header className="hx-head">
      <div className="sec-heading">
        <h2 id={id}>{title}</h2>
      </div>
      {action ? <div className="hx-head__action">{action}</div> : null}
    </header>
  );
}

export function TrustStrip() {
  return (
    <section className="hx-strip" aria-label="Why travellers choose NESAM">
      <ul>
        {FEATURES.map((f) => (
          <li key={f.title}>
            <img src={IMG(f.image)} alt="" width={84} height={84} loading="lazy" />
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
    <section className="hx-sec" aria-labelledby="hx-services">
      <SectionHead
        eyebrow="Ways to travel"
        id="hx-services"
        title="A ride for every kind of journey"
        text="Choose a starting point and we’ll set up your trip. You’ll see the fare for every car before you book."
      />
      <ul className="hx-services">
        {SERVICES.map((s) => (
          <li key={s.id}>
            <button type="button" className="hx-service" onClick={() => onPick(s)}>
              <span className="hx-service__media">
                <img src={IMG(s.image)} alt="" width={724} height={543} loading="lazy" />
              </span>
              <span className="hx-service__body">
                <strong>{s.title}</strong>
                <span>{s.text}</span>
              </span>
              <span className="hx-service__go" aria-hidden="true">
                <Icon name="arrow-right" size={18} />
              </span>
            </button>
          </li>
        ))}
        <li>
          <a className="hx-service hx-service--call" href={`tel:${SUPPORT_PHONE}`}>
            <span className="hx-service__body">
              <strong>Multi-day tours, weddings, corporate fleets</strong>
              <span>Tell our team what you need and we’ll arrange it.</span>
            </span>
            <span className="hx-service__phone">
              <Icon name="phone" size={20} />
              <span className="num">{SUPPORT_PHONE_DISPLAY}</span>
            </span>
          </a>
        </li>
      </ul>
    </section>
  );
}

export function JourneysSection({ onRoute }: { onRoute: (c: Corridor) => void }) {
  return (
    <section className="hx-sec" aria-labelledby="hx-journeys">
      <SectionHead
        eyebrow="Across the south"
        id="hx-journeys"
        title="Favourite drives across the south"
        text="Pick a route to fill in your trip, then choose the day and time. Distances and times are approximate; your exact fare is shown before you book."
      />
      <ul className="hx-photos hx-photos--routes">
        {CORRIDORS.map((c) => (
          <li key={c.id}>
            <button type="button" className="hx-photo" onClick={() => onRoute(c)} aria-label={`Plan ${c.origin} to ${c.destination}, about ${c.km}`}>
              {c.image ? <img src={IMG(c.image)} alt="" width={768} height={512} loading="lazy" /> : null}
              <span className="hx-photo__shade" aria-hidden="true" />
              <span className="hx-photo__body">
                <span className="hx-photo__title">
                  {c.origin}
                  <Icon name="arrow-right" size={18} />
                  {c.destination}
                </span>
                <span className="hx-photo__meta">
                  <span>
                    <Icon name="route" size={15} /> {c.km}
                  </span>
                  <span>
                    <Icon name="clock" size={15} /> ~{c.duration}
                  </span>
                </span>
              </span>
              <span className="hx-photo__cta">
                Plan this trip <Icon name="arrow-right" size={14} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="hx-more" role="group" aria-label="More routes">
        {MORE_CORRIDORS.map((c) => (
          <button key={c.id} type="button" className="chip" onClick={() => onRoute(c)}>
            {c.origin} <Icon name="arrow-right" size={14} /> {c.destination} <span className="hx-more__km">{c.km}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function DestinationsSection({ onPick }: { onPick: (d: Destination) => void }) {
  return (
    <section className="hx-sec" aria-labelledby="hx-destinations">
      <SectionHead eyebrow="Destinations" id="hx-destinations" title="Where will you go next?" text="Tap a destination to set it as your drop, then add your pickup." />
      <ul className="hx-photos hx-photos--dest">
        {DESTINATIONS.map((d) => (
          <li key={d.id}>
            <button type="button" className="hx-photo hx-photo--dest" onClick={() => onPick(d)} aria-label={`Set ${d.name} as your destination`}>
              <img src={IMG(d.image)} alt="" width={768} height={512} loading="lazy" />
              <span className="hx-photo__shade" aria-hidden="true" />
              <span className="hx-photo__body">
                <strong>{d.name}</strong>
                <small>{d.tagline}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
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
    <section className="hx-sec" aria-labelledby="hx-fleet">
      <SectionHead
        eyebrow="Our fleet"
        id="hx-fleet"
        title="The right car for your group"
        text="From a quick drop to a full-group tour. Fares for each car are shown once you enter your trip."
        action={
          <button type="button" className="btn btn--primary" onClick={onPick}>
            Get fares <Icon name="arrow-right" size={16} />
          </button>
        }
      />
      <ul className="hx-fleet">
        {live.length
          ? live.map((c) => (
              <li key={c.id} className="hx-vehicle">
                <img src={vehicleArtUrl(c)} alt={`NESAM ${c.name}, ${c.seats} seats`} width={320} height={210} loading="lazy" />
                <div className="hx-vehicle__body">
                  <strong>{categoryName(c)}</strong>
                  <span className="hx-vehicle__seats">
                    <Icon name="passengers" size={15} /> {c.seats} seats
                  </span>
                </div>
              </li>
            ))
          : FALLBACK_FLEET.map((v) => (
              <li key={v.art} className="hx-vehicle">
                <img src={`/vehicles/${v.art}.webp`} alt={`NESAM ${v.name}`} width={320} height={210} loading="lazy" />
                <div className="hx-vehicle__body">
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
    <section className="hx-how" aria-labelledby="hx-how">
      <div className="hx-how__body">
        <h2 id="hx-how">Booked in minutes. Handled with care.</h2>
        <ol className="hx-how__steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="hx-how__num num">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
              <img src={IMG(s.image)} alt="" width={96} height={96} loading="lazy" />
            </li>
          ))}
        </ol>
      </div>
      <div className="hx-how__photo">
        <img src={IMG('photography/about-fleet')} alt="NESAM drivers and fleet" width={1448} height={1086} loading="lazy" />
      </div>
    </section>
  );
}

export function AssuranceSection() {
  return (
    <section className="hx-sec hx-assure" aria-labelledby="hx-safe">
      <div className="hx-assure__collage" aria-hidden="true">
        <img className="hx-assure__a" src={IMG('photography/trust-driver')} alt="" width={724} height={543} loading="lazy" />
        <img src={IMG('photography/trust-interior')} alt="" width={724} height={543} loading="lazy" />
        <img src={IMG('photography/trust-support')} alt="" width={724} height={543} loading="lazy" />
      </div>
      <div className="hx-assure__body">
        <div className="sec-heading">
          <h2 id="hx-safe">Built for long journeys and peace of mind</h2>
          <p className="hx-head__text">From the moment your driver is assigned to the receipt for your trip, every step is visible to you.</p>
        </div>
        <ul className="hx-assure__list">
          {ASSURANCE.map((a) => (
            <li key={a.title}>
              <span className="hx-assure__icon">
                <Icon name={a.icon} size={20} />
              </span>
              <div>
                <h3>{a.title}</h3>
                <p>{a.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Banners() {
  const freeHours = Math.round(SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000);
  return (
    <section className="hx-sec hx-banners" aria-label="Offers and help">
      <Link className="hx-banner" to="/offers" style={{ backgroundImage: `url(${IMG('backgrounds/offer-background')})` }}>
        <strong>Promo codes and festival savings</strong>
        <span>See what’s live and apply a code when you review your booking.</span>
        <span className="hx-banner__cta">
          View offers <Icon name="arrow-right" size={16} />
        </span>
      </Link>
      <a className="hx-banner" href={`tel:${SUPPORT_PHONE}`} style={{ backgroundImage: `url(${IMG('backgrounds/app-promotion-background')})` }}>
        <strong>Corporate, family or group travel?</strong>
        <span>
          Call us on {SUPPORT_PHONE_DISPLAY}. Cancel free until {freeHours} hour{freeHours === 1 ? '' : 's'} before pickup, then a {formatINR(SCHEDULED_CANCELLATION_FEE)} fee applies.
        </span>
        <span className="hx-banner__cta">
          <Icon name="phone" size={16} /> Call us
        </span>
      </a>
    </section>
  );
}



/** Live customer-facing masters; packages/custom services remain enquiries, never fabricated online bookings. */


export function FaqSection() {
  const freeHours = Math.round(SCHEDULED_FREE_CANCEL_BEFORE_MS / 3600000);
  const faqs = [
    {
      q: 'What does my fare include?',
      a: 'Each car shows its total fare before you book, with the fare breakup — base fare, driver allowance where it applies and GST — and what the fare includes. NESAM’s booking server confirms the final amount when you submit.',
    },
    { q: 'Are toll, parking and state tax included?', a: 'No. Tolls, parking and state permits paid by the driver during the trip are added to your final receipt at actual cost, against receipts.' },
    { q: 'Can I book now and pay later?', a: 'Yes. Nothing is charged when you book. You pay your driver in cash or by UPI at the end of the trip.' },
    {
      q: 'When will I get my driver details?',
      a: 'NESAM first reviews your booking request. Once a driver is assigned, their name, phone number and vehicle number appear in My Bookings, before your pickup.',
    },
    { q: 'What is the boarding code?', a: 'A 4-digit code shown on your booking. Share it with your driver only once you are in the car; the trip cannot start without it.' },
    { q: 'How far ahead can I book?', a: 'Every booking is made in advance: choose your pickup date and time, then choose your cab. The booking form shows the earliest and latest pickup times you can choose.' },
    {
      q: 'How do cancellations and refunds work?',
      a: `Cancel from My Bookings. Cancelling more than ${freeHours} hour${freeHours === 1 ? '' : 's'} before pickup is free; after that a ${formatINR(SCHEDULED_CANCELLATION_FEE)} fee applies. The screen shows any fee before you confirm, and any refund is recorded under Payments.`,
    },
  ];
  return (
    <section className="faq" id="faq" aria-labelledby="faq-title">
      <div className="faq__intro">
        <h2 id="faq-title" className="display-h display-h--lg">
          A little help, before you go.
        </h2>
        <p>The details that make planning easier.</p>
        <a className="inline-link" href={`tel:${SUPPORT_PHONE}`}>
          Talk to NESAM <Icon name="arrow-up-right" size={13} />
        </a>
      </div>
      <div className="faq__list">
        {faqs.map((f, i) => (
          <details key={f.q} className="faq__item" name="home-faq" open={i === 0}>
            <summary>
              <span>{f.q}</span>
              <Icon name="plus" size={16} className="faq__plus" />
            </summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function AppSection() {
  return (
    <section className="get-app" aria-labelledby="app-title">
      <div className="get-app__copy">
        <h2 id="app-title" className="display-h">
          Every trip. One place.
        </h2>
        <p>Your bookings, driver details and trip updates, together.</p>
      </div>
      <div className="get-app__stores">
        <div className="store">
          <small>For Android</small>
          <strong>Google Play</strong>
          <span>Coming soon</span>
        </div>
        <div className="store">
          <small>For iPhone</small>
          <strong>App Store</strong>
          <span>Coming soon</span>
        </div>
      </div>
    </section>
  );
}

export { ReviewsSection, CatalogSection } from '../../components/PublicContentSections';
