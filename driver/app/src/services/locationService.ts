// Device location for the driver (expo-location): pickup-radius check and
// live position sharing during a trip. Same permission / GPS handling as the
// Customer app's geoService.
import * as Location from 'expo-location';
import type { LatLng } from '../utils/geo';

// ── Device location ─────────────────────────────────────────────────────────

export type LocationErrorKind = 'denied' | 'blocked' | 'disabled' | 'unavailable' | 'timeout';

export class LocationError extends Error {
  constructor(public kind: LocationErrorKind, message: string) {
    super(message);
  }
}

export const LOCATION_ERROR_TEXT: Record<LocationErrorKind, string> = {
  denied: 'Location permission was not granted. NESAM Driver needs it to confirm pickup arrival and share your position with the customer.',
  blocked: 'Location access is turned off for NESAM Driver. Enable it in Settings › Apps › NESAM Driver › Permissions.',
  disabled: 'Your phone’s location (GPS) is switched off. Turn it on to continue the trip.',
  unavailable: 'We couldn’t get a GPS fix. Move to an open area and try again.',
  timeout: 'Getting your location is taking too long. Please try again.',
};

export interface DevicePosition extends LatLng {
  accuracy: number;
  heading: number | null;
  speed: number | null;
}

export type PermissionStateLite = 'granted' | 'denied' | 'blocked' | 'prompt';

export async function getLocationPermission(): Promise<PermissionStateLite> {
  const p = await Location.getForegroundPermissionsAsync();
  if (p.granted) return 'granted';
  if (p.status === Location.PermissionStatus.UNDETERMINED) return 'prompt';
  return p.canAskAgain ? 'denied' : 'blocked';
}

/** Asks for foreground location permission if needed; never throws. */
export async function ensureLocationPermission(): Promise<PermissionStateLite> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.granted) return 'granted';
    if (!current.canAskAgain) return 'blocked';
    const next = await Location.requestForegroundPermissionsAsync();
    if (next.granted) return 'granted';
    return next.canAskAgain ? 'denied' : 'blocked';
  } catch {
    return 'denied';
  }
}

function toPosition(pos: Location.LocationObject): DevicePosition {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? 0,
    heading: pos.coords.heading != null && pos.coords.heading >= 0 ? pos.coords.heading : null,
    speed: pos.coords.speed ?? null,
  };
}

async function assertReady(): Promise<void> {
  const perm = await ensureLocationPermission();
  if (perm === 'blocked') throw new LocationError('blocked', LOCATION_ERROR_TEXT.blocked);
  if (perm !== 'granted') throw new LocationError('denied', LOCATION_ERROR_TEXT.denied);
  const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!enabled) throw new LocationError('disabled', LOCATION_ERROR_TEXT.disabled);
}

export async function getCurrentPosition(timeoutMs = 15000): Promise<DevicePosition> {
  await assertReady();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LocationError('timeout', LOCATION_ERROR_TEXT.timeout)), timeoutMs);
      }),
    ]);
    return toPosition(pos);
  } catch (err) {
    if (err instanceof LocationError) {
      // A recent cached fix is better than nothing when GPS is slow.
      if (err.kind === 'timeout') {
        const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
        if (last) return toPosition(last);
      }
      throw err;
    }
    throw new LocationError('unavailable', LOCATION_ERROR_TEXT.unavailable);
  } finally {
    clearTimeout(timer);
  }
}

/** Live position while subscribed. Returns an unsubscribe function. */
export function watchPosition(onPosition: (p: DevicePosition) => void, onError: (e: LocationError) => void): () => void {
  let sub: Location.LocationSubscription | null = null;
  let cancelled = false;
  assertReady()
    .then(() =>
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (pos) => onPosition(toPosition(pos)),
        () => onError(new LocationError('unavailable', LOCATION_ERROR_TEXT.unavailable)),
      ),
    )
    .then((s) => {
      if (cancelled) s.remove();
      else sub = s;
    })
    .catch((e: unknown) => {
      if (!cancelled) onError(e instanceof LocationError ? e : new LocationError('unavailable', LOCATION_ERROR_TEXT.unavailable));
    });
  return () => {
    cancelled = true;
    sub?.remove();
  };
}

