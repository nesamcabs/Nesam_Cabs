// Route map (Leaflet). Shows pickup, destination, the driven route, the driver and the
// rider's own position; can also run in "drop a pin" mode where the rider pans the map
// under a fixed pin. Tiles are configurable (VITE_MAP_TILE_URL) and keep their attribution.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '@core/types';
import { DEFAULT_CENTER } from '@core/config/constants';
import { isValidLatLng } from '@core/utils/geo';
import { Icon } from './Icon';
import { GoogleRouteMap, hasGoogleMapsWebKey } from './GoogleRouteMap';

const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface Props {
  pickup?: (LatLng & { name?: string }) | null;
  drop?: (LatLng & { name?: string }) | null;
  driver?: (LatLng & { label?: string; stale?: boolean }) | null;
  userLocation?: LatLng | null;
  /** [lat, lng] pairs of the route to draw. A straight pickup→drop line is drawn when absent. */
  path?: [number, number][] | null;
  /** The whole trip, drawn quietly underneath `path` (e.g. while `path` is the driver's leg). */
  basePath?: [number, number][] | null;
  /** Visible area of the map when something (e.g. the booking panel) covers part of it. */
  padding?: MapPadding;
  /** Drop-a-pin mode: a fixed pin at the visible centre; reports where the map is centred. */
  pinMode?: 'pickup' | 'drop' | null;
  onCenterChange?: (p: LatLng) => void;
  className?: string;
  label: string;
}

