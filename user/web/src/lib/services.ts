// The four booking services shown in the navigation, and how they map onto the trip types the
// booking server supports. Multicity is shown (it is part of the service line-up) but the booking
// server has no multi-stop trip type, so it is booked by phone and never submitted online.
import type { TripType } from '@core/types';

export type ServiceId = 'airport' | 'multicity' | 'outstation' | 'rental';

export const SERVICES: { id: ServiceId; label: string; icon: string }[] = [
  { id: 'airport', label: 'Airport', icon: 'travel-airport' },
  { id: 'multicity', label: 'Multicity', icon: 'travel-multicity' },
  { id: 'outstation', label: 'Outstation', icon: 'travel-outstation' },
  { id: 'rental', label: 'Local Rental', icon: 'travel-rental' },
];

export const SERVICE_TITLE: Record<ServiceId, string> = {
  airport: 'Airport Transfer',
  multicity: 'Multicity',
  outstation: 'Outstation',
  rental: 'Local Rental',
};

/** True when the booking server can price and accept this service online. */
export const isOnlineService = (s: ServiceId) => s !== 'multicity';

export function serviceOfTrip(t: TripType): ServiceId {
  if (t === 'Airport Taxi') return 'airport';
  if (t === 'Local Rental') return 'rental';
  return 'outstation';
}

export function parseService(v: string | null): ServiceId | null {
  return v === 'airport' || v === 'multicity' || v === 'outstation' || v === 'rental' ? v : null;
}

/** The customer-facing name of a trip type. */
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

export const serviceHref = (s: ServiceId, trip?: 'one-way' | 'round-trip') => `/book?service=${s}${trip ? `&trip=${trip}` : ''}`;
