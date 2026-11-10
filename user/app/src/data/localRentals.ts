// Shared constants for the Local Rentals screen (Pickup & Drop inside one city, and Hourly Rental).
import type { GeoPlace } from '../types';

/** Hourly rental packages a rider can ask for (the server prices each car for the chosen hours). */
export const RENTAL_PACKAGE_HOURS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Pickup & Drop is for one city; the server treats anything longer than this (by road) as outstation. */
export const CITY_LIMIT_KM = 40;

const city = (id: string, name: string, address: string, lat: number, lng: number): GeoPlace => ({ id, name, address, lat, lng, type: 'other' });

/** Cities shown as one-tap shortcuts while placing the pickup pin. */
export const QUICK_CITIES: GeoPlace[] = [
  city('city-chennai', 'Chennai', 'Chennai, Tamil Nadu', 13.0827, 80.2707),
  city('city-pondicherry', 'Pondicherry', 'Puducherry', 11.9416, 79.8083),
  city('city-bangalore', 'Bangalore', 'Bengaluru, Karnataka', 12.9716, 77.5946),
  city('city-coimbatore', 'Coimbatore', 'Coimbatore, Tamil Nadu', 11.0168, 76.9558),
  city('city-ooty', 'Ooty', 'Udhagamandalam, Tamil Nadu', 11.4102, 76.695),
  city('city-madurai', 'Madurai', 'Madurai, Tamil Nadu', 9.9252, 78.1198),
  city('city-trichy', 'Trichy', 'Tiruchirappalli, Tamil Nadu', 10.7905, 78.7047),
  city('city-salem', 'Salem', 'Salem, Tamil Nadu', 11.6643, 78.146),
  city('city-tirupati', 'Tirupati', 'Tirupati, Andhra Pradesh', 13.6288, 79.4192),
];

/** Where the map starts when nothing is known yet: the whole of Tamil Nadu. */
export const STATE_VIEW = { lat: 11.1, lng: 78.4, latDelta: 7.5, lngDelta: 7.5 } as const;

/** A coordinate pair dropped on the map, used when no address could be read in time. */
export const pinPlace = (ll: { lat: number; lng: number }): GeoPlace => ({
  id: 'pin',
  name: 'Pinned location',
  address: `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`,
  lat: ll.lat,
  lng: ll.lng,
  type: 'other',
});
