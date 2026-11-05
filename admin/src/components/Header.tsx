import { useState, useEffect } from "react";
import type { NavBadges } from "../hooks/useNavBadges";
import Icon from "./ui/Icon";
import { CATEGORY_LABEL, TONE_CLASSES, categoryOf, ctaLabelOf, toneOf } from "../services/notificationModel";
import { useNotifications } from "./NotificationHost";
import { formatTimeAgo } from "../services/adminNotificationService";
import { useAccess } from "./AccessContext";
import { canAccessPage } from "../config/permissions";
import Button from "./ui/Button";
import { AlertsDialog, useBookingAlerts } from "./shell/AlertDialogs";
import { LockScreen, PrivacyDialog, ProfileDialog, SearchDialog, SoundSettingsDialog } from "./shell/HeaderDialogs";

interface HeaderProps {
  title: string;
  breadcrumb: string[];
  onNavigate: (page: string) => void;
  /** Opens a page or, with a booking id, that booking's details. */
  onOpen: (page: string, bookingId?: string) => void;
  onCreateBooking?: () => void;
  onOpenMenu: () => void;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  onSignOut?: () => void;
  badges?: NavBadges;
}

type Sheet = "alerts" | "privacy" | "search" | "profile" | "reminders" | "sounds" | null;

/** Master Admin top bar: lock · sign out · privacy · search · new booking · alerts · account. */
export default function Header({ title, onNavigate, onOpen, onCreateBooking, onOpenMenu, userName, userEmail, userRole, onSignOut, badges }: HeaderProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const access = useAccess();
  const canOps = canAccessPage(access, "bookings");
  const { rows } = useBookingAlerts(canOps);
  const { unread, soundOn, setSoundOn, audio } = useNotifications();
  const displayName = userName || userEmail?.split("@")[0] || "Admin";
  const roleLabel = (userRole || "Administrator").toUpperCase();
  const alertCount = (canOps ? rows.length : 0) + unread;
  const soundBlocked = audio === "unsupported";

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setNotice(next ? "Sound enabled for this tab. Use Test sound to check the office speaker volume." : "Sound turned off for this tab.");
  };

  return (
    <>
      <header className="ds-header">
        <div className="flex items-center gap-3 min-w-0">
          <Button className="ds-menu-toggle" variant="secondary" iconOnly icon="menu" aria-label="Open navigation menu" onClick={onOpenMenu} />
          <div className="ds-header-title">
            <span>{roleLabel} · DESKTOP</span>
            <strong>{title}</strong>
          </div>
        </div>

        {/* Live operations indicators and quick controls in the header middle */}
        <div className="ds-header-center" role="region" aria-label="Live operations status">
          {canOps ? (
            <button
              type="button"
              className="ds-header-live-pill"
              onClick={() => onNavigate("bookings")}
              title="Click to view Bookings"
              aria-label={`${badges?.newBookings ?? 0} new bookings, ${badges?.awaitingAssignment ?? 0} assignment pending`}
            >
              <Icon name="calendar-clock" />
              <span className="ds-header-live-counts">
                <b>{badges?.newBookings ?? 0}</b> <span className="ds-live-label">new</span>
                <span className="ds-live-dot" aria-hidden="true">·</span>
                <b>{badges?.awaitingAssignment ?? 0}</b> <span className="ds-live-label">pending</span>
              </span>
            </button>
          ) : (
            <div className="ds-header-live-pill" title="Live status">
              <Icon name="calendar-clock" />
              <span>Live status</span>
            </div>
          )}

          <div className="ds-header-live-actions">
            {canOps && (
              <Button
                variant="ghost"
                size="sm"
                icon="alarm-clock"
                className="ds-header-live-btn"
                onClick={() => setSheet("reminders")}
                aria-label="Assignment reminders"
                title="Assignment reminders"
              >
                <span className="ds-live-label">Reminders</span>
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              icon={soundOn ? (audio === "locked" ? "volume-1" : "volume-2") : "volume-x"}
              className={`ds-header-live-btn ${soundOn ? "" : "text-brand"}`}
              onClick={toggleSound}
              aria-pressed={soundOn}
              aria-label={soundOn ? (audio === "locked" ? "Sound on (click page once)" : "Sound on") : "Sound off (enable sound)"}
              title={soundOn ? (audio === "locked" ? "Sound on · click page once" : "Sound on") : "Sound off · click to enable"}
              disabledReason={soundBlocked ? "This browser does not support alert sounds." : undefined}
            >
              <span className="ds-live-label">
                {soundOn ? (audio === "locked" ? "Sound on (click)" : "Sound on") : "Enable sound"}
              </span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              icon="sliders-horizontal"
              className="ds-header-live-btn"
              onClick={() => setSheet("sounds")}
              aria-label="Sound settings"
              title="Sound settings"
            >
              <span className="ds-live-label">Sound settings</span>
            </Button>
          </div>
        </div>

      <div className="ds-header-actions">
        <Button variant="ghost" iconOnly icon="lock" onClick={() => setLocked(true)} aria-label="Lock workspace" title="Lock workspace" />
        <Button variant="ghost" iconOnly icon="log-out" onClick={() => onSignOut?.()} aria-label="Sign out" title="Sign out" />
        <Button iconOnly icon="shield-check" onClick={() => setSheet("privacy")} aria-label="Privacy" title="Customer privacy & access" />
        <Button iconOnly icon="search" onClick={() => setSheet("search")} aria-label="Search records" title="Search records" />
        {onCreateBooking && (
          <Button variant="primary" icon="plus" onClick={onCreateBooking}>
            <span className="ds-btn-label">New booking</span>
          </Button>
        )}
        <Button icon="bell" onClick={() => setSheet("alerts")} aria-label={`Alerts, ${alertCount}`}>
          <span className="ds-btn-label">Alerts · {alertCount > 99 ? "99+" : alertCount}</span>
        </Button>
        <Button variant="ghost" icon="shield-check" onClick={() => setSheet("profile")} aria-label={`Account, ${displayName}`}>
          <span className="ds-btn-label">{access.isSuper ? "Super Admin" : displayName}</span>
        </Button>
      </div>

      {sheet === "alerts" && <AlertsSheet canOps={canOps} onClose={() => setSheet(null)} onOpen={onOpen} onNavigate={onNavigate} />}
      {sheet === "reminders" && <AlertsDialog onClose={() => setSheet(null)} onOpenBooking={(id) => onOpen("booking-detail", id)} />}
      {sheet === "sounds" && <SoundSettingsDialog onClose={() => setSheet(null)} />}
      {sheet === "privacy" && <PrivacyDialog isSuper={access.isSuper} onClose={() => setSheet(null)} />}
      {sheet === "search" && <SearchDialog onClose={() => setSheet(null)} onOpen={onOpen} />}
      {sheet === "profile" && (
        <ProfileDialog access={access} name={displayName} email={userEmail || ""} onClose={() => setSheet(null)} onNavigate={onNavigate} onSignOut={() => onSignOut?.()} />
      )}
      {locked && <LockScreen email={userEmail || ""} onUnlock={() => setLocked(false)} onSignOut={() => onSignOut?.()} />}
      <span className="sr-only">{title}</span>
    </header>
    {notice && (
      <div className="ds-header-notice" role="status">
        <span>{notice}</span>
        <button type="button" className="ds-link" onClick={() => setNotice(null)}>Dismiss</button>
      </div>
    )}
  </>
  );
}

/** Booking alerts & assignment, followed by the latest notifications (kept from the earlier panel). */
function AlertsSheet({ canOps, onClose, onOpen, onNavigate }: { canOps: boolean; onClose: () => void; onOpen: (page: string, bookingId?: string) => void; onNavigate: (page: string) => void }) {
  const { notifications, unread, markAllRead, open } = useNotifications();
  if (!canOps) {
    return (
      <NotificationsOnly onClose={onClose} unread={unread} notifications={notifications} markAllRead={markAllRead} open={open} onNavigate={onNavigate} />
    );
  }
  return (
    <AlertsDialog onClose={onClose} onOpenBooking={(id) => onOpen("booking-detail", id)}>
      <RecentNotifications notifications={notifications} unread={unread} markAllRead={markAllRead} open={(n) => { onClose(); open(n); }} onNavigate={(p) => { onClose(); onNavigate(p); }} />
    </AlertsDialog>
  );
}

type Ctx = ReturnType<typeof useNotifications>;

function RecentNotifications({ notifications, unread, markAllRead, open, onNavigate }: { notifications: Ctx["notifications"]; unread: number; markAllRead: Ctx["markAllRead"]; open: Ctx["open"]; onNavigate: (p: string) => void }) {
  const list = notifications.slice(0, 6);
  if (!list.length) return null;
  return (
    <div className="ds-alerts-notes" role="region" aria-label="Recent notifications">
      <div className="flex items-center justify-between mb-2">
        <strong className="text-[12px] text-ink">Notifications{unread ? ` · ${unread} unread` : ""}</strong>
        <div className="flex gap-3">
          {unread > 0 && <button type="button" className="ds-link" onClick={() => markAllRead()}>Mark all read</button>}
          <button type="button" className="ds-link" onClick={() => onNavigate("notifications")}>Open Communication →</button>
        </div>
      </div>
      <ul className="grid gap-1.5">
        {list.map((n) => {
          const tone = TONE_CLASSES[toneOf(n)];
          return (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className={`w-full text-left px-3 py-2 rounded-md flex gap-2 items-start ${n.read ? "hover:bg-hover" : "bg-brand-soft"}`}>
                <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: n.read ? "#c3ccd8" : tone.dot }} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-semibold text-ink truncate">{n.title}</span>
                  <span className="block text-[11px] text-muted truncate">{CATEGORY_LABEL[categoryOf(n)]} · {n.time || formatTimeAgo(n.createdAt)} · {ctaLabelOf(n)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NotificationsOnly(p: { onClose: () => void; unread: number; notifications: Ctx["notifications"]; markAllRead: Ctx["markAllRead"]; open: Ctx["open"]; onNavigate: (p: string) => void }) {
  return (
    <div className="ds-overlay ds-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className="ds-dialog ds-drawer" role="dialog" aria-modal="true" aria-label="Alerts">
        <div className="ds-dialog-head"><div><span className="ds-dialog-eyebrow">NESAM MASTER CONTROL</span><h2>Alerts</h2></div><Button variant="ghost" iconOnly icon="x" aria-label="Close" onClick={p.onClose} /></div>
        <div className="ds-dialog-body">
          <RecentNotifications notifications={p.notifications} unread={p.unread} markAllRead={p.markAllRead} open={(n) => { p.onClose(); p.open(n); }} onNavigate={(x) => { p.onClose(); p.onNavigate(x); }} />
          {!p.notifications.length && <p className="text-[12px] text-muted">All caught up · No notifications or alerts.</p>}
        </div>
      </div>
    </div>
  );
}
