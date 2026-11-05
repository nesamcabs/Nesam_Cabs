export interface Fix {
  lat: number;
  lng: number;
  accuracy: number | null;
  /** When the device took the reading (ms since epoch). The server refuses a position older than its limit, and one with no time. */
  capturedAt: number | null;
}

/** Acquire a position; pickup confirmation can wait for a fresh, sufficiently accurate fix. */
export function getFirebaseLocation(timeoutMs = 10000, targetAccuracyM?: number): Promise<Fix | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    if (targetAccuracyM !== undefined) {
      let best: Fix | null = null;
      let watchId: number | undefined;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
        resolve(best);
      };
      const timer = setTimeout(finish, timeoutMs);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (finished || !Number.isFinite(pos.timestamp) || pos.timestamp < Date.now() - timeoutMs) return;
          const accuracy = pos.coords.accuracy;
          if (!Number.isFinite(accuracy) || accuracy < 0) return;
          const fix: Fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.ceil(accuracy), capturedAt: pos.timestamp };
          if (!best || fix.accuracy! <= best.accuracy!) best = fix;
          if (fix.accuracy! <= targetAccuracyM) finish();
        },
        (error) => {
          // A denied permission cannot recover; transient failures may recover before our deadline.
          if (error.code === error.PERMISSION_DENIED) finish();
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
      if (finished) navigator.geolocation.clearWatch(watchId);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Number.isFinite(pos.coords.accuracy) ? Math.round(pos.coords.accuracy) : null, capturedAt: Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now() }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}
