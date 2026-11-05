import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NotificationRecord } from "../types";
import { subscribeAdminNotifications, markAdminNotificationRead, markAllAdminNotificationsRead, dismissAdminNotification } from "../services/adminNotificationService";
import { CATEGORIES, CATEGORY_LABEL, TONE_CLASSES, categoryOf, createdMs, ctaLabelOf, severityOf, soundOf, targetOf, toneOf, type NotificationCategory } from "../services/notificationModel";
import { playAlert, playTone, setSoundEnabled, soundEnabled, soundState, unlockSound } from "../utils/notificationSound";
import { formatDateTime12 } from "../utils/time";
import Button from "./ui/Button";
import Icon from "./ui/Icon";

interface Ctx {
  notifications: NotificationRecord[];
  loading: boolean;
  unread: number;
  unreadByCategory: Record<NotificationCategory, number>;
  markRead: (n: NotificationRecord) => void;
  markAllRead: (list?: NotificationRecord[]) => void;
  dismiss: (n: NotificationRecord) => void;
  open: (n: NotificationRecord) => void;
  soundOn: boolean;
  setSoundOn: (on: boolean) => void;
  /** "locked" until the user has clicked somewhere on the page once. */
  audio: "ready" | "locked" | "unsupported";
}

const NotificationsContext = createContext<Ctx | null>(null);

export function useNotifications(): Ctx {
  const c = useContext(NotificationsContext);
  if (!c) throw new Error("useNotifications must be used inside NotificationProvider");
  return c;
}

interface Popup {
  key: string;
  n: NotificationRecord;
}

const MAX_VISIBLE = 3;
/** A notification older than this is history, not news — it never pops up. */
const FRESH_MS = 5 * 60 * 1000;

export function NotificationProvider({ onOpen, children }: { onOpen: (page: string, bookingId?: string) => void; children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [soundOn, setSoundOnState] = useState(soundEnabled);
  const [audio, setAudio] = useState(soundState);
  const seen = useRef<Set<string> | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // Browsers keep audio locked until the user interacts once.
  useEffect(() => {
    const unlock = () => {
      unlockSound();
      setTimeout(() => setAudio(soundState()), 150);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    const unsub = subscribeAdminNotifications((list) => {
      setNotifications(list);
      setLoading(false);
      if (seen.current === null) {
        // First delivery is what was already there: no popups or sounds for it.
        seen.current = new Set(list.map((n) => String(n.id)));
        return;
      }
      const fresh = list.filter((n) => !seen.current!.has(String(n.id)));
      for (const n of fresh) seen.current!.add(String(n.id));
      const now = Date.now();
      const show = fresh.filter((n) => !n.read && n.push !== false && now - (createdMs(n) || now) < FRESH_MS);
      if (!show.length) return;
      setPopups((cur) => [...cur, ...show.map((n) => ({ key: `${n.id}-${now}`, n }))].slice(-8));
      // One tone per batch: the most important one.
      const lead = [...show].sort((a, b) => Number(severityOf(b) === "critical") - Number(severityOf(a) === "critical"))[0];
      // Office alert sounds: urgent first, then unassigned reminders, then new bookings / the rest.
      const kind = severityOf(lead) === "critical" ? "Urgent booking" : /unassigned|assignment/i.test(`${lead.title} ${lead.type ?? ""}`) ? "Unassigned booking" : "New booking";
      if (soundOf(lead) === "new_booking" || kind !== "New booking") playAlert(kind);
      else playTone(soundOf(lead), 1);
    });
    return () => unsub();
  }, []);

  const markRead = useCallback((n: NotificationRecord) => void markAdminNotificationRead(n), []);
  const markAllRead = useCallback((list?: NotificationRecord[]) => void markAllAdminNotificationsRead(list ?? notifications), [notifications]);
  const dismiss = useCallback((n: NotificationRecord) => void dismissAdminNotification(n), []);
  const open = useCallback((n: NotificationRecord) => {
    markAdminNotificationRead(n);
    const t = targetOf(n);
    onOpenRef.current(t.page, t.bookingId);
  }, []);
  const setSoundOn = useCallback((on: boolean) => {
    setSoundEnabled(on);
    setSoundOnState(on);
    if (on) {
      unlockSound();
      setTimeout(() => {
        setAudio(soundState());
        playTone("general");
      }, 150);
    }
  }, []);

  const unreadByCategory = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<NotificationCategory, number>;
    for (const n of notifications) if (!n.read) c[categoryOf(n)]++;
    return c;
  }, [notifications]);
  const unread = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  const value: Ctx = { notifications, loading, unread, unreadByCategory, markRead, markAllRead, dismiss, open, soundOn, setSoundOn, audio };
  const visible = popups.slice(-MAX_VISIBLE);
  const close = (key: string) => setPopups((cur) => cur.filter((p) => p.key !== key));

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <div className="fixed bottom-20 right-4 sm:right-6 z-[70] w-[min(24rem,calc(100vw-2rem))] space-y-2 pointer-events-none flex flex-col" aria-live="polite">
        {visible.map((p) => (
          <PopupCard key={p.key} n={p.n} onClose={() => close(p.key)} onAct={() => { close(p.key); open(p.n); }} />
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

function PopupCard({ n, onClose, onAct }: { n: NotificationRecord; onClose: () => void; onAct: () => void }) {
  const sev = severityOf(n);
  const tone = TONE_CLASSES[toneOf(n)];
  // Critical alerts stay until dealt with; everything else clears itself.
  useEffect(() => {
    if (sev === "critical") return;
    const t = setTimeout(onClose, sev === "warning" ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [sev, onClose]);
  const ref = n.bookingCode || n.bookingId;
  return (
    <div role={sev === "critical" ? "alert" : "status"} className="pointer-events-auto relative overflow-hidden rounded-[10px] border border-line bg-white shadow-xl" style={{ borderTop: `3px solid ${sev === "critical" ? "#c1232c" : tone.dot}` }}>
      <div className="px-[18px] py-4">
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: sev === "critical" ? "#b62025" : tone.dot }}>
            <Icon name="bell-ring" size={15} />
            {n.title || (sev === "critical" ? "Critical" : CATEGORY_LABEL[categoryOf(n)])}
          </span>
          <Button variant="ghost" size="sm" iconOnly icon="x" onClick={onClose} aria-label="Dismiss notification" />
        </div>
        <div className="text-[17px] font-bold text-ink-2 leading-snug mt-1">{n.message}</div>
        <p className="text-[11px] text-faint mt-2">{ref ? `${ref} · ` : ""}{CATEGORY_LABEL[categoryOf(n)]} · {formatDateTime12(n.createdAt as never) || "Just now"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" icon="arrow-up-right" onClick={onAct}>{ctaLabelOf(n)}</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Dismiss</Button>
        </div>
      </div>
    </div>
  );
}
