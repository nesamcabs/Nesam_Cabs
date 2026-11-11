// A new notification takes over the header for a few seconds: the header's own contents step aside and the
// notification shows in their place. Tapping it opens what it is about; × or the timer hides it, then the next
// queued notification (if any) follows.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { markNotificationRead } from '@core/services/partnerNotifications';
import { toneOf } from '@core/utils/notificationModel';
import type { NotificationCategory } from '@core/types/notifications';
import { pathForPage, useInbox } from '@/state/Inbox';
import { Icon } from './Icon';

const SHOW_MS = 7000;
const ICON: Record<NotificationCategory, string> = {
  bookings: 'booking', approvals: 'verified', trips: 'route', payments: 'wallet', penalties: 'warning', general: 'notifications',
};

/** True while a notification is showing in the header (the header hides its contents). */
export function useHeaderNoticeActive(): boolean {
  return useInbox().live !== null;
}

export function HeaderNotice() {
  const { live, dismissLive } = useInbox();
  const navigate = useNavigate();

  useEffect(() => {
    if (!live) return undefined;
    const t = setTimeout(dismissLive, SHOW_MS);
    return () => clearTimeout(t);
  }, [live, dismissLive]);

  if (!live) return null;
  const open = () => {
    markNotificationRead(live.id).catch(() => undefined);
    dismissLive();
    if (live.bookingId && ['trips', 'booking-detail', 'trip'].includes(live.ctaPage)) navigate(`/trips/${live.bookingId}`);
    else navigate(live.ctaPage ? pathForPage(live.ctaPage) : '/notifications');
  };

  return (
    <div className="header-notice" role="status" aria-live="polite" key={live.id}>
      <button type="button" className="header-notice__main" onClick={open}>
        <span className={`header-notice__icon tone-${toneOf(live)}`}>
          <Icon name={ICON[live.category] ?? 'notifications'} size={18} />
        </span>
        <span className="header-notice__text">
          <strong className="truncate">{live.title}</strong>
          {live.message ? <span className="truncate">{live.message}</span> : null}
        </span>
      </button>
      <button type="button" className="header-notice__close" onClick={dismissLive} aria-label="Dismiss notification">
        <Icon name="close" size={16} />
      </button>
      <span className="header-notice__timer" style={{ animationDuration: `${SHOW_MS}ms` }} aria-hidden="true" />
    </div>
  );
}
