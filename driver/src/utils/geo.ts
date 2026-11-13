export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371; // km

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Road distance is typically ~1.3× the straight line in Indian cities. */
export const ROAD_FACTOR = 1.3;

export function isValidLatLng(p: Partial<LatLng> | null | undefined): p is LatLng {
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

export function googleMapsLink(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/** A place as a trip stores it: an address and, when known, its coordinates. */
interface Place {
  address: string;
  lat?: number;
  lng?: number;
}

/** Google Maps directions to one place (by coordinates when known, otherwise by address). */
export function mapsDirections(loc: Place): string {
  return loc.lat != null && loc.lng != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(loc.address)}&travelmode=driving`;
}

/** Google Maps directions to the final drop that pass through each tour city in order (Multicity). */
export function mapsTour(trip: { drop: Place; viaPlaces?: Place[] }): string {
  const via = trip.viaPlaces ?? [];
  const located = via.filter((p) => p.lat != null && p.lng != null);
  // A stop without coordinates cannot be a reliable waypoint; fall back to the plain drop route.
  if (!located.length || located.length !== via.length) return mapsDirections(trip.drop);
  const point = (p: Place) => `${p.lat},${p.lng}`;
  const dest = trip.drop.lat != null && trip.drop.lng != null ? point(trip.drop) : encodeURIComponent(trip.drop.address);
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&waypoints=${encodeURIComponent(located.map(point).join('|'))}&travelmode=driving`;
}
