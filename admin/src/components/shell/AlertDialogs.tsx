import DateTime12Input from "../DateTime12Input";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Booking } from "../../types";
import { Modal } from "../Feedback";
import { Badge, Button, DataTable, EmptyState, Icon } from "../ui";
import { useOfficeData } from "../../hooks/useOfficeData";
import { useNow } from "../../hooks/useNow";
import { useOperationsSettings } from "../../hooks/useOperationsSettings";
import { ackReminders, bookingAlerts, type AlertRow } from "../../domain/officeAlerts";
import { refDate, refDateTime, refTime, remainingLabel, tripTypeOf } from "../../domain/officeStage";
import {
  ACK_OUTCOMES, CALL_OUTCOMES, addFollowup, dueFrom, latestFollowups, subscribeFollowups, subscribeOwnership, takeOwnership,
  type Followup, type Ownership,
} from "../../services/officeOpsService";
import { AssignOnBehalfDrawer } from "../booking/DutyDrawers";
import { agreedPayoutOf } from "../../domain/officeStage";

/** Live ownership + follow-up logs shared by the alert sheets. */
export function useOfficeFollowups() {
  const [own, setOwn] = useState<Map<string, Ownership>>(new Map());
  const [followups, setFollowups] = useState<Followup[]>([]);
  useEffect(() => {
    const a = subscribeOwnership(setOwn);
    const b = subscribeFollowups(setFollowups);
    return () => { a(); b(); };
  }, []);
  return { own, followups };
}

const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

/** Rows for the alerts sheet and the dashboard's urgent panel. */
export function useBookingAlerts(enabled = true) {
  const data = useOfficeData(enabled);
  const now = useNow(30000);
  const ops = useOperationsSettings();
  const rows = useMemo(() => bookingAlerts(data.bookings ?? [], data.marketById, now, ops.warningHours), [data.bookings, data.marketById, now, ops.warningHours]);
  return { data, now, rows, urgent: rows.filter((r) => r.urgent) };
}

