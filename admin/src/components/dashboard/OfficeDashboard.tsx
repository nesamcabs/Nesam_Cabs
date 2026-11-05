import { Fragment, useMemo, useState } from "react";
import type { Booking } from "../../types";
import { approveBooking } from "../../services/bookingOpsService";
import { ActionError } from "../../services/callables";
import type { Enquiry } from "../../services/enquiryService";
import { useOfficeData } from "../../hooks/useOfficeData";
import { useNow } from "../../hooks/useNow";
import { useOperationsSettings } from "../../hooks/useOperationsSettings";
import { ackReminders, bookingAlerts } from "../../domain/officeAlerts";
import { agreedPayoutOf, customerGroups, officeStageOf } from "../../domain/officeStage";
import { latestFollowups } from "../../services/officeOpsService";
import { Toast, useToast } from "../Feedback";
import { Button, DataTable, EmptyState, Icon, PageHeader } from "../ui";
import { Section } from "../ui/ListKit";
import { AcceptedByCell, AssignmentCell, BookingExpand, CustomerCell, DateCell, FareCell, PayoutCell, RouteCell, TripTypeCell, VehicleCell } from "../booking/OfficeCells";
import { AssignOnBehalfDrawer } from "../booking/DutyDrawers";
import { AckRemindersDialog, AlertsDialog, AlertsTable, useOfficeFollowups } from "../shell/AlertDialogs";
import { QuickFareCard, type CategoryEstimate, type QuickTrip } from "../booking/QuickFare";
import { bookingPickupDate } from "../../utils/time";
import { useAccess, useCanDo, useDuty } from "../AccessContext";
import { canAccessPage } from "../../config/permissions";

/**
 * The Master Admin dashboard: urgent assignment issues, driver acknowledgements, the phone-enquiry
 * Quick fare, the booking queues, new bookings to approve and the assignment priority list.
 */
