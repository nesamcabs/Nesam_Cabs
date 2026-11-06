// Service taxonomy for NESAM Cabs: Outstation, Airport Taxi, Local Rental, Multicity, Local Taxi.
import type { TripType } from '@core/types';

export type ServiceId = 'outstation' | 'airport' | 'rental' | 'multicity' | 'local' | 'pickup';

export interface ServiceMeta {
  id: ServiceId;
  label: string;
  tagline: string;
  tripType: TripType | null;
  online: boolean;
  icon: string;
}

export const SERVICES: readonly ServiceMeta[] = [
  {
    id: 'outstation',
    label: 'Outstation',
    tagline: 'One-way drops & round trips at fixed rates',
    tripType: 'One Way',
    online: true,
    icon: 'outstation',
  },
  {
    id: 'airport',
    label: 'Airport Taxi',
    tagline: 'Pickup & drop at all South India airports',
    tripType: 'Airport Taxi',
    online: true,
    icon: 'jet',
  },
  {
    id: 'rental',
    label: 'Hourly Rental',
    tagline: 'Pick a city and hours, with a driver at your disposal',
    tripType: 'Local Rental',
    online: true,
    icon: 'car-clock',
  },
  {
    id: 'multicity',
    label: 'Multicity',
    tagline: 'Custom multi-stop itineraries & tour packages',
    tripType: null,
    online: true,
    icon: 'multicity-route',
  },
  {
    // Pickup and drop inside one city: the server prices it from that city's Local Pickup & Drop fare.
    id: 'local',
    label: 'Local Taxi',
    tagline: 'City pickup & drop within your city',
    tripType: 'One Way',
    online: true,
    icon: 'taxi-route',
  },
  {
    // Scheduled pickup and drop inside one city: a normal booking (date, time, vehicles, fares), priced from that city's
    // Local Pickup & Drop fare. Together with the hourly rental it is the "Local Rentals" button of the booking form.
    id: 'pickup',
    label: 'Pickup & Drop',
    tagline: 'Book a city pickup and drop for a date and time',
    tripType: 'One Way',
    online: true,
    icon: 'taxi-route',
  },
] as const;

export const SERVICE_TITLE: Record<ServiceId, string> = {
  outstation: 'Outstation Cabs',
  airport: 'Airport Taxi',
  rental: 'Hourly Rental',
  multicity: 'Multicity Tour & Itinerary',
  local: 'Local Taxi',
  pickup: 'Pickup & Drop',
};

export const parseService = (raw: string | null): ServiceId | null => {
  if (raw === 'outstation' || raw === 'airport' || raw === 'rental' || raw === 'multicity' || raw === 'local' || raw === 'pickup') return raw;
  if (raw === 'local-rentals' || raw === 'hourly-rental') return 'rental';
  if (raw === 'pickup-drop') return 'pickup';
  if (raw === 'one-way' || raw === 'round-trip') return 'outstation';
  return null;
};

export const serviceOfTrip = (t: TripType | null | undefined): ServiceId => {
  if (t === 'Airport Taxi') return 'airport';
  if (t === 'Local Rental') return 'rental';
  return 'outstation';
};

export function tripTypeLabel(t: TripType | string): string {
  switch (t) {
    case 'Round Trip':
      return 'Round Trip';
    case 'Multicity':
      return 'Multicity';
    case 'Airport Taxi':
      return 'Airport';
    case 'Local Rental':
      return 'Hourly Rental';
    default:
      return 'One Way';
  }
}

/** Local Rentals open as a full-screen map; every other service opens the booking form. */
export const serviceHref = (s: ServiceId) => (s === 'rental' ? '/local-rentals?mode=hourly' : s === 'pickup' ? '/local-rentals?mode=pickup' : `/book?service=${s}`);

/** The booking form's "Local Rentals" button covers both the hourly rental and the scheduled pickup & drop. */
export const LOCAL_RENTALS_LABEL = 'Local Rentals';
export const isLocalRentals = (s: ServiceId) => s === 'rental' || s === 'pickup';
