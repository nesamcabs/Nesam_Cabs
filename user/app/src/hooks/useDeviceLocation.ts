import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  DevicePosition,
  LocationError,
  PermissionStateLite,
  getCurrentPosition,
  getLocationPermission,
  watchPosition,
} from '../services/geoService';

export interface DeviceLocationState {
  position: DevicePosition | null;
  error: LocationError | null;
  permission: PermissionStateLite | 'unknown';
  locating: boolean;
  /** One-shot high-accuracy fix (e.g. "locate me"); requests permission if needed. */
  locate: () => Promise<DevicePosition | null>;
}

/**
 * Live device position while mounted (`watch`), plus a one-shot `locate()`.
 * Permission changes made in system settings are picked up when the app
 * returns to the foreground.
 */
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
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      sub.remove();
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