const pin = (kind: 'pickup' | 'drop') =>
  L.divIcon({ className: 'map-pin-wrap', html: `<span class="map-pin map-pin--${kind}"></span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
const carIcon = (stale: boolean) =>
  L.divIcon({
    className: 'map-pin-wrap',
    html: `<span class="map-car ${stale ? 'map-car--stale' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11 6 5h12l2 6M3 11h18v8H3ZM6 19v2M18 19v2M6 14h2M16 14h2"/></svg></span>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
const meIcon = L.divIcon({ className: 'map-pin-wrap', html: '<span class="map-me"></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

const ZERO: MapPadding = { top: 24, right: 24, bottom: 24, left: 24 };

function LeafletRouteMap({ pickup, drop, driver, userLocation, path, basePath, padding = ZERO, pinMode = null, onCenterChange, className = '', label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layers = useRef<{ group: L.LayerGroup; route: L.Polyline | null }>({ group: L.layerGroup(), route: null });
  const padRef = useRef(padding);
  padRef.current = padding;
  const centerCb = useRef(onCenterChange);
  centerCb.current = onCenterChange;
  const pinRef = useRef(pinMode);
  pinRef.current = pinMode;
  const lastFit = useRef('');
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [fitTick, setFitTick] = useState(0);

  const visibleCenter = (map: L.Map): L.LatLng => {
    const p = padRef.current;
    const size = map.getSize();
    return map.containerPointToLatLng(L.point((p.left + (size.x - p.right)) / 2, (p.top + (size.y - p.bottom)) / 2));
  };

  // Create the map once.
  useEffect(() => {
    if (!host.current) return undefined;
    const map = L.map(host.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: true, worldCopyJump: false, minZoom: 3, maxZoom: 18 });
    map.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);
    const tiles = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19, subdomains: 'abc', crossOrigin: true });
    let errors = 0;
    tiles.on('tileerror', () => {
      errors += 1;
      if (errors > 6) setTilesFailed(true);
    });
    tiles.on('tileload', () => {
      if (errors) {
        errors = 0;
        setTilesFailed(false);
      }
    });
    tiles.addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layers.current.group.addTo(map);
    map.attributionControl.setPrefix(false);
    mapRef.current = map;

    const onMove = () => {
      if (pinRef.current && centerCb.current) {
        const c = visibleCenter(map);
        centerCb.current({ lat: c.lat, lng: c.lng });
      }
    };
    map.on('moveend', onMove);

    const ro = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      lastFit.current = ''; // refit for the new size
      setFitTick((n) => n + 1);
    });
    ro.observe(host.current);
    setReady(true);
    return () => {
      ro.disconnect();
      mapRef.current = null;
      // Cancel any running pan / zoom animation first: its frame callback would
      // otherwise touch panes that remove() has already torn down.
      try {
        map.stop();
      } catch {
        /* map was never fully initialised */
      }
      map.remove();
    };
  }, []);

  // Draw markers + route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const group = layers.current.group;
    group.clearLayers();

    const pts: L.LatLngExpression[] = [];
    const p = pickup && isValidLatLng(pickup) ? pickup : null;
    const d = drop && isValidLatLng(drop) ? drop : null;
    const line: [number, number][] | null = path && path.length > 1 ? path : p && d ? [[p.lat, p.lng], [d.lat, d.lng]] : null;
    if (basePath && basePath.length > 2) {
      L.polyline(basePath, { color: '#9a96a0', weight: 5, opacity: 0.75, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group);
      for (const pt of basePath) pts.push(pt);
    }
    if (line) {
      const estimated = !(path && path.length > 2);
      // White casing under the coloured line keeps it readable on any tile.
      L.polyline(line, { color: '#ffffff', weight: 9, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(group);
      L.polyline(line, { color: '#17171c', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', dashArray: estimated ? '2 10' : undefined, interactive: false }).addTo(group);
      for (const pt of line) pts.push(pt);
    }
    if (p) {
      L.marker([p.lat, p.lng], { icon: pin('pickup'), keyboard: false, title: p.name ?? 'Pickup', zIndexOffset: 400 }).addTo(group);
      pts.push([p.lat, p.lng]);
    }
    if (d) {
      L.marker([d.lat, d.lng], { icon: pin('drop'), keyboard: false, title: d.name ?? 'Destination', zIndexOffset: 500 }).addTo(group);
      pts.push([d.lat, d.lng]);
    }
    if (userLocation && isValidLatLng(userLocation)) {
      L.marker([userLocation.lat, userLocation.lng], { icon: meIcon, keyboard: false, interactive: false, title: 'You' }).addTo(group);
    }
    if (driver && isValidLatLng(driver)) {
      L.marker([driver.lat, driver.lng], { icon: carIcon(!!driver.stale), keyboard: false, title: driver.label ?? 'Driver', zIndexOffset: 800 }).addTo(group);
      pts.push([driver.lat, driver.lng]);
    }

    // Refit only when what is shown has actually changed (not on every driver tick of the same trip).
    const key = JSON.stringify([p && [p.lat, p.lng], d && [d.lat, d.lng], line?.length ?? 0, padRef.current, !!driver, pinMode, fitTick]);
    if (key === lastFit.current && !(driver && isValidLatLng(driver))) return;
    if (pinMode) {
      // The rider is placing a pin: leave the map where it is unless nothing is chosen yet.
      if (lastFit.current === '') {
        const start = p ?? (userLocation && isValidLatLng(userLocation) ? userLocation : null);
        if (start) map.setView([start.lat, start.lng], Math.max(map.getZoom(), 15), { animate: false });
      }
      lastFit.current = key;
      return;
    }
    lastFit.current = key;
    const pad = padRef.current;
    if (pts.length >= 2) {
      const bounds = L.latLngBounds(pts);
      if (bounds.getSouthWest().equals(bounds.getNorthEast())) map.setView(bounds.getCenter(), 15, { animate: false });
      else map.fitBounds(bounds, { paddingTopLeft: [pad.left, pad.top], paddingBottomRight: [pad.right, pad.bottom], maxZoom: 16, animate: true, duration: 0.5 });
    } else if (pts.length === 1) {
      const [lat, lng] = pts[0] as [number, number];
      const target = map.getSize();
      // Centre the single point inside the visible (unpadded) area.
      const offsetX = (pad.left - pad.right) / 2;
      const offsetY = (pad.top - pad.bottom) / 2;
      const z = Math.max(map.getZoom(), 15);
      const proj = map.project([lat, lng], z).subtract([offsetX, offsetY]);
      map.setView(map.unproject(proj, z), z, { animate: target.x > 0 });
    } else if (userLocation && isValidLatLng(userLocation)) {
      map.setView([userLocation.lat, userLocation.lng], 14, { animate: false });
    }
  }, [ready, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, driver?.lat, driver?.lng, driver?.stale, userLocation?.lat, userLocation?.lng, path, basePath, padding.top, padding.left, padding.right, padding.bottom, pinMode, fitTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Entering pin mode reports the starting centre so the caller can show its address.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pinMode) return;
    const c = visibleCenter(map);
    centerCb.current?.({ lat: c.lat, lng: c.lng });
  }, [pinMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    lastFit.current = '';
    setFitTick((n) => n + 1);
  };

  const pinStyle = { left: `calc(50% + ${(padding.left - padding.right) / 2}px)`, top: `calc(50% + ${(padding.top - padding.bottom) / 2}px)` };

  return (
    <div className={`route-map ${className}`} role="region" aria-label={label}>
      <div ref={host} className="route-map__canvas" />
      {pinMode ? (
        <div className="route-map__pin" style={pinStyle} aria-hidden="true">
          <span className={`map-drop map-drop--${pinMode}`} />
          <span className="map-drop__shadow" />
        </div>
      ) : null}
      <button type="button" className="route-map__recenter" onClick={recenter} aria-label="Recentre map">
        <Icon name="current-location" size={20} />
      </button>
      {tilesFailed ? <div className="route-map__offline">Map tiles could not be loaded. Your route and fares are unaffected.</div> : null}
    </div>
  );
}

export function RouteMap(props: Props) {
  const [googleFailed, setGoogleFailed] = useState(false);
  const padding = props.padding ?? ZERO;
  if (hasGoogleMapsWebKey && !googleFailed) return <GoogleRouteMap {...props} padding={padding} onLoadError={() => setGoogleFailed(true)} />;
  return <LeafletRouteMap {...props} padding={padding} />;
}
