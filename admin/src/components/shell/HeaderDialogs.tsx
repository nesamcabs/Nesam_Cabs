import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth } from "../../services/firebase";
import { Modal } from "../Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, Tabs, toneForStatus } from "../ui";
import type { IconName } from "../ui/Icon";
import { useCustomers, useOfficeData } from "../../hooks/useOfficeData";
import type { AdminAccess } from "../../config/permissions";
import { PERMISSION_INFO } from "../../config/permissions";
import { subscribeStaffAccounts, type StaffAccount } from "../../services/staffService";
import {
  DEFAULT_STAFF, REQUEST_STATUSES, decideRequest, riskAlerts, savePolicy, saveStaffPrivacy, subscribeAccessLog, subscribePolicy,
  subscribeRequests, subscribeStaffPrivacy, type AccessLog, type PrivacyPolicy, type PrivacyRequest, type StaffPrivacy,
} from "../../services/privacyService";
import {
  ALERT_KINDS, ALERT_SECONDS, DEFAULT_SOUNDS, PRESET_TONES, REPEATS, addCustomSound, clearLocalSoundConfig, hasLocalSoundConfig, listCustomSounds, loadLocalSoundConfig, loadSoundConfig,
  officeConfigOf, setSharedSoundConfig, startSoundPreview, type SoundConfig, type SoundPreview,
} from "../../utils/notificationSound";
import { playAppTone, stopAppTone } from "../../utils/appTonePreview";
import { APP_SOUNDS, APP_SOUND_LABEL, SOUND_AUDIENCES, SOUND_EVENTS, type AppSound, type SoundAudience, type SoundEvent } from "../../domain/notificationSoundEvents";
import { saveNotificationSounds, subscribeNotificationSounds, type AppSoundChoices, type NotificationSoundsDoc, type SoundChangeRow } from "../../services/notificationSoundSettings";
import { useCan, useCanDo } from "../AccessContext";
import { useNotifications } from "../NotificationHost";
import { formatDateTime12 } from "../../utils/time";
import { revokeStaffSessions } from "../../services/staffSessionService";

/** Partner status in the reference words (Active · Pending · Suspended …). */
const statusWord = (v: string) => (/^(approved|active)$/i.test(v) ? "Active" : /pending/i.test(v) ? "Pending" : v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replace(/_/g, " ") : "—");
const digits = (v: string) => v.replace(/\D/g, "").slice(-10);
const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

// ── Search all records ────────────────────────────────────────────────────

interface Hit { role: string; status: string; exact: boolean; name: string; record?: string; id: string; contact: string; assignment: string; page: string; bookingId?: string; phone?: string }

/** Search scopes. Every scope filters the same existing in-memory search; none adds a new data source. */
const SCOPES = [
  { id: "all", label: "All records", roles: null },
  { id: "bookings", label: "Bookings & trips", roles: ["Bookings"] },
  { id: "partners", label: "Drivers & vendors", roles: ["Vendors", "Vendor Drivers", "Driver Partners"] },
  { id: "customers", label: "Customers", roles: ["Customers"] },
] as const;
type ScopeId = (typeof SCOPES)[number]["id"];
const RESULT_LIMIT = 60;
const ROLE_ICON: Record<string, IconName> = { Bookings: "calendar-clock", Vendors: "building-2", "Vendor Drivers": "users-round", "Driver Partners": "users-round", Customers: "user-round" };

