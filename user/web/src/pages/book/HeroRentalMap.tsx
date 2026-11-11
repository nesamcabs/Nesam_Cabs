// Desktop hero interactive map for Local Rentals: replaces the hero photo while keeping
// the right-side booking form card anchored and letting riders click or drag pins directly.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoPlace, LatLng } from '@core/types';
import { reverseGeocode } from '@core/services/geoService';
import { haversineKm, isValidLatLng } from '@core/utils/geo';
import { Icon } from '@/components/Icon';
import { hasGoogleMapsWebKey, loadGoogleMaps, onGoogleMapsFailure } from '@/lib/googleMaps';
import { useDeviceLocation } from '@/lib/hooks';
import { QUICK_CITIES } from './content';
import './heroRentalMap.css';

const TILE_URL = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; OpenStreetMap contributors';
const STATE_VIEW = { lat: 11.2, lng: 78.2, zoom: 7 };
const CITY_LIMIT_KM = 40;
const PIN_SVG_PATH = 'M12 2C7.58 2 4 5.58 4 10c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z';

type PinTarget = 'pickup' | 'drop';

interface MapFlyTarget {
  lat: number;
  lng: number;
  zoom: number;
  seq: number;
}

export interface HeroRentalMapProps {
  mode: 'rental' | 'pickup';
  pickup: GeoPlace | null;
  drop: GeoPlace | null;
  pinTarget: PinTarget;
  onPinTargetChange: (target: PinTarget) => void;
  onPickPlace: (target: PinTarget, place: GeoPlace) => void;
}

const coordKey = (ll: LatLng) => `${ll.lat.toFixed(5)},${ll.lng.toFixed(5)}`;

const pinPlace = (ll: LatLng): GeoPlace => ({
  id: `pin-${ll.lat.toFixed(5)}-${ll.lng.toFixed(5)}`,
  name: `Pinned location (${ll.lat.toFixed(4)}, ${ll.lng.toFixed(4)})`,
  address: `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`,
  type: 'other',
  lat: ll.lat,
  lng: ll.lng,
});

