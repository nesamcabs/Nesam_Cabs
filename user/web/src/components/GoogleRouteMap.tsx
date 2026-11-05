import { useEffect, useRef, useState } from 'react';
import type { LatLng } from '@core/types';
import { DEFAULT_CENTER } from '@core/config/constants';
import { isValidLatLng } from '@core/utils/geo';
import { Icon } from './Icon';
import type { MapPadding } from './RouteMap';

declare global { interface Window { google?: any; __nesamGoogleMapsPromise?: Promise<any>; } }

const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';

function loadGoogleMaps(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__nesamGoogleMapsPromise) return window.__nesamGoogleMapsPromise;
  window.__nesamGoogleMapsPromise = new Promise((resolve, reject) => {
    const callback = `__nesamMapsReady_${Date.now()}`;
    (window as any)[callback] = () => { delete (window as any)[callback]; resolve(window.google.maps); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&callback=${callback}`;
    script.async = true;
    script.onerror = () => { delete (window as any)[callback]; reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(script);
  });
  return window.__nesamGoogleMapsPromise;
}

interface Props {
  pickup?: (LatLng & { name?: string }) | null;
  drop?: (LatLng & { name?: string }) | null;
  driver?: (LatLng & { label?: string; stale?: boolean }) | null;
  userLocation?: LatLng | null;
  path?: [number, number][] | null;
  basePath?: [number, number][] | null;
  padding: MapPadding;
  pinMode?: 'pickup' | 'drop' | null;
  onCenterChange?: (p: LatLng) => void;
  className?: string;
  label: string;
  onLoadError: () => void;
}

const markerIcon = (maps: any, color: string) => ({
  path: 'M12 2C7.6 2 4 5.6 4 10c0 5.5 8 12 8 12s8-6.5 8-12c0-4.4-3.6-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z',
  fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5, scale: 1.25, anchor: new maps.Point(12, 22),
});

export function GoogleRouteMap({ pickup, drop, driver, userLocation, path, basePath, padding, pinMode = null, onCenterChange, className = '', label, onLoadError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlays = useRef<any[]>([]);
  const centerCb = useRef(onCenterChange);
  centerCb.current = onCenterChange;
  const pinModeRef = useRef(pinMode);
  pinModeRef.current = pinMode;
  const [ready, setReady] = useState(false);
  const [fitTick, setFitTick] = useState(0);

  useEffect(() => {
    let alive = true;
    loadGoogleMaps().then((maps) => {
      if (!alive || !host.current) return;
      mapRef.current = new maps.Map(host.current, { center: DEFAULT_CENTER, zoom: 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false, gestureHandling: 'greedy' });
      mapRef.current.addListener('idle', () => {
        if (!pinModeRef.current || !centerCb.current) return;
        const c = mapRef.current.getCenter();
        centerCb.current({ lat: c.lat(), lng: c.lng() });
      });
      setReady(true);
    }).catch(onLoadError);
    return () => { alive = false; overlays.current.forEach((o) => o.setMap?.(null)); overlays.current = []; mapRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current, maps = window.google?.maps;
    if (!map || !maps || !ready) return;
    overlays.current.forEach((o) => o.setMap?.(null));
    overlays.current = [];
    const add = (overlay: any) => { overlays.current.push(overlay); return overlay; };
    const bounds = new maps.LatLngBounds();
    let count = 0;
    const addPoint = (p: LatLng) => { bounds.extend(p); count += 1; };
    const p = pickup && isValidLatLng(pickup) ? pickup : null;
    const d = drop && isValidLatLng(drop) ? drop : null;
    const line = path && path.length > 1 ? path : p && d ? [[p.lat, p.lng], [d.lat, d.lng]] as [number, number][] : null;
    const draw = (points: [number, number][], color: string, weight: number, opacity: number) => {
      add(new maps.Polyline({ map, path: points.map(([lat, lng]) => ({ lat, lng })), strokeColor: color, strokeWeight: weight, strokeOpacity: opacity, geodesic: false }));
      points.forEach(([lat, lng]) => addPoint({ lat, lng }));
    };
    if (basePath && basePath.length > 1) draw(basePath, '#9a96a0', 5, 0.72);
    if (line) { draw(line, '#ffffff', 9, 0.9); draw(line, '#17171c', 5, 0.95); }
    if (p) { add(new maps.Marker({ map, position: p, title: p.name ?? 'Pickup', icon: markerIcon(maps, '#22a85a') })); addPoint(p); }
    if (d) { add(new maps.Marker({ map, position: d, title: d.name ?? 'Destination', icon: markerIcon(maps, '#e8344c') })); addPoint(d); }
    if (userLocation && isValidLatLng(userLocation)) add(new maps.Marker({ map, position: userLocation, title: 'You', icon: { path: maps.SymbolPath.CIRCLE, fillColor: '#2563eb', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale: 7 } }));
    if (driver && isValidLatLng(driver)) { add(new maps.Marker({ map, position: driver, title: driver.label ?? 'Driver', label: { text: '🚕', fontSize: '22px' } })); addPoint(driver); }
    if (pinMode) {
      const start = p ?? (userLocation && isValidLatLng(userLocation) ? userLocation : null);
      if (start) { map.setCenter(start); map.setZoom(15); }
      return;
    }
    if (count > 1) map.fitBounds(bounds, padding);
    else if (count === 1) { map.setCenter(bounds.getCenter()); map.setZoom(15); }
    else if (userLocation && isValidLatLng(userLocation)) { map.setCenter(userLocation); map.setZoom(14); }
  }, [ready, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, driver?.lat, driver?.lng, driver?.stale, userLocation?.lat, userLocation?.lng, path, basePath, padding.top, padding.right, padding.bottom, padding.left, pinMode, fitTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const pinStyle = { left: `calc(50% + ${(padding.left - padding.right) / 2}px)`, top: `calc(50% + ${(padding.top - padding.bottom) / 2}px)` };
  return <div className={`route-map ${className}`} role="region" aria-label={label}>
    <div ref={host} className="route-map__canvas" />
    {pinMode ? <div className="route-map__pin" style={pinStyle} aria-hidden="true"><span className={`map-drop map-drop--${pinMode}`} /><span className="map-drop__shadow" /></div> : null}
    <button type="button" className="route-map__recenter" onClick={() => setFitTick((n) => n + 1)} aria-label="Recentre map"><Icon name="current-location" size={20} /></button>
  </div>;
}

export const hasGoogleMapsWebKey = apiKey.length > 0;
