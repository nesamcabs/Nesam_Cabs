import { TripItinerary } from '@/components/TripItinerary';
// Live ride and trip details: map, status timeline, driver and vehicle, boarding code,
// what to pay, support — then the receipt and rating once the trip is done. Everything
// shown comes from the booking document and the driver's own live location; nothing is
// estimated beyond the ETA the routing service computes from that location.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LatLng, RouteInfo, TripRecord } from '@core/types';
import { useCustomerData } from '@core/context/CustomerData';
import { cancellationQuote, subscribeToBoardingOtp, subscribeToBooking } from '@core/services/rideService';
import { getRoute } from '@core/services/geoService';
import { PRESENCE_STALE_MS, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { formatDate, formatDateTime, formatDistance, formatDuration, formatINR, formatPhone, formatTime, localMobile, timeAgo } from '@core/utils/format';
import { haversineKm, isValidLatLng } from '@core/utils/geo';
import { describeError } from '@core/utils/retry';
import { customerStatus, paymentLabel, tripStatusChip } from '@core/utils/tripView';
import { Avatar, Badge, Button, IconButton, Notice, PageLoader } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { RoutePoints } from '@/components/RoutePoints';
import { RouteMap } from '@/components/RouteMap';
import { FareBreakdown } from '@/components/FareBreakdown';
import { tripFareLines } from '@/lib/fareLines';
import { amountDue, isPaid, payableAmount, upiLink } from '@/lib/tripMoney';
import { buildTripShareText, shareText } from '@/lib/share';
import { printReceipt } from '@/lib/receipt';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { useSeo } from '@/lib/seo';
import { useToasts } from '@/state/Toasts';
import { useBooking } from '@/state/Booking';
import { CancelDialog, SafetyDialog } from './dialogs';
import { RatingCard } from './Rating';
import { markRideDismissed, unmarkRideDismissed } from '@/state/rideFocus';
import { categoryPhoto } from '@/lib/categories';

const PHASE_TITLE: Record<TripRecord['phase'], string> = {
  awaiting_review: 'Booking under review',
  arranging: 'Booking approved',
  partner_confirmed: 'Vendor assigned',
  driver_assigned: 'Driver and vehicle assigned',
  driver_en_route: 'Driver on the way',
  driver_arrived: 'Your driver has arrived',
  in_trip: 'On your way',
  completed: 'Trip completed',
  cancelled: 'Ride cancelled',
};

function titleOf(t: TripRecord): string {
  if (t.status === 'Pending') return 'Booking under review';
  if (t.status === 'Rejected') return 'Booking not accepted';
  return PHASE_TITLE[t.phase];
}

type StepState = 'done' | 'current' | 'todo';

interface TimelineStep {
  key: string;
  label: string;
  detail?: string;
  state: StepState;
}

function buildTimeline(trip: TripRecord): TimelineStep[] {
  const at = (d: Date | null) => (d ? formatTime(d) : '');
  const phase = trip.phase;
  const pending = trip.status === 'Pending';
  const order = ['requested', 'approved', 'assigned', 'arrived', 'ontrip', 'done'] as const;
  // Index of the step the ride is currently on.
  let current = 0;
  if (pending) current = 1;
  else if (phase === 'awaiting_review') current = 1;
  else if (phase === 'arranging') current = 2;
  else if (phase === 'partner_confirmed') current = 2;
  else if (phase === 'driver_assigned') current = 3;
  else if (phase === 'driver_en_route') current = 3;
  else if (phase === 'driver_arrived') current = 4;
  else if (phase === 'in_trip') current = 4;
  else if (phase === 'completed') current = 6;

  const label: Record<(typeof order)[number], { done: string; now: string; todo: string; detail: string }> = {
    requested: { done: 'Booking received', now: 'Booking received', todo: 'Booking received', detail: at(trip.createdAt) },
    approved: { done: 'Approved by NESAM Cabs', now: 'Waiting for NESAM Cabs approval', todo: 'NESAM Cabs approval', detail: at(trip.approvedAt) },
    assigned: {
      done: 'Driver and vehicle assigned',
      now: phase === 'partner_confirmed' ? 'Vendor assigned — driver details pending' : 'Arranging your vehicle',
      todo: 'Driver and vehicle assigned',
      detail: at(trip.assignedAt),
    },
    arrived: { done: 'Driver at pickup', now: phase === 'driver_en_route' ? 'Driver on the way' : 'Pickup at your scheduled time', todo: 'Driver arrives', detail: '' },
    ontrip: { done: 'Trip started', now: phase === 'driver_arrived' ? 'Share your code to start' : 'On your way', todo: 'Trip starts', detail: at(trip.startedAt) },
    done: { done: 'Trip completed', now: 'Trip completed', todo: 'Trip completed', detail: at(trip.completedAt) },
  };

  return order.map((key, i) => {
    const state: StepState = i < current ? 'done' : i === current ? 'current' : 'todo';
    const l = label[key];
    return { key, label: state === 'done' ? l.done : state === 'current' ? l.now : l.todo, detail: state === 'todo' ? '' : l.detail, state };
  });
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="timeline" aria-label="Ride progress">
      {steps.map((s) => (
        <li key={s.key} className={`timeline__step is-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="timeline__dot" aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={14} /> : null}
          </span>
          <span className="timeline__body">
            <span className="timeline__label">
              {s.label}
              <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (current)' : ' (upcoming)'}</span>
            </span>
            {s.state === 'current' ? <span className="timeline__tag">In progress</span> : null}
            {s.detail ? <time className="timeline__time">{s.detail}</time> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RidePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { startFrom, categories } = useBooking();
  const { push } = useToasts();
  const { online } = useOnline();
  const { position } = useDeviceLocation(true);

  const [trip, setTrip] = useState<TripRecord | null>(null);
  const [pending, setPending] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [vanished, setVanished] = useState(false);
  const [subKey, setSubKey] = useState(0);
  const [otp, setOtp] = useState<string | null>(null);
  // The ETA is tagged with its target so a stale one never shows after a phase change.
  const [etaState, setEtaState] = useState<{ target: string; info: RouteInfo } | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [printing, setPrinting] = useState('');
  const [tripRoute, setTripRoute] = useState<{ key: string; info: RouteInfo } | null>(null);

  useSeo({ title: trip ? titleOf(trip) : 'Your ride', noindex: true });

  // Leaving this page (back, minimise) stops it re-opening automatically.
  useEffect(() => {
    unmarkRideDismissed(id);
    return () => markRideDismissed(id);
  }, [id]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  // The booking document is the source of truth for every phase.
  useEffect(() => {
    setTrip(null);
    setVanished(false);
    return subscribeToBooking(
      id,
      (s) => {
        setPending(s.pending);
        setFromCache(s.fromCache);
        if (s.trip) {
          setTrip(s.trip);
          setVanished(false);
        } else if (!s.fromCache) {
          // Gone on the server: a rejected request or a booking removed by an admin.
          setVanished(true);
          setTrip(null);
        }
      },
      (e) => setLoadError(describeError(e, 'We couldn’t load this ride.')),
    );
  }, [id, subKey]);

  // The whole pickup → destination route, for the map (same cached lookup the booking used).
  const routeKey = trip && isValidLatLng(trip.pickup) && isValidLatLng(trip.drop) ? (trip.itinerary?.length ? trip.itinerary : [trip.pickup, trip.drop]).map(p => p.lat + ',' + p.lng).join('>') : '';
  useEffect(() => {
    if (!trip || !routeKey) return undefined;
    const controller = new AbortController();
    Promise.all((trip.itinerary?.length ? trip.itinerary : [trip.pickup, trip.drop]).slice(1).map((point, index) => getRoute((trip.itinerary?.length ? trip.itinerary : [trip.pickup, trip.drop])[index], point, controller.signal))).then(legs => ({ distanceKm: legs.reduce((n, leg) => n + leg.distanceKm, 0), durationMin: legs.reduce((n, leg) => n + leg.durationMin, 0), estimated: legs.some(leg => leg.estimated), path: legs.flatMap(leg => leg.path) }))
      .then((info) => !controller.signal.aborted && setTripRoute({ key: routeKey, info }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps -- endpoints are encoded in the key

  // The boarding code lives in booking_secrets, readable only by the rider who booked.
  useEffect(() => subscribeToBoardingOtp(id, setOtp), [id]);

  const tracking = !!trip && ['driver_en_route', 'driver_arrived', 'in_trip'].includes(trip.phase);
  const driverLoc = tracking ? (trip?.driverLocation ?? null) : null;
  const driverFresh = !!driverLoc?.updatedAt && now - driverLoc.updatedAt.getTime() < PRESENCE_STALE_MS;

  // ETA: driver → pickup before the trip, driver → drop during it. Re-routed when the
  // driver has moved ~150 m or every 45 s, whichever comes first.
  const etaAnchor = useRef<{ at: number; from: LatLng | null; target: string }>({ at: 0, from: null, target: '' });
  useEffect(() => {
    if (!trip || !driverLoc) return undefined;
    const target = trip.phase === 'in_trip' ? trip.drop : trip.pickup;
    if (!isValidLatLng(target)) return undefined;
    const key = trip.phase === 'in_trip' ? 'drop' : 'pickup';
    const a = etaAnchor.current;
    const moved = a.from ? haversineKm(a.from, driverLoc) : Infinity;
    if (a.target === key && moved < 0.15 && Date.now() - a.at < 45000) return undefined;
    etaAnchor.current = { at: Date.now(), from: driverLoc, target: key };
    const controller = new AbortController();
    getRoute(driverLoc, target, controller.signal)
      .then((r) => !controller.signal.aborted && setEtaState({ target: key, info: r }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [driverLoc?.lat, driverLoc?.lng, trip?.phase]); // eslint-disable-line react-hooks/exhaustive-deps -- throttled on position/phase

  const etaTarget = trip?.phase === 'in_trip' ? 'drop' : 'pickup';
  const eta = driverLoc && etaState?.target === etaTarget ? etaState.info : null;



  if (loadError && !trip) {
    return (
      <div className="page">
        <Notice
          tone="error"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setLoadError('');
                setSubKey((k) => k + 1);
              }}
            >
              Try again
            </Button>
          }
        >
          {loadError}
        </Notice>
        <p className="page__after">
          <Link className="btn btn--secondary" to="/trips">
            Back to my trips
          </Link>
        </p>
      </div>
    );
  }
  if (vanished) {
    return (
      <div className="page">
        <Notice tone="warning">
          This ride is no longer available. If you just requested it, our servers did not accept the request and nothing was charged — please try again, or contact support if it keeps happening.
        </Notice>
        <p className="page__after">
          <Link className="btn btn--primary" to="/book">
            Back to booking
          </Link>
        </p>
      </div>
    );
  }
  if (!trip) return <PageLoader label={pending ? 'Sending your ride request…' : 'Loading your ride…'} />;

  const phase = trip.phase;
  const canCancel = cancellationQuote(trip).allowed;
  const minutesAway = eta ? Math.max(1, Math.round(eta.durationMin)) : null;
  const straightKm = driverLoc && isValidLatLng(trip.pickup) ? haversineKm(driverLoc, trip.pickup) : null;
  const sharePoint: LatLng | null = phase === 'in_trip' && driverLoc ? driverLoc : position;
  const driverPhone = trip.driver ? localMobile(trip.driver.phone) : '';
  const chip = tripStatusChip(trip);
  const title = titleOf(trip);
  const finished = phase === 'completed' || phase === 'cancelled';
  const due = amountDue(trip);
  const mapPickup = phase === 'in_trip' ? null : trip.pickup;
  const streamingNote = tracking && driverLoc && !driverFresh ? `Driver location last updated ${timeAgo(driverLoc.updatedAt, now)}.` : '';

  const doShare = async () => {
    const r = await shareText(`NESAM Cabs ride ${trip.bookingId}`, buildTripShareText(trip, sharePoint));
    if (r === 'copied') push({ title: 'Trip details copied', message: 'Paste them into a message to share.', tone: 'success' });
  };
  const bookAgain = () => {
    if (isValidLatLng(trip.pickup) && isValidLatLng(trip.drop)) startFrom(trip.pickup, trip.drop);
    navigate('/book');
  };
  const doPrint = () => {
    try {
      printReceipt(trip, profile?.name || 'Customer');
    } catch {
      setPrinting('We couldn’t open the print dialog. Please try again.');
    }
  };

  const stepsNow = buildTimeline(trip);
  const status = customerStatus(trip, now);
  const hero =
    phase === 'driver_en_route' && tracking
      ? { big: minutesAway != null ? `${minutesAway} min` : '—', small: 'until your driver arrives' }
      : phase === 'in_trip'
        ? { big: minutesAway != null ? formatDuration(minutesAway) : '—', small: `until you reach ${trip.drop.name}` }
        : null;

  // The driver's leg is drawn over the whole trip, which stays quietly underneath.
  const legPath = tracking && eta ? eta.path : null;
  const wholePath = tripRoute?.key === routeKey ? tripRoute.info.path : null;

  const total = trip.fareBreakdown?.total ?? trip.fare;
  const arranging = phase === 'awaiting_review' || phase === 'arranging' || phase === 'partner_confirmed';
  const showDriver = !!trip.driver && (tracking || phase === 'driver_assigned');
  const closed = phase === 'cancelled' || trip.status === 'Rejected';
  const paymentState = closed ? paymentLabel(trip).text : isPaid(trip) ? 'Paid' : trip.paymentStatus;
  // The photo uploaded for this vehicle category in the admin panel.
  const tripCategory = categories.find((c) => c.name === trip.categoryName);
  const driverLine = trip.driver ? [trip.driver.name, trip.driver.vehicleModel || trip.categoryName, trip.driver.vehicleNumber].filter(Boolean).join(' · ') : '';
  const hasMap = phase !== 'cancelled' && isValidLatLng(trip.pickup) && isValidLatLng(trip.drop);

  const mapCard = hasMap ? (
    <section className="rcard rcard--map" aria-label="Route map">
      <div className="rmap">
        <RouteMap
          label="Ride map"
          pickup={mapPickup}
          drop={trip.drop}
          driver={driverLoc ? { lat: driverLoc.lat, lng: driverLoc.lng, label: trip.driver?.name, stale: !driverFresh } : null}
          userLocation={position}
          path={legPath ?? wholePath}
          basePath={legPath ? wholePath : null}
          padding={{ top: 48, right: 48, bottom: 48, left: 48 }}
        />
      </div>
    </section>
  ) : null;

  const tripCard = (
    <section className="rcard" aria-labelledby="trip-h">
      <header>
        <h2 id="trip-h">Trip details</h2>
      </header>
      <RoutePoints pickup={trip.pickup.name} drop={trip.drop.name} pickupAddress={trip.pickup.address} dropAddress={trip.drop.address} />
      <TripItinerary trip={trip} />
      <div className="mini-ride">
        <img src={categoryPhoto({ name: trip.categoryName, seats: tripCategory?.seats ?? 4, imageUrl: tripCategory?.imageUrl })} alt="" width={96} height={63} />
        <div className="mini-ride__info">
          <strong>{trip.categoryName}</strong>
          <small className="muted">
            {trip.tripType} · {trip.service}
            {trip.distanceKm ? ` · ${formatDistance(trip.distanceKm)}` : ''}
          </small>
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>{trip.scheduledAt ? 'Pickup date and time' : 'Booked on'}</dt>
          <dd>{trip.scheduledAt ? `${formatDate(trip.scheduledAt)}, ${formatTime(trip.scheduledAt)}` : formatDateTime(trip.createdAt)}</dd>
        </div>
        {!closed ? (
          <div>
            <dt>Driver and vehicle</dt>
            <dd>{driverLine || (finished ? '—' : 'Being arranged. Details appear here once your vehicle is assigned.')}</dd>
          </div>
        ) : null}
        {trip.notes ? (
          <div>
            <dt>Your note</dt>
            <dd>{trip.notes}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );

  const moneyBox =
    !closed && trip.status !== 'Pending' ? (
      isPaid(trip) ? (
        <div className="pay-box pay-box--paid">
          <Icon name="success" size={24} />
          <div>
            <strong>Paid {formatINR(trip.paid?.totalPaid || payableAmount(trip))}</strong>
            <small>via {trip.paymentMethod}. Thank you!</small>
          </div>
        </div>
      ) : (
        <div className="pay-box">
          <div>
            <small className="eyebrow">{trip.paymentMethod === 'UPI' ? 'Pay by UPI' : 'Pay your driver in cash'}</small>
            <strong className="num pay-box__amount">{formatINR(due)}</strong>
            <small>
              {trip.paid && trip.paid.totalPaid > 0 ? `Balance after ${formatINR(trip.paid.totalPaid)} paid. ` : ''}
              {phase === 'completed' ? 'Your driver confirms the payment once collected.' : 'Collected by your driver at the end of the trip. Tolls and parking, if any, are added at actuals.'}
            </small>
          </div>
          {trip.paymentMethod === 'UPI' && upiLink(trip) ? (
            <a className="btn btn--secondary btn--sm" href={upiLink(trip)!}>
              Open UPI app
            </a>
          ) : null}
        </div>
      )
    ) : null;

  const fareCard = (
    <section className="rcard" aria-labelledby="fare-h">
      <header>
        <h2 id="fare-h">{phase === 'completed' ? 'Receipt and payment' : 'Fare and payment'}</h2>
        {phase === 'completed' ? (
          <Button size="sm" variant="secondary" icon="download" onClick={doPrint}>
            Save or print
          </Button>
        ) : null}
      </header>
      {phase !== 'completed' ? (
        <p className="fare-total">
          <span>{closed ? 'Booking fare' : 'Total fare'}</span>
          <strong className="num">{formatINR(total)}</strong>
        </p>
      ) : null}
      <dl className="facts">
        <div>
          <dt>Payment method</dt>
          <dd>{trip.paymentMethod}</dd>
        </div>
        <div>
          <dt>Payment status</dt>
          <dd>{paymentState}</dd>
        </div>
      </dl>
      {moneyBox}
      {phase === 'completed' ? (
        <>
          {printing ? <Notice tone="error">{printing}</Notice> : null}
          <FareBreakdown lines={tripFareLines(trip)} total={total} tolls={trip.tollCharges} policies={['payment', 'refund']} />
          {trip.paid && trip.paid.totalPaid > 0 ? (
            <p className="muted small">
              Paid so far {formatINR(trip.paid.totalPaid)} · Balance {formatINR(trip.paid.balanceDue)}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );

  const timeline = (
    <section className="rcard" aria-labelledby="progress-h">
      <header>
        <h2 id="progress-h">Progress</h2>
      </header>
      <Timeline steps={stepsNow} />
    </section>
  );

  const actions = (
    <section className="rcard rcard--actions" aria-labelledby="actions-h">
      <header>
        <h2 id="actions-h">Need something?</h2>
      </header>
      {finished ? (
        <Button size="lg" block onClick={bookAgain}>
          {phase === 'completed' ? 'Book this trip again' : 'Book another ride'}
        </Button>
      ) : null}
      <div className="options">
        {!finished ? (
          <button type="button" className="option" onClick={() => void doShare()}>
            <Icon name="share" /> Share trip details
          </button>
        ) : null}
        <Link className="option" to={`/support?booking=${encodeURIComponent(trip.bookingId)}`}>
          <Icon name="support" /> Get help with this trip
        </Link>
        <a className="option" href={`tel:${SUPPORT_PHONE}`}>
          <Icon name="phone" /> Call NESAM Cabs · {SUPPORT_PHONE_DISPLAY}
        </a>
        {tracking ? (
          <button type="button" className="option option--danger" onClick={() => setShowSafety(true)}>
            <Icon name="emergency" /> Safety centre · SOS
          </button>
        ) : null}
        {canCancel ? (
          <button type="button" className="option option--danger" onClick={() => setShowCancel(true)}>
            <Icon name="cancellation" /> Cancel booking
          </button>
        ) : null}
      </div>
    </section>
  );

  return (
    <div className="page ride">
      <header className="ride-head">
        <div className="ride-head__bar">
          <IconButton icon="arrow-left" label="Back" outline onClick={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/trips'))} />
          <p className="ride-head__ref">
            <span>Booking reference</span>
            <strong className="num">{trip.bookingId}</strong>
            {pending ? <small> · sending…</small> : fromCache && !online ? <small> · offline</small> : null}
          </p>
          <span className="status-chip" style={{ color: chip.fg, background: chip.bg }}>
            {chip.label}
          </span>
        </div>
        <h1 className="ride-head__title">{title}</h1>
      </header>

      <div className="ride__grid">
        <div className="ride__main">
          {/* Awaiting review / approved / vendor assigned: a status, never a search or an arrival promise */}
          {arranging || phase === 'driver_assigned' ? (
            <section className={`status-card ${phase === 'driver_assigned' ? 'is-good' : ''}`} aria-labelledby="status-h">
              {arranging ? <img src="/art/account-review.webp" alt="" width={96} height={96} /> : <span className="status-card__icon" aria-hidden="true"><Icon name="check" size={28} /></span>}
              <div>
                <h2 id="status-h">{arranging ? 'What happens next' : 'Your trip is confirmed'}</h2>
                <p>{pending ? 'Sending your request…' : status.detail}</p>
                {trip.scheduledAt ? (
                  <p className="status-card__when">
                    <Icon name="clock" size={16} /> Pickup {formatDateTime(trip.scheduledAt)}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Live: ETA, code, driver */}
          {tracking && hero ? (
            <div className="eta">
              <span className="eta__big num">{hero.big}</span>
              <span className="eta__small">{hero.small}</span>
              {phase === 'driver_en_route' && straightKm != null && !eta ? <span className="eta__small">Driver is {formatDistance(straightKm)} from your pickup.</span> : null}
            </div>
          ) : null}
          {streamingNote ? <p className="muted small">{streamingNote}</p> : null}
          {tracking && !driverLoc ? <p className="muted small">Live location appears once your driver’s app shares it.</p> : null}

          {(phase === 'driver_assigned' || phase === 'driver_en_route' || phase === 'driver_arrived') && trip.driver ? (
            <div className={`otp-card ${phase === 'driver_arrived' ? 'is-arrived' : ''}`}>
              <div>
                <strong>{phase === 'driver_arrived' ? 'Share this code to start your ride' : 'Your start-of-ride code'}</strong>
                <small>
                  {phase === 'driver_arrived' ? `Meet your driver at ${trip.pickup.name}. Only share the code once you’re in the car.` : 'Give it to your driver once you’re in the car.'}
                </small>
              </div>
              <span className="otp-card__code num" aria-label={`Ride code ${otp ? otp.split('').join(' ') : 'unavailable'}`}>
                {otp ?? '····'}
              </span>
            </div>
          ) : null}

          {showDriver && trip.driver ? (
            <section className="driver-card" aria-label="Your driver">
              <Avatar name={trip.driver.name} photoUrl={trip.driver.photoUrl} size={60} />
              <div className="driver-card__text">
                <strong>{trip.driver.name}</strong>
                <small className="muted">
                  {trip.driver.rating != null ? `★ ${trip.driver.rating.toFixed(1)} · ` : ''}
                  {trip.driver.vehicleModel || trip.categoryName}
                </small>
              </div>
              {trip.driver.vehicleNumber ? <span className="plate">{trip.driver.vehicleNumber}</span> : null}
              {driverPhone ? (
                <div className="driver-actions">
                  <a className="btn btn--primary btn--sm" href={`tel:+91${driverPhone}`}>
                    <Icon name="phone" /> Call {trip.driver.name.split(' ')[0] || 'driver'}
                  </a>
                  <a className="btn btn--secondary btn--sm" href={`https://wa.me/91${driverPhone}`} target="_blank" rel="noopener noreferrer">
                    <Icon name="chat" /> WhatsApp
                  </a>
                  <p className="muted small driver-actions__note">Calls go to {formatPhone(driverPhone)}.</p>
                </div>
              ) : (
                <div className="driver-actions">
                  <Badge>No phone number on file for this driver</Badge>
                </div>
              )}
            </section>
          ) : null}

          {/* Cancelled */}
          {phase === 'cancelled' ? (
            <Notice tone={trip.cancellationFee > 0 ? 'warning' : 'info'}>
              <strong>
                {trip.status === 'Rejected' ? 'This booking was not accepted' : trip.cancelledBy === 'customer' ? 'You cancelled this ride' : 'This ride was cancelled'}
                {trip.cancelReason ? ` — “${trip.cancelReason}”` : ''}.
              </strong>{' '}
              {trip.cancellationFee > 0 ? `A cancellation fee of ${formatINR(trip.cancellationFee)} applies per our policy.` : 'No cancellation fee was charged.'}
              {trip.refund && trip.refund.amount > 0 ? ` Refund ${trip.refund.status.toLowerCase()}: ${formatINR(trip.refund.amount)}.` : ''}
              {trip.cancellationFee > 0 || (trip.refund && trip.refund.amount > 0) ? (
                <>
                  {' '}
                  <Link to="/legal#refund">Refund Policy</Link>
                </>
              ) : null}
            </Notice>
          ) : null}

          {phase === 'completed' ? (
            <>
              <section className="done-card">
                <img src="/art/trip-completed.webp" alt="" width={120} height={120} />
                <div>
                  <h2>You’ve arrived at {trip.drop.name}</h2>
                  <p className="muted">{formatDateTime(trip.completedAt)}</p>
                </div>
              </section>
              {profile ? <RatingCard trip={trip} profile={profile} /> : null}
            </>
          ) : null}

          {tracking ? mapCard : null}
          {phase !== 'cancelled' ? timeline : null}
          {tripCard}
          {!tracking ? mapCard : null}
        </div>

        <aside className="ride__side" aria-label="Fare, payment and actions">
          {fareCard}
          {actions}
        </aside>
      </div>

      {showCancel ? <CancelDialog trip={trip} onClose={() => setShowCancel(false)} /> : null}
      {showSafety && profile ? <SafetyDialog trip={trip} profile={profile} location={sharePoint} onClose={() => setShowSafety(false)} /> : null}
    </div>
  );
}
