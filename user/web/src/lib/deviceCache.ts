// Registers the device cache (public/sw.js) so scripts, fonts, car pictures and map tiles are
// kept on the device after the first visit. Production only: the dev server must never be cached.
export function registerDeviceCache(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const start = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* the site works exactly as before without it */
    });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}

/** After the first screen is up, fetch the other pages' files while the browser is idle so a later tap opens at once. */
export function prefetchWhenIdle(loaders: Array<() => Promise<unknown>>): void {
  if (typeof window === 'undefined') return;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') return;
  const run = () => loaders.forEach((load, i) => window.setTimeout(() => void load().catch(() => undefined), i * 250));
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}
