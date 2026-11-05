import { useEffect, useMemo, useState } from "react";
import { auth } from "../services/firebase";
import {
  StaffActionError,
  approveAdminRequest,
  deleteStaffRole,
  rejectAdminRequest,
  saveStaffRole,
  subscribeAuditLog,
  subscribeLegacyStaff,
  subscribeStaffAccounts,
  subscribeStaffRoles,
  updateAdminAccess,
  validateRole,
  type AuditEntry,
  type LegacyStaffRecord,
  type StaffAccount,
  type StaffRole,
} from "../services/staffService";
import { DUTY_ACTIONS, PERMISSIONS, PERMISSION_INFO, STAFF_MODULES, STAFF_ROLE, STAFF_STATUSES, SUPER_ADMIN_ROLE, type Permission, type StaffStatus } from "../config/permissions";
import StaffAccessEditor from "../components/staff/StaffAccessEditor";
import StaffProfilePanel, { statusTone } from "../components/staff/StaffProfilePanel";
import { migrateLegacyAdmins, type LegacyAdminReport, type StaffSaveResult } from "../services/staffService";
import { Badge, Button } from "../components/ui";
import { ConfirmDialog, ErrorBanner, Modal, Toast, useToast } from "../components/Feedback";
import { formatDateTime12, formatShortDateTime12, formatHourLabel } from "../utils/time";

type Tab = "staff-ids" | "accounts" | "requests" | "roles" | "audit";

const errText = (e: unknown) => (e instanceof StaffActionError ? e.message : "Something went wrong. Please try again.");
const pill = (active: boolean) =>
  `px-2 py-0.5 rounded-full text-[11px] font-semibold border ${active ? "text-green-700 bg-green-50 border-green-200" : "text-gray-600 bg-gray-100 border-gray-200"}`;

const AUDIT_LABELS: Record<string, string> = {
  admin_approved: "Approved access request",
  admin_rejected: "Declined access request",
  admin_access_changed: "Changed staff access",
  role_created: "Created role",
  role_updated: "Edited role",
  role_deleted: "Deleted role",
  staff_profile_created: "Created Staff ID",
  staff_profile_updated: "Changed Staff ID profile & access",
  staff_status_changed: "Changed Staff ID status",
  staff_sessions_revoked: "Revoked all sessions",
  staff_session_ended: "Ended a session",
};

