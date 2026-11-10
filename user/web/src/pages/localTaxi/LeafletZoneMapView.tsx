// The Local Taxi map: the active service areas (so the rider sees what the server enforces), the pickup and drop
// as tappable name tags, the road route as a dashed line, and the driver. Used for choosing a ride and for the live ride.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/platform/firebase';
import type { Spot } from './api';

const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; OpenStreetMap contributors';

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

/** A name tag pinned to a point: a coloured dot, the place name and a chevron. Built with DOM nodes so place names are never parsed as HTML. */
function tag(kind: 'from' | 'to', text: string, onClick?: () => void): HTMLElement {
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

export function LeafletZoneMapView({
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
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const zones = useActiveZones();
  const handlers = useRef({ onPickupClick, onDropClick });
  handlers.current = { onPickupClick, onDropClick };

  useEffect(() => {
    if (!host.current || map.current) return undefined;
    const m = L.map(host.current, { zoomControl: false, attributionControl: true }).setView([11.341, 77.7172], 12);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(m);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The map sits in a layout that changes size (sheet, rotation, keyboard): keep it drawn correctly.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null;
    ro?.observe(host.current);
    return () => { ro?.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const g = layer.current;
    const m = map.current;
    if (!g || !m) return;
    g.clearLayers();
    const pts: [number, number][] = [];
    for (const z of zones) for (const rings of z.polygons) {
      const latlngs = rings.map((r) => r.map(([lng, lat]) => [lat, lng] as [number, number]));
      L.polygon(latlngs, { color: '#c62828', weight: 1.5, fillOpacity: 0.05, dashArray: '4 6', interactive: false }).addTo(g);
      pts.push(...latlngs[0]!);
    }
    const hasBoth = !!pickup && !!drop;
    if (hasBoth) {
      const line: [number, number][] = route && route.length > 1 ? route : [[pickup!.lat, pickup!.lng], [drop!.lat, drop!.lng]];
      L.polyline(line, { color: '#0f172a', weight: 4, opacity: 0.85, dashArray: '2 9', lineCap: 'round', interactive: false }).addTo(g);
      pts.length = 0; // fit to the trip, not the whole zone
      pts.push(...line);
    }
    const pin = (p: Spot, kind: 'from' | 'to', onClick?: () => void) => {
      L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 3, fillColor: kind === 'from' ? '#16a34a' : '#dc2626', fillOpacity: 1, interactive: false }).addTo(g);
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'lt-tagwrap', html: tag(kind, p.name, onClick), iconSize: [0, 0], iconAnchor: [0, kind === 'from' ? 18 : -10] }), keyboard: false, zIndexOffset: 500 }).addTo(g);
      if (!hasBoth) pts.push([p.lat, p.lng]);
    };
    if (pickup) pin(pickup, 'from', handlers.current.onPickupClick ? () => handlers.current.onPickupClick?.() : undefined);
    if (drop) pin(drop, 'to', handlers.current.onDropClick ? () => handlers.current.onDropClick?.() : undefined);
    if (driver) { L.circleMarker([driver.lat, driver.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#0f172a', fillOpacity: 1 }).bindTooltip('Your driver').addTo(g); pts.push([driver.lat, driver.lng]); }
    if (pts.length) m.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [32, 72], paddingBottomRight: [32, 78], maxZoom: 16 });
  }, [zones, route, pickup?.lat, pickup?.lng, pickup?.name, drop?.lat, drop?.lng, drop?.name, driver?.lat, driver?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={host} className={`lt-map ${fill ? 'lt-map--fill' : ''}`} role="img" aria-label={label} />;
}
