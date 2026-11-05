import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EmailAuthProvider, reauthenticateWithCredential } from "firebase/auth";
import { auth } from "../../services/firebase";
import { Modal } from "../Feedback";
import { Badge, Button, DataTable, EmptyState, Icon, Tabs, toneForStatus } from "../ui";
import { useCustomers, useOfficeData } from "../../hooks/useOfficeData";
import type { AdminAccess } from "../../config/permissions";
import { PERMISSION_INFO } from "../../config/permissions";
import { subscribeStaffAccounts, type StaffAccount } from "../../services/staffService";
import {
  DEFAULT_STAFF, REQUEST_STATUSES, decideRequest, riskAlerts, savePolicy, saveStaffPrivacy, subscribeAccessLog, subscribePolicy,
  subscribeRequests, subscribeStaffPrivacy, type AccessLog, type PrivacyPolicy, type PrivacyRequest, type StaffPrivacy,
} from "../../services/privacyService";
import {
  ALERT_KINDS, ALERT_SECONDS, DEFAULT_SOUNDS, PRESET_TONES, REPEATS, addCustomSound, listCustomSounds, loadSoundConfig, previewTone, saveSoundConfig,
  type SoundConfig,
} from "../../utils/notificationSound";
import { useNotifications } from "../NotificationHost";
import { formatDateTime12 } from "../../utils/time";
import { revokeStaffSessions } from "../../services/staffSessionService";

/** Partner status in the reference words (Active · Pending · Suspended …). */
const statusWord = (v: string) => (/^(approved|active)$/i.test(v) ? "Active" : /pending/i.test(v) ? "Pending" : v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase().replace(/_/g, " ") : "—");
const digits = (v: string) => v.replace(/\D/g, "").slice(-10);
const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

// ── Search all records ────────────────────────────────────────────────────

interface Hit { role: string; status: string; exact: boolean; name: string; record?: string; id: string; contact: string; assignment: string; page: string; bookingId?: string; phone?: string }

