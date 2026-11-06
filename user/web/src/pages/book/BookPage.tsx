import { serviceSlogan } from '@/lib/serviceSlogan';
import { ReviewsSection, CatalogSection } from '@/components/PublicContentSections';
import { useCallback, useEffect, useRef } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { TripType } from '@core/types';
import { useCustomerData } from '@core/context/CustomerData';
import { useAuth } from '@/state/Auth';
import { useBooking } from '@/state/Booking';
import { useSeo } from '@/lib/seo';
import { useExitGuard } from '@/lib/exitGuard';
import { scrollToBookingForm } from '@/lib/scrollToForm';
import { HOME_SEO } from '@/seo/pages';
import { Icon } from '@/components/Icon';
import { parseService, serviceOfTrip, type ServiceId } from '@/lib/services';
import { BookingForm } from './BookingForm';
import { ChooseStep } from './ChooseStep';
import { ReviewStep } from './ReviewStep';
import {
  AssuranceSection,
  Banners,
  DestinationsSection,
  FaqSection,
  FleetSection,
  HowSection,
  RoutesSection,
  ServicesSection,
  TrustStrip,
} from './HomeSections';
import { type Corridor, type Destination, type Service } from './content';

export type BookStep = 'plan' | 'choose' | 'review';

const OUTSTATION_KEY = 'nesam.outstation.trip';
const readOutstation = (): 'One Way' | 'Round Trip' => {
  try {
    return sessionStorage.getItem(OUTSTATION_KEY) === 'Round Trip' ? 'Round Trip' : 'One Way';
  } catch {
    return 'One Way';
  }
};
const writeOutstation = (t: 'One Way' | 'Round Trip') => {
  try {
    sessionStorage.setItem(OUTSTATION_KEY, t);
  } catch {
    // ignore
  }
};

