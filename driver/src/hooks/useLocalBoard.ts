// The nearby-order board of a running local duty: asks the server for the orders around the driver every POLL_MS while the
// Local Taxi page is on screen and the app is in front, and on demand. The driver's live position goes with each request
// (the server sorts by it and keeps it on the duty for the fleet partner).
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { fetchBoard, type Board } from '../services/localDutyService';
import { getCurrentPosition, watchPosition, type DevicePosition } from '../services/locationService';
import { ActionError } from '../services/callables';
import { describeError } from '../utils/retry';

export const POLL_MS = 25000;

export function useLocalBoard(shiftId: string | null, enabled: boolean) {
  const focused = useIsFocused();
  const active = enabled && focused && !!shiftId;
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [me, setMe] = useState<DevicePosition | null>(null);
  const [locationError, setLocationError] = useState('');
  const meRef = useRef<DevicePosition | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!active) return undefined;
    return watchPosition(
      (p) => {
        meRef.current = p;
        setMe(p);
        setLocationError('');
      },
      (e) => setLocationError(e.message),
    );
  }, [active]);

  const refresh = useCallback(async () => {
    if (!shiftId || busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const fix = meRef.current ?? (await getCurrentPosition(8000).catch(() => null));
      if (fix && !meRef.current) {
        meRef.current = fix;
        setMe(fix);
      }
      const next = await fetchBoard(shiftId, fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : null);
      setBoard(next);
      setError('');
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof ActionError ? e.message : describeError(e, 'Nearby orders could not be loaded.'));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    if (!active) return undefined;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [active, refresh]);

  return { board, loading, error, updatedAt, me, locationError, refresh };
}
