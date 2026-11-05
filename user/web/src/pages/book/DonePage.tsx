// Confirmation page after a booking request is saved.
// Shows the journey art, a printable ticket card with trip id, route, schedule and live status.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCustomerData } from '@/state/customer';
import { formatDate, formatTime } from '@core/utils/format';
import { Button, PageLoader } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useBooking } from '@/state/Booking';
import type { TripRecord, TripType } from '@core/types';
import { BookingConfirmedOverlay } from '@/components/BookingConfirmedOverlay';
import './done.css';

const BRAND_LOGO = { src: '/nesam/logo.webp', alt: 'NESAM Cabs' };

function JourneyArt({ done }: { done: boolean }) {
  return (
    <div className={`journey-art ${done ? 'is-done' : ''}`} aria-hidden="true">
      <div className="journey-art__track">
        <span className="journey-art__start" />
        <span className="journey-art__line" />
        <span className="journey-art__car">
          <Icon name="car" size={26} />
        </span>
      </div>
      <div className="journey-art__badge">
        <Icon name={done ? 'check' : 'clock'} size={28} />
      </div>
    </div>
  );
}

const tripTypeLabel = (t: TripType): string => {
  if (t === 'One Way') return 'One Way Drop';
  if (t === 'Round Trip') return 'Round Trip';
  if (t === 'Local Rental') return 'Local Rental';
  return 'Airport Taxi';
};

const headline = (t: TripRecord): { title: string; text: string; tone: 'pending' | 'ok' | 'bad' } => {
  if (t.status === 'Cancelled' || t.status === 'Rejected') {
    return {
      title: 'Booking request cancelled',
      text: t.cancelReason || 'This booking has been cancelled.',
      tone: 'bad',
    };
  }
  if (t.status === 'Approved' || t.status === 'Assigned') {
    return {
      title: 'Your ride is confirmed',
      text: 'Our driver will arrive at your pickup location on time.',
      tone: 'ok',
    };
  }
  return {
    title: 'Booking confirmed',
    text: 'Your booking is confirmed. We will share the driver details before pickup.',
    tone: 'pending',
  };
};

const bookingRef = (t: TripRecord) => t.bookingId || `#${t.id.slice(-6).toUpperCase()}`;

export function DonePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { trips } = useCustomerData();
  const trip = trips.find((t) => t.id === id);
  const { reset } = useBooking();
  const [booked, setBooked] = useState(() => (location.state as { confirmed?: boolean } | null)?.confirmed === true);

  // The flag is consumed: reloading or coming back to this page never shows the celebration again. Arriving straight
  // from "Confirm booking", the draft has done its job and is cleared here.
  useEffect(() => {
    if (booked) {
      reset();
      navigate(location.pathname, { replace: true, state: null });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!trip) return <PageLoader label="Loading your booking details…" />;

  const h = headline(trip);
  const at = trip.scheduledAt;

  return (
    <div className="flow-page flow-page--done">
      <div className="wrap flow-page__wrap">
        <div className="dn">
          <section className={`dn-hero dn-hero--${h.tone}`}>
            <i className="dn-hero__spark" aria-hidden="true" />
            <i className="dn-hero__spark" aria-hidden="true" />
            <i className="dn-hero__spark" aria-hidden="true" />
            <i className="dn-hero__spark" aria-hidden="true" />
            {h.tone !== 'bad' ? (
              <div className="dn-scene" aria-hidden="true">
                <span className="dn-scene__stop" />
                <span className="dn-scene__road" />
                <span className="dn-scene__trail" />
            <svg className="dn-scene__car" viewBox="0 0 120 52" focusable="false">
              <path className="body" d="M6 36c0-4 2-6 6-7l14-3 14-14c2-2 4-3 7-3h26c4 0 7 1 9 4l11 13 12 3c4 1 6 3 6 7v4c0 2-2 4-4 4h-8a11 11 0 0 0-22 0H46a11 11 0 0 0-22 0H10c-2 0-4-2-4-4Z" />
              <path className="glass" d="M40 26l9-10c1-1 2-2 4-2h22c2 0 3 1 4 2l8 10Z" />
              <rect className="lamp" x="108" y="30" width="7" height="5" rx="2" />
              <circle className="tyre" cx="35" cy="42" r="8.5" />
              <circle className="tyre" cx="95" cy="42" r="8.5" />
              <circle className="hub" cx="35" cy="42" r="3" />
              <circle className="hub" cx="95" cy="42" r="3" />
            </svg>
                <span className="dn-scene__pin" />
              </div>
            ) : null}
            <h1>{h.title}</h1>
            <p className="dn-hero__text">{h.text}</p>
            <p className="dn-hero__saved">
              <Icon name="shield-check" size={14} /> Your trip is saved in My Bookings
            </p>
          </section>

          <section className="dn-ticket" aria-label="Trip summary">
            <header className="dn-ticket__head">
              <span className="dn-ticket__brand">NESAM CABS</span>
              <span className="dn-ticket__id">
                <small>Booking ID</small>
                <strong className="num">{bookingRef(trip)}</strong>
              </span>
            </header>
            <ol className="dn-trip">
              <li>
                <small>Pickup</small>
                <strong>{trip.pickup.name}</strong>
              </li>
              <li>
                <small>Drop</small>
                <strong>{trip.drop.id === 'place-local-disposal' ? 'Within the city' : trip.drop.name}</strong>
              </li>
            </ol>
            <div className="dn-facts">
              <div className="dn-fact">
                <Icon name="calendar" size={18} />
                <span>
                  <small>Pickup date</small>
                  <strong>{at ? formatDate(at) : '—'}</strong>
                </span>
              </div>
              <div className="dn-fact">
                <Icon name="clock" size={18} />
                <span>
                  <small>Pickup time</small>
                  <strong>{at ? formatTime(at) : '—'}</strong>
                </span>
              </div>
              <div className="dn-fact dn-fact--wide">
                <Icon name="car" size={18} />
                <span>
                  <strong>{trip.categoryName}</strong>
                  <small>
                    {tripTypeLabel(trip.tripType)} · {trip.paymentMethod === 'UPI' ? 'Pay driver by UPI' : 'Pay driver in cash'}
                  </small>
                </span>
              </div>
            </div>
            <p className={`dn-status dn-status--${h.tone}`}>
              <Icon name={h.tone === 'ok' ? 'check' : h.tone === 'bad' ? 'circle-xmark' : 'clock'} size={15} /> Status:{' '}
              {h.tone === 'pending' ? 'Awaiting Dispatch Review' : h.title}
            </p>
          </section>
        </div>
      </div>
      <div className="done-actions">
        <Button icon="home" onClick={() => navigate('/book')}>
          Home
        </Button>
        <Link className="btn btn--secondary" to={`/trips/${trip.id}`}>
          <Icon name="arrow-right" size={15} /> View Booking
        </Link>
      </div>
      {booked && h.tone !== 'bad' ? (
        <BookingConfirmedOverlay
          logo={BRAND_LOGO}
          code={bookingRef(trip)}
          message="We will share the driver details before pickup."
          primaryLabel="View booking"
          onPrimary={() => navigate(`/trips/${trip.id}`)}
          secondaryLabel="Done"
          onClose={() => setBooked(false)}
        />
      ) : null}
    </div>
  );
}
export default DonePage;