export function AlertsTable({ rows, onOpenBooking, own, empty }: { rows: AlertRow[]; onOpenBooking: (id: string) => void; own: Map<string, Ownership>; empty?: string }) {
  const { data, now } = useBookingAlerts();
  const [call, setCall] = useState<Booking | null>(null);
  const [owning, setOwning] = useState<Booking | null>(null);
  const [assign, setAssign] = useState<Booking | null>(null);
  if (!rows.length) return <EmptyState title={empty ?? "No matching records"} />;
  return (
    <>
      <DataTable label="Booking alerts" minWidth={1040} fixed hasActions>
        <colgroup><col style={{ width: 150 }} /><col style={{ width: 200 }} /><col style={{ width: 150 }} /><col style={{ width: 170 }} /><col style={{ width: 170 }} /><col style={{ width: 170 }} /></colgroup>
        <thead><tr><th>PICKUP DATE / TIME</th><th>ROUTE / BOOKING</th><th>TRIP TYPE / CAR</th><th>ACCEPTED BY</th><th>STATUS / DEADLINE</th><th className="ds-actions">CALL / ACTION</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const vendor = r.b.assignedVendorId ? data.vendorById.get(r.b.assignedVendorId) : undefined;
            const o = own.get(r.b.id);
            return (
              <tr key={r.b.id} className="ds-row-stripe" data-tone={r.urgent ? "red" : "amber"}>
                <td><strong>{refDate(r.pickup)}</strong><small>{refTime(r.pickup).toLowerCase()}</small></td>
                <td><button type="button" className="text-left" onClick={() => onOpenBooking(r.b.id)}><strong className="ds-cell-clip">{r.b.pickup} → {r.b.drop}</strong></button><small>{r.b.bookingId || r.b.id}</small></td>
                <td><strong>{tripTypeOf(r.b)}</strong><small>{r.b.vehicleCategory || r.b.vehicle}</small></td>
                <td>{r.accepted ? <><strong>{r.b.assignedVendorName || vendor?.companyName || vendor?.name}</strong><small>Vendor</small></> : <><strong>Not accepted</strong><small>Partner allocation pending</small></>}</td>
                <td>
                  <Badge tone={r.missed ? "red" : r.status === "New booking" ? "blue" : "amber"}>{r.missed ? "Deadline missed" : r.status}</Badge>
                  <small>{r.accepted && r.deadline ? remainingLabel(r.deadline, now) : `Pickup ${remainingLabel(r.pickup, now)}`}</small>
                </td>
                <td className="ds-actions">
                  <div style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    {r.accepted ? (
                      <>
                        {vendor?.phone ? <a className="ds-btn ds-btn-secondary ds-btn-sm" href={tel(vendor.phone)}><Icon name="phone" size={13} />Call Vendor</a> : <Button size="sm" icon="phone" onClick={() => setCall(r.b)}>Call Vendor</Button>}
                        <Button size="sm" variant="ghost" icon="user-round-check" onClick={() => setAssign(r.b)}>Assign on behalf</Button>
                      </>
                    ) : (
                      <Button size="sm" icon="user-round-plus" onClick={() => setCall(r.b)}>Allocate partner</Button>
                    )}
                    {o ? <small className="text-ok">Handled by {o.handlerName}</small> : <Button size="sm" variant="ghost" icon="user-round" onClick={() => setOwning(r.b)}>Take ownership</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {call && <PartnerCallDialog booking={call} onClose={() => setCall(null)} />}
      {owning && <OwnershipDialog booking={owning} onClose={() => setOwning(null)} />}
      {assign && <AssignOnBehalfDrawer booking={assign} data={data} agreedPayout={agreedPayoutOf(assign) || null} onClose={() => setAssign(null)} onDone={() => setAssign(null)} />}
    </>
  );
}

export function AlertsDialog({ onClose, onOpenBooking, children }: { onClose: () => void; onOpenBooking: (id: string) => void; children?: ReactNode }) {
  const { rows } = useBookingAlerts();
  const { own } = useOfficeFollowups();
  return (
    <Modal title="Booking alerts & assignment" onClose={onClose} wide>
      <AlertsTable rows={rows} own={own} onOpenBooking={(id) => { onClose(); onOpenBooking(id); }} empty="No booking needs assignment right now." />
      {children}
    </Modal>
  );
}

export function PartnerCallDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const data = useOfficeData();
  const partners = useMemo(() => [
    ...data.drivers.filter((d) => !d.vendorId && /approved/i.test(d.status)).map((d) => ({ key: `driver:${d.id}`, label: `Driver Partner · ${d.name}`, phone: d.phone, name: d.name, type: "driver" as const, id: d.id })),
    ...data.vendors.filter((v) => /approved|active/i.test(String(v.status))).map((v) => ({ key: `vendor:${v.id}`, label: `Vendor · ${v.companyName || v.name}`, phone: v.phone, name: v.companyName || v.name, type: "vendor" as const, id: v.id })),
  ], [data.drivers, data.vendors]);
  const [key, setKey] = useState(booking.assignedVendorId ? `vendor:${booking.assignedVendorId}` : "");
  const [outcome, setOutcome] = useState<string>(CALL_OUTCOMES[0]);
  const [note, setNote] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = partners.find((x) => x.key === key);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!p) return setError("Choose the partner you called.");
    if (note.trim().length < 3) return setError("Record the call note / action taken.");
    if (outcome === "Call back" && !due) return setError("Choose the callback date / time.");
    setBusy(true);
    try {
      await addFollowup({ kind: "partner_call", bookingId: booking.id, bookingCode: booking.bookingId || booking.id, partnerType: p.type, partnerId: p.id, partnerName: p.name, outcome, note: note.trim(), dueAt: dueFrom(due) });
      onClose();
    } catch {
      setError("The call outcome was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Partner call & follow-up" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="partner-call" loading={busy}>Save call outcome</Button>}>
      <form id="partner-call" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
          <span>{refDateTime(bookingPickup(booking))}</span>
          <strong>{booking.pickup} → {booking.drop}</strong>
          <small>{booking.bookingId || booking.id} · Partner · {p ? p.name : "Not selected"}</small>
        </div>
        <label className="ds-field"><span>Partner to contact</span>
          <select className="ds-select" value={key} onChange={(e) => setKey(e.target.value)}>
            <option value="">Choose partner</option>
            {partners.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {p?.phone ? <a className="ds-btn ds-btn-secondary" href={tel(p.phone)}><Icon name="phone-outgoing" size={14} />Open device dialler</a> : <Button icon="phone-outgoing" disabled>Open device dialler</Button>}
          {p?.phone && <span className="text-[12px] text-muted">{p.phone}</span>}
        </div>
        <label className="ds-field"><span>Call outcome</span>
          <select className="ds-select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{CALL_OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select>
        </label>
        <label className="ds-field"><span>Call note / action taken</span><input className="ds-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {outcome === "Call back" && <label className="ds-field"><span>Callback date / time · IST</span><DateTime12Input value={due} onChange={setDue} /></label>}
      </form>
    </Modal>
  );
}

const bookingPickup = (b: Booking) => (b.pickupAt as never) ?? (b.scheduledAt as never) ?? null;

export function OwnershipDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError("Record the handover reason.");
    setBusy(true);
    try {
      await takeOwnership(booking.id, reason.trim());
      onClose();
    } catch {
      setError("Ownership was not recorded.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Take over booking" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="take-own" loading={busy}>Take ownership</Button>}>
      <form id="take-own" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
          <strong style={{ marginTop: 0 }}>{booking.pickup} → {booking.drop}</strong>
          <small>{booking.bookingId || booking.id}</small>
        </div>
        <p className="text-[12px] text-muted">Ownership ends urgent attention; pending assignment reminders continue until driver + cab are confirmed.</p>
        <label className="ds-field"><span>Handover reason</span><input className="ds-input" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </form>
    </Modal>
  );
}

