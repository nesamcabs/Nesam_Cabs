import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TripRecord } from '@core/types';
import { useCustomerData } from '@core/context/CustomerData';
import { cancellationQuote } from '@core/services/rideService';
import { formatDate, formatINR, formatTime } from '@core/utils/format';
import { isValidLatLng } from '@core/utils/geo';
import { paymentLabel, tabOfTrip, tripStatusChip, type TripTab } from '@core/utils/tripView';
import { Button, EmptyState, LinkButton, Notice, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { TourQuotes } from '@/components/TourQuotes';
import { categoryPhoto } from '@/lib/categories';
import { useSeo } from '@/lib/seo';
import { useAuth } from '@/state/Auth';
import { useBooking } from '@/state/Booking';
import { CancelDialog } from './ride/dialogs';

const TABS: TripTab[] = ['Upcoming', 'Completed', 'Cancelled'];
const PAGE = 12;

const EMPTY: Record<TripTab, { title: string; text: string }> = {
  Upcoming: { title: 'No upcoming trips', text: 'When you book a ride, it shows up here with live status.' },
  Completed: { title: 'No completed trips yet', text: 'Your finished journeys and receipts will be kept here.' },
  Cancelled: { title: 'No cancelled trips', text: 'Cancelled or declined bookings would appear here.' },
};

/** One booking as a single compact list row; the whole row opens the trip, small actions sit underneath. */
function TripRow({ trip, onCancel }: { trip: TripRecord; onCancel: (t: TripRecord) => void }) {
  const navigate = useNavigate();
  const { startFrom, categories } = useBooking();
  // The photo uploaded for the trip's vehicle category in the admin panel (the site's art stands in when there is none).
  const cat = categories.find((c) => c.name === trip.categoryName);
  const chip = tripStatusChip(trip);
  const pay = paymentLabel(trip);
  const when = trip.scheduledAt ?? trip.completedAt ?? trip.cancelledAt ?? trip.createdAt;
  const canCancel = trip.status !== 'Ongoing' && ['Pending', 'Approved', 'Confirmed', 'Assigned'].includes(trip.status) && cancellationQuote(trip).allowed;
  const total = trip.status === 'Completed' ? (trip.fareBreakdown?.total ?? trip.fare) + trip.tollCharges + (trip.extraCharges ?? 0) : trip.status === 'Cancelled' || trip.status === 'Rejected' ? trip.cancellationFee : trip.fare;
  const unrated = trip.status === 'Completed' && trip.rating == null;
  const canRebook = trip.status === 'Completed' && isValidLatLng(trip.pickup) && isValidLatLng(trip.drop);

  return (
    <li className="trow">
      <Link className="trow__link" to={`/trips/${trip.id}`} aria-label={`Trip from ${trip.pickup.name} to ${trip.drop.name}, ${chip.label}`}>
        <img className="trow__art" src={categoryPhoto({ name: trip.categoryName, seats: cat?.seats ?? 4, imageUrl: cat?.imageUrl })} alt="" width={56} height={37} loading="lazy" decoding="async" />
        <span className="trow__body">
          <strong className="trow__route">
            <span className="trow__place">{trip.pickup.name}</span>
            <Icon name="arrow-right" size={14} />
            <span className="trow__place">{trip.drop.name}</span>
          </strong>
          <span className="trow__status">
            <span className="status-chip" style={{ color: chip.fg, background: chip.bg }}>
              {chip.label}
            </span>
          </span>
          <span className="trow__meta">
            {trip.isScheduled && trip.status !== 'Completed' ? 'Pickup ' : ''}
            {when ? `${formatDate(when)} · ${formatTime(when)}` : trip.date} · {trip.categoryName}
            {trip.tripType && trip.tripType !== 'One Way' ? ` · ${trip.tripType}` : ''}
          </span>
        </span>
        <span className="trow__end">
          <strong className="num trow__fare">{total > 0 || trip.status === 'Completed' ? formatINR(total) : ''}</strong>
          <small className={`pay-${pay.tone}`}>{pay.text}</small>
        </span>
      </Link>
      {unrated || canRebook || canCancel ? (
        <div className="trow__actions">
          {unrated ? (
            <Link className="trow__act" to={`/trips/${trip.id}`}>
              Rate trip
            </Link>
          ) : null}
          {canRebook ? (
            <button
              type="button"
              className="trow__act"
              onClick={() => {
                startFrom(trip.pickup, trip.drop);
                navigate('/book');
              }}
            >
              Book again
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" className="trow__act trow__act--danger" onClick={() => onCancel(trip)}>
              Cancel booking
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function TripsPage() {
  useSeo({ title: 'My Trips', noindex: true });
  const { trips, tripsLoading, tripsError, retryTrips, profile } = useCustomerData();
  const { openLoginModal } = useAuth();
  const [tab, setTab] = useState<TripTab>('Upcoming');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [cancelTrip, setCancelTrip] = useState<TripRecord | null>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = trips.filter((t) => tabOfTrip(t) === tab && (!q || [t.pickup.name, t.drop.name, t.bookingId, t.categoryName].some((s) => s.toLowerCase().includes(q))));
    // Upcoming: soonest pickup first. History: newest first.
    const pickupAt = (t: TripRecord) => (t.scheduledAt ?? t.createdAt)?.getTime() ?? 0;
    const closedAt = (t: TripRecord) => (t.completedAt ?? t.cancelledAt ?? t.createdAt)?.getTime() ?? 0;
    return tab === 'Upcoming' ? list.sort((a, b) => pickupAt(a) - pickupAt(b)) : list.sort((a, b) => closedAt(b) - closedAt(a));
  }, [trips, tab, query]);

  // Signed out: after the hooks above, so they run in the same order on every render.
  if (!profile) {
    return (
      <>
        <PageHead eyebrow="Your journeys" title="My trips">
          Track what’s coming up and find receipts for what you’ve taken.
        </PageHead>
        <div className="page">
          <div className="card card--center">
            <EmptyState
              art="welcome"
              title="Sign in to see your trips"
              action={
                <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to see trips' })}>
                  Sign in
                </Button>
              }
            >
              Sign in with your mobile number to view upcoming bookings, trip history and receipts.
            </EmptyState>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Your journeys"
        title="My trips"
        actions={
          <LinkButton variant="primary" to="/book" icon="car">
            Book a ride
          </LinkButton>
        }
      >
        Track what’s coming up and find receipts for what you’ve taken.
      </PageHead>

      <div className="page">
        <TourQuotes brand="nesam" />
        <div className="toolbar">
          <div className="tabs tabs--trips" role="tablist" aria-label="Trip status">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className="tab"
                onClick={() => {
                  setTab(t);
                  setLimit(PAGE);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="search">
            <Icon name="search" size={18} />
            <label className="sr-only" htmlFor="trip-search">
              Search trips
            </label>
            <input id="trip-search" type="search" placeholder="Search place or booking ID" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        {tripsError ? (
          <Notice
            tone="error"
            action={
              <Button size="sm" variant="secondary" onClick={retryTrips}>
                Try again
              </Button>
            }
          >
            {tripsError}
          </Notice>
        ) : null}

        <div role="tabpanel" aria-label={`${tab} trips`}>
          {tripsLoading ? (
            <div className="trip-list" aria-busy="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton" style={{ height: 84, borderRadius: 0 }} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="card card--center">
              {query ? (
                <EmptyState
                  title="No trips match your search"
                  action={
                    <Button variant="secondary" onClick={() => setQuery('')}>
                      Clear search
                    </Button>
                  }
                >
                  Try a different place name or booking ID.
                </EmptyState>
              ) : (
                <EmptyState
                  art="no-trips"
                  title={EMPTY[tab].title}
                  action={
                    tab === 'Upcoming' ? (
                      <LinkButton variant="primary" to="/book">
                        Book a ride
                      </LinkButton>
                    ) : undefined
                  }
                >
                  {EMPTY[tab].text}
                </EmptyState>
              )}
            </div>
          ) : (
            <>
              <ul className="trip-list">
                {shown.slice(0, limit).map((t) => (
                  <TripRow key={t.id} trip={t} onCancel={setCancelTrip} />
                ))}
              </ul>
              {shown.length > limit ? (
                <div className="more">
                  <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                    Show more ({shown.length - limit} left)
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {cancelTrip ? <CancelDialog key={cancelTrip.id} trip={cancelTrip} onClose={() => setCancelTrip(null)} /> : null}
    </>
  );
}
