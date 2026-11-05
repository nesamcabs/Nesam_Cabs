import { Fragment, useEffect, useMemo, useState } from "react";
import type { Booking } from "../types";
import { AdminBookingError, normalizePhone, updateBookingContact, emailError } from "../services/adminBookingService";
import { approveBooking } from "../services/bookingOpsService";
import { ActionError } from "../services/callables";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Field, inputCls } from "../components/FormKit";
import { PaymentBadge, getBookingSource } from "../components/booking/BookingBadges";
import { AssignDriverModal, AssignVendorModal, CancelBookingModal, RejectDialog } from "../components/booking/BookingActions";
import { AcceptedByCell, AssignmentCell, BookingExpand, CustomerCell, DateCell, FareCell, PayoutCell, RouteCell, TripTypeCell, VehicleCell } from "../components/booking/OfficeCells";
import { AssignOnBehalfDrawer, PublishDutyDrawer, PublishedDutyDrawer } from "../components/booking/DutyDrawers";
import Enquiries from "../components/booking/Enquiries";
import { effectiveStatus, subscribeEnquiries, type Enquiry } from "../services/enquiryService";
import { paymentOf } from "../domain/bookingFlow";
import {
  OFFICE_STAGES, TRIP_TABS, agreedPayoutOf, assignmentDeadline, bookingTabOf, customerGroups, fareOf, matchesTripType, officeStageOf, officeStatusLabel, refDate, refTime, tripTabOf, type OfficeStage, type TripTab,
} from "../domain/officeStage";
import { useCan } from "../components/AccessContext";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, TableSkeleton, toneForStatus } from "../components/ui";
import { ListCaption, Pager, StageBar, usePaging } from "../components/ui/ListKit";
import MenuButton, { type MenuItem } from "../components/ui/MenuButton";
import { useNow } from "../hooks/useNow";
import { useOperationsSettings } from "../hooks/useOperationsSettings";
import { useOfficeData } from "../hooks/useOfficeData";
import { bookingPickupDate, formatDate, formatTime12, isoDateIST } from "../utils/time";

type Sort = "earliest" | "latest" | "overdue";
interface Filters {
  search: string;
  date: "All" | "Today" | "Tomorrow" | "Date range";
  from: string;
  to: string;
  type: string;
  group: string;
  // Filters the app had before the Master Admin layout (kept under "More filters").
  category: string;
  payment: string;
  channel: "" | "nesam" | "onewaycarrentals" | "people_taxi";
}
const NO_FILTERS: Filters = { search: "", date: "All", from: "", to: "", type: "All", group: "All", category: "", payment: "", channel: "" };

interface ContactForm { customer: string; phone: string; email: string; notes: string }

type Sheet =
  | { kind: "publish" | "edit-payout" | "published" | "assign" | "reject" | "cancel" | "vendor" | "driver" | "contact"; b: Booking }
  | null;