export default function OfficeDashboard({ onNavigate, onSelectBooking, onNewBooking, onProceed, onEnquirySaved }: {
  onNavigate: (page: string, tab?: string) => void;
  onSelectBooking: (id: string) => void;
  onNewBooking: () => void;
  onProceed: (trip: QuickTrip, categoryId: string, estimates: CategoryEstimate[]) => void;
  onEnquirySaved: (e: Enquiry) => void;
}) {
  const data = useOfficeData();
  const now = useNow(30000);
  const ops = useOperationsSettings();
  const { own, followups } = useOfficeFollowups();
  const { toast, show } = useToast(8000);
  const [sheet, setSheet] = useState<"alerts" | "ack" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [assign, setAssign] = useState<Booking | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const all = data.bookings ?? [];
  // The same dashboard serves every booking / dispatch desk; actions show only when this admin holds them.
  const access = useAccess();
  const canOpen = (page: string) => canAccessPage(access, page);
  const canCreate = canOpen("new-booking");
  const approveDuty = useDuty("approve");
  const approveModule = useCanDo("Bookings", "approve");
  const canApprove = approveDuty && approveModule;
  const canAssign = useDuty("assign");

  const alerts = useMemo(() => bookingAlerts(all, data.marketById, now, ops.warningHours), [all, data.marketById, now, ops.warningHours]);
  const urgent = alerts.filter((a) => a.urgent && !own.has(a.b.id));
  const acks = useMemo(() => ackReminders(all, latestFollowups(followups, "driver_ack"), now), [all, followups, now]);
  const groups = useMemo(() => customerGroups(all), [all]);
  const stage = (b: Booking) => officeStageOf(b, data.marketById.get(b.id));
  const byPickup = (a: Booking, z: Booking) => (bookingPickupDate(a)?.getTime() ?? 0) - (bookingPickupDate(z)?.getTime() ?? 0);
  const newBookings = all.filter((b) => stage(b) === "New bookings").sort(byPickup);
  const toPublish = all.filter((b) => stage(b) === "To publish");
  const published = all.filter((b) => stage(b) === "Published");
  const pendingAssign = all.filter((b) => stage(b) === "Accepted" && !b.assignedDriverId);
  const onTrip = all.filter((b) => b.status === "Ongoing");
  const late = (b: Booking) => {
    const p = bookingPickupDate(b);
    return p ? p.getTime() - ops.warningHours * 3600000 < now.getTime() : false;
  };
  const priority = [...pendingAssign].sort((a, z) => Number(late(z)) - Number(late(a)) || byPickup(a, z));

  const approve = async (b: Booking) => {
    setApproving(b.id);
    try {
      await approveBooking(b.id, "");
      show("Booking approved. Set fixed payout or bidding, then publish.");
    } catch (e) {
      show(e instanceof ActionError ? e.message : "The booking was not approved.", "error");
    } finally {
      setApproving(null);
    }
  };

  const queues: { label: string; count: number; icon: Parameters<typeof Icon>[0]["name"]; go: () => void }[] = [
    { label: "New bookings", count: newBookings.length, icon: "calendar-check-2", go: () => onNavigate("bookings", "New bookings") },
    { label: "To publish", count: toPublish.length, icon: "send", go: () => onNavigate("bookings", "To publish") },
    { label: "Published", count: published.length, icon: "radio-tower", go: () => onNavigate("bookings", "Published") },
    { label: "Assignment pending", count: pendingAssign.length, icon: "user-round", go: () => onNavigate("trips", "Unassigned") },
    { label: "On trip", count: onTrip.length, icon: "route", go: () => onNavigate("trips", "On trip") },
  ];
  const gstMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(now);

  const details = (b: Booking) => (
    <Button size="sm" variant="ghost" icon={expanded === b.id ? "chevron-up" : "chevron-down"} aria-expanded={expanded === b.id} onClick={() => setExpanded(expanded === b.id ? null : b.id)}>Details</Button>
  );

  return (
    <>
      <Toast toast={toast} />
      {/* Urgent · Action required */}
      <section className="ds-panel ds-urgent" aria-labelledby="urgent-title">
        <div className="ds-section-head">
          <div>
            <h2 id="urgent-title" className="flex items-center gap-2"><span className="ds-urgent-dot" aria-hidden="true" />Urgent · Action required <span className="ds-tab-count" style={{ background: "var(--color-brand-soft)", color: "var(--color-brand-ink)" }}>{urgent.length}</span></h2>
            <p>Pickup within 2 hours or assignment deadline missed</p>
          </div>
          <Button icon="list-checks" onClick={() => setSheet("alerts")}>View all alerts</Button>
        </div>
        {urgent.length === 0 ? (
          <p className="ds-section-body text-[13px] text-body">No urgent assignment issue. New bookings appear below.</p>
        ) : (
          <div className="ds-section-body"><AlertsTable rows={urgent} own={own} onOpenBooking={onSelectBooking} /></div>
        )}
      </section>

      {/* Driver acknowledgement reminders */}
      {acks.length > 0 && (
        <div className="ds-ack-strip" role="status">
          <Icon name="bell-ring" />
          <strong>{acks.length} driver acknowledgement{acks.length === 1 ? "" : "s"} pending</strong>
          <span>{acks.filter((a) => a.needsFollowUp).length} need follow-up</span>
          <Button variant="ghost" size="sm" icon="arrow-right" onClick={() => setSheet("ack")}>Review reminders</Button>
        </div>
      )}

      <PageHeader title="Dashboard" subtitle="Every booking, publication and assignment in pickup order." actions={canCreate ? <Button variant="primary" icon="plus" onClick={onNewBooking}>New booking</Button> : undefined} />

      {canCreate && <QuickFareCard onProceed={onProceed} onSaved={(e) => { show("Enquiry saved. The fare and terms are retained."); onEnquirySaved(e); }} />}

      <div className="ds-queue-grid">
        {queues.map((q) => (
          <button key={q.label} type="button" className="ds-queue" onClick={q.go}>
            <span><Icon name={q.icon} />{q.label}</span>
            <strong>{q.count}</strong>
            <Icon name="arrow-up-right" />
          </button>
        ))}
      </div>

      <Section title="New bookings" subtitle="Approve after checking the customer, fare and pickup details." actions={<Button variant="ghost" icon="arrow-right" onClick={() => onNavigate("bookings", "New bookings")}>View all</Button>} flush>
        {newBookings.length === 0 ? <EmptyState title="No new bookings" hint="New bookings appear here for office review." /> : (
          <DataTable label="New bookings" minWidth={1092} fixed hasActions>
            <colgroup><col style={{ width: 120 }} /><col style={{ width: 250 }} /><col style={{ width: 100 }} /><col style={{ width: 96 }} /><col style={{ width: 190 }} /><col style={{ width: 126 }} /><col style={{ width: 210 }} /></colgroup>
            <thead><tr><th>PICKUP DATE / TIME</th><th>ROUTE</th><th>TRIP TYPE</th><th>VEHICLE</th><th>CUSTOMER</th><th className="ds-num">CUSTOMER FARE</th><th className="ds-actions">ACTIONS</th></tr></thead>
            <tbody>
              {newBookings.slice(0, 5).map((b) => (
                <Fragment key={b.id}>
                  <tr className="ds-row-stripe" data-tone={groups.get(b.id) === "New" ? "green" : "amber"}>
                    <td><DateCell b={b} /></td><td><RouteCell b={b} /></td><td><TripTypeCell b={b} /></td><td><VehicleCell b={b} data={data} /></td>
                    <td><CustomerCell b={b} group={groups.get(b.id) ?? "Unclassified"} /></td><td><FareCell b={b} /></td>
                    <td className="ds-actions"><div>{details(b)}<Button size="sm" onClick={() => onSelectBooking(b.id)}>Open ↗</Button>{canApprove && <Button size="sm" variant="primary" loading={approving === b.id} onClick={() => approve(b)}>Approve</Button>}</div></td>
                  </tr>
                  {expanded === b.id && <tr className="ds-expand-row"><td colSpan={7}><BookingExpand b={b} data={data} onOpen={() => onSelectBooking(b.id)} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      <Section title="Assignment priority" subtitle="Overdue first, then nearest pickup. Partner acceptance stays recorded." actions={<Button icon="alarm-clock" onClick={() => setSheet("alerts")}>Open reminders</Button>} flush>
        {priority.length === 0 ? <EmptyState title="No assignment pending" hint="Accepted duties waiting for a driver and cab appear here." /> : (
          <DataTable label="Assignment priority" minWidth={1300} fixed hasActions>
            <colgroup><col style={{ width: 120 }} /><col style={{ width: 230 }} /><col style={{ width: 100 }} /><col style={{ width: 96 }} /><col style={{ width: 126 }} /><col style={{ width: 200 }} /><col style={{ width: 190 }} /><col style={{ width: 200 }} /></colgroup>
            <thead><tr><th>PICKUP DATE / TIME</th><th>ROUTE</th><th>TRIP TYPE</th><th>VEHICLE</th><th className="ds-num">VENDOR PAYOUT</th><th>ACCEPTED BY / TIME</th><th>ASSIGNMENT / DEADLINE</th><th className="ds-actions">ACTIONS</th></tr></thead>
            <tbody>
              {priority.slice(0, 8).map((b) => (
                <Fragment key={b.id}>
                  <tr className="ds-row-stripe" data-tone={late(b) ? "red" : "blue"}>
                    <td><DateCell b={b} /></td><td><RouteCell b={b} /></td><td><TripTypeCell b={b} /></td><td><VehicleCell b={b} data={data} /></td>
                    <td><PayoutCell b={b} stage="Accepted" /></td><td><AcceptedByCell b={b} data={data} /></td>
                    <td><AssignmentCell b={b} data={data} deadlineHours={ops.warningHours} now={now} /></td>
                    <td className="ds-actions"><div>{details(b)}<Button size="sm" onClick={() => onSelectBooking(b.id)}>Open ↗</Button>{canAssign && <Button size="sm" variant="primary" onClick={() => setAssign(b)}>Assign</Button>}</div></td>
                  </tr>
                  {expanded === b.id && <tr className="ds-expand-row"><td colSpan={8}><BookingExpand b={b} data={data} onOpen={() => onSelectBooking(b.id)} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      <div className="ds-chip-row">
        <Button icon="send" onClick={() => onNavigate("bookings", "To publish")}>To publish · {toPublish.length}</Button>
        {canOpen("pricing") && <Button icon="sliders-horizontal" onClick={() => onNavigate("pricing")}>Service &amp; Fare Settings</Button>}
        {canOpen("security") && <Button icon="history" onClick={() => onNavigate("security")}>Staff activity</Button>}
        {canOpen("full-final") && <Button icon="copy" onClick={() => onNavigate("full-final")}>F&amp;F records</Button>}
      </div>

      {canOpen("reports") && (
        <div className="ds-panel ds-gst-strip">
          <Icon name="files" />
          <strong>GST · {gstMonth}</strong>
          <span>Review invoices, liability &amp; payment records</span>
          <Button icon="arrow-up-right" onClick={() => onNavigate("reports", "GST Reports")}>Review report</Button>
        </div>
      )}

      {sheet === "alerts" && <AlertsDialog onClose={() => setSheet(null)} onOpenBooking={onSelectBooking} />}
      {sheet === "ack" && <AckRemindersDialog onClose={() => setSheet(null)} onOpenBooking={onSelectBooking} />}
      {assign && <AssignOnBehalfDrawer booking={assign} data={data} agreedPayout={agreedPayoutOf(assign) || null} onClose={() => setAssign(null)} onDone={(t) => { setAssign(null); show(t); }} />}
      {data.bookings === null && <span className="sr-only" role="status">Loading bookings…</span>}
    </>
  );
}
