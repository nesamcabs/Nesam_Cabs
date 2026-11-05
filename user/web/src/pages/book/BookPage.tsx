import { useCallback, useEffect, useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useCustomerData } from '@/state/CustomerData';
import { useBooking } from '@/state/Booking';
import { useSeo } from '@/lib/seo';
import { useExitGuard } from '@/lib/exitGuard';
import { scrollToBookingForm } from '@/lib/scrollToForm';
import { Icon } from '@/components/Icon';
import { parseService, serviceOfTrip, type ServiceId } from '@/lib/services';
import { BookingForm } from './BookingForm';
import { ChooseStep } from './ChooseStep';
import { ReviewStep } from './ReviewStep';
import {
  AppSection,
  AssuranceSection,
  Banners,
  DestinationsSection,
  FaqSection,
  FleetSection,
  HeroCopy,
  HowSection,
  JourneysSection,
  PopularRoutes,
  ReviewsSection,
  CatalogSection,
  ServicesSection,
  TrustStrip,
  WhySection,
} from './HomeSections';
import type { Corridor, Destination, PopularRoute, Service } from './content';

export type BookStep = 'plan' | 'choose' | 'review';

const OUTSTATION_KEY = 'nesam.outstation.trip';
const readOutstation = (): 'One Way' | 'Round Trip' => {
  try {
    return sessionStorage.getItem(OUTSTATION_KEY) === 'Round Trip' ? 'Round Trip' : 'One Way';
  } catch {
    return 'One Way';
  }
};

/** A ride in progress, or one waiting for a rating, surfaced above the booking form. */
function RideBanner() {
  const { liveRide, unratedTrip } = useCustomerData();
  const trip = liveRide ?? unratedTrip;
  if (!trip) return null;
  const live = !!liveRide;
  return (
    <div className={`ride-banner ${live ? '' : 'ride-banner--soft'}`}>
      <span className="ride-banner__icon" aria-hidden="true">
        <Icon name={live ? 'car' : 'star'} size={18} />
      </span>
      <p>
        <strong>{live ? (trip.status === 'Ongoing' ? 'Trip in progress' : 'Your upcoming booking') : 'How was your trip?'}</strong>
        <span className="truncate">
          {' '}
          · {trip.pickup.name} → {trip.drop.name}
        </span>
      </p>
      <Link className="ride-banner__link" to={`/ride/${trip.id}`}>
        {live ? 'View booking' : 'Rate trip'} <Icon name="arrow-right" size={14} />
      </Link>
    </div>
  );
}