export default function StaffRoles() {
  const me = auth.currentUser?.uid || "";
  const [tab, setTab] = useState<Tab>("staff-ids");
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [legacy, setLegacy] = useState<LegacyStaffRecord[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { toast, show: showToast } = useToast();

  useEffect(() => {
    setLoadError(null);
    const unsubs = [
      subscribeStaffAccounts(setAccounts, setLoadError),
      subscribeStaffRoles(setRoles, setLoadError),
      subscribeLegacyStaff(setLegacy, setLoadError),
      subscribeAuditLog(setAudit, setLoadError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const staff = useMemo(() => (accounts ?? []).filter((a) => a.role === "admin"), [accounts]);
  const staffIds = useMemo(() => staff.filter((a) => a.staffRole === STAFF_ROLE && a.profile), [staff]);
  const requests = useMemo(() => (accounts ?? []).filter((a) => a.role === "pending"), [accounts]);
  const openRequests = requests.filter((r) => r.status !== "rejected");
  const holders = (roleId: string) => staff.filter((s) => s.staffRole === roleId).length;
  const roleOptions = [{ id: SUPER_ADMIN_ROLE, name: "Super Admin" }, ...roles];

  // ── Account actions ──────────────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ account: StaffAccount; status: "active" | "inactive" } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const run = async (id: string, work: () => Promise<void>, done: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await work();
      showToast(done);
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async () => {
    if (!confirm || busyId) return;
    setBusyId(confirm.account.uid);
    setConfirmError(null);
    try {
      await updateAdminAccess(confirm.account.uid, { status: confirm.status });
      showToast(`${confirm.account.name || confirm.account.email} is now ${confirm.status === "active" ? "active" : "deactivated"}.`);
      setConfirm(null);
    } catch (e) {
      setConfirmError(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  // ── Staff IDs ────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<"All" | StaffStatus>("All");
  const [editorFor, setEditorFor] = useState<{ uid: string | null } | null>(null);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ name: string; email: string; result: StaffSaveResult; created?: boolean } | null>(null);
  // Always the live record, so a save elsewhere refreshes the open profile and its version.
  const profileAccount = staffIds.find((a) => a.uid === profileUid) ?? null;
  const editorAccount = editorFor?.uid ? staffIds.find((a) => a.uid === editorFor.uid) ?? null : null;
  const listedIds = staffIds.filter((a) => statusFilter === "All" || a.profile!.accountStatus === statusFilter);

  // ── Legacy Master records (no staffRole) and unrecognised records ────────
  const legacyMasters = staff.filter((a) => a.legacyMaster);
  const unrecognised = staff.filter((a) => a.unrecognised);
  const [legacyReport, setLegacyReport] = useState<LegacyAdminReport | null>(null);
  const [legacyBusy, setLegacyBusy] = useState(false);
  const runLegacy = async (dryRun: boolean) => {
    if (legacyBusy) return;
    setLegacyBusy(true);
    try {
      const r = await migrateLegacyAdmins(dryRun);
      setLegacyReport(r);
      showToast(dryRun ? `Preview: ${r.legacyMaster} record(s) would be made explicit Super Admins.` : `${r.converted} record(s) converted. ${r.remaining} remaining.`);
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setLegacyBusy(false);
    }
  };

  // ── Requests ─────────────────────────────────────────────────────────────
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<StaffAccount | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [declineError, setDeclineError] = useState<string | null>(null);

  const decline = async () => {
    if (!declining || busyId) return;
    if (declineReason.trim().length < 5) {
      setDeclineError("Give a reason of at least 5 characters.");
      return;
    }
    setBusyId(declining.uid);
    setDeclineError(null);
    try {
      await rejectAdminRequest(declining.uid, declineReason);
      showToast(`Request from ${declining.email} declined.`);
      setDeclining(null);
      setDeclineReason("");
    } catch (e) {
      setDeclineError(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  // ── Roles ────────────────────────────────────────────────────────────────
  const [editing, setEditing] = useState<{ id: string | null; name: string; permissions: Permission[] } | null>(null);
  const [roleErrors, setRoleErrors] = useState<{ name?: string; permissions?: string; form?: string }>({});
  const [savingRole, setSavingRole] = useState(false);
  const [deletingRole, setDeletingRole] = useState<StaffRole | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const submitRole = async () => {
    if (!editing || savingRole) return;
    const e = validateRole(editing.name, editing.permissions, roles, editing.id);
    setRoleErrors(e);
    if (Object.keys(e).length) return;
    setSavingRole(true);
    try {
      await saveStaffRole(editing.name, editing.permissions, editing.id);
      showToast(editing.id ? `Role "${editing.name.trim()}" updated for every account holding it.` : `Role "${editing.name.trim()}" created.`);
      setEditing(null);
    } catch (err) {
      setRoleErrors({ form: errText(err) });
    } finally {
      setSavingRole(false);
    }
  };

  const removeRole = async () => {
    if (!deletingRole || busyId) return;
    setBusyId(deletingRole.id);
    setDeleteError(null);
    try {
      await deleteStaffRole(deletingRole.id);
      showToast(`Role "${deletingRole.name}" deleted.`);
      setDeletingRole(null);
    } catch (e) {
      setDeleteError(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "staff-ids", label: "Staff IDs", count: staffIds.length },
    { id: "accounts", label: "All admin accounts", count: staff.length },
    { id: "requests", label: "Access requests", count: openRequests.length },
    { id: "roles", label: "Roles", count: roles.length },
    { id: "audit", label: "Audit log" },
  ];
  const selectCls = "px-2 py-1.5 border border-line rounded-lg text-[12px] bg-white disabled:opacity-50";

  return (
    <div className="p-6 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <div>
        <h1 className="text-lg font-bold text-ink">Staff &amp; Access</h1>
        <p className="text-[12px] text-muted">
          Create individual Staff IDs and grant only the access each person needs: module actions, duty permissions, account
          controls and sensitive-data rights. Older role-based accounts and sign-up requests stay under their own tabs. Every
          grant is enforced by the server and the database rules, not only by this panel.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border ${tab === t.id ? "bg-ink text-white border-ink" : "bg-white text-body border-line"}`}
          >
            {t.label}
            {t.count !== undefined && <span className="ml-1.5 opacity-70">{t.count}</span>}
          </button>
        ))}
      </div>

      {accounts === null && !loadError && <div className="text-[12px] text-faint">Loading staff…</div>}

      {accounts !== null && tab === "staff-ids" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["All", ...STAFF_STATUSES] as const).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                aria-pressed={statusFilter === f}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold border ${statusFilter === f ? "bg-ink text-white border-ink" : "bg-white text-body border-line"}`}
              >
                {f} {f === "All" ? staffIds.length : staffIds.filter((a) => a.profile!.accountStatus === f).length}
              </button>
            ))}
            <span className="flex-1" />
            <Button variant="primary" icon="user-round-plus" onClick={() => setEditorFor({ uid: null })}>Add staff</Button>
          </div>
          <div className="bg-white rounded-xl border border-line overflow-x-auto">
            <table className="w-full min-w-[860px] text-[12px]">
              <thead>
                <tr className="bg-surface-2 border-b border-line text-[11px] text-faint uppercase">
                  {["Staff", "Contact", "Preset / branch", "Access", "Status", ""].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listedIds.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-faint">{staffIds.length ? "No Staff IDs with this status." : "No Staff IDs yet. Add staff to create one."}</td></tr>
                )}
                {listedIds.map((a) => {
                  const p = a.profile!;
                  const modules = STAFF_MODULES.filter((m) => p.matrix.modules[m]?.includes("view")).length;
                  return (
                    <tr key={a.uid} className="border-b border-hover last:border-0">
                      <td className="px-4 py-3"><strong className="text-ink">{a.name || "—"}</strong><span className="block text-[11px] text-faint">{p.staffCode}</span></td>
                      <td className="px-4 py-3">{p.phone || "—"}<span className="block text-[11px] text-muted">{a.username || a.email}</span>{(a.contactEmail || p.contactEmail) && <span className="block text-[11px] text-muted">{a.contactEmail || p.contactEmail}</span>}</td>
                      <td className="px-4 py-3">{p.preset}<span className="block text-[11px] text-muted">{p.branch || "—"}</span></td>
                      <td className="px-4 py-3">{modules} module{modules === 1 ? "" : "s"}<span className="block text-[11px] text-muted">{p.duty.length} of {DUTY_ACTIONS.length} duty actions</span></td>
                      <td className="px-4 py-3"><Badge tone={statusTone(p.accountStatus)}>{p.accountStatus}</Badge></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setProfileUid(a.uid)}>View</Button>{" "}
                        <Button size="sm" onClick={() => setEditorFor({ uid: a.uid })}>Edit access</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {accounts !== null && tab === "accounts" && (legacyMasters.length > 0 || unrecognised.length > 0) && (
        <div role="status" className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-[12px] text-amber-900 space-y-2">
          {legacyMasters.length > 0 && (
            <p>
              <strong>{legacyMasters.length} Super Admin account(s)</strong> are Master only by the pre-roles default (no role recorded):{" "}
              {legacyMasters.map((a) => a.email || a.name).join(", ")}. Converting records the role explicitly; nothing else changes.
            </p>
          )}
          {unrecognised.length > 0 && (
            <p>
              <strong>{unrecognised.length} admin record(s)</strong> have access data but no recognised role and get no access:{" "}
              {unrecognised.map((a) => a.email || a.name || a.uid).join(", ")}. Give them a role or a Staff ID.
            </p>
          )}
          {legacyMasters.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={legacyBusy} onClick={() => void runLegacy(true)}>Preview conversion</Button>
              <Button size="sm" variant="primary" disabled={legacyBusy || !legacyReport?.dryRun} onClick={() => void runLegacy(false)}>Convert previewed records</Button>
            </div>
          )}
          {legacyReport && (
            <p className="text-[11px]">
              {legacyReport.dryRun ? "Preview" : "Result"}: {legacyReport.explicitMaster} explicit · {legacyReport.legacyMaster} legacy Master · {legacyReport.converted} converted ·{" "}
              {legacyReport.remaining} remaining · {legacyReport.roleBased} role-based · {legacyReport.staffIds} Staff IDs · {legacyReport.unrecognised.length} unrecognised
            </p>
          )}
        </div>
      )}

      {accounts !== null && tab === "accounts" && (
        <div className="bg-white rounded-xl border border-line overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead>
              <tr className="bg-surface-2 border-b border-line text-[11px] text-faint uppercase">
                {["Name", "Email", "Role", "Status", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staff.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-faint">No staff accounts yet.</td>
                </tr>
              )}
              {staff.map((s) => {
                const self = s.uid === me;
                const draft = roleDraft[s.uid] ?? s.staffRole;
                const active = s.status === "active";
                if (s.profile) {
                  return (
                    <tr key={s.uid} className="border-b border-hover last:border-0">
                      <td className="px-4 py-3 font-semibold text-ink">{s.name || "—"}</td>
                      <td className="px-4 py-3 text-muted">{s.contactEmail || s.email || "—"}</td>
                      <td className="px-4 py-3 text-muted">Staff ID · {s.profile.preset}</td>
                      <td className="px-4 py-3"><Badge tone={statusTone(s.profile.accountStatus)}>{s.profile.accountStatus}</Badge></td>
                      <td className="px-4 py-3 text-right"><button onClick={() => setProfileUid(s.uid)} className="text-[11px] font-semibold text-ink">Open profile</button></td>
                    </tr>
                  );
                }
                return (
                  <tr key={s.uid} className="border-b border-hover last:border-0">
                    <td className="px-4 py-3 font-semibold text-ink">
                      {s.name || "—"} {self && <span className="text-[10px] font-normal text-faint">(you)</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">{s.email || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={draft}
                          disabled={self || busyId !== null}
                          onChange={(e) => setRoleDraft((d) => ({ ...d, [s.uid]: e.target.value }))}
                          className={selectCls}
                        >
                          {!roleOptions.some((r) => r.id === s.staffRole) && <option value={s.staffRole}>{s.roleName} (deleted)</option>}
                          {roleOptions.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        {draft !== s.staffRole && (
                          <button
                            disabled={busyId !== null}
                            onClick={() =>
                              void run(s.uid, () => updateAdminAccess(s.uid, { staffRole: draft }), `${s.name || s.email} now has the ${roleOptions.find((r) => r.id === draft)?.name} role.`)
                            }
                            className="text-[11px] font-semibold text-brand disabled:opacity-50"
                          >
                            Save
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={pill(active)}>{active ? "Active" : "Deactivated"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!self && (
                        <button
                          disabled={busyId !== null}
                          onClick={() => {
                            setConfirmError(null);
                            setConfirm({ account: s, status: active ? "inactive" : "active" });
                          }}
                          className={`text-[11px] font-semibold disabled:opacity-50 ${active ? "text-brand" : "text-green-700"}`}
                        >
                          {active ? "Deactivate" : "Reactivate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {legacy.length > 0 && (
            <div className="border-t border-line p-4 space-y-2">
              <div className="text-[12px] font-bold text-ink">Legacy staff records ({legacy.length})</div>
              <p className="text-[11px] text-muted">
                Created by the previous Staff screen. They are not linked to any sign-in account and grant no access. Ask these people
                to sign up from the admin login page, then approve their requests with a role.
              </p>
              <ul className="text-[11px] text-body space-y-0.5">
                {legacy.map((l) => (
                  <li key={l.id}>
                    {l.name || "—"} · {l.email || "no email"} · recorded role: {l.role || "—"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {accounts !== null && tab === "requests" && (
        <div className="space-y-3">
          {requests.length === 0 && (
            <div className="bg-white rounded-xl border border-line p-8 text-center text-[12px] text-faint">No access requests.</div>
          )}
          {requests.map((r) => {
            const declined = r.status === "rejected";
            const chosen = approveRole[r.uid] || "";
            return (
              <div key={r.uid} className="bg-white rounded-xl border border-line p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-[13px] font-semibold text-ink">{r.name || "—"}</div>
                  <div className="text-[11px] text-muted">
                    {r.email} {r.createdAt && `· requested ${formatDateTime12(r.createdAt)}`}
                  </div>
                  {declined && <div className="text-[11px] text-brand mt-1">Declined: {r.rejectionReason || "no reason recorded"}</div>}
                </div>
                <select value={chosen} onChange={(e) => setApproveRole((d) => ({ ...d, [r.uid]: e.target.value }))} className={selectCls}>
                  <option value="">Choose a role…</option>
                  {roleOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
                <button
                  disabled={!chosen || busyId !== null}
                  onClick={() => void run(r.uid, () => approveAdminRequest(r.uid, chosen), `${r.email} approved.`)}
                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-[12px] font-semibold disabled:opacity-50"
                >
                  Approve
                </button>
                {!declined && (
                  <button
                    disabled={busyId !== null}
                    onClick={() => {
                      setDeclineError(null);
                      setDeclineReason("");
                      setDeclining(r);
                    }}
                    className="px-3 py-1.5 border border-line rounded-lg text-[12px] font-semibold text-body disabled:opacity-50"
                  >
                    Decline
                  </button>
                )}
              </div>
            );
          })}
          {roles.length === 0 && openRequests.length > 0 && (
            <p className="text-[11px] text-muted">Tip: create roles first (Roles tab) to give staff less than full access.</p>
          )}
        </div>
      )}

      {accounts !== null && tab === "roles" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              onClick={() => {
                setRoleErrors({});
                setEditing({ id: null, name: "", permissions: [] });
              }}
              className="px-3 py-1.5 bg-brand text-white rounded-lg text-[12px] font-semibold"
            >
              New role
            </button>
          </div>
          <div className="bg-white rounded-xl border border-line p-4">
            <div className="text-[13px] font-semibold text-ink">Super Admin <span className="text-[10px] font-normal text-faint">built-in</span></div>
            <div className="text-[11px] text-muted">Every area, plus staff accounts and roles. {holders(SUPER_ADMIN_ROLE)} account(s).</div>
          </div>
          {roles.length === 0 && (
            <div className="bg-white rounded-xl border border-line p-8 text-center text-[12px] text-faint">
              No custom roles yet. Create one to give staff access to only the areas they need.
            </div>
          )}
          {roles.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-line p-4 flex flex-wrap items-start gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="text-[13px] font-semibold text-ink">{r.name}</div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {r.permissions.map((p) => (
                    <span key={p} className="px-2 py-0.5 rounded-md bg-hover text-[10px] font-semibold text-body">{PERMISSION_INFO[p].label}</span>
                  ))}
                </div>
                <div className="text-[11px] text-faint mt-1.5">{holders(r.id)} account(s)</div>
              </div>
              <button
                onClick={() => {
                  setRoleErrors({});
                  setEditing({ id: r.id, name: r.name, permissions: r.permissions });
                }}
                className="text-[11px] font-semibold text-ink"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  setDeleteError(null);
                  setDeletingRole(r);
                }}
                className="text-[11px] font-semibold text-brand"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {accounts !== null && tab === "audit" && (
        <div className="bg-white rounded-xl border border-line divide-y divide-hover">
          {audit.length === 0 && <div className="p-8 text-center text-[12px] text-faint">No staff changes recorded yet.</div>}
          {audit.map((a) => (
            <div key={a.id} className="px-4 py-3 text-[12px]">
              <div className="font-semibold text-ink">{AUDIT_LABELS[a.action] || a.action}</div>
              <div className="text-[11px] text-muted">
                by {a.actorName || "—"} {a.at && `· ${formatDateTime12(a.at)}`}
                {typeof a.details.email === "string" && a.details.email ? ` · ${a.details.email}` : ""}
                {typeof a.details.name === "string" && a.details.name ? ` · ${a.details.name}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal
          title={editing.id ? "Edit role" : "New role"}
          subtitle="Choose the areas this role can open and change."
          onClose={() => setEditing(null)}
          busy={savingRole}
          footer={
            <>
              <button onClick={() => setEditing(null)} disabled={savingRole} className="px-4 py-2 border border-line rounded-lg text-xs font-semibold text-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => void submitRole()} disabled={savingRole} className="px-4 py-2 bg-brand text-white rounded-lg text-xs font-semibold disabled:opacity-60">
                {savingRole ? "Saving…" : "Save role"}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-xs">
            {roleErrors.form && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">{roleErrors.form}</div>}
            <label className="block">
              <span className="block text-[11px] font-semibold text-muted mb-1">Role name *</span>
              <input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                maxLength={40}
                className="w-full p-2 border border-line rounded-lg text-xs"
              />
              {roleErrors.name && <p className="text-[10px] text-red-600 mt-1">{roleErrors.name}</p>}
            </label>
            <div className="space-y-1.5">
              <span className="block text-[11px] font-semibold text-muted">Areas *</span>
              {PERMISSIONS.map((p) => (
                <label key={p} className="flex items-start gap-2 p-2 rounded-lg border border-line-soft cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-brand"
                    checked={editing.permissions.includes(p)}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        permissions: e.target.checked ? [...editing.permissions, p] : editing.permissions.filter((x) => x !== p),
                      })
                    }
                  />
                  <span>
                    <span className="font-semibold text-ink">{PERMISSION_INFO[p].label}</span>
                    <span className="block text-[11px] text-muted">{PERMISSION_INFO[p].description}</span>
                  </span>
                </label>
              ))}
              {roleErrors.permissions && <p className="text-[10px] text-red-600">{roleErrors.permissions}</p>}
            </div>
            {editing.id && <p className="text-[11px] text-muted">Saving updates the access of all {holders(editing.id)} account(s) with this role immediately.</p>}
          </div>
        </Modal>
      )}

      {editorFor && (editorFor.uid === null || editorAccount) && (
        <StaffAccessEditor
          key={editorFor.uid ?? "new"}
          account={editorAccount}
          onClose={() => setEditorFor(null)}
          onSaved={(result, created, who) => {
            setEditorFor(null);
            if (created || result.invite.sent || result.invite.link || result.invite.error || result.warnings?.length) {
              setInvite({ name: who.name, email: who.email, result, created });
            } else {
              showToast(`${who.name}'s profile and access were saved (${result.staffCode}).`);
            }
          }}
        />
      )}

      {profileAccount && !editorFor && (
        <StaffProfilePanel
          account={profileAccount}
          onClose={() => setProfileUid(null)}
          onEdit={() => setEditorFor({ uid: profileAccount.uid })}
          onInvite={(result) => setInvite({ name: profileAccount.name, email: profileAccount.email, result })}
          notify={showToast}
        />
      )}

      {invite && (
        <Modal
          title={`Staff ID ${invite.result.staffCode} saved`}
          centered
          onClose={() => setInvite(null)}
          footer={<Button variant="primary" onClick={() => setInvite(null)}>Done</Button>}
        >
          <div className="space-y-3 text-xs text-body">
            {invite.result.warnings?.map((w) => <p key={w} role="alert" className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900">{w}</p>)}
            {invite.result.username ? (
              <p>Username: <strong>{invite.result.username}</strong>. Share this username and the password you set privately with the staff member. No email invitation is required.</p>
            ) : invite.result.invite.error ? (
              <p className="text-red-700">{invite.result.invite.error}</p>
            ) : invite.result.invite.sent ? (
              <p>The password-set email was accepted by the email provider for delivery{invite.email ? ` to ${invite.email}` : ""}.</p>
            ) : invite.result.invite.link ? (
              <>
                <p>Email delivery is not configured, so no email was sent. Share this one-time password-set link privately with the staff member:</p>
                <textarea readOnly value={invite.result.invite.link} className="w-full p-2 border border-line rounded-lg text-[11px] h-20" onFocus={(e) => e.currentTarget.select()} />
              </>
            ) : invite.created ? (
              <p>No invitation was needed: this email already has a sign-in account that has been used before.</p>
            ) : null}
            <p className="text-muted">{invite.result.username ? "Staff sign in using their username and password. Their assigned permissions control workspace access." : "An Invited Staff ID can sign in but sees no workspace until you activate it from its profile."}</p>
          </div>
        </Modal>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.status === "active" ? "Reactivate staff account" : "Deactivate staff account"}
          message={
            confirm.status === "active"
              ? `${confirm.account.name || confirm.account.email} will regain the access of the ${confirm.account.roleName} role.`
              : `${confirm.account.name || confirm.account.email} will immediately lose all admin access.`
          }
          confirmLabel={confirm.status === "active" ? "Reactivate" : "Deactivate"}
          danger={confirm.status === "inactive"}
          busy={busyId !== null}
          error={confirmError}
          onConfirm={() => void changeStatus()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {declining && (
        <Modal
          title="Decline access request"
          subtitle={declining.email}
          onClose={() => setDeclining(null)}
          busy={busyId !== null}
          footer={
            <>
              <button onClick={() => setDeclining(null)} disabled={busyId !== null} className="px-4 py-2 border border-line rounded-lg text-xs font-semibold text-muted disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => void decline()} disabled={busyId !== null} className="px-4 py-2 bg-brand text-white rounded-lg text-xs font-semibold disabled:opacity-60">
                Decline
              </button>
            </>
          }
        >
          <label className="block text-xs">
            <span className="block text-[11px] font-semibold text-muted mb-1">Reason (shown to the requester) *</span>
            <input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} maxLength={300} className="w-full p-2 border border-line rounded-lg text-xs" />
            {declineError && <p className="text-[10px] text-red-600 mt-1">{declineError}</p>}
          </label>
        </Modal>
      )}

      {deletingRole && (
        <ConfirmDialog
          title="Delete role"
          message={`Delete the role "${deletingRole.name}"? Roles still assigned to accounts cannot be deleted.`}
          confirmLabel="Delete"
          danger
          busy={busyId !== null}
          error={deleteError}
          onConfirm={() => void removeRole()}
          onCancel={() => setDeletingRole(null)}
        />
      )}
    </div>
  );
}
