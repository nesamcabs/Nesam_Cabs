import { useCallback, useEffect, useRef, useState } from 'react';
import { setOnlineState } from '@core/utils/network';
import { defaultPickup } from './schedule';
import { getCurrentPosition, getLocationPermission, watchPosition, LocationError, type DevicePosition, type PermissionStateLite } from '@core/services/geoService';

/** True while the viewport is at least `px` wide. */
export function useMinWidth(px: number): boolean {
  return useMediaQuery(`(min-width: ${px}px)`);
}

/** True while the CSS media query matches. */
export function useMediaQuery(query: string): boolean {
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
export function useDeviceLocation(watch = true, autoLocate = false): DeviceLocationState {
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

  // Detect the device location by default: the browser asks once, and nothing is asked again after a refusal.
  const autoTried = useRef(false);
  useEffect(() => {
    if (!autoLocate || autoTried.current || permission === 'unknown' || permission === 'denied' || permission === 'blocked') return;
    autoTried.current = true;
    void locate();
  }, [autoLocate, permission, locate]);

  return { position, error, permission, locating, locate };
}

/**
 * Keeps `--app-h` equal to the visible viewport height, and tells the page when the on-screen keyboard is up
 * (`<html data-keyboard="open">`) so the fixed bars can step aside instead of riding up above the keys and covering the field.
 * While a field is focused on a phone it is also brought just under the header, which leaves the most room for the keyboard and
 * the suggestions list, and keeps the field itself in view.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    // The tallest the visible area has been at this width: the keyboard is up when it is now clearly shorter than that.
    let tallest = Math.max(window.innerHeight, vv?.height ?? 0);
    let width = window.innerWidth;
    const FIELD = 'input:not([readonly]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]), textarea, select, [contenteditable="true"]';
    const typing = () => !!document.activeElement?.matches?.(FIELD);
    const apply = () => {
      const h = vv?.height ?? window.innerHeight;
      root.style.setProperty('--app-h', `${Math.round(h)}px`);
      if (window.innerWidth !== width) {
        width = window.innerWidth; // rotated or resized: measure again
        tallest = Math.max(window.innerHeight, h);
      } else {
        tallest = Math.max(tallest, window.innerHeight, h);
      }
      const open = typing() && tallest - h > 120;
      if (open) root.dataset.keyboard = 'open';
      else delete root.dataset.keyboard;
    };
    let timer = 0;
    const reveal = (el: Element) => {
      window.clearTimeout(timer);
      // Wait for the keyboard to finish opening, then bring the field into view.
      timer = window.setTimeout(() => {
        if (document.activeElement !== el || window.innerWidth >= 900 || el.closest('[data-no-reveal]')) return;
        const inPanel = !!el.closest('[role="dialog"], dialog, .dialog, .drawer__panel, .sheet');
        el.scrollIntoView({ block: inPanel ? 'center' : 'start', inline: 'nearest', behavior: 'smooth' });
      }, 320);
    };
    const onFocusIn = (e: FocusEvent) => {
      apply();
      if (e.target instanceof Element && e.target.matches(FIELD)) reveal(e.target);
    };
    const onFocusOut = () => window.setTimeout(apply, 150);
    apply();
    vv?.addEventListener('resize', apply);
    window.addEventListener('resize', apply);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', apply);
      window.removeEventListener('resize', apply);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      delete root.dataset.keyboard;
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

/**
 * Keeps a default pickup at "now + 30 minutes" as the clock moves: while `touched.current` is false the date and time are
 * refreshed every few seconds (and the moment the tab is shown again). Once the rider picks a date or time they set
 * `touched.current = true` and it never changes under them.
 */
export function useLivePickupDefault(touched: { current: boolean }, apply: (next: { date: string; time: string }) => void): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    const tick = () => {
      if (!touched.current) applyRef.current(defaultPickup());
    };
    const id = window.setInterval(tick, 10000);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [touched]);
}
