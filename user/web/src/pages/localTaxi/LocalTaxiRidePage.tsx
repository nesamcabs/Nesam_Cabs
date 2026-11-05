// A Local Taxi ride, live: searching → driver assigned → arriving → arrived → on trip → completed (receipt, payment,
// rating), plus every way it can end early. The ride document is the single source of truth and updates in real time;
// if the live connection drops the page keeps itself current by asking the server, and says so.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ActionError } from '@core/services/callables';
import { Button, Dialog, EmptyState, Notice, PageHead, PageLoader } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useSeo } from '@/lib/seo';
import { useOnline } from '@/lib/hooks';
import { ZoneMapView } from './ZoneMapView';
import { cancelRide, cancellationQuote, createPaymentOrder, getRide, km, rateRide, rupees, verifyPayment, watchDriver, watchOtp, watchRide, type DriverLocation, type RideView } from './api';

const ACTIVE = ['searching', 'assigned', 'driver_arriving', 'driver_arrived', 'in_progress'];
const STEPS: { id: string; label: string }[] = [
  { id: 'searching', label: 'Finding driver' }, { id: 'assigned', label: 'Driver assigned' }, { id: 'driver_arriving', label: 'On the way' },
  { id: 'driver_arrived', label: 'Arrived' }, { id: 'in_progress', label: 'On trip' }, { id: 'completed', label: 'Done' },
];
const HEADLINE: Record<string, string> = {
  searching: 'Finding you a driver…', assigned: 'Driver assigned', driver_arriving: 'Your driver is on the way', driver_arrived: 'Your driver has arrived', in_progress: 'You are on your trip',
  completed: 'Trip completed', cancelled: 'Ride cancelled', no_driver_available: 'No driver available', expired: 'Request expired',
};
const errText = (e: unknown) => (e instanceof ActionError ? e.message : 'Something went wrong. Please try again.');

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: any) => void) => void } } }
const loadCheckout = () => new Promise<boolean>((resolve) => {
  if (window.Razorpay) return resolve(true);
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = () => resolve(true);
  s.onerror = () => resolve(false);
  document.head.appendChild(s);
});

