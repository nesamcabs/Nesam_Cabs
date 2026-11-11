// This rider's notifications, subscribed once per session. Every new arrival (after the first load) is queued for the
// header popup (components/HeaderNotice), one at a time; nothing is invented to fill the list.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { subscribeToNotifications } from '@core/services/partnerNotifications';
import type { PartnerNotification } from '@core/types/notifications';

interface InboxValue {
  notifications: PartnerNotification[];
  loaded: boolean;
  unreadCount: number;
  /** The newest unseen arrival, shown in the header popup; null when there is nothing to show. */
  live: PartnerNotification | null;
  /** Hide the current popup (the next queued arrival, if any, follows). */
  dismissLive: () => void;
}

const Ctx = createContext<InboxValue | null>(null);

export function useInbox(): InboxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('InboxProvider is missing');
  return v;
}

/** Where a notification's call-to-action leads (page keys come from the server's `cta.page`). */
export function pathForPage(page: string): string {
  switch (page) {
    case 'trips':
    case 'booking-detail':
      return '/trips';
    case 'book':
      return '/book';
    case 'support':
      return '/support';
    default:
      return '/notifications';
  }
}

export function InboxProvider({ userId, children }: { userId?: string | null; children: ReactNode }) {
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const [loaded, setLoaded] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<PartnerNotification[]>([]);
  const dismissLive = useCallback(() => setQueue((q) => q.slice(1)), []);

  useEffect(() => {
    seen.current = null;
    if (!userId) {
      setNotifications([]);
      setQueue([]);
      setLoaded(true);
      return undefined;
    }
    // This rider's own notifications, for this site only (the same login can also be a vendor or driver).
    return subscribeToNotifications(userId, (list) => {
      setNotifications(list);
      setLoaded(true);
      if (seen.current === null) {
        seen.current = new Set(list.map((n) => n.id));
        return;
      }
      const fresh: PartnerNotification[] = [];
      for (const n of list) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        if (!n.read) fresh.push(n);
      }
      // Oldest first, so the popups follow the order they arrived in.
      if (fresh.length) setQueue((q) => [...q, ...fresh.sort((a, b) => a.createdAtMs - b.createdAtMs)].slice(-10));
    }, { role: 'customer', site: 'nesam' });
  }, [userId]);

  // A popup whose notification was read elsewhere (e.g. on the Notifications page) is skipped.
  const live = queue.find((q) => !notifications.find((n) => n.id === q.id)?.read) ?? null;
  useEffect(() => {
    if (queue.length && queue[0] !== live) setQueue((q) => (live ? q.slice(q.indexOf(live)) : []));
  }, [queue, live]);
  const value = useMemo<InboxValue>(
    () => ({ notifications, loaded, unreadCount: notifications.filter((n) => !n.read).length, live, dismissLive }),
    [notifications, loaded, live, dismissLive],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