export function AckRemindersDialog({ onClose, onOpenBooking }: { onClose: () => void; onOpenBooking: (id: string) => void }) {
  const data = useOfficeData();
  const now = useNow(30000);
  const { followups } = useOfficeFollowups();
  const rows = useMemo(() => ackReminders(data.bookings ?? [], latestFollowups(followups, "driver_ack"), now), [data.bookings, followups, now]);
  const [follow, setFollow] = useState<Booking | null>(null);
  return (
    <Modal title="Driver acknowledgement reminders" onClose={onClose} size="lg">
      {rows.length === 0 ? <EmptyState title="All assigned drivers have acknowledged" /> : (
        <DataTable label="Driver acknowledgement reminders" minWidth={640} fixed hasActions>
          <colgroup><col style={{ width: 210 }} /><col style={{ width: 170 }} /><col style={{ width: 150 }} /><col style={{ width: 130 }} /></colgroup>
          <thead><tr><th>PICKUP / BOOKING</th><th>DRIVER / ASSIGNED</th><th>RESPONSE</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.b.id}>
                <td><strong>{refDateTime(r.pickup)}</strong><small>{r.b.bookingId || r.b.id} · {r.b.pickup} → {r.b.drop}</small></td>
                <td><strong>{r.b.assignedDriverName || r.b.driver}</strong><small>{refDateTime((r.b as { assignedAt?: never }).assignedAt) || "Assignment time not recorded"}</small></td>
                <td><Badge tone={r.last ? "blue" : "amber"}>{r.last ? r.last.outcome : "Awaiting acknowledgement"}</Badge>{r.last && <small>{r.last.note}</small>}</td>
                <td className="ds-actions"><div><Button size="sm" onClick={() => setFollow(r.b)}>Follow up</Button><Button size="sm" variant="ghost" onClick={() => { onClose(); onOpenBooking(r.b.id); }}>View</Button></div></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      {follow && <AckFollowupDialog booking={follow} onClose={() => setFollow(null)} />}
    </Modal>
  );
}

function AckFollowupDialog({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [outcome, setOutcome] = useState<string>(ACK_OUTCOMES[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) return setError("Record the call / contact note.");
    setBusy(true);
    try {
      await addFollowup({ kind: "driver_ack", bookingId: booking.id, bookingCode: booking.bookingId || booking.id, partnerType: "driver", partnerId: booking.assignedDriverId, partnerName: booking.assignedDriverName, outcome, note: note.trim(), dueAt: null });
      onClose();
    } catch {
      setError("The follow-up was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Driver acknowledgement follow-up" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="ack-follow" loading={busy}>Save follow-up</Button>}>
      <form id="ack-follow" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
          <strong style={{ marginTop: 0 }}>{booking.assignedDriverName || booking.driver}</strong>
          <small>{booking.bookingId || booking.id} · {booking.pickup} → {booking.drop}</small>
          {booking.driverPhone && <a className="ds-link mt-2 inline-block" href={tel(booking.driverPhone)}>Call driver · {booking.driverPhone}</a>}
        </div>
        <label className="ds-field"><span>Response</span><select className="ds-select" value={outcome} onChange={(e) => setOutcome(e.target.value)}>{ACK_OUTCOMES.map((o) => <option key={o}>{o}</option>)}</select></label>
        <label className="ds-field"><span>Call / contact note</span><input className="ds-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </form>
    </Modal>
  );
}
