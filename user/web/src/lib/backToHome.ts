// Back never leaves the site from the profile pages, and always lands on Home from them.
//   1. When the first page opened in this tab is not Home (a shared link, a refresh, a bookmark), Home is put underneath
//      it in the browser history, so the phone / browser Back button returns to Home instead of closing the site.
//   2. On a profile-area page (account, payments, saved places, support, offers, notifications, my trips, legal, about),
//      Back always goes to Home. In-page links (e.g. "← Account" on Payments) still work as normal.
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

const HOME = '/';
/** Home and the page it opens (the index route redirects to Local Pickup & Drop). */
const isHome = (path: string) => path === '/' || path === '/local-rentals';
const PROFILE_AREA = [/^\/account(\/|$)/, /^\/support\/?$/, /^\/offers\/?$/, /^\/notifications\/?$/, /^\/trips\/?$/, /^\/legal\/?$/, /^\/about\/?$/];
const inProfileArea = (path: string) => PROFILE_AREA.some((re) => re.test(path));

export function useBackToHome(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const type = useNavigationType();
  const previous = useRef<string | null>(null);

  // 1. Arrived directly on an inner page: slide Home underneath it (runs once per tab; a refresh keeps its history index).
  useEffect(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx !== 0 || isHome(location.pathname)) return;
    const here = `${location.pathname}${location.search}${location.hash}`;
    navigate(HOME, { replace: true });
    navigate(here);
    // Only on the first page of the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Back (or Forward) out of a profile-area page always lands on Home.
  useEffect(() => {
    const from = previous.current;
    previous.current = location.pathname;
    if (type === 'POP' && from && from !== location.pathname && inProfileArea(from) && !isHome(location.pathname)) {
      navigate(HOME, { replace: true });
    }
  }, [location.pathname, type, navigate]);
}
