import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import { subscribeSettings } from "../services/adminFirestoreService";
import { callFunction, ActionError } from "../services/callables";
import { useBookings } from "../hooks/useOfficeData";
import { useCan } from "../components/AccessContext";
import { Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, EmptyState, Icon, PageHeader } from "../components/ui";
import { refDateTime } from "../domain/officeStage";
import SupportTickets from "./SupportTickets";

type Kind = "customer" | "sos" | "partner";
interface Request { id: string; kind: Kind; ref: string; trip: string; type: string; reason: string; status: string; open: boolean; at: number; raw: Record<string, unknown> }

const s = (v: unknown) => (typeof v === "string" ? v : "");
const ms = (v: unknown) => (v && typeof v === "object" && "seconds" in (v as object) ? (v as { seconds: number }).seconds * 1000 : typeof v === "string" ? Date.parse(v) || 0 : 0);
const FILTERS = ["Open", "Resolved", "All"] as const;
const who = () => auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff";

function useCollection(name: string, enabled: boolean) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  useEffect(() => (enabled ? onSnapshot(collection(db, name), (snap) => setRows(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), () => setRows([])) : undefined), [name, enabled]);
  return rows;
}

/** Master Admin "Help & support": customer requests, rider SOS and partner requests in one office queue. */
export default function Support({ onOpenBooking, onNavigate }: { onOpenBooking: (id: string) => void; onNavigate: (page: string) => void }) {
  const canOps = useCan("operations");
  const canPeople = useCan("people");
  const tickets = useCollection("support_tickets", true);
  const sos = useCollection("sos_alerts", true);
  const links = useCollection("partner_links", canPeople);
  const bookings = useBookings(canOps);
  const [phone, setPhone] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Open");
  const [open, setOpen] = useState<Request | null>(null);
  const [desk, setDesk] = useState(false);
  const { toast, show } = useToast(6000);
  useEffect(() => subscribeSettings((d) => setPhone(s(d?.phone))), []);

  const rows = useMemo<Request[]>(() => {
    const out: Request[] = [];
    for (const t of tickets) {
      const st = s(t.status) || "Open";
      out.push({ id: s(t.id), kind: "customer", ref: `NSM-ST-${s(t.id).slice(0, 6).toUpperCase()}`, trip: s(t.bookingId), type: s(t.category) || "Customer assistance", reason: s(t.description) || s(t.message) || s(t.resolution) || "Office assistance requested.", status: st, open: st === "Open" || st === "In Progress", at: ms(t.createdAt), raw: t });
    }
    for (const a of sos) {
      const st = s(a.status) || "Open";
      out.push({ id: s(a.id), kind: "sos", ref: `SOS-${s(a.id).slice(0, 6).toUpperCase()}`, trip: s(a.bookingCode) || s(a.tripId) || s(a.bookingId), type: "Emergency SOS", reason: s(a.message) || s(a.resolution) || "Rider pressed SOS during the trip. Call the rider and the driver now.", status: st, open: st !== "Resolved" && st !== "Dismissed", at: ms(a.createdAt) || ms(a.timestamp), raw: a });
    }
    for (const l of links) {
      if (!l.officeHelp && s(l.status) !== "Office review") continue;
      const st = s(l.status);
      out.push({ id: s(l.id), kind: "partner", ref: `NSM-PL-${s(l.id).slice(0, 6).toUpperCase()}`, trip: s(l.subjectLabel), type: `Partner request · ${l.kind === "vehicle" ? "Vehicle transfer" : "Driver link"}`, reason: s(l.blockedReason) || s(l.rejectedReason) || "The partner asked the office for help.", status: st === "Office review" ? "Pending" : st, open: st === "Office review" || st === "Awaiting OTP", at: ms(l.updatedAt) || ms(l.createdAt), raw: l });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [tickets, sos, links]);
  const shown = rows.filter((r) => filter === "All" || (filter === "Open" ? r.open : !r.open));
  const bookingIdOf = (code: string) => (bookings.rows ?? []).find((b) => b.id === code || (b.bookingId ?? "").toUpperCase() === code.toUpperCase())?.id;

  if (desk) {
    return (
      <div>
        <div className="ds-page-body" style={{ paddingBottom: 0 }}><Button icon="arrow-left" onClick={() => setDesk(false)}>Back to Help &amp; support</Button></div>
        <SupportTickets />
      </div>
    );
  }

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      <PageHeader eyebrow="NESAM OPERATIONS" title="Help & support" subtitle="Customer requests and partner duty assistance in one queue." actions={<Button variant="ghost" icon="list-checks" onClick={() => setDesk(true)}>Ticket desk</Button>} />
      <section className="ds-panel ds-panel-pad mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Icon name="headset" size={22} /><span><strong className="block text-[14px] text-ink">24/7 office helpdesk</strong><small className="text-[12px] text-muted">{phone ? (phone.startsWith("+") ? phone : `+91 ${phone}`) : "Add the office phone in Settings › Company"}</small></span></div>
        {phone ? <a className="ds-btn ds-btn-secondary" href={`tel:${phone.startsWith("+") ? phone : `+91${phone}`}`}><Icon name="phone" />Call office</a> : <Button icon="phone" disabled disabledReason="Add the office phone in Settings">Call office</Button>}
      </section>
      <div className="ds-chip-row">{FILTERS.map((f) => <Button key={f} size="sm" variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>{f} · {rows.filter((r) => f === "All" || (f === "Open" ? r.open : !r.open)).length}</Button>)}</div>
      {shown.length ? (
        <div className="grid gap-3">
          {shown.map((q) => {
            const bid = q.kind !== "partner" ? (s(q.raw.bookingId) && bookingIdOf(s(q.raw.bookingId))) || bookingIdOf(q.trip) : undefined;
            return (
              <section key={`${q.kind}-${q.id}`} className="ds-panel ds-panel-pad">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold tracking-wide text-muted">{q.ref}{q.trip ? ` · ${q.trip}` : ""}{q.at ? ` · ${refDateTime(new Date(q.at))}` : ""}</span>
                  <Badge tone={q.kind === "sos" && q.open ? "red" : q.open ? "amber" : "green"}>{q.status}</Badge>
                </div>
                <h3 className="text-[15px] font-bold text-ink mt-2">{q.type}</h3>
                <p className="text-[13px] text-body mt-1">{q.reason}</p>
                {s(q.raw.customerName) && <small className="text-[11px] text-muted">{s(q.raw.customerName)}{s(q.raw.customerPhone) ? ` · ${s(q.raw.customerPhone)}` : ""}</small>}
                <div className="flex flex-wrap gap-2 mt-3">
                  {q.kind === "partner"
                    ? <Button size="sm" variant="ghost" icon="arrow-up-right" onClick={() => onNavigate("partner-links")}>View partner link</Button>
                    : <Button size="sm" variant="ghost" icon="arrow-up-right" disabled={!bid} disabledReason={canOps ? "No booking linked" : "Needs Operations access"} onClick={() => bid && onOpenBooking(bid)}>View booking</Button>}
                  {q.open && <Button size="sm" icon="message-square-text" onClick={() => setOpen(q)}>Open request</Button>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <EmptyState title={filter === "Open" || !rows.length ? "No open requests" : "No matching records"} hint={filter === "Open" || !rows.length ? "Customer and partner help requests will appear here." : undefined} />
      )}
      {open && <AssistanceSheet q={open} onClose={() => setOpen(null)} onDone={(t) => { setOpen(null); show(t); }} />}
    </div>
  );
}

function AssistanceSheet({ q, onClose, onDone }: { q: Request; onClose: () => void; onDone: (t: string) => void }) {
  const [decision, setDecision] = useState<"Approved" | "Rejected">("Approved");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) return setError("Write the office resolution.");
    setBusy(true);
    setError(null);
    try {
      const by = { resolvedBy: auth.currentUser?.uid ?? "", resolvedByName: who(), resolvedAt: serverTimestamp(), updatedAt: serverTimestamp() };
      if (q.kind === "partner") {
        await callFunction("decidePartnerLink", { linkId: q.id, decision: decision === "Rejected" ? "reject" : "approve", reason: note.trim() });
      } else if (q.kind === "sos") {
        await updateDoc(doc(db, "sos_alerts", q.id), { status: "Resolved", resolution: note.trim(), ...by });
      } else {
        await callFunction("updateSupportRequest", { ticketId: q.id, status: "Resolved", note: note.trim() });
      }
      onDone("Resolution saved.");
    } catch (err) {
      setError(err instanceof ActionError ? err.message : "The resolution was not saved. Check your access.");
      setBusy(false);
    }
  };
  const progress = async () => {
    setBusy(true);
    try {
      await callFunction("updateSupportRequest", { ticketId: q.id, status: "In Progress", note: "" });
      onDone("Request marked in progress.");
    } catch {
      setError("The status was not changed.");
      setBusy(false);
    }
  };
  return (
    <Modal title="Office assistance" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="support-form" loading={busy}>Save resolution</Button>}>
      <form id="support-form" onSubmit={save} className="grid gap-4" noValidate>
        <p className="text-[12px] text-muted">{q.ref}{q.trip ? ` · ${q.trip}` : ""}</p>
        <p className="text-[13px] text-body">{q.reason}</p>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        {q.kind === "partner" && <label className="ds-field"><span>Decision</span><select className="ds-select" value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)}><option value="Approved">Approve request</option><option value="Rejected">Reject request</option></select></label>}
        <label className="ds-field"><span>Office resolution</span><input className="ds-input" maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {q.kind === "customer" && q.status === "Open" && <div><Button size="sm" variant="ghost" onClick={progress} disabled={busy}>Mark in progress</Button></div>}
      </form>
    </Modal>
  );
}
