// Device location (expo-location), place search (Photon), reverse geocoding
// and routing (OSRM). Copied from user/web/src/services/geoService.ts; the
// browser Geolocation API is replaced by expo-location, the HTTP / cache /
// fallback logic is unchanged. Every network call has a timeout, honours an
// AbortSignal, is cached, and degrades gracefully: routing falls back to a
// straight-line estimate so fares can still be quoted when OSRM is down.

import * as Location from 'expo-location';
import { GEOCODER_URL, ROUTING_URL, INDIA_BBOX, AVG_CITY_SPEED_KMPH } from '../config/constants';
import { GeoPlace, LatLng, PlaceType, RouteInfo } from '../types';
import { haversineKm, ROAD_FACTOR, isValidLatLng } from '../utils/geo';
import { TimeoutError } from '../utils/retry';
import { matchMainCities } from './mainCities';
import { callBackend } from './backend';

// ── Device location ─────────────────────────────────────────────────────────

export type LocationErrorKind = 'denied' | 'blocked' | 'disabled' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  constructor(public kind: LocationErrorKind, message: string) {
    super(message);
  }
}

export const LOCATION_ERROR_TEXT: Record<LocationErrorKind, string> = {
  denied: 'Location permission was not granted. Allow it to set your pickup automatically, or search for your pickup.',
  blocked: 'Location access is turned off for NESAM. Enable it in Settings › Apps › NESAM › Permissions, or search for your pickup.',
  disabled: 'Your phone’s location (GPS) is switched off. Turn it on, or search for your pickup.',
  unavailable: 'We couldn’t get a GPS fix. Move to an open area or search for your pickup.',
  timeout: 'Getting your location is taking too long. Try again or search for your pickup.',
};

export interface DevicePosition extends LatLng {
  accuracy: number;
  heading: number | null;
  speed: number | null;
}

export type PermissionStateLite = 'granted' | 'denied' | 'blocked' | 'prompt';

export async function getLocationPermission(): Promise<PermissionStateLite> {
  const p = await Location.getForegroundPermissionsAsync();
  if (p.granted) return 'granted';
  if (p.status === Location.PermissionStatus.UNDETERMINED) return 'prompt';
  return p.canAskAgain ? 'denied' : 'blocked';
}

/** Asks for foreground location permission if needed; never throws. */
export async function ensureLocationPermission(): Promise<PermissionStateLite> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'blocked';
    const next = await Location.requestForegroundPermissionsAsync();
    if (next.granted) return 'granted';
    return next.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'denied';
  }
}

function toPosition(pos: Location.LocationObject): DevicePosition {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? 0,
    heading: pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : null,
    speed: pos.coords.speed ?? null,
  };
}

async function assertReady(): Promise<void> {
  const perm = await ensureLocationPermission();
  if (perm === 'blocked') throw new LocationError('blocked', LOCATION_ERROR_TEXT.blocked);
  if (perm !== 'granted') throw new LocationError('denied', LOCATION_ERROR_TEXT.denied);
  const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!enabled) throw new LocationError('disabled', LOCATION_ERROR_TEXT.disabled);
}

export async function getCurrentPosition(timeoutMs = 15000): Promise<DevicePosition> {
  await assertReady();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LocationError('timeout', LOCATION_ERROR_TEXT.timeout)), timeoutMs);
      }),
    ]);
    return toPosition(pos);
  } catch (err) {
    if (err instanceof LocationError) {
      // A recent cached fix is better than nothing when GPS is slow.
      if (err.kind === 'timeout') {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
        if (last) return toPosition(last);
      }
      throw err;
    }
    throw new LocationError('unavailable', LOCATION_ERROR_TEXT.unavailable);
  } finally {
    clearTimeout(timer);
  }
}

