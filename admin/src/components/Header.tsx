import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AlarmClock, Bell, Calculator, CalendarPlus, ChevronDown, ClipboardClock, ListFilter, Lock, LogOut, Menu, Plus, Search, Settings2, ShieldCheck, UserRound, Volume2, VolumeX } from "lucide-react";
import { countAwaitingAssignment, countNewBookings } from "../hooks/useNavBadges";
import { CATEGORY_LABEL, TONE_CLASSES, categoryOf, ctaLabelOf, toneOf } from "../services/notificationModel";
import { useNotifications } from "./NotificationHost";
import { formatTimeAgo } from "../services/adminNotificationService";
import { useAccess } from "./AccessContext";
import { canAccessPage } from "../config/permissions";
import Button from "./ui/Button";
import { AlertsDialog, useBookingAlerts } from "./shell/AlertDialogs";
import { LockScreen, PrivacyDialog, ProfileDialog, SearchDialog, SoundSettingsDialog } from "./shell/HeaderDialogs";
import { SOURCE_CHOICES, useDesk, type DeskId } from "./shell/DeskContext";
import { sourceCounts, type SourceScope } from "../domain/commandDesk";

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
}

type Sheet = "alerts" | "privacy" | "search" | "profile" | "reminders" | "sounds" | null;
type LucideIcon = ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean | "true" }>;

const STROKE = 1.85;
const ICON = "w-[19px] h-[19px] shrink-0";
/*
 * Width tiers, measured on the header's own content width (a container query), so the collapsed / expanded sidebar
 * and the phone drawer are all accounted for. Every tier keeps every control, in the same order:
 *   Alerts · New / Pending / Reminders / Sound · Command / Dispatch Desk · All Sources · (space) · Search records… ·
 *   Quick Fare · New Booking · | · Lock · Logout · Security · Profile
 *   XS  < 740px    phones    rows: menu · alerts · status | desk · source | search · Quick Fare · New Booking · utilities
 *                            (under 520px the utilities take a fourth row, right-aligned)
 *   S   740–1339   tablets, laptops with the sidebar open   2 rows: alerts … source | search … profile
 *   M   1340–1539  one row; short desk names, 176px search, Quick Fare and New Booking labelled
 *   L   ≥ 1540     one row; every label, 220px search with the shortcut hint (profile name from 1680)
 * Controls are 40px tall (36px only on the narrowest phones, under 330px).
 */
const SIZE = "h-10 @max-[330px]:h-9";
const SQUARE = "w-10 @max-[330px]:w-9";
/** Pale slate control surface (the reference's header buttons). */
const PALE = "border border-slate-200/90 bg-slate-50 text-slate-700 hover:bg-white hover:border-slate-300 hover:text-slate-900";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]";
const ICON_BUTTON = `relative inline-grid place-items-center shrink-0 ${SQUARE} ${SIZE} rounded-xl ${PALE} ${FOCUS} transition-colors`;
const INNER_BUTTON = `relative inline-grid place-items-center w-9 h-9 @max-[330px]:w-8 @max-[330px]:h-8 rounded-lg ${FOCUS} transition-colors`;
const CRIMSON = `inline-flex items-center justify-center gap-2 shrink-0 ${SIZE} rounded-xl bg-[var(--color-brand)] text-white text-[13.5px] font-semibold shadow-xs hover:bg-[var(--color-brand-dark)] active:bg-[#8f1a22] ${FOCUS} transition-colors`;
const DESKS: { id: DeskId; label: string }[] = [
  { id: "command", label: "Command Desk" },
  { id: "dispatch", label: "Dispatch Desk" },
];

const cap = (n: number) => (n > 99 ? "99+" : String(n));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A count badge on the corner of its button: shown only for a loaded count above zero. */
function CountBadge({ n }: { n: number }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--color-brand)] text-white text-[10.5px] font-bold leading-[18px] text-center tabular-nums ring-2 ring-white">
      {cap(n)}
    </span>
  );
}

const Divider = ({ className = "" }: { className?: string }) => <span aria-hidden="true" className={`w-px h-5 bg-slate-200 shrink-0 ${className}`} />;

