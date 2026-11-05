// Keeps a failed page from leaving a blank screen, for NESAM Cabs, One Way Car Rentals and People Taxi.
//
// The usual cause is a new version being published while a visitor still has the site open: the
// open page asks for page files that no longer exist, and the download fails. The site then reloads
// itself once to pick up the new version. Anything else that breaks a page shows a short message
// with Reload and Home buttons instead of a white screen.
import { Component, type ErrorInfo, type ReactNode } from 'react';

const RELOAD_KEY = 'nesam.stale.reload';

/** Reloads the page once (never in a loop) so a new version of the site is picked up. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 30_000) return false; // just reloaded and it still fails: show the message
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

const STALE_FILE = /(dynamically imported module|importing a module script failed|failed to load module script|loading chunk|loading css chunk|error loading dynamically)/i;
export const isStaleFileError = (error: unknown) => STALE_FILE.test(`${(error as Error | undefined)?.name ?? ''} ${(error as Error | undefined)?.message ?? ''}`);

/** Call once at startup: a page file that fails to download after a new publish triggers the one-time reload. */
export function installStaleVersionReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadForNewVersion();
  });
}

/**
 * An open tab never fetches new files by itself, so a visitor who keeps the site open would stay on an
 * old version. Call once at startup: when the tab is visited again, and every few minutes, the site
 * looks at the published page; if it points at newer files, a small "Refresh" bar appears.
 */
export function installVersionCheck(): void {
  const mine = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src');
  if (!mine) return; // the dev server has no versioned files
  let shown = false;

  const showBar = () => {
    if (shown) return;
    shown = true;
    const bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);padding:10px 12px 10px 16px;border-radius:999px;background:#111827;color:#fff;font:600 14px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)';
    const text = document.createElement('span');
    text.textContent = 'A new version of the site is ready.';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Refresh';
    button.style.cssText = 'border:0;border-radius:999px;padding:8px 16px;background:#fff;color:#111827;font:700 14px system-ui,sans-serif;cursor:pointer';
    button.onclick = () => window.location.reload();
    bar.append(text, button);
    document.body.appendChild(bar);
  };

  const check = async () => {
    if (shown || document.visibilityState !== 'visible') return;
    try {
      const res = await fetch('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
      const latest = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(await res.text())?.[0];
      if (latest && !mine.endsWith(latest)) showBar();
    } catch {
      /* offline or a hiccup: try again later */
    }
  };

  document.addEventListener('visibilitychange', () => void check());
  window.setTimeout(() => void check(), 60_000);
  window.setInterval(() => void check(), 5 * 60_000);
}

interface BoundaryState {
  failed: boolean;
}

class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isStaleFileError(error)) reloadForNewVersion();
    else console.error('Page failed to render:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <div className="card card--center" role="alert">
          <h2>This page didn’t load</h2>
          <p className="muted">The site may have just been updated. Reload to get the latest version.</p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
            <a className="btn btn--secondary" href="/">
              Go to home
            </a>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Wrap the page area. Pass the current page (`resetKey`, e.g. the route's pathname) so the screen
 * recovers by itself when the rider moves to another page. (This file is shared by three sites, so it
 * does not import the router itself.)
 */
export function RouteErrorBoundary({ resetKey, children }: { resetKey: string; children: ReactNode }) {
  return <Boundary key={resetKey}>{children}</Boundary>;
}

export default RouteErrorBoundary;