/** Live position while subscribed. Returns an unsubscribe function. */
export function watchPosition(onPosition: (p: DevicePosition) => void, onError: (e: LocationError) => void): () => void {
  let sub: Location.LocationSubscription | null = null;
  let cancelled = false;
  assertReady()
    .then(() =>
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (pos) => onPosition(toPosition(pos)),
        () => onError(new LocationError('unavailable', LOCATION_ERROR_TEXT.unavailable)),
      ),
    )
    .then((s) => {
      if (cancelled) s.remove();
      else sub = s;
    })
    .catch((e: unknown) => {
      if (!cancelled) onError(e instanceof LocationError ? e : new LocationError('unavailable', LOCATION_ERROR_TEXT.unavailable));
    });
  return () => {
    cancelled = true;
    sub?.remove();
  };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, signal?: AbortSignal, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError()), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status >= 500 ? 'unavailable' : 'http' });
    return (await res.json()) as T;
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) throw new TimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
}

// ── Place search / reverse geocoding (Photon) ───────────────────────────────

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
  };
}

function featureToPlace(f: PhotonFeature): GeoPlace | null {
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (!isValidLatLng({ lat, lng })) return null;
  const p = f.properties ?? {};
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street || p.locality || p.district || p.city || 'Pinned location';
  const parts = [
    p.name && street ? street : '',
    p.locality,
    p.district,
    p.city,
    p.state,
    p.postcode,
  ].filter((x, i, arr): x is string => !!x && x !== name && arr.indexOf(x) === i);
  const type: PlaceType = isAirportPlace(name, p.osm_key, p.osm_value) ? 'airport' : 'other';
  return {
    id: `osm-${p.osm_type ?? 'x'}${p.osm_id ?? `${lat.toFixed(5)},${lng.toFixed(5)}`}`,
    name,
    address: parts.join(', ') || name,
    type,
    lat,
    lng,
  };
}

const searchCache = new LruCache<GeoPlace[]>(60);

/** A city or town (not a street, ward, boundary or building). */
const isSettlement = (f: PhotonFeature) => f.properties?.osm_key === 'place' && (f.properties.osm_value === 'city' || f.properties.osm_value === 'town');
/** The geocoder's own entry for a city already listed from the main-city list. */
const nearCity = (c: GeoPlace, f: PhotonFeature) => {
  const [lng, lat] = f.geometry?.coordinates ?? [];
  return isValidLatLng({ lat, lng }) && haversineKm(c, { lat, lng }) < 10;
};

/**
 * An airport, not just something named after one: OpenStreetMap's aerodrome tag, or
 * an "airport" name that is not a road, street or neighbourhood ("Airport Road").
 */
export function isAirportPlace(name: string, osmKey?: string, osmValue?: string): boolean {
  if (osmValue === 'aerodrome' || osmValue === 'terminal') return true;
  if (osmKey === 'highway' || osmKey === 'place') return false;
  return /\bairport\b/i.test(name) && !/\b(road|rd|street|st|salai|nagar|colony|layout|junction|bus stop)\b/i.test(name);
}

