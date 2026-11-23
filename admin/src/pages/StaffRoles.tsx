import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
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
  subscribeAllStaffSessions,
  subscribeContactAccessLogs,
  updateAdminAccess,
  migrateLegacyAdmins,
  setStaffStatus,
  type AuditEntry,
  type LegacyStaffRecord,
  type StaffAccount,
  type StaffRole,
  type StaffSaveResult,
  type StaffSessionRecord,
  type ContactAccessLogRecord,
} from "../services/staffService";
import { SUPER_ADMIN_ROLE, permissionsOf, presetAccess, type StaffPreset } from "../config/permissions";
import StaffAccessEditor from "../components/staff/StaffAccessEditor";
import { ROLE_PRESETS_META, type RolePresetMeta } from "../components/staff/rolePresets";
import StaffProfilePanel from "../components/staff/StaffProfilePanel";
import {
  CredentialsHandoverModal,
  DevUnmaskPreviewModal,
  ManageRolesModal,
  CustomRoleModal,
  type ShareCredsData,
} from "../components/staff/StaffModals";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";
import { formatDateTime12, formatTime12, isoDateIST } from "../utils/time";
import { copyText } from "../utils/clipboard";
import { attendanceOnDay, formatDuration, isLive, moduleCounts } from "../domain/staffAccess";
import Icon from "../components/ui/Icon";

type MainTab = "directory" | "attendance" | "activity" | "admins";

const errText = (e: unknown) => (e instanceof StaffActionError ? e.message : "Something went wrong. Please try again.");

const pillCls = (active: boolean) =>
  `shrink-0 px-3 h-8 rounded-xl text-xs font-semibold border whitespace-nowrap transition-colors ${
    active ? "bg-[#991B1B] text-white border-[#991B1B] shadow-xs" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
  }`;
const ACTION_BASE = "inline-flex items-center justify-center gap-1.5 h-10 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#991B1B]";
const ROW_BTN = "inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-semibold whitespace-nowrap border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#991B1B]";
const TH = "py-3 px-4 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap";
const selectCls = "h-9 px-3 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:border-[#991B1B] max-w-full";
const fmtPhone = (p: string) => (/^\d{10}$/.test(p) ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : p || "No mobile");
const AUDIT_LABEL: Record<string, string> = {
  staff_profile_created: "Staff ID created", staff_profile_updated: "Profile & access changed", staff_status_changed: "Status changed",
  staff_password_reset: "Password reset", role_created: "Role created", role_updated: "Role changed", role_deleted: "Role deleted",
  admin_request_approved: "Access request approved", admin_request_rejected: "Access request declined",
};
const isDev = import.meta.env.DEV;

function Kpi({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint: string; icon: Parameters<typeof Icon>[0]["name"]; tone: string }) {
  return (
    <div className="h-full min-w-0 bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center ${tone}`}><Icon name={icon} size={16} /></span>
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>
    </div>
  );
}

