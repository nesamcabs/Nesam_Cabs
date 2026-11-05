// Local Taxi for drivers: go online, receive one ride offer at a time, accept it, and run the ride
// (on the way → arrived → ride code → on trip → complete → collect cash). Every step is checked by the server against
// the ride's state machine, your assignment and a fresh GPS fix, so a tap here can never skip a step.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { ActionError, callFunction } from '../services/callables';
import { auth, db } from '../services/firebase';
import { getFirebaseLocation } from '../services/location';

interface Spot { lat: number; lng: number; name: string }
interface Offer { id: string; rideId: string; expiresAtMs: number; pickup: Spot; drop: Spot; distanceToPickupMeters: number; tripDistanceMeters: number; estimatedEarningsPaise: number; paymentMethod: string }
interface Ride {
  id: string; status: string; customerName?: string; pickup: Spot; drop: Spot; paymentMethod: string; paymentStatus: string; arrivedAtMs?: number | null;
  final?: { totalPaise: number } | null; estimate: { totalPaise: number };
}
interface DriverState { online?: boolean; available?: boolean; zoneIds?: string[]; activeRideId?: string | null; location?: { atMs: number } | null }

const rupees = (p: number) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const errText = (e: unknown) => (e instanceof ActionError ? e.message : 'Something went wrong. Please try again.');
const navUrl = (s: Spot) => `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=driving`;
const HEARTBEAT_MS = 10000;