function HeroCopy({ service, trip }: { service: ServiceId; trip: 'One Way' | 'Round Trip' }) {
  const [headline, subtitle] = serviceSlogan(service, trip);
  // While the logo shows in the hero the header leaves its own logo out; once the page scrolls past it, the header takes over.
  const logo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logo.current;
    const root = document.documentElement;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) root.dataset.heroLogo = entry.isIntersecting ? 'in' : 'out';
    }, { rootMargin: '-72px 0px 0px 0px' });
    io.observe(el);
    return () => {
      io.disconnect();
      delete root.dataset.heroLogo;
    };
  }, []);

  return (
    <div className="hero-copy">
      <div className="hero-logo" ref={logo}>
        <img src="/nesam/logo.webp" alt="NESAM Cabs" width={224} height={52} />
      </div>
      <h1 aria-live="polite" style={{ textTransform: 'none' }}>
        {headline} <span className="hero-accent">{subtitle}</span>
      </h1>
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

function Home() {
  const { draft, update } = useBooking();
  const [params, setParams] = useSearchParams();
  const rawService = params.get('service');
  const tripParam = params.get('trip');
  const navigate = useNavigate();

  // Local Rentals open as a full-screen map with a sheet from the bottom, not as the inline form.
  useEffect(() => {
    const s = parseService(rawService);
    if (s === 'rental' || s === 'pickup') navigate(`/local-rentals?mode=${s === 'pickup' ? 'pickup' : 'hourly'}`, { replace: true });
  }, [rawService, navigate]);

  // Parse service, mapping legacy 'one-way' / 'round-trip' to 'outstation'
  const service: ServiceId = parseService(rawService) ?? serviceOfTrip(draft.tripType);

  // Determine outstation trip ('One Way' | 'Round Trip')
  const outstationTrip: 'One Way' | 'Round Trip' =
    tripParam === 'round-trip' || rawService === 'round-trip'
      ? 'Round Trip'
      : tripParam === 'one-way' || rawService === 'one-way'
        ? 'One Way'
        : draft.tripType === 'Round Trip'
          ? 'Round Trip'
          : readOutstation();

  useEffect(() => {
    if (service === 'multicity') return;
    const wanted: TripType =
      service === 'airport'
        ? 'Airport Taxi'
        : service === 'local' || service === 'pickup'
          ? 'One Way'
          : service === 'rental'
          ? 'Local Rental'
          : outstationTrip === 'Round Trip'
            ? 'Round Trip'
            : 'One Way';
    if (wanted === draft.tripType) return;
    update((d) => ({
      tripType: wanted,
      drop: d.drop?.id === 'place-local-disposal' && wanted !== 'Local Rental' ? null : d.drop,
      tripEndAt: wanted === 'Round Trip' ? d.tripEndAt : null,
    }));
  }, [service, outstationTrip]); // eslint-disable-line react-hooks/exhaustive-deps

  const onService = useCallback(
    (s: ServiceId) => {
      if (s === 'rental' || s === 'pickup') {
        navigate(`/local-rentals?mode=${s === 'pickup' ? 'pickup' : 'hourly'}`);
        return;
      }
      if (s === 'outstation') {
        setParams({ service: 'outstation', trip: outstationTrip === 'Round Trip' ? 'round-trip' : 'one-way' }, { replace: true });
      } else {
        setParams({ service: s }, { replace: true });
      }
    },
    [setParams, outstationTrip, navigate],
  );

  const onOutstationTrip = useCallback(
    (t: 'One Way' | 'Round Trip') => {
      writeOutstation(t);
      update((d) => ({
        tripType: t,
        tripEndAt: t === 'Round Trip' ? d.tripEndAt : null,
      }));
      setParams({ service: 'outstation', trip: t === 'Round Trip' ? 'round-trip' : 'one-way' }, { replace: true });
    },
    [setParams, update],
  );

  const scrollToConsole = useCallback(() => scrollToBookingForm(), []);

  // When a service or outstation trip type is selected via URL query params, sync preference and scroll up to the console
  useEffect(() => {
    if (tripParam === 'round-trip' || rawService === 'round-trip') {
      writeOutstation('Round Trip');
    } else if (tripParam === 'one-way' || rawService === 'one-way') {
      writeOutstation('One Way');
    }
    if (rawService || tripParam) {
      scrollToConsole();
      const timer = window.setTimeout(() => {
        scrollToConsole();
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [rawService, tripParam, scrollToConsole]);

  const onRoute = (c: Corridor) => {
    update({ pickup: c.pickup, drop: c.drop, tripType: 'One Way' });
    writeOutstation('One Way');
    setParams({ service: 'outstation', trip: 'one-way' }, { replace: true });
    scrollToConsole();
    window.setTimeout(() => document.getElementById('bf-date')?.focus({ preventScroll: true }), 400);
  };

  const onDestination = (d: Destination) => {
    update({ drop: d.place, tripType: 'One Way' });
    writeOutstation('One Way');
    setParams({ service: 'outstation', trip: 'one-way' }, { replace: true });
    scrollToConsole();
  };

  const onServiceCard = (s: Service) => {
    if (s.id === 'airport') onService('airport');
    else if (s.id === 'local-rental') onService('rental');
    else if (s.id === 'round-trip') onOutstationTrip('Round Trip');
    else if (s.id === 'multicity') onService('multicity');
    else onOutstationTrip('One Way');
    scrollToConsole();
  };

  return (
    <div className="home">
      <div className="wrap home__wrap">
        <div className="home-hero">
          <HeroCopy service={service} trip={outstationTrip} />
          <BookingForm
            service={service}
            onService={onService}
            outstationTrip={outstationTrip}
            onOutstationTrip={onOutstationTrip}
          />
        </div>
      </div>

      <div className="hero-after">
        <TrustStrip />
        <ServicesSection onPick={onServiceCard} />
        <RoutesSection onRoute={onRoute} />
        <DestinationsSection onPick={onDestination} />
        <FleetSection onPick={scrollToConsole} />
        <HowSection />
        <AssuranceSection />
        <Banners />
        <ReviewsSection brand="NESAM Cabs" />
        <CatalogSection brand="NESAM Cabs" />
        <FaqSection />
      </div>
    </div>
  );
}

export function BookPage({ step }: { step: BookStep }) {
  useExitGuard(step === 'plan');
  useSeo(
    step === 'plan'
      ? HOME_SEO
      : step === 'choose'
        ? {
            title: 'Choose Vehicle & Upfront Fares · NESAM Cabs',
            description: 'Compare every vehicle category with its upfront fare before you book.',
            canonical: '/book/ride',
            noindex: true,
          }
        : {
            title: 'Review and Confirm Booking · NESAM Cabs',
            description: 'Review your trip itinerary, passenger details and transparent fare before submission.',
            canonical: '/book/confirm',
            noindex: true,
          },
  );

  const { draft } = useBooking();
  const { state: auth } = useAuth();
  const { pickup, drop } = draft;

  if (step !== 'plan' && (!pickup || !drop)) return <Navigate to="/book" replace />;
  // Fares need a signed-in account: a guest on a later step goes back to the form (draft intact),
  // where "Search Cabs" asks them to sign in and then resumes vehicle selection.
  if (step !== 'plan' && auth.status !== 'ready') return <Navigate to="/book" replace />;
  if (step === 'review' && !draft.categoryId) return <Navigate to="/book/ride" replace />;

  if (step === 'choose') return <ChooseStep />;
  if (step === 'review') return <ReviewStep />;
  return <Home />;
}
export default BookPage;
