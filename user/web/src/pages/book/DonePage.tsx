// After "Submit booking request": a ticket for the booking that was just created. The headline follows
// the booking's real status — a new request is awaiting NESAM's review and is not called confirmed
// until NESAM approves it. Safe to reload: everything is read from the booking itself.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { TripRecord } from '@core/types';
import { subscribeToBooking } from '@core/services/rideService';
import { formatDate, formatTime } from '@core/utils/format';
import { describeError } from '@core/utils/retry';
import { Button, Notice, PageLoader } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useSeo } from '@/lib/seo';
import { useBooking } from '@/state/Booking';
import { tripTypeLabel } from '@/lib/services';
import { BookingConfirmedOverlay } from '@/components/BookingConfirmedOverlay';
import './done.css';

function headline(t: TripRecord): { title: string; text: string; tone: 'pending' | 'ok' | 'bad' } {
  if (t.status === 'Rejected') return { title: 'Booking not accepted', text: 'NESAM could not accept this booking request. Nothing has been charged.', tone: 'bad' };
  if (t.status === 'Cancelled') return { title: 'Booking cancelled', text: 'This booking has been cancelled.', tone: 'bad' };
  if (t.status === 'Pending') return { title: 'Booking confirmed', text: 'Your booking is confirmed. We will share the driver details before pickup.', tone: 'pending' };
  return { title: 'Booking Confirmed', text: 'Your trip is confirmed. We will arrange your cab.', tone: 'ok' };
}

function JourneyArt({ done }: { done: boolean }) {
  return (
    <div className={`journey-art ${done ? 'is-done' : ''}`} aria-hidden="true">
      <span className="journey-art__track">
        <span className="journey-art__start" />
        <span className="journey-art__line" />
        <span className="journey-art__car">
          <Icon name="car" size={30} />
        </span>
      </span>
      <span className="journey-art__badge">
        <Icon name={done ? 'check' : 'clock'} size={26} />
      </span>
    </div>
  );
}

export function DonePage() {
  useSeo({ title: 'Booking request received', noindex: true });
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const location = useLocation();
  const { reset } = useBooking();
  // Shown once, right after booking; a reload or a later visit goes straight to the page.
  const [celebrate, setCelebrate] = useState(() => (location.state as { fresh?: boolean } | null)?.fresh === true);

  // Arriving straight from "Submit booking request": the draft has done its job.
  useEffect(() => {
    if ((location.state as { fresh?: boolean } | null)?.fresh) {
      reset();
      navigate(location.pathname, { replace: true, state: null }); // used once: a reload does not celebrate again
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival

  useEffect(() => {
    setError('');
    return subscribeToBooking(
      id,
      (s) => {
        setPending(s.pending);
        if (s.trip) {
          setTrip(s.trip);
          setMissing(false);
        } else if (!s.fromCache) setMissing(true);
      },
      (e) => setError(describeError(e, 'We couldn’t load your booking.')),
    );
  }, [id, attempt]);

  if (error && !trip) {
    return (
      <div className="flow-page">
        <div className="wrap flow-page__wrap done-state">
          <Notice
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </Button>
            }
          >
            {error} Your request may still have been received — check My Bookings.
          </Notice>
          <Link className="btn btn--secondary" to="/trips">
            Open My Bookings
          </Link>
        </div>
      </div>
    );
  }
  if (missing) {
    return (
      <div className="flow-page">
        <div className="wrap flow-page__wrap done-state">
          <Notice tone="warning">We can’t find this booking. If you just submitted it, the request was not accepted and nothing was charged — please try again or call support.</Notice>
          <Link className="btn btn--primary" to="/book">
            Back to booking
          </Link>
        </div>
      </div>
    );
  }
  if (!trip) return <PageLoader label="Loading your booking…" />;

  const h = headline(trip);
  const at = trip.scheduledAt;
  return (
    <div className="flow-page flow-page--done">
      {celebrate && h.tone !== 'bad' ? (
        <BookingConfirmedOverlay
          logo={{ src: '/nesam/logo.webp', alt: 'NESAM Cabs' }}
          code={trip.bookingId || trip.id}
          message="We will share the driver details before pickup."
          primaryLabel="View booking"
          onPrimary={() => navigate(`/trips/${trip.id}`)}
          secondaryLabel="Done"
          onClose={() => setCelebrate(false)}
        />
      ) : null}
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
            <p className="dn-hero__text">{pending ? 'Sending your request…' : h.text}</p>
            <p className="dn-hero__saved">
              <Icon name="shield-check" size={14} /> Your trip is saved in My Bookings
            </p>
          </section>

          <section className="dn-ticket" aria-label="Trip summary">
            <header className="dn-ticket__head">
              <span className="dn-ticket__brand">NESAM</span>
              <span className="dn-ticket__id">
                <small>Booking ID</small>
                <strong className="num">{trip.bookingId}</strong>
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
                    {tripTypeLabel(trip.tripType)} · {trip.paymentMethod === 'UPI' ? 'Pay your driver by UPI' : 'Pay your driver in cash'}
                  </small>
                </span>
              </div>
            </div>
            <p className={`dn-status dn-status--${h.tone}`}>
              <Icon name={h.tone === 'ok' ? 'success' : h.tone === 'bad' ? 'warning' : 'clock'} size={15} /> Status:{' '}
              {h.tone === 'pending' ? 'Awaiting NESAM review' : h.title}
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
    </div>
  );
}
