import { TripItinerary } from '@/components/TripItinerary';
// Booking details (/trips/:id and /ride/:id): status, the five milestones, driver and boarding OTP,
// live map while the driver is on the way or the trip is running, fare, payment, receipt, rating and
// the trip's help actions. Everything shown comes from the booking document and the driver's live
// location; the ETA is computed by the routing service from that location.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { LatLng, RouteInfo, TripRecord } from '@core/types';
import { useCustomerData } from '@/state/CustomerData';
import { cancellationQuote, subscribeToBoardingOtp, subscribeToBooking } from '@core/services/rideService';
import { getRoute } from '@core/services/geoService';
import { CUSTOMER_PAYMENTS_ENABLED, PRESENCE_STALE_MS, SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { formatDate, formatDateTime, formatDistance, formatDuration, formatINR, formatPhone, formatTime, localMobile, timeAgo } from '@core/utils/format';
import { haversineKm, isValidLatLng } from '@core/utils/geo';
import { describeError } from '@core/utils/retry';
import { customerStatus, tripStatusChip } from '@core/utils/tripView';
import { Avatar, Badge, Button, Card, ListRow, Notice, PageHead, PageLoader } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { RouteMap } from '@/components/RouteMap';
import { FareBreakdown } from '@/components/FareBreakdown';
import { tripFareLines } from '@/lib/fareLines';
import { amountDue, isPaid, payableAmount, upiLink } from '@/lib/tripMoney';
import { buildTripShareText, shareText } from '@/lib/share';
import { printReceipt } from '@/lib/receipt';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { useSeo } from '@/lib/seo';
import { milestones } from '@/lib/milestones';
import { tripTypeLabel } from '@/lib/services';
import { useToasts } from '@/state/Toasts';
import { useBooking } from '@/state/Booking';
import { FlowBar } from '@/pages/book/parts';
import { CancelDialog, SafetyDialog } from './dialogs';
import { RatingCard } from './Rating';
import { markRideDismissed, unmarkRideDismissed } from '@/state/rideFocus';

const TONE: Record<string, 'green' | 'amber' | 'red' | 'blue'> = { '#15803D': 'green', '#B45309': 'amber', '#B91C1C': 'red', '#1D4ED8': 'blue' };

function Progress({ trip }: { trip: TripRecord }) {
  const steps = milestones(trip);
  return (
    <ol className="milestones" aria-label="Trip progress">
      {steps.map((s) => (
        <li key={s.key} className={`milestone is-${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className="milestone__dot" aria-hidden="true">
            {s.state === 'done' ? <Icon name="check" size={12} /> : null}
          </span>
          <div>
            <strong>
              {s.label}
              <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (current)' : ' (upcoming)'}</span>
            </strong>
            <small>{s.detail || (s.at ? formatDateTime(s.at) : s.state === 'todo' ? '—' : '')}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function RidePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useCustomerData();
  const { startFrom } = useBooking();
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
  const [etaState, setEtaState] = useState<{ target: string; info: RouteInfo } | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showSafety, setShowSafety] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [printing, setPrinting] = useState('');
  const [tripRoute, setTripRoute] = useState<{ key: string; info: RouteInfo } | null>(null);

  useSeo({ title: trip ? `Booking ${trip.bookingId}` : 'Booking details', noindex: true });

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
          setVanished(true);
          setTrip(null);
        }
      },
      (e) => setLoadError(describeError(e, 'We couldn’t load this booking.')),
    );
  }, [id, subKey]);

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

  // ETA: driver → pickup before the trip, driver → drop during it; re-routed after ~150 m or 45 s.
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
  }, [driverLoc?.lat, driverLoc?.lng, trip?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const etaTarget = trip?.phase === 'in_trip' ? 'drop' : 'pickup';
  const eta = driverLoc && etaState?.target === etaTarget ? etaState.info : null;

  if (loadError && !trip) {
    return (
      <div className="flow-page">
        <div className="wrap flow-page__wrap done-state">
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
          <Link className="btn btn--secondary" to="/trips">
            Back to My Bookings
          </Link>
        </div>
      </div>
    );
  }
  if (vanished) {
    return (
      <div className="flow-page">
        <div className="wrap flow-page__wrap done-state">
          <Notice tone="warning">This booking is no longer available. If you just requested it, it was not accepted and nothing was charged — please try again, or contact support if it keeps happening.</Notice>
          <Link className="btn btn--primary" to="/book">
            Back to booking
          </Link>
        </div>
      </div>
    );
  }
  if (!trip) return <PageLoader label={pending ? 'Sending your booking request…' : 'Loading your booking…'} />;

  const phase = trip.phase;
  const canCancel = cancellationQuote(trip).allowed;
  const minutesAway = eta ? Math.max(1, Math.round(eta.durationMin)) : null;
  const straightKm = driverLoc && isValidLatLng(trip.pickup) ? haversineKm(driverLoc, trip.pickup) : null;
  const sharePoint: LatLng | null = phase === 'in_trip' && driverLoc ? driverLoc : position;
  const driverPhone = trip.driver ? localMobile(trip.driver.phone) : '';
  const chip = tripStatusChip(trip);
  const status = customerStatus(trip, now);
  const finished = phase === 'completed' || phase === 'cancelled';
  const rejected = trip.status === 'Rejected';
  const due = amountDue(trip);
  const showOtp = !!trip.driver && (phase === 'driver_assigned' || phase === 'driver_en_route' || phase === 'driver_arrived');
  const legPath = tracking && eta ? eta.path : null;
  const wholePath = tripRoute?.key === routeKey ? tripRoute.info.path : null;
  const streamingNote = tracking && driverLoc && !driverFresh ? `Driver location last updated ${timeAgo(driverLoc.updatedAt, now)}.` : '';
  const dropName = trip.drop.id === 'place-local-disposal' ? 'Within the city' : trip.drop.name;
  const at = trip.scheduledAt;

  const doShare = async () => {
    const r = await shareText(`NESAM booking ${trip.bookingId}`, buildTripShareText(trip, sharePoint));
    if (r === 'copied') push({ title: 'Trip details copied', message: 'Paste them into a message to share.', tone: 'success' });
  };
  const bookAgain = () => {
    if (isValidLatLng(trip.pickup) && isValidLatLng(trip.drop) && trip.drop.id !== 'place-local-disposal') startFrom(trip.pickup, trip.drop);
    navigate('/book');
  };
  const doPrint = () => {
    try {
      printReceipt(trip, profile?.name || 'Customer');
    } catch {
      setPrinting('We couldn’t open the print dialog. Please try again.');
    }
  };

  const hero =
    phase === 'driver_en_route'
      ? { big: minutesAway != null ? `${minutesAway} min` : '—', small: 'until your driver arrives' }
      : phase === 'in_trip'
        ? { big: minutesAway != null ? formatDuration(minutesAway) : '—', small: `until you reach ${dropName}` }
        : phase === 'driver_arrived'
          ? { big: 'Arrived', small: `Your driver is at ${trip.pickup.name}` }
          : null;

  return (
    <div className="flow-page">
      <div className="wrap flow-page__wrap">
        <PageHead backTo="/trips" title="Booking details">
          <span className="num">{trip.bookingId}</span>
          {pending ? ' · sending…' : fromCache && !online ? ' · offline, showing saved details' : ''}
        </PageHead>

        <div className="bd-badges">
          <Badge tone="green">{trip.service === 'Multicity' ? 'Multicity' : tripTypeLabel(trip.tripType)}</Badge>
          <Badge tone={TONE[chip.fg] ?? 'blue'}>{chip.label}</Badge>
        </div>
        <p className="route-title route-title--xl">
          <span>{trip.pickup.name}</span>
          <Icon name="arrow-right" size={18} />
          <span>{dropName}</span>
        </p>
        <p className="bd-meta">
          {at ? `${formatDate(at)} · ${formatTime(at)}` : formatDateTime(trip.createdAt)} · {trip.categoryName}
          {trip.distanceKm ? ` · ${formatDistance(trip.distanceKm)}` : ''}
        </p>

        <TripItinerary trip={trip} />
        <div className="bd">
          <div className="bd__main">
            {phase === 'awaiting_review' || phase === 'arranging' || phase === 'partner_confirmed' || rejected ? (
              <Notice tone={rejected ? 'error' : phase === 'awaiting_review' ? 'warning' : 'info'}>
                <strong>{status.label}.</strong> {pending ? 'Sending your request…' : status.detail}
              </Notice>
            ) : null}

            {tracking ? (
              <section className="card card--flush bd-live" aria-label="Live trip">
                <div className="bd-live__map">
                  <RouteMap
                    className="bd-live__canvas"
                    label="Live trip map"
                    pickup={phase === 'in_trip' ? null : trip.pickup}
                    drop={trip.drop}
                    driver={driverLoc ? { lat: driverLoc.lat, lng: driverLoc.lng, label: trip.driver?.name, stale: !driverFresh } : null}
                    userLocation={position}
                    path={legPath ?? wholePath}
                    basePath={legPath ? wholePath : null}
                    padding={{ top: 40, right: 40, bottom: 40, left: 40 }}
                  />
                </div>
                {hero ? (
                  <div className="bd-live__eta">
                    <strong className="num">{hero.big}</strong>
                    <span>{hero.small}</span>
                    {phase === 'driver_en_route' && straightKm != null && !eta ? <span>Driver is {formatDistance(straightKm)} from your pickup.</span> : null}
                    {streamingNote ? <small>{streamingNote}</small> : !driverLoc ? <small>Live location appears once your driver’s app shares it.</small> : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            <Card title="Journey details">
              <ul className="bd-journey">
                <li>
                  <Icon name="pickup" size={16} />
                  <span>
                    <strong>{trip.pickup.name}</strong>
                    {trip.pickup.address !== trip.pickup.name ? <small>{trip.pickup.address}</small> : null}
                  </span>
                </li>
                <li>
                  <Icon name="location-pin" size={16} />
                  <span>
                    <strong>{dropName}</strong>
                    {trip.drop.address !== trip.drop.name && trip.drop.id !== 'place-local-disposal' ? <small>{trip.drop.address}</small> : null}
                  </span>
                </li>
              </ul>
              <dl className="kv bd-journey__facts">
                {profile ? (
                  <div>
                    <dt>Passenger</dt>
                    <dd>
                      {profile.name} · <span className="num">{formatPhone(profile.phone)}</span>
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt>{at ? 'Pickup' : 'Booked'}</dt>
                  <dd>{at ? formatDateTime(at) : formatDateTime(trip.createdAt)}</dd>
                </div>
                <div>
                  <dt>Service</dt>
                  <dd>
                    {trip.service === 'Multicity' ? 'Multicity' : tripTypeLabel(trip.tripType)}
                    {trip.service ? ` · ${trip.service}` : ''}
                  </dd>
                </div>
                {trip.notes ? (
                  <div>
                    <dt>Notes</dt>
                    <dd>{trip.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </Card>

            {!finished && !rejected ? (
              <Card title="Driver details" action={<Badge tone={trip.driver ? 'blue' : 'green'}>{trip.driver ? 'Assigned' : 'To be arranged'}</Badge>}>
                {trip.driver ? (
                  <>
                    <div className="driver">
                      <Avatar name={trip.driver.name} photoUrl={trip.driver.photoUrl} size={48} />
                      <div className="driver__text">
                        <strong>{trip.driver.name}</strong>
                        <small>
                          {trip.driver.rating != null ? `★ ${trip.driver.rating.toFixed(1)} · ` : ''}
                          {trip.driver.vehicleModel || trip.categoryName}
                        </small>
                      </div>
                      {trip.driver.vehicleNumber ? <span className="plate">{trip.driver.vehicleNumber}</span> : null}
                    </div>
                    {showOtp ? (
                      <div className={`otp-box ${phase === 'driver_arrived' ? 'is-arrived' : ''}`}>
                        <div>
                          <strong>Boarding OTP</strong>
                          <small>{phase === 'driver_arrived' ? `Your driver is at ${trip.pickup.name}. Share this code only once you’re in the car.` : 'Share it with your driver only once you’re in the car.'}</small>
                        </div>
                        <span className="otp-box__code num" aria-label={`Boarding OTP ${otp ? otp.split('').join(' ') : 'not available yet'}`}>
                          {otp ?? '····'}
                        </span>
                      </div>
                    ) : phase === 'in_trip' ? (
                      <p className="bd-ok">
                        <Icon name="otp-security" size={15} /> Boarding OTP verified · trip started
                      </p>
                    ) : null}
                    {driverPhone ? (
                      <div className="bd-actions">
                        <a className="btn btn--secondary" href={`tel:+91${driverPhone}`}>
                          <Icon name="phone" size={17} /> Call driver
                        </a>
                        <a className="btn btn--secondary" href={`https://wa.me/91${driverPhone}`} target="_blank" rel="noopener noreferrer">
                          <Icon name="chat" size={17} /> WhatsApp
                        </a>
                        <Button variant="secondary" icon="share" onClick={() => void doShare()}>
                          Share trip
                        </Button>
                      </div>
                    ) : (
                      <p className="muted small">No phone number is on file for this driver. Call NESAM on {SUPPORT_PHONE_DISPLAY} if you need to reach them.</p>
                    )}
                    {driverPhone ? <p className="muted small">Calls go to {formatPhone(driverPhone)}.</p> : null}
                  </>
                ) : (
                  <>
                    <div className="driver driver--pending">
                      <span className="driver__ph" aria-hidden="true">
                        <Icon name="profile" size={20} />
                      </span>
                      <div className="driver__text">
                        <strong>{phase === 'awaiting_review' ? 'Driver details after confirmation' : 'Driver details before your pickup'}</strong>
                        <small>Details appear here as soon as a driver is assigned.</small>
                      </div>
                    </div>
                    <a className="btn btn--secondary btn--block" href={`tel:${SUPPORT_PHONE}`}>
                      <Icon name="phone" size={17} /> Call NESAM
                    </a>
                  </>
                )}
              </Card>
            ) : null}

            {phase === 'cancelled' ? (
              <Notice tone={trip.cancellationFee > 0 ? 'warning' : 'info'}>
                <strong>
                  {rejected ? 'This booking was not accepted' : trip.cancelledBy === 'customer' ? 'You cancelled this booking' : 'This booking was cancelled'}
                  {trip.cancelReason ? ` — “${trip.cancelReason}”` : ''}.
                </strong>{' '}
                {trip.cancellationFee > 0 ? `A cancellation fee of ${formatINR(trip.cancellationFee)} applies per our policy.` : 'No cancellation fee was charged.'}
                {trip.refund && trip.refund.amount > 0 ? ` Refund ${trip.refund.status.toLowerCase()}: ${formatINR(trip.refund.amount)}.` : ''}
              </Notice>
            ) : (
              <Card title="Trip progress">
                <Progress trip={trip} />
              </Card>
            )}

            {phase === 'completed' && profile ? <RatingCard trip={trip} profile={profile} /> : null}

            <Card title="Need help with this trip?" className="bd-help">
              <div>
                <ListRow icon="phone" title={`Call NESAM · ${SUPPORT_PHONE_DISPLAY}`} href={`tel:${SUPPORT_PHONE}`} tone="red" />
                {!finished ? <ListRow icon="share" title="Share trip details" onClick={() => void doShare()} /> : null}
                {!finished ? <ListRow icon="calendar" title="Request a change" text="Date, time or pickup — NESAM confirms any change" to={`/support?booking=${encodeURIComponent(trip.bookingId)}&topic=change`} /> : null}
                <ListRow icon="support" title="Get help with this trip" to={`/support?booking=${encodeURIComponent(trip.bookingId)}`} />
                {tracking ? <ListRow icon="emergency" title="Safety centre · SOS" onClick={() => setShowSafety(true)} tone="danger" /> : null}
                {canCancel ? <ListRow icon="cancellation" title="Cancel booking" text="Any fee is shown before you confirm" onClick={() => setShowCancel(true)} /> : null}
              </div>
            </Card>
          </div>

          <aside className="bd__aside">
            <Card title="Fare details">
              <FareBreakdown lines={tripFareLines(trip)} total={trip.fareBreakdown?.total ?? trip.fare} tolls={trip.tollCharges} />
              {printing ? <Notice tone="error">{printing}</Notice> : null}
              {phase === 'completed' ? (
                <Button variant="secondary" block icon="download" onClick={doPrint}>
                  Save or print receipt
                </Button>
              ) : null}
            </Card>

            {phase !== 'cancelled' && !rejected ? (
              <Card title="Payment">
                {isPaid(trip) ? (
                  <p className="bd-paid">
                    <Icon name="success" size={18} /> Paid {formatINR(trip.paid?.totalPaid || payableAmount(trip))} via {trip.paymentMethod}
                  </p>
                ) : (
                  <>
                    <dl className="kv">
                      <div>
                        <dt>Payment method</dt>
                        <dd>{trip.paymentMethod === 'UPI' ? 'UPI to driver' : 'Cash to driver'}</dd>
                      </div>
                      {trip.paid && trip.paid.totalPaid > 0 ? (
                        <div>
                          <dt>Paid so far</dt>
                          <dd className="num">{formatINR(trip.paid.totalPaid)}</dd>
                        </div>
                      ) : null}
                      <div>
                        <dt>Balance</dt>
                        <dd className="num">{formatINR(due)}</dd>
                      </div>
                    </dl>
                    <p className="bd-pay-note">{phase === 'completed' ? 'Your driver confirms the payment once collected.' : 'Collected by your driver at the end of the trip. Tolls and parking, if any, are added at actuals. Final charges are reviewed when your trip closes.'}</p>
                    {CUSTOMER_PAYMENTS_ENABLED && trip.paymentMethod === 'UPI' && upiLink(trip) && trip.status !== 'Pending' ? (
                      <a className="btn btn--secondary btn--block" href={upiLink(trip)!}>
                        <Icon name="payment-card" size={17} /> Open UPI app · {formatINR(due)}
                      </a>
                    ) : null}
                  </>
                )}
              </Card>
            ) : null}

            {finished ? (
              <Button block size="lg" onClick={bookAgain}>
                {phase === 'completed' ? 'Book this trip again' : 'Book another cab'}
              </Button>
            ) : null}
          </aside>
        </div>
      </div>

      <FlowBar back={() => ((window.history.state as { idx?: number } | null)?.idx ? navigate(-1) : navigate('/trips'))}>
        {tracking && driverPhone ? (
          <a className="btn btn--primary btn--lg btn--block" href={`tel:+91${driverPhone}`}>
            <Icon name="phone" size={17} /> Call {trip.driver?.name.split(' ')[0] ?? 'driver'}
          </a>
        ) : null}
      </FlowBar>

      {showCancel ? <CancelDialog trip={trip} onClose={() => setShowCancel(false)} /> : null}
      {showSafety && profile ? <SafetyDialog trip={trip} profile={profile} location={sharePoint} onClose={() => setShowSafety(false)} /> : null}
    </div>
  );
}