/** "New 3" / "Pending 0": an honest value — "…" while loading, "—" when the bookings could not be read. */
function StatusCount({ icon: Icon, label, value, loading, error, iconClass, description, onClick }: {
  icon: LucideIcon;
  label: string;
  value: number;
  loading: boolean;
  error: string | null;
  iconClass: string;
  description: string;
  onClick: () => void;
}) {
  const shown = error ? "—" : loading ? "…" : cap(value);
  const text = error ? `${label}: bookings could not be loaded (${error}). Open Bookings.` : loading ? `${label}: loading. Open Bookings.` : `${description}. Open Bookings.`;
  return (
    <button type="button" onClick={onClick} title={text} aria-label={text} aria-busy={loading || undefined}
      className={`inline-flex items-center gap-1.5 @max-[330px]:gap-1 h-9 @max-[330px]:h-8 px-1.5 @min-[1540px]:px-2.5 rounded-lg text-slate-700 hover:bg-white hover:text-slate-900 ${FOCUS} transition-colors`}>
      {/* The narrowest phones keep the words and counts; the icons give way first. */}
      <Icon className={`${ICON} ${iconClass} @max-[380px]:hidden`} strokeWidth={STROKE} aria-hidden="true" />
      <span className="text-[13px] font-medium whitespace-nowrap">{label}</span>
      <b className={`text-[13px] font-bold tabular-nums ${error ? "text-amber-700" : "text-slate-900"}`}>{shown}</b>
    </button>
  );
}

/**
 * The one admin header, rendered by the app shell for every page (the same controls, order and size on each route):
 * Alerts · New / Pending / Reminders / Sound · Command / Dispatch Desk · All Sources · Search records · Quick Fare ·
 * New Booking · Lock · Sign out · Security · Profile. Wide screens keep one row; narrower ones wrap in the same order.
 */