function leafletPinIcon(kind: PinTarget): L.DivIcon {
  return L.divIcon({
    className: 'hm-pinwrap',
    html: `<div class="hm-pin hm-pin--${kind}"><span class="hm-pin__head"><i></i></span></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function attachSafeTooltip(marker: L.Marker, label: string) {
  const el = document.createElement('span');
  el.textContent = label;
  marker.bindTooltip(el, {
    permanent: true,
    direction: 'top',
    offset: [0, -34],
    className: 'hm-tooltip',
  });
}

interface RendererProps {
  mode: 'rental' | 'pickup';
  pickup: GeoPlace | null;
  drop: GeoPlace | null;
  pinTarget: PinTarget;
  rightInset: number;
  brandColor: string;
  flyTarget: MapFlyTarget | null;
  suppressKeys: Record<PinTarget, string>;
  onCoordPick: (target: PinTarget, ll: LatLng, advanceDrop: boolean) => void;
}

function LeafletHeroCanvas({
  mode,
  pickup,
  drop,
  pinTarget,
  rightInset,
  brandColor,
  flyTarget,
  suppressKeys,
  onCoordPick,
}: RendererProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupRef = useRef<L.Marker | null>(null);
  const dropRef = useRef<L.Marker | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const targetRef = useRef<PinTarget>(pinTarget);
  const rightRef = useRef(rightInset);
  const pickCbRef = useRef(onCoordPick);
  const lastCamKey = useRef('');

  targetRef.current = pinTarget;
  rightRef.current = rightInset;
  pickCbRef.current = onCoordPick;

  const centerVisible = useCallback((ll: LatLng, zoom: number) => {
    const map = mapRef.current;
    if (!map) return;
    const shiftX = Math.round(rightRef.current / 2);
    const point = map.project([ll.lat, ll.lng], zoom).add([shiftX, 0]);
    const shifted = map.unproject(point, zoom);
    map.setView(shifted, zoom, { animate: true });
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const map = L.map(el, { zoomControl: false, attributionControl: false });
    mapRef.current = map;
    L.control.zoom({ position: 'topleft' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

    const start = isValidLatLng(pickup) ? pickup : STATE_VIEW;
    const startZoom = isValidLatLng(pickup) ? 14 : STATE_VIEW.zoom;
    const shiftX = Math.round(rightRef.current / 2);
    const pt = map.project([start.lat, start.lng], startZoom).add([shiftX, 0]);
    map.setView(map.unproject(pt, startZoom), startZoom);

    map.on('click', (e: L.LeafletMouseEvent) => {
      pickCbRef.current(targetRef.current, { lat: e.latlng.lat, lng: e.latlng.lng }, true);
    });

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.invalidateSize()) : null;
    ro?.observe(el);

    return () => {
      ro?.disconnect();
      map.remove();
      mapRef.current = null;
      pickupRef.current = null;
      dropRef.current = null;
      lineRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTarget) return;
    centerVisible(flyTarget, flyTarget.zoom);
  }, [flyTarget?.seq, centerVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pValid = isValidLatLng(pickup) ? pickup : null;
    const dValid = mode === 'pickup' && isValidLatLng(drop) ? drop : null;

    pickupRef.current?.remove();
    dropRef.current?.remove();
    lineRef.current?.remove();
    pickupRef.current = null;
    dropRef.current = null;
    lineRef.current = null;

    if (pValid) {
      const m = L.marker([pValid.lat, pValid.lng], {
        draggable: true,
        icon: leafletPinIcon('pickup'),
      }).addTo(map);
      attachSafeTooltip(m, pValid.name);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        pickCbRef.current('pickup', { lat: ll.lat, lng: ll.lng }, false);
      });
      pickupRef.current = m;
    }

    if (dValid) {
      const m = L.marker([dValid.lat, dValid.lng], {
        draggable: true,
        icon: leafletPinIcon('drop'),
      }).addTo(map);
      attachSafeTooltip(m, dValid.name);
      m.on('dragend', () => {
        const ll = m.getLatLng();
        pickCbRef.current('drop', { lat: ll.lat, lng: ll.lng }, false);
      });
      dropRef.current = m;
    }

    if (pValid && dValid) {
      lineRef.current = L.polyline(
        [
          [pValid.lat, pValid.lng],
          [dValid.lat, dValid.lng],
        ],
        { color: brandColor, weight: 3.5, dashArray: '8 8', opacity: 0.85 },
      ).addTo(map);
    }

    const pKey = pValid ? coordKey(pValid) : '';
    const dKey = dValid ? coordKey(dValid) : '';
    const camKey = `${mode}:${pKey}:${dKey}`;
    const internalHit =
      (pKey && suppressKeys.pickup === pKey && (!dKey || suppressKeys.drop === dKey)) ||
      (dKey && suppressKeys.drop === dKey && (!pKey || suppressKeys.pickup === pKey));

    if (camKey !== lastCamKey.current && !internalHit) {
      lastCamKey.current = camKey;
      if (pValid && dValid) {
        const bounds = L.latLngBounds([
          [pValid.lat, pValid.lng],
          [dValid.lat, dValid.lng],
        ]);
        map.fitBounds(bounds, {
          paddingTopLeft: [56, 72],
          paddingBottomRight: [Math.max(40, rightRef.current + 24), 76],
          maxZoom: 14,
        });
      } else if (pValid) {
        centerVisible(pValid, 14);
      } else if (dValid) {
        centerVisible(dValid, 14);
      }
    } else {
      lastCamKey.current = camKey;
    }
  }, [mode, pickup?.lat, pickup?.lng, pickup?.name, drop?.lat, drop?.lng, drop?.name, brandColor, suppressKeys, centerVisible]);

  return <div ref={elRef} className="hero-map__canvas" />;
}

function GoogleHeroCanvas({
  mode,
  pickup,
  drop,
  pinTarget,
  rightInset,
  brandColor,
  flyTarget,
  suppressKeys,
  onCoordPick,
  onFallback,
}: RendererProps & { onFallback: () => void }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapsRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const pickupMarkerRef = useRef<any>(null);
  const dropMarkerRef = useRef<any>(null);
  const lineRef = useRef<any>(null);
  const targetRef = useRef<PinTarget>(pinTarget);
  const rightRef = useRef(rightInset);
  const pickCbRef = useRef(onCoordPick);
  const lastCamKey = useRef('');

  targetRef.current = pinTarget;
  rightRef.current = rightInset;
  pickCbRef.current = onCoordPick;

  const centerVisible = useCallback((ll: LatLng, zoom: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(zoom);
    map.setCenter(ll);
    const shiftX = Math.round(rightRef.current / 2);
    if (shiftX > 0) map.panBy(shiftX, 0);
  }, []);

  useEffect(() => {
    let alive = true;
    const unlisten = onGoogleMapsFailure(() => {
      if (alive) onFallback();
    });

    loadGoogleMaps()
      .then((maps) => {
        if (!alive || !elRef.current) return;
        mapsRef.current = maps;
        const start = isValidLatLng(pickup) ? pickup : STATE_VIEW;
        const startZoom = isValidLatLng(pickup) ? 14 : STATE_VIEW.zoom;
        const map = new maps.Map(elRef.current, {
          center: { lat: start.lat, lng: start.lng },
          zoom: startZoom,
          disableDefaultUI: true,
          zoomControl: true,
          zoomControlOptions: { position: maps.ControlPosition.TOP_LEFT },
          gestureHandling: 'greedy',
          clickableIcons: false,
          draggableCursor: 'crosshair',
        });
        mapRef.current = map;
        const shiftX = Math.round(rightRef.current / 2);
        if (shiftX > 0) map.panBy(shiftX, 0);
        map.addListener('click', (e: any) => {
          if (!e?.latLng) return;
          pickCbRef.current(targetRef.current, { lat: e.latLng.lat(), lng: e.latLng.lng() }, true);
        });
      })
      .catch(() => {
        if (alive) onFallback();
      });

    return () => {
      alive = false;
      unlisten();
      pickupMarkerRef.current?.setMap(null);
      dropMarkerRef.current?.setMap(null);
      lineRef.current?.setMap(null);
      if (mapRef.current && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(mapRef.current);
      }
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flyTarget) return;
    centerVisible(flyTarget, flyTarget.zoom);
  }, [flyTarget?.seq, centerVisible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    const maps = mapsRef.current;
    if (!map || !maps) return;

    const pValid = isValidLatLng(pickup) ? pickup : null;
    const dValid = mode === 'pickup' && isValidLatLng(drop) ? drop : null;

    pickupMarkerRef.current?.setMap(null);
    dropMarkerRef.current?.setMap(null);
    lineRef.current?.setMap(null);
    pickupMarkerRef.current = null;
    dropMarkerRef.current = null;
    lineRef.current = null;

    const pinIcon = (fillColor: string) => ({
      path: PIN_SVG_PATH,
      fillColor,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      scale: 1.65,
      anchor: new maps.Point(12, 23),
    });

    if (pValid) {
      const m = new maps.Marker({
        map,
        position: { lat: pValid.lat, lng: pValid.lng },
        draggable: true,
        title: pValid.name,
        icon: pinIcon('#16a34a'),
      });
      m.addListener('dragend', (e: any) => {
        if (!e?.latLng) return;
        pickCbRef.current('pickup', { lat: e.latLng.lat(), lng: e.latLng.lng() }, false);
      });
      pickupMarkerRef.current = m;
    }

    if (dValid) {
      const m = new maps.Marker({
        map,
        position: { lat: dValid.lat, lng: dValid.lng },
        draggable: true,
        title: dValid.name,
        icon: pinIcon('#dc2626'),
      });
      m.addListener('dragend', (e: any) => {
        if (!e?.latLng) return;
        pickCbRef.current('drop', { lat: e.latLng.lat(), lng: e.latLng.lng() }, false);
      });
      dropMarkerRef.current = m;
    }

    if (pValid && dValid) {
      lineRef.current = new maps.Polyline({
        map,
        path: [
          { lat: pValid.lat, lng: pValid.lng },
          { lat: dValid.lat, lng: dValid.lng },
        ],
        strokeOpacity: 0,
        icons: [
          {
            icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeWeight: 3.5, strokeColor: brandColor, scale: 3 },
            offset: '0',
            repeat: '16px',
          },
        ],
      });
    }

    const pKey = pValid ? coordKey(pValid) : '';
    const dKey = dValid ? coordKey(dValid) : '';
    const camKey = `${mode}:${pKey}:${dKey}`;
    const internalHit =
      (pKey && suppressKeys.pickup === pKey && (!dKey || suppressKeys.drop === dKey)) ||
      (dKey && suppressKeys.drop === dKey && (!pKey || suppressKeys.pickup === pKey));

    if (camKey !== lastCamKey.current && !internalHit) {
      lastCamKey.current = camKey;
      if (pValid && dValid) {
        const bounds = new maps.LatLngBounds();
        bounds.extend({ lat: pValid.lat, lng: pValid.lng });
        bounds.extend({ lat: dValid.lat, lng: dValid.lng });
        map.fitBounds(bounds, {
          top: 72,
          left: 56,
          bottom: 76,
          right: Math.max(40, rightRef.current + 24),
        });
      } else if (pValid) {
        centerVisible(pValid, 14);
      } else if (dValid) {
        centerVisible(dValid, 14);
      }
    } else {
      lastCamKey.current = camKey;
    }
  }, [mode, pickup?.lat, pickup?.lng, pickup?.name, drop?.lat, drop?.lng, drop?.name, brandColor, suppressKeys, centerVisible]);

  return <div ref={elRef} className="hero-map__canvas" />;
}

/**
 * Interactive hero background map shown on desktop when Local Rentals is selected.
 * Keeps map framing aligned to the open area left of the right-side booking form card.
 */
export function HeroRentalMap({
  mode,
  pickup,
  drop,
  pinTarget,
  onPinTargetChange,
  onPickPlace,
}: HeroRentalMapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [rightInset, setRightInset] = useState(560);
  const [brandColor, setBrandColor] = useState('#1665e8');
  const [useLeaflet, setUseLeaflet] = useState(() => !hasGoogleMapsWebKey);
  const [resolving, setResolving] = useState<PinTarget | null>(null);
  const [flyTarget, setFlyTarget] = useState<MapFlyTarget | null>(null);
  const [suppressKeys, setSuppressKeys] = useState<Record<PinTarget, string>>({ pickup: '', drop: '' });
  const seqRef = useRef(0);
  const reqTokenRef = useRef(0);
  const { locating, locate } = useDeviceLocation(false);

  // Measure the right-side booking form card footprint and brand token before first paint so map pins center cleanly to its left.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el) {
      const brand = getComputedStyle(el).getPropertyValue('--brand').trim();
      if (brand) setBrandColor(brand);
    }
    const hero = el?.parentElement;
    if (!hero || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const heroRect = hero.getBoundingClientRect();
      const bf = hero.querySelector<HTMLElement>('.bf');
      const bfRect = bf?.getBoundingClientRect();
      if (bfRect && bfRect.left > heroRect.left + 160) {
        setRightInset(Math.max(0, Math.round(heroRect.right - bfRect.left + 16)));
      } else {
        setRightInset(16);
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(hero);
    const bf = hero.querySelector<HTMLElement>('.bf');
    if (bf) ro.observe(bf);
    measure();
    return () => ro.disconnect();
  }, []);

  const flyTo = useCallback((ll: LatLng, zoom: number) => {
    setFlyTarget({ lat: ll.lat, lng: ll.lng, zoom, seq: ++seqRef.current });
  }, []);

  const handleCoordPick = useCallback(
    (target: PinTarget, ll: LatLng, advanceDrop: boolean) => {
      const token = ++reqTokenRef.current;
      const key = coordKey(ll);
      setSuppressKeys((prev) => ({ ...prev, [target]: key }));
      setResolving(target);
      onPickPlace(target, pinPlace(ll));

      if (advanceDrop && mode === 'pickup' && target === 'pickup' && (!drop || drop.id === 'place-local-disposal')) {
        onPinTargetChange('drop');
      }

      reverseGeocode(ll)
        .then((place) => {
          if (reqTokenRef.current !== token) return;
          const resolved: GeoPlace = { ...place, lat: ll.lat, lng: ll.lng };
          setSuppressKeys((prev) => ({ ...prev, [target]: key }));
          onPickPlace(target, resolved);
          setResolving(null);
        })
        .catch(() => {
          if (reqTokenRef.current === token) setResolving(null);
        });
    },
    [mode, drop, onPickPlace, onPinTargetChange],
  );

  const pickQuickCity = (city: GeoPlace) => {
    onPickPlace(pinTarget, city);
    flyTo(city, 13);
  };

  const useMyLocation = async () => {
    const pos = await locate();
    if (!pos) return;
    const ll = { lat: pos.lat, lng: pos.lng };
    handleCoordPick(pinTarget, ll, false);
    flyTo(ll, 15);
  };

  const farApart =
    mode === 'pickup' &&
    isValidLatLng(pickup) &&
    isValidLatLng(drop) &&
    drop.id !== 'place-local-disposal' &&
    haversineKm(pickup, drop) > CITY_LIMIT_KM;

  const hudStyle = { '--hero-right-inset': `${rightInset}px` } as CSSProperties;

  return (
    <div className="hero-map" ref={rootRef} style={hudStyle} aria-label="Interactive pickup and drop map">
      {useLeaflet ? (
        <LeafletHeroCanvas
          mode={mode}
          pickup={pickup}
          drop={drop}
          pinTarget={pinTarget}
          rightInset={rightInset}
          brandColor={brandColor}
          flyTarget={flyTarget}
          suppressKeys={suppressKeys}
          onCoordPick={handleCoordPick}
        />
      ) : (
        <GoogleHeroCanvas
          mode={mode}
          pickup={pickup}
          drop={drop}
          pinTarget={pinTarget}
          rightInset={rightInset}
          brandColor={brandColor}
          flyTarget={flyTarget}
          suppressKeys={suppressKeys}
          onCoordPick={handleCoordPick}
          onFallback={() => setUseLeaflet(true)}
        />
      )}

      <div className="hero-map__hud">
        <div className="hero-map__top">
          {mode === 'pickup' ? (
            <div className="hero-map__seg" role="group" aria-label="Choose which location to pin on the map">
              <button
                type="button"
                className={`hero-map__segbtn ${pinTarget === 'pickup' ? 'is-active' : ''}`}
                aria-pressed={pinTarget === 'pickup'}
                onClick={() => onPinTargetChange('pickup')}
              >
                <span className="hero-map__dot" aria-hidden="true" />
                <span>Pin pickup</span>
              </button>
              <button
                type="button"
                className={`hero-map__segbtn hero-map__segbtn--drop ${pinTarget === 'drop' ? 'is-active' : ''}`}
                aria-pressed={pinTarget === 'drop'}
                onClick={() => onPinTargetChange('drop')}
              >
                <span className="hero-map__dot hero-map__dot--drop" aria-hidden="true" />
                <span>Pin drop</span>
              </button>
            </div>
          ) : (
            <div className="hero-map__pill">
              <span className="hero-map__dot" aria-hidden="true" />
              <span>Click map or drag pin to pick location</span>
            </div>
          )}

          {resolving ? (
            <span className="hero-map__status" role="status">
              Finding address…
            </span>
          ) : farApart ? (
            <span className="hero-map__status hero-map__status--warn" role="alert">
              Pickup &amp; Drop must be within {CITY_LIMIT_KM} km
            </span>
          ) : null}
        </div>

        <div className="hero-map__foot">
          <button
            type="button"
            className={`hero-map__locate ${locating ? 'is-busy' : ''}`}
            onClick={() => void useMyLocation()}
            disabled={locating}
            aria-label="Use my current location"
            title="Pin my current location"
          >
            <Icon name="navigation" size={16} />
            <span>{locating ? 'Locating…' : 'Use GPS'}</span>
          </button>

          <div className="hero-map__cities" role="group" aria-label="Jump to city">
            {QUICK_CITIES.map((city) => {
              const active = (pinTarget === 'drop' ? drop?.id : pickup?.id) === city.id;
              return (
                <button
                  key={city.id}
                  type="button"
                  className={`hero-map__chip ${active ? 'is-on' : ''}`}
                  onClick={() => pickQuickCity(city)}
                >
                  {city.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
export default HeroRentalMap;