export async function searchPlaces(query: string, near?: LatLng | null, signal?: AbortSignal): Promise<GeoPlace[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const bias = near ? `&lat=${near.lat.toFixed(3)}&lon=${near.lng.toFixed(3)}` : '';
  const key = `${q.toLowerCase()}|${bias}`;
  const cached = searchCache.get(key);
  if (cached) return cached;
  try {
    const result = await callBackend<{ query: string; near?: LatLng }, { places: GeoPlace[] }>('searchGooglePlaces', { query: q, ...(near ? { near } : {}) }, 15000);
    if (signal?.aborted) throw signal.reason;
    if (Array.isArray(result.places) && result.places.length) {
      const cities = matchMainCities(q);
      const seen = new Set(cities.map((p) => `${p.name}|${p.address}`));
      const places = [...cities, ...result.places.filter((p) => isValidLatLng(p) && !seen.has(`${p.name}|${p.address}`))];
      searchCache.set(key, places);
      return places;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    if (__DEV__) console.info('[geo] Google place search unavailable; using Photon fallback');
  }
  const url = `${GEOCODER_URL}/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&bbox=${INDIA_BBOX}${bias}`;
  const data = await fetchJson<{ features?: PhotonFeature[] }>(url, signal);
  // A city the rider named comes first ("trichy" → Trichy, not its wards and zones), then the
  // geocoder's cities and towns, then everything else; the geocoder's order is kept within each group.
  const cities = matchMainCities(q);
  const features = data.features ?? [];
  const ordered = [...features.filter(isSettlement), ...features.filter((f) => !isSettlement(f))];
  const seen = new Set<string>(cities.map((c) => `${c.name}|${c.address}`));
  const found = ordered
    .filter((f) => !(isSettlement(f) && cities.some((c) => nearCity(c, f))))
    .map(featureToPlace)
    .filter((p): p is GeoPlace => {
      if (!p) return false;
      const k = `${p.name}|${p.address}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const results = [...cities, ...found];
  searchCache.set(key, results);
  return results;
}

const reverseCache = new LruCache<GeoPlace>(60);

/** Never throws: falls back to a coordinate label if the geocoder is down. */
export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<GeoPlace> {
  const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  const cached = reverseCache.get(key);
  if (cached) return { ...cached, lat: p.lat, lng: p.lng };
  const fallback: GeoPlace = {
    id: `pin-${key}`,
    name: 'Pinned location',
    address: `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`,
    type: 'other',
    lat: p.lat,
    lng: p.lng,
  };
  try {
    try {
      const result = await callBackend<LatLng, { place: GeoPlace }>('reverseGoogleGeocode', p, 15000);
      if (signal?.aborted) throw signal.reason;
      if (result.place && isValidLatLng(result.place)) {
        const googlePlace = { ...result.place, id: `pin-${key}`, lat: p.lat, lng: p.lng };
        reverseCache.set(key, googlePlace);
        return googlePlace;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (__DEV__) console.info('[geo] Google reverse geocoding unavailable; using Photon fallback');
    }
    const data = await fetchJson<{ features?: PhotonFeature[] }>(
      `${GEOCODER_URL}/reverse?lat=${p.lat}&lon=${p.lng}&lang=en&limit=1`,
      signal,
      6000,
    );
    const f = data.features?.[0];
    const place = f ? featureToPlace(f) : null;
    if (!place) return fallback;
    // Keep the exact pin position; the geocoder snaps to the nearest feature.
    const result = { ...place, id: `pin-${key}`, lat: p.lat, lng: p.lng };
    reverseCache.set(key, result);
    return result;
  } catch (err) {
    if (signal?.aborted) throw err;
    return fallback;
  }
}

// ── Routing (OSRM) ──────────────────────────────────────────────────────────

const routeCache = new LruCache<RouteInfo>(40);

export function estimateRoute(from: LatLng, to: LatLng): RouteInfo {
  const distanceKm = haversineKm(from, to) * ROAD_FACTOR;
  return {
    distanceKm,
    durationMin: (distanceKm / AVG_CITY_SPEED_KMPH) * 60,
    path: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    estimated: true,
  };
}

/** Never throws (except on abort): falls back to `estimateRoute`. */
export async function getRoute(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<RouteInfo> {
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  try {
    try {
      const result = await callBackend<{ origin: LatLng; destination: LatLng }, { route: RouteInfo }>('getGoogleRoute', { origin: from, destination: to }, 20000);
      if (signal?.aborted) throw signal.reason;
      if (result.route && Number.isFinite(result.route.distanceKm) && result.route.distanceKm > 0) {
        routeCache.set(key, result.route);
        return result.route;
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      if (__DEV__) console.info('[geo] Google routing unavailable; using OSRM fallback');
    }
    const url =
      `${ROUTING_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson&alternatives=false&steps=false`;
    const data = await fetchJson<{
      code: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    }>(url, signal, 10000);
    const r = data.code === 'Ok' ? data.routes?.[0] : undefined;
    if (!r) throw new Error(`OSRM: ${data.code}`);
    const info: RouteInfo = {
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      path: r.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
      estimated: false,
    };
    routeCache.set(key, info);
    return info;
  } catch (err) {
    if (signal?.aborted) throw err;
    if (__DEV__) console.warn('[geo] routing unavailable, using straight-line estimate');
    return estimateRoute(from, to);
  }
}
