// Browser stand-in for the part of expo-location that ../app/src/services/geoService.ts
// uses, built on navigator.geolocation. Aliased in vite.config.ts and tsconfig.json.

export enum PermissionStatus {
  UNDETERMINED = 'undetermined',
  GRANTED = 'granted',
  DENIED = 'denied',
}

export enum Accuracy {
  Lowest = 1,
  Low = 2,
  Balanced = 3,
  High = 4,
  Highest = 5,
  BestForNavigation = 6,
}

export interface LocationObject {
  coords: { latitude: number; longitude: number; accuracy: number | null; heading: number | null; speed: number | null };
  timestamp: number;
}

export interface LocationSubscription {
  remove: () => void;
}

interface PermissionResponse {
  status: PermissionStatus;
  granted: boolean;
  canAskAgain: boolean;
}

let last: LocationObject | null = null;

function toObject(p: GeolocationPosition): LocationObject {
  const o: LocationObject = {
    coords: {
      latitude: p.coords.latitude,
      longitude: p.coords.longitude,
      accuracy: p.coords.accuracy ?? null,
      heading: p.coords.heading ?? null,
      speed: p.coords.speed ?? null,
    },
    timestamp: p.timestamp,
  };
  last = o;
  return o;
}

const supported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator;

function once(options: PositionOptions): Promise<LocationObject> {
  return new Promise((resolve, reject) => {
    if (!supported()) return reject(new Error('Geolocation is not available.'));
    navigator.geolocation.getCurrentPosition((p) => resolve(toObject(p)), reject, options);
  });
}

export async function getForegroundPermissionsAsync(): Promise<PermissionResponse> {
  if (!supported()) return { status: PermissionStatus.DENIED, granted: false, canAskAgain: false };
  try {
    const state = (await navigator.permissions.query({ name: 'geolocation' as PermissionName })).state;
    if (state === 'granted') return { status: PermissionStatus.GRANTED, granted: true, canAskAgain: true };
    if (state === 'denied') return { status: PermissionStatus.DENIED, granted: false, canAskAgain: false };
  } catch {
    /* Permissions API unavailable (older Safari): fall through to "not asked yet". */
  }
  return { status: PermissionStatus.UNDETERMINED, granted: false, canAskAgain: true };
}

export async function requestForegroundPermissionsAsync(): Promise<PermissionResponse> {
  try {
    // The browser shows its own prompt on the first position request.
    await once({ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 });
    return { status: PermissionStatus.GRANTED, granted: true, canAskAgain: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return { status: PermissionStatus.DENIED, granted: false, canAskAgain: false };
    // Position unavailable / timed out: permission itself may well be granted.
    return getForegroundPermissionsAsync();
  }
}

export async function hasServicesEnabledAsync(): Promise<boolean> {
  return supported();
}

export function getCurrentPositionAsync(options?: { accuracy?: Accuracy }): Promise<LocationObject> {
  return once({ enableHighAccuracy: (options?.accuracy ?? Accuracy.Balanced) >= Accuracy.High, timeout: 20000, maximumAge: 15000 });
}

export async function getLastKnownPositionAsync(options?: { maxAge?: number }): Promise<LocationObject | null> {
  if (!last) return null;
  return Date.now() - last.timestamp <= (options?.maxAge ?? Infinity) ? last : null;
}

export async function watchPositionAsync(
  options: { accuracy?: Accuracy; timeInterval?: number; distanceInterval?: number },
  callback: (location: LocationObject) => void,
  onError?: (reason: string) => void,
): Promise<LocationSubscription> {
  if (!supported()) {
    onError?.('Geolocation is not available.');
    return { remove: () => undefined };
  }
  const id = navigator.geolocation.watchPosition((p) => callback(toObject(p)), (e) => onError?.(e.message), {
    enableHighAccuracy: (options.accuracy ?? Accuracy.Balanced) >= Accuracy.High,
    maximumAge: 5000,
    timeout: 30000,
  });
  return { remove: () => navigator.geolocation.clearWatch(id) };
}
