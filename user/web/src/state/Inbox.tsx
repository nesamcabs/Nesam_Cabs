// This rider's notifications, subscribed once per session. New arrivals (after the
// first load) also raise a toast; nothing is invented to fill the list.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { subscribeToNotifications } from '@core/services/partnerNotifications';
import type { PartnerNotification } from '@core/types/notifications';
import { useNavigate } from 'react-router-dom';
import { useToasts } from './Toasts';

interface InboxValue {
  notifications: PartnerNotification[];
  loaded: boolean;
  unreadCount: number;
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
  const { push } = useToasts();
  const navigate = useNavigate();

  useEffect(() => {
    seen.current = null;
    if (!userId) {
      setNotifications([]);
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
      for (const n of list) {
        if (seen.current.has(n.id)) continue;
        seen.current.add(n.id);
        // "Booking confirmed" is already shown full-screen by the confirmation animation, so it gets no toast.
        if (!n.read && n.popup && n.title !== 'Booking confirmed') {
          push({ title: n.title, message: n.message, tone: n.severity === 'critical' || n.severity === 'warning' ? 'warning' : 'info', action: { label: n.ctaLabel || 'Open', run: () => navigate(pathForPage(n.ctaPage)) } });
        }
      }
    }, { role: 'customer', site: 'nesam' });
  }, [userId, push, navigate]);

  const value = useMemo<InboxValue>(() => ({ notifications, loaded, unreadCount: notifications.filter((n) => !n.read).length }), [notifications, loaded]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
