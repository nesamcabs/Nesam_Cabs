// "Press back again to exit" on the booking home page.
// The first back press stays on the page and shows a short notice; a second press within a few seconds leaves.
// It works with one extra history entry, marked in history.state, that the first press uses up and is then put back.
import { useEffect } from 'react';
import { useToasts } from '@/state/Toasts';

const WINDOW_MS = 3000;
const MARK = '__exitGuard';

const armedState = () => ({ ...(window.history.state ?? {}), [MARK]: true });
const isGuard = () => Boolean((window.history.state as Record<string, unknown> | null)?.[MARK]);

export function useExitGuard(enabled: boolean): void {
  const { push } = useToasts();

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;
    let armedUntil = 0;
    // Arrive on a fresh entry: add the guard entry on top of the page. Coming back onto an existing guard entry needs nothing.
    if (!isGuard()) window.history.pushState(armedState(), '');

    const onPop = () => {
      // Only the step back onto the page itself is handled; moving forward onto the guard entry is not.
      if (isGuard()) return;
      if (Date.now() < armedUntil) {
        // Second press in time: really leave (the guard entry is already behind us, so one more step goes to the previous page).
        window.removeEventListener('popstate', onPop);
        window.history.back();
        return;
      }
      armedUntil = Date.now() + WINDOW_MS;
      window.history.pushState(armedState(), '');
      push({ title: 'Press back again to exit', tone: 'info', duration: WINDOW_MS });
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled, push]);
}
