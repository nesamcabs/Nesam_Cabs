// While the search page is open it owns one history entry, so the Android Back button (or gesture)
// closes the page instead of leaving the booking form.
import { useEffect, useRef } from 'react';

const KEY = '__placeSearch';
let open = 0;

/** True while a Back press belongs to the search page (the home page's "press back again to exit" stays quiet). */
export const searchPageOwnsBack = (): boolean => open > 0;

/** `onBack` returns true to stay open (it only stepped back inside the page), false to let the page close. */
export function useBackEntry(onBack: () => boolean): void {
  const callback = useRef(onBack);
  callback.current = onBack;
  const mark = useRef('');
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    // The router's own pushState wrapper turns a push into a replace on inner screens; this entry must be a real one.
    const push = () => History.prototype.pushState.call(window.history, { ...(window.history.state ?? {}), [KEY]: mark.current }, '');
    const mine = () => !!mark.current && (window.history.state as Record<string, unknown> | null)?.[KEY] === mark.current;
    if (!mark.current) {
      mark.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      open += 1;
      push();
    }
    const onPop = () => {
      if (!mine() && callback.current()) push();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      alive.current = false;
      // Waits a tick: React may run this clean-up and set the effect up again at once.
      window.setTimeout(() => {
        if (alive.current || !mark.current) return;
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          open = Math.max(0, open - 1);
        };
        if (mine()) {
          window.addEventListener('popstate', release, { once: true });
          window.setTimeout(release, 800);
          window.history.back();
        } else release();
        mark.current = '';
      }, 0);
    };
  }, []);
}
