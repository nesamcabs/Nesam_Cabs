// Fetches the authoritative quotes whenever the trip changes (stale answers dropped), and keeps them fresh:
// when the admin changes prices, categories, adjustments or coupons (`refreshKey`), when the rider comes
// back to the tab, and every few seconds while the page is open. Quiet refreshes never blank the fares.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQuotes, quoteKeyOf, type QuoteRequest, type ServerQuoteResponse } from '../services/quoteService';

export type QuoteStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ServerQuoteState {
  status: QuoteStatus;
  key: string;
  data: ServerQuoteResponse | null;
  error: string;
  retry: () => void;
}

/** How long a new trip waits before it is sent, so quick edits are sent once. */
const NEW_TRIP_DELAY_MS = 120;
/** How often an open page asks again, so a price changed by the admin shows up within seconds. */
const REFRESH_EVERY_MS = 20_000;
/** Never refresh more often than this, however many triggers fire. */
const MIN_GAP_MS = 4_000;

export function useServerQuotes(request: QuoteRequest | null, enabled = true, refreshKey = ''): ServerQuoteState {
  const key = enabled ? quoteKeyOf(request) : '';
  const [state, setState] = useState<{ key: string; status: QuoteStatus; data: ServerQuoteResponse | null; error: string }>({ key: '', status: 'idle', data: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  const [tick, setTick] = useState(0);
  const [previousKey, setPreviousKey] = useState(key);
  if (key !== previousKey) {
    setPreviousKey(key);
    setState({ key, status: key ? 'loading' : 'idle', data: null, error: '' });
  }
  const latest = useRef(request);
  useEffect(() => { latest.current = request; }, [request]);
  /** The trip whose fares are on screen right now; a request for the same trip then refreshes quietly. */
  const shown = useRef('');
  const lastBump = useRef(0);

  useEffect(() => {
    const req = latest.current;
    if (!key || !req) return undefined;
    let cancelled = false;
    const quiet = shown.current === key;
    const t = setTimeout(() => {
      if (!quiet) setState((s) => ({ key, status: 'loading', data: s.key === key ? s.data : null, error: '' }));
      fetchQuotes(req)
        .then((data) => {
          if (cancelled) return;
          shown.current = key;
          setState({ key, status: 'ready', data, error: '' });
        })
        .catch((e: unknown) => {
          if (cancelled || quiet) return; // a failed quiet refresh keeps the fares already shown
          setState({ key, status: 'error', data: null, error: (e as { message?: string })?.message || 'We could not get the fare right now.' });
        });
    }, quiet ? 0 : NEW_TRIP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key, attempt, tick]);

  const refreshSoon = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const now = Date.now();
    if (now - lastBump.current < MIN_GAP_MS) return;
    lastBump.current = now;
    setTick((n) => n + 1);
  }, []);

  // The admin changed something that prices a trip: ask again (only once this trip already has fares).
  const firstRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey === firstRefreshKey.current) return;
    firstRefreshKey.current = refreshKey;
    if (key && shown.current === key) refreshSoon();
  }, [refreshKey, key, refreshSoon]);

  // Coming back to the tab, and a steady beat while the page stays open.
  useEffect(() => {
    if (!key || typeof document === 'undefined' || typeof window === 'undefined') return undefined;
    const onVisible = () => refreshSoon();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const id = window.setInterval(refreshSoon, REFRESH_EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.clearInterval(id);
    };
  }, [key, refreshSoon]);

  const retry = useCallback(() => {
    shown.current = '';
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    setAttempt((n) => n + 1);
  }, []);
  // A result for a different trip is never exposed.
  const current = state.key === key ? state : { key, status: key ? ('loading' as const) : ('idle' as const), data: null, error: '' };
  return { status: current.status, key, data: current.data, error: current.error, retry };
}