export function SearchDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (page: string, bookingId?: string) => void }) {
  const data = useOfficeData();
  const customers = useCustomers();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [scope, setScope] = useState<ScopeId>("all");
  const allHits = useMemo<Hit[]>(() => {
    const term = submitted.trim().toLowerCase();
    if (!term) return [];
    const d = digits(term);
    const mobileHit = (p?: string) => !!d && d.length === 10 && digits(p || "") === d;
    const has = (...v: (string | undefined)[]) => v.some((x) => (x || "").toLowerCase().includes(term)) || (!!d && d.length >= 4 && v.some((x) => digits(x || "").includes(d)));
    const pending = (pred: (b: { assignedVendorId?: string; assignedDriverId?: string; status: string }) => boolean) => (data.bookings ?? []).filter((b) => pred(b) && ["Approved", "Confirmed", "Assigned"].includes(b.status)).length;
    const out: Hit[] = [];
    for (const v of data.vendors) if (has(v.companyName, v.name, v.phone, v.id)) out.push({ role: "Vendors", status: String(v.status), exact: mobileHit(v.phone), name: v.companyName || v.name, id: v.id, contact: v.phone, assignment: `${pending((b) => b.assignedVendorId === v.id && !b.assignedDriverId)} pending`, page: "vendors", phone: v.phone });
    for (const dr of data.drivers) if (has(dr.name, dr.phone, dr.id, dr.licenseNumber)) out.push({ role: dr.vendorId ? "Vendor Drivers" : "Driver Partners", status: dr.status, exact: mobileHit(dr.phone), name: dr.name, id: dr.id, contact: dr.phone, assignment: `${pending((b) => b.assignedDriverId === dr.id)} assigned`, page: dr.vendorId ? "vendor-drivers" : "drivers", phone: dr.phone });
    for (const c of customers.rows ?? []) if (has(c.name, c.phone, c.id)) out.push({ role: "Customers", status: c.status, exact: mobileHit(c.phone), name: c.name, id: c.id, contact: c.phone, assignment: "—", page: "customers", phone: c.phone });
    for (const b of data.bookings ?? []) if (has(b.bookingId, b.id, b.customer, b.phone)) out.push({ role: "Bookings", status: b.status, exact: false, name: `${b.pickup} → ${b.drop}`, id: b.bookingId || b.id, contact: "", assignment: "—", page: "booking-detail", bookingId: b.id });
    return out.sort((a, b) => Number(b.exact) - Number(a.exact));
  }, [submitted, data.vendors, data.drivers, data.bookings, customers.rows]);
  const inScope = (h: Hit, id: ScopeId) => { const roles = SCOPES.find((s) => s.id === id)?.roles; return !roles || (roles as readonly string[]).includes(h.role); };
  const scoped = allHits.filter((h) => inScope(h, scope));
  const hits = scoped.slice(0, RESULT_LIMIT);
  const countOf = (id: ScopeId) => allHits.filter((h) => inScope(h, id)).length;
  // Still loading = a source has neither delivered rows nor reported an error yet.
  const loading = (data.bookings == null && !data.error) || (customers.rows == null && !customers.error);
  const sourceErrors = [data.error && "bookings", customers.error && "customers"].filter(Boolean) as string[];
  const scopeLabel = SCOPES.find((s) => s.id === scope)?.label.toLowerCase() ?? "records";

  return (
    <Modal title="Search all records" subtitle="Bookings, driver partners, vendors and customers" onClose={onClose} centered size="xl">
      <form role="search" onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }} className="ds-gsearch-form">
        <div className="ds-search">
          <Icon name="search" />
          <input
            autoFocus
            type="text"
            className="ds-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, mobile, permanent ID or Booking ID"
            aria-label="Search records"
            aria-describedby="gsearch-hint"
            enterKeyHint="search"
          />
        </div>
        <Button variant="primary" type="submit" icon="search" disabled={!q.trim()}>Search</Button>
      </form>
      <p id="gsearch-hint" className="ds-gsearch-hint">Press Enter to search · Mobile works with +91, spaces or 10 digits · Exact partner mobile matches appear first · Esc closes</p>

      <div className="ds-gsearch-scopes" role="radiogroup" aria-label="Search scope">
        {SCOPES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={scope === s.id} className="ds-gsearch-scope" onClick={() => setScope(s.id)}>
            {s.label}
            {submitted && <span className="ds-gsearch-scope__count">{countOf(s.id)}</span>}
          </button>
        ))}
      </div>

      {sourceErrors.length > 0 && (
        <div className="ds-error mb-3" role="alert"><Icon name="circle-alert" />Some records could not be loaded ({sourceErrors.join(", ")}), so results may be incomplete.</div>
      )}

      <div className="ds-gsearch-results" aria-live="polite">
        {!submitted ? (
          <EmptyState icon="search" title="Search across NESAM records" hint="Enter a name, mobile number, permanent ID or Booking ID, then press Enter." />
        ) : loading && allHits.length === 0 ? (
          <div className="ds-empty" role="status"><span className="ds-spinner" aria-hidden="true" /><strong>Loading records…</strong><span>Results appear as soon as live data arrives.</span></div>
        ) : hits.length === 0 ? (
          <EmptyState title={`No ${scope === "all" ? "records" : scopeLabel} match “${submitted.trim()}”`} hint={scope === "all" ? "Check the spelling, or try a mobile number or ID." : "Try another scope or a different term."} />
        ) : (
          <>
            <p className="ds-gsearch-meta">
              {scoped.length > RESULT_LIMIT ? `Showing the first ${RESULT_LIMIT} of ${scoped.length} results — refine your search to narrow them.` : `${scoped.length} result${scoped.length === 1 ? "" : "s"}`}
              {loading && " · still loading some records"}
            </p>
            <ul className="ds-gsearch-list" aria-label="Search results">
              {hits.map((h) => (
                <li key={`${h.role}-${h.id}`} className="ds-gsearch-row">
                  <span className="ds-gsearch-row__icon" aria-hidden="true"><Icon name={ROLE_ICON[h.role] ?? "search"} size={16} /></span>
                  <div className="ds-gsearch-row__main">
                    <strong className="ds-cell-clip" title={h.name}>{h.name}</strong>
                    <span className="ds-gsearch-row__sub">
                      {h.role} · <span title={h.id}>{h.id.length > 16 ? `${h.id.slice(0, 14)}…` : h.id}</span>{h.contact && ` · ${h.contact}`}{h.assignment !== "—" && ` · ${h.assignment}`}
                    </span>
                  </div>
                  <div className="ds-gsearch-row__badges">
                    <Badge tone={toneForStatus(statusWord(h.status))}>{statusWord(h.status)}</Badge>
                    {h.exact && <Badge tone="blue">Exact mobile match</Badge>}
                  </div>
                  <div className="ds-gsearch-row__actions">
                    <Button size="sm" onClick={() => { onClose(); onOpen(h.page, h.bookingId); }}>{h.bookingId ? "Open" : "Open profile"}</Button>
                    {h.role !== "Bookings" && h.role !== "Customers" && <Button size="sm" variant="ghost" onClick={() => { onClose(); onOpen("bookings"); }}>View duties</Button>}
                    {h.phone && <a className="ds-btn ds-btn-ghost ds-btn-sm" href={tel(h.phone)}>Call</a>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  );
}

// ── Customer privacy & access ─────────────────────────────────────────────

type PTab = "requests" | "log" | "staff" | "risk" | "recovery" | "policy";

export function PrivacyDialog({ onClose, isSuper }: { onClose: () => void; isSuper: boolean }) {
  const [tab, setTab] = useState<PTab>("requests");
  const [reqs, setRequests] = useState<PrivacyRequest[]>([]);
  const [log, setLogs] = useState<AccessLog[]>([]);
  const [staffCtl, setStaffCtl] = useState<Map<string, StaffPrivacy>>(new Map());
  const [policy, setPolicy] = useState<PrivacyPolicy | null>(null);
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [status, setStatus] = useState("All");
  const [staffFilter, setStaffFilter] = useState("All");
  const [bookingFilter, setBookingFilter] = useState("");
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [editPolicy, setEditPolicy] = useState(false);
  const data = useOfficeData();
  useEffect(() => {
    const u = [subscribeRequests(setRequests), subscribeAccessLog(setLogs), subscribeStaffPrivacy(setStaffCtl), subscribePolicy(setPolicy), subscribeStaffAccounts(setStaff, () => undefined)];
    return () => u.forEach((x) => x());
  }, []);
  const nameOf = (uid: string) => staff.find((s) => s.uid === uid)?.name || (uid === auth.currentUser?.uid ? auth.currentUser?.displayName || "You" : uid.slice(0, 8));
  const codeOf = (id: string) => data.bookings?.find((b) => b.id === id)?.bookingId || id;
  const pending = reqs.filter((r) => r.status === "Pending").length;
  const shownReqs = reqs.filter((r) => status === "All" || r.status === status);
  const shownLog = log.filter((l) => (staffFilter === "All" || l.actorId === staffFilter) && (!bookingFilter || codeOf(l.bookingId).toLowerCase().includes(bookingFilter.toLowerCase())));
  const risks = policy ? riskAlerts(log, policy) : [];
  const exportLog = () => {
    const rows = [["Staff", "Date · IST", "Booking", "Event", "Purpose", "Result", "Platform"], ...shownLog.map((l) => [nameOf(l.actorId), formatDateTime12(l.at as never), codeOf(l.bookingId), "Contact reveal", l.reason, l.action === "reveal" ? "Allowed" : "Denied", l.platform ?? ""])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `privacy_access_log_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Modal title="Customer privacy & access" onClose={onClose} wide>
      <Tabs<PTab> label="Privacy" value={tab} onChange={setTab} tabs={[
        { id: "requests", label: `Requests · ${pending}` }, { id: "log", label: "Access log" }, { id: "staff", label: "Staff controls" },
        { id: "risk", label: "Risk alerts" }, { id: "recovery", label: "Recovery" }, { id: "policy", label: "Policy" },
      ]} />
      {tab === "requests" && (
        <>
          <label className="ds-field mb-3" style={{ maxWidth: 220 }}><span>Status</span><select className="ds-select" value={status} onChange={(e) => setStatus(e.target.value)}>{["All", ...REQUEST_STATUSES].map((s) => <option key={s}>{s}</option>)}</select></label>
          {shownReqs.length === 0 ? <EmptyState /> : (
            <DataTable label="Reveal requests" minWidth={840} fixed hasActions>
              <thead><tr><th>STAFF / TIME</th><th>BOOKING / CUSTOMER</th><th>DETAIL / PURPOSE</th><th>STATUS</th><th className="ds-actions">ACTION</th></tr></thead>
              <tbody>{shownReqs.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.staffName}</strong><small>{formatDateTime12(r.createdAt as never)}</small></td>
                  <td><strong>{r.bookingCode}</strong><small>{r.customerId || "—"}</small></td>
                  <td><strong>{r.field}</strong><small>{r.purpose}</small></td>
                  <td><Badge tone={toneForStatus(r.status)}>{r.status}</Badge>{r.expiresAt && <small>Until {formatDateTime12(r.expiresAt as never)}</small>}</td>
                  <td className="ds-actions"><div>
                    {isSuper && r.status === "Pending" && <><Button size="sm" variant="primary" onClick={() => decideRequest(r.id, "Approved", policy?.activationMinutes ?? 10)}>Approve</Button><Button size="sm" onClick={() => decideRequest(r.id, "Denied", 0)}>Deny</Button></>}
                    {isSuper && r.status === "Approved" && <Button size="sm" onClick={() => decideRequest(r.id, "Revoked", 0)}>Revoke</Button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
        </>
      )}
      {tab === "log" && (
        <>
          <div className="ds-filterbar">
            <label className="ds-field"><span>Staff</span><select className="ds-select" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}><option>All</option>{Array.from(new Set(log.map((l) => l.actorId))).map((u) => <option key={u} value={u}>{nameOf(u)}</option>)}</select></label>
            <label className="ds-field"><span>Booking / Customer ID</span><input className="ds-input" value={bookingFilter} onChange={(e) => setBookingFilter(e.target.value)} /></label>
            <Button icon="download" onClick={exportLog} disabled={!shownLog.length}>Export audit CSV</Button>
          </div>
          {shownLog.length === 0 ? <EmptyState /> : (
            <DataTable label="Access log" minWidth={900} fixed>
              <thead><tr><th>STAFF / DATE · IST</th><th>BOOKING / CUSTOMER</th><th>EVENT / FIELD</th><th>PURPOSE</th><th>RESULT</th></tr></thead>
              <tbody>{shownLog.map((l) => (
                <tr key={l.id}>
                  <td><strong>{nameOf(l.actorId)}</strong><small>{formatDateTime12(l.at as never)}</small></td>
                  <td><strong>{codeOf(l.bookingId)}</strong><small>{l.role}</small></td>
                  <td><strong>{l.role === "admin" ? "Master view" : "Partner view"}</strong><small>Mobile</small></td>
                  <td>{l.reason || "Operational view"}</td>
                  <td><Badge tone={l.action === "reveal" ? "green" : "red"}>{l.action === "reveal" ? "Allowed" : "Denied"}</Badge></td>
                </tr>
              ))}</tbody>
            </DataTable>
          )}
          <p className="text-[11px] text-faint mt-3">Access log · append only · no panel delete action.</p>
        </>
      )}
      {tab === "staff" && (
        staff.length === 0 ? <EmptyState title="Staff accounts are visible to super admins." /> : (
          <DataTable label="Staff privacy controls" minWidth={860} fixed hasActions>
            <thead><tr><th>STAFF / STATUS</th><th>HANDLED BOOKING REVEAL</th><th>REQUEST ACCESS</th><th>COPY CONTROL</th><th className="ds-actions">ACTION</th></tr></thead>
            <tbody>{staff.filter((s) => s.role === "admin").map((s) => {
              const c = staffCtl.get(s.uid) ?? { ...DEFAULT_STAFF, uid: s.uid };
              return (
                <tr key={s.uid}>
                  <td><strong>{s.name || s.email}</strong><small>{s.roleName} · {s.status === "active" ? "Active" : "Inactive"}</small></td>
                  <td>{s.isSuper ? "Master access" : c.handledReveal}</td>
                  <td>{c.requestAccess}</td>
                  <td>{c.copyControl}</td>
                  <td className="ds-actions"><div>
                    <Button size="sm" disabled={!isSuper || s.isSuper} onClick={() => setEditing(s)}>Edit privacy access</Button>
                    <Button size="sm" variant="ghost" disabled={!isSuper || s.uid === auth.currentUser?.uid} onClick={() => void revokeStaffSessions(s.uid).catch(() => undefined)}>Revoke sessions</Button>
                  </div></td>
                </tr>
              );
            })}</tbody>
          </DataTable>
        )
      )}
      {tab === "risk" && (
        risks.length === 0 ? <EmptyState /> : (
          <DataTable label="Risk alerts" minWidth={700} fixed>
            <thead><tr><th>STAFF</th><th>DATE · IST</th><th>REASON</th><th>STATUS</th></tr></thead>
            <tbody>{risks.map((r) => (
              <tr key={r.actorId}><td><strong>{nameOf(r.actorId)}</strong></td><td>{formatDateTime12(r.at)}</td><td>{r.count} distinct bookings within {policy?.anomalyWindow} sec</td><td><Badge tone="red">Review</Badge></td></tr>
            ))}</tbody>
          </DataTable>
        )
      )}
      {tab === "recovery" && (
        <>
          <p className="ds-note mb-4">Recovery requests never disable MFA automatically. A staff member who loses access is re-verified by a super admin and their sign-in is reset from Staff &amp; Access.</p>
          <EmptyState />
        </>
      )}
      {tab === "policy" && policy && (
        <>
          <p className="ds-note mb-4">These controls are enforced by authenticated server endpoints; this sheet records the office policy.</p>
          <dl className="ds-facts" data-cols={2}>
            <div><dt>Reveal duration</dt><dd>{policy.revealSeconds} seconds</dd></div>
            <div><dt>Approval activation window</dt><dd>{policy.activationMinutes} minutes · one record and field</dd></div>
            <div><dt>Unusual access threshold</dt><dd>{policy.anomalyCount} distinct bookings / {policy.anomalyWindow} sec</dd></div>
            <div><dt>Idle session timeout</dt><dd>{policy.idleMinutes} min</dd></div>
            <div><dt>Full customer data</dt><dd>Master only by default</dd></div>
            <div><dt>Access log</dt><dd>Append only · no panel delete action</dd></div>
            <div><dt>Original document downloads</dt><dd>Master only</dd></div>
            <div><dt>Last change</dt><dd>{policy.updatedByName ? `${policy.updatedByName} · ${formatDateTime12(policy.updatedAt as never)}` : "Office defaults"}</dd></div>
          </dl>
          <Button className="mt-4" icon="pencil" disabled={!isSuper} onClick={() => setEditPolicy(true)}>Edit policy</Button>
        </>
      )}
      {editing && <StaffPrivacyDialog staff={editing} current={staffCtl.get(editing.uid) ?? { ...DEFAULT_STAFF, uid: editing.uid }} onClose={() => setEditing(null)} />}
      {editPolicy && policy && <PolicyDialog policy={policy} onClose={() => setEditPolicy(false)} />}
    </Modal>
  );
}

function StaffPrivacyDialog({ staff, current, onClose }: { staff: StaffAccount; current: StaffPrivacy; onClose: () => void }) {
  const [v, setV] = useState(current);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Privacy access · ${staff.name || staff.email}`} onClose={onClose} busy={busy} footer={<Button variant="primary" loading={busy} onClick={async () => { setBusy(true); await saveStaffPrivacy(staff.uid, { handledReveal: v.handledReveal, requestAccess: v.requestAccess, copyControl: v.copyControl }); onClose(); }}>Save privacy access</Button>}>
      <div className="grid gap-4">
        <label className="ds-field"><span>Handled booking reveal</span><select className="ds-select" value={v.handledReveal} onChange={(e) => setV({ ...v, handledReveal: e.target.value as StaffPrivacy["handledReveal"] })}><option>Approval required</option><option>Allowed</option><option>Blocked</option></select></label>
        <label className="ds-field"><span>Request access</span><select className="ds-select" value={v.requestAccess} onChange={(e) => setV({ ...v, requestAccess: e.target.value as StaffPrivacy["requestAccess"] })}><option>Allowed</option><option>Blocked</option></select></label>
        <label className="ds-field"><span>Copy control</span><select className="ds-select" value={v.copyControl} onChange={(e) => setV({ ...v, copyControl: e.target.value as StaffPrivacy["copyControl"] })}><option>Copy button hidden</option><option>Copy allowed</option></select></label>
      </div>
    </Modal>
  );
}

function PolicyDialog({ policy, onClose }: { policy: PrivacyPolicy; onClose: () => void }) {
  const [p, setP] = useState(policy);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (k: keyof PrivacyPolicy, label: string) => (
    <label className="ds-field"><span>{label}</span><input className="ds-input" type="number" min={1} value={p[k] as number} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></label>
  );
  return (
    <Modal title="Privacy & alert policy" onClose={onClose} busy={busy} footer={<Button variant="primary" loading={busy} onClick={async () => {
      if (reason.trim().length < 5) return setError("Record the policy change reason.");
      setBusy(true);
      try { await savePolicy(p, reason.trim()); onClose(); } catch { setError("The policy was not saved."); setBusy(false); }
    }}>Save Master policy</Button>}>
      <div className="ds-form-grid">
        {error && <div className="ds-error" role="alert" data-span="2">{error}</div>}
        {num("revealSeconds", "Reveal duration · seconds")}
        {num("activationMinutes", "Approval activation window · minutes")}
        {num("anomalyCount", "Distinct customer reveal threshold")}
        {num("anomalyWindow", "Detection window · seconds")}
        {num("idleMinutes", "Idle session timeout · minutes")}
        <label className="ds-field" data-span="2"><span>Policy change reason</span><input className="ds-input" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// ── Super Admin card ──────────────────────────────────────────────────────

export function ProfileDialog({ access, name, email, onClose, onNavigate, onSignOut }: { access: AdminAccess; name: string; email: string; onClose: () => void; onNavigate: (p: string) => void; onSignOut: () => void }) {
  return (
    <Modal title={access.isSuper ? "Super Admin" : access.roleName} onClose={onClose}>
      <div className="flex items-start gap-3 mb-4">
        <span className="inline-grid place-items-center w-11 h-11 rounded-lg bg-brand-soft text-brand"><Icon name="shield-check" /></span>
        <div>
          <strong className="block text-[15px] text-ink">NESAM Master Control</strong>
          <span className="block text-[12px] text-muted">{name} · {email}</span>
          <span className="block text-[11px] text-faint mt-1">NSM-SA-{(auth.currentUser?.uid ?? "").slice(0, 6).toUpperCase()}</span>
        </div>
      </div>
      <Badge tone={access.isSuper ? "green" : "blue"}>{access.isSuper ? "Full access" : `${access.permissions.length} areas`}</Badge>
      <p className="text-[12px] text-body mt-3">
        {access.isSuper ? "Company operations, staff permissions, bookings, people, finance and communications." : access.permissions.map((p) => PERMISSION_INFO[p].label).join(", ")}
      </p>
      <div className="flex flex-wrap gap-2 mt-5">
        {access.isSuper && <Button icon="shield-user" onClick={() => { onClose(); onNavigate("staff"); }}>Staff &amp; access</Button>}
        <Button icon="settings" onClick={() => { onClose(); onNavigate("settings"); }}>Company settings</Button>
        <Button variant="ghost" icon="log-out" onClick={onSignOut}>Sign out</Button>
      </div>
    </Modal>
  );
}

// ── Lock workspace ────────────────────────────────────────────────────────

export function LockScreen({ email, onUnlock, onSignOut }: { email: string; onUnlock: () => void; onSignOut: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return onSignOut();
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(email, password));
      onUnlock();
    } catch {
      setError("That password is not correct. Try again or sign out.");
      setBusy(false);
    }
  };
  return (
    <div className="ds-lock" role="dialog" aria-modal="true" aria-label="Workspace locked">
      <form className="ds-lock-card" onSubmit={unlock}>
        <span className="ds-dialog-eyebrow">MASTER ADMIN · OFFICE WORKSPACE</span>
        <h2>Your workspace is locked</h2>
        <p>Unlock workspace — confirm your password to open your workspace.</p>
        <p className="text-[12px] font-semibold text-ink">{email}</p>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <label className="ds-field"><span>Password</span><input className="ds-input" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <Button variant="primary" type="submit" loading={busy} icon="lock-open">Verify &amp; unlock</Button>
        <Button variant="ghost" icon="log-out" onClick={onSignOut}>Sign out</Button>
        <p className="text-[10px] text-faint">No “remember device” bypass · Verification required</p>
      </form>
    </div>
  );
}

// ── Notification sounds ───────────────────────────────────────────────────
// Office: the admin panel's own alerts, shared by every computer once saved. Customer / Driver / Vendor: which of the
// apps' three tones each notification event plays on the phones. One reason, one Save, kept in the change history.

type SoundTab = "office" | SoundAudience;
type AppDraft = Record<SoundAudience, Partial<Record<SoundEvent, AppSound>>>;
const SOUND_TABS: { id: SoundTab; label: string }[] = [{ id: "office", label: "Office" }, { id: "customer", label: "Customer" }, { id: "driver", label: "Driver" }, { id: "vendor", label: "Vendor" }];
const AUDIENCE_NAME: Record<SoundAudience, string> = { customer: "Customer", driver: "Driver", vendor: "Vendor" };
const sameOffice = (a: SoundConfig, b: SoundConfig) => ALERT_KINDS.every((k) => a[k].tone === b[k].tone && a[k].volume === b[k].volume && a[k].on === b[k].on && a[k].repeat === b[k].repeat);
/** Each event's sound: the saved choice, else its default. Events the server does not send are left out. */
const appDraftOf = (saved: AppSoundChoices | undefined): AppDraft => Object.fromEntries(SOUND_AUDIENCES.map((a) => [a, Object.fromEntries(
  SOUND_EVENTS[a].filter((e) => e.sent).map((e) => [e.key, saved?.[a]?.[e.key] ?? e.defaultSound]),
)])) as AppDraft;
const sameRow = (a: AppDraft[SoundAudience], b: AppDraft[SoundAudience]) => Object.keys({ ...a, ...b }).every((k) => a[k as SoundEvent] === b[k as SoundEvent]);
const changeText = (c: SoundChangeRow) => `${c.audience === "office" ? "Office" : AUDIENCE_NAME[c.audience as SoundAudience] ?? c.audience} · ${c.label}${c.field && c.field !== "sound" ? ` · ${c.field}` : ""}: ${c.from} → ${c.to}`;

export function SoundSettingsDialog({ onClose }: { onClose: () => void }) {
  const { soundOn, setSoundOn } = useNotifications();
  const canEdit = useCan("engagement") && useCanDo("Communication", "edit");
  const [tab, setTab] = useState<SoundTab>("office");
  // undefined while loading; null when nothing has been saved for everyone yet.
  const [saved, setSaved] = useState<NotificationSoundsDoc | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const serverOffice = useMemo(() => officeConfigOf(saved?.office), [saved]);
  const serverApps = useMemo(() => appDraftOf(saved?.apps), [saved]);
  const [cfg, setCfg] = useState<SoundConfig>(loadSoundConfig);
  const [officeTouched, setOfficeTouched] = useState(false);
  const [apps, setApps] = useState<AppDraft>(() => appDraftOf(undefined));
  const [appsTouched, setAppsTouched] = useState(false);
  const [localExists, setLocalExists] = useState(hasLocalSoundConfig);
  const [custom, setCustom] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<(typeof ALERT_KINDS)[number] | null>(null);
  const previewRef = useRef<SoundPreview | null>(null);

  const stopPreview = useCallback(() => {
    const playback = previewRef.current;
    previewRef.current = null;
    playback?.stop();
    setTesting(null);
    stopAppTone();
  }, []);

  useEffect(() => subscribeNotificationSounds((d) => { setSaved(d); setLoadError(null); }, (m) => { setLoadError(m); setSaved((cur) => (cur === undefined ? null : cur)); }), []);
  // What is saved fills the window until it is edited here.
  useEffect(() => { if (saved !== undefined && !officeTouched) setCfg(serverOffice ?? loadLocalSoundConfig()); }, [saved, serverOffice, officeTouched]);
  useEffect(() => { if (saved !== undefined && !appsTouched) setApps(serverApps); }, [saved, serverApps, appsTouched]);

  useEffect(() => {
    let mounted = true;
    void listCustomSounds().then((rows) => { if (mounted) setCustom(rows); }).catch(() => {
      if (mounted) setMsg("Uploaded sounds could not be loaded. Try reopening these settings.");
    });
    return () => {
      mounted = false;
      const playback = previewRef.current;
      previewRef.current = null;
      playback?.stop();
      stopAppTone();
    };
  }, []);

  useEffect(() => { if (!soundOn) { const p = previewRef.current; previewRef.current = null; p?.stop(); setTesting(null); } }, [soundOn]);

  const edited = () => { setMsg(null); setOkMsg(null); };
  const set = (k: (typeof ALERT_KINDS)[number], patch: Partial<SoundConfig[typeof k]>) => {
    stopPreview();
    edited();
    setOfficeTouched(true);
    setCfg((current) => ({ ...current, [k]: { ...current[k], ...patch } }));
  };
  const setApp = (a: SoundAudience, e: SoundEvent, s: AppSound) => {
    edited();
    setAppsTouched(true);
    setApps((cur) => ({ ...cur, [a]: { ...cur[a], [e]: s } }));
  };

  const test = (k: (typeof ALERT_KINDS)[number]) => {
    stopPreview();
    if (!soundOn || !cfg[k].on) {
      setMsg("Enable sound and this alert to test it.");
      return;
    }
    if (cfg[k].volume <= 0) {
      setMsg("Increase the volume above 0 to test this sound.");
      return;
    }
    setMsg(null);
    const playback = startSoundPreview(cfg[k].tone, cfg[k].volume, ALERT_SECONDS[k]);
    previewRef.current = playback;
    setTesting(k);
    void playback.finished.catch((error: unknown) => {
      if (previewRef.current === playback) setMsg(error instanceof Error ? error.message : "Sound preview failed.");
    }).finally(() => {
      if (previewRef.current !== playback) return;
      previewRef.current = null;
      setTesting(null);
    });
  };
  const testApp = (s: AppSound) => {
    stopPreview();
    setMsg(null);
    void playAppTone(s).catch((err: unknown) => setMsg(err instanceof Error ? err.message : "The tone could not be played."));
  };

  // A first shared save, or any change from what is shared, is sent; the office part is never sent just because the window was opened.
  const officeDirty = officeTouched && (!serverOffice || !sameOffice(cfg, serverOffice));
  const changedAudiences = SOUND_AUDIENCES.filter((a) => !sameRow(apps[a], serverApps[a]));
  const appsDirty = appsTouched && changedAudiences.length > 0;
  const dirty = officeDirty || appsDirty;
  const local = localExists ? loadLocalSoundConfig() : null;
  const localDiffers = !!local && (!serverOffice || !sameOffice(local, serverOffice));
  const usesUpload = ALERT_KINDS.some((k) => cfg[k].tone.startsWith("custom:"));

  const reviewLocal = () => {
    if (!local) return;
    stopPreview();
    edited();
    setCfg(local);
    setOfficeTouched(true);
    setTab("office");
    setOkMsg("This browser's office sounds are loaded below. Check them, write a reason and Save to share them with every computer.");
  };
  const removeLocal = () => {
    clearLocalSoundConfig();
    setLocalExists(false);
    if (!officeTouched) setCfg(serverOffice ?? DEFAULT_SOUNDS);
  };
  const resetTab = () => {
    stopPreview();
    edited();
    if (tab === "office") { setCfg(DEFAULT_SOUNDS); setOfficeTouched(true); }
    else { setApps((cur) => ({ ...cur, [tab]: appDraftOf(undefined)[tab] })); setAppsTouched(true); }
  };

  const save = async () => {
    if (!canEdit || busy || !dirty) return;
    if (reason.trim().length < 5) { setMsg("Write the reason for this change (at least 5 characters)."); return; }
    stopPreview();
    setBusy(true);
    setMsg(null);
    setOkMsg(null);
    try {
      await saveNotificationSounds({
        expectedVersion: saved?.version ?? 0, reason: reason.trim(),
        ...(appsDirty ? { apps: Object.fromEntries(changedAudiences.map((a) => [a, apps[a]])) as AppSoundChoices } : {}),
        ...(officeDirty ? { office: cfg } : {}),
      });
      if (officeDirty) {
        // This computer now follows the shared setting; its own copy is no longer used.
        setSharedSoundConfig(cfg);
        clearLocalSoundConfig();
        setLocalExists(false);
      }
      setOfficeTouched(false);
      setAppsTouched(false);
      setReason("");
      setOkMsg(`Saved for everyone.${officeDirty ? " Every computer now plays these office alerts." : ""}${appsDirty ? " Phones get the new tones within about a minute." : ""}`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "The sounds were not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty && !window.confirm("Close without saving your sound changes?")) return;
    stopPreview();
    onClose();
  };
  const history = [...(saved?.history ?? [])].reverse().slice(0, 15);
  const audience = tab === "office" ? null : tab;

  return (
    <Modal title="Notification sounds" onClose={close} wide footNote={canEdit ? "Saved for everyone · reason required" : "View only"}
      footer={canEdit ? (
        <>
          <Button onClick={resetTab} disabled={busy}>Reset this tab to defaults</Button>
          <input className="ds-input" style={{ width: 260 }} value={reason} maxLength={300} placeholder="Reason for change" aria-label="Reason for change" onChange={(e) => { setReason(e.target.value); setMsg(null); }} />
          <Button variant="primary" loading={busy} disabled={!dirty || saved === undefined} onClick={() => void save()}>Save changes</Button>
        </>
      ) : <Button onClick={close}>Close</Button>}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div><strong className="text-[15px] text-ink">Notification sounds</strong><p className="text-[12px] text-muted">Office alerts on every computer, and the tone each notification plays on the customer, driver and vendor apps.</p></div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-semibold text-ink" title="Only on this computer">{soundOn ? "Sound on" : "Sound off"}</span>
          <button type="button" role="switch" aria-checked={soundOn} aria-label={soundOn ? "Turn sound off on this computer" : "Turn sound on on this computer"} onClick={() => { stopPreview(); setSoundOn(!soundOn); }}
            className="relative inline-flex h-6 w-11 items-center rounded-full transition" style={{ background: soundOn ? "var(--color-brand)" : "#cfd6df" }}>
            <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition" style={{ transform: `translateX(${soundOn ? 22 : 2}px)` }} />
          </button>
        </div>
      </div>
      <Tabs tabs={SOUND_TABS} value={tab} onChange={(t) => { stopPreview(); setTab(t); }} label="Notification sounds for" className="mb-3" />
      {loadError && <p className="text-[12px] text-bad mb-3" role="alert">The shared sounds could not be loaded: {loadError}</p>}
      {!canEdit && <p className="text-[12px] text-muted mb-3">Changing these needs Engagement access with Communication · edit. You can still test the sounds and turn sound off on this computer.</p>}
      {msg && <p className="text-[12px] text-bad mb-3" role="alert">{msg}</p>}
      {okMsg && <p className="text-[12px] text-ok mb-3" role="status">{okMsg}</p>}

      {tab === "office" ? (
        <>
          <p className="text-[12px] text-muted mb-3">
            {saved === undefined ? "Loading the shared office sounds…"
              : serverOffice ? `Shared by every computer${saved?.updatedByName ? ` · last saved by ${saved.updatedByName}` : ""}${saved?.updatedAt?.toDate ? ` on ${formatDateTime12(saved.updatedAt.toDate())}` : ""}.`
              : "Not shared yet: each computer uses its own office sounds. Saving here shares them with every computer."}
          </p>
          {saved !== undefined && localDiffers && (
            <div className="ds-panel ds-panel-pad mb-3 flex flex-wrap items-center justify-between gap-3" role="status">
              <p className="text-[12px] text-ink m-0">{serverOffice
                ? "This browser also has its own older office sounds that differ from the shared ones. The shared ones are in use."
                : "This browser has its own saved office sounds (shown below). They are used on this computer only."}</p>
              <div className="flex gap-2">
                {canEdit && <Button size="sm" onClick={reviewLocal}>{serverOffice ? "Review browser copy" : "Review & share these"}</Button>}
                {serverOffice && <Button size="sm" onClick={removeLocal}>Remove browser copy</Button>}
              </div>
            </div>
          )}
            <DataTable label="Office alert sounds" minWidth={860} fixed hideTools>
              <thead><tr><th>ALERT / DURATION</th><th>TONE</th><th>VOLUME</th><th>SOUND</th><th>REPEAT</th><th>PREVIEW</th></tr></thead>
              <tbody>{ALERT_KINDS.map((k) => {
                const hint = !soundOn || !cfg[k].on ? "Enable sound to test" : cfg[k].volume <= 0 ? "Increase volume to test" : "Test the current tone and volume";
                return (
                  <tr key={k}>
                    <td><strong>{k}</strong><small>{ALERT_SECONDS[k]} seconds</small></td>
                    <td><select className="ds-select" value={cfg[k].tone} disabled={!canEdit} onChange={(e) => set(k, { tone: e.target.value })}>{PRESET_TONES.map((t) => <option key={t}>{t}</option>)}{custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}{cfg[k].tone.startsWith("custom:") && !custom.some((c) => `custom:${c.id}` === cfg[k].tone) ? <option value={cfg[k].tone}>Uploaded sound (not on this computer)</option> : null}</select></td>
                    <td><input type="range" min={0} max={100} value={cfg[k].volume} disabled={!canEdit} aria-label={`${k} volume`} onChange={(e) => set(k, { volume: Number(e.target.value) })} /> <small>{cfg[k].volume}%</small></td>
                    <td><label className="ds-check"><input type="checkbox" checked={cfg[k].on} disabled={!canEdit} onChange={(e) => set(k, { on: e.target.checked })} />{cfg[k].on ? "On" : "Off"}</label></td>
                    <td><select className="ds-select" value={cfg[k].repeat} disabled={!canEdit} onChange={(e) => set(k, { repeat: e.target.value as SoundConfig[typeof k]["repeat"] })}>{REPEATS.map((r) => <option key={r}>{r}</option>)}</select></td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Previews work without edit access too. */}
                        <Button type="button" size="sm" icon="play" disabled={!soundOn || !cfg[k].on || cfg[k].volume <= 0 || testing === k} title={hint} aria-label={`Live Test: ${k}`} onClick={() => test(k)}>Live Test</Button>
                        {testing === k && <Button type="button" size="sm" aria-label={`Stop preview: ${k}`} onClick={stopPreview}>Stop</Button>}
                      </div>
                      <small role="status">{testing === k ? "Testing current tone and volume…" : (!soundOn || !cfg[k].on || cfg[k].volume <= 0) ? hint : ""}</small>
                    </td>
                  </tr>
                );
              })}</tbody>
            </DataTable>
          {usesUpload && <p className="text-[11px] text-muted mt-2">An uploaded sound is kept only in the browser it was uploaded in. Other computers play that alert's default tone instead.</p>}
          {canEdit && (
            <div className="ds-panel ds-panel-pad mt-4 flex flex-wrap items-center justify-between gap-3">
              <div><strong className="text-[13px] text-ink">Upload own sound</strong><p className="text-[11px] text-muted">MP3 / WAV · up to 2 MB · up to 60 seconds · {custom.length}/5 uploaded · this browser only</p></div>
              <label className="ds-btn ds-btn-secondary cursor-pointer"><Icon name="upload" size={14} />Upload sound<input type="file" accept="audio/mpeg,audio/wav" className="sr-only" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try { await addCustomSound(f); setCustom(await listCustomSounds()); setMsg(null); } catch (err) { setMsg(err instanceof Error ? err.message : "Upload failed."); }
              }} /></label>
            </div>
          )}
          <p className="text-[11px] text-faint mt-3">Alert duration stays fixed: New 5s · Urgent 10s · Unassigned 5s · Follow-up 2s. Live Test plays one bounded preview; repeat choices are saved for real alerts. Urgent plays first; sounds do not overlap. Ownership ends urgent attention; pending assignment reminders continue until driver + cab are confirmed. Sound on / off above is only for this computer.</p>
        </>
      ) : audience ? (
        <>
          <DataTable label={`${AUDIENCE_NAME[audience]} app notification sounds`} minWidth={680} fixed hideTools>
            <thead><tr><th>EVENT</th><th>SOUND ON THE PHONE</th><th>TEST</th></tr></thead>
            <tbody>{SOUND_EVENTS[audience].map((e) => {
              const value = apps[audience][e.key] ?? e.defaultSound;
              return (
                <tr key={e.key}>
                  <td><strong>{e.label}</strong><small>{e.covers}</small></td>
                  <td>{e.sent ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select className="ds-select" value={value} disabled={!canEdit} aria-label={`${AUDIENCE_NAME[audience]} · ${e.label} sound`} onChange={(ev) => setApp(audience, e.key, ev.target.value as AppSound)}>
                        {APP_SOUNDS.map((s) => <option key={s} value={s}>{APP_SOUND_LABEL[s]}{s === e.defaultSound ? " (default)" : ""}</option>)}
                      </select>
                      {value !== e.defaultSound ? <Badge tone="amber">Changed</Badge> : null}
                    </div>
                  ) : <Badge tone="neutral">Not sent yet</Badge>}</td>
                  <td><Button type="button" size="sm" icon="play" disabled={!e.sent} aria-label={`Test ${AUDIENCE_NAME[audience]} · ${e.label}`} onClick={() => testApp(value)}>Test</Button></td>
                </tr>
              );
            })}</tbody>
          </DataTable>
          <p className="text-[11px] text-faint mt-3">Test plays the tone here in this browser only; nothing is sent to anyone. The {AUDIENCE_NAME[audience].toLowerCase()} app has these three tones built in, so a change reaches phones within about a minute, also when the app is closed. Someone who changed a tone in their phone's notification settings hears their own choice. Notifications not listed here keep their sound.</p>
        </>
      ) : null}

      {history.length > 0 && (
        <details className="mt-4">
          <summary className="text-[12px] font-semibold text-ink cursor-pointer">Change history ({saved?.history?.length ?? 0})</summary>
          <ul className="mt-2 space-y-2 text-[12px]">
            {history.map((h, i) => (
              <li key={i} className="ds-panel ds-panel-pad">
                <strong>{h.at?.toDate ? formatDateTime12(h.at.toDate()) : "—"}</strong> · {h.byName || "Staff"} · <span className="text-muted">{h.reason}</span>
                <ul className="mt-1 text-muted">{(h.changes ?? []).map((c, j) => <li key={j}>{changeText(c)}</li>)}</ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}
