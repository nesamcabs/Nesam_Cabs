import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TripRecord } from '@core/types';
import { useCustomerData } from '@/state/CustomerData';
import { cancellationQuote } from '@core/services/rideService';
import { formatDate, formatINR, formatTime } from '@core/utils/format';
import { isValidLatLng } from '@core/utils/geo';
import { customerStatus, paymentLabel, tabOfTrip, tripStatusChip } from '@core/utils/tripView';
import { Badge, Button, EmptyState, LinkButton, Notice, PageHead, Tabs } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { TourQuotes } from '@/components/TourQuotes';
import { AccountLayout, SignInPrompt } from '@/components/AccountLayout';
import { useSeo } from '@/lib/seo';
import { tripTypeLabel } from '@/lib/services';
import { useBooking } from '@/state/Booking';
import { CancelDialog } from './ride/dialogs';

type Tab = 'Upcoming' | 'Ongoing' | 'Completed' | 'Cancelled';
const TABS: Tab[] = ['Upcoming', 'Ongoing', 'Completed', 'Cancelled'];
const PAGE = 12;
const tabOf = (t: TripRecord): Tab => (t.status === 'Ongoing' ? 'Ongoing' : tabOfTrip(t));
const TONE: Record<string, 'green' | 'amber' | 'red' | 'blue'> = { '#15803D': 'green', '#B45309': 'amber', '#B91C1C': 'red', '#1D4ED8': 'blue' };

const EMPTY: Record<Tab, { title: string; text: string }> = {
  Upcoming: { title: 'No upcoming bookings', text: 'When you book a cab, it shows up here with its live status.' },
  Ongoing: { title: 'No trip in progress', text: 'A trip appears here once your driver starts it.' },
  Completed: { title: 'No completed trips yet', text: 'Your finished journeys and receipts will be kept here.' },
  Cancelled: { title: 'No cancelled bookings', text: 'Cancelled or declined bookings would appear here.' },
};

