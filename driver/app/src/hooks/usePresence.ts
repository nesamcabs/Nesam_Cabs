import { useCallback, useState } from 'react';
import { useDriverData } from '../context/DriverData';
import { setDriverPresence } from '../services/driverService';
import type { DriverStatus } from '../types/driver';
import { describeError } from '../utils/retry';

/**
 * Duty status (Online / Offline) for the top-bar switch and the Home screen. While a trip is assigned the status is
 * locked — it follows the trip (On Trip) and the server-side presence sync in DriverData flips it back afterwards.
 */
export function usePresence(onMessage: (kind: 'ok' | 'error', text: string) => void) {
  const { account, activeTrip } = useDriverData();
  const [busy, setBusy] = useState(false);
  const status: DriverStatus = account.driver.presenceStatus;
  const online = status === 'Online' || status === 'On Trip';

  const change = useCallback(
    async (next: DriverStatus) => {
      if (activeTrip) {
        onMessage('error', 'Finish your current trip before changing your duty status.');
        return;
      }
      setBusy(true);
      try {
        await setDriverPresence(account.driver.id, next);
      } catch (e) {
        onMessage('error', describeError(e, 'Could not update your status.'));
      } finally {
        setBusy(false);
      }
    },
    [account.driver.id, activeTrip, onMessage],
  );

  return { status, online, busy, locked: !!activeTrip, change, toggle: () => change(online ? 'Offline' : 'Online') };
}
