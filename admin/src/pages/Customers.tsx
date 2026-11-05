import { useMemo, useState, type FormEvent } from "react";
import type { Booking, Customer } from "../types";
import { addFirestoreDocument, updateFirestoreDocument, COLLECTIONS } from "../services/adminFirestoreService";
import { buildCustomerStats, EMPTY_STATS, type CustomerStats } from "../services/customerStats";
import { useBookings, useCustomers } from "../hooks/useOfficeData";
import { ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, PageHeader, Tabs, TableSkeleton, toneForStatus } from "../components/ui";
import { ExportDialog, Initials, SimplePager, useSelection, type ExportSpec } from "../components/ui/RecordKit";
import MenuButton from "../components/ui/MenuButton";
import { paymentOf } from "../domain/bookingFlow";
import { refDateTime, rupee } from "../domain/officeStage";
import { bookingPickupDate } from "../utils/time";

/** Last 10 digits of an Indian mobile ("+91 98765 43210" → "9876543210"). */
export function getCanonicalPhoneDigits(input: string): string {
  if (!input) return "";
  const digits = input.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** "+91 98765 43210" */
export function formatIndianPhone(input: string): string {
  const d = getCanonicalPhoneDigits(input);
  return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : input.trim();
}

const CUSTOMER_ACTIVE = "Active";
const CUSTOMER_BLOCKED = "Blocked";
const isActive = (s: string) => !s || /^active$/i.test(s);
/** Older records stored N/A as the email when none was given. */
const emailOf = (c: Customer) => (c.email && c.email !== "N/A" ? c.email : "");
export const customerCode = (c: { id: string; customerCode?: string }) => c.customerCode || `NSM-CU-${c.id.slice(0, 6).toUpperCase()}`;

type Group = "New" | "Returning" | "Regular";
const groupOf = (s: CustomerStats): Group => (s.completed >= 3 ? "Regular" : s.completed >= 1 ? "Returning" : "New");
const GROUP_TONE: Record<Group, "green" | "amber" | "blue"> = { New: "green", Returning: "amber", Regular: "blue" };
const PAGE = 10;

export default function Customers({ onNavigate }: { onNavigate?: (page: string, tab?: string) => void }) {
  const customers = useCustomers();
  const bookingsQ = useBookings();
  const all = customers.rows ?? [];
  const bookings = bookingsQ.rows ?? [];
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<"All" | Group>("All");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [viewing, setViewing] = useState<Customer | null>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const sel = useSelection();
  const { toast, show } = useToast(6000);

  const stats = useMemo(() => buildCustomerStats(all, bookings), [all, bookings]);
  const statsOf = (c: Customer) => stats.get(c.id) ?? EMPTY_STATS;
  const lastCompleted = useMemo(() => {
    const m = new Map<string, Date>();
    for (const b of bookings) {
      if (b.status !== "Completed") continue;
      const owner = b.customerId || all.find((c) => getCanonicalPhoneDigits(c.phone) === getCanonicalPhoneDigits(b.phone || ""))?.id;
      const p = bookingPickupDate(b);
      if (owner && p && (!m.get(owner) || p > m.get(owner)!)) m.set(owner, p);
    }
    return m;
  }, [bookings, all]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const d = getCanonicalPhoneDigits(term);
    return all
      .filter((c) => group === "All" || groupOf(statsOf(c)) === group)
      .filter((c) => !term || [c.name, emailOf(c), c.id, customerCode(c)].some((v) => (v || "").toLowerCase().includes(term)) || (d.length >= 4 && getCanonicalPhoneDigits(c.phone).includes(d)))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [all, q, group, stats]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages);
  const shown = filtered.slice((cur - 1) * PAGE, cur * PAGE);
  const filtersOn = q !== "" || group !== "All";

  const spec: ExportSpec<Customer> = {
    scope: "Customers",
    headers: ["Customer ID", "Name", "Mobile", "Email", "City", "Customer group", "Completed trips", "Last trip", "Status"],
    row: (c) => [customerCode(c), c.name, c.phone, emailOf(c), c.city ?? "", groupOf(statsOf(c)), statsOf(c).completed, refDateTime(lastCompleted.get(c.id) ?? null), isActive(c.status) ? "Active" : c.status],
  };

  const toggleBlock = async (c: Customer) => {
    const next = isActive(c.status) ? CUSTOMER_BLOCKED : CUSTOMER_ACTIVE;
    const ok = await updateFirestoreDocument(COLLECTIONS.CUSTOMERS, c.id, { status: next });
    show(ok ? `${c.name} is now ${next.toLowerCase()}.` : `Could not change ${c.name}'s status.`, ok ? "success" : "error");
  };

  return (
    <div className="ds-page-body">
      <Toast toast={toast} />
      {customers.error && <ErrorBanner message={customers.error} />}
      <PageHeader
        title="Customers"
        subtitle="Customer contacts, groups and booking history."
        actions={<><Button icon="download" onClick={() => setExporting(true)}>Export data</Button><Button variant="primary" icon="user-plus" onClick={() => setEditing("new")}>Add customer</Button></>}
      />
      <div className="ds-filterbar" role="search">
        <div className="ds-search" style={{ flex: "1 1 340px" }}>
          <Icon name="search" />
          <input type="search" className="ds-input" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Name, ID, mobile or DL number" aria-label="Search customers" />
        </div>
        <label className="ds-field"><span>Customer group</span>
          <select className="ds-select" value={group} onChange={(e) => { setGroup(e.target.value as typeof group); setPage(1); }}>{["All", "New", "Returning", "Regular"].map((g) => <option key={g}>{g}</option>)}</select>
        </label>
      </div>
      <div className="ds-toolbar-count">
        <strong>{filtered.length} records · {sel.ids.size} selected</strong>
        <Button variant="ghost" size="sm" icon="rotate-ccw" disabled={!filtersOn && !sel.ids.size} onClick={() => { setQ(""); setGroup("All"); sel.clear(); }}>Clear filters</Button>
      </div>
      {customers.rows === null ? <div className="ds-panel"><TableSkeleton rows={5} cols={5} /></div> : filtered.length === 0 ? <div className="ds-panel"><EmptyState /></div> : (
        <DataTable label="Customers" minWidth={980} fixed hasActions>
          <colgroup><col style={{ width: 44 }} /><col style={{ width: 260 }} /><col style={{ width: 200 }} /><col style={{ width: 200 }} /><col style={{ width: 110 }} /><col style={{ width: 200 }} /></colgroup>
          <thead><tr>
            <th className="ds-check-cell"><input type="checkbox" aria-label="Select visible records" checked={shown.length > 0 && shown.every((c) => sel.has(c.id))} onChange={(e) => sel.setAll(shown.map((c) => c.id), e.target.checked)} /></th>
            <th>NAME / ID</th><th>CONTACT</th><th>BOOKING HISTORY</th><th>STATUS</th><th className="ds-actions">ACTIONS</th>
          </tr></thead>
          <tbody>
            {shown.map((c) => {
              const s = statsOf(c);
              const g = groupOf(s);
              return (
                <tr key={c.id}>
                  <td className="ds-check-cell"><input type="checkbox" aria-label={`Select ${c.name}`} checked={sel.has(c.id)} onChange={() => sel.toggle(c.id)} /></td>
                  <td><div className="ds-person"><Initials name={c.name || "?"} /><div><strong>{c.name}</strong><Badge tone={GROUP_TONE[g]}>{g}</Badge><small>{customerCode(c)}</small></div></div></td>
                  <td><strong>{c.phone}</strong><small>{emailOf(c) || "Email not supplied"}</small></td>
                  <td><strong>{s.completed} completed trips</strong><small>{lastCompleted.get(c.id) ? refDateTime(lastCompleted.get(c.id)!) : "No completed trips"}</small></td>
                  <td><Badge tone={toneForStatus(isActive(c.status) ? "Active" : c.status)}>{isActive(c.status) ? "Active" : c.status}</Badge></td>
                  <td className="ds-actions"><div>
                    <Button size="sm" onClick={() => setViewing(c)}>View</Button>
                    <Button size="sm" variant="ghost" onClick={() => onNavigate?.("accounts", `Statements:customer:${c.id}`)}>Statement</Button>
                    <MenuButton iconOnly label={`More actions for ${c.name}`} items={[
                      { label: "Edit customer", icon: "pencil", onSelect: () => setEditing(c) },
                      { label: isActive(c.status) ? "Block customer" : "Unblock customer", icon: isActive(c.status) ? "ban" : "circle-check", danger: isActive(c.status), onSelect: () => toggleBlock(c) },
                    ]} />
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
      {filtered.length > 0 && <SimplePager page={cur} pages={pages} from={(cur - 1) * PAGE + 1} to={Math.min(cur * PAGE, filtered.length)} total={filtered.length} onPage={setPage} />}

      {exporting && <ExportDialog spec={spec} all={all} filtered={filtered} selected={all.filter((c) => sel.has(c.id))} filters={{ q, group }} onClose={() => setExporting(false)} />}
      {viewing && (
        <CustomerProfile
          c={all.find((x) => x.id === viewing.id) ?? viewing}
          stats={statsOf(viewing)}
          last={lastCompleted.get(viewing.id) ?? null}
          bookings={bookings}
          onClose={() => setViewing(null)}
          onEdit={() => { setEditing(viewing); setViewing(null); }}
          onStatement={() => onNavigate?.("accounts", `Statements:customer:${viewing.id}`)}
          onToggle={() => toggleBlock(viewing)}
        />
      )}
      {editing && <CustomerForm c={editing === "new" ? null : editing} all={all} onClose={() => setEditing(null)} onSaved={(t) => { setEditing(null); show(t); }} />}
    </div>
  );
}

function CustomerProfile({ c, stats, last, bookings, onClose, onEdit, onStatement, onToggle }: {
  c: Customer; stats: CustomerStats; last: Date | null; bookings: Booking[]; onClose: () => void; onEdit: () => void; onStatement: () => void; onToggle: () => void;
}) {
  const [tab, setTab] = useState<"Overview" | "Bookings" | "Payments">("Overview");
  const g = groupOf(stats);
  const mine = bookings.filter((b) => b.customerId === c.id || (!b.customerId && getCanonicalPhoneDigits(b.phone || "") === getCanonicalPhoneDigits(c.phone)))
    .sort((a, z) => (bookingPickupDate(z)?.getTime() ?? 0) - (bookingPickupDate(a)?.getTime() ?? 0));
  return (
    <Modal title="Customer profile" onClose={onClose} size="lg">
      <div className="ds-profile-head">
        <Initials name={c.name || "?"} />
        <div><strong>{c.name}</strong><small>{customerCode(c)}</small></div>
        <Badge tone={GROUP_TONE[g]}>{g}</Badge>
      </div>
      <Tabs label="Customer profile" value={tab} onChange={setTab} tabs={(["Overview", "Bookings", "Payments"] as const).map((t) => ({ id: t, label: t }))} />
      {tab === "Overview" && (
        <>
          <dl className="ds-facts" data-cols={2}>
            {([
              ["Customer ID", customerCode(c)], ["Name", c.name], ["Registered mobile", c.phone], ["WhatsApp", c.phone],
              ["Email", emailOf(c) || "Not supplied"], ["Customer group", g], ["Completed trips", String(stats.completed)], ["Last trip", last ? refDateTime(last) : "Not yet"],
              ["City", c.city || "—"], ["Status", isActive(c.status) ? "Active" : c.status], ["Total bookings", String(stats.total)], ["Paid · outstanding", `${rupee(stats.paid)} · ${rupee(stats.outstanding)}`],
            ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="flex flex-wrap gap-2 mt-5">
            <Button icon="pencil" onClick={onEdit}>Edit customer</Button>
            <Button icon="file-text" onClick={onStatement}>View account statement</Button>
            <Button variant="ghost" icon={isActive(c.status) ? "ban" : "circle-check"} onClick={onToggle}>{isActive(c.status) ? "Block customer" : "Unblock customer"}</Button>
          </div>
        </>
      )}
      {tab === "Bookings" && (mine.length === 0 ? <EmptyState title="No bookings yet" /> : (
        <ul className="ds-activity">{mine.map((b) => (
          <li key={b.id}><strong>{b.bookingId || b.id} · {b.pickup} → {b.drop}</strong><span>{b.status} · {b.vehicleCategory || b.vehicle}</span><small>{refDateTime(bookingPickupDate(b))}</small></li>
        ))}</ul>
      ))}
      {tab === "Payments" && (mine.length === 0 ? <EmptyState title="No payments recorded" /> : (
        <ul className="ds-activity">{mine.map((b) => {
          const p = paymentOf(b);
          return <li key={b.id}><strong>{b.bookingId || b.id} · {rupee(p.amountDue)}</strong><span>{p.status} · paid {rupee(p.totalPaid)} · balance {rupee(p.balanceDue)}</span><small>{refDateTime(bookingPickupDate(b))}</small></li>;
        })}</ul>
      ))}
    </Modal>
  );
}

function CustomerForm({ c, all, onClose, onSaved }: { c: Customer | null; all: Customer[]; onClose: () => void; onSaved: (t: string) => void }) {
  const [f, setF] = useState({ name: c?.name ?? "", phone: c?.phone ?? "", email: c ? emailOf(c) : "", city: c?.city ?? "", gender: c?.gender ?? "", notes: c?.notes ?? "", status: c && !isActive(c.status) ? CUSTOMER_BLOCKED : CUSTOMER_ACTIVE });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dup = !c ? all.find((x) => getCanonicalPhoneDigits(x.phone) === getCanonicalPhoneDigits(f.phone) && getCanonicalPhoneDigits(f.phone).length === 10) : undefined;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Enter the customer name.");
    if (!c && !/^[6-9]\d{9}$/.test(getCanonicalPhoneDigits(f.phone))) return setError("Enter a valid 10-digit Indian mobile number.");
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setError("Enter a valid email address.");
    if (dup) return setError(`A customer with this mobile already exists (${dup.name}).`);
    setBusy(true);
    const ok = c
      ? await updateFirestoreDocument(COLLECTIONS.CUSTOMERS, c.id, { name: f.name.trim(), email: f.email.trim(), city: f.city.trim(), status: f.status })
      : await addFirestoreDocument(COLLECTIONS.CUSTOMERS, { name: f.name.trim(), phone: formatIndianPhone(f.phone), email: f.email.trim(), status: f.status, role: "customer", source: "admin", gender: f.gender, city: f.city.trim(), notes: f.notes.trim() });
    setBusy(false);
    if (ok) onSaved(c ? "Customer profile updated." : `Customer ${f.name.trim()} added.`);
    else setError("The customer was not saved. Check your connection and permissions, then try again.");
  };
  return (
    <Modal title={c ? "Edit customer" : "Add customer"} onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="customer-form" loading={busy}>{c ? "Save changes" : "Save customer"}</Button>}>
      <form id="customer-form" onSubmit={save} className="ds-form-grid" noValidate>
        {error && <div className="ds-error" role="alert" data-span="2">{error}</div>}
        <label className="ds-field" data-span="2"><span>Full name</span><input className="ds-input" maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="ds-field"><span>Mobile</span><input className="ds-input" inputMode="tel" disabled={!!c} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />{dup && <span className="text-[11px] text-bad">Already registered · {dup.name}</span>}</label>
        <label className="ds-field"><span>Email · optional</span><input className="ds-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
        <label className="ds-field"><span>City</span><input className="ds-input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
        <label className="ds-field"><span>Status</span><select className="ds-select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option>{CUSTOMER_ACTIVE}</option><option>{CUSTOMER_BLOCKED}</option></select></label>
        {!c && <label className="ds-field"><span>Gender · optional</span><select className="ds-select" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Not specified</option><option>Male</option><option>Female</option><option>Other</option></select></label>}
        {!c && <label className="ds-field" data-span="2"><span>Notes</span><input className="ds-input" maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>}
      </form>
    </Modal>
  );
}