function TripCard({ trip, onCancel }: { trip: TripRecord; onCancel: (t: TripRecord) => void }) {
  const navigate = useNavigate();
  const { startFrom } = useBooking();
  const chip = tripStatusChip(trip);
  const pay = paymentLabel(trip);
  const status = customerStatus(trip);
  const when = trip.scheduledAt ?? trip.completedAt ?? trip.cancelledAt ?? trip.createdAt;
  const canCancel = trip.status !== 'Ongoing' && ['Pending', 'Approved', 'Confirmed', 'Assigned'].includes(trip.status) && cancellationQuote(trip).allowed;
  const total = trip.status === 'Completed' ? (trip.fareBreakdown?.total ?? trip.fare) + trip.tollCharges + (trip.extraCharges ?? 0) : trip.status === 'Cancelled' || trip.status === 'Rejected' ? trip.cancellationFee : trip.fare;
  const unrated = trip.status === 'Completed' && trip.rating == null;
  const dropName = trip.drop.id === 'place-local-disposal' ? 'Within the city' : trip.drop.name;

  return (
    <article className="bk">
      <Link className="bk__main" to={`/trips/${trip.id}`} aria-label={`Booking ${trip.bookingId}: ${trip.pickup.name} to ${dropName}, ${chip.label}`}>
        <span className="bk__badges">
          <Badge tone="green">{tripTypeLabel(trip.tripType)}</Badge>
          <Badge tone={TONE[chip.fg] ?? 'blue'}>{chip.label}</Badge>
        </span>
        <span className="route-title bk__route">
          <span>{trip.pickup.name}</span>
          <Icon name="arrow-right" size={15} />
          <span>{dropName}</span>
        </span>
        <span className="bk__row">
          <span>
            {when ? `${formatDate(when)} · ${formatTime(when)}` : trip.date} · {trip.categoryName}
          </span>
          <strong className="num">{total > 0 || trip.status === 'Completed' ? formatINR(total) : ''}</strong>
        </span>
        <span className="bk__status">
          <Icon name="clock" size={14} />
          <span className="truncate">{trip.driver && ['driver_assigned', 'driver_en_route', 'driver_arrived', 'in_trip'].includes(trip.phase) ? `${trip.driver.name}${trip.driver.vehicleNumber ? ` · ${trip.driver.vehicleNumber}` : ''}` : status.label}</span>
          <small className={`bk__pay bk__pay--${pay.tone}`}>{pay.text}</small>
          <Icon name="chevron-right" size={14} />
        </span>
      </Link>
      {unrated || canCancel || (trip.status === 'Completed' && isValidLatLng(trip.pickup) && isValidLatLng(trip.drop)) ? (
        <div className="bk__actions">
          {unrated ? (
            <LinkButton size="sm" variant="secondary" icon="star" to={`/trips/${trip.id}`}>
              Rate trip
            </LinkButton>
          ) : null}
          {trip.status === 'Completed' && isValidLatLng(trip.pickup) && isValidLatLng(trip.drop) && trip.drop.id !== 'place-local-disposal' ? (
            <Button
              size="sm"
              variant="ghost"
              icon="refresh"
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
              Cancel booking
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function TripsPage() {
  useSeo({ title: 'My Bookings', noindex: true });
  const { trips, tripsLoading, tripsError, retryTrips, profile } = useCustomerData();
  const [tab, setTab] = useState<Tab>('Upcoming');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [cancelTrip, setCancelTrip] = useState<TripRecord | null>(null);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { Upcoming: 0, Ongoing: 0, Completed: 0, Cancelled: 0 };
    for (const t of trips) c[tabOf(t)] += 1;
    return c;
  }, [trips]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = trips.filter((t) => tabOf(t) === tab && (!q || [t.pickup.name, t.drop.name, t.bookingId, t.categoryName].some((s) => s.toLowerCase().includes(q))));
    const pickupAt = (t: TripRecord) => (t.scheduledAt ?? t.createdAt)?.getTime() ?? 0;
    const closedAt = (t: TripRecord) => (t.completedAt ?? t.cancelledAt ?? t.createdAt)?.getTime() ?? 0;
    return tab === 'Upcoming' || tab === 'Ongoing' ? list.sort((a, b) => pickupAt(a) - pickupAt(b)) : list.sort((a, b) => closedAt(b) - closedAt(a));
  }, [trips, tab, query]);

  return (
    <AccountLayout>
      <PageHead backTo="/account" title="My Bookings">
        Every journey, in one place.
      </PageHead>
      {!profile ? (
        <SignInPrompt title="Sign in to see your bookings" text="Sign in with your mobile number to view upcoming bookings, trip history and receipts." />
      ) : (
        <>
          <TourQuotes brand="nesam" />
          <Tabs
            variant="boxed"
            className="bk-tabs"
            label="Booking status"
            value={tab}
            onChange={(t) => {
              setTab(t);
              setLimit(PAGE);
            }}
            options={TABS.map((t) => ({ value: t, label: t, count: counts[t] || undefined }))}
          />
          {trips.length > 4 ? (
            <div className="bk-search">
              <Icon name="search" size={16} />
              <label className="sr-only" htmlFor="trip-search">
                Search bookings
              </label>
              <input id="trip-search" type="search" placeholder="Search place or booking ID" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          ) : null}

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

          <div role="tabpanel" aria-label={`${tab} bookings`} className="bk-list">
            {tripsLoading ? (
              [0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 156 }} />)
            ) : shown.length === 0 ? (
              <div className="card card--center">
                {query ? (
                  <EmptyState
                    icon="search"
                    title="No bookings match your search"
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
                    icon="booking"
                    title={EMPTY[tab].title}
                    action={
                      tab === 'Upcoming' ? (
                        <LinkButton variant="primary" to="/book" icon="add">
                          Book a trip
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
                {shown.slice(0, limit).map((t) => (
                  <TripCard key={t.id} trip={t} onCancel={setCancelTrip} />
                ))}
                {shown.length > limit ? (
                  <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                    Show more ({shown.length - limit} left)
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </>
      )}
      {cancelTrip ? <CancelDialog key={cancelTrip.id} trip={cancelTrip} onClose={() => setCancelTrip(null)} /> : null}
    </AccountLayout>
  );
}
