// Secure Google Maps Platform proxy for all customer apps. The server key never reaches a browser.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { PUBLIC_CALLABLE_ORIGINS } from './corsOrigins';
import { rateLimited } from './http/util';
import { requestIp } from './security';
import { inIndia, text } from './shared';

type Point = { lat: number; lng: number };

const key = () => (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim();
const point = (value: any, label: string): Point => {
  const lat = Number(value?.lat), lng = Number(value?.lng);
  if (!inIndia(lat, lng)) throw new HttpsError('invalid-argument', `Choose a valid ${label} location in India.`);
  return { lat, lng };
};
const guarded = (request: any, bucket: string, max = 60) => {
  if (!key()) throw new HttpsError('failed-precondition', 'Google Maps is not configured on the server.');
  if (rateLimited(`google:${bucket}:${request.auth?.uid || requestIp(request) || 'unknown'}`, max, 60_000)) {
    throw new HttpsError('resource-exhausted', 'Too many map requests. Please wait a moment.');
  }
};
const googleFetch = async (url: string, init: RequestInit) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      console.warn('[googleMaps] provider error', { status: response.status, endpoint: new URL(url).pathname });
      throw new HttpsError(response.status === 429 ? 'resource-exhausted' : 'unavailable', 'Google Maps is temporarily unavailable.');
    }
    return await response.json() as any;
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.warn('[googleMaps] request failed', error instanceof Error ? error.message : error);
    throw new HttpsError('unavailable', 'Google Maps is temporarily unavailable.');
  } finally {
    clearTimeout(timer);
  }
};

const placeType = (types: unknown): 'airport' | 'other' => Array.isArray(types) && types.some((v) => ['airport', 'international_airport'].includes(String(v))) ? 'airport' : 'other';

export const searchGooglePlaces = onCall({ timeoutSeconds: 30, cors: PUBLIC_CALLABLE_ORIGINS }, async (request) => {
  guarded(request, 'search', 45);
  const query = text((request.data as any)?.query, 120);
  if (query.length < 3) return { places: [] };
  const nearRaw = (request.data as any)?.near;
  const near = nearRaw && inIndia(Number(nearRaw.lat), Number(nearRaw.lng)) ? { lat: Number(nearRaw.lat), lng: Number(nearRaw.lng) } : null;
  const body: any = { textQuery: query, regionCode: 'IN', languageCode: 'en', maxResultCount: 8 };
  if (near) body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 50000 } };
  const data = await googleFetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types' },
    body: JSON.stringify(body),
  });
  const places = (Array.isArray(data.places) ? data.places : []).flatMap((p: any) => {
    const lat = Number(p.location?.latitude), lng = Number(p.location?.longitude);
    if (!inIndia(lat, lng)) return [];
    const name = text(p.displayName?.text, 150) || text(p.formattedAddress, 150) || 'Location';
    return [{ id: `google-${text(p.id, 180)}`, name, address: text(p.formattedAddress, 300) || name, lat, lng, type: placeType(p.types) }];
  });
  return { places };
});

export const reverseGoogleGeocode = onCall({ timeoutSeconds: 30, cors: PUBLIC_CALLABLE_ORIGINS }, async (request) => {
  guarded(request, 'reverse', 60);
  const p = point(request.data, 'map');
  const params = new URLSearchParams({ latlng: `${p.lat},${p.lng}`, key: key(), language: 'en', region: 'in' });
  const data = await googleFetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { method: 'GET' });
  const hit = Array.isArray(data.results) ? data.results[0] : null;
  if (!hit) throw new HttpsError('not-found', 'No address was found for this location.');
  const first = hit.address_components?.find((c: any) => c.types?.some((t: string) => ['point_of_interest', 'premise', 'locality', 'administrative_area_level_2'].includes(t)));
  const name = text(first?.long_name, 150) || text(hit.formatted_address, 150) || 'Pinned location';
  return { place: { id: `google-${text(hit.place_id, 180) || `${p.lat},${p.lng}`}`, name, address: text(hit.formatted_address, 300) || name, lat: p.lat, lng: p.lng, type: placeType(hit.types) } };
});

function decodePolyline(encoded: string): [number, number][] {
  const path: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    path.push([lat / 1e5, lng / 1e5]);
  }
  return path;
}

