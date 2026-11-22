import { useState, useEffect } from "react";
import type { NavBadges } from "../hooks/useNavBadges";
import Icon from "./ui/Icon";
import DeskIcon from "./ui/DeskIcons";
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
  /** Opens the Quick fare page. */
  onQuickFare?: () => void;
  onOpenMenu: () => void;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  onSignOut?: () => void;
  badges?: NavBadges;
}

type Sheet = "alerts" | "privacy" | "search" | "profile" | "reminders" | "sounds" | null;

/** Master Admin top bar: live utilities · page controls · search · lock · sign out · privacy · quick fare · new booking · alerts · account. */
export default function Header({ title, onNavigate, onOpen, onCreateBooking, onQuickFare, onOpenMenu, userName, userEmail, userRole, onSignOut, badges }: HeaderProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const access = useAccess();
  const canOps = canAccessPage(access, "bookings");
  const { rows } = useBookingAlerts(canOps);
  const { unread, soundOn } = useNotifications();
  const displayName = userName || userEmail?.split("@")[0] || "Admin";
  const alertCount = (canOps ? rows.length : 0) + unread;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Ctrl/⌘ + K opens the one global search, unless the workspace is locked or another dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (locked || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      setSheet("search");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [locked]);

  const newCount = badges?.newBookings ?? 0;
  const pendingCount = badges?.awaitingAssignment ?? 0;
  const reminderCount = canOps ? rows.length : 0;
  const liveSummary = `${newCount} new booking${newCount === 1 ? "" : "s"} awaiting office review · ${pendingCount} booking${pendingCount === 1 ? "" : "s"} awaiting driver assignment`;
  const cap = (n: number) => (n > 99 ? "99+" : String(n));
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <>
      <header className="ds-header">
        <div className="ds-header-menu flex items-center gap-3 min-w-0">
          <Button className="ds-menu-toggle" variant="secondary" iconOnly icon="menu" aria-label="Open navigation menu" onClick={onOpenMenu} />
        </div>

        {/* Live operations utility group: booking counters · reminders · sound settings */}
        <div className="ds-header-center">
          <div className="ds-utility" role="group" aria-label="Live operations">
            {canOps ? (
              <button
                type="button"
                className="ds-utility-status"
                onClick={() => onNavigate("bookings")}
                title={`${liveSummary}. Open Bookings.`}
                aria-label={`${liveSummary}. Open Bookings.`}
              >
                <DeskIcon name="live-bookings" size={18} />
                <span className="ds-utility-count"><b>{cap(newCount)}</b><span className="ds-live-label">New</span></span>
                <span className="ds-utility-sep" aria-hidden="true" />
                <span className="ds-utility-count" data-tone={pendingCount > 0 ? "alert" : undefined}><b>{cap(pendingCount)}</b><span className="ds-live-label">Pending</span></span>
              </button>
            ) : (
              <span className="ds-utility-status" data-static="true" title="Live status">
                <DeskIcon name="live-bookings" size={18} />
                <span className="ds-live-label">Live status</span>
              </span>
            )}
            {canOps && (
              <button
                type="button"
                className="ds-utility-btn"
                onClick={() => setSheet("reminders")}
                aria-label={`Assignment reminders, ${reminderCount} booking${reminderCount === 1 ? "" : "s"} need${reminderCount === 1 ? "s" : ""} assignment`}
                title={`Assignment reminders · ${reminderCount} booking${reminderCount === 1 ? "" : "s"} need${reminderCount === 1 ? "s" : ""} assignment`}
              >
                <DeskIcon name="reminder" size={18} />
                {reminderCount > 0 && <span className="ds-utility-badge" aria-hidden="true">{cap(reminderCount)}</span>}
              </button>
            )}
            <button
              type="button"
              className="ds-utility-btn"
              data-muted={soundOn ? undefined : "true"}
              onClick={() => setSheet("sounds")}
              aria-label={`Sound settings, notification sound ${soundOn ? "on" : "off"}`}
              title={`Sound settings · notification sound ${soundOn ? "on" : "off"}`}
            >
              <DeskIcon name={soundOn ? "sound-on" : "sound-off"} size={18} />
            </button>
          </div>
        </div>

        {/* Desktop slot for page toolbars (the Dashboard desk controls portal in here). Hidden when empty. */}
        <div id="dashboard-topbar-slot" className="ds-header-slot" role="group" aria-label="Dashboard controls" />

        <div className="ds-header-actions">
          {/* The one global search entry point (bookings, drivers, vendors, customers). */}
          <button
            type="button"
            className="ds-header-search"
            onClick={() => setSheet("search")}
            aria-label="Search all records"
            aria-keyshortcuts="Control+K Meta+K"
            title={`Search bookings, drivers, vendors and customers (${isMac ? "⌘K" : "Ctrl+K"})`}
          >
            <Icon name="search" size={16} />
            <span className="ds-header-search__label"><span className="ds-hdr-wide">Search records…</span><span className="ds-hdr-narrow">Search…</span></span>
            <kbd className="ds-header-search__kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <span className="ds-header-divider" aria-hidden="true" />
          <Button variant="ghost" iconOnly icon="lock" className="ds-header-icon" onClick={() => setLocked(true)} aria-label="Lock workspace" title="Lock workspace" />
          <Button variant="ghost" iconOnly icon="log-out" className="ds-header-icon" onClick={() => onSignOut?.()} aria-label="Sign out" title="Sign out" />
          <Button variant="ghost" iconOnly icon="shield-check" className="ds-header-icon" onClick={() => setSheet("privacy")} aria-label="Customer privacy and access" title="Customer privacy & access" />
          <span className="ds-header-divider" aria-hidden="true" />
          {onQuickFare && (
            <Button variant="primary" icon="calculator" onClick={onQuickFare} aria-label="Quick fare" title="Quick fare · check a fare">
              <span className="ds-btn-label ds-hdr-collapse-md">Quick fare</span>
            </Button>
          )}
          {onCreateBooking && (
            <Button variant="primary" icon="plus" onClick={onCreateBooking}>
              <span className="ds-btn-label">New booking</span>
            </Button>
          )}
          <Button icon="bell" onClick={() => setSheet("alerts")} aria-label={`Alerts, ${alertCount}`} title={`Alerts · ${alertCount}`}>
            <span className="ds-btn-label"><span className="ds-hdr-collapse-lg">Alerts · </span>{cap(alertCount)}</span>
          </Button>
          <Button variant="ghost" icon="user-round" onClick={() => setSheet("profile")} aria-label={`Account, ${displayName}`} title={access.isSuper ? "Super Admin" : displayName}>
            <span className="ds-btn-label ds-hdr-collapse-md">{access.isSuper ? "Super Admin" : displayName}</span>
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
