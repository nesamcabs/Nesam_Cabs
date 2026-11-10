import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
// Local Rentals: a full-screen map and a sheet that rises from the bottom, one question at a time.
//   Hourly Rental   → pickup on the map, how many hours, pickup date and time.
//   Pickup & Drop   → pickup on the map, drop on the map, pickup date and time.
// It only collects the trip. The vehicles and fares come from the same booking steps as every other service, and the server
// prices them, so nothing here can change what a rider is charged.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GeoPlace } from '@core/types';
import { reverseGeocode } from '@core/services/geoService';
import { scheduleProblem } from '@core/utils/bookingRules';
import { haversineKm } from '@core/utils/geo';
import { Icon } from '@/components/Icon';
import { LocationPicker } from '@/components/LocationPicker';
import { TimePicker, formatTime12 } from '@/components/TimePicker';
import { useBooking } from '@/state/Booking';
import { useAuth } from '@/state/Auth';
import { saveDraft, RENTAL_PACKAGE_HOURS } from '@/lib/draft';
import { setPendingReturn } from '@/lib/pendingReturn';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { LOCATION_HELP, combineDateTime, earliestSlot, latestPickup, pickupTimeOptions, toDateInput, toTimeInput } from '@/lib/schedule';
import { useSeo } from '@/lib/seo';
import { QUICK_CITIES } from '@/pages/book/content';
import { SERVICES, serviceHref } from '@/lib/services';
import { loadGoogleMaps, hasGoogleMapsWebKey, onGoogleMapsFailure } from '@/lib/googleMaps';
import './localRentals.css';

type Mode = 'hourly' | 'pickup';
type Stage = 'pickup' | 'drop' | 'when';
type LatLng = { lat: number; lng: number };

