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
import { RoutePoints } from '@/components/RoutePoints';
import { TourQuotes } from '@/components/TourQuotes';
import { vehicleArtUrl } from '@/lib/vehicleArt';
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

function TripCard({ trip, onCancel }: { trip: TripRecord; onCancel: (t: TripRecord) => void }) {
  const navigate = useNavigate();
  const { startFrom } = useBooking();
  const chip = tripStatusChip(trip);
  const pay = paymentLabel(trip);
  const when = trip.scheduledAt ?? trip.completedAt ?? trip.cancelledAt ?? trip.createdAt;
  const canCancel = trip.status !== 'Ongoing' && ['Pending', 'Approved', 'Confirmed', 'Assigned'].includes(trip.status) && cancellationQuote(trip).allowed;
  const total = trip.status === 'Completed' ? (trip.fareBreakdown?.total ?? trip.fare) + trip.tollCharges + (trip.extraCharges ?? 0) : trip.status === 'Cancelled' || trip.status === 'Rejected' ? trip.cancellationFee : trip.fare;
  const unrated = trip.status === 'Completed' && trip.rating == null;

  return (
    <article className="tcard">
      <Link className="tcard__main" to={`/trips/${trip.id}`} aria-label={`Trip from ${trip.pickup.name} to ${trip.drop.name}, ${chip.label}`}>
        <header>
          <span className="status-chip" style={{ color: chip.fg, background: chip.bg }}>
            {chip.label}
          </span>
          <span className="tcard__when">
            {trip.isScheduled && trip.status !== 'Completed' ? 'Pickup ' : ''}
            {when ? `${formatDate(when)} · ${formatTime(when)}` : trip.date}
          </span>
        </header>
        <RoutePoints compact pickup={trip.pickup.name} drop={trip.drop.name} />
        <footer>
          <img src={vehicleArtUrl({ name: trip.categoryName, seats: 4 })} alt="" width={72} height={47} />
          <span className="tcard__meta">
            {trip.categoryName} · {trip.tripType}
            <small className={`pay-${pay.tone}`}>{pay.text}</small>
          </span>
          <strong className="num tcard__fare">{total > 0 || trip.status === 'Completed' ? formatINR(total) : ''}</strong>
        </footer>
      </Link>
      <div className="tcard__actions">
        <LinkButton size="sm" variant="secondary" to={`/trips/${trip.id}`}>
          {trip.status === 'Completed' ? 'Receipt & details' : 'View details'}
        </LinkButton>
        {unrated ? (
          <LinkButton size="sm" variant="ghost" to={`/trips/${trip.id}`}>
            Rate trip
          </LinkButton>
        ) : null}
        {trip.status === 'Completed' && isValidLatLng(trip.pickup) && isValidLatLng(trip.drop) ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              startFrom(trip.pickup, trip.drop);
              navigate('/book');
            }}
          >
            Book again
          </Button>
        ) : null}
        {canCancel ? (
          <Button size="sm" variant="danger" onClick={() => onCancel(trip)}>
            Cancel
          </Button>
        ) : null}
      </div>
    </article>
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
            <div className="trip-grid" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton" style={{ height: 196 }} />
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
              <div className="trip-grid">
                {shown.slice(0, limit).map((t) => (
                  <TripCard key={t.id} trip={t} onCancel={setCancelTrip} />
                ))}
              </div>
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
