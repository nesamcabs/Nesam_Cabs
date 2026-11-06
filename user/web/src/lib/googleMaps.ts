/** Shared map loading and authentication failure handling for every page. */
declare global { interface Window { google?: any; __nesamGoogleMapsPromise?: Promise<any>; gm_authFailure?: () => void; } }
const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() ?? '';
export const hasGoogleMapsWebKey = apiKey.length > 0;
const failureListeners = new Set<() => void>();
let authFailed = false;
export function onGoogleMapsFailure(listener: () => void): () => void {
  failureListeners.add(listener);
  if (authFailed) listener();
  return () => { failureListeners.delete(listener); };
}
export function loadGoogleMaps(): Promise<any> {
  if (!hasGoogleMapsWebKey) return Promise.reject(new Error('Google Maps key is not configured'));
  if (authFailed) return Promise.reject(new Error('Google Maps authentication failed'));
  if (window.__nesamGoogleMapsPromise) return window.__nesamGoogleMapsPromise;
  if (typeof window.google?.maps?.Map === 'function' && typeof window.google?.maps?.Marker === 'function') return Promise.resolve(window.google.maps);
  const request = new Promise<any>((resolve, reject) => {
    const callback = `__nesamMapsReady_${Date.now()}`;
    const globals = window as unknown as Record<string, any>;
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => { clearTimeout(timeout); delete globals[callback]; script.onerror = null; };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const timeout = setTimeout(() => fail('Google Maps loading timed out'), 15000);
    window.gm_authFailure = () => {
      authFailed = true;
      fail('Google Maps authentication failed');
      failureListeners.forEach((listener) => listener());
    };
    globals[callback] = () => {
      if (typeof window.google?.maps?.Map !== 'function' || typeof window.google?.maps?.Marker !== 'function') { fail('Google Maps did not initialize'); return; }
      settled = true;
      cleanup();
      resolve(window.google.maps);
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&libraries=maps,marker&callback=${callback}`;
    script.async = true;
    script.onerror = () => fail('Google Maps failed to load');
    document.head.appendChild(script);
  });
  window.__nesamGoogleMapsPromise = request;
  // Failed requests must not remain cached when the rider opens another map.
  void request.catch(() => { if (window.__nesamGoogleMapsPromise === request) window.__nesamGoogleMapsPromise = undefined; });
  return request;
}
