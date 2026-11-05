import { Fragment, useMemo, useState } from "react";
import type { Booking } from "../types";
import { Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, PageHeader, TableSkeleton } from "../components/ui";
import { ListCaption, Pager, StageBar, usePaging } from "../components/ui/ListKit";
import MenuButton from "../components/ui/MenuButton";
import { AcceptedByCell, AssignmentCell, BookingExpand, DateCell, PayoutCell, RouteCell, TripTypeCell, VehicleCell } from "../components/booking/OfficeCells";
import { AssignOnBehalfDrawer } from "../components/booking/DutyDrawers";
import { AssignDriverModal } from "../components/booking/BookingActions";
import { AlertsDialog } from "../components/shell/AlertDialogs";
import { useOfficeData } from "../hooks/useOfficeData";
import { useNow } from "../hooks/useNow";
import { useOperationsSettings } from "../hooks/useOperationsSettings";
import { agreedPayoutOf, assignmentDeadline } from "../domain/officeStage";
import { bookingPickupDate, isoDateIST } from "../utils/time";
import LiveTrips from "./LiveTrips";

const TRIP_TABS = ["Unassigned", "Assigned", "Deadline missed", "On trip", "Completed"] as const;
type TripTab = (typeof TRIP_TABS)[number];

/** Reference Trips: partner, driver and vehicle tracked independently, by assignment state. */
export default function Trips({ onOpenBooking, initialTab }: { onOpenBooking: (id: string) => void; initialTab?: string }) {
  const [tab, setTab] = useState<TripTab>((TRIP_TABS as readonly string[]).includes(initialTab ?? "") ? (initialTab as TripTab) : "Unassigned");
  const [date, setDate] = useState<"All" | "Today" | "Tomorrow" | "Date range">("All");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ kind: "assign" | "driver"; b: Booking } | { kind: "reminders" } | null>(null);
  const data = useOfficeData();
  const now = useNow(30000);
  const ops = useOperationsSettings();
  const { toast, show } = useToast(8000);
  const all = data.bookings ?? [];

  const tabOf = (b: Booking): TripTab | null => {
    if (b.status === "Completed") return "Completed";
    if (b.status === "Ongoing") return "On trip";
    if (!["Approved", "Confirmed", "Assigned"].includes(b.status)) return null;
    if (b.assignedDriverId) return "Assigned";
    if (!b.assignedVendorId) return null; // still with the office: Bookings → To publish / Published
    const d = assignmentDeadline(b, ops.warningHours);
    return d && d.getTime() < now.getTime() ? "Deadline missed" : "Unassigned";
  };

  const counts = useMemo(() => {
    const c = Object.fromEntries(TRIP_TABS.map((t) => [t, 0])) as Record<TripTab, number>;
    for (const b of all) {
      const t = tabOf(b);
      if (t) c[t]++;
    }
    return c;
  }, [all, now, ops.warningHours]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const today = isoDateIST(now);
    const tomorrow = isoDateIST(new Date(now.getTime() + 86400000));
    const t = (b: Booking) => bookingPickupDate(b)?.getTime() ?? 0;
    return all
      .filter((b) => tabOf(b) === tab)
      .filter((b) => {
        const p = bookingPickupDate(b);
        const day = p ? isoDateIST(p) : "";
        if (date === "Today") return day === today;
        if (date === "Tomorrow") return day === tomorrow;
        if (date === "Date range") return (!from || day >= from) && (!to || day <= to);
        return true;
      })
      .sort((a, b) => (tab === "Completed" ? t(b) - t(a) : t(a) - t(b)));
  }, [all, tab, date, from, to, now, ops.warningHours]); // eslint-disable-line react-hooks/exhaustive-deps

  const paging = usePaging(rows, [tab, date, from, to]);
  const done = (text: string) => { setSheet(null); show(text); };

  const actions = (b: Booking) => (
    <div>
      <Button size="sm" variant="ghost" icon={expanded === b.id ? "chevron-up" : "chevron-down"} aria-expanded={expanded === b.id} onClick={() => setExpanded(expanded === b.id ? null : b.id)}>Details</Button>
      <Button size="sm" onClick={() => onOpenBooking(b.id)} title="Open full booking">Open ↗</Button>
      {(tab === "Unassigned" || tab === "Deadline missed") && <Button size="sm" variant="primary" onClick={() => setSheet({ kind: "assign", b })}>Assign</Button>}
      {tab === "Assigned" && b.assignedVendorId && <Button size="sm" onClick={() => setSheet({ kind: "assign", b })}>Manage</Button>}
      {tab === "Assigned" && <MenuButton iconOnly label={`More actions for ${b.bookingId || b.id}`} items={[{ label: "Change / remove driver", icon: "user-round-cog", onSelect: () => setSheet({ kind: "driver", b }) }]} />}
    </div>
  );

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader title="Trips" subtitle="Partner, driver and vehicle are tracked independently." />
      <StageBar label="Trip status" tabs={TRIP_TABS.map((t) => ({ id: t, label: t, count: counts[t] }))} value={tab} onChange={(t) => { setTab(t); setExpanded(null); }} />
      <div className="ds-filterbar">
        <label className="ds-field">
          <span>Pickup date</span>
          <select className="ds-select" value={date} onChange={(e) => setDate(e.target.value as typeof date)} aria-label="Pickup date">{["All", "Today", "Tomorrow", "Date range"].map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        {date === "Date range" && (
          <>
            <label className="ds-field"><span>From</span><input type="date" className="ds-input" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="ds-field"><span>To</span><input type="date" className="ds-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </>
        )}
      </div>
      <ListCaption count={rows.length} noun="trips" loading={data.bookings === null}>
        <Button variant="ghost" size="sm" icon="alarm-clock" onClick={() => setSheet({ kind: "reminders" })}>Assignment reminders</Button>
      </ListCaption>
      {data.bookings === null ? <div className="ds-panel"><TableSkeleton rows={4} cols={6} /></div> : rows.length === 0 ? (
        <div className="ds-panel">
          <EmptyState title="No bookings in this view" hint="Check your filters or return when a new booking arrives." action={date !== "All" ? <Button size="sm" onClick={() => setDate("All")}>Clear filters</Button> : undefined} />
        </div>
      ) : (
        <DataTable label="Trips table; scroll horizontally for more columns" minWidth={1290} fixed hasActions>
          <colgroup><col style={{ width: 120 }} /><col style={{ width: 230 }} /><col style={{ width: 100 }} /><col style={{ width: 96 }} /><col style={{ width: 126 }} /><col style={{ width: 200 }} /><col style={{ width: 190 }} /><col style={{ width: 228 }} /></colgroup>
          <thead><tr><th>PICKUP DATE / TIME</th><th>ROUTE</th><th>TRIP TYPE</th><th>VEHICLE</th><th className="ds-num">VENDOR PAYOUT</th><th>ACCEPTED BY / TIME</th><th>ASSIGNMENT / DEADLINE</th><th className="ds-actions">ACTIONS</th></tr></thead>
          <tbody>
            {paging.slice.map((b) => (
              <Fragment key={b.id}>
                <tr className="ds-row-stripe" data-tone={tab === "Deadline missed" ? "red" : tab === "Unassigned" ? "amber" : tab === "On trip" ? "blue" : tab === "Assigned" ? "green" : undefined}>
                  <td><DateCell b={b} /></td><td><RouteCell b={b} /></td><td><TripTypeCell b={b} /></td><td><VehicleCell b={b} data={data} /></td>
                  <td><PayoutCell b={b} stage="Accepted" /></td><td><AcceptedByCell b={b} data={data} /></td>
                  <td>{tab === "On trip" ? <Badge tone="blue">On trip</Badge> : tab === "Completed" ? <Badge tone="green">Completed</Badge> : <AssignmentCell b={b} data={data} deadlineHours={ops.warningHours} now={now} />}</td>
                  <td className="ds-actions">{actions(b)}</td>
                </tr>
                {expanded === b.id && <tr className="ds-expand-row"><td colSpan={8}><BookingExpand b={b} data={data} onOpen={() => onOpenBooking(b.id)} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </DataTable>
      )}
      {rows.length > 0 && <Pager paging={paging} tabTotal={counts[tab]} />}

      {tab === "On trip" && (
        <section className="mt-6">
          <h2 className="ds-step-title">Live trip monitor</h2>
          <LiveTrips onOpenBooking={onOpenBooking} />
        </section>
      )}

      {sheet?.kind === "assign" && <AssignOnBehalfDrawer booking={sheet.b} data={data} agreedPayout={agreedPayoutOf(sheet.b) || null} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "driver" && <AssignDriverModal booking={sheet.b} drivers={data.drivers} vehicles={data.vehicles} vendors={data.vendors} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "reminders" && <AlertsDialog onClose={() => setSheet(null)} onOpenBooking={onOpenBooking} />}
    </div>
  );
}
