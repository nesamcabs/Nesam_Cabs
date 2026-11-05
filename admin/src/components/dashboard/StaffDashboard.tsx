import { useEffect, useState, type ReactNode } from "react";
import { canAccessPage, type AdminAccess } from "../../config/permissions";
import type { NavBadges } from "../../hooks/useNavBadges";
import { subscribePayoutRequests, subscribeToCollection } from "../../services/adminFirestoreService";
import { Button, KpiCard, KpiGrid, PageHeader } from "../ui";
import type { IconName } from "../ui/Icon";

/** Desk a preset is built for: decides the order of the sections, never what is shown. */
type Desk = "booking" | "dispatch" | "finance" | "support" | "partners";
const FOCUS: Record<string, Desk[]> = {
  "Booking staff": ["booking", "support", "dispatch", "partners", "finance"],
  Dispatcher: ["dispatch", "booking", "partners", "support", "finance"],
  "Accounts staff": ["finance", "booking", "dispatch", "partners", "support"],
  "Support staff": ["support", "booking", "dispatch", "partners", "finance"],
  Manager: ["dispatch", "booking", "finance", "partners", "support"],
};
const DEFAULT_FOCUS: Desk[] = ["booking", "dispatch", "finance", "partners", "support"];
const DESK_TITLE: Record<Desk, string> = {
  booking: "Booking workload",
  dispatch: "Dispatch & assignment",
  finance: "Finance workload",
  partners: "Partners & fleet",
  support: "Support & communication",
};

interface Tile {
  desk: Desk;
  page: string;
  tab?: string;
  label: string;
  value: number | null;
  note: string;
  icon: IconName;
}

/** Settlement dues and payout requests that still need finance action (only for admins who can open Accounts). */
function useFinanceQueue(enabled: boolean) {
  const [dues, setDues] = useState<{ open: number; overdue: number } | null>(null);
  const [payouts, setPayouts] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const now = () => Date.now();
    const u1 = subscribeToCollection<{ status?: string; dueAt?: { toMillis?: () => number } }>(
      "settlement_dues",
      (rows) => {
        const open = rows.filter((r) => ["Due", "Failed", "On Hold", "Processing"].includes(String(r.status)));
        setDues({ open: open.length, overdue: open.filter((r) => (r.dueAt?.toMillis?.() ?? Infinity) < now()).length });
      },
      () => setDues(null),
    );
    const u2 = subscribePayoutRequests((rows) => setPayouts(rows.filter((r) => r.status === "Pending").length), () => setPayouts(null));
    return () => { u1(); u2(); };
  }, [enabled]);
  return { dues, payouts };
}

/**
 * Dashboard for staff (everyone except the Master account). Built from the signed-in person's
 * effective access, not from the role label: a section appears when the pages behind it can be
 * opened, so a preset never hides something that was granted. Every number is a live count from
 * the same collections the pages read; a count that cannot be loaded shows "—".
 */
export default function StaffDashboard({ access, badges, onNavigate, onNewBooking, workspace }: {
  access: AdminAccess;
  badges?: NavBadges;
  onNavigate: (page: string, tab?: string) => void;
  onNewBooking: () => void;
  /** Booking / dispatch board (or the full overview) when the person can open bookings. */
  workspace: ReactNode;
}) {
  const can = (page: string) => canAccessPage(access, page);
  const finance = useFinanceQueue(can("accounts"));
  const b = badges;
  const count = (v: number | undefined) => (b ? v ?? 0 : null);

  const tiles: Tile[] = [
    { desk: "booking", page: "bookings", tab: "New bookings", label: "New bookings", value: count(b?.newBookings), note: "Waiting for office approval", icon: "calendar-check-2" },
    { desk: "dispatch", page: "trips", tab: "Unassigned", label: "Assignment pending", value: count(b?.awaitingAssignment), note: "Accepted, driver and cab not confirmed", icon: "user-round" },
    { desk: "dispatch", page: "trips", label: "Live trips", value: count(b?.trips), note: "Assigned and on trip", icon: "route" },
    { desk: "dispatch", page: "marketplace", label: "Open marketplace", value: count(b?.marketplace), note: "Published duties without a partner", icon: "radio-tower" },
    { desk: "partners", page: "drivers", label: "Driver reviews", value: count(b?.drivers), note: "Applications and re-uploaded documents", icon: "user-round-check" },
    { desk: "partners", page: "vendors", label: "Vendor applications", value: count(b?.vendors), note: "Waiting for review", icon: "building-2" },
    { desk: "finance", page: "accounts", label: "Settlements open", value: finance.dues?.open ?? null, note: finance.dues ? `${finance.dues.overdue} overdue` : "Partner settlements", icon: "wallet-cards" },
    { desk: "finance", page: "accounts", label: "Payout requests", value: finance.payouts, note: "Requested by partners", icon: "receipt-indian-rupee" },
    { desk: "support", page: "support", label: "Open support tickets", value: count(b?.support), note: "Waiting for a reply", icon: "headset" },
    { desk: "support", page: "notifications", label: "Unread notifications", value: count(b?.notifications), note: "Office alerts", icon: "bell-ring" },
  ].filter((t) => can(t.page)) as Tile[];

  const shortcuts: { page: string; label: string; icon: IconName; tab?: string }[] = [
    { page: "bookings", label: "Bookings", icon: "calendar-check-2" },
    { page: "customers", label: "Customers", icon: "contact-round" },
    { page: "trips", label: "Trips", icon: "route" },
    { page: "partner-requests", label: "Partner requests", icon: "inbox" },
    { page: "vehicles", label: "Vehicles", icon: "car-front" },
    { page: "accounts", label: "Accounts", icon: "wallet-cards" },
    { page: "invoices", label: "Invoices", icon: "files" },
    { page: "reports", label: "Reports & GST", icon: "chart-no-axes-combined" },
    { page: "support", label: "Support", icon: "headset" },
    { page: "notifications", label: "Communication", icon: "radio-tower" },
  ].filter((s) => can(s.page)) as { page: string; label: string; icon: IconName }[];

  const focus = FOCUS[access.roleName] ?? DEFAULT_FOCUS;
  const desks = focus.filter((d) => tiles.some((t) => t.desk === d));

  return (
    <div className="ds-page-body space-y-6">
      <PageHeader
        eyebrow="NESAM OFFICE WORKSPACE"
        title={`${access.roleName} dashboard`}
        subtitle="Your sections and shortcuts follow the access the Master account granted to your Staff ID."
        actions={can("new-booking") ? <Button variant="primary" icon="plus" onClick={onNewBooking}>New booking</Button> : undefined}
      />

      {desks.map((desk) => (
        <section key={desk} aria-label={DESK_TITLE[desk]} className="space-y-3">
          <h2 className="text-[15px] font-bold text-ink">{DESK_TITLE[desk]}</h2>
          <KpiGrid>
            {tiles.filter((t) => t.desk === desk).map((t) => (
              <KpiCard key={t.label} label={t.label} value={t.value ?? "—"} note={t.note} icon={t.icon} onClick={() => onNavigate(t.page, t.tab)} />
            ))}
          </KpiGrid>
        </section>
      ))}

      {shortcuts.length > 0 && (
        <div className="ds-chip-row" aria-label="Shortcuts">
          {shortcuts.map((s) => <Button key={s.page} icon={s.icon} onClick={() => onNavigate(s.page)}>{s.label}</Button>)}
        </div>
      )}

      {workspace}
    </div>
  );
}