export default function Bookings({ onSelectBooking, initialTab, onNewBooking, onConvertEnquiry }: {
  onSelectBooking: (id: string) => void;
  initialTab?: string;
  /** Opens the New booking page (Quick fare → estimate → customer → review). */
  onNewBooking: () => void;
  onConvertEnquiry: (e: Enquiry) => void;
}) {
  const [stage, setStage] = useState<OfficeStage>((OFFICE_STAGES as readonly string[]).includes(initialTab ?? "") ? (initialTab as OfficeStage) : "New bookings");
  const [view, setView] = useState<"list" | "enquiries">(initialTab === "Enquiries" ? "enquiries" : "list");
  // Customer quote requests (Multicity and other enquiries) waiting for the travel desk; shown on the
  // Enquiries & quotes button so they are not missed among the bookings.
  const [newEnquiries, setNewEnquiries] = useState(0);
  useEffect(() => subscribeEnquiries((rows) => setNewEnquiries(rows.filter((e) => effectiveStatus(e) === "New").length)), []);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>("earliest");
  const [tripTab, setTripTab] = useState<TripTab>("All trips");
  const [moreFilters, setMoreFilters] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const { toast, show: showToast } = useToast(9000);
  const canFinance = useCan("finance");
  const now = useNow(30000);
  const ops = useOperationsSettings();
  const data = useOfficeData();
  const all = data.bookings ?? [];

  const groups = useMemo(() => customerGroups(all), [all]);
  const stageOf = (b: Booking) => officeStageOf(b, data.marketById.get(b.id));

  const counts = useMemo(() => {
    const c: Record<OfficeStage, number> = { "New bookings": 0, "To publish": 0, Published: 0, Accepted: 0, Ongoing: 0, Completed: 0, Cancelled: 0, "All bookings": all.length };
    for (const b of all) c[bookingTabOf(b, data.marketById.get(b.id))]++;
    return c;
  }, [all, data.marketById]);

  const categoriesInUse = useMemo(() => Array.from(new Set(all.map((b) => b.vehicleCategory || b.vehicle).filter(Boolean))).sort(), [all]);

  const inStage = useMemo(() => all.filter((b) => stage === "All bookings" || bookingTabOf(b, data.marketById.get(b.id)) === stage), [all, stage, data.marketById]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const today = isoDateIST(now);
    const tomorrow = isoDateIST(new Date(now.getTime() + 86400000));
    const rows = inStage.filter((b) => {
      if (q) {
        const hay = [b.id, b.bookingId, b.customer, b.phone, b.customerPhone, b.pickup, b.drop].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const p = bookingPickupDate(b);
      const day = p ? isoDateIST(p) : "";
      if (f.date === "Today" && day !== today) return false;
      if (f.date === "Tomorrow" && day !== tomorrow) return false;
      if (f.date === "Date range" && ((f.from && day < f.from) || (f.to && day > f.to))) return false;
      if (!matchesTripType(b, f.type)) return false;
      if (tripTab !== "All trips" && tripTabOf(b) !== tripTab) return false;
      if (f.group !== "All" && groups.get(b.id) !== f.group) return false;
      if (f.category && (b.vehicleCategory || b.vehicle) !== f.category) return false;
      if (f.payment && paymentOf(b).status !== f.payment) return false;
      if (f.channel && getBookingSource(b) !== f.channel) return false;
      return true;
    });
    const t = (b: Booking) => bookingPickupDate(b)?.getTime() ?? 0;
    if (sort === "overdue") {
      const late = (b: Booking) => (!b.assignedDriverId && (assignmentDeadline(b, ops.warningHours)?.getTime() ?? Infinity) < now.getTime() ? 0 : 1);
      return rows.sort((a, b) => late(a) - late(b) || t(a) - t(b));
    }
    return rows.sort((a, b) => (sort === "latest" ? t(b) - t(a) : t(a) - t(b)));
  }, [inStage, f, sort, tripTab, groups, now, ops.warningHours]);

  const tripCounts = useMemo(() => {
    const c: Record<TripTab, number> = { "All trips": inStage.length, "One Way": 0, "Round Trip": 0, "Local Rental": 0, Multicity: 0, "Airport Taxi": 0 };
    for (const b of inStage) c[tripTabOf(b)]++;
    return c;
  }, [inStage]);

  const paging = usePaging(filtered, [stage, f, sort, tripTab]);
  const filtersActive = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  const hiddenActive = Boolean(f.category || f.payment || f.channel);

  const done = (text: string) => {
    setSheet(null);
    showToast(text);
  };

  const approve = async (b: Booking) => {
    setApprovingId(b.id);
    try {
      await approveBooking(b.id, "");
      setStage("To publish");
      showToast("Booking approved. Set fixed payout or bidding, then publish.");
    } catch (e) {
      showToast(e instanceof ActionError ? e.message : "The booking was not approved.", "error");
    } finally {
      setApprovingId(null);
    }
  };

  const exportCsv = () => {
    const headers = ["Booking ID", "Stage", "Pickup date", "Pickup time", "Pickup", "Drop", "Trip type", "Vehicle", "Customer", "Mobile", "Customer group", "Customer fare", "Vendor payout", "Payment status"];
    const rows = filtered.map((b) => {
      const p = bookingPickupDate(b);
      return [b.bookingId || b.id, officeStatusLabel(b, data.marketById.get(b.id)), p ? formatDate(p) : b.date, p ? formatTime12(p) : b.time, b.pickup, b.drop, b.service, b.vehicleCategory || b.vehicle, b.customer, b.phone || "", groups.get(b.id) ?? "", fareOf(b), agreedPayoutOf(b) || "", paymentOf(b).status];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookings_${stage.replace(/\s+/g, "_").toLowerCase()}_${isoDateIST(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (view === "enquiries") {
    return (
      <div className="ds-page-body">
        <Enquiries
          stageCounts={counts}
          onStage={(s) => { setStage(s); setView("list"); }}
          onBack={() => setView("list")}
          onNewBooking={onNewBooking}
          onConvert={onConvertEnquiry}
        />
      </div>
    );
  }

  const columns = columnsFor(stage);
  const moreFor = (b: Booking): MenuItem[] => {
    const items: MenuItem[] = [];
    const s = stageOf(b);
    if (s === "New bookings") items.push({ label: "Reject", icon: "circle-x", danger: true, onSelect: () => setSheet({ kind: "reject", b }) });
    if (s === "To publish") {
      items.push({ label: "Assign vendor", icon: "building-2", onSelect: () => setSheet({ kind: "vendor", b }) });
      items.push({ label: "Assign owner driver", icon: "user-round-check", onSelect: () => setSheet({ kind: "driver", b }) });
    }
    if (s === "Accepted" && b.assignedDriverId) items.push({ label: "Change / remove driver", icon: "user-round-cog", onSelect: () => setSheet({ kind: "driver", b }) });
    if (["Approved", "Confirmed", "Assigned"].includes(b.status)) items.push({ label: "Cancel booking", icon: "ban", danger: true, onSelect: () => setSheet({ kind: "cancel", b }) });
    if (b.status !== "Completed" && b.status !== "Cancelled" && b.status !== "Rejected") items.push({ label: "Edit contact", icon: "pencil", onSelect: () => setSheet({ kind: "contact", b }) });
    return items;
  };

  const primaryAction = (b: Booking) => {
    const s = stageOf(b);
    if (s === "New bookings") return <Button size="sm" variant="primary" loading={approvingId === b.id} onClick={() => approve(b)}>Approve</Button>;
    if (s === "To publish") return <Button size="sm" variant="primary" onClick={() => setSheet({ kind: "publish", b })}>Publish</Button>;
    if (s === "Published") return <Button size="sm" onClick={() => setSheet({ kind: "published", b })}>Manage</Button>;
    if (s === "Accepted" && b.assignedVendorId) return <Button size="sm" variant={b.assignedDriverId ? "secondary" : "primary"} onClick={() => setSheet({ kind: "assign", b })}>{b.assignedDriverId ? "Manage" : "Assign"}</Button>;
    return null;
  };

  const actions = (b: Booking) => {
    const more = moreFor(b);
    return (
      <div>
        <Button size="sm" variant="ghost" icon={expanded === b.id ? "chevron-up" : "chevron-down"} aria-expanded={expanded === b.id} onClick={() => setExpanded(expanded === b.id ? null : b.id)}>Details</Button>
        <Button size="sm" onClick={() => onSelectBooking(b.id)} aria-label="Open full booking" title="Open full booking">Open ↗</Button>
        {primaryAction(b)}
        {more.length > 0 && <MenuButton iconOnly label={`More actions for booking ${b.bookingId || b.id}`} items={more} />}
      </div>
    );
  };

  const cell = (col: Col, b: Booking) => {
    const group = groups.get(b.id) ?? "Unclassified";
    switch (col) {
      case "date": return <DateCell b={b} />;
      case "route": return <RouteCell b={b} />;
      case "type": return <TripTypeCell b={b} />;
      case "vehicle": return <VehicleCell b={b} data={data} />;
      case "customer": return <CustomerCell b={b} group={group} />;
      case "fare": return <FareCell b={b} />;
      case "payout": return <PayoutCell b={b} market={data.marketById.get(b.id)} stage={stageOf(b) ?? ""} />;
      case "accepted": return <AcceptedByCell b={b} data={data} />;
      case "assignment": return <AssignmentCell b={b} data={data} deadlineHours={ops.warningHours} now={now} />;
      case "status": {
        const label = officeStatusLabel(b, data.marketById.get(b.id));
        return <><Badge tone={toneForStatus(label)}>{label}</Badge>{b.status === "Completed" && <div className="mt-1"><PaymentBadge status={paymentOf(b).status} /></div>}</>;
      }
    }
  };

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {data.error && <ErrorBanner message={data.error} />}

      <PageHeader
        title="Bookings"
        subtitle="Office review, publication and assignment — one history."
        actions={
          <>
            <Button variant="ghost" icon="download" onClick={exportCsv} disabledReason={filtered.length === 0 ? "No bookings in this view to export." : undefined}>Export</Button>
            <Button variant="primary" icon="plus" onClick={onNewBooking}>New booking</Button>
          </>
        }
      />

      <StageBar
        label="Booking status"
        tabs={OFFICE_STAGES.map((s) => ({ id: s, label: s, count: counts[s] }))}
        value={stage}
        onChange={(s) => { setStage(s); setExpanded(null); if (s !== "Accepted" && sort === "overdue") setSort("earliest"); }}
        aside={
          <Button variant={newEnquiries ? "secondary" : "ghost"} size="sm" icon="phone-forwarded" onClick={() => setView("enquiries")} aria-label={newEnquiries ? `Enquiries and quotes, ${newEnquiries} new` : undefined}>
            Enquiries &amp; quotes{newEnquiries ? <Badge tone="red">{newEnquiries} new</Badge> : null}
          </Button>
        }
      />

      <StageBar
        label="Trip type"
        tabs={TRIP_TABS.map((t) => ({ id: t, label: t, count: tripCounts[t] }))}
        value={tripTab}
        onChange={(t) => { setTripTab(t); setExpanded(null); }}
      />

      <div className="ds-filterbar" role="search">
        <div className="ds-search" style={{ flex: "1 1 320px" }}>
          <Icon name="search" />
          <input type="search" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} placeholder="Booking ID, route, customer or mobile" aria-label="Search bookings" className="ds-input" />
        </div>
        <label className="ds-field">
          <span>Pickup date</span>
          <select value={f.date} onChange={(e) => setF({ ...f, date: e.target.value as Filters["date"] })} className="ds-select" aria-label="Pickup date">
            {["All", "Today", "Tomorrow", "Date range"].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label className="ds-field">
          <span>Customer group</span>
          <select value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} className="ds-select" aria-label="Customer group">
            {["All", "New", "Returning", "Regular", "Unclassified"].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <Button variant="ghost" icon="list-filter" onClick={() => setMoreFilters((v) => !v)} aria-expanded={moreFilters || hiddenActive}>{moreFilters || hiddenActive ? "Fewer filters" : "More filters"}</Button>
        <Button variant="ghost" icon="rotate-ccw" onClick={() => setF(NO_FILTERS)} disabled={!filtersActive}>Clear</Button>
        {f.date === "Date range" && (
          <div className="ds-filterbar" style={{ flexBasis: "100%", marginBottom: 0 }}>
            <label className="ds-field"><span>From</span><input type="date" className="ds-input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
            <label className="ds-field"><span>To</span><input type="date" className="ds-input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          </div>
        )}
        {(moreFilters || hiddenActive) && (
          <div className="ds-filterbar" style={{ flexBasis: "100%", marginBottom: 0 }}>
            <label className="ds-field"><span>Vehicle</span><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="ds-select"><option value="">All categories</option>{categoriesInUse.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="ds-field"><span>Payment</span><select value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} className="ds-select"><option value="">All statuses</option>{["Unpaid", "Partially Paid", "Paid", "Refund Pending", "Refunded"].map((s) => <option key={s}>{s}</option>)}</select></label>
            <label className="ds-field"><span>Website / portal</span><select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as Filters["channel"] })} className="ds-select"><option value="">All portals</option><option value="nesam">Nesam Travels</option><option value="onewaycarrentals">One Way Car Rentals</option><option value="people_taxi">People Taxi</option></select></label>
          </div>
        )}
      </div>

      <ListCaption<Sort>
        count={filtered.length}
        loading={data.bookings === null && !data.error}
        sort={sort}
        onSort={setSort}
        sortOptions={stage === "Accepted" ? [["earliest", "Pickup earliest"], ["latest", "Pickup latest"], ["overdue", "Overdue first"]] : [["earliest", "Pickup earliest"], ["latest", "Pickup latest"]]}
      />

      {data.bookings === null && !data.error && <div className="ds-panel"><TableSkeleton rows={5} cols={6} /></div>}
      {data.bookings !== null && filtered.length === 0 && (
        <div className="ds-panel">
          <EmptyState action={filtersActive ? <Button size="sm" onClick={() => setF(NO_FILTERS)}>Clear filters</Button> : undefined} />
        </div>
      )}

      {paging.slice.length > 0 && (
        <div className="hidden lg:block">
          <DataTable label="Bookings table; scroll horizontally for more columns" minWidth={columns.reduce((s, c) => s + COL[c].w, 0) + 236} fixed hasActions>
            <colgroup>
              {columns.map((c) => <col key={c} style={{ width: COL[c].w }} />)}
              <col style={{ width: 236 }} />
            </colgroup>
            <thead>
              <tr>
                {columns.map((c) => <th key={c} scope="col" className={c === "fare" || c === "payout" ? "ds-num" : undefined}>{COL[c].label}</th>)}
                <th scope="col" className="ds-actions">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {paging.slice.map((b) => (
                <Fragment key={b.id}>
                  <tr className="ds-row-stripe" data-tone={rowTone(b, stageOf(b), groups.get(b.id))}>
                    {columns.map((c) => <td key={c}>{cell(c, b)}</td>)}
                    <td className="ds-actions" style={{ width: 236, minWidth: 236 }}>{actions(b)}</td>
                  </tr>
                  {expanded === b.id && (
                    <tr className="ds-expand-row">
                      <td colSpan={columns.length + 1}><BookingExpand b={b} data={data} onOpen={() => onSelectBooking(b.id)} /></td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {paging.slice.length > 0 && (
        <ul className="grid gap-3 lg:hidden" aria-label="Bookings">
          {paging.slice.map((b) => {
            const p = bookingPickupDate(b);
            return (
              <li key={b.id} className="ds-card-row">
                <div className="flex items-start justify-between gap-2">
                  <div><strong>{p ? refDate(p) : b.date}</strong> · {p ? refTime(p) : b.time}</div>
                  <Badge tone={toneForStatus(officeStatusLabel(b, data.marketById.get(b.id)))}>{officeStatusLabel(b, data.marketById.get(b.id))}</Badge>
                </div>
                <RouteCell b={b} />
                <div className="text-body">{b.customer || "Not supplied"} · {b.phone || b.phoneMasked || "Contact not supplied"}</div>
                <div className="flex flex-wrap items-center gap-2"><TripTypeCell b={b} /></div>
                <div className="pt-1 flex flex-wrap gap-1.5">{actions(b)}</div>
                {expanded === b.id && <BookingExpand b={b} data={data} onOpen={() => onSelectBooking(b.id)} />}
              </li>
            );
          })}
        </ul>
      )}

      {filtered.length > 0 && <Pager paging={paging} tabTotal={inStage.length} />}

      {sheet?.kind === "publish" && <PublishDutyDrawer booking={sheet.b} canSetPayout={canFinance} onClose={() => setSheet(null)} onDone={(t) => { done(t); setStage("Published"); }} />}
      {sheet?.kind === "edit-payout" && <PublishDutyDrawer booking={sheet.b} market={data.marketById.get(sheet.b.id)} edit canSetPayout={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "published" && (
        <PublishedDutyDrawer
          booking={sheet.b}
          market={data.marketById.get(sheet.b.id)}
          onClose={() => setSheet(null)}
          onEditPayout={() => setSheet({ kind: "edit-payout", b: sheet.b })}
          onAllocate={() => setSheet({ kind: "assign", b: sheet.b })}
          onDone={done}
        />
      )}
      {sheet?.kind === "assign" && (
        <AssignOnBehalfDrawer
          booking={sheet.b}
          data={data}
          agreedPayout={agreedPayoutOf(sheet.b) || Number(data.marketById.get(sheet.b.id)?.offeredPayout) || null}
          onClose={() => setSheet(null)}
          onDone={done}
        />
      )}
      {sheet?.kind === "reject" && <RejectDialog booking={sheet.b} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "cancel" && <CancelBookingModal booking={sheet.b} canCharge={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "vendor" && <AssignVendorModal booking={sheet.b} vendors={data.vendors} canSetPayout={canFinance} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "driver" && <AssignDriverModal booking={sheet.b} drivers={data.drivers} vehicles={data.vehicles} vendors={data.vendors} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === "contact" && <ContactModal booking={sheet.b} onClose={() => setSheet(null)} onSaved={() => done("Contact details updated.")} />}
    </div>
  );
}

type Col = "date" | "route" | "type" | "vehicle" | "customer" | "fare" | "payout" | "accepted" | "assignment" | "status";
const COL: Record<Col, { label: string; w: number }> = {
  date: { label: "PICKUP DATE / TIME", w: 120 },
  route: { label: "ROUTE", w: 250 },
  type: { label: "TRIP TYPE", w: 100 },
  vehicle: { label: "VEHICLE", w: 96 },
  customer: { label: "CUSTOMER", w: 190 },
  fare: { label: "CUSTOMER FARE", w: 126 },
  payout: { label: "VENDOR PAYOUT", w: 126 },
  accepted: { label: "ACCEPTED BY / TIME", w: 200 },
  assignment: { label: "ASSIGNMENT / DEADLINE", w: 190 },
  status: { label: "STATUS", w: 130 },
};

function columnsFor(stage: OfficeStage): Col[] {
  switch (stage) {
    case "New bookings": return ["date", "route", "type", "vehicle", "customer", "fare"];
    case "To publish":
    case "Published": return ["date", "route", "type", "vehicle", "customer", "payout"];
    case "Accepted": return ["date", "route", "type", "vehicle", "payout", "accepted", "assignment"];
    default: return ["date", "route", "type", "vehicle", "customer", "payout", "status"];
  }
}

/** Left edge of a row: customer group for new bookings, lifecycle afterwards. */
function rowTone(b: Booking, stage: string | null, group?: string): "green" | "amber" | "red" | "blue" | undefined {
  if (stage === "New bookings") return group === "New" ? "green" : group === "Returning" ? "amber" : "blue";
  if (stage === "To publish" || stage === "Published") return "amber";
  if (stage === "Accepted") return b.assignedDriverId ? "green" : "amber";
  if (b.status === "Cancelled" || b.status === "Rejected") return "red";
  if (b.status === "Ongoing") return "blue";
  return undefined;
}

function ContactModal({ booking, onClose, onSaved }: { booking: Booking; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState<ContactForm>({ customer: booking.customer || "", phone: booking.phone || "", email: booking.customerEmail || "", notes: booking.notes || "" });
  const [errors, setErrors] = useState<Partial<Record<keyof ContactForm, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const e: Partial<Record<keyof ContactForm, string>> = {};
    if (c.customer.trim().length < 2) e.customer = "Enter the customer name.";
    const phone = normalizePhone(c.phone);
    if (!phone) e.phone = "Enter a valid 10-digit Indian mobile number.";
    const em = emailError(c.email);
    if (em) e.email = em;
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    setError(null);
    try {
      await updateBookingContact(booking.id, { customer: c.customer.trim(), phone, notes: c.notes.trim(), email: c.email.trim().toLowerCase() });
      onSaved();
    } catch (err) {
      setError(err instanceof AdminBookingError ? err.message : "The changes were not saved. Please try again.");
      setSaving(false);
    }
  };
  return (
    <Modal title="Edit contact details" subtitle={`Booking ${booking.bookingId || booking.id} · fare, payment and status are changed from Booking Details`} onClose={onClose} busy={saving}
      footer={<><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} loading={saving}>Save changes</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {error && <div role="alert" className="sm:col-span-2 ds-error" style={{ margin: 0 }}>{error}</div>}
        <Field label="Customer name" required error={errors.customer}><input value={c.customer} onChange={(e) => setC({ ...c, customer: e.target.value })} maxLength={80} className={inputCls} /></Field>
        <Field label="Mobile number" required error={errors.phone}><input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} inputMode="tel" className={inputCls} /></Field>
        <Field label="Email address" hint="Optional" error={errors.email} className="sm:col-span-2"><input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} maxLength={120} className={inputCls} /></Field>
        <Field label="Notes" className="sm:col-span-2"><input value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} maxLength={300} className={inputCls} /></Field>
      </div>
    </Modal>
  );
}