function Home() {
  const { draft, update } = useBooking();
  const [params, setParams] = useSearchParams();
  const rawService = params.get('service');
  const fromUrl = parseService(rawService);
  const tripParam = params.get('trip');
  const service: ServiceId = fromUrl ?? serviceOfTrip(draft.tripType);
  const outstationTrip: 'One Way' | 'Round Trip' = draft.tripType === 'Round Trip' ? 'Round Trip' : draft.tripType === 'One Way' ? 'One Way' : readOutstation();
  const lastOutstation = useRef(outstationTrip);

  // Keep the draft's trip type in step with the chosen service (deep links included).
  useEffect(() => {
    const wanted =
      service === 'airport'
        ? 'Airport Taxi'
        : service === 'rental'
          ? 'Local Rental'
          : service === 'outstation'
            ? tripParam === 'round-trip'
              ? 'Round Trip'
              : tripParam === 'one-way'
                ? 'One Way'
                : draft.tripType === 'One Way' || draft.tripType === 'Round Trip'
                  ? draft.tripType
                  : lastOutstation.current
            : null;
    if (!wanted || wanted === draft.tripType) return;
    update((d) => ({
      tripType: wanted,
      // The rental placeholder destination never carries over to another service.
      drop: d.drop?.id === 'place-local-disposal' && wanted !== 'Local Rental' ? null : d.drop,
      tripEndAt: wanted === 'Round Trip' ? d.tripEndAt : null,
    }));
  }, [service, tripParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const onService = useCallback(
    (s: ServiceId) => {
      setParams({ service: s }, { replace: true });
    },
    [setParams],
  );
  const onOutstationTrip = (t: 'One Way' | 'Round Trip') => {
    lastOutstation.current = t;
    try {
      sessionStorage.setItem(OUTSTATION_KEY, t);
    } catch {
      /* private mode */
    }
    update({ tripType: t, tripEndAt: t === 'Round Trip' ? draft.tripEndAt : null });
    setParams({ service: 'outstation', trip: t === 'Round Trip' ? 'round-trip' : 'one-way' }, { replace: true });
  };

  const scrollToConsole = useCallback(() => scrollToBookingForm(), []);

  useEffect(() => {
    if (rawService || tripParam) {
      const timer = window.setTimeout(() => {
        scrollToConsole();
      }, 60);
      return () => window.clearTimeout(timer);
    }
  }, [rawService, tripParam, scrollToConsole]);

  // Popular routes and the "across the south" journeys fill both ends; the date and time stay the rider's choice.
  const onRoute = (r: Pick<PopularRoute | Corridor, 'pickup' | 'drop'>) => {
    update({ pickup: r.pickup, drop: r.drop, tripType: outstationTrip });
    setParams({ service: 'outstation' }, { replace: true });
    scrollToConsole();
    window.setTimeout(() => document.getElementById('bf-date')?.focus({ preventScroll: true }), 400);
  };

  const onDestination = (d: Destination) => {
    update({ drop: d.place, tripType: outstationTrip });
    setParams({ service: 'outstation' }, { replace: true });
    scrollToConsole();
  };

  const onServiceCard = (s: Service) => {
    if (s.id === 'airport') onService('airport');
    else if (s.id === 'local-rental') onService('rental');
    else if (s.id === 'round-trip') onOutstationTrip('Round Trip');
    else onOutstationTrip('One Way');
    scrollToConsole();
  };

  return (
    <div className="home">
      <div className="wrap home__wrap">
        <RideBanner />
        <div className="home-hero">
          <HeroCopy />
          <BookingForm service={service} onService={onService} outstationTrip={outstationTrip} onOutstationTrip={onOutstationTrip} />
        </div>
        <PopularRoutes onPick={onRoute} />
        <WhySection />
        {/* The photo sections are part of the desktop home; phones keep the compact, form-first home. */}
        <div className="hx">
          <TrustStrip />
          <ServicesSection onPick={onServiceCard} />
          <JourneysSection onRoute={onRoute} />
          <DestinationsSection onPick={onDestination} />
          <FleetSection onPick={scrollToConsole} />
          <HowSection />
          <AssuranceSection />
          <Banners />
        </div>
        <ReviewsSection brand="NESAM" />
        <CatalogSection brand="NESAM" />
        <FaqSection />
        <AppSection />
      </div>
    </div>
  );
}

export function BookPage({ step }: { step: BookStep }) {
  useExitGuard(step === 'plan');
  useSeo(
    step === 'plan'
      ? {
          title: 'NESAM Cabs — Outstation Cabs & One Way Drop Taxi in Tamil Nadu | Upfront Fares',
          description:
            'Book outstation cabs, one-way drop taxis & round trips across Tamil Nadu, Bangalore & Pondicherry. Verified drivers, clean AC cars, upfront fares & 24/7 support.',
          canonical: '/book',
        }
      : step === 'choose'
        ? {
            title: 'Choose your cab · NESAM Cabs',
            description: 'Compare every vehicle category with its fare before you book.',
            canonical: '/book/ride',
            noindex: true,
          }
        : {
            title: 'Review & book · NESAM Cabs',
            description: 'Review your trip, contact details and fare, then submit your booking request.',
            canonical: '/book/confirm',
            noindex: true,
          },
  );
  const { draft } = useBooking();
  const { pickup, drop } = draft;

  if (step !== 'plan' && (!pickup || !drop)) return <Navigate to="/book" replace />;
  if (step === 'review' && !draft.categoryId) return <Navigate to="/book/ride" replace />;

  if (step === 'choose') return <ChooseStep />;
  if (step === 'review') return <ReviewStep />;
  return <Home />;
}