export function SearchDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (page: string, bookingId?: string) => void }) {
  const data = useOfficeData();
  const customers = useCustomers();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const hits = useMemo<Hit[]>(() => {
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
    return out.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 60);
  }, [submitted, data.vendors, data.drivers, data.bookings, customers.rows]);
  return (
    <Modal title="Search all records" onClose={onClose} wide>
      <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }} className="flex gap-2 mb-2">
        <div className="ds-search" style={{ flex: 1 }}>
          <Icon name="search" />
          <input autoFocus className="ds-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor / Driver Partner name, mobile, ID, or Booking ID" aria-label="Search records" />
        </div>
        <Button variant="primary" type="submit" icon="search">Search</Button>
      </form>
      <p className="text-[11px] text-faint mb-4">Search with +91, spaces or the 10-digit mobile. Exact partner mobile matches appear first.</p>
      {!submitted ? <EmptyState icon="search" title="Enter a name, mobile number or permanent ID." hint="" /> : hits.length === 0 ? <EmptyState /> : (
        <DataTable label="Search results" minWidth={880} fixed hasActions>
          <colgroup><col style={{ width: 160 }} /><col style={{ width: 220 }} /><col style={{ width: 180 }} /><col style={{ width: 110 }} /><col style={{ width: 210 }} /></colgroup>
          <thead><tr><th>ROLE / STATUS</th><th>NAME / RECORD</th><th>ID / CONTACT</th><th>ASSIGNMENT</th><th className="ds-actions">ACTION</th></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={`${h.role}-${h.id}`}>
                <td><strong>{h.role}</strong><div className="flex gap-1 mt-1 flex-wrap"><Badge tone={toneForStatus(statusWord(h.status))}>{statusWord(h.status)}</Badge>{h.exact && <Badge tone="blue">Exact mobile match</Badge>}</div></td>
                <td><strong className="ds-cell-clip">{h.name}</strong></td>
                <td><strong>{h.id.length > 16 ? `${h.id.slice(0, 14)}…` : h.id}</strong><small>{h.contact}</small></td>
                <td>{h.assignment}</td>
                <td className="ds-actions"><div>
                  <Button size="sm" onClick={() => { onClose(); onOpen(h.page, h.bookingId); }}>{h.bookingId ? "Open" : "Open profile"}</Button>
                  {h.role !== "Bookings" && h.role !== "Customers" && <Button size="sm" variant="ghost" onClick={() => { onClose(); onOpen("bookings"); }}>View duties</Button>}
                  {h.phone && <a className="ds-btn ds-btn-ghost ds-btn-sm" href={tel(h.phone)}>Call</a>}
                </div></td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
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
    <Modal eyebrow="NESAM" title={access.isSuper ? "Super Admin" : access.roleName} onClose={onClose}>
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

export function SoundSettingsDialog({ onClose }: { onClose: () => void }) {
  const { soundOn, setSoundOn } = useNotifications();
  const [cfg, setCfg] = useState<SoundConfig>(loadSoundConfig);
  const [custom, setCustom] = useState<{ id: string; name: string }[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { listCustomSounds().then(setCustom); }, []);
  const set = (k: (typeof ALERT_KINDS)[number], patch: Partial<SoundConfig[typeof k]>) => setCfg({ ...cfg, [k]: { ...cfg[k], ...patch } });
  return (
    <Modal title="Notification sounds" onClose={onClose} wide footNote="Office defaults · 5 preset tones" footer={<><Button onClick={() => setCfg(DEFAULT_SOUNDS)}>Reset defaults</Button><Button variant="primary" onClick={() => { saveSoundConfig(cfg); onClose(); }}>Save changes</Button></>}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div><strong className="text-[15px] text-ink">Notification sounds</strong><p className="text-[12px] text-muted">Choose a sound for each alert.</p></div>
        <div className="flex items-center gap-2"><Badge tone={soundOn ? "green" : "neutral"}>{soundOn ? "Sound on" : "Sound off"}</Badge><Button size="sm" icon={soundOn ? "volume-x" : "volume-2"} onClick={() => setSoundOn(!soundOn)}>{soundOn ? "Turn sound off" : "Enable sound"}</Button></div>
      </div>
      <DataTable label="Alert sounds" minWidth={860} fixed hideTools>
        <thead><tr><th>ALERT / DURATION</th><th>TONE</th><th>VOLUME</th><th>SOUND</th><th>REPEAT</th><th>PREVIEW</th></tr></thead>
        <tbody>{ALERT_KINDS.map((k) => (
          <tr key={k}>
            <td><strong>{k}</strong><small>{ALERT_SECONDS[k]} seconds</small></td>
            <td><select className="ds-select" value={cfg[k].tone} onChange={(e) => set(k, { tone: e.target.value })}>{PRESET_TONES.map((t) => <option key={t}>{t}</option>)}{custom.map((c) => <option key={c.id} value={`custom:${c.id}`}>{c.name}</option>)}</select></td>
            <td><input type="range" min={0} max={100} value={cfg[k].volume} aria-label={`${k} volume`} onChange={(e) => set(k, { volume: Number(e.target.value) })} /> <small>{cfg[k].volume}%</small></td>
            <td><label className="ds-check"><input type="checkbox" checked={cfg[k].on} onChange={(e) => set(k, { on: e.target.checked })} />{cfg[k].on ? "On" : "Off"}</label></td>
            <td><select className="ds-select" value={cfg[k].repeat} onChange={(e) => set(k, { repeat: e.target.value as SoundConfig[typeof k]["repeat"] })}>{REPEATS.map((r) => <option key={r}>{r}</option>)}</select></td>
            <td><Button size="sm" icon="play" onClick={() => previewTone(cfg[k].tone, cfg[k].volume, ALERT_SECONDS[k])}>Test sound</Button></td>
          </tr>
        ))}</tbody>
      </DataTable>
      <div className="ds-panel ds-panel-pad mt-4 flex flex-wrap items-center justify-between gap-3">
        <div><strong className="text-[13px] text-ink">Upload own sound</strong><p className="text-[11px] text-muted">MP3 / WAV · up to 2 MB · up to 60 seconds · {custom.length}/5 uploaded</p>{msg && <p className="text-[11px] text-bad">{msg}</p>}</div>
        <label className="ds-btn ds-btn-secondary cursor-pointer"><Icon name="upload" size={14} />Upload sound<input type="file" accept="audio/mpeg,audio/wav" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { await addCustomSound(f); setCustom(await listCustomSounds()); setMsg(null); } catch (err) { setMsg(err instanceof Error ? err.message : "Upload failed."); }
        }} /></label>
      </div>
      <p className="text-[11px] text-faint mt-3">Alert duration stays fixed: New 5s · Urgent 10s · Unassigned 5s. Urgent plays first; sounds do not overlap. Ownership ends urgent attention; pending assignment reminders continue until driver + cab are confirmed.</p>
    </Modal>
  );
}
