import React, { useState } from 'react';
import type { DriverNotification, DriverPenalty, NotificationCategory } from '../types';
import { CATEGORIES, CATEGORY_LABEL, TONE, toneOf } from '../utils/notificationModel';
import { formatDateTime12 } from '../utils/time';
import { Icon, type IconName } from '../components/nx/Icon';
import { EmptyState } from '../components/nx/parts';
import { inr } from '../components/nx/format';

interface NotificationsScreenProps {
  notifications: DriverNotification[];
  penalties: DriverPenalty[];
  penaltiesError: string;
  onMarkRead: (id: string) => void;
  onOpenPenalty: (p: DriverPenalty) => void;
}

const CATEGORY_ICON: Record<NotificationCategory, IconName> = {
  bookings: 'trip',
  approvals: 'shield',
  trips: 'car',
  payments: 'wallet',
  penalties: 'alert',
  general: 'bell',
};

const PENALTY_TONE: Record<string, string> = { Pending: 'amber', Acknowledged: 'neutral', Disputed: 'amber', Paid: 'green', Deducted: 'green', Waived: 'neutral' };

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({ notifications, penalties, penaltiesError, onMarkRead, onOpenPenalty }) => {
  const [tab, setTab] = useState<'all' | NotificationCategory>('all');
  const unread = (c: NotificationCategory | 'all') => notifications.filter((n) => !n.read && (c === 'all' || n.category === c)).length;
  const list = tab === 'all' ? notifications : notifications.filter((n) => n.category === tab);
  const openPenalties = penalties.filter((p) => p.status === 'Pending').length;

  return (
    <>
      <div className="page-tabs" role="group" aria-label="Notification categories">
        {(['all', ...CATEGORIES] as const).map((k) => {
          const count = k === 'penalties' ? openPenalties + unread('penalties') : unread(k);
          return (
            <button key={k} type="button" className={`pill-button ${tab === k ? 'active' : ''}`} aria-pressed={tab === k} onClick={() => setTab(k)}>
              {k === 'all' ? 'All' : CATEGORY_LABEL[k]}
              {count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
        {unread('all') > 0 ? (
          <button type="button" className="text-button" style={{ marginLeft: 'auto' }} onClick={() => notifications.filter((n) => !n.read).forEach((n) => onMarkRead(n.id))}>
            Mark all read
          </button>
        ) : null}
      </div>

      {tab === 'penalties' ? (
        <section className="panel page-card">
          <div className="card-heading">
            <div>
              <h2>Your penalties</h2>
              <p>Issued by NESAM</p>
            </div>
            <Icon name="alert" />
          </div>
          {penaltiesError ? (
            <div className="info-note amber" role="alert">
              <Icon name="info" />
              <span>{penaltiesError}</span>
            </div>
          ) : null}
          {!penaltiesError && penalties.length === 0 ? <p className="profile-note">You have no penalties.</p> : null}
          {penalties.map((p) => (
            <div className="notification-item" key={p.id}>
              <div className="ledger-icon">
                <Icon name="alert" />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3>
                  {p.category} · {inr(p.amount)}
                </h3>
                <p>{p.reason}</p>
                {p.description ? <p>{p.description}</p> : null}
                <p>
                  <span className={`badge ${PENALTY_TONE[p.status] ?? 'neutral'}`}>{p.status}</span>
                  {p.bookingCode ? ` ${p.bookingCode}` : ''}
                  {p.issuedAt ? ` · ${formatDateTime12(p.issuedAt)}` : ''}
                  {p.acknowledged ? ` · read${p.acknowledgedAt ? ` ${formatDateTime12(p.acknowledgedAt)}` : ''}` : ''}
                </p>
                {p.disputeNote ? (
                  <p>
                    <strong>Your dispute:</strong> {p.disputeNote}
                  </p>
                ) : null}
                {p.status === 'Pending' && !p.acknowledged ? (
                  <button type="button" className="button primary" style={{ marginTop: 10 }} onClick={() => onOpenPenalty(p)}>
                    Read and acknowledge
                  </button>
                ) : null}
                {p.status === 'Acknowledged' ? (
                  <button type="button" className="text-button" style={{ marginTop: 8 }} onClick={() => onOpenPenalty(p)}>
                    Dispute this penalty
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : list.length === 0 ? (
        <EmptyState icon="bell" title={tab === 'all' ? 'You have no notifications yet.' : `No ${CATEGORY_LABEL[tab].toLowerCase()} notifications.`}>
          Trips, approvals, payments and penalties from NESAM will appear here.
        </EmptyState>
      ) : (
        <section className="panel page-card">
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              className="notification-item"
              style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, opacity: n.read ? 0.72 : 1, cursor: n.read ? 'default' : 'pointer' }}
              onClick={() => !n.read && onMarkRead(n.id)}
            >
              <div className="ledger-icon">
                <Icon name={CATEGORY_ICON[n.category]} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3>
                  {n.title}
                  {!n.read ? <span className="notification-dot" aria-label="Unread" style={{ position: 'static', display: 'inline-block', marginLeft: 8, background: TONE[toneOf(n)].dot }} /> : null}
                  {n.severity === 'critical' || n.severity === 'warning' ? (
                    <span className={`badge ${n.severity === 'critical' ? 'red' : 'amber'}`} style={{ marginLeft: 8 }}>
                      {n.severity === 'critical' ? 'Urgent' : 'Warning'}
                    </span>
                  ) : null}
                </h3>
                {n.message ? <p>{n.message}</p> : null}
                <p>
                  {CATEGORY_LABEL[n.category]} · {n.time}
                  {n.bookingCode || n.bookingId ? ` · Ref ${n.bookingCode || n.bookingId}` : ''}
                </p>
              </div>
            </button>
          ))}
        </section>
      )}
    </>
  );
};
