import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { markAllNotificationsRead } from '@core/services/userService';
import { markNotificationRead } from '@core/services/partnerNotifications';
import { CATEGORIES, CATEGORY_LABEL, toneOf } from '@core/utils/notificationModel';
import type { NotificationCategory, PartnerNotification } from '@core/types/notifications';
import { describeError } from '@core/utils/retry';
import { Button, EmptyState, LinkButton, Notice, PageHead } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { pathForPage, useInbox } from '@/state/Inbox';
import { useAuth } from '@/state/Auth';
import { useSeo } from '@/lib/seo';

type Filter = 'all' | 'unread' | NotificationCategory;

const ICON: Record<NotificationCategory, string> = {
  bookings: 'booking',
  approvals: 'verified',
  trips: 'route',
  payments: 'wallet',
  penalties: 'warning',
  general: 'notifications',
};

export function NotificationsPage() {
  useSeo({ title: 'Notifications', noindex: true });
  const navigate = useNavigate();
  const { state, openLoginModal } = useAuth();
  const { notifications, loaded } = useInbox();
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (state.status !== 'ready') {
    return (
      <>
        <PageHead title="Notifications" />
        <div className="page">
          <div className="card card--center">
            <EmptyState
              art="welcome"
              title="Sign in to view notifications"
              action={
                <Button variant="primary" onClick={() => openLoginModal({ title: 'Sign in to view notifications' })}>
                  Sign in
                </Button>
              }
            >
            </EmptyState>
          </div>
        </div>
      </>
    );
  }

  const unread = notifications.filter((n) => !n.read);
  const present = CATEGORIES.filter((c) => notifications.some((n) => n.category === c));
  const shown = useMemo(
    () => (filter === 'all' ? notifications : filter === 'unread' ? unread : notifications.filter((n) => n.category === filter)),
    [notifications, unread, filter],
  );

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: notifications.length },
    { id: 'unread', label: 'Unread', count: unread.length },
    ...present.map((c) => ({ id: c as Filter, label: CATEGORY_LABEL[c], count: notifications.filter((n) => n.category === c).length })),
  ];

  const markAll = async () => {
    setBusy(true);
    setError('');
    try {
      await markAllNotificationsRead(unread.map((n) => n.id));
    } catch (e) {
      setError(describeError(e, 'We couldn’t update your notifications.'));
    } finally {
      setBusy(false);
    }
  };

  const open = (n: PartnerNotification) => {
    if (!n.read) markNotificationRead(n.id).catch(() => undefined);
    const goesToTrip = n.bookingId && ['trips', 'booking-detail'].includes(n.ctaPage);
    if (goesToTrip) navigate(`/trips/${n.bookingId}`);
    else if (n.ctaPage && n.ctaPage !== 'notifications') navigate(pathForPage(n.ctaPage));
  };

  return (
    <>
      <PageHead
        title="Notifications"
        actions={
          unread.length > 0 ? (
            <Button size="sm" variant="ghost" icon="check" loading={busy} onClick={() => void markAll()}>
              Mark all as read
            </Button>
          ) : undefined
        }
      />

      <div className="page">
        {error ? <Notice tone="error">{error}</Notice> : null}

        {!loaded ? (
          <div className="stack">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 92 }} />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <div className="card card--center">
            <EmptyState
              art="no-notifications"
              title="You’re all caught up"
              action={
                <LinkButton variant="primary" to="/book" icon="car">
                  Book a ride
                </LinkButton>
              }
            >
            </EmptyState>
          </div>
        ) : (
          <div className="inbox">
            <nav className="inbox__filters" aria-label="Filter notifications">
              {filters.map((f) => (
                <button key={f.id} type="button" className="inbox__filter" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  <span>{f.label}</span>
                  <span className="chip__count">{f.count}</span>
                </button>
              ))}
            </nav>
            <div className="inbox__list">
              {shown.length === 0 ? (
                <div className="card card--center">
                  <EmptyState
                    title={filter === 'unread' ? 'No unread notifications' : 'Nothing here'}
                    action={
                      <Button variant="secondary" onClick={() => setFilter('all')}>
                        Show all notifications
                      </Button>
                    }
                  >
                  </EmptyState>
                </div>
              ) : (
                <ul className="card card--list notif-list">
                  {shown.map((n) => (
                    <li key={n.id}>
                      <button type="button" className={`notif ${n.read ? '' : 'is-unread'}`} onClick={() => open(n)}>
                        <span className={`notif__icon tone-${toneOf(n)}`}>
                          <Icon name={ICON[n.category]} size={22} />
                        </span>
                        <span className="notif__body">
                          <span className="notif__head">
                            <strong>{n.title}</strong>
                            <time>{n.time}</time>
                          </span>
                          {n.message ? <span className="notif__msg">{n.message}</span> : null}
                          <span className="notif__meta">
                            {n.ctaLabel && n.ctaPage !== 'notifications' ? <span className="notif__cta">{n.ctaLabel} →</span> : null}
                          </span>
                        </span>
                        {!n.read ? <span className="notif__dot" aria-label="Unread" /> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