export function LocalTaxiRidePage() {
  useSeo({ title: 'Your Local Taxi ride', noindex: true });
  const { id = '' } = useParams();
  const online = useOnline().online;
  const [ride, setRide] = useState<RideView | null | undefined>(undefined);
  const [otp, setOtp] = useState<string | null>(null);
  const [driver, setDriver] = useState<DriverLocation | null>(null);
  const [live, setLive] = useState(true);
  const [error, setError] = useState('');
  const [cancelInfo, setCancelInfo] = useState<{ feePaise: number; message: string; canCancel: boolean } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [paying, setPaying] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [rated, setRated] = useState(false);
  const status = ride?.status ?? '';
  const statusRef = useRef(status);
  statusRef.current = status;

  const refresh = useCallback(async () => {
    try { const r = await getRide(id); setRide(r.ride); if (r.otp) setOtp(r.otp); if (r.driverLocation) setDriver(r.driverLocation); setError(''); }
    catch (e) { if (ride === undefined) setRide(null); setError(errText(e)); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => watchRide(id, (r) => { setRide(r); setLive(true); }, () => { setLive(false); void refresh(); }), [id, refresh]);
  useEffect(() => (['assigned', 'driver_arriving', 'driver_arrived'].includes(status) ? watchOtp(id, setOtp) : undefined), [id, status]);
  useEffect(() => (['assigned', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(status) ? watchDriver(id, setDriver) : undefined), [id, status]);
  // While searching the poll also moves the search along on the server; without a live connection it keeps everything current.
  useEffect(() => {
    if (!online) return undefined;
    const every = status === 'searching' ? 6000 : !live && ACTIVE.includes(status) ? 10000 : 0;
    if (!every) return undefined;
    const t = window.setInterval(() => void refresh(), every);
    return () => window.clearInterval(t);
  }, [status, live, online, refresh]);
  useEffect(() => { if (online) void refresh(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCancel = async () => {
    setError('');
    try { setCancelInfo(await cancellationQuote(id)); } catch (e) { setError(errText(e)); }
  };
  const confirmCancel = async () => {
    if (!cancelInfo) return;
    setCancelling(true);
    try { await cancelRide(id, cancelInfo.feePaise, 'Cancelled by customer'); setCancelInfo(null); await refresh(); }
    catch (e) {
      // The fee changed while the dialog was open: show the new amount and ask again instead of charging blindly.
      if (e instanceof ActionError && e.message === 'CANCELLATION_FEE') { const fee = (e.details as { feePaise?: number })?.feePaise ?? 0; setCancelInfo({ ...cancelInfo, feePaise: fee }); }
      else { setCancelInfo(null); setError(errText(e)); }
    } finally { setCancelling(false); }
  };

  const payOnline = async () => {
    if (!ride || paying) return;
    setPaying(true); setError('');
    try {
      const order = await createPaymentOrder(ride.id);
      if (!(await loadCheckout()) || !window.Razorpay) throw new Error('checkout');
      const rzp = new window.Razorpay({
        key: order.keyId, order_id: order.orderId, amount: order.amount, currency: order.currency, name: 'NESAM Cabs', description: 'Local Taxi ride',
        handler: (r: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          void verifyPayment({ rideId: ride.id, razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature })
            .then(() => refresh()).catch((e) => setError(errText(e))).finally(() => setPaying(false));
        },
        modal: { ondismiss: () => setPaying(false) },
      });
      rzp.on('payment.failed', () => { setError('The payment failed. You have not been charged. Please try again.'); setPaying(false); });
      rzp.open();
    } catch (e) {
      setPaying(false);
      setError(e instanceof ActionError ? (e.message === 'PAYMENT_NOT_CONFIGURED' ? 'Online payment is not available right now. Please pay your driver in cash.' : e.message) : 'We could not start the payment. Check your connection and try again.');
    }
  };

  const submitRating = async () => {
    try { await rateRide(id, stars, comment); setRated(true); } catch (e) { setError(errText(e)); }
  };

  if (ride === undefined) return <PageLoader label="Loading your ride…" />;
  if (ride === null) return <div className="page"><EmptyState title="We could not open this ride">{error || 'It may not be yours, or it no longer exists.'}<div><Link to="/local-taxi">Book a Local Taxi</Link></div></EmptyState></div>;

  const step = STEPS.findIndex((s) => s.id === status);
  const due = ride.status === 'completed' && ride.paymentStatus === 'payment_due';
  const feeDue = ride.status === 'cancelled' && ride.paymentStatus === 'cancellation_fee_due';

  return (
    <>
      <PageHead title={HEADLINE[status] ?? 'Your ride'}>{ride.zoneName} · {ride.categoryName}</PageHead>
      <div className="page lt">
        {!online ? <Notice tone="warning">You are offline. We will update this page when you reconnect.</Notice> : !live && ACTIVE.includes(status) ? <Notice tone="info">Live updates paused. Refreshing every few seconds.</Notice> : null}
        {error ? <Notice tone="error" action={<Button size="sm" variant="secondary" onClick={() => void refresh()}>Retry</Button>}>{error}</Notice> : null}

        {ACTIVE.includes(status) || status === 'completed' ? (
          <ol className="lt-steps" aria-label="Ride progress">{STEPS.map((s, i) => <li key={s.id} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}><span />{s.label}</li>)}</ol>
        ) : null}

        <ZoneMapView pickup={ride.pickup} drop={ride.drop} driver={driver && ACTIVE.includes(status) ? driver : null} label="Map of your ride" />

        {status === 'searching' ? <section className="lt-card"><p className="lt-note"><span className="lt-pulse" /> Looking for a driver near your pickup. This usually takes under a minute. You are not charged until the ride ends.</p></section> : null}

        {ride.driverName && ['assigned', 'driver_arriving', 'driver_arrived', 'in_progress'].includes(status) ? (
          <section className="lt-card" aria-label="Your driver">
            <div className="lt-driver"><span className="lt-avatar" aria-hidden="true"><Icon name="profile" size={22} /></span>
              <div><strong>{ride.driverName}</strong><small>{ride.driverVehicle?.type} · {ride.driverVehicle?.number}</small></div>
              {ride.driverPhone && status !== 'in_progress' ? <a className="lt-call" href={`tel:${ride.driverPhone}`} aria-label={`Call ${ride.driverName}`}><Icon name="phone" size={18} /></a> : null}</div>
            {driver && Date.now() - driver.atMs > 90000 ? <p className="lt-fine">Driver location last updated {Math.round((Date.now() - driver.atMs) / 60000)} min ago.</p> : null}
          </section>
        ) : null}

        {otp && ['assigned', 'driver_arriving', 'driver_arrived'].includes(status) ? (
          <section className="lt-card lt-otp" aria-label="Ride code"><small>Your ride code</small><strong className="num">{otp.split('').join(' ')}</strong><p className="lt-fine">Tell this code to your driver only when you are in the cab. The trip cannot start without it.</p></section>
        ) : null}

        <section className="lt-card" aria-label="Trip details">
          <div className="lt-route"><div><small>Pickup</small><strong>{ride.pickup.name}</strong></div><div><small>Drop</small><strong>{ride.drop.name}</strong></div></div>
          <p className="lt-fine">Distance about {km(ride.route.distanceMeters)} · estimated fare {rupees(ride.estimate.totalPaise)} · {ride.paymentMethod === 'cash' ? 'pay your driver in cash' : 'pay online after the ride'}</p>
        </section>

        {status === 'completed' && ride.final ? (
          <section className="lt-card" aria-label="Receipt">
            <h2 className="lt-h">Receipt</h2>
            <dl className="lt-lines">{ride.final.lines.map((l) => <div key={l.code}><dt>{l.label}</dt><dd className="num">{rupees(l.amountPaise)}</dd></div>)}<div className="lt-lines__total"><dt>Total</dt><dd className="num">{rupees(ride.final.totalPaise)}</dd></div></dl>
            <p className="lt-fine">Distance charged: {km(ride.final.distanceMeters)} ({ride.final.basis === 'tracked' ? 'tracked on your trip' : ride.final.basis === 'capped' ? 'tracked, limited to the distance cap shown when you booked' : 'as quoted'}).</p>
            {ride.paymentStatus === 'cash_due' ? <Notice tone="info">Please pay {rupees(ride.final.totalPaise)} in cash to your driver.</Notice> : null}
            {ride.paymentStatus === 'cash_collected' || ride.paymentStatus === 'paid' ? <Notice tone="success">Payment received. Thank you!</Notice> : null}
            {due ? <Button size="lg" block loading={paying} onClick={() => void payOnline()}>Pay {rupees(ride.final.totalPaise)} online</Button> : null}
          </section>
        ) : null}

        {status === 'completed' ? (
          <section className="lt-card" aria-label="Rate your driver">
            {ride.rating || rated ? <p className="lt-note lt-note--ok"><Icon name="check" size={16} /> Thanks for rating your ride.</p> : (
              <>
                <h2 className="lt-h">Rate your ride</h2>
                <div className="lt-stars" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= stars ? 'is-on' : ''} onClick={() => setStars(n)}><Icon name="star" size={28} /></button>)}</div>
                <textarea className="lt-text" rows={2} maxLength={400} placeholder="Anything to add? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <Button size="lg" block disabled={!stars} onClick={() => void submitRating()}>Submit rating</Button>
              </>
            )}
          </section>
        ) : null}

        {status === 'cancelled' ? (
          <section className="lt-card"><p>{ride.cancelledBy === 'driver' ? 'Your driver waited at the pickup and the ride was cancelled.' : ride.cancelledBy === 'admin' ? 'This ride was cancelled by our team.' : 'You cancelled this ride.'}</p>
            {ride.cancellationFeePaise > 0 ? <Notice tone="warning" action={feeDue ? <Button size="sm" loading={paying} onClick={() => void payOnline()}>Pay fee online</Button> : undefined}>A cancellation fee of {rupees(ride.cancellationFeePaise)} applies{ride.paymentStatus === 'cancellation_fee_due' ? '.' : ' and was settled.'}</Notice> : <p className="lt-fine">You were not charged.</p>}
          </section>
        ) : null}
        {status === 'no_driver_available' ? <section className="lt-card"><p>We could not find a driver nearby. You have not been charged.</p></section> : null}

        <div className="lt-actions">
          {ACTIVE.includes(status) && status !== 'in_progress' ? <Button variant="danger" onClick={() => void openCancel()}>Cancel ride</Button> : null}
          {!ACTIVE.includes(status) ? <Link className="btn btn--primary" to="/local-taxi">Book another ride</Link> : null}
          <Link className="btn btn--secondary" to="/trips">My trips</Link>
        </div>
      </div>

      {cancelInfo ? (
        <Dialog title="Cancel this ride?" onClose={() => !cancelling && setCancelInfo(null)} footer={<><Button variant="secondary" onClick={() => setCancelInfo(null)} disabled={cancelling}>Keep ride</Button><Button variant="danger" loading={cancelling} disabled={!cancelInfo.canCancel} onClick={() => void confirmCancel()}>Cancel ride</Button></>}>
          {cancelInfo.canCancel ? (cancelInfo.feePaise > 0 ? <p>Your driver has already been assigned for a while. A cancellation fee of <b>{rupees(cancelInfo.feePaise)}</b> will apply.</p> : <p>You will not be charged for cancelling now.</p>) : <p>{cancelInfo.message}</p>}
        </Dialog>
      ) : null}
    </>
  );
}
export default LocalTaxiRidePage;
