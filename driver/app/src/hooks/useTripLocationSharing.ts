import { useEffect, useRef, useState } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { TripDetails } from '../types/driver';
import { watchPosition } from '../services/locationService';
import { updateDriverLocation } from '../services/driverService';
import { haversineKm } from '../utils/geo';
import { LOCATION_SHARE_INTERVAL_MS, LOCATION_SHARE_MIN_MOVE_KM } from '../config/constants';

const KEEP_AWAKE_TAG = 'nesam-trip';
/** Before Reached Pickup, the position is shared only from this long before the booked pickup. */
const SHARE_BEFORE_PICKUP_MS = 2 * 60 * 60 * 1000;

/** Whether the driver's position should be shown to the customer now. */
export function shouldShareLocation(trip: Pick<TripDetails, 'status' | 'subStatus' | 'pickupAt'> | null, now = Date.now()): boolean {
  if (!trip || !['Assigned', 'Confirmed', 'Ongoing'].includes(trip.status)) return false;
  if (trip.subStatus === 'Reached Pickup' || trip.subStatus === 'Trip Started') return true;
  if (trip.subStatus !== 'Not Started') return false;
  // Driving to the pickup: an instant ride, or a scheduled one that is close.
  return !trip.pickupAt || trip.pickupAt.getTime() - now <= SHARE_BEFORE_PICKUP_MS;
}

/**
 * While the driver is on the way to the pickup, at the pickup and on the trip,
 * their position is written to bookings/{id}.driverLocation — throttled to one
 * write per LOCATION_SHARE_INTERVAL_MS or per LOCATION_SHARE_MIN_MOVE_KM — and
 * the screen is kept awake. Runs while the app is in the foreground.
 */
export function useTripLocationSharing(trip: TripDetails | null): void {
  const bookingId = trip?.id ?? null;
  // Re-evaluated every minute so a scheduled pickup starts sharing on time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  const sharing = shouldShareLocation(trip, now);
  const last = useRef<{ at: number; lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!sharing || !bookingId) return undefined;
    last.current = null;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    const stop = watchPosition(
      (p) => {
        const prev = last.current;
        const now = Date.now();
        const moved = prev ? haversineKm(prev, p) : Infinity;
        if (prev && now - prev.at < LOCATION_SHARE_INTERVAL_MS && moved < LOCATION_SHARE_MIN_MOVE_KM) return;
        last.current = { at: now, lat: p.lat, lng: p.lng };
        // Best effort: a dropped update is replaced by the next one.
        updateDriverLocation(bookingId, { lat: p.lat, lng: p.lng, heading: p.heading }).catch(() => {
          last.current = prev;
        });
      },
      () => undefined,
    );
    return () => {
      stop();
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [sharing, bookingId]);
}
