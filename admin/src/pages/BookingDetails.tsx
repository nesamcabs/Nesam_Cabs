import DateTime12Input from "../components/DateTime12Input";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db, auth } from "../services/firebase";
import { settleBooking } from "../services/backend";
import { InvoiceActionError, issueInvoiceForBooking } from "../services/invoiceService";
import type { Booking } from "../types";
import FareOverrideModal from "../components/FareOverrideModal";
import FareBreakupView from "../components/FareBreakupView";
import DeliveryLog from "../components/DeliveryLog";
import { Modal, Toast, useToast } from "../components/Feedback";
import { BookingSourceBanner } from "../components/booking/BookingBadges";
import { AssignDriverModal, AssignVendorModal, CancelBookingModal, RecordPaymentModal, RefundModal, RejectDialog, VoidPaymentDialog } from "../components/booking/BookingActions";
import { AssignmentHistory, PaymentsPanel, VehicleVerificationPanel, VerifyCustomerModal, type AssignmentRow, type PaymentRow, type VerificationDoc } from "../components/booking/BookingPanels";
import { AssignOnBehalfDrawer, PublishDutyDrawer, PublishedDutyDrawer } from "../components/booking/DutyDrawers";
import { PricingPanel, ReachedOverrideDialog, SettlementPanel } from "../components/booking/TripMoneyPanels";
import ExtraUsagePanel from "../components/booking/ExtraUsagePanel";
import { useAccess, useCan } from "../components/AccessContext";
import ContactReveal from "../components/booking/ContactReveal";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, Tabs } from "../components/ui";
import { subscribeToCollection, subscribeToDocument } from "../services/adminFirestoreService";
import { acknowledgeUnassignedAlert, approveBooking } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import {
  ISSUE_STATUSES, ISSUE_TYPES, addFollowup, subscribeBookingFollowups, subscribeOwnership, takeOwnership, type Followup, type Ownership,
} from "../services/officeOpsService";
import { subscribeStaffAccounts } from "../services/staffService";
import { paymentOf, tripSubStatusOf, unassignedSeverity } from "../domain/bookingFlow";
import {
  agreedPayoutOf, assignmentDeadline, bookingSourceLabel, customerGroups, fareOf, officeStageOf, officeStatusLabel, refDate, refDateTime, refTime, rupee,
  serviceFamilyOf, suggestedPayoutOf, tripTypeOf,
} from "../domain/officeStage";
import { useOfficeData } from "../hooks/useOfficeData";
import { useNow } from "../hooks/useNow";
import { useOperationsSettings } from "../hooks/useOperationsSettings";
import { bookingPickupDate, formatDateTime12, toDate } from "../utils/time";
import { subscribeBookingById } from "../services/bookingSubscription";

const stamp = (v: unknown) => {
  const d = toDate(v as never);
  return d ? formatDateTime12(d) : null;
};
const mapLink = (lat?: number, lng?: number) => (typeof lat === "number" && typeof lng === "number" ? `https://www.google.com/maps?q=${lat},${lng}` : null);
const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

const TABS = ["Overview", "Trip timeline", "Route & schedule", "Partner & assignment", "Fare & payments", "Activity", "Operations"] as const;
type Tab = (typeof TABS)[number];

type Sheet =
  | "reject" | "assign-driver" | "vendor" | "publish" | "edit-payout" | "published" | "behalf" | "reached" | "cancel" | "no-show" | "pay" | "refund"
  | "fare" | "verify" | "handler" | "issue" | "final" | "mail" | "terms" | "access" | null;

function Facts({ items, cols = 2 }: { items: ReadonlyArray<readonly [string, ReactNode]>; cols?: 1 | 2 | 3 | 4 }) {
  return (
    <dl className="ds-facts" data-cols={cols}>
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v === "" || v === null || v === undefined ? "—" : v}</dd></div>
      ))}
    </dl>
  );
}

