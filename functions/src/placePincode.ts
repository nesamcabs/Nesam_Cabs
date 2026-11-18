// The postal pincode of a trip place. Hill-station detection (domain/hillStations.ts) works only from the pincode, so every place a
// quote or booking prices carries one:
//   1. a pincode the customer app sent with the place (checked: six digits, India Post style, not starting with 0);
//   2. the pincode written in the place's address ("Udhagamandalam, Tamil Nadu 643001, India" — Google's formatted addresses carry it);
//   3. otherwise a reverse geocode of the map position with the server's Google key (best effort, cached, never blocks a quote
//      for long). When none of these gives a pincode the place is simply not a hill-station place — nothing is guessed.
import type { GeoPlace } from './domain/types';
import { placePincode, validPincode } from './domain/hillStations';

const key = () => (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim();
const cache = new Map<string, string>();
const CACHE_MAX = 500;
const keyOf = (p: { lat: number; lng: number }) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;

/** Google reverse geocode of a point → pincode ('' when unavailable). */
async function reversePincode(p: { lat: number; lng: number }): Promise<string> {
  const k = key();
  if (!k) return '';
  const memo = cache.get(keyOf(p));
  if (memo !== undefined) return memo;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  let pin = '';
  try {
    const params = new URLSearchParams({ latlng: `${p.lat},${p.lng}`, key: k, language: 'en', region: 'in', result_type: 'postal_code' });
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, { signal: controller.signal });
    if (response.ok) {
      const data = (await response.json()) as { results?: Array<{ address_components?: Array<{ long_name?: string; types?: string[] }> }> };
      for (const r of data.results ?? []) {
        const c = (r.address_components ?? []).find((x) => Array.isArray(x.types) && x.types.includes('postal_code'));
        const found = validPincode(c?.long_name);
        if (found) { pin = found; break; }
      }
    }
  } catch {
    return ''; // not cached: a later quote may succeed
  } finally {
    clearTimeout(timer);
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(keyOf(p), pin);
  return pin;
}

/** The place with its pincode filled in (unchanged when it cannot be told). */
export async function withPincode<T extends GeoPlace>(place: T): Promise<T> {
  const known = placePincode(place);
  if (known) return place.pincode === known ? place : { ...place, pincode: known };
  const found = await reversePincode(place);
  return found ? { ...place, pincode: found } : place;
}

/**
 * The trip's pickup, drop and stops with their pincodes filled in — only when the tariff has hill stations switched on for this
 * kind of trip, so a quote that cannot use a pincode never pays for a lookup. Places that already show a pincode cost nothing.
 */
export async function withTripPincodes<T extends GeoPlace>(i: { hillEnabled: boolean; tripType: string; multicity?: boolean; pickup: T; drop: T; stops: T[] }): Promise<{ pickup: T; drop: T; stops: T[] }> {
  const relevant = i.hillEnabled && !i.multicity && (i.tripType === 'One Way' || i.tripType === 'Round Trip');
  if (!relevant) return { pickup: i.pickup, drop: i.drop, stops: i.stops };
  const [pickup, drop, ...stops] = await Promise.all([i.pickup, i.drop, ...i.stops].map((p) => withPincode(p)));
  return { pickup: pickup as T, drop: drop as T, stops: stops as T[] };
}
