import { useEffect, useRef, useState } from 'react';

declare global { interface Window { google?: any; __nesamGoogleMapsPromise?: Promise<any>; } }

export interface GoogleMapPoint { lat?: number | null; lng?: number | null; label?: string; }
const valid = (p?: GoogleMapPoint | null): p is Required<Pick<GoogleMapPoint, 'lat' | 'lng'>> & GoogleMapPoint => !!p && typeof p.lat === 'number' && Number.isFinite(p.lat) && typeof p.lng === 'number' && Number.isFinite(p.lng);
const key = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';

function load(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__nesamGoogleMapsPromise) return window.__nesamGoogleMapsPromise;
  window.__nesamGoogleMapsPromise = new Promise((resolve, reject) => {
    const callback = `__nesamPanelMaps_${Date.now()}`;
    (window as any)[callback] = () => { delete (window as any)[callback]; resolve(window.google.maps); };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=${callback}`;
    script.async = true;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return window.__nesamGoogleMapsPromise;
}

export function GoogleMapPreview({ pickup, drop, height = 190 }: { pickup?: GoogleMapPoint | null; drop?: GoogleMapPoint | null; height?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!key || !host.current || (!valid(pickup) && !valid(drop))) return;
    let alive = true;
    const overlays: any[] = [];
    load().then((maps) => {
      if (!alive || !host.current) return;
      const first = valid(pickup) ? pickup : drop as Required<Pick<GoogleMapPoint, 'lat' | 'lng'>>;
      const map = new maps.Map(host.current, { center: first, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false, gestureHandling: 'cooperative' });
      const bounds = new maps.LatLngBounds();
      const add = (p: GoogleMapPoint | null | undefined, color: string, fallback: string) => {
        if (!valid(p)) return;
        bounds.extend(p);
        overlays.push(new maps.Marker({ map, position: p, title: p.label || fallback, icon: { path: maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale: 9 } }));
      };
      add(pickup ?? null, '#16a34a', 'Pickup'); add(drop ?? null, '#e8344c', 'Destination');
      if (valid(pickup) && valid(drop)) {
        overlays.push(new maps.Polyline({ map, path: [pickup, drop], strokeColor: '#374151', strokeOpacity: 0.8, strokeWeight: 4, geodesic: true }));
        map.fitBounds(bounds, 42);
      }
    }).catch(() => alive && setFailed(true));
    return () => { alive = false; overlays.forEach((o) => o.setMap?.(null)); };
  }, [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng]);
  if (!key || failed || (!valid(pickup) && !valid(drop))) return null;
  return <div ref={host} aria-label="Trip route map" style={{ height, width: '100%', borderRadius: 12, overflow: 'hidden', margin: '12px 0', border: '1px solid rgba(148,163,184,.35)' }} />;
}
