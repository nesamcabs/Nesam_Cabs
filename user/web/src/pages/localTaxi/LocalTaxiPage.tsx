// Local Taxi: pick a pickup and drop inside a service area, then choose a ride on a full-screen map with a bottom sheet
// (vehicle cards, payment, fare details, Ride Now). Availability and prices come from the server, which also re-checks
// the boundary when you book, so nothing here can change what you are charged. A fare is locked for a few minutes.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GeoPlace } from '@core/types';
import { ActionError } from '@core/services/callables';
import { Button, Dialog, Notice, PageHead, Spinner } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LocationPicker, type PickerConfig } from '@/components/LocationPicker';
import { useSeo } from '@/lib/seo';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { reverseGeocode } from '@core/services/geoService';
import { vehicleArtUrl } from '@/lib/vehicleArt';
import { useAuth } from '@/state/Auth';
import { useBooking } from '@/state/Booking';
import { ZoneMapView, useActiveZoneState } from './ZoneMapView';
import { ZONE_MESSAGES, checkServiceability, createRide, getQuotes, km, newRequestId, routePath, rupees, type Quote, type QuoteResponse, type Serviceability, type Spot } from './api';

const spotOf = (p: GeoPlace | null): Spot | null => (p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng, name: p.name, address: p.address || p.name } : null);
const errText = (e: unknown) => (e instanceof ActionError ? e.message : 'Something went wrong. Please try again.');
const reasonOf = (e: unknown) => ((e as { details?: { reason?: string; rideId?: string } })?.details ?? {}) as { reason?: string; rideId?: string };
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const away = (q: Quote) => (!q.available ? 'No drivers nearby' : q.etaMinutes ? `${String(q.etaMinutes).padStart(2, '0')} min. away` : 'Nearby');

/**
 * Development only (`/local-taxi?preview=1`): shows the Select Vehicle screen with sample places and fares so the design
 * can be reviewed before a service area, fares and drivers exist. It never runs in a production build and never books.
 */
const PREVIEW = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1';
const PREVIEW_PICKUP = { id: 'pv-a', name: 'Erode Junction', address: 'Erode', lat: 11.3275, lng: 77.7156, type: 'other' } as GeoPlace;
const PREVIEW_DROP = { id: 'pv-b', name: 'Perundurai Road', address: 'Erode', lat: 11.3512, lng: 77.7390, type: 'other' } as GeoPlace;
const previewQuotes = (): QuoteResponse => ({
  zone: { id: 'preview', name: 'Erode (sample)' }, distanceMeters: 4200, durationSeconds: 960,
  policy: { estimate: 'This is an estimate based on the road route and expected travel time. The final fare is calculated from the actual trip.', final: 'Your final fare uses the actual ride time and the tracked distance.', boundary: 'Pickup and drop must be inside the service area.' },
  payment: { cash: true, online: true },
  quotes: [
    { quoteId: 'pv-1', categoryId: 'sedan', categoryName: 'Sedan', seats: 4, totalPaise: 12000, lines: [{ code: 'base', label: 'Base fare', amountPaise: 5000 }, { code: 'distance', label: 'Distance beyond 2.0 km', amountPaise: 2640 }, { code: 'time', label: 'Ride time', amountPaise: 2400 }, { code: 'minimum', label: 'Minimum fare adjustment', amountPaise: 1960 }], expiresAtMs: Date.now() + 3600000, available: true, availableDrivers: 4, etaMinutes: 5, sampleFare: true, distanceCapMeters: 6300, cancellationFeePaise: 3000, cancellationGraceSeconds: 120 },
    { quoteId: 'pv-2', categoryId: 'suv', categoryName: 'SUV', seats: 6, totalPaise: 15500, lines: [{ code: 'base', label: 'Base fare', amountPaise: 7000 }, { code: 'distance', label: 'Distance beyond 2.0 km', amountPaise: 3520 }, { code: 'time', label: 'Ride time', amountPaise: 3000 }, { code: 'minimum', label: 'Minimum fare adjustment', amountPaise: 1980 }], expiresAtMs: Date.now() + 3600000, available: true, availableDrivers: 2, etaMinutes: 8, sampleFare: true, distanceCapMeters: 6300, cancellationFeePaise: 5000, cancellationGraceSeconds: 120 },
    { quoteId: 'pv-3', categoryId: 'mini', categoryName: 'Mini', seats: 4, totalPaise: 9500, lines: [{ code: 'base', label: 'Base fare', amountPaise: 4000 }, { code: 'distance', label: 'Distance beyond 2.0 km', amountPaise: 2200 }, { code: 'time', label: 'Ride time', amountPaise: 1800 }, { code: 'minimum', label: 'Minimum fare adjustment', amountPaise: 1500 }], expiresAtMs: Date.now() + 3600000, available: false, availableDrivers: 0, etaMinutes: null, sampleFare: true, distanceCapMeters: 6300, cancellationFeePaise: 2500, cancellationGraceSeconds: 120 },
  ],
});

