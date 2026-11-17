import { useEffect, useState } from 'react';
import { subscribeToMyBids, type DriverBid } from '../services/driverService';

/** This driver's own duty bids (live). `loaded` turns true after the first answer, even an empty or failed one. */
export function useMyBids(driverId: string) {
  const [bids, setBids] = useState<DriverBid[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!driverId) return undefined;
    return subscribeToMyBids(
      driverId,
      (list) => {
        setBids(list);
        setLoaded(true);
      },
      () => setLoaded(true),
    );
  }, [driverId]);
  const pending = bids.filter((b) => b.status === 'Pending Review');
  return { bids, pending, loaded };
}