export const getGoogleRoute = onCall({ timeoutSeconds: 30, cors: PUBLIC_CALLABLE_ORIGINS }, async (request) => {
  if (rateLimited(`google:route:${request.auth?.uid || requestIp(request) || 'unknown'}`, 60, 60_000)) {
    throw new HttpsError('resource-exhausted', 'Too many route requests. Please wait a moment.');
  }
  const origin = point((request.data as any)?.origin, 'origin');
  const destination = point((request.data as any)?.destination, 'destination');

  // Same-point guard.
  if (Math.abs(origin.lat - destination.lat) < 0.0001 && Math.abs(origin.lng - destination.lng) < 0.0001) {
    return { route: { distanceKm: 0, durationMin: 0, path: [[origin.lat, origin.lng]] as [number, number][], estimated: false, provider: 'same-point' } };
  }

  // ── Primary: Google Routes API ────────────────────────────────────────────
  if (key()) try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let googleData: any;
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key(),
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_UNAWARE',
          polylineQuality: 'OVERVIEW',
          languageCode: 'en-IN',
          units: 'METRIC',
        }),
        signal: controller.signal,
      });
      if (response.ok) {
        googleData = await response.json();
      } else {
        const body = await response.text().catch(() => '');
        let providerStatus = '';
        let providerMessage = '';
        try {
          const parsed = JSON.parse(body);
          providerStatus = text(parsed?.error?.status, 80);
          providerMessage = text(parsed?.error?.message, 300);
        } catch { /* Non-JSON provider response. */ }
        console.warn('[getGoogleRoute] Google Routes API error', {
          status: response.status,
          providerStatus,
          providerMessage,
        });
      }
    } finally {
      clearTimeout(timer);
    }
    const route = googleData?.routes?.[0];
    if (route && Number.isFinite(route.distanceMeters) && route.distanceMeters > 0) {
      return {
        route: {
          distanceKm: route.distanceMeters / 1000,
          durationMin: Number(String(route.duration ?? '0s').replace('s', '')) / 60,
          path: decodePolyline(String(route.polyline?.encodedPolyline ?? '')),
          estimated: false,
          provider: 'google',
        },
      };
    }
  } catch (err) {
    console.warn('[getGoogleRoute] Google Routes fetch failed', err instanceof Error ? err.message : err);
  } else {
    console.warn('[getGoogleRoute] GOOGLE_MAPS_SERVER_API_KEY is missing; using routing fallback');
  }

  // ── Fallback: OSRM (open routing engine) ─────────────────────────────────
  try {
    const base = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let osrmData: any;
    try {
      const response = await fetch(
        `${base}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`,
        { signal: controller.signal },
      );
      if (response.ok) osrmData = await response.json();
      else console.warn('[getGoogleRoute] OSRM fallback error', { status: response.status });
    } finally {
      clearTimeout(timer);
    }
    const r = osrmData?.code === 'Ok' && osrmData?.routes?.[0];
    if (r && Number.isFinite(r.distance) && r.distance > 0) {
      // OSRM returns GeoJSON [lng, lat] pairs — swap to [lat, lng] for the client.
      const coords: [number, number][] = (r.geometry?.coordinates ?? []).map(([lng, lat]: [number, number]) => [lat, lng] as [number, number]);
      return {
        route: {
          distanceKm: Math.max(0.1, r.distance / 1000),
          durationMin: Math.max(1, r.duration / 60),
          path: coords,
          estimated: false,
          provider: 'osrm',
        },
      };
    }
  } catch (err) {
    console.warn('[getGoogleRoute] OSRM fallback failed', err instanceof Error ? err.message : err);
  }

  // ── Last resort: straight-line Haversine estimate ─────────────────────────
  const R = 6371;
  const dLat = (destination.lat - origin.lat) * Math.PI / 180;
  const dLng = (destination.lng - origin.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(origin.lat * Math.PI / 180) * Math.cos(destination.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  const straightKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // Road distance ≈ 1.3× straight-line for India.
  const estimatedKm = Math.max(1, straightKm * 1.3);
  console.warn('[getGoogleRoute] Using straight-line estimate', { originLat: origin.lat, originLng: origin.lng, destLat: destination.lat, destLng: destination.lng, straightKm, estimatedKm });
  return {
    route: {
      distanceKm: estimatedKm,
      durationMin: Math.max(5, estimatedKm * 1.5),   // rough 40 km/h avg
      path: [[origin.lat, origin.lng], [destination.lat, destination.lng]] as [number, number][],
      estimated: true,
      provider: 'estimate',
    },
  };
});
