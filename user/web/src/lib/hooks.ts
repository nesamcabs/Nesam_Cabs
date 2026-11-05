import { useCallback, useEffect, useRef, useState } from 'react';
import { setOnlineState } from '@core/utils/network';
import { getCurrentPosition, getLocationPermission, watchPosition, LocationError, type DevicePosition, type PermissionStateLite } from '@core/services/geoService';

/** True while the viewport is at least `px` wide. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Connectivity from the browser, kept in sync with the shared retry/error helpers. */
export function useOnline(): { online: boolean; recovered: boolean } {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const set = (v: boolean) => {
      setOnlineState(v);
      setOnline(v);
      if (v) {
        setRecovered(true);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => setRecovered(false), 3000);
      } else setRecovered(false);
    };
    setOnlineState(navigator.onLine);
    const up = () => set(true);
    const down = () => set(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.clearTimeout(timer);
    };
  }, []);
  return { online, recovered };
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · NESAM Cabs` : 'NESAM Cabs';
  }, [title]);
}

export interface DeviceLocationState {
  position: DevicePosition | null;
  error: LocationError | null;
  permission: PermissionStateLite | 'unknown';
  locating: boolean;
  /** One-shot fix (e.g. "use my location"); asks for permission if needed. */
  locate: () => Promise<DevicePosition | null>;
}

/** Live device position while mounted (`watch`, only once permission is granted), plus a one-shot `locate()`. */
export function useDeviceLocation(watch = true): DeviceLocationState {
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [error, setError] = useState<LocationError | null>(null);
  const [permission, setPermission] = useState<PermissionStateLite | 'unknown'>('unknown');
  const [locating, setLocating] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const refresh = () =>
      getLocationPermission()
        .then((p) => mounted.current && setPermission(p))
        .catch(() => undefined);
    void refresh();
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!watch || permission !== 'granted') return undefined;
    return watchPosition(
      (p) => {
        setPosition(p);
        setError(null);
      },
      (e) => setError(e),
    );
  }, [watch, permission]);

  const locate = useCallback(async () => {
    setLocating(true);
    try {
      const p = await getCurrentPosition();
      if (mounted.current) {
        setPosition(p);
        setError(null);
        setPermission('granted');
      }
      return p;
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof LocationError ? e : null);
        getLocationPermission()
          .then((p) => mounted.current && setPermission(p))
          .catch(() => undefined);
      }
      return null;
    } finally {
      if (mounted.current) setLocating(false);
    }
  }, []);

  return { position, error, permission, locating, locate };
}

/**
 * Keeps `--app-h` equal to the visible viewport height so fixed bars stay above
 * the on-screen keyboard (iOS Safari does not resize the layout viewport).
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--app-h', `${Math.round(vv?.height ?? window.innerHeight)}px`);
    };
    apply();
    vv?.addEventListener('resize', apply);
    window.addEventListener('resize', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
