// Service taxonomy for NESAM Cabs: Outstation, Airport Taxi, Local Rental, Multicity, Local Taxi.
import type { TripType } from '@core/types';

export type ServiceId = 'outstation' | 'airport' | 'rental' | 'multicity' | 'local';

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
    label: 'Rental',
    tagline: 'Hourly city disposal packages with driver',
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
] as const;

export const SERVICE_TITLE: Record<ServiceId, string> = {
  outstation: 'Outstation Cabs',
  airport: 'Airport Taxi',
  rental: 'Local City Rental',
  multicity: 'Multicity Tour & Itinerary',
  local: 'Local Taxi',
};

export const parseService = (raw: string | null): ServiceId | null => {
  if (raw === 'outstation' || raw === 'airport' || raw === 'rental' || raw === 'multicity' || raw === 'local') return raw;
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
      return 'Local Rental';
    default:
      return 'One Way';
  }
}

export const serviceHref = (s: ServiceId) => `/book?service=${s}`;
