import { LeafletZoneMapView } from './LeafletZoneMapView';
import { onGoogleMapsFailure } from '@/lib/googleMaps';
// The Local Taxi map (Google Maps): the active service areas (so the rider sees what the server enforces), the pickup and
// drop as tappable name tags, the road route as a dashed line, and the driver. Used for choosing a ride and for the live ride.
import { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/platform/firebase';
import { hasGoogleMapsWebKey, loadGoogleMaps } from '@/components/GoogleRouteMap';
import type { Spot } from './api';

type Ring = [number, number][];
interface ZoneShape { id: string; name: string; polygons: Ring[][] }

function parseZone(id: string, d: Record<string, any>): ZoneShape | null {
  try {
    const g = JSON.parse(String(d.boundaryJson || '')) as { type: string; coordinates: any };
    const polys: Ring[][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.length ? { id, name: String(d.name || ''), polygons: polys } : null;
  } catch { return null; }
}

/**
 * Active zones, live, and whether the first answer has arrived (so "no zone yet" is never claimed while still loading).
 * `known` is false if the zones could not be read at all.
 */
export function useActiveZoneState(): { zones: ZoneShape[]; loaded: boolean; known: boolean } {
  const [state, setState] = useState<{ zones: ZoneShape[]; loaded: boolean; known: boolean }>({ zones: [], loaded: false, known: true });
  useEffect(() => onSnapshot(
    query(collection(db, 'lt_zones'), where('status', '==', 'active')),
    (s) => setState({ zones: s.docs.flatMap((d) => parseZone(d.id, d.data()) ?? []), loaded: true, known: true }),
    () => setState({ zones: [], loaded: true, known: false }),
  ), []);
  return state;
}

/** Active zones, live. Empty while none is switched on (then no boundary is drawn). */
export function useActiveZones(): ZoneShape[] {
  return useActiveZoneState().zones;
}

/** A name tag: a coloured dot, the place name and (when tappable) a chevron. Built with DOM nodes so place names are never parsed as HTML. */
function tagElement(kind: 'from' | 'to', text: string, onClick?: () => void): HTMLElement {
  const root = document.createElement('div');
  root.className = `lt-tag lt-tag--${kind}${onClick ? ' is-tap' : ''}`;
  const dot = document.createElement('i');
  const name = document.createElement('span');
  name.textContent = text;
  root.append(dot, name);
  if (onClick) {
    const chev = document.createElement('b');
    chev.textContent = '›';
    root.append(chev);
    root.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  }
  return root;
}

/** A name tag pinned to a map point (Google Maps overlay). The tag sits just above a "from" point and just below a "to" point. */
function makeTagOverlay(maps: any) {
  return class TagOverlay extends maps.OverlayView {
    private el: HTMLElement;
    private pos: any;
    private offset: number;
    constructor(pos: any, el: HTMLElement, offset: number) { super(); this.pos = pos; this.el = el; this.offset = offset; this.el.style.position = 'absolute'; }
    onAdd() { this.getPanes()?.overlayMouseTarget.appendChild(this.el); }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(this.pos);
      if (!p) return;
      this.el.style.left = `${p.x}px`;
      this.el.style.top = `${p.y + this.offset}px`;
    }
    onRemove() { this.el.remove(); }
  };
}

export function ZoneMapView({
  pickup, drop, driver, route, label, fill = false, onPickupClick, onDropClick,
}: {
  pickup?: Spot | null; drop?: Spot | null; driver?: { lat: number; lng: number } | null;
  /** Road route as [lat, lng] pairs; a straight dashed line is drawn when it is empty. */
  route?: [number, number][] | null;
  label: string;
  /** Fill the height of the parent (the select-a-ride screen) instead of a fixed small map. */
  fill?: boolean;
  onPickupClick?: () => void; onDropClick?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(!hasGoogleMapsWebKey);
  const zones = useActiveZones();
  const handlers = useRef({ onPickupClick, onDropClick });
  handlers.current = { onPickupClick, onDropClick };

  // Create the map once Google Maps has loaded. If it cannot load, the page says so; there is no second map.
  useEffect(() => {
    if (!hasGoogleMapsWebKey || !host.current) return undefined;
    let alive = true;
    const stopFailureListener = onGoogleMapsFailure(() => { if (alive) setFailed(true); });
    loadGoogleMaps().then((maps) => {
      if (!alive || !host.current) return;
      map.current = new maps.Map(host.current, {
        center: { lat: 11.341, lng: 77.7172 }, zoom: 12, disableDefaultUI: true, zoomControl: true,
        zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM }, clickableIcons: false, gestureHandling: 'greedy',
      });
      setReady(true);
    }).catch(() => { if (alive) setFailed(true); });
    return () => {
      alive = false;
      stopFailureListener();
      overlays.current.forEach((o) => o.setMap?.(null));
      overlays.current = [];
      map.current = null;
    };
  }, []);

  // The map sits in a layout that changes size (sheet, rotation, keyboard): keep it drawn correctly.
  useEffect(() => {
    if (!ready || !host.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (map.current && window.google?.maps) window.google.maps.event.trigger(map.current, 'resize'); });
    ro.observe(host.current);
    return () => ro.disconnect();
  }, [ready]);

  // Zones, the trip, the pins and the driver; then fit the view to them.
  useEffect(() => {
    const m = map.current, maps = window.google?.maps;
    if (!m || !maps || !ready) return;
    overlays.current.forEach((o) => o.setMap?.(null));
    overlays.current = [];
    const add = <T,>(o: T): T => { overlays.current.push(o); return o; };
    const Tag = makeTagOverlay(maps);
    const bounds = new maps.LatLngBounds();
    let count = 0;
    const extend = (p: { lat: number; lng: number }) => { bounds.extend(p); count += 1; };
    const hasBoth = !!pickup && !!drop;

    // Service areas: drawn always; they count towards the view only while no trip is shown.
    for (const z of zones) for (const rings of z.polygons) {
      const paths = rings.map((r) => r.map(([lng, lat]) => ({ lat, lng })));
      add(new maps.Polygon({ map: m, paths, strokeColor: '#c8181f', strokeWeight: 1.5, strokeOpacity: 0.8, fillColor: '#c8181f', fillOpacity: 0.05, clickable: false }));
      if (!hasBoth) paths[0]?.forEach(extend);
    }

    // The trip: a dashed road line (or a straight one when there is no road route yet), fitted instead of the zones.
    if (hasBoth) {
      const line: [number, number][] = route && route.length > 1 ? route : [[pickup!.lat, pickup!.lng], [drop!.lat, drop!.lng]];
      add(new maps.Polyline({
        map: m, path: line.map(([lat, lng]) => ({ lat, lng })), clickable: false, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, strokeColor: '#0f172a', scale: 4 }, offset: '0', repeat: '11px' }],
      }));
      line.forEach(([lat, lng]) => extend({ lat, lng }));
    }

    const pin = (p: Spot, kind: 'from' | 'to', onClick?: () => void) => {
      add(new maps.Marker({
        map: m, position: { lat: p.lat, lng: p.lng }, clickable: false, zIndex: 400,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 7, fillColor: kind === 'from' ? '#16a34a' : '#c8181f', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
      }));
      const tag = add(new Tag(new maps.LatLng(p.lat, p.lng), tagElement(kind, p.name, onClick), kind === 'from' ? -18 : 10));
      tag.setMap(m);
      if (!hasBoth) extend(p);
    };
    if (pickup) pin(pickup, 'from', handlers.current.onPickupClick ? () => handlers.current.onPickupClick?.() : undefined);
    if (drop) pin(drop, 'to', handlers.current.onDropClick ? () => handlers.current.onDropClick?.() : undefined);
    if (driver) {
      add(new maps.Marker({
        map: m, position: { lat: driver.lat, lng: driver.lng }, title: 'Your driver', zIndex: 450,
        icon: { path: maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#0f172a', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
      }));
      extend(driver);
    }

    if (count === 1) { m.setCenter(bounds.getCenter()); m.setZoom(15); }
    else if (count > 1) {
      m.fitBounds(bounds, { top: 72, right: 32, bottom: 78, left: 32 });
      maps.event.addListenerOnce(m, 'idle', () => { if (m.getZoom() > 16) m.setZoom(16); });
    }
  }, [ready, zones, route, pickup?.lat, pickup?.lng, pickup?.name, drop?.lat, drop?.lng, drop?.name, driver?.lat, driver?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <LeafletZoneMapView pickup={pickup} drop={drop} driver={driver} route={route} label={label} fill={fill} onPickupClick={onPickupClick} onDropClick={onDropClick} />;

  return (
    <div className={`lt-map ${fill ? 'lt-map--fill' : ''}`} role="img" aria-label={label}>
      <div ref={host} style={{ width: '100%', height: '100%' }} />
      {failed ? <div className="route-map__offline" role="alert">The map could not load. Check your connection and reload the page.</div> : null}
    </div>
  );
}
