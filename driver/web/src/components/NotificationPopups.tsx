import React, { useEffect, useRef, useState } from 'react';
import type { DriverNotification } from '../types';
import { CATEGORY_LABEL, TONE, toneOf } from '../utils/notificationModel';
import { playTone, soundEnabled, unlockSound } from '../utils/notificationSound';
import { formatDateTime12 } from '../utils/time';

/** A notification older than this is history, not news — it never pops up. */
const FRESH_MS = 5 * 60 * 1000;
const MAX_VISIBLE = 3;

interface Props {
  notifications: DriverNotification[];
  /** Opens the screen a notification points to. */
  onOpen: (n: DriverNotification) => void;
}

/**
 * Colour-coded popups for important new events, with a tone per type: new trip,
 * approval/confirmation, general. Quiet inbox entries and everything that was
 * already there when the app opened never pop up. Critical alerts stay until dismissed.
 */
export const NotificationPopups: React.FC<Props> = ({ notifications, onOpen }) => {
  const seen = useRef<Set<string> | null>(null);
  const [popups, setPopups] = useState<{ key: string; n: DriverNotification }[]>([]);

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
    <div className="fixed top-20 right-3 left-3 sm:left-auto sm:w-96 z-[55] space-y-2 pointer-events-none" aria-live="polite">
      {visible.map((p) => (
        <Card key={p.key} n={p.n} onClose={() => close(p.key)} onAct={() => { close(p.key); onOpen(p.n); }} />
      ))}
    </div>
  );
};

const Card: React.FC<{ n: DriverNotification; onClose: () => void; onAct: () => void }> = ({ n, onClose, onAct }) => {
  const tone = TONE[toneOf(n)];
  useEffect(() => {
    if (n.severity === 'critical') return undefined;
    const t = setTimeout(onClose, n.severity === 'warning' ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [n.severity, onClose]);
  return (
    <div role={n.severity === 'critical' ? 'alert' : 'status'} className={`pointer-events-auto relative overflow-hidden rounded-xl border shadow-xl ${tone.box}`}>
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${tone.bar}`} />
      <div className="pl-4 pr-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${tone.chip}`}>{n.severity === 'critical' ? 'Critical' : CATEGORY_LABEL[n.category]}</span>
              <span className="text-xs text-gray-700">{n.createdAtMs ? formatDateTime12(new Date(n.createdAtMs)) : 'Just now'}</span>
            </div>
            <p className="text-sm font-bold text-gray-900 leading-snug">{n.title}</p>
          </div>
          <button onClick={onClose} aria-label="Dismiss notification" className="shrink-0 w-8 h-8 rounded-full hover:bg-black/10 text-gray-800 font-bold">✕</button>
        </div>
        <p className="text-sm text-gray-800 mt-1">{n.message}</p>
        {(n.bookingCode || n.bookingId) && <p className="text-xs font-mono text-gray-700 mt-1">Ref {n.bookingCode || n.bookingId}</p>}
        <div className="mt-2.5 flex gap-2">
          <button onClick={onAct} className={`px-3 py-2 rounded-lg text-sm font-semibold text-white ${tone.bar}`}>{n.ctaLabel}</button>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-800 border border-gray-400 bg-white/70">Dismiss</button>
        </div>
      </div>
    </div>
  );
};
