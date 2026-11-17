import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Local Rentals: a full-screen map and a sheet that rises from the bottom. The front sheet asks everything about the places at once:
//   Hourly Rental   → pickup and the rental duration (1–15 hours, picked from a grid), then pickup date and time.
//   Pickup & Drop   → pickup and drop together, then pickup date and time.
// The pickup starts at the rider's current location; tapping a place opens the search (which can also pin a place on the map).
// It only collects the trip. The vehicles and fares come from the same booking steps as every other service, and the server
// prices them, so nothing here can change what a rider is charged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { GeoPlace } from '@core/types';
import { reverseGeocode } from '@core/services/geoService';
import { scheduleProblem } from '@core/utils/bookingRules';
import { haversineKm } from '@core/utils/geo';
import { Icon } from '@/components/Icon';
import { Dialog } from '@/components/ui';
import { ServiceNote } from '@/components/ServiceNote';
import { SCHEDULE_MIN_LEAD_MIN } from '@core/config/constants';
import { LocationPicker } from '@/components/LocationPicker';
import { TimePicker, formatTime12 } from '@/components/TimePicker';
import { useBooking } from '@/state/Booking';
import { useAuth } from '@/state/Auth';
import { saveDraft, RENTAL_PACKAGE_HOURS } from '@/lib/draft';
import { setPendingReturn } from '@/lib/pendingReturn';
import { useDeviceLocation, useLivePickupDefault, useMinWidth, useOnline } from '@/lib/hooks';
import { LOCATION_HELP, combineDateTime, defaultPickup, earliestSlot, latestPickup, pickupTimeOptions, toDateInput, toTimeInput } from '@/lib/schedule';
import { useSeo } from '@/lib/seo';
import { QUICK_CITIES } from '@/pages/book/content';
import { SERVICES, serviceHref } from '@/lib/services';
import { loadGoogleMaps, hasGoogleMapsWebKey, onGoogleMapsFailure } from '@/lib/googleMaps';
import './localRentals.css';

type Mode = 'hourly' | 'pickup';
type Stage = 'plan' | 'when';
type LatLng = { lat: number; lng: number };

