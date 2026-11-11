import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { setOnlineState } from '../utils/network';

/** Connectivity via NetInfo. `recovered` is true briefly after reconnecting. */
export function useNetworkStatus(): { online: boolean; recovered: boolean } {
  const [online, setOnline] = useState(true);
  const [recovered, setRecovered] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasOnline = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is null while unknown — treat unknown as online.
      const now = state.isConnected !== false && state.isInternetReachable !== false;
      setOnlineState(now);
      setOnline(now);
      if (now && !wasOnline) {
        setRecovered(true);
        clearTimeout(timer);
        timer = setTimeout(() => setRecovered(false), 3000);
      }
      if (!now) setRecovered(false);
      wasOnline = now;
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return { online, recovered };
}