export default function StaffRoles() {
  const me = auth.currentUser?.uid || "";
  const [mainTab, setMainTab] = useState<MainTab>("directory");
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [roles, setRoles] = useState<StaffRole[] | null>(null);
  const [, setLegacy] = useState<LegacyStaffRecord[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [sessions, setSessions] = useState<StaffSessionRecord[]>([]);
  const [contactLogs, setContactLogs] = useState<ContactAccessLogRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { toast, show: showToast } = useToast(9000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);

  useEffect(() => {
    setLoadError(null);
    const unsubs = [
      subscribeStaffAccounts(setAccounts, setLoadError),
      subscribeStaffRoles(setRoles, setLoadError),
      subscribeLegacyStaff(setLegacy, setLoadError),
      subscribeAuditLog(setAudit, setLoadError),
      subscribeAllStaffSessions(setSessions, setLoadError),
      subscribeContactAccessLogs(setContactLogs, setLoadError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [retryKey]);

  const allAccounts = accounts ?? [];
  const customRoles = roles ?? [];
  const staff = useMemo(() => allAccounts.filter((a) => a.role === "admin"), [allAccounts]);
  const staffIds = useMemo(() => staff.filter((a) => a.profile), [staff]);
  const requests = useMemo(() => allAccounts.filter((a) => a.role === "pending"), [allAccounts]);
  const openRequests = requests.filter((r) => r.status !== "rejected");
  const legacyMasters = staff.filter((a) => a.legacyMaster);
  const unrecognised = staff.filter((a) => a.unrecognised);
  const nameOf = useCallback((uid: string) => allAccounts.find((a) => a.uid === uid)?.name || "", [allAccounts]);

  // Panels and dialogs
  const [editorFor, setEditorFor] = useState<{ uid: string | null; preset?: StaffPreset } | null>(null);
  const [pendingRole, setPendingRole] = useState<StaffRole | null>(null);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [shareCreds, setShareCreds] = useState<ShareCredsData | null>(null);
  const [manageRolesOpen, setManageRolesOpen] = useState(false);
  const [customRoleOpen, setCustomRoleOpen] = useState(false);
  const [devUnmaskOpen, setDevUnmaskOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<{ account: StaffAccount; next: "Active" | "Suspended" | "Inactive" } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [adminToggle, setAdminToggle] = useState<StaffAccount | null>(null);

  // Filters
  const [roleFilter, setRoleFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [activityStaffFilter, setActivityStaffFilter] = useState<string>("all");
  const [day, setDay] = useState(() => isoDateIST(new Date()));

  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<StaffAccount | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyReport, setLegacyReport] = useState<{ dryRun?: boolean } | null>(null);

  const profileAccount = staffIds.find((a) => a.uid === profileUid) ?? null;
  const editorAccount = editorFor?.uid ? staffIds.find((a) => a.uid === editorFor.uid) ?? null : null;

  /** Role key of a Staff ID: its custom role, else its preset. */
  const roleKeyOf = (a: StaffAccount) => (a.profile?.customRoleId ? `role:${a.profile.customRoleId}` : `preset:${a.profile?.preset ?? ""}`);
  const assignedTo = useCallback((key: string) => staffIds.filter((a) => roleKeyOf(a) === key).length, [staffIds]);
  const roleLabelOf = (a: StaffAccount) => {
    const p = a.profile!;
    if (!p.customRoleId) return p.preset;
    return customRoles.find((r) => r.id === p.customRoleId)?.name || p.customRoleName || "Custom role";
  };

  const filteredStaffIds = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return staffIds.filter((a) => {
      const p = a.profile!;
      if (roleFilter === "Suspended" || roleFilter === "Inactive") { if (p.accountStatus !== roleFilter) return false; }
      else if (roleFilter !== "All" && roleKeyOf(a) !== roleFilter) return false;
      if (!q) return true;
      return [a.name, p.staffCode, a.username, p.phone, a.email].some((v) => (v || "").toLowerCase().includes(q));
    });
  }, [staffIds, roleFilter, searchQuery]);

  // Summary cards (every number comes from the saved accounts, roles and sessions)
  const onlineUids = useMemo(() => new Set(sessions.filter((s) => s.uid && isLive(s, now)).map((s) => s.uid!)), [sessions, now]);
  const activeCount = staffIds.filter((a) => a.profile?.accountStatus === "Active").length;
  const revealCount = staffIds.filter((a) => a.profile?.matrix.privacy.temporaryReveal || a.profile?.matrix.privacy.requestApproval).length;
  const totalRolesCount = ROLE_PRESETS_META.length + customRoles.length;

  const handleSaveCustomRole = async (name: string, meta: RolePresetMeta) => {
    const permissions = permissionsOf(presetAccess(meta.preset).matrix);
    try {
      const id = await saveStaffRole(name, permissions, null, meta.preset);
      // Handed straight to an open editor, so the new role is selected without waiting for the list to refresh.
      if (editorFor) setPendingRole({ id, name, permissions, basePreset: meta.preset });
      showToast(`Custom role “${name}” created.`);
      setCustomRoleOpen(false);
    } catch (e) {
      throw new Error(errText(e));
    }
  };

  const handleDeleteRole = async (role: StaffRole) => {
    if (assignedTo(`role:${role.id}`) > 0) throw new Error("This role is assigned to Staff IDs. Move them to another role first.");
    try {
      await deleteStaffRole(role.id);
      showToast(`Role “${role.name}” deleted.`);
    } catch (e) {
      throw new Error(errText(e));
    }
  };

  const handleChangeStatus = async () => {
    if (!confirmStatus || confirmBusy) return;
    if (confirmReason.trim().length < 5) return showToast("Provide a reason of at least 5 characters.", "error");
    setConfirmBusy(true);
    try {
      const p = confirmStatus.account.profile!;
      const r = await setStaffStatus(confirmStatus.account.uid, confirmStatus.next, confirmReason, p.accessVersion);
      showToast(`${confirmStatus.account.name || confirmStatus.account.email} is now ${confirmStatus.next}.${r.sessionsEnded ? ` ${r.sessionsEnded} session(s) ended.` : ""}`);
      setConfirmStatus(null);
      setConfirmReason("");
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleStaffSaved = (result: StaffSaveResult, created: boolean, who: { name: string; email: string }, creds?: { username: string; password?: string; shift?: string; role?: string }) => {
    setEditorFor(null);
    setPendingRole(null);
    const warn = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";
    showToast(created ? `Staff ID created for ${who.name}.${warn}` : `Profile and permissions saved for ${who.name}.${warn}`, warn ? "error" : "success");
    if (created && creds) {
      setShareCreds({ name: who.name, staffCode: result.staffCode, role: creds.role || "Staff", shift: creds.shift || "", username: result.username || creds.username, password: creds.password });
    }
  };

  const runLegacyMigration = async (dryRun: boolean) => {
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

  const handleApproveRequest = async (uid: string) => {
    const roleId = approveRole[uid];
    if (!roleId) return showToast("Select a role to assign first.", "error");
    setBusyId(uid);
    try { await approveAdminRequest(uid, roleId); showToast("Access request approved."); } catch (e) { showToast(errText(e), "error"); } finally { setBusyId(null); }
  };

  const handleDeclineRequest = async () => {
    if (!declining || busyId) return;
    if (declineReason.trim().length < 5) return showToast("Provide a reason of at least 5 characters.", "error");
    setBusyId(declining.uid);
    try {
      await rejectAdminRequest(declining.uid, declineReason);
      showToast(`Request from ${declining.email} declined.`);
      setDeclining(null);
      setDeclineReason("");
    } catch (e) { showToast(errText(e), "error"); } finally { setBusyId(null); }
  };

  const handleAdminToggle = async () => {
    const s = adminToggle;
    if (!s || busyId) return;
    setBusyId(s.uid);
    try {
      await updateAdminAccess(s.uid, { status: s.status === "active" ? "inactive" : "active" });
      showToast(`${s.name || s.email} ${s.status === "active" ? "deactivated" : "activated"}.`);
      setAdminToggle(null);
    } catch (e) { showToast(errText(e), "error"); } finally { setBusyId(null); }
  };

  const copy = async (text: string, ok: string) => {
    const done = await copyText(text);
    showToast(done ? ok : "The browser did not allow copying.", done ? "success" : "error");
  };

  // ── Working hours on the chosen India calendar day, from real session timestamps ──
  const attendance = useMemo(() => staffIds.map((a) => ({ a, day: attendanceOnDay(sessions.filter((s) => s.uid === a.uid), day, now) })), [staffIds, sessions, day, now]);
  const latestDevice = (uid: string) => sessions.find((s) => s.uid === uid && (s.device || s.browser));
  const dayLabel = useMemo(() => formatDateTime12(new Date(`${day}T12:00:00+05:30`)).split(",")[0], [day]);

  const handleExportAttendance = () => {
    const rows = attendance.map(({ a, day: d }) => {
      const p = a.profile!;
      return `${a.name} (${p.staffCode}) | ${roleLabelOf(a)} | ${p.branch || "—"} | First: ${d.firstAt ? formatTime12(d.firstAt) : "—"} | Last: ${d.lastAt ? formatTime12(d.lastAt) : "—"} | Worked: ${formatDuration(d.workedMs)} | Sessions: ${d.sessions}${d.online ? " | Online now" : ""}`;
    });
    void copy(`*NESAM CABS — Staff attendance (${dayLabel}, IST)*\n\n${rows.join("\n")}`, "Shift sheet copied.");
  };

  // ── Activity, filtered by the chosen staff member (actor or affected account) ──
  const shownContactLogs = contactLogs.filter((l) => activityStaffFilter === "all" || l.actorId === activityStaffFilter);
  const shownAudit = audit.filter((e) => activityStaffFilter === "all" || e.actorId === activityStaffFilter || e.targetId === activityStaffFilter);
  const handleExportAudit = () => {
    const rows = shownAudit.map((e) => `[${e.at ? formatDateTime12(e.at) : "—"}] ${e.actorName || nameOf(e.actorId) || e.actorId || "Unknown"} — ${AUDIT_LABEL[e.action] ?? e.action} — ${nameOf(e.targetId) || e.targetId}`);
    void copy(`*NESAM CABS — Staff audit trail*\n\n${rows.join("\n")}`, "Audit report copied.");
  };

  const masters = staff.filter((s) => s.isSuper);
  const meAccount = staff.find((s) => s.uid === me);

  const tabs: { id: MainTab; label: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
    { id: "directory", label: `Staff IDs (${staffIds.length})`, icon: "users" },
    { id: "attendance", label: "Login, Logout & Working Hours", icon: "clock" },
    { id: "activity", label: "Staff Activity & Number Reveal Log", icon: "history" },
    { id: "admins", label: `All Admin Accounts (${staff.length})`, icon: "shield-check" },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[22rem]">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl leading-8 font-bold tracking-tight text-slate-900">Staff &amp; Access Control</h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-crimson-50 text-[#991B1B] border border-crimson-200">
              <Icon name="shield-check" size={12} />Owner only
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">Create Staff IDs, assign roles and module access, and review sign-ins and number reveals.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setManageRolesOpen(true)} className={`${ACTION_BASE} bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 shadow-xs`}>
            <Icon name="sliders-horizontal" size={16} className="text-slate-500" />Manage Roles ({totalRolesCount})
          </button>
          <button type="button" onClick={() => setCustomRoleOpen(true)} className={`${ACTION_BASE} bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900`}>
            <Icon name="plus-circle" size={16} className="text-amber-700" />Add Extra Role
          </button>
          <button type="button" onClick={() => setEditorFor({ uid: null })} className={`${ACTION_BASE} bg-[#991B1B] hover:bg-[#7F1D1D] active:bg-[#6b1515] text-white shadow-xs`}>
            <Icon name="user-round-plus" size={16} />Create Staff ID
          </button>
        </div>
      </header>

      <section aria-label="Summary" className="@container">
        <div className="grid grid-cols-1 @min-[440px]:grid-cols-2 @min-[960px]:grid-cols-4 gap-3.5">
          <Kpi label="Total Staff IDs" value={accounts === null ? "…" : staffIds.length} hint={`${activeCount} active · ${staffIds.length - activeCount} not active`} icon="users" tone="bg-slate-100 text-slate-600" />
          <Kpi label="Signed in now" value={onlineUids.size} hint="Live sessions in the last 30 minutes" icon="clock" tone="bg-emerald-50 text-emerald-600" />
          <Kpi label="Numbers masked" value={staffIds.length - revealCount} hint={`${revealCount} Staff ID${revealCount === 1 ? "" : "s"} may request or make a logged reveal`} icon="eye-off" tone="bg-amber-50 text-amber-600" />
          <Kpi label="Configured roles" value={roles === null ? "…" : totalRolesCount} hint={`${ROLE_PRESETS_META.length} built-in · ${customRoles.length} custom`} icon="sliders-horizontal" tone="bg-red-50 text-[#991B1B]" />
        </div>
      </section>

      <section className="min-w-0 bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/50 overflow-x-auto">
          <div className="flex items-center gap-1 px-3 sm:px-5 pt-2 min-w-max" role="tablist" aria-label="Staff workspace">
            {tabs.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={mainTab === t.id} onClick={() => setMainTab(t.id)}
                className={`h-11 px-3.5 text-xs whitespace-nowrap flex items-center gap-1.5 border-b-2 transition-colors ${mainTab === t.id ? "text-[#991B1B] font-bold border-[#991B1B]" : "text-slate-600 font-medium hover:text-slate-900 border-transparent"}`}>
                <Icon name={t.icon} size={16} />{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Staff IDs ── */}
        {mainTab === "directory" && (
          <div role="tabpanel" className="min-w-0">
            <div className="p-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1 basis-[28rem] overflow-x-auto">
                <div className="flex items-center gap-1.5 w-max" role="group" aria-label="Filter by role">
                  <button type="button" onClick={() => setRoleFilter("All")} className={pillCls(roleFilter === "All")}>All ({staffIds.length})</button>
                  {ROLE_PRESETS_META.map((meta) => {
                    const key = `preset:${meta.preset}`;
                    return <button key={meta.id} type="button" onClick={() => setRoleFilter(key)} className={pillCls(roleFilter === key)}>{meta.shortName} ({assignedTo(key)})</button>;
                  })}
                  {customRoles.map((r) => {
                    const key = `role:${r.id}`;
                    return <button key={r.id} type="button" onClick={() => setRoleFilter(key)} className={pillCls(roleFilter === key)}>{r.name} ({assignedTo(key)})</button>;
                  })}
                  {(["Suspended", "Inactive"] as const).map((st) => (
                    <button key={st} type="button" onClick={() => setRoleFilter(st)} className={pillCls(roleFilter === st)}>{st} ({staffIds.filter((a) => a.profile?.accountStatus === st).length})</button>
                  ))}
                </div>
              </div>
              <div className="relative w-full sm:w-72 shrink-0">
                <Icon name="search" size={16} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input type="search" aria-label="Search Staff IDs" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search name, login ID, code, mobile…"
                  className="w-full h-10 pl-9 pr-3 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#991B1B] focus:outline-none" />
              </div>
            </div>

            {accounts === null ? (
              <div className="p-5 space-y-3" role="status" aria-label="Loading Staff IDs">{[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-lg bg-slate-100 animate-pulse" />)}</div>
            ) : filteredStaffIds.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-crimson-50 text-[#991B1B] border border-crimson-100 flex items-center justify-center mx-auto"><Icon name="user-round-plus" size={24} /></div>
                <h3 className="text-sm font-bold text-slate-900">{staffIds.length ? "No Staff IDs match this filter" : "No Staff IDs yet"}</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">Each staff member gets their own login ID and only the modules their role needs.</p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {(["Booking & Enquiry Executive", "Dispatch & Trip Controller", "Night Shift / After-Hours Desk"] as const).map((p) => (
                    <button key={p} type="button" onClick={() => setEditorFor({ uid: null, preset: p })} className={`${ROW_BTN} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>
                      <Icon name="plus" size={12} />Add {ROLE_PRESETS_META.find((m) => m.preset === p)?.shortName}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <th className={`${TH} pl-5`}>Staff &amp; login ID</th><th className={TH}>Role &amp; hub</th><th className={TH}>Modules &amp; privacy</th>
                      <th className={TH}>Status</th><th className={`${TH} pr-5 text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStaffIds.map((a) => {
                      const p = a.profile!;
                      const mc = moduleCounts(p.matrix);
                      const roleMeta = p.customRoleId ? undefined : ROLE_PRESETS_META.find((m) => m.preset === p.preset);
                      const online = onlineUids.has(a.uid);
                      const suspended = p.accountStatus === "Suspended";
                      const reveal = p.matrix.privacy.temporaryReveal ? "Temporary reveal" : p.matrix.privacy.requestApproval ? "Reveal on approval" : "Numbers masked";
                      const loginId = a.username || a.email.split("@")[0];
                      return (
                        <tr key={a.uid} className="hover:bg-slate-50/60 align-top">
                          <td className="py-3 pl-5 pr-4 max-w-[260px]">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center shrink-0" aria-hidden="true">{(a.name || "ST").slice(0, 2).toUpperCase()}</div>
                              <div className="min-w-0">
                                <strong className="block font-semibold text-slate-900 truncate" title={a.name}>{a.name || "—"}</strong>
                                <span className="flex items-center gap-1 text-[11px] text-slate-500 font-mono min-w-0">
                                  <span className="truncate" title={`${p.staffCode} · @${loginId}`}>{p.staffCode} · @{loginId}</span>
                                  <button type="button" onClick={() => void copy(loginId, `Login ID @${loginId} copied.`)} aria-label={`Copy ID @${loginId}`} title="Copy ID (login ID only)"
                                    className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-[#991B1B] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-[#991B1B]">
                                    <Icon name="copy" size={12} />
                                  </button>
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 max-w-[220px]">
                            <span className={`inline-block max-w-full truncate text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleMeta?.badgeClass || "bg-amber-50 text-amber-800 border-amber-200"}`} title={roleLabelOf(a)}>{roleLabelOf(a)}</span>
                            <span className="block text-[11px] text-slate-500 mt-1 truncate" title={p.branch}>{p.branch || "No hub set"}</span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className="block font-medium text-slate-800">{mc.enabled} of {mc.available} modules</span>
                            <span className="text-[10px] text-slate-600">{reveal}</span>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${suspended ? "text-red-700" : online ? "text-emerald-700" : "text-slate-500"}`}>
                              <span className={`w-2 h-2 rounded-full ${suspended ? "bg-red-500" : online ? "bg-emerald-500" : "bg-slate-300"}`} aria-hidden="true" />
                              {suspended ? "Suspended" : p.accountStatus !== "Active" ? p.accountStatus : online ? "Online" : "Offline"}
                            </span>
                            <span className="block text-[10px] text-slate-500 mt-0.5">{fmtPhone(p.phone)}</span>
                          </td>
                          <td className="py-3 pl-4 pr-5">
                            <div className="flex items-center justify-end gap-1.5">
                              <button type="button" onClick={() => setEditorFor({ uid: a.uid })} className={`${ROW_BTN} bg-white border-slate-200 text-slate-700 hover:bg-slate-50`}>Edit access</button>
                              <button type="button" onClick={() => setProfileUid(a.uid)} className={`${ROW_BTN} bg-slate-100 border-slate-100 text-slate-700 hover:bg-slate-200`}>Profile</button>
                              <button type="button" onClick={() => setConfirmStatus({ account: a, next: suspended ? "Active" : "Suspended" })}
                                className={`${ROW_BTN} ${suspended ? "text-emerald-700 bg-emerald-50 border-emerald-100 hover:bg-emerald-100" : "text-red-700 bg-red-50 border-red-100 hover:bg-red-100"}`}>
                                {suspended ? "Reactivate" : "Suspend"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Login, logout & working hours ── */}
        {mainTab === "attendance" && (
          <div role="tabpanel" className="min-w-0">
            <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-xs font-bold text-slate-900">Attendance on {dayLabel} (India time)</h3>
                <p className="text-[11px] text-slate-500">Worked time adds up each sign-in session on this day; sessions across midnight count on both days. A session without a logout ends at its last activity.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="attendance-day">Day</label>
                <input id="attendance-day" type="date" value={day} max={isoDateIST(new Date())} onChange={(e) => e.target.value && setDay(e.target.value)} className={selectCls} />
                <button type="button" onClick={handleExportAttendance} className={`${ACTION_BASE} h-9 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-xs`}>
                  <Icon name="copy" size={14} className="text-slate-500" />Copy shift sheet
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead><tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className={`${TH} pl-5`}>Staff member</th><th className={TH}>Hub &amp; shift</th><th className={TH}>First sign-in</th><th className={TH}>Last logout / activity</th>
                  <th className={TH}>Worked</th><th className={TH}>Status</th><th className={`${TH} pr-5 text-right`}>Last device</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {attendance.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-slate-500">No Staff IDs yet.</td></tr>}
                  {attendance.map(({ a, day: d }) => {
                    const dev = latestDevice(a.uid);
                    return (
                      <tr key={a.uid} className="hover:bg-slate-50/50">
                        <td className="py-3 pl-5 pr-4 max-w-[240px]"><strong className="block font-semibold text-slate-900 truncate">{a.name}</strong><span className="text-[11px] text-slate-500 font-mono">{a.profile!.staffCode}</span></td>
                        <td className="py-3 px-4 max-w-[260px] text-slate-700"><span className="block truncate" title={a.profile!.branch}>{a.profile!.branch || "—"}</span></td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">{d.firstAt ? formatTime12(d.firstAt) : "—"}</td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600">{d.lastAt ? formatTime12(d.lastAt) : "—"}</td>
                        <td className="py-3 px-4 whitespace-nowrap font-semibold text-slate-900 tabular-nums">{formatDuration(d.workedMs)}<span className="block text-[10px] font-normal text-slate-500">{d.sessions} session{d.sessions === 1 ? "" : "s"}</span></td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${onlineUids.has(a.uid) ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600"}`}>{onlineUids.has(a.uid) ? "Online now" : "Signed out"}</span>
                        </td>
                        <td className="py-3 pl-4 pr-5 text-right text-slate-500 text-[11px] whitespace-nowrap">{dev ? [dev.device, dev.browser].filter(Boolean).join(" · ") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Activity & number reveal log ── */}
        {mainTab === "activity" && (
          <div role="tabpanel" className="p-4 sm:p-5 space-y-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900">Staff activity &amp; customer number reveals</h3>
                <p className="text-xs text-slate-500">Reveals are logged by the server with the signed-in staff member, booking, reason and time.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isDev && (
                  <button type="button" onClick={() => setDevUnmaskOpen(true)} className={`${ACTION_BASE} h-9 bg-amber-50 border border-amber-200 text-amber-900`}>
                    <Icon name="eye" size={14} />Reason form (dev preview)
                  </button>
                )}
                <select aria-label="Staff member" value={activityStaffFilter} onChange={(e) => setActivityStaffFilter(e.target.value)} className={selectCls}>
                  <option value="all">All staff</option>
                  {staff.map((s) => <option key={s.uid} value={s.uid}>{s.name || s.email}{s.profile ? ` (${s.profile.staffCode})` : ""}</option>)}
                </select>
                <button type="button" onClick={handleExportAudit} className={`${ACTION_BASE} h-9 bg-slate-900 text-white hover:bg-slate-800`}>
                  <Icon name="copy" size={14} />Copy audit report
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-200/90 overflow-hidden shadow-xs min-w-0">
              <div className="px-4 py-3 bg-amber-50/60 border-b border-amber-200/70 flex items-center gap-2">
                <Icon name="shield-alert" size={16} className="text-amber-700" />
                <span className="text-xs font-bold text-amber-950">Who viewed customer numbers ({shownContactLogs.length})</span>
              </div>
              <div className="overflow-x-auto bg-white">
                <table className="w-full min-w-[760px] border-collapse text-xs">
                  <thead><tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className={TH}>Staff member</th><th className={TH}>Booking</th><th className={TH}>Result</th><th className={TH}>Reason given</th><th className={`${TH} text-right`}>Time &amp; platform</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {shownContactLogs.length === 0 ? (
                      <tr><td colSpan={5} className="py-6 text-center text-slate-500">No number reveals recorded{activityStaffFilter !== "all" ? " for this staff member" : ""}.</td></tr>
                    ) : shownContactLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-4 font-semibold text-slate-900 max-w-[200px] truncate">{log.actorName || nameOf(log.actorId) || log.actorId || "Unknown"}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-700">{log.bookingId || "—"}</td>
                        <td className="py-2.5 px-4"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${log.action === "reveal" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{log.action === "reveal" ? "Revealed" : "Denied"}</span></td>
                        <td className="py-2.5 px-4 text-slate-600 max-w-[320px] break-words">{log.reason || "—"}</td>
                        <td className="py-2.5 px-4 text-right text-slate-500 text-[11px] whitespace-nowrap">{log.at ? formatDateTime12(log.at) : "—"}{log.platform ? ` · ${log.platform}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2.5 min-w-0">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Security &amp; access audit trail ({shownAudit.length})</h4>
              <ul className="border border-slate-200/90 rounded-2xl divide-y divide-slate-100 overflow-hidden bg-white shadow-xs">
                {shownAudit.length === 0 ? <li className="p-6 text-center text-slate-500 text-xs">No audit events yet.</li> : shownAudit.slice(0, 50).map((e) => (
                  <li key={e.id} className="p-3.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="text-slate-900 font-semibold">{e.actorName || nameOf(e.actorId) || "Unknown"}</strong>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{AUDIT_LABEL[e.action] ?? e.action}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 break-all">{nameOf(e.targetId) ? `${nameOf(e.targetId)} · ` : ""}{e.targetId}</p>
                    </div>
                    <span className="text-[11px] text-slate-500 shrink-0">{e.at ? formatDateTime12(e.at) : "—"}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── All admin accounts ── */}
        {mainTab === "admins" && (
          <div role="tabpanel" className="p-4 sm:p-5 space-y-5 min-w-0">
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-[#991B1B] text-white font-bold text-sm flex items-center justify-center" aria-hidden="true">{(meAccount?.name || auth.currentUser?.email || "MA").slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{meAccount?.name || auth.currentUser?.displayName || "Signed-in owner"}</p>
                  <p className="text-xs text-slate-500 truncate">{auth.currentUser?.email} · {meAccount?.isSuper ? "Super Admin" : meAccount?.roleName || "Admin"}</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-slate-600">{masters.length} Super Admin account{masters.length === 1 ? "" : "s"} · Staff IDs cannot change Super Admin access</span>
            </div>

            {openRequests.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5"><Icon name="clock" size={14} className="text-amber-700" />Pending access requests ({openRequests.length})</h4>
                {openRequests.map((r) => (
                  <div key={r.uid} className="p-4 rounded-xl border border-amber-200 bg-amber-50/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="min-w-0"><strong className="block font-semibold text-slate-900 truncate">{r.name || "Sign-up applicant"}</strong><p className="text-slate-500 truncate">{r.email}</p></div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select aria-label={`Role for ${r.email}`} value={approveRole[r.uid] || ""} onChange={(e) => setApproveRole({ ...approveRole, [r.uid]: e.target.value })} className={selectCls}>
                        <option value="">Select role…</option>
                        <option value={SUPER_ADMIN_ROLE}>Super Admin</option>
                        {customRoles.map((ro) => <option key={ro.id} value={ro.id}>{ro.name}</option>)}
                      </select>
                      <button type="button" disabled={busyId === r.uid} onClick={() => void handleApproveRequest(r.uid)} className={`${ROW_BTN} bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700`}>Approve</button>
                      <button type="button" disabled={busyId === r.uid} onClick={() => setDeclining(r)} className={`${ROW_BTN} bg-red-50 border-red-200 text-red-700 hover:bg-red-100`}>Decline</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2 min-w-0">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">All admin accounts ({staff.length})</h4>
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
                <table className="w-full min-w-[720px] text-xs">
                  <thead><tr className="bg-slate-50 border-b border-slate-200"><th className={TH}>Account</th><th className={TH}>Email / login</th><th className={TH}>Role / type</th><th className={TH}>Status</th><th className={`${TH} text-right`}>Actions</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {staff.map((s) => {
                      const isSelf = s.uid === me;
                      return (
                        <tr key={s.uid} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-semibold text-slate-900 max-w-[220px] truncate">{s.name || "—"} {isSelf && <span className="text-[10px] font-normal text-slate-500">(you)</span>}</td>
                          <td className="py-2.5 px-4 text-slate-600 max-w-[260px] truncate">{s.username ? `@${s.username}` : s.email || "—"}</td>
                          <td className="py-2.5 px-4 text-slate-700">{s.profile ? `Staff ID · ${roleLabelOf(s)}` : s.isSuper ? "Super Admin" : s.roleName || "Admin"}</td>
                          <td className="py-2.5 px-4"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.status === "active" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-600"}`}>{s.profile ? s.profile.accountStatus : s.status === "active" ? "Active" : "Deactivated"}</span></td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            {s.profile ? (
                              <button type="button" onClick={() => setProfileUid(s.uid)} className="text-xs font-semibold text-[#991B1B] hover:underline">View profile</button>
                            ) : !isSelf && !s.isSuper ? (
                              <button type="button" disabled={busyId === s.uid} onClick={() => setAdminToggle(s)} className="text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50">{s.status === "active" ? "Deactivate" : "Activate"}</button>
                            ) : <span className="text-[11px] text-slate-400">{isSelf ? "Your account" : "Owner"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {(legacyMasters.length > 0 || unrecognised.length > 0) && (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-2">
                <p><strong>{legacyMasters.length} legacy admin account(s)</strong> need an explicit role{unrecognised.length ? `; ${unrecognised.length} have no recognised access` : ""}.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" disabled={legacyBusy} onClick={() => void runLegacyMigration(true)} className={`${ROW_BTN} bg-white border-amber-300 text-amber-900`}>Preview migration</button>
                  <button type="button" disabled={legacyBusy || !legacyReport?.dryRun} onClick={() => void runLegacyMigration(false)} className={`${ROW_BTN} bg-[#991B1B] border-[#991B1B] text-white disabled:opacity-50`}>Convert records</button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {editorFor !== null && (
        <StaffAccessEditor
          account={editorAccount}
          accounts={allAccounts}
          customRoles={roles}
          startPreset={editorFor.preset}
          pendingRole={pendingRole}
          onPendingRoleUsed={() => setPendingRole(null)}
          onClose={() => { setEditorFor(null); setPendingRole(null); }}
          onSaved={handleStaffSaved}
          onOpenCustomRole={() => setCustomRoleOpen(true)}
        />
      )}

      {profileAccount !== null && (
        <StaffProfilePanel
          account={profileAccount}
          onClose={() => setProfileUid(null)}
          onEdit={() => { const uid = profileAccount.uid; setProfileUid(null); setEditorFor({ uid }); }}
          onInvite={(r) => {
            if (r.invite.sent) showToast(`Invitation emailed to ${profileAccount.contactEmail || profileAccount.email}.`);
            else if (r.invite.link) void copy(r.invite.link, "The invitation email was not sent; the password link was copied to share privately.");
            else showToast(r.invite.error || "The invitation could not be sent. Use Reset password instead.", "error");
          }}
          notify={(m, t) => showToast(m, t)}
        />
      )}

      {shareCreds !== null && <CredentialsHandoverModal creds={shareCreds} onClose={() => setShareCreds(null)} showToast={showToast} />}

      {manageRolesOpen && (
        <ManageRolesModal customRoles={customRoles} assignedTo={assignedTo} onClose={() => setManageRolesOpen(false)} onOpenAddRole={() => setCustomRoleOpen(true)} onDelete={handleDeleteRole} />
      )}

      {customRoleOpen && <CustomRoleModal roles={customRoles} onClose={() => setCustomRoleOpen(false)} onSave={handleSaveCustomRole} />}

      {isDev && devUnmaskOpen && (
        <DevUnmaskPreviewModal onClose={() => setDevUnmaskOpen(false)} onSubmit={(reason) => { setDevUnmaskOpen(false); showToast(`Development preview: reason “${reason}” accepted. Nothing was revealed or logged.`); }} />
      )}

      {confirmStatus !== null && (
        <ConfirmDialog
          title={`${confirmStatus.next === "Active" ? "Reactivate" : confirmStatus.next === "Suspended" ? "Suspend" : "Deactivate"} ${confirmStatus.account.name || confirmStatus.account.email}?`}
          message={
            <div className="space-y-3 text-xs">
              <p>{confirmStatus.next === "Active" ? "The Staff ID can sign in again with its saved access." : "Open sessions and temporary reveal grants end, and the Staff ID cannot sign in."}</p>
              <label className="block text-left">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">Reason for the audit log * (at least 5 characters)</span>
                <input type="text" required autoFocus value={confirmReason} onChange={(e) => setConfirmReason(e.target.value)} placeholder="e.g., Staff on leave" className="ds-input" />
              </label>
            </div>
          }
          confirmLabel={confirmStatus.next === "Active" ? "Reactivate" : confirmStatus.next === "Suspended" ? "Suspend" : "Deactivate"}
          danger={confirmStatus.next !== "Active"}
          busy={confirmBusy}
          onConfirm={() => void handleChangeStatus()}
          onCancel={() => { setConfirmStatus(null); setConfirmReason(""); }}
        />
      )}

      {adminToggle !== null && (
        <ConfirmDialog
          title={`${adminToggle.status === "active" ? "Deactivate" : "Activate"} ${adminToggle.name || adminToggle.email}?`}
          message={adminToggle.status === "active" ? "This admin account will no longer be able to use the panel." : "This admin account can use the panel again with its role."}
          confirmLabel={adminToggle.status === "active" ? "Deactivate" : "Activate"}
          danger={adminToggle.status === "active"}
          busy={busyId === adminToggle.uid}
          onConfirm={() => void handleAdminToggle()}
          onCancel={() => setAdminToggle(null)}
        />
      )}

      {declining !== null && (
        <ConfirmDialog
          title={`Decline the request from ${declining.email}?`}
          message={
            <label className="block text-left text-xs">
              <span className="block text-[11px] font-semibold text-slate-600 mb-1">Reason *</span>
              <input type="text" required autoFocus value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g., Not a Nesam Cabs employee" className="ds-input" />
            </label>
          }
          confirmLabel="Decline request"
          danger
          busy={busyId === declining.uid}
          onConfirm={() => void handleDeclineRequest()}
          onCancel={() => { setDeclining(null); setDeclineReason(""); }}
        />
      )}
    </div>
  );
}