/** Pickup & Drop is for one city; the server treats anything longer than this (by road) as outstation. */
const CITY_LIMIT_KM = 40;
/** The duration shown before the rider picks another one. */
const DEFAULT_HOURS = 4;
const noop = () => undefined;
const hoursText = (h: number) => `${h} ${h === 1 ? 'hour' : 'hours'}`;
/** Pickup times offered in the dropdown: every half hour; "Other time" opens the wheel for anything else. */
const TIME_SLOTS = Array.from({ length: 38 }, (_, i) => `${String(5 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const STATE_VIEW = { lat: 11.1, lng: 78.4, zoom: 7 };

const DISPOSAL_ID = 'place-local-disposal';
/** A rental drives within the pickup city: its destination is the city-disposal placeholder, never priced by distance. */
const disposalFor = (pickup: GeoPlace): GeoPlace => ({
  id: DISPOSAL_ID,
  name: 'Local City Disposal',
  address: `${pickup.name} & City Limits (Within city disposal)`,
  lat: pickup.lat + 0.003,
  lng: pickup.lng - 0.003,
  type: 'other',
});

const pinPlace = (ll: LatLng): GeoPlace => ({
  id: 'pin',
  name: 'Pinned location',
  address: `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`,
  lat: ll.lat,
  lng: ll.lng,
  type: 'other',
});

/** A name tag on the map, built from DOM nodes so a place name is never parsed as HTML. */
function tag(kind: 'from' | 'to', text: string): HTMLElement {
  const root = document.createElement('div');
  root.className = `lr-tag lr-tag--${kind}`;
  const dot = document.createElement('i');
  const name = document.createElement('span');
  name.textContent = text;
  root.append(dot, name);
  return root;
}

// ── The map ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// While a place is being chosen the map is draggable and the pin stays fixed above the sheet: the place is whatever sits under
// the pin when the map stops. Afterwards the map just shows the trip.
interface Pin { place: GeoPlace; kind: 'from' | 'to' }
interface Target extends LatLng { zoom?: number; n: number }

// ── Google Maps (the map the sites use everywhere else) ─────────────────────────────────────────────────────────────────────
// The map ends at the top of the sheet, so Google's own logo and terms stay visible and the pin is simply the middle of the map.

function LeafletPinMap({ picking, target, pins, sheetH, onPick, me }: { picking: boolean; target: Target | null; pins: Pin[]; sheetH: number; onPick: (ll: LatLng) => void; me: LatLng | null }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const meMarker = useRef<L.Marker | null>(null);
  const programmatic = useRef(false);
  const gesture = useRef(false); // true only after the rider dragged or pinched: a resize of the map must never count as moving the pin
  const live = useRef({ picking, sheetH, onPick });
  live.current = { picking, sheetH: window.innerWidth >= 900 ? sheetH : 0, onPick };

  useEffect(() => {
    const el = host.current;
    if (!el || map.current) return undefined;
    const m = L.map(el, { zoomControl: false, attributionControl: true }).setView([STATE_VIEW.lat, STATE_VIEW.lng], STATE_VIEW.zoom);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    m.on('dragstart', () => { gesture.current = true; });
    m.on('zoomstart', () => { if (!programmatic.current) gesture.current = true; });
    m.on('movestart', () => el.classList.add('is-moving'));
    m.on('moveend', () => {
      el.classList.remove('is-moving');
      if (programmatic.current || !live.current.picking || !gesture.current) return;
      gesture.current = false;
      // The pin is drawn above the sheet, so the place is read at the pin's own point, not at the middle of the map.
      const size = m.getSize();
      const at = m.containerPointToLatLng(L.point(size.x / 2, Math.max(70, (size.y - live.current.sheetH) / 2)));
      live.current.onPick({ lat: at.lat, lng: at.lng });
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); m.remove(); map.current = null; meMarker.current = null; };
  }, []);

  // The rider's own position: a blue dot that stays on the map whatever the pin does.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!me) { meMarker.current?.remove(); meMarker.current = null; return; }
    if (meMarker.current) meMarker.current.setLatLng([me.lat, me.lng]);
    else meMarker.current = L.marker([me.lat, me.lng], { icon: L.divIcon({ className: 'lr-mewrap', html: '<span class="lr-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] }), keyboard: false, interactive: false, zIndexOffset: 400 }).addTo(m);
  }, [me?.lat, me?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move to a place (a search result, the device location, a city chip).
  useEffect(() => {
    const m = map.current;
    if (!m || !target) return;
    programmatic.current = true;
    m.setView([target.lat, target.lng], target.zoom ?? 16, { animate: false });
    if (live.current.picking) m.panBy([0, live.current.sheetH / 2], { animate: false });
    programmatic.current = false;
  }, [target?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw the chosen places, and fit the trip into the part of the map above the sheet.
  useEffect(() => {
    const g = layer.current;
    const m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    const pts: [number, number][] = pins.map((p) => [p.place.lat, p.place.lng]);
    if (pins.length === 2) L.polyline(pts, { color: '#0f172a', weight: 4, opacity: 0.8, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(g);
    for (const p of pins) {
      L.circleMarker([p.place.lat, p.place.lng], { radius: 7, color: '#fff', weight: 3, fillColor: p.kind === 'from' ? '#16a34a' : '#c8181f', fillOpacity: 1, interactive: false }).addTo(g);
      L.marker([p.place.lat, p.place.lng], { icon: L.divIcon({ className: 'lr-tagwrap', html: tag(p.kind, p.place.name), iconSize: [0, 0], iconAnchor: [0, p.kind === 'from' ? 18 : -10] }), keyboard: false, interactive: false, zIndexOffset: 500 }).addTo(g);
    }
    if (live.current.picking || !pts.length) return;
    programmatic.current = true;
    if (pts.length === 1) {
      m.setView(pts[0]!, 15, { animate: false });
      m.panBy([0, live.current.sheetH / 2], { animate: false });
    } else {
      m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [48, 120], paddingBottomRight: [48, live.current.sheetH + 36], maxZoom: 15, animate: false });
    }
    programmatic.current = false;
  }, [pins.map((p) => `${p.kind}:${p.place.lat},${p.place.lng},${p.place.name}`).join('|'), picking, sheetH]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="lr__map lr__map--google" role="application" aria-label="Map. Drag it to place the pin on your location." />;
}

// ── Google Maps (the map the sites use everywhere else) ─────────────────────────────────────────────────────────────────────
// The map ends at the top of the sheet, so Google's own logo and terms stay visible and the pin is simply the middle of the map.
function GooglePinMap({ picking, target, pins, sheetH, onPick, onFail, me }: { picking: boolean; target: Target | null; pins: Pin[]; sheetH: number; onPick: (ll: LatLng) => void; onFail: () => void; me: LatLng | null }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const meMarker = useRef<any>(null);
  const last = useRef<LatLng | null>(null);
  const placed = useRef(false); // set once the first position has been applied: Google's first idle event is not the rider moving the pin
  const gesture = useRef(false); // true only after the rider dragged or pinched: Google's own resizes and recentring must never count as moving the pin
  const quietUntil = useRef(0); // zoom changes we make ourselves are not gestures
  const live = useRef({ picking, onPick, onFail, sheetH });
  live.current = { picking, onPick, onFail, sheetH };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    // A rejected key (referrer, billing) is reported by Google through this hook rather than by the script failing to load.
    const stopFailureListener = onGoogleMapsFailure(() => { if (alive) live.current.onFail(); });
    loadGoogleMaps()
      .then((maps) => {
        if (!alive || !host.current) return;
        const el = host.current;
        const m = new maps.Map(el, { center: { lat: STATE_VIEW.lat, lng: STATE_VIEW.lng }, zoom: STATE_VIEW.zoom, disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy', keyboardShortcuts: false });
        map.current = m;
        m.addListener('dragstart', () => { gesture.current = true; el.classList.add('is-moving'); });
        m.addListener('zoom_changed', () => { if (Date.now() > quietUntil.current) { gesture.current = true; el.classList.add('is-moving'); } });
        m.addListener('idle', () => {
          el.classList.remove('is-moving');
          if (!live.current.picking || !placed.current || !gesture.current) return;
          gesture.current = false;
          const c = m.getCenter();
          const ll = { lat: c.lat(), lng: c.lng() };
          last.current = ll;
          live.current.onPick(ll);
        });
        setReady(true);
      })
      .catch(() => { if (alive) live.current.onFail(); });
    return () => {
      alive = false;
      stopFailureListener();
      overlays.current.forEach((o) => o.setMap?.(null));
      overlays.current = [];
      meMarker.current?.setMap(null);
      meMarker.current = null;
      if (map.current) window.google?.maps?.event?.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, []);

  // Move to a place (a search result, the device location, a city chip).
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !target) return;
    last.current = { lat: target.lat, lng: target.lng };
    placed.current = true;
    gesture.current = false;
    quietUntil.current = Date.now() + 1200;
    m.setCenter({ lat: target.lat, lng: target.lng });
    m.setZoom(target.zoom ?? 16);
  }, [target?.n, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // The rider's own position: a blue dot that stays on the map whatever the pin does.
  useEffect(() => {
    const m = map.current;
    const maps = window.google?.maps;
    if (!m || !maps || !ready) return;
    if (!me) { meMarker.current?.setMap(null); meMarker.current = null; return; }
    const pos = { lat: me.lat, lng: me.lng };
    if (meMarker.current) meMarker.current.setPosition(pos);
    else meMarker.current = new maps.Marker({ map: m, position: pos, clickable: false, zIndex: 4, title: 'Your location', icon: { path: maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#1a73e8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } });
  }, [me?.lat, me?.lng, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draw the chosen places, and fit the trip into the map.
  useEffect(() => {
    const m = map.current;
    const maps = window.google?.maps;
    if (!m || !maps || !ready) return;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const add = (o: any) => { overlays.current.push(o); return o; };
    const bounds = new maps.LatLngBounds();
    for (const p of pins) {
      const pos = { lat: p.place.lat, lng: p.place.lng };
      bounds.extend(pos);
      add(new maps.Marker({ map: m, position: pos, clickable: false, zIndex: 5, icon: { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: p.kind === 'from' ? '#16a34a' : '#c8181f', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } }));
      // The name tag is a small HTML overlay (built from DOM nodes) placed at the point.
      const div = tag(p.kind, p.place.name);
      div.style.position = 'absolute';
      const ov = new maps.OverlayView();
      ov.onAdd = () => ov.getPanes().overlayMouseTarget.appendChild(div);
      ov.draw = () => {
        const pt = ov.getProjection()?.fromLatLngToDivPixel(new maps.LatLng(pos.lat, pos.lng));
        if (pt) { div.style.left = `${pt.x}px`; div.style.top = `${pt.y + (p.kind === 'from' ? -46 : 12)}px`; }
      };
      ov.onRemove = () => div.remove();
      ov.setMap(m);
      add(ov);
    }
    if (pins.length === 2) {
      add(new maps.Polyline({ map: m, path: pins.map((p) => ({ lat: p.place.lat, lng: p.place.lng })), strokeOpacity: 0, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, strokeColor: '#0f172a', scale: 3 }, offset: '0', repeat: '12px' }] }));
    }
    if (picking || !pins.length) return;
    quietUntil.current = Date.now() + 1200;
    if (pins.length === 1) {
      last.current = { lat: pins[0]!.place.lat, lng: pins[0]!.place.lng };
      m.setCenter(last.current);
      m.setZoom(15);
    } else {
      // On a phone the map ends at the sheet; on desktop it runs under the floating sheet, so keep the trip clear of it.
      m.fitBounds(bounds, { top: 100, right: 48, bottom: window.innerWidth >= 900 ? live.current.sheetH + 30 : 40, left: window.innerWidth >= 900 ? 420 : 48 });
      maps.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 15) m.setZoom(15); });
    }
  }, [pins.map((p) => `${p.kind}:${p.place.lat},${p.place.lng},${p.place.name}`).join('|'), picking, ready, window.innerWidth >= 900 ? sheetH : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className="lr__map lr__map--google" role="application" aria-label="Map. Drag it to place the pin on your location." />;
}

/** Google Maps with the sites' key. If Google cannot load, or rejects the key, the same page keeps working on the open map. */
function PinMap(props: { picking: boolean; target: Target | null; pins: Pin[]; sheetH: number; onPick: (ll: LatLng) => void; me: LatLng | null }) {
  const [provider, setProvider] = useState<'google' | 'leaflet'>(hasGoogleMapsWebKey ? 'google' : 'leaflet');
  return provider === 'google'
    ? <GooglePinMap picking={props.picking} target={props.target} pins={props.pins} sheetH={props.sheetH} onPick={props.onPick} me={props.me} onFail={() => setProvider('leaflet')} />
    : <LeafletPinMap {...props} />;
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Phones book Local Rentals on this full-screen map sheet. Desktop books them on the home page, where the
 * booking form sits beside the map, so a desktop visit here (old link, bookmark, a back button) goes there.
 */
export function LocalRentalsPage() {
  const isDesktop = useMinWidth(900);
  const [params] = useSearchParams();
  if (isDesktop) return <Navigate to={`/book?service=${params.get('mode') === 'hourly' ? 'rental' : 'pickup'}`} replace />;
  return <LocalRentalsSheet />;
}

function LocalRentalsSheet() {
  useSeo({ title: 'Local Rentals', noindex: true });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { draft, update } = useBooking();
  const { state: auth, openLoginModal } = useAuth();
  const { position, locate, locating, error: locationError, permission } = useDeviceLocation(true, true);
  useEffect(() => { void locate(); }, [locate]);
  const { online } = useOnline();

  const real = (p: GeoPlace | null) => (p && p.id !== DISPOSAL_ID ? p : null);
  // Pickup & Drop / Hourly Rental is chosen with the two buttons beside "Local" in the bottom bar, which switch ?mode= in the address.
  const mode: Mode = params.get('mode') === 'hourly' ? 'hourly' : 'pickup';
  // A saved hourly rental that is still in the future can be edited; anything else starts fresh. A drop is never taken from another
  // service's search (an outstation drop is not a city drop), and the pickup is always asked first.
  const savedRental = draft.tripType === 'Local Rental' && !!draft.rentalHours && !!real(draft.pickup) && !!draft.scheduledAt && draft.scheduledAt.getTime() > Date.now();
  const future = draft.scheduledAt && draft.scheduledAt.getTime() > Date.now() ? draft.scheduledAt : null;
  // The pickup starts at the rider's current location (filled in below) unless a rental was saved a moment ago.
  const [pickup, setPickup] = useState<GeoPlace | null>(() => (savedRental ? real(draft.pickup) : null));
  const [drop, setDrop] = useState<GeoPlace | null>(null);
  const [hours, setHours] = useState<number>(draft.tripType === 'Local Rental' && draft.rentalHours && RENTAL_PACKAGE_HOURS.includes(draft.rentalHours) ? draft.rentalHours : DEFAULT_HOURS);
  // The pickup starts at the earliest time a rider may book: 30 minutes after the device clock, rounded up to 5 minutes.
  const [date, setDate] = useState(() => toDateInput(future ?? earliestSlot()));
  const [time, setTime] = useState(() => toTimeInput(future ?? earliestSlot()));
  // Until the rider picks a date or time, the default keeps following the clock (always 30 minutes from now).
  // Ride Now books the earliest pickup the server accepts (it follows the clock); Schedule lets the rider choose the day and time.
  const [timing, setTiming] = useState<'now' | 'schedule'>(future !== null ? 'schedule' : 'now');
  const scheduleTouched = useRef(future !== null);
  useLivePickupDefault(scheduleTouched, (next) => {
    setDate(next.date);
    setTime(next.time);
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stage, setStage] = useState<Stage>('plan');
  const [target, setTarget] = useState<Target | null>(null);
  const [picker, setPicker] = useState<'pickup' | 'drop' | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  // The plan sheet can be pulled down to its button so the whole map shows.
  const [peek, setPeek] = useState(false);
  const [error, setError] = useState('');
  /** Shown when the device could only give a rough position (Wi-Fi / network), so a wrong-looking pin is explained. */
  const [approx, setApprox] = useState('');
  const [sheetH, setSheetH] = useState(240);
  const seq = useRef(0);
  const dock = useRef<HTMLDivElement>(null);
  const pickupFromGps = useRef(false);

  const flyTo = useCallback((ll: LatLng, zoom = 16) => setTarget({ lat: ll.lat, lng: ll.lng, zoom, n: ++seq.current }), []);

  // With no pickup chosen yet, the rider's current location is the pickup.
  useEffect(() => {
    if (!position || pickupFromGps.current || pickup) return;
    pickupFromGps.current = true;
    flyTo({ lat: position.lat, lng: position.lng });
    void reverseGeocode(position)
      .catch(() => pinPlace(position))
      .then((p) => setPickup((now) => now ?? { ...p, type: 'current' }));
  }, [position, pickup, flyTo]);

  // What the sheet covers (the sheet plus the space it keeps above the tab bar) decides where the trip sits on the map.
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const apply = () => setSheetH(Math.round(el.getBoundingClientRect().height) + (window.innerWidth >= 900 ? 20 : 0));
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (time && scheduleProblem(combineDateTime(date, time))) setTime('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const leave = useCallback(() => navigate('/book?service=outstation'), [navigate]);
  const back = useCallback(() => {
    if (stage === 'when') { setStage('plan'); setError(''); }
    else leave();
  }, [stage, leave]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picker && !timeOpen && !hoursOpen) back(); };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', key); };
  }, [back, picker, timeOpen, hoursOpen]);

  const farApart = mode === 'pickup' && !!pickup && !!drop && haversineKm(pickup, drop) > CITY_LIMIT_KM;
  // Switching the mode (from the bottom bar) starts again at the front sheet.
  useEffect(() => {
    setStage('plan');
    setError('');
  }, [mode]);

  const chooseTiming = (t: 'now' | 'schedule') => {
    if (t === timing) return;
    setTiming(t);
    setError('');
    if (t === 'now') {
      // Back to the earliest pickup, which follows the clock again.
      scheduleTouched.current = false;
      const next = defaultPickup();
      setDate(next.date);
      setTime(next.time);
    }
  };

  // The front sheet's button: the places (and, for an hourly rental, the duration) are set, so ask for the day and time.
  const confirmPlan = () => {
    if (!pickup) return setError('Choose your pickup location.');
    if (mode === 'pickup') {
      if (!drop) return setError('Choose your drop location.');
      if (farApart) return;
      if (haversineKm(pickup, drop) < 0.2) return setError('Pickup and drop cannot be the same place.');
    } else if (!hours) return setError('Select how many hours you need the car.');
    setError('');
    setStage('when');
  };

  const onPlacePicked = (p: GeoPlace) => {
    setError('');
    setApprox('');
    if (picker === 'drop') setDrop(p);
    else { pickupFromGps.current = true; setPickup(p); }
    setPicker(null);
    flyTo(p, 16);
  };
  const useMyLocation = async () => {
    setApprox('');
    const p = await locate();
    if (!p) return;
    if (p.accuracy > 1000) setApprox(`Your device gave only an approximate location (about ${p.accuracy >= 10000 ? `${Math.round(p.accuracy / 1000)} km` : `${(p.accuracy / 1000).toFixed(1)} km`}). Search or pin your pickup to set it exactly.`);
    flyTo({ lat: p.lat, lng: p.lng });
    if (stage === 'when') return; // the trip is already set; just show the rider where they are
    pickupFromGps.current = true;
    setError('');
    void reverseGeocode(p)
      .catch(() => pinPlace(p))
      .then((place) => setPickup({ ...place, type: 'current' }));
  };
  // Until a position is known the sheet asks for it: the browser's own prompt opens from the button, and a blocked site says how to allow it.
  const secure = typeof window === 'undefined' || window.isSecureContext !== false;
  const askLocation = !position && !locating;
  const locationNote = !askLocation ? ''
    : !secure ? 'Location only works on a secure (https) connection. Open the site over https, or search for your pickup.'
    : locationError ? LOCATION_HELP[locationError.kind]
    : permission === 'denied' || permission === 'blocked' ? LOCATION_HELP.blocked
    : 'Allow location access so we can set your pickup where you are.';

  // ── When: day, time, hours ──
  const lastDay = toDateInput(latestPickup());
  const first = earliestSlot(nowMs);
  const firstDay = toDateInput(first);
  const firstTime = toTimeInput(first);
  // Only times that can still be booked are offered, so there is nothing to scroll past.
  const timeOptions = useMemo(() => pickupTimeOptions(date, TIME_SLOTS, nowMs), [date, nowMs]);
  const timeOk = (t: string) => !scheduleProblem(combineDateTime(date, t), nowMs);
  const pickDate = (iso: string) => {
    scheduleTouched.current = true;
    setDate(iso);
    setError('');
    if (time && scheduleProblem(combineDateTime(iso, time))) setTime(iso === firstDay ? firstTime : '');
  };
  // Keep the clock moving: a time that has become too soon is replaced by the new earliest one (never an error at the button).
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (date < firstDay) { setDate(firstDay); setTime(firstTime); return; } // no times left today
    if (date === firstDay && (!time || !timeOk(time))) setTime(firstTime);
  }, [nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!online) return setError('You’re offline. Reconnect to see fares.');
    if (!pickup) return setError('Choose your pickup location.');
    if (mode === 'pickup' && !drop) return setError('Choose your drop location.');
    if (mode === 'hourly' && !hours) return setError('Select how many hours you need the car.');
    if (timing === 'schedule') {
      if (!date) return setError('Choose a pickup date.');
      if (!time) return setError('Choose a pickup time.');
    }
    const at = timing === 'now' ? earliestSlot() : combineDateTime(date, time);
    const problem = scheduleProblem(at);
    if (problem) {
      if (timing === 'schedule' && date === firstDay) { setTime(firstTime); return setError(`That time has passed. Pickup moved to the earliest time, ${formatTime12(firstTime)}. Tap again to continue.`); }
      return setError(problem);
    }
    if (mode === 'pickup' && pickup && drop && haversineKm(pickup, drop) > CITY_LIMIT_KM) return setError('Pickup & Drop is for trips inside one city. For a longer trip choose Outstation.');
    const patch =
      mode === 'hourly'
        ? { pickup, drop: disposalFor(pickup), tripType: 'Local Rental' as const, rentalHours: hours, scheduledAt: at, tripEndAt: null, stops: [], multicity: false }
        : { pickup, drop, tripType: 'One Way' as const, rentalHours: null, scheduledAt: at, tripEndAt: null, stops: [], multicity: false };
    update(patch);
    if (auth.status !== 'ready') {
      // Phone sign-in can remount the page: save the trip first, then come back to the vehicles.
      saveDraft({ ...draft, ...patch });
      setPendingReturn('/book/ride');
      openLoginModal({ title: 'Sign in to compare fares', subtitle: 'Verify your mobile number to continue with your saved trip.' });
      return;
    }
    navigate('/book/ride');
  };

  const pins: Pin[] = useMemo(() => {
    const out: Pin[] = [];
    if (pickup) out.push({ place: pickup, kind: 'from' });
    if (mode === 'pickup' && drop) out.push({ place: drop, kind: 'to' });
    return out;
  }, [mode, pickup, drop]);

  const style = { '--lr-sheet': `${sheetH}px` } as React.CSSProperties;
  const subline = (p: GeoPlace | null) => (p && p.address && p.address !== p.name ? p.address : '');
  const pickerFor = picker ? (
    <LocationPicker
      config={{ title: picker === 'pickup' ? 'Pickup location' : 'Drop location', allowCurrent: true, popular: QUICK_CITIES, popularLabel: 'Popular locations', near: picker === 'drop' ? pickup : position ? { lat: position.lat, lng: position.lng } : null, pinMode: picker }}
      saved={[]}
      recent={[]}
      onClose={() => setPicker(null)}
      onSelect={onPlacePicked}
    />
  ) : null;
  const scheduleFields = (
    <>
      <label className="lr-field lr-field--schedule">
        <span>Pickup Date</span>
        <input type="date" className="lr-date" value={date} min={firstDay} max={lastDay} onChange={(e) => { if (e.target.value) pickDate(e.target.value); }} />
      </label>
      <label className="lr-field lr-field--schedule">
        <span>Pickup Time</span>
        <div className="lr-select">
          <select
            value={time}
            onChange={(e) => {
              if (e.target.value === '__other') { setTimeOpen(true); return; }
              scheduleTouched.current = true;
              setTime(e.target.value);
              setError('');
            }}
          >
            <option value="">Select</option>
            {time && !timeOptions.includes(time) ? <option value={time}>{formatTime12(time)}</option> : null}
            {timeOptions.map((t) => <option key={t} value={t}>{formatTime12(t)}</option>)}
            <option value="__other">Other time…</option>
          </select>
        </div>
      </label>
    </>
  );

  return (
    <div className="lr" style={style} role="dialog" aria-label="Local Rentals">
      <PinMap picking={false} target={target} pins={pins} sheetH={sheetH} onPick={noop} me={position ? { lat: position.lat, lng: position.lng } : null} />

      <header className="lr-top">
        <div className="lr-top__row">
          <button type="button" className="lr-round" aria-label="Back" onClick={back}><Icon name="arrow-left" size={22} /></button>
          <nav className="lr-svc" aria-label="Services">
            {SERVICES.filter((x) => x.id !== 'local' && x.id !== 'pickup').map((x) => {
              const here = x.id === 'rental';
              return (
                <button key={x.id} type="button" className={here ? 'is-active' : ''} aria-current={here ? 'page' : undefined} onClick={() => { if (!here) navigate(serviceHref(x.id)); }}>
                  <Icon name={x.icon} size={20} />
                  <span>{here ? 'Local Rentals' : x.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <button type="button" className={`lr-locate ${locating ? 'is-busy' : ''} ${position ? 'is-on' : ''}`} aria-label="Detect my current location" title="Detect my current location" onClick={() => void useMyLocation()} disabled={locating}>
        <Icon name="navigation" size={20} />
      </button>

      <div className="lr-dock" ref={dock}>
        {stage === 'plan' ? (
          <section key="plan" className="lr-sheet" aria-label={mode === 'hourly' ? 'Hourly rental details' : 'Trip locations'}>
            <span className="lr-grip" aria-hidden="true" />
            <ServiceNote kind={mode === 'hourly' ? 'rental' : 'local'} className="svc-note--sheet" />
            {approx && !locating ? <p className="lr-hint" role="status">{approx}</p> : null}
            {locating && !pickup ? <p className="lr-hint" role="status">Finding your current location…</p> : askLocation && !pickup ? (
              <div className={`lr-perm ${locationError || permission === 'denied' || permission === 'blocked' ? 'is-warn' : ''}`} role={locationError ? 'alert' : 'status'}>
                <p>{locationNote}</p>
                {secure ? <button type="button" onClick={() => void useMyLocation()}>{permission === 'prompt' && !locationError ? 'Allow location' : 'Try again'}</button> : null}
              </div>
            ) : null}

            <div className="lr-places">
              <div className="lr-card">
                <button type="button" className="lr-place" onClick={() => setPicker('pickup')} title={pickup ? [pickup.name, subline(pickup)].filter(Boolean).join(', ') : undefined} aria-label={`Pickup: ${pickup?.name ?? 'not chosen'}. Change`}>
                  <span className="lr-dot lr-dot--from" aria-hidden="true" />
                  <strong className={pickup ? '' : 'is-empty'}>{pickup ? pickup.name : locating ? 'Finding your location…' : 'Pickup'}</strong>
                  <Icon name="chevron-right" size={16} className="lr-place__chev" />
                </button>
                {mode === 'pickup' ? (
                  <button type="button" className="lr-place" onClick={() => setPicker('drop')} title={drop ? [drop.name, subline(drop)].filter(Boolean).join(', ') : undefined} aria-label={`Drop: ${drop?.name ?? 'not chosen'}. Change`}>
                    <span className="lr-dot lr-dot--to" aria-hidden="true" />
                    <strong className={drop ? '' : 'is-empty'}>{drop ? drop.name : 'Drop'}</strong>
                    <Icon name="chevron-right" size={16} className="lr-place__chev" />
                  </button>
                ) : (
                  <button type="button" className="lr-place" onClick={() => setHoursOpen(true)} aria-haspopup="dialog" aria-label={`Rental duration: ${hoursText(hours)}. Change`}>
                    <Icon name="clock" size={14} className="lr-trip__icon" />
                    <strong>{hoursText(hours)}<small>Duration · 1–{RENTAL_PACKAGE_HOURS[RENTAL_PACKAGE_HOURS.length - 1]} hours</small></strong>
                    <Icon name="chevron-down" size={16} className="lr-place__chev" />
                  </button>
                )}
              </div>
            </div>

            {farApart ? <p className="lr-warn" role="alert">Pickup &amp; Drop is for trips inside one city. For a longer trip choose Outstation.</p> : null}
            {error ? <p className="lr-warn" role="alert">{error}</p> : null}
            <button type="button" className="lr-cta" disabled={farApart} onClick={confirmPlan}>{mode === 'hourly' ? 'Confirm rental details' : 'Confirm locations'}</button>
          </section>
        ) : (
          <section key="when" className={`lr-sheet lr-sheet--tall ${peek ? 'is-peek' : ''}`} aria-label="Plan your trip">
            <button type="button" className="lr-gripbtn" aria-label={peek ? 'Show the trip details' : 'Show more of the map'} aria-expanded={!peek} onClick={() => setPeek((p) => !p)} />
            <h2>{mode === 'hourly' ? 'Plan your rental' : 'Plan your trip'}</h2>

            <div className="lr-body">
            <div className="lr-trip">
              <button type="button" onClick={() => setStage('plan')}>
                <span className="lr-dot lr-dot--from" aria-hidden="true" />
                <span><small>Pickup</small><strong>{pickup?.name ?? 'Choose pickup'}</strong></span>
                <em>Edit</em>
              </button>
              {mode === 'pickup' ? (
                <button type="button" onClick={() => setStage('plan')}>
                  <span className="lr-dot lr-dot--to" aria-hidden="true" />
                  <span><small>Drop</small><strong>{drop?.name ?? 'Choose drop'}</strong></span>
                  <em>Edit</em>
                </button>
              ) : (
                <button type="button" onClick={() => setHoursOpen(true)} aria-haspopup="dialog">
                  <Icon name="clock" size={14} className="lr-trip__icon" />
                  <span><small>Duration</small><strong>{hoursText(hours)}</strong></span>
                  <em>Edit</em>
                </button>
              )}
            </div>

            <div className="lr-timing" role="group" aria-label="Pickup timing">
              <button type="button" aria-pressed={timing === 'now'} onClick={() => chooseTiming('now')}>Ride Now</button>
              <button type="button" aria-pressed={timing === 'schedule'} onClick={() => chooseTiming('schedule')}>Schedule</button>
            </div>
            {timing === 'schedule' ? (
              <div className="lr-pair lr-pair--two">
                {scheduleFields}
              </div>
            ) : (
              <p className="lr-pickup-note" role="status">
                <Icon name="clock" size={16} />
                <span><strong>Estimated pickup · {formatTime12(toTimeInput(earliestSlot(nowMs)))}</strong><small>Minimum {SCHEDULE_MIN_LEAD_MIN} min from now</small></span>
              </p>
            )}
            </div>
            <div className="lr-foot">
              {error ? <p className="lr-warn" role="alert">{error}</p> : null}
              {!online ? <p className="lr-warn" role="alert">You’re offline. Reconnect to see fares.</p> : null}
              <button type="button" className="lr-cta" onClick={submit}>{mode === 'hourly' ? 'View cabs & fares →' : 'See vehicles & fares'}</button>
            </div>
          </section>
        )}
      </div>

      {pickerFor}
      {hoursOpen ? (
        <Dialog title="Rental duration" onClose={() => setHoursOpen(false)} className="lr-hours-dialog">
          <p className="lr-hours-note">Choose from 1 to {RENTAL_PACKAGE_HOURS[RENTAL_PACKAGE_HOURS.length - 1]} hours, then continue to choose your cab.</p>
          <div className="lr-hours-grid" role="radiogroup" aria-label="Rental duration">
            {RENTAL_PACKAGE_HOURS.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={hours === h} data-autofocus={hours === h ? '' : undefined} className={`lr-hours-opt ${hours === h ? 'is-on' : ''}`} onClick={() => { setHours(h); setError(''); setHoursOpen(false); }}>
                {hoursText(h)}
              </button>
            ))}
          </div>
        </Dialog>
      ) : null}
      {timeOpen ? (
        <TimePicker title="Pickup time" date={date} value={time} validate="pickup" onClose={() => setTimeOpen(false)} onConfirm={(t) => { scheduleTouched.current = true; setTime(t); setError(''); setTimeOpen(false); }} />
      ) : null}
    </div>
  );
}
export default LocalRentalsPage;
