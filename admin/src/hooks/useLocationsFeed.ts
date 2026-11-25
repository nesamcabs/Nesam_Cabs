import { useCallback, useEffect, useState } from "react";
import type { MasterLocation } from "../types";
import { subscribeLocations } from "../services/adminFirestoreService";

/**
 * Load state of a live data source, kept distinct so a failure is never shown as an empty result:
 *   loading → ready (with or without rows) | error (denied = the database rules refused this account; other = anything else).
 */
export interface FeedStatus { loading: boolean; error: string | null; denied: boolean; onRetry: () => void }

/** The Locations master, live, with its load state and a Retry that subscribes again. Stale listeners are closed on retry/unmount. */
export function useLocationsFeed(): { locations: MasterLocation[]; status: FeedStatus } {
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [state, setState] = useState<{ loading: boolean; error: string | null; denied: boolean }>({ loading: true, error: null, denied: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ loading: true, error: null, denied: false });
    const unsub = subscribeLocations(
      (rows) => { if (live) { setLocations(rows); setState({ loading: false, error: null, denied: false }); } },
      (message, code) => { if (live) setState({ loading: false, error: message, denied: code === "permission-denied" }); },
    );
    return () => { live = false; unsub(); };
  }, [attempt]);
  const onRetry = useCallback(() => setAttempt((n) => n + 1), []);
  return { locations, status: { ...state, onRetry } };
}
