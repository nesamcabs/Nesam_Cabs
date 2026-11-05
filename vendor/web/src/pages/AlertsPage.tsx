import React, { useState } from 'react';
import { usePartner } from '../state/Partner';
import type { NotificationCategory, PartnerNotification, PartnerPenalty } from '../notificationTypes';
import { CATEGORIES, CATEGORY_LABEL } from '../utils/notificationModel';
import { setSoundEnabled, soundEnabled, soundState, unlockSound, playTone } from '../utils/notificationSound';
import { formatDateTime12 } from '../utils/time';
import { Badge, Banner, Button, Empty, Tabs, type Tone } from '../ui/kit';
import { inr } from '../ui/format';
import { PenaltyAckModal } from '../components/PenaltyAckModal';

const sevTone = (n: PartnerNotification): Tone => (n.severity === 'critical' ? 'red' : n.severity === 'warning' ? 'amber' : n.severity === 'success' ? 'green' : 'blue');
const penaltyTone: Record<string, Tone> = { Pending: 'amber', Acknowledged: 'blue', Disputed: 'amber', Paid: 'green', Deducted: 'green', Waived: 'gray' };

export const AlertsPage: React.FC = () => {
  const { notifications, penalties, penaltiesError, actions } = usePartner();
  const [tab, setTab] = useState<'all' | NotificationCategory>('all');
  const [sound, setSound] = useState(soundEnabled);
  const [penalty, setPenalty] = useState<PartnerPenalty | null>(null);
  const [message, setMessage] = useState('');

  const unread = (c: 'all' | NotificationCategory) => notifications.filter((n) => !n.read && (c === 'all' || n.category === c)).length;
  const list = tab === 'all' ? notifications : notifications.filter((n) => n.category === tab);
  const openPenalties = penalties.filter((p) => p.status === 'Pending').length;

  const toggleSound = (on: boolean) => {
    setSoundEnabled(on);
    setSound(on);
    if (on) { unlockSound(); setTimeout(() => playTone('general'), 150); }
  };

  return (
    <div>
      {message && <Banner tone="ok">{message}</Banner>}
      <div className="vx-split vx-split--center" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <label className="vx-check">
          <input type="checkbox" checked={sound} onChange={(e) => toggleSound(e.target.checked)} />
          <span>Play a sound for new alerts{sound && soundState() === 'locked' ? ' (tap anywhere once to enable)' : ''}</span>
        </label>
        {unread('all') > 0 && <Button size="sm" variant="ghost" onClick={() => notifications.filter((n) => !n.read).forEach((n) => actions.markRead(n.id))}>Mark all read</Button>}
      </div>

      <Tabs label="Notification categories" value={tab} onChange={setTab}
        tabs={[{ id: 'all', label: 'All', count: unread('all'), hot: true }, ...CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c], count: c === 'penalties' ? openPenalties + unread(c) : unread(c), hot: true }))]} />

      {tab === 'penalties' && (
        <div className="vx-card" style={{ marginBottom: 14 }}>
          <div className="vx-card__head"><h2 className="vx-card__title">Your penalties</h2></div>
          {penaltiesError && <Banner tone="err">{penaltiesError}</Banner>}
          {!penaltiesError && penalties.length === 0 && <Empty icon="shield" title="You have no penalties" />}
          {penalties.map((p) => (
            <div className="vx-listrow" key={p.id} style={{ alignItems: 'flex-start' }}>
              <div className="vx-listrow__body">
                <strong>{p.category}</strong>
                <small>{p.reason}</small>
                <small>{[p.bookingCode, p.issuedAt ? formatDateTime12(p.issuedAt) : ''].filter(Boolean).join(' · ')}</small>
                {p.description && <small>{p.description}</small>}
                {p.disputeNote && <small><strong>Your dispute:</strong> {p.disputeNote}</small>}
                {p.status === 'Acknowledged' && <div className="vx-actions" style={{ marginTop: 6 }}><Button size="sm" onClick={() => setPenalty(p)}>Dispute this penalty</Button></div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ color: 'var(--red-dark)', fontSize: 16 }}>{inr(p.amount)}</strong>
                <div style={{ marginTop: 4 }}><Badge tone={penaltyTone[p.status] ?? 'gray'}>{p.status}</Badge></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab !== 'penalties' && (
        <div className="vx-card">
          {list.length === 0 ? (
            <Empty icon="bell" title={tab === 'all' ? 'No notifications yet' : `No ${CATEGORY_LABEL[tab].toLowerCase()} notifications`}>New trips, approvals, payments and penalties for your fleet show up here.</Empty>
          ) : (
            list.map((n) => (
              <button key={n.id} type="button" className="vx-listrow" style={{ width: '100%', background: 'transparent', border: 0, textAlign: 'left', borderBottom: '1px solid #F0F2F5', opacity: n.read ? .7 : 1 }}
                onClick={() => !n.read && actions.markRead(n.id)}>
                <span className="vx-avatar vx-avatar--grey" style={{ width: 10, height: 10, borderRadius: 5, background: n.read ? '#D1D5DB' : 'var(--red)' }} aria-hidden="true" />
                <div className="vx-listrow__body">
                  <div className="vx-split"><strong>{n.title}</strong><small style={{ flex: 'none' }}>{n.time}</small></div>
                  <div style={{ margin: '3px 0' }}><Badge tone={sevTone(n)}>{CATEGORY_LABEL[n.category]}</Badge></div>
                  {n.message && <small style={{ color: '#4B5160' }}>{n.message}</small>}
                  {(n.bookingCode || n.bookingId) && <small className="vx-mono">Ref {n.bookingCode || n.bookingId}</small>}
                </div>
              </button>
            ))
          )}
        </div>
      )}

      {penalty && <PenaltyAckModal key={penalty.id} penalty={penalty} onDone={(m) => { setPenalty(null); setMessage(m); setTimeout(() => setMessage(''), 5000); }} onClose={() => setPenalty(null)} />}
    </div>
  );
};