/** Pickup & Drop is for one city; the server treats anything longer than this (by road) as outstation. */
const CITY_LIMIT_KM = 40;
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
      L.circleMarker([p.place.lat, p.place.lng], { radius: 7, color: '#fff', weight: 3, fillColor: p.kind === 'from' ? '#16a34a' : '#dc2626', fillOpacity: 1, interactive: false }).addTo(g);
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
      add(new maps.Marker({ map: m, position: pos, clickable: false, zIndex: 5, icon: { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: p.kind === 'from' ? '#16a34a' : '#dc2626', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 } }));
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
export function LocalRentalsPage() {
  useSeo({ title: 'Local Rentals', noindex: true });
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { draft, update } = useBooking();
  const { state: auth, openLoginModal } = useAuth();
  const { position, locate, locating, error: locationError, permission } = useDeviceLocation(true);
  useEffect(() => { void locate(); }, [locate]);
  const { online } = useOnline();

  const real = (p: GeoPlace | null) => (p && p.id !== DISPOSAL_ID ? p : null);
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'hourly' ? 'hourly' : 'pickup');
  // A saved hourly rental that is still in the future can be edited; anything else starts fresh. A drop is never taken from another
  // service's search (an outstation drop is not a city drop), and the pickup is always asked first.
  const savedRental = draft.tripType === 'Local Rental' && !!draft.rentalHours && !!real(draft.pickup) && !!draft.scheduledAt && draft.scheduledAt.getTime() > Date.now();
  const future = draft.scheduledAt && draft.scheduledAt.getTime() > Date.now() ? draft.scheduledAt : null;
  const [pickup, setPickup] = useState<GeoPlace | null>(null);
  const [drop, setDrop] = useState<GeoPlace | null>(null);
  const [hours, setHours] = useState<number | null>(draft.tripType === 'Local Rental' ? draft.rentalHours ?? null : null);
  // The pickup starts at the earliest time a rider may book: 30 minutes after the device clock, rounded up to 5 minutes.
  const [date, setDate] = useState(() => toDateInput(future ?? earliestSlot()));
  const [time, setTime] = useState(() => toTimeInput(future ?? earliestSlot()));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [stage, setStage] = useState<Stage>('pickup');
  const [cand, setCand] = useState<GeoPlace | null>(null);
  const [resolving, setResolving] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [picker, setPicker] = useState<'pickup' | 'drop' | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  // The plan sheet can be pulled down to its button so the whole map shows.
  const [peek, setPeek] = useState(false);
  const [error, setError] = useState('');
  const [sheetH, setSheetH] = useState(240);
  const seq = useRef(0);
  const resolveToken = useRef(0);
  const dock = useRef<HTMLDivElement>(null);
  const userMoved = useRef(false);

  const picking = stage !== 'when';
  const steps = mode === 'hourly' ? 2 : 3;
  const stepNo = stage === 'pickup' ? 1 : stage === 'drop' ? 2 : steps;

  const flyTo = useCallback((ll: LatLng, zoom = 16) => setTarget({ lat: ll.lat, lng: ll.lng, zoom, n: ++seq.current }), []);

  // Read the place under the pin (debounced, newest answer wins).
  const resolveAt = useCallback((ll: LatLng) => {
    const token = ++resolveToken.current;
    const fresh = () => token === resolveToken.current;
    setResolving(true);
    const ask = window.setTimeout(() => {
      reverseGeocode(ll)
        .then((p) => { if (fresh()) { setCand({ ...p, lat: ll.lat, lng: ll.lng }); setResolving(false); } })
        .catch(() => { if (fresh()) { setCand(pinPlace(ll)); setResolving(false); } });
    }, 300);
    // On a slow connection the rider is not kept waiting: the pin's coordinates stand in, and the address replaces them if it arrives.
    const giveUp = window.setTimeout(() => { if (fresh()) { setCand((c) => (c && c.lat === ll.lat && c.lng === ll.lng ? c : pinPlace(ll))); setResolving(false); } }, 3500);
    return () => { window.clearTimeout(ask); window.clearTimeout(giveUp); };
  }, []);

  const onPick = useCallback((ll: LatLng) => { userMoved.current = true; setError(''); resolveAt(ll); }, [resolveAt]);

  // Enter a stage: put the map on the place already chosen for it, or on where the rider is.
  const enter = useCallback((s: Stage) => {
    resolveToken.current += 1; // a lookup still running for the step we leave must not land in the next one
    setResolving(false);
    setStage(s);
    setError('');
    if (s === 'when') return;
    const have = s === 'pickup' ? pickup : drop;
    setCand(have);
    const at = have ?? (s === 'drop' ? pickup : null) ?? (position ? { lat: position.lat, lng: position.lng } : null);
    if (at) flyTo(at, have ? 16 : s === 'drop' ? 14 : 16);
    else setTarget({ ...STATE_VIEW, n: ++seq.current });
  }, [pickup, drop, position, flyTo]);

  // First screen: if the rider has no pickup yet, start where they are.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (stage === 'when') return;
    enter(stage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (stage !== 'pickup' || userMoved.current || !position) return;
    flyTo({ lat: position.lat, lng: position.lng });
    resolveAt({ lat: position.lat, lng: position.lng });
  }, [position?.lat, position?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the sheet covers (the sheet plus the space it keeps above the tab bar) decides where the pin and the trip sit on the map.
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
    if (stage === 'drop') enter('pickup');
    else if (stage === 'when') enter(mode === 'pickup' ? 'drop' : 'pickup');
    else leave();
  }, [stage, mode, enter, leave]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picker && !timeOpen) back(); };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', key); };
  }, [back, picker, timeOpen]);

  const farApart = stage === 'drop' && !!pickup && !!cand && haversineKm(pickup, cand) > CITY_LIMIT_KM;
  const switchMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    setError('');
    // Either tab starts by asking the pickup (the one chosen before is prefilled, one tap to confirm). Pickup & Drop then asks the drop again.
    if (m === 'pickup') setDrop(null);
    enter('pickup');
  };

  const confirmStage = () => {
    if (!cand) return;
    if (stage === 'pickup') {
      setPickup(cand);
      if (mode === 'pickup') {
        resolveToken.current += 1;
        setResolving(false);
        if (drop && haversineKm(cand, drop) <= CITY_LIMIT_KM) { setStage('when'); setError(''); }
        else { setDrop(null); setStage('drop'); setError(''); setCand(null); flyTo(cand, 14); }
      } else enter('when');
    } else if (stage === 'drop') {
      if (farApart) return;
      resolveToken.current += 1;
      setResolving(false);
      setDrop(cand);
      setStage('when');
      setError('');
    }
  };

  const chooseCity = (c: GeoPlace) => { userMoved.current = true; setCand(c); setResolving(false); flyTo(c, 13); };
  const onSearchPick = (p: GeoPlace) => {
    userMoved.current = true;
    setPicker(null);
    setCand(p);
    setResolving(false);
    flyTo(p, 16);
  };
  const useMyLocation = async () => {
    const p = await locate();
    if (!p) return;
    flyTo({ lat: p.lat, lng: p.lng });
    if (stage === 'when') return; // the trip is already set; just show the rider where they are
    userMoved.current = true;
    resolveAt({ lat: p.lat, lng: p.lng });
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
    if (!date) return setError('Choose a pickup date.');
    if (!time) return setError('Choose a pickup time.');
    const at = combineDateTime(date, time);
    const problem = scheduleProblem(at);
    if (problem) {
      if (date === firstDay) { setTime(firstTime); return setError(`That time has passed. Pickup moved to the earliest time, ${formatTime12(firstTime)}. Tap again to continue.`); }
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
    if (stage === 'drop' && pickup) out.push({ place: pickup, kind: 'from' });
    if (stage === 'when') {
      if (pickup) out.push({ place: pickup, kind: 'from' });
      if (mode === 'pickup' && drop) out.push({ place: drop, kind: 'to' });
    }
    return out;
  }, [stage, mode, pickup, drop]);

  const style = { '--lr-sheet': `${sheetH}px` } as React.CSSProperties;
  const place = cand;
  const addrLine = place && place.address && place.address !== place.name ? place.address : '';
  const pickerFor = picker ? (
    <LocationPicker
      config={{ title: picker === 'pickup' ? 'Pickup location' : 'Drop location', allowCurrent: true, popular: QUICK_CITIES, popularLabel: 'Popular locations', near: picker === 'drop' ? pickup : position ? { lat: position.lat, lng: position.lng } : null, pinMode: picker }}
      saved={[]}
      recent={[]}
      onClose={() => setPicker(null)}
      onSelect={onSearchPick}
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

  // Pickup & Drop / Hourly Rental: lives in the bottom card (the top of the map can sit under the site header).
  const modeSeg = (
    <div className="lr-seg" role="tablist" aria-label="Local Rentals" data-mode={mode}>
      <span className="lr-seg__thumb" aria-hidden="true" />
      <button type="button" role="tab" aria-selected={mode === 'pickup'} onClick={() => switchMode('pickup')}>Pickup &amp; Drop</button>
      <button type="button" role="tab" aria-selected={mode === 'hourly'} onClick={() => switchMode('hourly')}>Hourly Rental</button>
    </div>
  );

  return (
    <div className="lr" style={style} role="dialog" aria-label="Local Rentals">
      <PinMap picking={picking} target={target} pins={pins} sheetH={sheetH} onPick={onPick} me={position ? { lat: position.lat, lng: position.lng } : null} />

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

      {picking ? (
        <>
          <div className="lr-find">
            <button type="button" className="lr-search" onClick={() => setPicker(stage === 'drop' ? 'drop' : 'pickup')}>
              <Icon name="search" size={18} />
              <span className={place ? '' : 'is-empty'}>{place ? place.name : stage === 'drop' ? 'Search a drop location' : 'Search a place or city'}</span>
            </button>
            {stage === 'pickup' ? (
              <div className="lr-cities" role="group" aria-label="Cities">
                {QUICK_CITIES.map((c) => (
                  <button key={c.id} type="button" className={`lr-chip ${place?.id === c.id ? 'is-on' : ''}`} onClick={() => chooseCity(c)}>{c.name}</button>
                ))}
              </div>
            ) : null}
          </div>
          <div className={`lr-pin lr-pin--${stage === 'drop' ? 'drop' : 'pickup'}`} aria-hidden="true">
            <span className="lr-pin__head"><i /></span>
            <span className="lr-pin__stem" />
            <span className="lr-pin__shadow" />
          </div>
        </>
      ) : null}

      <button type="button" className={`lr-locate ${locating ? 'is-busy' : ''} ${position ? 'is-on' : ''}`} aria-label="Detect my current location" title="Detect my current location" onClick={() => void useMyLocation()} disabled={locating}>
        <Icon name="navigation" size={20} />
      </button>

      <div className="lr-dock" ref={dock}>
        {stage !== 'when' ? (
          <section key={stage} className="lr-sheet" aria-label={stage === 'drop' ? 'Set drop location' : 'Set pickup location'}>
            <span className="lr-grip" aria-hidden="true" />
            <p className="lr-step">Step {stepNo} of {steps}</p>
            {locating ? <p className="lr-hint" role="status">Finding your current location…</p> : askLocation ? (
              <div className={`lr-perm ${locationError || permission === 'denied' || permission === 'blocked' ? 'is-warn' : ''}`} role={locationError ? 'alert' : 'status'}>
                <p>{locationNote}</p>
                {secure ? <button type="button" onClick={() => void useMyLocation()}>{permission === 'prompt' && !locationError ? 'Allow location' : 'Try again'}</button> : null}
              </div>
            ) : null}
            <h2>{stage === 'drop' ? 'Where should we drop you?' : mode === 'hourly' ? 'Where should the car meet you?' : 'Where should we pick you up?'}</h2>
            <div className="lr-row">
            <div className={`lr-addr ${resolving ? 'is-busy' : ''}`}>
              <span className={`lr-dot lr-dot--${stage === 'drop' ? 'to' : 'from'}`} aria-hidden="true" />
              <div>
                {resolving ? (
                  <strong className="is-empty">Finding this place…</strong>
                ) : place ? (
                  <>
                    <strong>{place.name}</strong>
                    {addrLine ? <small>{addrLine}</small> : null}
                  </>
                ) : (
                  <strong className="is-empty">Move the map to place the pin</strong>
                )}
              </div>
            </div>
            <button type="button" className="lr-cta" disabled={!place || resolving || farApart} onClick={confirmStage}>
              {resolving ? 'Finding address…' : stage === 'drop' ? 'Confirm drop' : 'Confirm pickup'}
            </button>
            </div>
            {modeSeg}
            {farApart ? <p className="lr-warn" role="alert">Pickup &amp; Drop is for trips inside one city. For a longer trip choose Outstation.</p> : null}
            {stage === 'drop' ? <button type="button" className="lr-link" onClick={() => enter('pickup')}>Change pickup</button> : null}
          </section>
        ) : (
          <section key="when" className={`lr-sheet lr-sheet--tall ${peek ? 'is-peek' : ''}`} aria-label="Plan your trip">
            <button type="button" className="lr-gripbtn" aria-label={peek ? 'Show the trip details' : 'Show more of the map'} aria-expanded={!peek} onClick={() => setPeek((p) => !p)} />
            <p className="lr-step">Step {steps} of {steps}</p>
            <h2>{mode === 'hourly' ? 'Plan your rental' : 'Plan your trip'}</h2>

            <div className="lr-body">
            <div className="lr-trip">
              <button type="button" onClick={() => enter('pickup')}>
                <span className="lr-dot lr-dot--from" aria-hidden="true" />
                <span><small>Pickup</small><strong>{pickup?.name ?? 'Choose pickup'}</strong></span>
                <em>Edit</em>
              </button>
              {mode === 'pickup' ? (
                <button type="button" onClick={() => enter('drop')}>
                  <span className="lr-dot lr-dot--to" aria-hidden="true" />
                  <span><small>Drop</small><strong>{drop?.name ?? 'Choose drop'}</strong></span>
                  <em>Edit</em>
                </button>
              ) : null}
            </div>
            {modeSeg}

            {mode === 'hourly' ? (
              <div className="lr-hourly-plan">
                <label className="lr-field lr-field--duration">
                  <span>Rental Duration</span>
                  <div className="lr-select">
                    <select value={hours ?? ''} onChange={(e) => { setHours(e.target.value ? Number(e.target.value) : null); setError(''); }}>
                      <option value="">Select duration</option>
                      {RENTAL_PACKAGE_HOURS.map((h) => <option key={h} value={h}>{h} hours</option>)}
                    </select>
                  </div>
                </label>
                <div className="lr-pair lr-pair--two">
                  {scheduleFields}
                </div>
              </div>
            ) : (
              <div className="lr-pair lr-pair--two">
                {scheduleFields}
              </div>
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
      {timeOpen ? (
        <TimePicker title="Pickup time" date={date} value={time} validate="pickup" onClose={() => setTimeOpen(false)} onConfirm={(t) => { setTime(t); setError(''); setTimeOpen(false); }} />
      ) : null}
    </div>
  );
}
export default LocalRentalsPage;