function Card({ title, sub, right, children, className = "" }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ds-panel ds-panel-pad ${className}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[17px] font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>{title}</h2>
          {sub && <p className="text-[12px] text-muted mt-1">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function BookingDetails({ bookingId, onBack, onNavigate }: { bookingId: string; onBack: () => void; onNavigate?: (page: string, tab?: string) => void }) {
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [events, setEvents] = useState<{ id: string; type: string; actorRole?: string; at?: unknown; reason?: string; note?: string }[] | null>(null);
  const [verification, setVerification] = useState<VerificationDoc | null | undefined>(undefined);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [owners, setOwners] = useState<Map<string, Ownership>>(new Map());
  const [tab, setTab] = useState<Tab>("Overview");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [voiding, setVoiding] = useState<PaymentRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const { toast, show } = useToast(9000);
  const canFinance = useCan("finance");
  const canOps = useCan("operations");
  // Staff IDs never receive raw customer contacts with the booking; they reveal one booking at a time.
  const contactProtected = useAccess().kind === "staff";
  const now = useNow(30000);
  const ops = useOperationsSettings();
  const data = useOfficeData();

  useEffect(() => {
    setBooking(undefined);
    setLoadError(null);
    const unsubs = [
      subscribeBookingById(bookingId, setBooking, setLoadError),
      subscribeToCollection<PaymentRow>(`bookings/${bookingId}/payment_transactions`, setPayments, (m) => { setPaymentsError(m); setPayments([]); }),
      subscribeToCollection<AssignmentRow>(`bookings/${bookingId}/assignments`, setAssignments, () => setAssignments([])),
      subscribeToCollection<{ id: string; type: string; at?: unknown }>(`bookings/${bookingId}/events`, setEvents, () => setEvents([])),
      subscribeToDocument<VerificationDoc>(`vehicle_verifications/${bookingId}`, setVerification, (m) => { setVerificationError(m); setVerification(null); }),
      subscribeBookingFollowups(bookingId, setFollowups),
      subscribeOwnership(setOwners),
    ];
    return () => unsubs.forEach((u) => u());
  }, [bookingId, retry]);

  const pickup = booking ? bookingPickupDate(booking) : null;
  const sub = booking ? tripSubStatusOf(booking) : "Not Started";
  const market = booking ? data.marketById.get(booking.id) : undefined;
  const stage = booking ? officeStageOf(booking, market) : null;
  const group = useMemo(() => (booking ? customerGroups(data.bookings ?? [booking]).get(booking.id) ?? "Unclassified" : "Unclassified"), [booking, data.bookings]);
  const owner = owners.get(bookingId);

  const steps = useMemo(() => {
    if (!booking) return [];
    const b = booking as Booking & Record<string, unknown>;
    const legacy = (done: boolean, t: unknown) => (t ? formatDateTime12(toDate(t as never)) : done ? "Earlier status · time not recorded" : "Pending");
    const confirmed = !["Pending", "Rejected"].includes(booking.status);
    return [
      { label: "Booking created", done: true, time: legacy(true, b.createdAt) },
      { label: "Booking confirmed", done: confirmed, time: legacy(confirmed, b.approvedAt) },
      { label: "Driver & cab assigned", done: !!booking.assignedDriverId, time: legacy(!!booking.assignedDriverId, b.assignedAt) },
      { label: "Driver reached pickup", done: ["Reached Pickup", "Trip Started", "Trip Ended"].includes(sub), time: legacy(["Reached Pickup", "Trip Started", "Trip Ended"].includes(sub), b.reachedPickupAt), where: mapLink(booking.reachedPickupLocation?.lat, booking.reachedPickupLocation?.lng) },
      { label: "Boarding OTP verified", done: !!b.boardingVerifiedAt, time: b.boardingVerifiedAt ? legacy(true, b.boardingVerifiedAt) : booking.status === "Completed" ? "Not recorded in earlier trip data" : "Pending" },
      { label: "Trip started", done: ["Trip Started", "Trip Ended"].includes(sub), time: legacy(["Trip Started", "Trip Ended"].includes(sub), b.tripStartedAt ?? b.startedAt), where: mapLink(booking.tripStartedLocation?.lat, booking.tripStartedLocation?.lng) },
      { label: "Trip completed", done: booking.status === "Completed", time: legacy(booking.status === "Completed", b.tripEndedAt ?? b.completedAt), where: mapLink(booking.tripEndedLocation?.lat, booking.tripEndedLocation?.lng) },
    ];
  }, [booking, sub]);

  if (booking === undefined && !loadError) return <div className="ds-page-body text-sm text-muted" role="status">Loading booking…</div>;
  if (loadError || !booking) {
    return (
      <div className="ds-page-body">
        <PageHeader eyebrow="BOOKING DETAILS" title={loadError ? "Booking unavailable" : "Booking not found"} subtitle={loadError ?? `The booking “${bookingId}” does not exist or was removed.`} actions={<><Button icon="rotate-ccw" onClick={() => setRetry((n) => n + 1)}>Retry</Button><Button icon="arrow-left" onClick={onBack}>Back to bookings</Button></>} />
      </div>
    );
  }

  const b = booking as Booking & Record<string, unknown>;
  const code = booking.bookingId || booking.id;
  const fare = fareOf(booking);
  const pay = paymentOf(booking);
  const agreed = agreedPayoutOf(booking);
  const payout = agreed || Number(market?.offeredPayout) || suggestedPayoutOf(booking);
  const driver = booking.assignedDriverId ? data.driverById.get(booking.assignedDriverId) : undefined;
  const vendor = booking.assignedVendorId ? data.vendorById.get(booking.assignedVendorId) : undefined;
  const vehicle = booking.assignedVehicleId ? data.vehicleById.get(booking.assignedVehicleId) : undefined;
  const open = ["Approved", "Confirmed", "Assigned"].includes(booking.status);
  const cancellable = ["Approved", "Confirmed", "Assigned", "Ongoing"].includes(booking.status);
  const completed = booking.status === "Completed";
  const severity = unassignedSeverity(booking, pickup?.getTime() ?? null, now.getTime(), { warningHours: ops.warningHours, criticalHours: ops.criticalHours });
  const deadline = assignmentDeadline(booking, ops.warningHours);
  const included = booking.pricing?.includedKm || booking.pricing?.quotedKm || booking.distanceKm;
  const extras = (b.tripExtras ?? {}) as { hillTravel?: boolean; roofCarrier?: boolean; waitingMinutes?: number };
  const passenger = b.passenger as { name: string; phone: string } | undefined;
  const terms = b.dutyTerms as { customerExtraKm?: number; partnerExtraKm?: number; items?: Record<string, string>; receiptRequired?: boolean } | undefined;
  const lastAck = [...followups].filter((f) => f.kind === "driver_ack").sort((x, y) => (y.createdAt?.toMillis?.() ?? 0) - (x.createdAt?.toMillis?.() ?? 0))[0];
  const calls = [...followups].filter((f) => f.kind !== "trip_issue").sort((x, y) => (y.createdAt?.toMillis?.() ?? 0) - (x.createdAt?.toMillis?.() ?? 0));
  const issues = useIssues(followups);
  const changed = (toDate(b.updatedAt as never)?.getTime() ?? 0) > openedAt;
  const revision = Number(b.assignmentChanges ?? 0);
  const headerBadge = booking.status === "Pending" ? "Awaiting confirmation" : booking.status === "Rejected" ? "Rejected" : booking.status === "Cancelled" ? "Cancelled" : "Booking confirmed";
  const progress = booking.status === "Pending" ? "Awaiting booking confirmed"
    : booking.status === "Cancelled" || booking.status === "Rejected" ? `Booking ${booking.status.toLowerCase()}`
    : completed ? "Trip completed"
    : !booking.assignedDriverId ? "Booking confirmed · Driver assignment pending"
    : sub === "Not Started" ? "Awaiting driver reached pickup"
    : sub === "Reached Pickup" ? "Awaiting trip start"
    : "Trip in progress";

  const done = (text: string) => { setSheet(null); setVoiding(null); show(text); };
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); show(ok); } catch (e) { show(e instanceof ActionError || e instanceof Error ? e.message : "The action failed.", "error"); } finally { setBusy(null); }
  };
  const approve = () => run("approve", () => approveBooking(booking.id, ""), "Booking approved. Set fixed payout or bidding, then publish.");
  const issueInvoice = () => run("invoice", () => issueInvoiceForBooking(booking, auth.currentUser?.uid || "").then((r) => show(`Tax invoice ${r.invoiceNumber} issued — see Finance › Invoices.`)), "Invoice issued.").catch(() => undefined);
  const approveTolls = () => run("tolls", async () => { await updateDoc(doc(db, "bookings", booking.id), { tollsApproved: true, updatedAt: serverTimestamp() }); settleBooking(booking.id); }, "Toll receipts approved.");

  const commsCard = (
    <section className="ds-panel ds-panel-pad mt-5 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[220px]">
        <strong className="text-[14px] text-ink">Duty communication</strong>
        <p className="text-[12px] text-muted">Accepted payout, collection and delivery history</p>
      </div>
      <Button icon="mail" onClick={() => setSheet("mail")}>Mail history</Button>
      <Button icon="file-text" onClick={() => setSheet("terms")}>Duty terms</Button>
    </section>
  );

  const timelineCard = (
    <Card title="Trip timeline" sub={<><span className="ds-eyebrow" style={{ display: "block" }}>BOOKING PROGRESS</span>{progress}</>} right={<Button size="sm" variant="ghost" icon="refresh-cw" onClick={() => { setRetry((n) => n + 1); setOpenedAt(Date.now()); }}>Refresh status</Button>}>
      <ol className="ds-timeline">
        {steps.map((s) => (
          <li key={s.label} data-done={s.done ? "true" : undefined}>
            <span aria-hidden="true">{s.done ? <Icon name="check" size={12} /> : null}</span>
            <div>
              <strong>{s.label}</strong>
              <small>{s.time}</small>
              {s.done && s.time !== "Pending" && (s.where ? <a className="ds-link" style={{ fontSize: 11 }} href={s.where} target="_blank" rel="noreferrer">Event details</a> : <button type="button" className="ds-link" style={{ fontSize: 11 }} onClick={() => setTab("Activity")}>Event details</button>)}
            </div>
          </li>
        ))}
        {(booking.status === "Cancelled" || booking.status === "Rejected") && (
          <li data-bad="true"><span aria-hidden="true"><Icon name="x" size={12} /></span><div><strong>{booking.status}</strong><small>{stamp(booking.cancellation?.at ?? booking.cancelledAt) ?? ""} {booking.cancelReason || booking.rejectionReason || booking.cancellation?.reason || ""}</small></div></li>
        )}
      </ol>
    </Card>
  );

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader
        eyebrow="BOOKING DETAILS"
        title={code}
        subtitle={`${booking.pickup} → ${booking.drop}`}
        actions={<><Badge tone={headerBadge === "Booking confirmed" ? "green" : headerBadge === "Awaiting confirmation" ? "amber" : "red"}>{headerBadge}</Badge><Button icon="arrow-left" onClick={onBack}>Back to bookings</Button></>}
      />

      <div className="ds-panel ds-handled">
        <Icon name="user-round" />
        <span>Handled by <strong>{owner?.handlerName ?? "Unassigned"}</strong></span>
        <span className="text-muted">{changed ? "Changed since you opened it" : "Current record"} · revision {revision}</span>
        <Button size="sm" variant="ghost" icon="refresh-cw" onClick={() => { setRetry((n) => n + 1); setOpenedAt(Date.now()); }}>Refresh &amp; review changes</Button>
      </div>

      {(severity === "critical" || severity === "warning") && (
        <div className="ds-alert" data-tone={severity === "critical" ? "bad" : "warn"} role="alert">
          <Icon name="triangle-alert" />
          <span><strong>{severity === "critical" ? "Urgent: " : ""}No driver is assigned</strong> · pickup {pickup ? refDateTime(pickup) : "soon"}.{booking.unassignedAlert?.acknowledgedByName ? ` Acknowledged by ${booking.unassignedAlert.acknowledgedByName}.` : ""}</span>
          {canOps && !booking.unassignedAlert?.acknowledgedBy && <button type="button" className="ds-link ml-auto" onClick={() => run("ack", () => acknowledgeUnassignedAlert(booking.id), "Alert acknowledged.")}>Acknowledge</button>}
        </div>
      )}
      <BookingSourceBanner booking={booking} />

      <Tabs<Tab> label="Booking sections" tabs={TABS.map((t) => ({ id: t, label: t }))} value={tab} onChange={setTab} />

      {tab === "Overview" && (
        <div className="grid gap-5">
          <section className="ds-panel ds-panel-pad">
            <Facts cols={4} items={[
              ["Pickup", pickup ? refDateTime(pickup) : `${booking.date} · ${booking.time}`],
              ["Service / trip type", `${serviceFamilyOf(booking)} · ${tripTypeOf(booking)}`],
              ["Vehicle", `${booking.vehicleCategory || booking.vehicle}${(booking as { fuelType?: string }).fuelType === "cng" ? " (CNG)" : ""}`],
              ["Office stage", officeStatusLabel(booking, market)],
            ]} />
          </section>
          <div className="grid gap-5 lg:grid-cols-2">
            {booking.itinerary && booking.itinerary.length > 2 && <Card title={booking.service === "Multicity" ? "Multicity itinerary" : "Round-trip itinerary"}><ol className="list-decimal list-inside grid gap-2">{booking.itinerary.map((point, index) => <li key={index}><strong>{index === 0 ? "Pickup: " : index === booking.itinerary!.length - 1 ? "Destination: " : `Stop ${index}: `}{point.name}</strong><small className="block text-muted">{point.address}</small></li>)}</ol></Card>}
            <Card title="Customer & passenger" sub={`${booking.customerId ? `NSM-CU-${booking.customerId.slice(0, 6).toUpperCase()}` : "Office booking"} · ${canFinance || canOps ? "Master access" : "Limited access"} · Views logged`} right={<Button size="sm" variant="ghost" icon="shield-check" onClick={() => setSheet("access")}>Access history</Button>}>
              <Facts items={[
                ["Full name", booking.customer || booking.customerName || "Not supplied"],
                ["Mobile", contactProtected ? booking.phoneMasked || "Protected" : booking.phone || booking.customerPhone || "Not supplied"],
                ["WhatsApp", contactProtected ? "Protected" : booking.customerWhatsapp?.e164 || booking.phone || "Not supplied"],
                ["Email", contactProtected ? "Protected" : booking.customerEmail || "Not supplied"],
                ["Full pickup address", booking.pickupAddress || booking.pickup],
                ["Full drop address", booking.dropAddress || booking.drop],
                ...(passenger ? [["Passenger", `${passenger.name} · ${passenger.phone}`] as const] : []),
              ]} />
              {contactProtected && canOps && <ContactReveal booking={booking} />}
              <div className="flex flex-wrap gap-2 mt-4">
                {booking.phone && !contactProtected ? <a className="ds-btn ds-btn-secondary" href={tel(booking.phone)}><Icon name="phone" size={14} />Call customer</a> : <Button icon="phone" disabled>Call customer</Button>}
                {canOps && <Button variant="ghost" icon="badge-check" onClick={() => setSheet("verify")}>{booking.customerVerified ? "Customer verified ✓" : "Verify customer"}</Button>}
              </div>
            </Card>
            <Card title="Booking summary">
              <Facts items={[
                ["Booking source", bookingSourceLabel(booking)],
                ["Customer group", <Badge key="g" tone={group === "New" ? "green" : group === "Returning" ? "amber" : group === "Regular" ? "blue" : "neutral"}>{group}</Badge>],
                ["Customer fare", rupee(fare)],
                ["Vendor payout", rupee(payout ?? null)],
                ["Included km", included ? `${Math.round(Number(included))} km` : "Not recorded"],
                ["Created", refDateTime(b.createdAt as never) || "Not recorded"],
                ["Office approval", booking.status === "Pending" ? "Pending" : booking.approvedByName ? `${booking.approvedByName} · ${refDateTime(booking.approvedAt)}` : "Earlier approved record"],
              ]} />
              {canOps && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {booking.status === "Pending" && <Button variant="primary" loading={busy === "approve"} onClick={approve}>Approve</Button>}
                  {booking.status === "Pending" && <Button variant="ghost" icon="circle-x" onClick={() => setSheet("reject")}>Reject</Button>}
                  {stage === "To publish" && <Button variant="primary" icon="send" onClick={() => setSheet("publish")}>Publish</Button>}
                  {stage === "Published" && <Button icon="radio-tower" onClick={() => setSheet("published")}>Manage published duty</Button>}
                  {cancellable && <Button icon="circle-x" onClick={() => setSheet("cancel")}>Cancel booking</Button>}
                </div>
              )}
            </Card>
          </div>
          {timelineCard}
        </div>
      )}

      {tab === "Trip timeline" && (
        <div className="grid gap-5">
          {timelineCard}
          <Card title="Vehicle verification photos" right={canOps && booking.status === "Assigned" && booking.assignedDriverId && sub === "Not Started" ? <Button size="sm" onClick={() => setSheet("reached")}>Mark pickup reached…</Button> : undefined}>
            <VehicleVerificationPanel doc={verification} error={verificationError} />
          </Card>
        </div>
      )}

      {tab === "Route & schedule" && (
        <Card title="Route & schedule">
          <Facts items={[
            ["Service", serviceFamilyOf(booking)],
            ["Trip type", tripTypeOf(booking)],
            ["Pickup date", pickup ? refDate(pickup) : booking.date],
            ["Pickup time · IST", pickup ? refTime(pickup) : booking.time],
            ["Pickup address", <span key="p">{booking.pickupAddress || booking.pickup}{mapLink(booking.pickupLat, booking.pickupLng) && <> · <a className="ds-link" style={{ fontSize: 11 }} href={mapLink(booking.pickupLat, booking.pickupLng)!} target="_blank" rel="noreferrer">open map</a></>}</span>],
            ["Drop address", <span key="d">{booking.dropAddress || booking.drop}{mapLink(booking.dropLat, booking.dropLng) && <> · <a className="ds-link" style={{ fontSize: 11 }} href={mapLink(booking.dropLat, booking.dropLng)!} target="_blank" rel="noreferrer">open map</a></>}</span>],
            ["Included distance", included ? `${Math.round(Number(included))} km` : "Not recorded"],
            ["Vehicle category", `${booking.vehicleCategory || booking.vehicle}${(booking as { fuelType?: string }).fuelType === "cng" ? " (CNG)" : ""}`],
            ["Required passengers", (b.passengerSeatsRequired as number) ? String(b.passengerSeatsRequired) : "Not recorded"],
            ["Roof carrier", extras.roofCarrier ? "Requested" : "Not requested"],
            ["Hill travel", extras.hillTravel ? "Requested" : "Not requested"],
            ["Expected waiting", extras.waitingMinutes ? `${extras.waitingMinutes} min` : "Not recorded"],
            ["Estimated duration", booking.fareBreakdown?.durationMin ? `${Math.round(booking.fareBreakdown.durationMin)} min` : "Not recorded"],
            ["Trip progress", sub],
          ]} />
          {booking.notes && <p className="ds-note mt-4"><strong>Office notes:</strong> {booking.notes}</p>}
        </Card>
      )}

      {tab === "Partner & assignment" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Partner acceptance">
            <Facts items={[
              ["Accepted by", booking.assignedVendorName || vendor?.companyName || (booking.assignedDriverId && !driver?.vendorId ? booking.assignedDriverName : "") || "Not accepted"],
              ["Role", booking.assignedVendorId ? "Vendor" : booking.assignedDriverId ? "Driver Partner" : "Not allocated"],
              ["Partner / Driver ID", booking.assignedVendorId || driver?.licenseNumber || booking.assignedDriverId || "—"],
              ["Mobile", vendor?.phone || (booking.assignedDriverId && !booking.assignedVendorId ? booking.driverPhone : "") || "Not provided"],
              ["Accepted at", refDateTime((b.acceptedAt ?? b.assignedVendorAt) as never) || (booking.assignedVendorId || booking.assignedDriverId ? "Acceptance time not recorded" : "Not accepted")],
              ["Agreed payout", rupee(agreed || null)],
              ["Source", booking.payoutSource === "bid" ? "Awarded bid" : booking.fulfilmentRoute === "marketplace" ? `${booking.assignedVendorId ? "Vendor" : "Driver Partner"} accepted` : booking.fulfilmentRoute ? "Office allocation" : "—"],
              ["Published", refDateTime(booking.marketplacePublishedAt) || "Not recorded"],
            ]} />
            {canOps && (
              <div className="flex flex-wrap gap-2 mt-4">
                {stage === "To publish" && <><Button variant="primary" icon="send" onClick={() => setSheet("publish")}>Publish</Button><Button icon="building-2" onClick={() => setSheet("vendor")}>Assign vendor</Button><Button icon="user-round-check" onClick={() => setSheet("assign-driver")}>Assign owner driver</Button></>}
                {stage === "Published" && <Button icon="radio-tower" onClick={() => setSheet("published")}>Manage published duty</Button>}
              </div>
            )}
          </Card>
          <Card title="Driver & vehicle">
            <Facts items={[
              ["Assignment", completed ? "Completed" : booking.assignedDriverId ? "Assigned" : stage === "Accepted" ? "Assignment pending" : "Not assigned"],
              ["Driver", booking.assignedDriverName || booking.driver || "Not assigned"],
              ["Driver ID / mobile", booking.assignedDriverId ? `${driver?.licenseNumber || booking.assignedDriverId.slice(0, 10)} · ${booking.driverPhone || driver?.phone || ""}` : "—"],
              ["Vehicle", booking.assignedVehicleNumber ? `${booking.assignedVehicleNumber}${vehicle?.model ? ` · ${vehicle.model}` : ""}` : "Not assigned"],
              ["Car ID", booking.assignedVehicleNumber || "—"],
              ["Final confirmation", refDateTime(b.assignedAt as never) || "—"],
              ["Driver acknowledgement", b.driverAcknowledgedAt ? "Acknowledged" : lastAck ? lastAck.outcome : booking.assignedDriverId ? (sub !== "Not Started" ? "Acknowledged" : "Awaiting acknowledgement") : "—"],
              ["Assignment deadline", booking.assignedDriverId || !deadline ? "—" : `${refDateTime(deadline)}`],
            ]} />
            <div className="flex flex-wrap gap-2 mt-4">
              {canOps && open && booking.assignedVendorId && <Button variant="primary" icon="user-round-check" onClick={() => setSheet("behalf")}>{booking.assignedDriverId ? "Change on behalf" : "Assign on behalf"}</Button>}
              {canOps && open && (booking.assignedDriverId || booking.assignedVendorId) && <Button icon="user-round-x" onClick={() => setSheet("assign-driver")}>Remove allocation</Button>}
              {canOps && open && !booking.assignedVendorId && booking.assignedDriverId && <Button icon="user-round-cog" onClick={() => setSheet("assign-driver")}>Change driver</Button>}
              <Button variant="ghost" icon="user-round" disabled={!booking.assignedDriverId || !onNavigate} onClick={() => onNavigate?.("drivers", `profile:${booking.assignedDriverId}`)}>Driver profile</Button>
              <Button variant="ghost" icon="car-front" disabled={!booking.assignedVehicleId || !onNavigate} onClick={() => onNavigate?.("vehicles", `profile:${booking.assignedVehicleId}`)}>Vehicle profile</Button>
              <Button variant="ghost" icon="route" onClick={() => setTab("Trip timeline")}>Trip timeline</Button>
            </div>
          </Card>
          <Card title="Assignment history" className="lg:col-span-2"><AssignmentHistory rows={assignments} /></Card>
        </div>
      )}

      {tab === "Fare & payments" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Customer fare & payments">
            <Facts items={[
              ["Customer total", rupee(fare)],
              ["Taxable amount", rupee(booking.fareBreakdown?.taxableAmount ?? fare)],
              ["GST", `${Math.round((booking.fareBreakdown?.gstRate ?? 0) * (booking.fareBreakdown?.gstRate && booking.fareBreakdown.gstRate < 1 ? 100 : 1))}% · ${rupee(booking.fareBreakdown?.gst ?? 0)}`],
              ["Received by NESAM", rupee(pay.totalPaid - pay.partnerCashHeld)],
              ["Driver fare collection", pay.partnerCashHeld ? rupee(pay.partnerCashHeld) : completed ? "Not recorded" : "Unverified"],
              ["Balance", rupee(pay.balanceDue)],
              ["Final bill", completed ? (b.finalFare ? `Final fare ${rupee((b.finalFare as { finalFare: number }).finalFare)}` : "Verified & closed") : "After trip completion"],
              ["Payment status", pay.status],
            ]} />
            <div className="flex flex-wrap gap-2 mt-4">
              {canFinance && <Button variant="primary" icon="receipt-indian-rupee" onClick={() => setSheet("pay")}>Record payment</Button>}
              {canFinance && completed && <Button icon="clipboard-check" onClick={() => setSheet("final")}>Verify final bill</Button>}
              {canFinance && completed && <Button icon="files" loading={busy === "invoice"} onClick={issueInvoice}>Generate tax invoice</Button>}
              {canFinance && !["Cancelled", "Rejected"].includes(booking.status) && <Button variant="ghost" icon="pencil" onClick={() => setSheet("fare")}>{booking.fareVerified === true ? "Exceptional fare change…" : "Verify / set fare…"}</Button>}
            </div>
          </Card>
          <Card title="Partner payout & extras">
            <Facts items={[
              ["Vendor payout", rupee(payout ?? null)],
              ["Customer fare / payout difference", payout ? rupee(fare - payout) : "—"],
              ["Toll / parking / state tax", terms?.items?.toll === "Included" ? "Included in the fare" : "Extra at verified actuals"],
              ["Hill / roof carrier", "As recorded in the accepted quote"],
              ["Waiting policy", "Agreed hourly rate · agreed rounding"],
              ["Invoice", booking.invoiceNumber || "Not created"],
              ...(booking.tollCharges ? [["Tolls", `${rupee(booking.tollCharges)} ${booking.tollsApproved ? "(approved)" : "(awaiting approval)"}`] as const] : []),
            ]} />
            {canFinance && booking.tollCharges && !booking.tollsApproved ? <Button className="mt-3" loading={busy === "tolls"} onClick={approveTolls}>Approve toll receipts</Button> : null}
            <p className="text-[11px] text-faint mt-4">Customer fare and vendor payout remain separate. Collections and settlement entries use verified records.</p>
          </Card>
          <Card title="Fare breakup"><FareBreakupView breakup={booking.fareBreakup} total={fare} /></Card>
          <div className="grid gap-5 content-start">
            <PricingPanel booking={booking} />
            <ExtraUsagePanel booking={booking} />
            <SettlementPanel booking={booking} canFinance={canFinance} />
          </div>
          <div className="lg:col-span-2">
            <PaymentsPanel booking={booking} rows={payments} error={paymentsError} canRecord={canFinance} canVoid={canFinance} onRecord={() => setSheet("pay")} onVoid={setVoiding} onRefund={() => setSheet("refund")} />
          </div>
        </div>
      )}

      {tab === "Activity" && (
        <Card title="Booking activity">
          {events === null ? <p className="text-sm text-muted">Loading…</p> : events.length === 0 ? <p className="text-[13px] text-muted">No earlier office activity is supplied for this record. New actions appear here.</p> : (
            <ul className="ds-activity">
              {[...events].sort((x, y) => (toDate(y.at as never)?.getTime() ?? 0) - (toDate(x.at as never)?.getTime() ?? 0)).map((e) => (
                <li key={e.id}>
                  <strong>{e.type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</strong>
                  <span>{e.actorRole ? `${e.actorRole} · ` : ""}{e.reason || e.note || ""}</span>
                  <small>{stamp(e.at) ?? ""}</small>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "Operations" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Handling staff" right={canOps ? <Button size="sm" icon="user-round-check" onClick={() => setSheet("handler")}>Assign handling staff</Button> : undefined}>
            <Facts cols={1} items={[
              ["Responsible staff", owner?.handlerName ?? "Not assigned"],
              ["Next action", owner?.nextAction || "Not recorded"],
              ["Due", owner?.due ? refDateTime(owner.due) : "Not set"],
              ["Handover note", owner?.handoverNote || owner?.reason || "No note"],
            ]} />
          </Card>
          <Card title="Office actions">
            <div className="flex flex-wrap gap-2">
              {open && <Button icon="pencil" onClick={() => setSheet("fare")} disabled={!canFinance}>Amend booking</Button>}
              {open && booking.assignedDriverId && <Button icon="user-round-x" onClick={() => setSheet("no-show")}>Verify no-show</Button>}
              <Button icon="triangle-alert" onClick={() => setSheet("issue")}>Report trip issue</Button>
              {completed && <Button icon="clipboard-check" onClick={() => setSheet("final")} disabled={!canFinance}>Verify final bill</Button>}
            </div>
            <h3 className="text-[13px] font-bold text-ink mt-5 mb-2">Driver acknowledgement</h3>
            <Facts items={[
              ["Assignment", booking.assignedDriverId ? "Driver + vehicle confirmed" : "Pending"],
              ["Driver response", b.driverAcknowledgedAt || sub !== "Not Started" ? "Acknowledged" : booking.assignedDriverId ? "Awaiting acknowledgement" : "—"],
              ["Assigned at", refDateTime(b.assignedAt as never) || "—"],
              ["Last follow-up", lastAck ? `${lastAck.outcome} · ${refDateTime(lastAck.createdAt)}` : "No follow-up"],
            ]} />
            <p className="text-[11px] text-faint mt-2">An office call note does not mark a driver acknowledgement.</p>
          </Card>
          <Card title="Trip issues">
            {issues.length === 0 ? <p className="text-[13px] text-muted">No trip issue recorded.</p> : (
              <DataTable label="Trip issues" minWidth={520} hideTools>
                <thead><tr><th>ISSUE / STATUS</th><th>DETAILS</th><th>HANDLED BY</th></tr></thead>
                <tbody>{issues.map((i) => (
                  <tr key={i.issueId}><td><strong>{i.type}</strong><Badge tone={i.status === "Resolved" ? "green" : "amber"}>{i.status}</Badge></td><td>{i.note}</td><td>{i.by}<small>{refDateTime(i.at as never)}</small></td></tr>
                ))}</tbody>
              </DataTable>
            )}
          </Card>
          <Card title="Change history">
            {(assignments?.length ?? 0) === 0 && !booking.fareOverride ? <p className="text-[13px] text-muted">No booking amendments.</p> : (
              <ul className="ds-activity">
                {booking.fareOverride && <li><strong>Fare changed</strong><span>{rupee(booking.fareOverride.previousFare ?? booking.fareOverride.calculatedFare ?? null)} → {rupee(booking.fareOverride.overriddenFare)} · {booking.fareOverride.reason}</span><small>{booking.fareOverride.byName} · {stamp(booking.fareOverride.at)}</small></li>}
                {(assignments ?? []).map((a) => {
                  const row = a as unknown as { id: string; action?: string; reason?: string; changedByName?: string; at?: unknown };
                  return <li key={row.id}><strong>Assignment {row.action}</strong><span>{row.reason}</span><small>{row.changedByName} · {stamp(row.at)}</small></li>;
                })}
              </ul>
            )}
          </Card>
          <Card title="Office call history" className="lg:col-span-2">
            {calls.length === 0 ? <EmptyState /> : (
              <DataTable label="Office call history" minWidth={720} hideTools>
                <thead><tr><th>DATE · IST</th><th>CONTACT TYPE</th><th>OUTCOME</th><th>STAFF / NOTE</th></tr></thead>
                <tbody>{calls.map((c) => (
                  <tr key={c.id}><td>{refDateTime(c.createdAt) || "Just now"}</td><td>{c.kind === "partner_call" ? `Partner · ${c.partnerName ?? ""}` : c.kind === "driver_ack" ? "Driver acknowledgement" : "Customer"}</td><td><Badge tone="blue">{c.outcome}</Badge></td><td><strong>{c.createdByName}</strong><small>{c.note}</small></td></tr>
                ))}</tbody>
              </DataTable>
            )}
          </Card>
        </div>
      )}

      {commsCard}

      {sheet === "reject" && <RejectDialog booking={booking} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "reached" && <ReachedOverrideDialog booking={booking} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "publish" && <PublishDutyDrawer booking={booking} canSetPayout={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "edit-payout" && <PublishDutyDrawer booking={booking} market={market} edit canSetPayout={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "published" && <PublishedDutyDrawer booking={booking} market={market} onClose={() => setSheet(null)} onEditPayout={() => setSheet("edit-payout")} onAllocate={() => setSheet("behalf")} onDone={done} />}
      {sheet === "behalf" && <AssignOnBehalfDrawer booking={booking} data={data} agreedPayout={payout ?? null} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "vendor" && <AssignVendorModal booking={booking} vendors={data.vendors} canSetPayout={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "assign-driver" && <AssignDriverModal booking={booking} drivers={data.drivers} vehicles={data.vehicles} vendors={data.vendors} onClose={() => setSheet(null)} onDone={done} />}
      {(sheet === "cancel" || sheet === "no-show") && <CancelBookingModal booking={booking} canCharge={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "pay" && <RecordPaymentModal booking={booking} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "refund" && <RefundModal booking={booking} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "verify" && <VerifyCustomerModal booking={booking} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "fare" && <FareOverrideModal booking={booking} onClose={() => setSheet(null)} onDone={(f) => done(`Fare updated to ${rupee(f)}`)} />}
      {voiding && <VoidPaymentDialog booking={booking} paymentId={voiding.id} amountLabel={`${rupee(voiding.amount)} ${voiding.method}`} onClose={() => setVoiding(null)} onDone={done} />}
      {sheet === "handler" && <HandlerSheet bookingId={booking.id} current={owner} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "issue" && <IssueSheet booking={booking} issues={issues} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === "final" && (
        <Modal title="Verify final bill" onClose={() => setSheet(null)} size="lg">
          <Facts cols={3} items={[
            ["Actual km", b.finalFare ? `${(b.finalFare as { totalKm: number }).totalKm} km` : booking.totalKm ? `${booking.totalKm} km` : "Not recorded"],
            ["Extra km", b.finalFare ? `${(b.finalFare as { extraKm: number }).extraKm} km` : "—"],
            ["Waiting min", extras.waitingMinutes ? String(extras.waitingMinutes) : "—"],
            ["Estimate", rupee(fare)],
            ["Final fare", b.finalFare ? rupee((b.finalFare as { finalFare: number }).finalFare) : rupee(fare)],
            ["Direct expenses", rupee(booking.tollCharges ?? 0)],
          ]} />
          <div className="mt-4"><SettlementPanel booking={booking} canFinance={canFinance} /></div>
          <p className="text-[11px] text-faint mt-3">I checked final usage, approved extras, customer fare, payout and collection records before settlement.</p>
        </Modal>
      )}
      {sheet === "mail" && <Modal title="Mail history" onClose={() => setSheet(null)} wide><DeliveryLog bookingId={booking.id} /></Modal>}
      {sheet === "terms" && (
        <Modal title="Duty terms" onClose={() => setSheet(null)}>
          {terms ? (
            <Facts items={[
              ["Customer extra km", `${rupee(terms.customerExtraKm ?? null)} / km`],
              ["Partner extra km", `${rupee(terms.partnerExtraKm ?? null)} / km`],
              ...Object.entries(terms.items ?? {}).map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), v] as const),
              ["Receipts", terms.receiptRequired ? "Receipt required for actual expenses" : "Not required"],
            ]} />
          ) : <p className="text-[13px] text-muted">No duty terms are saved with this booking yet. They are frozen when the duty is published and accepted.</p>}
        </Modal>
      )}
      {sheet === "access" && (
        <Modal title="Access history" onClose={() => setSheet(null)}>
          <Facts items={[["Contact views", String(booking.contactViews ?? 0)], ["Denied requests", String(booking.contactDenials ?? 0)]]} />
          <p className="text-[11px] text-faint mt-3">Every reveal is logged under the staff account that made it. The full log is in Privacy → Access log.</p>
        </Modal>
      )}
    </div>
  );
}

interface Issue { issueId: string; type: string; status: string; note: string; by: string; at?: unknown }

function useIssues(rows: Followup[]): Issue[] {
  const by = new Map<string, Issue>();
  for (const f of [...rows].filter((r) => r.kind === "trip_issue").sort((a, b) => (a.createdAt?.toMillis?.() ?? Date.now()) - (b.createdAt?.toMillis?.() ?? Date.now()))) {
    const id = f.issueId || f.id;
    const prev = by.get(id);
    by.set(id, { issueId: id, type: prev?.type ?? f.partnerName ?? "Other", status: f.outcome, note: f.note || prev?.note || "", by: f.createdByName, at: f.createdAt });
  }
  return [...by.values()].reverse();
}

function HandlerSheet({ bookingId, current, onClose, onDone }: { bookingId: string; current?: Ownership; onClose: () => void; onDone: (t: string) => void }) {
  const self = { uid: auth.currentUser?.uid ?? "", name: auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff" };
  const [staff, setStaff] = useState<{ uid: string; name: string }[]>([self]);
  const [uid, setUid] = useState(current?.handlerUid || self.uid);
  const [next, setNext] = useState(current?.nextAction || "");
  const [due, setDue] = useState("");
  const [note, setNote] = useState(current?.handoverNote || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => subscribeStaffAccounts((l) => setStaff([self, ...l.filter((a) => a.status === "active" && a.role === "admin" && a.uid !== self.uid).map((a) => ({ uid: a.uid, name: a.name || a.email }))]), () => undefined), []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (next.trim().length < 3) return setError("Record the next action.");
    setBusy(true);
    try {
      const handler = staff.find((s) => s.uid === uid) ?? self;
      await takeOwnership(bookingId, note.trim() || next.trim(), { handler, nextAction: next.trim(), due: due ? new Date(due) : null, handoverNote: note.trim() });
      onDone(`${handler.name} now handles this booking.`);
    } catch {
      setError("Handling staff was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Assign handling staff" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="handler-form" loading={busy}>Save handover</Button>}>
      <form id="handler-form" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <label className="ds-field"><span>Responsible staff</span><select className="ds-select" value={uid} onChange={(e) => setUid(e.target.value)}>{staff.map((s) => <option key={s.uid} value={s.uid}>{s.name}</option>)}</select></label>
        <label className="ds-field"><span>Next action</span><input className="ds-input" maxLength={160} value={next} onChange={(e) => setNext(e.target.value)} /></label>
        <label className="ds-field"><span>Due</span><DateTime12Input value={due} onChange={setDue} /></label>
        <label className="ds-field"><span>Handover note</span><textarea className="ds-input" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </form>
    </Modal>
  );
}

function IssueSheet({ booking, issues, onClose, onDone }: { booking: Booking; issues: Issue[]; onClose: () => void; onDone: (t: string) => void }) {
  const openIssue = issues.find((i) => i.status !== "Resolved");
  const [type, setType] = useState<string>(openIssue?.type ?? ISSUE_TYPES[0]);
  const [status, setStatus] = useState<string>(openIssue ? "In progress" : "Open");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 5) return setError(openIssue ? "Record the action taken / resolution." : "Choose the issue and describe it.");
    setBusy(true);
    try {
      await addFollowup({ kind: "trip_issue", bookingId: booking.id, bookingCode: booking.bookingId || booking.id, partnerName: type, outcome: status, note: note.trim(), issueId: openIssue?.issueId ?? `ISS-${Date.now().toString(36).toUpperCase()}` });
      onDone(openIssue ? `Trip issue ${status.toLowerCase()}.` : "Trip issue opened.");
    } catch {
      setError("The trip issue was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal title={openIssue ? "Update trip issue" : "Report trip issue"} onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="issue-form" loading={busy}>{openIssue ? "Save update" : "Open issue"}</Button>}>
      <form id="issue-form" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert">{error}</div>}
        <label className="ds-field"><span>Issue</span><select className="ds-select" value={type} disabled={!!openIssue} onChange={(e) => setType(e.target.value)}>{ISSUE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
        {openIssue && <label className="ds-field"><span>Status</span><select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value)}>{ISSUE_STATUSES.filter((s) => s !== "Open").map((s) => <option key={s}>{s}</option>)}</select></label>}
        <label className="ds-field"><span>{openIssue ? "Action taken / resolution" : "Details"}</span><textarea className="ds-input" rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </form>
    </Modal>
  );
}