export const LocalTaxiScreen: React.FC = () => {
  const uid = auth.currentUser?.uid ?? '';
  const [state, setState] = useState<DriverState | null | undefined>(undefined);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [ride, setRide] = useState<Ride | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [otp, setOtp] = useState('');
  const [earned, setEarned] = useState(0);
  const online = state?.online === true;
  const [lastId, setLastId] = useState('');
  // The server frees you the moment a ride completes, but cash may still be waiting to be collected: keep that ride in view.
  const rideId = state?.activeRideId || lastId;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => { if (state?.activeRideId) setLastId(state.activeRideId); }, [state?.activeRideId]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  useEffect(() => (uid ? onSnapshot(doc(db, 'lt_driver_state', uid), (s) => setState(s.exists() ? (s.data() as DriverState) : null), () => setState(null)) : undefined), [uid]);
  useEffect(() => (uid ? onSnapshot(query(collection(db, 'lt_offers'), where('driverId', '==', uid), where('status', '==', 'pending')), (s) => setOffers(s.docs.map((d) => ({ ...(d.data() as Omit<Offer, 'id'>), id: d.id })))) : undefined), [uid]);
  useEffect(() => (rideId ? onSnapshot(doc(db, 'lt_rides', rideId), (s) => setRide(s.exists() ? ({ ...(s.data() as Omit<Ride, 'id'>), id: s.id }) : null)) : (setRide(null), undefined)), [rideId]);
  useEffect(() => {
    if (!uid) return undefined;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return onSnapshot(query(collection(db, 'lt_settlements'), where('driverId', '==', uid)), (s) => setEarned(s.docs.reduce((sum, d) => (Number(d.data().createdAtMs) >= start.getTime() ? sum + Number(d.data().driverEarningsPaise ?? 0) : sum), 0)));
  }, [uid]);

  const fix = useCallback(async () => {
    const f = await getFirebaseLocation(9000, 100);
    if (!f) throw new ActionError('We could not get your location. Turn on GPS and allow location for this app.');
    return f;
  }, []);

  // The heartbeat: while online the server needs a fresh position to offer you rides and to track the trip.
  useEffect(() => {
    if (!online) return undefined;
    let stop = false;
    const beat = async () => {
      try { const f = await getFirebaseLocation(8000); if (f && !stop) await callFunction('ltUpdateLocation', { location: f }); } catch { /* the next beat retries */ }
    };
    void beat();
    const t = window.setInterval(() => void beat(), HEARTBEAT_MS);
    return () => { stop = true; window.clearInterval(t); };
  }, [online]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(''); }
  };
  const toggle = () => run('online', async () => {
    if (online) await callFunction('ltSetAvailability', { online: false });
    else await callFunction('ltSetAvailability', { online: true, location: await fix() });
  });
  const respond = (o: Offer, accept: boolean) => run(`offer-${o.id}`, () => callFunction('ltRespondOffer', { offerId: o.id, accept }));
  const step = (action: string, extra: Record<string, unknown> = {}, needsFix = false) => run(action, async () => {
    await callFunction('ltDriverAdvance', { rideId, action, ...(needsFix ? { location: await fix() } : {}), ...extra });
    setOtp('');
  });

  if (state === undefined) return <div className="lt-d"><p>Loading…</p></div>;
  if (!state || !(state.zoneIds ?? []).length) {
    return <div className="lt-d"><h2>Local Taxi</h2><p className="lt-d__note">You are not enabled for Local Taxi yet. Ask the office to enable your service area and vehicle type, then come back here.</p></div>;
  }
  const waitedMs = ride?.arrivedAtMs ? now - ride.arrivedAtMs : 0;
  const cashDue = ride?.status === 'completed' && ride.paymentMethod === 'cash' && ride.paymentStatus === 'cash_due';
  const showRide = !!ride && !['cancelled', 'no_driver_available', 'expired'].includes(ride.status) && (ride.status !== 'completed' || cashDue);

  return (
    <div className="lt-d">
      <div className="lt-d__bar">
        <div><h2>Local Taxi</h2><small>{online ? (state.available ? 'Online · waiting for rides' : 'Online · on a ride') : 'Offline'} · today {rupees(earned)}</small></div>
        <button type="button" className={`lt-d__btn ${online ? 'is-off' : ''}`} disabled={busy === 'online' || (online && !!state?.activeRideId)} onClick={() => void toggle()}>{online ? 'Go offline' : 'Go online'}</button>
      </div>
      {error ? <p className="lt-d__error" role="alert">{error}</p> : null}

      {!showRide || !ride ? (
        online ? (
          offers.length ? offers.map((o) => {
            const left = Math.max(0, o.expiresAtMs - now);
            return (
              <section key={o.id} className="lt-d__card lt-d__offer" aria-label="New ride request">
                <div className="lt-d__row"><strong>New request</strong><span className={left < 6000 ? 'lt-d__urgent' : ''}>{Math.ceil(left / 1000)}s</span></div>
                <p><b>Pickup:</b> {o.pickup.name} · {km(o.distanceToPickupMeters)} away</p>
                <p><b>Drop:</b> {o.drop.name} · trip {km(o.tripDistanceMeters)}</p>
                <p><b>You earn about {rupees(o.estimatedEarningsPaise)}</b> · {o.paymentMethod === 'cash' ? 'cash' : 'online payment'}</p>
                <div className="lt-d__row">
                  <button type="button" className="lt-d__btn" disabled={!!busy || left === 0} onClick={() => void respond(o, true)}>Accept</button>
                  <button type="button" className="lt-d__btn is-off" disabled={!!busy} onClick={() => void respond(o, false)}>Decline</button>
                </div>
              </section>
            );
          }) : <p className="lt-d__note">You are online. We will show a request here as soon as a rider nearby needs a cab. Keep this screen open and GPS on.</p>
        ) : <p className="lt-d__note">Go online to receive Local Taxi requests in your service area.</p>
      ) : (
        <section className="lt-d__card" aria-label="Current ride">
          <div className="lt-d__row"><strong>{ride.status.replace(/_/g, ' ')}</strong><span>{ride.customerName || 'Rider'}</span></div>
          <p><b>Pickup:</b> {ride.pickup.name} <a href={navUrl(ride.pickup)} target="_blank" rel="noreferrer">Navigate</a></p>
          <p><b>Drop:</b> {ride.drop.name} <a href={navUrl(ride.drop)} target="_blank" rel="noreferrer">Navigate</a></p>
          <p><b>Fare:</b> {rupees(ride.final?.totalPaise ?? ride.estimate.totalPaise)}{ride.final ? '' : ' (estimate)'} · {ride.paymentMethod === 'cash' ? 'cash' : 'online'}</p>

          {ride.status === 'assigned' ? <button type="button" className="lt-d__btn" disabled={!!busy} onClick={() => void step('depart')}>Start towards pickup</button> : null}
          {ride.status === 'driver_arriving' ? <button type="button" className="lt-d__btn" disabled={!!busy} onClick={() => void step('arrived', {}, true)}>I have arrived</button> : null}
          {ride.status === 'driver_arrived' ? (
            <div className="lt-d__otp">
              <label>Ride code from the rider<input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="4 digits" /></label>
              <button type="button" className="lt-d__btn" disabled={otp.length !== 4 || !!busy} onClick={() => void step('start', { otp }, true)}>Start ride</button>
              <button type="button" className="lt-d__btn is-off" disabled={!!busy || waitedMs < 300000} onClick={() => void step('no_show')}>{waitedMs < 300000 ? `Rider did not come (wait ${Math.ceil((300000 - waitedMs) / 60000)} min)` : 'Rider did not come'}</button>
            </div>
          ) : null}
          {ride.status === 'in_progress' ? <button type="button" className="lt-d__btn" disabled={!!busy} onClick={() => void step('complete', {}, true)}>Complete ride</button> : null}
          {cashDue ? <button type="button" className="lt-d__btn" disabled={!!busy} onClick={() => void step('collect_cash', { amountPaise: ride.final!.totalPaise })}>Collected {rupees(ride.final!.totalPaise)} cash</button> : null}
          {['assigned', 'driver_arriving', 'driver_arrived'].includes(ride.status) ? <button type="button" className="lt-d__link" disabled={!!busy} onClick={() => void step('release', { reason: 'Driver unable to continue' })}>Give this ride back</button> : null}
        </section>
      )}
    </div>
  );
};
export default LocalTaxiScreen;