export function LocalTaxiPage() {
  useSeo({ title: 'Local Taxi', noindex: true });
  const navigate = useNavigate();
  const online = useOnline().online;
  const { state: auth, openLoginModal } = useAuth();
  const { draft, update } = useBooking();
  const [pickup, setPickup] = useState<GeoPlace | null>(PREVIEW ? PREVIEW_PICKUP : draft.pickup);
  // With no pickup chosen yet, the device location is the default pickup.
  const { position } = useDeviceLocation(true, true);
  const pickupFromGps = useRef(false);
  useEffect(() => {
    if (PREVIEW || !position || pickupFromGps.current || pickup) return;
    pickupFromGps.current = true;
    void reverseGeocode(position).then((p) => setPickup((now) => now ?? { ...p, type: 'current' }));
  }, [position, pickup]);
  const [drop, setDrop] = useState<GeoPlace | null>(PREVIEW ? PREVIEW_DROP : draft.drop);
  const [picker, setPicker] = useState<'pickup' | 'drop' | null>(null);
  const [avail, setAvail] = useState<Serviceability | null>(null);
  const [checking, setChecking] = useState(false);
  const [quotes, setQuotes] = useState<QuoteResponse | null>(() => (PREVIEW ? previewQuotes() : null));
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [selected, setSelected] = useState(PREVIEW ? 'pv-1' : '');
  const [method, setMethod] = useState<'cash' | 'online' | ''>(PREVIEW ? 'cash' : '');
  const [details, setDetails] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState<[number, number][]>([]);
  const [recheck, setRecheck] = useState(0);
  const zoneState = useActiveZoneState();
  const [now, setNow] = useState(Date.now());
  const requestIds = useRef(new Map<string, string>()); // one request id per quote: a retry or double tap books once

  const p = spotOf(pickup);
  const d = spotOf(drop);
  const key = `${p?.lat},${p?.lng},${d?.lat},${d?.lng}`;
  const selecting = !!quotes;

  // Is Local Taxi available for these places? Re-checked whenever a place changes; the server is the judge.
  useEffect(() => {
    if (PREVIEW) return undefined;
    setQuotes(null); setSelected(''); setError(''); setPath([]);
    if (!p) { setAvail(null); return undefined; }
    let live = true;
    setChecking(true);
    void checkServiceability(p, d)
      .then((r) => live && setAvail(r))
      .catch(() => live && setAvail({ available: false, failed: true, message: 'We could not check availability. Check your connection and try again.' }))
      .finally(() => live && setChecking(false));
    return () => { live = false; };
  }, [key, recheck]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  // The select-a-ride screen is full screen: keep the page behind it from scrolling.
  useEffect(() => {
    if (!selecting) return undefined;
    const old = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; };
  }, [selecting]);

  const fetchQuotes = async () => {
    if (!p || !d) return;
    setLoadingQuotes(true); setError(''); setSelected('');
    try {
      const r = await getQuotes(p, d);
      setQuotes(r);
      setMethod((m) => (m === 'cash' && r.payment.cash) || (m === 'online' && r.payment.online) ? m : r.payment.cash ? 'cash' : r.payment.online ? 'online' : '');
      const first = r.quotes.find((q) => q.available);
      if (first) setSelected(first.quoteId);
      void routePath(p, d).then(setPath);
    } catch (e) {
      setQuotes(null);
      const reason = reasonOf(e).reason;
      setError(reason && ZONE_MESSAGES[reason] ? ZONE_MESSAGES[reason]! : errText(e));
    } finally { setLoadingQuotes(false); }
  };

  const seeFares = () => {
    if (!online) { setError('You are offline. Reconnect to see fares.'); return; }
    if (auth.status !== 'ready') { openLoginModal({ title: 'Sign in to see fares', subtitle: 'Verify your mobile number to book Local Taxi.', onSuccess: () => void fetchQuotes() }); return; }
    void fetchQuotes();
  };

  const chosen: Quote | undefined = quotes?.quotes.find((q) => q.quoteId === selected);
  const expired = !!chosen && now >= chosen.expiresAtMs;
  const backToPlan = () => { setQuotes(null); setSelected(''); setError(''); setDetails(false); };

  const book = async () => {
    if (!chosen || !method || booking) return;
    if (PREVIEW) { setError('Preview only: nothing is booked. This screen uses sample places and fares.'); return; }
    if (!online) { setError('You are offline. Reconnect to book.'); return; }
    setBooking(true); setError('');
    let requestId = requestIds.current.get(chosen.quoteId);
    if (!requestId) { requestId = newRequestId(); requestIds.current.set(chosen.quoteId, requestId); }
    try {
      const r = await createRide({ requestId, quoteId: chosen.quoteId, paymentMethod: method });
      update({ pickup, drop });
      navigate(`/local-taxi/ride/${r.rideId}`);
    } catch (e) {
      const { reason, rideId } = reasonOf(e);
      if (reason === 'active_ride' && rideId) { navigate(`/local-taxi/ride/${rideId}`); return; }
      if (reason === 'quote_expired' || reason === 'quote_used') { setError('This fare expired. We refreshed it; please check the new fare.'); requestIds.current.delete(chosen.quoteId); void fetchQuotes(); }
      else setError(errText(e));
    } finally { setBooking(false); }
  };

  const config = (f: 'pickup' | 'drop'): PickerConfig => ({
    title: f === 'pickup' ? 'Pickup location' : 'Drop location', allowCurrent: true, popular: [], popularLabel: 'Nearby', near: f === 'drop' ? pickup : null, pinMode: f,
    subtitle: 'Search a place inside the Local Taxi area, or drop a pin on the map.',
  });
  const picking = picker ? (
    <LocationPicker
      config={config(picker)} saved={[]} recent={[]} onClose={() => setPicker(null)}
      onSelect={(place) => { if (picker === 'pickup') setPickup(place); else setDrop(place); setPicker(null); }}
    />
  ) : null;

  // ── Select a ride: full-screen map + bottom sheet ───────────────────────────────────────────────────────────────
  if (quotes) {
    const noneFree = quotes.quotes.every((q) => !q.available);
    const payments = [quotes.payment.cash ? ['cash', 'Cash'] : null, quotes.payment.online ? ['online', 'Online'] : null].filter(Boolean) as [string, string][];
    return (
      <div className="lts" role="dialog" aria-label="Select vehicle">
        <header className="lts__bar">
          <button type="button" className="lts__back" aria-label="Back" onClick={backToPlan}><Icon name="arrow-left" size={22} /></button>
          <h1>Select Vehicle</h1>
        </header>
        <div className="lts__map">
          <ZoneMapView fill pickup={p} drop={d} route={path} label="Map of your trip" onPickupClick={backToPlan} onDropClick={backToPlan} />
        </div>
        <section className="lts__sheet" aria-label="Choose a ride">
          <span className="lts__grip" aria-hidden="true" />
          <div className="lts__head"><h2>Choose A Ride</h2><small>{km(quotes.distanceMeters)} · about {Math.max(1, Math.round(quotes.durationSeconds / 60))} min</small></div>
          <div className="lts__list">
            {quotes.quotes.map((q) => (
              <button key={q.quoteId} type="button" className={`lts-ride ${selected === q.quoteId ? 'is-on' : ''}`} disabled={!q.available} aria-pressed={selected === q.quoteId} onClick={() => setSelected(q.quoteId)}>
                <img src={q.imageUrl || vehicleArtUrl({ name: q.categoryName, seats: q.seats ?? 4 })} alt="" width={84} height={54} loading="lazy" />
                <span className="lts-ride__txt"><strong>{q.iconUrl ? <img src={q.iconUrl} alt="" width={20} height={20} style={{ display: 'inline-block', width: 20, height: 20, objectFit: 'contain', verticalAlign: 'middle', marginRight: 6 }} /> : null}{q.categoryName}</strong><small>{away(q)}{q.sampleFare ? ' · test fare' : ''}</small></span>
                <b className="lts-ride__price num">{rupees(q.totalPaise)}</b>
              </button>
            ))}
            {noneFree ? <Notice tone="warning">No drivers are available nearby right now. Please try again in a few minutes.</Notice> : null}
          </div>
          <div className="lts__foot">
            {PREVIEW ? <Notice tone="info">Design preview with sample places and fares. Nothing here is real or bookable.</Notice> : null}
            {error ? <Notice tone="error" action={<Button size="sm" variant="secondary" onClick={seeFares}>Try again</Button>}>{error}</Notice> : null}
            {!online ? <Notice tone="warning">You are offline. Booking needs a connection.</Notice> : null}
            {payments.length === 0 ? <Notice tone="warning">No payment method is available in this area yet, so booking is paused.</Notice> : null}
            <div className="lts__chips">
              <label className="lts-chip" aria-label="Payment method">
                <Icon name="wallet" size={18} />
                <select value={method} onChange={(e) => setMethod(e.target.value as 'cash' | 'online')} disabled={payments.length === 0}>
                  {payments.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <Icon name="chevron-down" size={14} />
              </label>
              <button type="button" className="lts-chip" disabled={!chosen} onClick={() => setDetails(true)}><Icon name="info" size={18} /> Fare details</button>
              {chosen ? <span className={`lts__timer ${expired ? 'is-expired' : ''}`}>{expired ? 'Fare expired' : `Fare locked ${mmss(chosen.expiresAtMs - now)}`}</span> : null}
            </div>
            <div className="lts__cta">
              <Button size="lg" variant="secondary" onClick={backToPlan}>Change trip</Button>
              {expired ? <Button size="lg" loading={loadingQuotes} onClick={seeFares}>Refresh fare</Button> : <Button size="lg" disabled={!chosen || !method || booking} loading={booking} onClick={() => void book()}>Ride Now</Button>}
            </div>
          </div>
        </section>

        {details && chosen ? (
          <Dialog title={`${chosen.categoryName} fare`} subtitle="Estimated, based on the road route and expected time" onClose={() => setDetails(false)} footer={<Button onClick={() => setDetails(false)}>Got it</Button>}>
            <dl className="lt-lines">
              {chosen.lines.map((l) => <div key={l.code}><dt>{l.label}</dt><dd className="num">{rupees(l.amountPaise)}</dd></div>)}
              <div className="lt-lines__total"><dt>Estimated fare</dt><dd className="num">{rupees(chosen.totalPaise)}</dd></div>
            </dl>
            <p className="lt-fine">{quotes.policy.estimate} {quotes.policy.final} Distance billed is capped at {km(chosen.distanceCapMeters)}. {chosen.cancellationFeePaise ? `Cancelling more than ${Math.max(0, Math.round(chosen.cancellationGraceSeconds / 60))} min after a driver is assigned costs ${rupees(chosen.cancellationFeePaise)}.` : ''}</p>
            <p className="lt-fine">{quotes.policy.boundary}</p>
            {chosen.sampleFare ? <p className="lt-fine">Test fare: not an approved rate.</p> : null}
          </Dialog>
        ) : null}
        {picking}
      </div>
    );
  }

  // ── Plan: choose the two places ────────────────────────────────────────────────────────────────────────────────
  const checkFailed = !!avail?.failed;
  const notAvailable = !!avail && !avail.available && !checkFailed;
  // No service area is switched on anywhere: say so plainly instead of pointing at a shaded area that does not exist.
  const nothingRunning = zoneState.loaded && zoneState.known && zoneState.zones.length === 0;
  const seeFaresReason = !p || !d ? 'Choose a pickup and a drop first' : checking ? 'Checking the service area…' : checkFailed ? 'Check your connection and try again' : notAvailable ? (nothingRunning ? 'Local Taxi is not running in your area yet' : 'Choose places inside the service area') : '';
  return (
    <>
      <PageHead title="Local Taxi">Book a cab inside your city. See the fare first, pay your driver or online.</PageHead>
      <div className="page lt">
        <section className="lt-card" aria-label="Trip">
          <button type="button" className="lt-place" onClick={() => setPicker('pickup')}>
            <span className="lt-dot lt-dot--from" aria-hidden="true" />
            <span><small>Pickup</small><strong>{pickup?.name ?? 'Choose pickup location'}</strong></span>
            <Icon name="chevron-right" size={16} />
          </button>
          <button type="button" className="lt-place" onClick={() => setPicker('drop')}>
            <span className="lt-dot lt-dot--to" aria-hidden="true" />
            <span><small>Drop</small><strong>{drop?.name ?? 'Choose drop location'}</strong></span>
            <Icon name="chevron-right" size={16} />
          </button>
          {checking ? <p className="lt-note"><Spinner /> Checking service area…</p> : null}
          {avail?.available && p ? <p className="lt-note lt-note--ok"><Icon name="check" size={16} /> Local Taxi is available in {avail.zoneName}.</p> : null}
          {checkFailed ? <Notice tone="error" action={<Button size="sm" variant="secondary" onClick={() => setRecheck((n) => n + 1)}>Try again</Button>}>{avail?.message}</Notice> : null}
          {notAvailable ? (
            nothingRunning
              ? <Notice tone="info">Local Taxi isn&apos;t running in your area yet. You can still book <Link to="/book?service=outstation">Outstation</Link>, <Link to="/book?service=airport">Airport Taxi</Link> or <Link to="/book?service=rental">Rental</Link>.</Notice>
              : <Notice tone="warning">{(avail?.reason && ZONE_MESSAGES[avail.reason]) || avail?.message || 'Local Taxi is not available here yet.'} Try a place inside the shaded area on the map, or use <Link to="/book?service=outstation">Outstation</Link>.</Notice>
          ) : null}
          <Button size="lg" block className="lt-see" disabled={!p || !d || !avail?.available || loadingQuotes || checking} loading={loadingQuotes} onClick={seeFares}>See fares</Button>
          {seeFaresReason && !loadingQuotes ? <p className="lt-fine lt-see__why">{seeFaresReason}</p> : null}
          {!online ? <Notice tone="warning">You are offline. Fares and booking need a connection.</Notice> : null}
          {error ? <Notice tone="error" action={p && d ? <Button size="sm" variant="secondary" onClick={seeFares}>Try again</Button> : undefined}>{error}</Notice> : null}
        </section>
        <ZoneMapView pickup={p} drop={d} label="Map of the Local Taxi service area with your pickup and drop" />
      </div>
      {picking}
    </>
  );
}
export default LocalTaxiPage;
