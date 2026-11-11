import { useEffect, useState } from 'react';

/** The current time, refreshed on an interval, so day labels ("Today") and time-gated actions stay correct while the app is open. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
