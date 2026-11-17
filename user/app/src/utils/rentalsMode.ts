// Which Local Rentals mode is showing (Pickup & Drop or Hourly Rental). The Local Rentals screen publishes it; the bottom bar reads it to
// light the right one of the two buttons beside "Local", and switches it by navigating to the Rentals tab with a `mode` param.
import { useSyncExternalStore } from 'react';

export type RentalsMode = 'pickup' | 'hourly';

let current: RentalsMode = 'pickup';
const listeners = new Set<() => void>();

export const getRentalsMode = (): RentalsMode => current;

export function setRentalsMode(next: RentalsMode): void {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export function useRentalsMode(): RentalsMode {
  return useSyncExternalStore(subscribe, getRentalsMode, getRentalsMode);
}
