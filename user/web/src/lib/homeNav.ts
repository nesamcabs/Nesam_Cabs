// Back always leads to the booking home. The browser history holds at most the home page and the
// screen in front of it: opening the site on another screen puts the home page underneath it, and
// moving from one screen to another replaces the history entry instead of adding one. So Back
// (phone, browser or an in-app back button) from any screen lands on the home page.

/** The booking home ("/" and its alias "/book", with any service query or hash). */
export const isHomePath = (path: string) => path === '/' || path === '/book';

/** Pages anyone can read, shown straight away while a returning rider's account is still loading. */
export const isPublicPath = (path: string) => isHomePath(path) || path === '/legal' || /^\/(routes|services)\/[^/]+$/.test(path);

let installed = false;

/** Call once, before the router starts, so the router reads the final location. */
export function keepHomeBehindEveryScreen(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const { history, location } = window;

  // Every screen opens at the top, never at a scroll position remembered from an earlier visit.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  // A fresh entry on another screen (link, bookmark, search result): slip the home page under it.
  // A reload keeps its router state, and the home page is already there.
  const here = location.pathname + location.search + location.hash;
  if (!isHomePath(location.pathname) && history.state == null) {
    history.replaceState(null, '', '/');
    history.pushState(null, '', here);
  }

  const push = history.pushState.bind(history);
  // A move from the home page adds an entry; a move from any other screen takes its place, so
  // the entry underneath stays the home page.
  history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    if (isHomePath(location.pathname)) push(data, unused, url);
    else history.replaceState(data, unused, url);
  };
}
