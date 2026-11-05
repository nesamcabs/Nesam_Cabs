// One consistent illustration set for ride categories. The categories themselves
// (names, seats, fares) always come from the admin-managed vehicle_categories.
import type { RideCategory } from '@core/types';

export type VehicleArt = 'hatchback' | 'sedan' | 'premium-sedan' | 'suv' | 'mpv' | 'passenger-van' | 'minibus' | 'tourist-coach';

export function vehicleArtFor(c: Pick<RideCategory, 'name' | 'seats'>): VehicleArt {
  const n = c.name.toLowerCase();
  const has = (...words: string[]) => words.some((w) => n.includes(w));
  if (has('coach') || c.seats >= 26) return 'tourist-coach';
  if (has('minibus', 'mini bus', 'mini-bus') || c.seats >= 19) return 'minibus';
  if (has('tempo', 'traveller', 'traveler', 'van', 'urbania') || c.seats >= 9) return 'passenger-van';
  if (has('premium sedan', 'luxury', 'executive')) return 'premium-sedan';
  if (has('premium suv', 'innova', 'crysta', 'muv', 'mpv', 'ertiga', 'xl6', 'carens')) return 'mpv';
  if (has('suv', 'xuv', 'scorpio', 'fortuner', 'hycross')) return 'suv';
  if (has('sedan', 'dzire', 'etios', 'aura', 'verna')) return 'sedan';
  if (has('mini', 'hatch', 'micro', 'swift', 'wagon', 'alto')) return 'hatchback';
  if (c.seats >= 7) return 'mpv';
  if (c.seats >= 6) return 'suv';
  return 'sedan';
}

export const vehicleArtUrl = (c: Pick<RideCategory, 'name' | 'seats'>) => `/vehicles/${vehicleArtFor(c)}.webp`;
