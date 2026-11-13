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

/** A fix this accurate (metres) is used at once. */
const GOOD_ACCURACY_M = 60;
/** After the first fix arrives, how long to wait for a more accurate one before using the best so far. */
const SETTLE_MS = 2500;
/** A fix worse than this (metres) is probably a network / cell guess, so the GPS gets longer to improve on it. */
const COARSE_ACCURACY_M = 150;
const COARSE_SETTLE_MS = 8000;
/** The longest "find my location" ever waits. */
const HARD_TIMEOUT_MS = 14000;
/** A fix newer than this and good enough is reused instead of asking the device again. */
const FRESH_MS = 15000;

/**
 * The best position the device can give quickly. A quick network / cached fix usually arrives within a second or two but
 * can be kilometres off, while the GPS fix is accurate but slow. Both are requested together; the first fix starts a short
 * window for a better one, and the most accurate fix seen in that time wins. Waits at most HARD_TIMEOUT_MS.
 */
function bestFix(): Promise<LocationObject> {
  return new Promise((resolve, reject) => {
    if (!supported()) return reject(new Error('Geolocation is not available.'));
    let best: GeolocationPosition | null = null;
    let lastError: unknown = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    let settleDue = Infinity;
    let watchId: number | null = null;
    let done = false;
    const accuracyOf = (p: GeolocationPosition) => (p.coords.accuracy > 0 ? p.coords.accuracy : Infinity);
    const finish = (p: GeolocationPosition | null, err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(settle);
      clearTimeout(hard);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (p) resolve(toObject(p));
      else reject(err ?? Object.assign(new Error('Timed out while finding your location.'), { code: 3 }));
    };
    const onFix = (p: GeolocationPosition) => {
      if (done) return;
      if (!best || accuracyOf(p) < accuracyOf(best)) best = p;
      if (accuracyOf(best) <= GOOD_ACCURACY_M) return finish(best);
      // A coarse fix waits longer for the GPS; a better fix shortens the wait.
      const due = Date.now() + (accuracyOf(best) > COARSE_ACCURACY_M ? COARSE_SETTLE_MS : SETTLE_MS);
      if (due < settleDue) {
        clearTimeout(settle);
        settleDue = due;
        settle = setTimeout(() => finish(best), Math.max(0, due - Date.now()));
      }
    };
    const onError = (e: GeolocationPositionError) => {
      if (e.code === 1) return finish(null, e); // permission denied: nothing more to wait for
      lastError = e;
    };
    const hard = setTimeout(() => finish(best, lastError), HARD_TIMEOUT_MS);
    // Quick, possibly coarse fix (network / cached) …
    navigator.geolocation.getCurrentPosition(onFix, onError, { enableHighAccuracy: false, maximumAge: 60000, timeout: HARD_TIMEOUT_MS });
    // … and the accurate GPS fix, which replaces it as soon as it is better.
    watchId = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: HARD_TIMEOUT_MS });
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
  const current = await getForegroundPermissionsAsync();
  if (current.granted || current.status === PermissionStatus.DENIED) return current;
  try {
    // The browser shows its own prompt on the first position request, and the answer is waited for.
    await once({ enableHighAccuracy: false, timeout: 30000, maximumAge: 600000 });
    return { status: PermissionStatus.GRANTED, granted: true, canAskAgain: true };
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 1) return { status: PermissionStatus.DENIED, granted: false, canAskAgain: false };
    // Position unavailable / timed out is not a refusal: the rider allowed it, so go on and look for a fix.
    return { status: PermissionStatus.GRANTED, granted: true, canAskAgain: true };
  }
}

export async function hasServicesEnabledAsync(): Promise<boolean> {
  return supported();
}

export function getCurrentPositionAsync(options?: { accuracy?: Accuracy }): Promise<LocationObject> {
  if (last && Date.now() - last.timestamp <= FRESH_MS && (last.coords.accuracy ?? Infinity) <= GOOD_ACCURACY_M) return Promise.resolve(last);
  return bestFix();
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