export default function Header({ title, onNavigate, onOpen, onCreateBooking, onQuickFare, onOpenMenu, userName, userEmail, userRole, onSignOut }: HeaderProps) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [locked, setLocked] = useState(false);
  const access = useAccess();
  const canOps = canAccessPage(access, "bookings");
  // The same shared store the Bookings screens read (one listener for every consumer).
  const { rows: reminderRows, data } = useBookingAlerts(canOps);
  const { unread, loading: notificationsLoading, soundOn } = useNotifications();
  const desk = useDesk();
  const displayName = userName || userEmail?.split("@")[0] || "Admin";
  const roleName = access.isSuper ? "Super Admin" : userRole || access.roleName || "Staff";
  const profileLabel = access.isSuper ? "Super Admin" : displayName;

  const bookings = data.bookings;
  const bookingsError = data.error;
  const bookingsLoading = canOps && bookings === null && !bookingsError;
  const newCount = bookings ? countNewBookings(bookings) : 0;
  const pendingCount = bookings ? countAwaitingAssignment(bookings) : 0;
  const reminderCount = bookings ? reminderRows.length : 0;
  const counts = useMemo(() => (bookings ? sourceCounts(bookings) : null), [bookings]);
  const sourceLabel = (value: SourceScope, name: string) => {
    if (!counts || !bookings) return name;
    return `${name} (${value === "ALL" ? bookings.length : counts[value]})`;
  };
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

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

  const alertsText = notificationsLoading ? "Alerts, loading notifications" : `Alerts, ${plural(unread, "unread notification")}`;
  const remindersText = bookingsError
    ? "Assignment reminders: bookings could not be loaded"
    : bookingsLoading ? "Assignment reminders: loading" : `Assignment reminders, ${plural(reminderCount, "booking")} need${reminderCount === 1 ? "s" : ""} assignment`;
  const soundText = `Sound ${soundOn ? "on" : "off"} · Open sound settings`;

  return (
    <header className="ds-header sticky top-0 z-[var(--z-header)] bg-white border-b border-[#e9edf2]">
      {/* 72px tall in one row (the shell's --size-header); 2–3 rows on narrower widths, in the same order. */}
      <div className="@container min-h-[calc(var(--size-header)-1px)] flex flex-col justify-center px-3 py-2.5 sm:px-4 lg:px-5">
        {/* Rows meet at the zero-height line breaks below, so 4px + 4px of row gap makes 8px between rows. */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 @max-[330px]:gap-x-1 @min-[1340px]:flex-nowrap">
          {/* Below 1024px the navigation lives in a drawer; its toggle opens the row there. */}
          <button type="button" onClick={onOpenMenu} aria-label="Open navigation menu" title="Menu" className={`${ICON_BUTTON} lg:hidden`}>
            <Menu className={ICON} strokeWidth={STROKE} aria-hidden="true" />
          </button>

          {/* 1 · Alerts: general notifications */}
          <button type="button" onClick={() => setSheet("alerts")} aria-label={alertsText} title={alertsText} aria-haspopup="dialog" aria-busy={notificationsLoading || undefined} className={ICON_BUTTON}>
            <Bell className={ICON} strokeWidth={STROKE} aria-hidden="true" />
            {!notificationsLoading && unread > 0 && <CountBadge n={unread} />}
          </button>

          {/* 2 · Booking status: New · Pending · Reminders · Sound */}
          <div role="group" aria-label="Live bookings" className={`inline-flex items-center shrink-0 ${SIZE} px-0.5 rounded-xl border border-slate-200/90 bg-slate-50`}>
            {canOps && (
              <>
                <StatusCount icon={CalendarPlus} label="New" value={newCount} loading={bookingsLoading} error={bookingsError} iconClass="text-[var(--color-brand)]"
                  description={`${plural(newCount, "new booking")} awaiting office review`} onClick={() => onNavigate("bookings")} />
                <Divider />
                <StatusCount icon={ClipboardClock} label="Pending" value={pendingCount} loading={bookingsLoading} error={bookingsError} iconClass="text-slate-600"
                  description={`${plural(pendingCount, "booking")} awaiting driver assignment`} onClick={() => onNavigate("bookings")} />
                <Divider />
                <button type="button" onClick={() => setSheet("reminders")} aria-label={remindersText} title={remindersText} aria-haspopup="dialog"
                  className={`${INNER_BUTTON} text-slate-700 hover:bg-white hover:text-slate-900`}>
                  <AlarmClock className={ICON} strokeWidth={STROKE} aria-hidden="true" />
                  {!bookingsLoading && !bookingsError && reminderCount > 0 && <CountBadge n={reminderCount} />}
                </button>
                <Divider />
              </>
            )}
            <button type="button" onClick={() => setSheet("sounds")} aria-haspopup="dialog" aria-label={soundText} title={soundText}
              className={`${INNER_BUTTON} hover:bg-white ${soundOn ? "text-slate-700 hover:text-slate-900" : "text-slate-400 hover:text-slate-600"}`}>
              {soundOn ? <Volume2 className={ICON} strokeWidth={STROKE} aria-hidden="true" /> : <VolumeX className={ICON} strokeWidth={STROKE} aria-hidden="true" />}
            </button>
          </div>

          {desk.available && (
            <>
              {/* XS: the desk and source take the second row. */}
              <span aria-hidden="true" className="basis-full h-0 @min-[740px]:hidden" />

              {/* 3 · Command Desk / Dispatch Desk: opens the Dashboard on that desk from any page */}
              <div role="group" aria-label="Dashboard desk" className={`inline-flex items-center shrink-0 ${SIZE} p-1 rounded-xl border border-slate-200/90 bg-slate-100`}>
                {DESKS.map((d) => {
                  const on = desk.desk === d.id;
                  return (
                    <button key={d.id} type="button" aria-pressed={on} onClick={() => desk.selectDesk(d.id)} title={`Open the Dashboard on the ${d.label}`}
                      className={`h-full px-2 @min-[740px]:px-2.5 @min-[1340px]:px-2 @min-[1540px]:px-3 rounded-lg text-[13px] whitespace-nowrap ${FOCUS} transition-colors ${on ? "bg-white text-[var(--color-brand)] font-bold shadow-xs" : "text-slate-500 font-semibold hover:text-slate-800"}`}>
                      {/* Phones and the compact one-row tier show "Command" / "Dispatch"; the full name stays in the accessible name. */}
                      {d.label.replace(" Desk", "")}<span className="@max-[740px]:sr-only @min-[1340px]:@max-[1539px]:sr-only"> Desk</span>
                    </button>
                  );
                })}
              </div>

              {/* 4 · Booking source for the Dashboard: kept while navigating */}
              <label className={`relative inline-flex items-center flex-1 min-w-[112px] max-w-[320px] @min-[1340px]:flex-auto @min-[1340px]:min-w-[160px] @min-[1340px]:max-w-[184px] @min-[1540px]:min-w-[188px] @min-[1540px]:max-w-[220px] ${SIZE} rounded-xl border transition-colors focus-within:border-[var(--color-brand)] focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--color-brand)]/20 ${desk.source !== "ALL" ? "border-[var(--color-brand)]/45 bg-[var(--color-brand-soft)] text-[var(--color-brand)]" : "border-slate-200/90 bg-slate-50 text-slate-700 hover:bg-white hover:border-slate-300"}`}
                title={bookingsError ? `Dashboard booking source (counts unavailable: ${bookingsError})` : `Dashboard booking source: ${sourceLabel(desk.source, SOURCE_CHOICES.find((c) => c.value === desk.source)?.name ?? "All Sources")}`}>
                <ListFilter className="absolute left-3 w-4 h-4 pointer-events-none @max-[380px]:hidden" strokeWidth={STROKE} aria-hidden="true" />
                <select aria-label="Booking source" value={desk.source} onChange={(e) => desk.setSource(e.target.value as SourceScope)}
                  className={`appearance-none w-full h-full min-w-0 pl-9 @max-[380px]:pl-3 pr-8 bg-transparent font-semibold truncate cursor-pointer outline-none ${desk.source !== "ALL" ? "text-[var(--color-brand-dark)]" : "text-slate-800"}`}
                  style={{ fontSize: 13, lineHeight: 1.2 }}>
                  {SOURCE_CHOICES.map((c) => <option key={c.value} value={c.value}>{sourceLabel(c.value, c.name)}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 w-4 h-4 pointer-events-none text-slate-400" strokeWidth={STROKE} aria-hidden="true" />
              </label>
            </>
          )}

          {/* S / XS: the actions start the next row. L / XL: flexible space pushes them to the right edge. */}
          <span aria-hidden="true" className="basis-full h-0 @min-[1340px]:hidden" />
          <span aria-hidden="true" className="hidden @min-[1340px]:block flex-1 min-w-0" />

          {/* 5 · Search records: an input-style trigger for the one global search dialog (Ctrl/⌘ K) */}
          <button type="button" onClick={() => setSheet("search")} aria-label="Search records" aria-keyshortcuts="Control+K Meta+K" aria-haspopup="dialog"
            title={`Search bookings, drivers, vendors and customers (${isMac ? "⌘K" : "Ctrl+K"})`}
            className={`group inline-flex items-center gap-2 ${SIZE} pl-3 pr-2.5 rounded-xl border border-slate-200/90 bg-slate-50 text-left cursor-text
              hover:bg-white hover:border-slate-300 ${FOCUS} focus-visible:bg-white focus-visible:border-[var(--color-brand)] transition-colors
              flex-1 min-w-0 @min-[740px]:min-w-[200px] @min-[1340px]:flex-none @min-[1340px]:min-w-0 @min-[1340px]:w-[176px] @min-[1540px]:w-[220px]`}>
            <Search className="w-[18px] h-[18px] shrink-0 text-slate-400 group-hover:text-slate-500" strokeWidth={STROKE} aria-hidden="true" />
            <span className="flex-1 min-w-0 text-[13px] font-medium text-slate-500 truncate">Search records…</span>
            <kbd className="hidden @min-[1540px]:inline shrink-0 px-1.5 py-0.5 rounded-md border border-slate-200 bg-white text-[10.5px] font-semibold text-slate-400">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>

          {/* 6 · Quick Fare */}
          {onQuickFare && (
            <button type="button" onClick={onQuickFare} aria-label="Quick Fare" title="Quick Fare · check a fare"
              className={`${CRIMSON} ${SQUARE} @min-[740px]:w-auto @min-[740px]:px-4 @min-[1340px]:px-3.5 @min-[1540px]:px-4`}>
              <Calculator className={ICON} strokeWidth={STROKE} aria-hidden="true" />
              <span className="whitespace-nowrap hidden @min-[740px]:inline">Quick Fare</span>
            </button>
          )}

          {/* 7 · New Booking */}
          {onCreateBooking && (
            <button type="button" onClick={onCreateBooking} aria-label="New Booking" title="New Booking"
              className={`${CRIMSON} ${SQUARE} @min-[740px]:w-auto @min-[740px]:px-4`}>
              <Plus className={ICON} strokeWidth={2.1} aria-hidden="true" />
              <span className="whitespace-nowrap hidden @min-[740px]:inline">New Booking</span>
            </button>
          )}

          {/* Narrow phones: the utilities take their own row, right-aligned, still in the same order. */}
          <span aria-hidden="true" className="basis-full h-0 @min-[520px]:hidden" />

          {/* 8–12 · divider · Lock · Logout · Security · Profile (always the last item, at the far right) */}
          <div className="ml-auto inline-flex items-center gap-x-1.5 @max-[330px]:gap-x-1 shrink-0">
            <Divider className="hidden @min-[520px]:block mx-0.5" />
            <button type="button" onClick={() => setLocked(true)} aria-label="Lock workspace" title="Lock workspace" className={ICON_BUTTON}>
              <Lock className={ICON} strokeWidth={STROKE} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onSignOut?.()} aria-label="Sign out" title="Sign out" className={ICON_BUTTON}>
              <LogOut className={ICON} strokeWidth={STROKE} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setSheet("privacy")} aria-label="Customer privacy and access" title="Customer privacy & access" aria-haspopup="dialog" className={ICON_BUTTON}>
              <ShieldCheck className={ICON} strokeWidth={STROKE} aria-hidden="true" />
            </button>
            {/* Signed-in account (name and role in the tooltip and the dialog; the name shows on very wide headers) */}
            <button type="button" onClick={() => setSheet("profile")} aria-label={`Account, ${displayName}, ${roleName}`} title={`${displayName} · ${roleName}`} aria-haspopup="dialog"
              className={`${ICON_BUTTON} @min-[1680px]:w-auto @min-[1680px]:inline-flex @min-[1680px]:gap-2 @min-[1680px]:px-2.5`}>
              <UserRound className={ICON} strokeWidth={STROKE} aria-hidden="true" />
              <span className="text-[13.5px] font-semibold text-slate-800 whitespace-nowrap max-w-[120px] truncate hidden @min-[1680px]:inline">{profileLabel}</span>
            </button>
          </div>
        </div>
      </div>

      {sheet === "alerts" && <NotificationsDrawer onClose={() => setSheet(null)} onNavigate={onNavigate} onSounds={() => setSheet("sounds")} />}
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

/** Alerts: the general notifications (assignment reminders have their own control). Sound settings open from here. */
function NotificationsDrawer({ onClose, onNavigate, onSounds }: { onClose: () => void; onNavigate: (p: string) => void; onSounds: () => void }) {
  const { notifications, unread, loading, markAllRead, open } = useNotifications();
  let body: ReactNode;
  if (loading) body = <p className="text-[12px] text-muted" role="status">Loading notifications…</p>;
  else if (!notifications.length) body = <p className="text-[12px] text-muted">All caught up · No notifications.</p>;
  else body = <RecentNotifications notifications={notifications} unread={unread} markAllRead={markAllRead} open={(n) => { onClose(); open(n); }} onNavigate={(x) => { onClose(); onNavigate(x); }} />;
  return (
    <div className="ds-overlay ds-drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ds-dialog ds-drawer" role="dialog" aria-modal="true" aria-label="Alerts">
        <div className="ds-dialog-head"><div><span className="ds-dialog-eyebrow">NESAM MASTER CONTROL</span><h2>Alerts</h2></div><Button variant="ghost" iconOnly icon="x" aria-label="Close" onClick={onClose} /></div>
        <div className="ds-dialog-body">
          {body}
          <button type="button" onClick={onSounds} className="mt-4 inline-flex items-center gap-2 text-[12px] font-semibold text-[var(--color-brand)] hover:underline">
            <Settings2 className="w-4 h-4" strokeWidth={STROKE} aria-hidden="true" />Notification sounds
          </button>
        </div>
      </div>
    </div>
  );
}
