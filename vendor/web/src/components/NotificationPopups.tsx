import React, { useEffect, useRef, useState } from 'react';
import type { PartnerNotification } from '../notificationTypes';
import { CATEGORY_LABEL } from '../utils/notificationModel';
import { playTone, soundEnabled, unlockSound } from '../utils/notificationSound';
import { formatDateTime12 } from '../utils/time';
import { Badge, Button, type Tone } from '../ui/kit';

/** A notification older than this is history, not news — it never pops up. */
const FRESH_MS = 5 * 60 * 1000;
const MAX_VISIBLE = 3;

interface Props {
  notifications: PartnerNotification[];
  /** Opens the screen a notification points to. */
  onOpen: (n: PartnerNotification) => void;
}

const toneOf = (n: PartnerNotification): Tone => (n.severity === 'critical' ? 'red' : n.severity === 'warning' ? 'amber' : n.severity === 'success' ? 'green' : 'blue');

/**
 * Popups for important new events, with a tone per type: new trip, approval/confirmation, general. Quiet inbox entries and
 * everything that was already there when the app opened never pop up. Critical alerts stay until dismissed.
 */
export const NotificationPopups: React.FC<Props> = ({ notifications, onOpen }) => {
  const seen = useRef<Set<string> | null>(null);
  const [popups, setPopups] = useState<{ key: string; n: PartnerNotification }[]>([]);

  // Browsers keep audio locked until the person interacts once.
  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const fresh = notifications.filter((n) => !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    const now = Date.now();
    const show = fresh.filter((n) => !n.read && n.popup && now - (n.createdAtMs || now) < FRESH_MS);
    if (!show.length) return;
    setPopups((cur) => [...cur, ...show.map((n) => ({ key: `${n.id}-${now}`, n }))].slice(-8));
    const lead = show.find((n) => n.severity === 'critical') ?? show[0];
    if (soundEnabled()) playTone(lead.sound, lead.severity === 'critical' ? 2 : 1);
  }, [notifications]);

  const visible = popups.slice(-MAX_VISIBLE);
  const close = (key: string) => setPopups((cur) => cur.filter((p) => p.key !== key));

  return (
    <div className="vx-popups" aria-live="polite">
      {visible.map((p) => <Card key={p.key} n={p.n} onClose={() => close(p.key)} onAct={() => { close(p.key); onOpen(p.n); }} />)}
    </div>
  );
};

const Card: React.FC<{ n: PartnerNotification; onClose: () => void; onAct: () => void }> = ({ n, onClose, onAct }) => {
  useEffect(() => {
    if (n.severity === 'critical') return undefined;
    const t = setTimeout(onClose, n.severity === 'warning' ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [n.severity, onClose]);
  return (
    <div role={n.severity === 'critical' ? 'alert' : 'status'} className={`vx-popup vx-popup--${toneOf(n)}`}>
      <div className="vx-split vx-split--center" style={{ marginBottom: 4 }}>
        <Badge tone={toneOf(n)}>{n.severity === 'critical' ? 'Critical' : CATEGORY_LABEL[n.category]}</Badge>
        <small className="vx-muted">{n.createdAtMs ? formatDateTime12(new Date(n.createdAtMs)) : 'Just now'}</small>
      </div>
      <strong style={{ display: 'block', fontSize: 14 }}>{n.title}</strong>
      {n.message && <p className="vx-muted" style={{ fontSize: 13, marginTop: 2 }}>{n.message}</p>}
      <div className="vx-actions" style={{ marginTop: 10 }}>
        <Button size="sm" variant="primary" onClick={onAct}>{n.ctaLabel}</Button>
        <Button size="sm" onClick={onClose}>Dismiss</Button>
      </div>
    </div>
  );
};
