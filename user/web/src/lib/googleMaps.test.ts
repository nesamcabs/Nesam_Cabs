import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Google Maps loading across pages', () => {
  let scripts: any[];
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-browser-key');
    vi.stubGlobal('window', {});
    scripts = [];
    vi.stubGlobal('document', {
      createElement: () => ({ remove: vi.fn(), onerror: null }),
      head: { appendChild: (script: any) => scripts.push(script) },
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  function ready() {
    window.google = { maps: { Map: function Map() {}, Marker: function Marker() {} } };
    const callback = new URL(scripts.at(-1).src).searchParams.get('callback')!;
    (window as any)[callback]();
  }

  it('shares a pending request even when Google has created an incomplete namespace', async () => {
    const { loadGoogleMaps } = await import('./googleMaps');
    const first = loadGoogleMaps();
    window.google = { maps: {} };
    expect(loadGoogleMaps()).toBe(first);
    expect(scripts).toHaveLength(1);
    ready();
    await expect(first).resolves.toBe(window.google.maps);
  });

  it('retries on a later page after a script network error', async () => {
    const { loadGoogleMaps } = await import('./googleMaps');
    const first = loadGoogleMaps();
    const rejected = expect(first).rejects.toThrow('failed to load');
    scripts[0].onerror();
    await rejected;
    const second = loadGoogleMaps();
    expect(scripts).toHaveLength(2);
    expect(scripts[0].remove).toHaveBeenCalledOnce();
    ready();
    await expect(second).resolves.toBe(window.google.maps);
  });

  it('rejects a stalled request instead of leaving the map blank indefinitely', async () => {
    const { loadGoogleMaps } = await import('./googleMaps');
    const request = loadGoogleMaps();
    const rejected = expect(request).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
    expect(window.__nesamGoogleMapsPromise).toBeUndefined();
  });

  it('notifies every mounted map when authentication fails after loading', async () => {
    const { loadGoogleMaps, onGoogleMapsFailure } = await import('./googleMaps');
    const first = vi.fn(), second = vi.fn(), unmounted = vi.fn();
    onGoogleMapsFailure(first);
    onGoogleMapsFailure(second);
    const unsubscribe = onGoogleMapsFailure(unmounted);
    unsubscribe();
    const request = loadGoogleMaps();
    ready();
    await request;
    window.gm_authFailure!();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
    await expect(loadGoogleMaps()).rejects.toThrow('authentication failed');
  });
});
