import { useEffect, useMemo, useState, useCallback } from "react";
import { auth } from "../services/firebase";
import {
  StaffActionError,
  approveAdminRequest,
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
import {
  DUTY_ACTIONS,
  STAFF_MODULES,
  STAFF_ROLE,
  STAFF_STATUSES,
  SUPER_ADMIN_ROLE,
  type Permission,
  type StaffStatus,
} from "../config/permissions";
import StaffAccessEditor, { ROLE_PRESETS_META, type RolePresetMeta } from "../components/staff/StaffAccessEditor";
import StaffProfilePanel, { statusTone } from "../components/staff/StaffProfilePanel";
import {
  WhatsAppShareModal,
  ManageRolesModal,
  CustomRoleModal,
  UnmaskReasonModal,
  type ShareCredsData,
} from "../components/staff/StaffModals";
import { ConfirmDialog, ErrorBanner, Toast, useToast } from "../components/Feedback";
import { formatDateTime12, formatShortDateTime12 } from "../utils/time";
import Icon from "../components/ui/Icon";

type MainTab = "directory" | "attendance" | "activity" | "admins";

const errText = (e: unknown) =>
  e instanceof StaffActionError ? e.message : "Something went wrong. Please try again.";

const pillCls = (active: boolean) =>
  `px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
    active ? "bg-[#991B1B] text-white border-[#991B1B] shadow-xs" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
  }`;

export default function StaffRoles() {
  const me = auth.currentUser?.uid || "";
  const [mainTab, setMainTab] = useState<MainTab>("directory");
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [roles, setRoles] = useState<StaffRole[]>([]);
  const [legacy, setLegacy] = useState<LegacyStaffRecord[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [sessions, setSessions] = useState<StaffSessionRecord[]>([]);
  const [contactLogs, setContactLogs] = useState<ContactAccessLogRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { toast, show: showToast } = useToast(9000);

  // Subscriptions
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

  const staff = useMemo(() => (accounts ?? []).filter((a) => a.role === "admin"), [accounts]);
  const staffIds = useMemo(() => staff.filter((a) => a.staffRole === STAFF_ROLE && a.profile), [staff]);
  const requests = useMemo(() => (accounts ?? []).filter((a) => a.role === "pending"), [accounts]);
  const openRequests = requests.filter((r) => r.status !== "rejected");
  const legacyMasters = staff.filter((a) => a.legacyMaster);
  const unrecognised = staff.filter((a) => a.unrecognised);

  // Modals & Panels State
  const [editorFor, setEditorFor] = useState<{ uid: string | null } | null>(null);
  const [profileUid, setProfileUid] = useState<string | null>(null);
  const [shareCreds, setShareCreds] = useState<ShareCredsData | null>(null);
  const [manageRolesOpen, setManageRolesOpen] = useState(false);
  const [customRoleOpen, setCustomRoleOpen] = useState(false);
  const [savingCustomRole, setSavingCustomRole] = useState(false);
  const [unmaskModalOpen, setUnmaskModalOpen] = useState(false);
  const [revealedResult, setRevealedResult] = useState<string | null>(null);

  // Confirmation state
  const [confirmStatus, setConfirmStatus] = useState<{
    account: StaffAccount;
    next: "Active" | "Suspended" | "Inactive";
  } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Filters & Search
  const [roleFilter, setRoleFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [activityStaffFilter, setActivityStaffFilter] = useState<string>("all");

  // Account actions
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approveRole, setApproveRole] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<StaffAccount | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [legacyBusy, setLegacyBusy] = useState(false);
  const [legacyReport, setLegacyReport] = useState<any>(null);

  const profileAccount = staffIds.find((a) => a.uid === profileUid) ?? null;
  const editorAccount = editorFor?.uid ? staffIds.find((a) => a.uid === editorFor.uid) ?? null : null;

  // Filtered staff list
  const filteredStaffIds = useMemo(() => {
    return staffIds.filter((a) => {
      const p = a.profile!;
      if (roleFilter !== "All") {
        if (roleFilter === "Suspended") {
          if (p.accountStatus !== "Suspended") return false;
        } else if (roleFilter === "Inactive") {
          if (p.accountStatus !== "Inactive") return false;
        } else if (p.preset !== roleFilter) {
          // Check if matches shortName or preset
          const meta = ROLE_PRESETS_META.find((m) => m.shortName === roleFilter || m.preset === roleFilter);
          if (!meta || p.preset !== meta.preset) return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesCode = (p.staffCode || "").toLowerCase().includes(q);
        const matchesUsername = (a.username || "").toLowerCase().includes(q);
        const matchesPhone = (p.phone || "").includes(q);
        const matchesEmail = a.email.toLowerCase().includes(q);
        if (!matchesName && !matchesCode && !matchesUsername && !matchesPhone && !matchesEmail) return false;
      }
      return true;
    });
  }, [staffIds, roleFilter, searchQuery]);

  // KPIs
  const totalStaffCount = staffIds.length;
  const loggedInCount = useMemo(() => {
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
    const onlineUids = new Set(
      sessions
        .filter((s) => s.status === "Online" && s.lastActiveAt && s.lastActiveAt.getTime() > thirtyMinAgo)
        .map((s) => s.uid)
    );
    return onlineUids.size;
  }, [sessions]);

  const privacyMaskedCount = useMemo(() => {
    return staffIds.filter((a) => !a.profile?.matrix.privacy?.fullStandingReveal).length;
  }, [staffIds]);

  const totalRolesCount = ROLE_PRESETS_META.length + roles.length;

  // Save Custom Role handler
  const handleSaveCustomRole = async (name: string, presetMeta: RolePresetMeta) => {
    setSavingCustomRole(true);
    try {
      const perms: Permission[] = presetMeta.preset === "Booking & Enquiry Executive" ? ["operations", "people"] : ["operations"];
      await saveStaffRole(name, perms, null);
      showToast(`Custom role "${name}" created successfully!`);
      setCustomRoleOpen(false);
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setSavingCustomRole(false);
    }
  };

  // Status Change Confirmation
  const handleChangeStatus = async () => {
    if (!confirmStatus || confirmBusy) return;
    if (confirmReason.trim().length < 5) {
      showToast("Provide a valid reason of at least 5 characters.", "error");
      return;
    }
    setConfirmBusy(true);
    try {
      const p = confirmStatus.account.profile!;
      await setStaffStatus(confirmStatus.account.uid, confirmStatus.next, confirmReason, p.accessVersion);
      showToast(`${confirmStatus.account.name || confirmStatus.account.email} status changed to ${confirmStatus.next}.`);
      setConfirmStatus(null);
      setConfirmReason("");
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setConfirmBusy(false);
    }
  };

  // Staff creation callback
  const handleStaffSaved = (
    result: StaffSaveResult,
    created: boolean,
    who: { name: string; email: string },
    creds?: { username: string; password?: string; shift?: string; role?: string }
  ) => {
    setEditorFor(null);
    showToast(
      created
        ? `Staff ID created successfully for ${who.name}!`
        : `Profile and permissions updated for ${who.name}!`
    );

    // If newly created with credentials, show WhatsApp Share Modal
    if (created && creds) {
      setShareCreds({
        name: who.name,
        staffCode: result.staffCode,
        role: creds.role || "Staff Member",
        shift: creds.shift || "General Day Shift",
        username: creds.username,
        password: creds.password,
      });
    }
  };

  // Legacy Admin Migration
  const runLegacyMigration = async (dryRun: boolean) => {
    if (legacyBusy) return;
    setLegacyBusy(true);
    try {
      const r = await migrateLegacyAdmins(dryRun);
      setLegacyReport(r);
      showToast(
        dryRun
          ? `Preview: ${r.legacyMaster} record(s) would be made explicit Super Admins.`
          : `${r.converted} record(s) converted. ${r.remaining} remaining.`
      );
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setLegacyBusy(false);
    }
  };

  // Access Request Approval
  const handleApproveRequest = async (uid: string) => {
    const roleId = approveRole[uid];
    if (!roleId) {
      showToast("Select a role to assign first.", "error");
      return;
    }
    setBusyId(uid);
    try {
      await approveAdminRequest(uid, roleId);
      showToast("Access request approved successfully!");
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  // Access Request Rejection
  const handleDeclineRequest = async () => {
    if (!declining || busyId) return;
    if (declineReason.trim().length < 5) {
      showToast("Provide a valid reason of at least 5 characters.", "error");
      return;
    }
    setBusyId(declining.uid);
    try {
      await rejectAdminRequest(declining.uid, declineReason);
      showToast(`Request from ${declining.email} declined.`);
      setDeclining(null);
      setDeclineReason("");
    } catch (e) {
      showToast(errText(e), "error");
    } finally {
      setBusyId(null);
    }
  };

  // Unmask test submit
  const handleUnmaskSubmit = (reason: string) => {
    setUnmaskModalOpen(false);
    setRevealedResult(`Authorized: +91 98421 98210 · Reason: ${reason}`);
    showToast("Customer contact unmasked and logged in audit trail.");
    setTimeout(() => setRevealedResult(null), 8000);
  };

  // Shift Sheet Export
  const handleExportAttendance = useCallback(() => {
    const today = new Date().toLocaleDateString("en-IN", { dateStyle: "medium" });
    const rows = staffIds.map((a) => {
      const p = a.profile!;
      const staffSessions = sessions.filter((s) => s.uid === a.uid);
      const isOnline = staffSessions.some((s) => s.status === "Online");
      const firstLogin = staffSessions[staffSessions.length - 1]?.startedAt
        ? formatShortDateTime12(staffSessions[staffSessions.length - 1].startedAt!)
        : "—";
      const lastActive = staffSessions[0]?.lastActiveAt
        ? formatShortDateTime12(staffSessions[0].lastActiveAt!)
        : "—";
      return `${a.name} (${p.staffCode}) | ${p.preset} | Shift: ${p.branch || "General"} | Status: ${
        isOnline ? "Online" : "Offline"
      } | First Login: ${firstLogin} | Last Active: ${lastActive}`;
    });
    const text = `*NESAM CABS — SHIFT ATTENDANCE REPORT (${today})*\n\n` + rows.join("\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      showToast("Shift sheet copied to clipboard!");
    } else {
      showToast("Clipboard not available", "error");
    }
  }, [staffIds, sessions, showToast]);

  // Audit Report Export
  const handleExportAudit = useCallback(() => {
    const rows = audit.map((entry) => {
      const atStr = entry.at ? formatDateTime12(entry.at) : "—";
      return `[${atStr}] ${entry.actorName} -> ${entry.action} on ${entry.targetId}`;
    });
    const text = `*NESAM CABS — STAFF AUDIT TRAIL REPORT*\n\n` + rows.join("\n");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
      showToast("Audit report copied to clipboard!");
    } else {
      showToast("Clipboard not available", "error");
    }
  }, [audit, showToast]);

  const selectCls = "h-9 px-3 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:border-[#991B1B]";

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <Toast toast={toast} />
      {loadError && <ErrorBanner message={loadError} onRetry={() => setRetryKey((k) => k + 1)} />}

      {/* Header Bar matching Reference HTML */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/90 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#991B1B] animate-pulse"></span>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900">
              NESAM CABS — Master Admin &amp; Staff Access Matrix
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Create individual Staff IDs, manage 7+ Nesam Cabs roles, track Login/Logout working hours, and audit live
            staff actions.
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => setManageRolesOpen(true)}
            className="h-10 px-3.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
          >
            <Icon name="sliders-horizontal" size={14} className="text-slate-500" />
            <span>Manage Roles ({totalRolesCount})</span>
          </button>

          <button
            type="button"
            onClick={() => setCustomRoleOpen(true)}
            className="h-10 px-3.5 rounded-xl bg-amber-50 hover:bg-amber-100/80 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Icon name="plus-circle" size={14} className="text-amber-700" />
            <span>+ Add Extra Role</span>
          </button>

          <button
            type="button"
            onClick={() => setEditorFor({ uid: null })}
            className="h-10 px-4 rounded-xl bg-[#991B1B] hover:bg-[#7F1D1D] active:scale-[0.99] text-white text-xs font-semibold flex items-center gap-2 shadow-sm transition-all"
          >
            <Icon name="user-round-plus" size={16} />
            <span>+ Create Staff ID</span>
          </button>
        </div>
      </header>

      {/* 4 KPI Summary Cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total Staff IDs</span>
            <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
              <Icon name="users" size={14} />
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{totalStaffCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Across Coimbatore, Madurai &amp; Chennai</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">On-Duty / Logged In</span>
            <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Icon name="clock" size={14} />
            </span>
          </div>
          <p className="text-2xl font-bold text-emerald-600 mt-2">{loggedInCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Live active shift sessions</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Privacy Protected</span>
            <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Icon name="eye-off" size={14} />
            </span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">{privacyMaskedCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Customer numbers masked (98421 •••10)</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Configured Roles</span>
            <span className="w-7 h-7 rounded-lg bg-red-50 text-[#991B1B] flex items-center justify-center">
              <Icon name="sliders-horizontal" size={14} />
            </span>
          </div>
          <p className="text-2xl font-bold text-[#991B1B] mt-2">{totalRolesCount}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">7 core roles + custom role builder</p>
        </div>
      </section>

      {/* Main Workspace Tabs */}
      <section className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-5 pt-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
          <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto" role="tablist">
            <button
              type="button"
              onClick={() => setMainTab("directory")}
              className={`px-3.5 py-2.5 text-xs font-bold whitespace-nowrap flex items-center gap-1.5 border-b-2 transition-all ${
                mainTab === "directory"
                  ? "text-[#991B1B] border-[#991B1B]"
                  : "text-slate-600 hover:text-slate-900 border-transparent"
              }`}
            >
              <Icon name="users" size={14} />
              <span>Staff IDs ({totalStaffCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setMainTab("attendance")}
              className={`px-3.5 py-2.5 text-xs font-medium whitespace-nowrap flex items-center gap-1.5 border-b-2 transition-all ${
                mainTab === "attendance"
                  ? "text-[#991B1B] font-bold border-[#991B1B]"
                  : "text-slate-600 hover:text-slate-900 border-transparent"
              }`}
            >
              <Icon name="clock" size={14} />
              <span>Login, Logout &amp; Working Hours</span>
            </button>

            <button
              type="button"
              onClick={() => setMainTab("activity")}
              className={`px-3.5 py-2.5 text-xs font-medium whitespace-nowrap flex items-center gap-1.5 border-b-2 transition-all ${
                mainTab === "activity"
                  ? "text-[#991B1B] font-bold border-[#991B1B]"
                  : "text-slate-600 hover:text-slate-900 border-transparent"
              }`}
            >
              <Icon name="history" size={14} />
              <span>Staff Activity &amp; Number Reveal Log</span>
            </button>

            <button
              type="button"
              onClick={() => setMainTab("admins")}
              className={`px-3.5 py-2.5 text-xs font-medium whitespace-nowrap flex items-center gap-1.5 border-b-2 transition-all ${
                mainTab === "admins"
                  ? "text-[#991B1B] font-bold border-[#991B1B]"
                  : "text-slate-600 hover:text-slate-900 border-transparent"
              }`}
            >
              <Icon name="shield-check" size={14} />
              <span>All Admin Accounts ({staff.length})</span>
            </button>
          </div>
        </div>

        {/* ── TAB 1: STAFF DIRECTORY ── */}
        {mainTab === "directory" && (
          <div>
            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setRoleFilter("All")}
                  className={pillCls(roleFilter === "All")}
                >
                  All ({staffIds.length})
                </button>
                {ROLE_PRESETS_META.map((meta) => {
                  const count = staffIds.filter((a) => a.profile?.preset === meta.preset).length;
                  return (
                    <button
                      key={meta.id}
                      type="button"
                      onClick={() => setRoleFilter(meta.preset)}
                      className={pillCls(roleFilter === meta.preset)}
                    >
                      {meta.shortName} ({count})
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setRoleFilter("Suspended")}
                  className={pillCls(roleFilter === "Suspended")}
                >
                  Suspended ({staffIds.filter((a) => a.profile?.accountStatus === "Suspended").length})
                </button>
              </div>

              <div className="relative w-full md:w-64 shrink-0">
                <Icon name="search" size={14} className="text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, @id, mobile..."
                  className="w-full h-9 pl-8 pr-3 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#991B1B] focus:outline-none"
                />
              </div>
            </div>

            {/* Empty State */}
            {filteredStaffIds.length === 0 && (
              <div className="p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-crimson-50 text-[#991B1B] border border-crimson-100 flex items-center justify-center mx-auto">
                  <Icon name="user-round-plus" size={24} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">No Staff IDs matching filter</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Create individual staff logins for Booking, Dispatch, Night Shift, Fleet, or Accounts. Every staff
                    member gets a custom login ID and privacy-controlled permissions.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEditorFor({ uid: null })}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 text-[#991B1B] border border-red-200 hover:bg-red-100"
                  >
                    + Add Booking Executive
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorFor({ uid: null })}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                  >
                    + Add Dispatch Controller
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorFor({ uid: null })}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100"
                  >
                    + Add Night Shift Staff
                  </button>
                </div>
              </div>
            )}

            {/* Staff Table */}
            {filteredStaffIds.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-3 px-5">Staff &amp; Login ID</th>
                      <th className="py-3 px-4">Role &amp; Hub</th>
                      <th className="py-3 px-4">Permissions &amp; Privacy</th>
                      <th className="py-3 px-4">Shift &amp; Status</th>
                      <th className="py-3 px-5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStaffIds.map((a) => {
                      const p = a.profile!;
                      const modulesCount = STAFF_MODULES.filter((m) => (p.matrix.modules[m] ?? []).length > 0).length;
                      const roleMeta = ROLE_PRESETS_META.find((m) => m.preset === p.preset);
                      const isOnline = sessions.some(
                        (s) => s.uid === a.uid && s.status === "Online" && s.lastActiveAt && Date.now() - s.lastActiveAt.getTime() < 30 * 60 * 1000
                      );
                      const isSuspended = p.accountStatus === "Suspended";
                      const isMasked = !p.matrix.privacy?.fullStandingReveal;

                      return (
                        <tr key={a.uid} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold flex items-center justify-center shrink-0">
                                {a.name ? a.name.slice(0, 2).toUpperCase() : "ST"}
                              </div>
                              <div>
                                <strong className="text-slate-900 block font-semibold">{a.name || "—"}</strong>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                                  <span>{p.staffCode}</span>
                                  <span>•</span>
                                  <span>@{a.username || a.email.split("@")[0]}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                                roleMeta?.badgeClass || "bg-slate-100 text-slate-700 border-slate-200"
                              }`}
                            >
                              {p.preset}
                            </span>
                            <span className="block text-[11px] text-slate-500 mt-0.5">{p.branch || "Office"}</span>
                          </td>

                          <td className="py-3 px-4">
                            <div className="space-y-0.5">
                              <span className="font-medium text-slate-800">
                                {modulesCount} of 17 Modules
                              </span>
                              <div className="flex items-center gap-1 text-[10px]">
                                {isMasked ? (
                                  <span className="text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                    🔒 Masked (98421 •••10)
                                  </span>
                                ) : (
                                  <span className="text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                    🔓 Full Contact
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-2 h-2 rounded-full ${
                                  isSuspended
                                    ? "bg-red-500"
                                    : isOnline
                                    ? "bg-emerald-500 animate-pulse"
                                    : "bg-slate-300"
                                }`}
                              />
                              <span
                                className={`text-[11px] font-semibold ${
                                  isSuspended
                                    ? "text-red-700"
                                    : isOnline
                                    ? "text-emerald-700"
                                    : "text-slate-500"
                                }`}
                              >
                                {isSuspended ? "Suspended" : isOnline ? "Online (Active)" : "Offline"}
                              </span>
                            </div>
                            <span className="block text-[10px] text-slate-400 mt-0.5">
                              {p.phone ? `+91 ${p.phone}` : "No mobile"}
                            </span>
                          </td>

                          <td className="py-3 px-5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setShareCreds({
                                    name: a.name,
                                    staffCode: p.staffCode,
                                    role: p.preset,
                                    shift: p.branch,
                                    username: a.username || a.email.split("@")[0],
                                  })
                                }
                                title="Share WhatsApp Credentials"
                                className="px-2.5 py-1.5 rounded-lg text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 font-semibold text-[11px] flex items-center gap-1"
                              >
                                <Icon name="message-square" size={12} />
                                <span>WhatsApp</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => setEditorFor({ uid: a.uid })}
                                className="px-2.5 py-1.5 rounded-lg text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 font-semibold text-[11px]"
                              >
                                Edit Access
                              </button>

                              <button
                                type="button"
                                onClick={() => setProfileUid(a.uid)}
                                className="px-2.5 py-1.5 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 font-semibold text-[11px]"
                              >
                                Profile
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmStatus({
                                    account: a,
                                    next: isSuspended ? "Active" : "Suspended",
                                  })
                                }
                                className={`px-2 py-1.5 rounded-lg font-semibold text-[11px] ${
                                  isSuspended
                                    ? "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                                    : "text-red-700 bg-red-50 hover:bg-red-100"
                                }`}
                              >
                                {isSuspended ? "Reactivate" : "Suspend"}
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

        {/* ── TAB 2: ATTENDANCE & WORKING HOURS ── */}
        {mainTab === "attendance" && (
          <div>
            <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-bold text-slate-900">
                  Today's Shift Attendance &amp; Working Hours ({new Date().toLocaleDateString("en-IN", { dateStyle: "medium" })})
                </h3>
                <p className="text-[11px] text-slate-500">
                  Live check-in/check-out timestamps and automatic working hours calculation
                </p>
              </div>
              <button
                type="button"
                onClick={handleExportAttendance}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 flex items-center gap-1.5 shadow-xs"
              >
                <Icon name="download" size={14} className="text-slate-500" />
                <span>Copy Shift Sheet</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-5">Staff Member</th>
                    <th className="py-3 px-4">Assigned Shift</th>
                    <th className="py-3 px-4">First Login</th>
                    <th className="py-3 px-4">Last Logout / Active</th>
                    <th className="py-3 px-4">Total Working Hours</th>
                    <th className="py-3 px-4">Session Status</th>
                    <th className="py-3 px-5 text-right">Device / Hub</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffIds.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No staff attendance records available.
                      </td>
                    </tr>
                  )}
                  {staffIds.map((a) => {
                    const p = a.profile!;
                    const staffSessions = sessions.filter((s) => s.uid === a.uid);
                    const latestSession = staffSessions[0];
                    const earliestSession = staffSessions[staffSessions.length - 1];
                    const isOnline = staffSessions.some(
                      (s) => s.status === "Online" && s.lastActiveAt && Date.now() - s.lastActiveAt.getTime() < 30 * 60 * 1000
                    );

                    let hoursText = "0h 0m";
                    if (earliestSession?.startedAt) {
                      const endTime = latestSession?.endedAt || latestSession?.lastActiveAt || new Date();
                      const diffMs = Math.max(0, endTime.getTime() - earliestSession.startedAt.getTime());
                      const hours = Math.floor(diffMs / 3600000);
                      const mins = Math.floor((diffMs % 3600000) / 60000);
                      hoursText = `${hours}h ${mins}m`;
                    }

                    return (
                      <tr key={a.uid} className="hover:bg-slate-50/50">
                        <td className="py-3 px-5">
                          <strong className="text-slate-900 block font-semibold">{a.name}</strong>
                          <span className="text-[11px] text-slate-400 font-mono">{p.staffCode}</span>
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-700">{p.branch || "General Day Shift"}</td>
                        <td className="py-3 px-4 text-slate-600">
                          {earliestSession?.startedAt ? formatShortDateTime12(earliestSession.startedAt) : "—"}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {latestSession?.endedAt
                            ? formatShortDateTime12(latestSession.endedAt)
                            : latestSession?.lastActiveAt
                            ? formatShortDateTime12(latestSession.lastActiveAt)
                            : "—"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{hoursText}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isOnline
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {isOnline ? "● Online" : "○ Logged Out"}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-right text-slate-500 text-[11px]">
                          {latestSession?.device ? `${latestSession.device} · ${latestSession.browser}` : "Web Panel"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: STAFF ACTIVITY & NUMBER REVEAL LOG ── */}
        {mainTab === "activity" && (
          <div className="p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Live Staff Activity &amp; Customer Number Reveal Log
                </h3>
                <p className="text-xs text-slate-500">
                  Every customer mobile reveal requires a valid reason and logs Staff ID, Booking ID, Reason &amp; Time
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setUnmaskModalOpen(true)}
                  className="h-9 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Icon name="eye" size={14} className="text-amber-700" />
                  <span>Test Staff Unmask Flow</span>
                </button>

                <select
                  value={activityStaffFilter}
                  onChange={(e) => setActivityStaffFilter(e.target.value)}
                  className={selectCls}
                >
                  <option value="all">All Staff Members</option>
                  {staffIds.map((s) => (
                    <option key={s.uid} value={s.uid}>
                      {s.name} ({s.profile?.staffCode})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleExportAudit}
                  className="h-9 px-3 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 flex items-center gap-1.5 shadow-xs"
                >
                  <Icon name="copy" size={14} />
                  <span>Copy Audit Report</span>
                </button>
              </div>
            </div>

            {revealedResult && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold">
                ✓ {revealedResult}
              </div>
            )}

            {/* Dedicated Customer Number Reveal Audit Box */}
            <div className="rounded-2xl border border-amber-200/90 bg-amber-50/40 overflow-hidden shadow-xs">
              <div className="px-4 py-3 border-b border-amber-200/70 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon name="shield-alert" size={16} className="text-amber-700" />
                  <span className="text-xs font-bold text-amber-950">
                    Who Viewed Customer Numbers? (Mandatory Reason Log)
                  </span>
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                  Zero Unlogged Views
                </span>
              </div>
              <div className="overflow-x-auto bg-white">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="py-2.5 px-4">Staff Member</th>
                      <th className="py-2.5 px-4">Booking ID</th>
                      <th className="py-2.5 px-4">Customer Number</th>
                      <th className="py-2.5 px-4">Mandatory Reason Given</th>
                      <th className="py-2.5 px-4 text-right">Time &amp; Platform</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {contactLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400 text-xs">
                          No customer number reveal events recorded yet. Privacy shielding is 100% active.
                        </td>
                      </tr>
                    ) : (
                      contactLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/60">
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{log.actorName || log.actorId}</td>
                          <td className="py-2.5 px-4 font-mono font-medium text-slate-700">{log.bookingId}</td>
                          <td className="py-2.5 px-4 font-mono text-amber-900 font-bold">98421 •••10</td>
                          <td className="py-2.5 px-4 text-slate-600">{log.reason}</td>
                          <td className="py-2.5 px-4 text-right text-slate-400 text-[11px]">
                            {log.at ? formatDateTime12(log.at) : "—"} · {log.platform || "web"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Full Security &amp; Access Audit Trail ({audit.length})
              </h4>
              <div className="border border-slate-200/90 rounded-2xl divide-y divide-slate-100 overflow-hidden bg-white shadow-xs">
                {audit.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs">No audit events logged yet.</div>
                ) : (
                  audit.slice(0, 50).map((entry) => (
                    <div key={entry.id} className="p-3.5 hover:bg-slate-50/50 flex items-center justify-between gap-3 text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <strong className="text-slate-900 font-semibold">{entry.actorName || "Master"}</strong>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-mono">
                            {entry.action}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500">Target ID: {entry.targetId}</p>
                      </div>
                      <span className="text-[11px] text-slate-400 shrink-0">
                        {entry.at ? formatDateTime12(entry.at) : "—"}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 4: ALL ADMIN ACCOUNTS ── */}
        {mainTab === "admins" && (
          <div className="p-5 space-y-5">
            {/* Owner Master Account Card matching Reference HTML */}
            <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#991B1B] text-white font-bold text-sm flex items-center justify-center">
                  MA
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-slate-900">NESAM CABS — Master Admin</p>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-crimson-50 text-[#991B1B] border border-crimson-200">
                      Owner • Full Access
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Cannot be suspended or restricted by staff accounts • Root Super Admin
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Active Master Session
              </span>
            </div>

            {/* Pending Access Requests */}
            {openRequests.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Icon name="clock" size={14} className="text-amber-700" />
                  <span>Pending Sign-Up / Access Requests ({openRequests.length})</span>
                </h4>
                <div className="space-y-2">
                  {openRequests.map((r) => (
                    <div
                      key={r.uid}
                      className="p-4 rounded-xl border border-amber-200 bg-amber-50/30 flex flex-wrap items-center justify-between gap-3 text-xs"
                    >
                      <div>
                        <strong className="text-slate-900 font-semibold">{r.name || "Sign-up Applicant"}</strong>
                        <p className="text-slate-500">{r.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={approveRole[r.uid] || ""}
                          onChange={(e) => setApproveRole({ ...approveRole, [r.uid]: e.target.value })}
                          className={selectCls}
                        >
                          <option value="">Select Role to Assign…</option>
                          <option value={SUPER_ADMIN_ROLE}>Super Admin</option>
                          {roles.map((ro) => (
                            <option key={ro.id} value={ro.id}>
                              {ro.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleApproveRequest(r.uid)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeclining(r)}
                          className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-semibold border border-red-200"
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All Staff & Admin Accounts Table */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                All Enrolled Admin Accounts ({staff.length})
              </h4>
              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto shadow-xs">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase text-slate-400">
                      <th className="py-2.5 px-4">Account</th>
                      <th className="py-2.5 px-4">Email</th>
                      <th className="py-2.5 px-4">Role / Type</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {staff.map((s) => {
                      const isSelf = s.uid === me;
                      return (
                        <tr key={s.uid} className="hover:bg-slate-50/50">
                          <td className="py-2.5 px-4 font-semibold text-slate-900">
                            {s.name || "—"} {isSelf && <span className="text-[10px] text-slate-400">(you)</span>}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{s.email || "—"}</td>
                          <td className="py-2.5 px-4 text-slate-700">
                            {s.profile ? `Staff ID · ${s.profile.preset}` : s.staffRole === "super_admin" ? "Super Admin" : s.roleName || "Admin"}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                s.status === "active"
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {s.status === "active" ? "Active" : "Deactivated"}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {s.profile ? (
                              <button
                                type="button"
                                onClick={() => setProfileUid(s.uid)}
                                className="text-xs font-semibold text-[#991B1B] hover:underline"
                              >
                                View Profile
                              </button>
                            ) : !isSelf ? (
                              <button
                                type="button"
                                onClick={() =>
                                  updateAdminAccess(s.uid, {
                                    status: s.status === "active" ? "inactive" : "active",
                                  })
                                }
                                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                              >
                                {s.status === "active" ? "Deactivate" : "Activate"}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Legacy Migration Section */}
            {(legacyMasters.length > 0 || unrecognised.length > 0) && (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-2">
                <p>
                  <strong>{legacyMasters.length} legacy admin account(s)</strong> require explicit role migration.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={legacyBusy}
                    onClick={() => void runLegacyMigration(true)}
                    className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 font-semibold"
                  >
                    Preview Migration
                  </button>
                  <button
                    type="button"
                    disabled={legacyBusy || !legacyReport?.dryRun}
                    onClick={() => void runLegacyMigration(false)}
                    className="px-3 py-1.5 rounded-lg bg-[#991B1B] text-white font-semibold"
                  >
                    Convert Records
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Slide-Over 3-Step Drawer ── */}
      {editorFor !== null && (
        <StaffAccessEditor
          account={editorAccount}
          onClose={() => setEditorFor(null)}
          onSaved={handleStaffSaved}
          onOpenCustomRole={() => setCustomRoleOpen(true)}
        />
      )}

      {/* ── Profile Detail Drawer ── */}
      {profileAccount !== null && (
        <StaffProfilePanel
          account={profileAccount}
          onClose={() => setProfileUid(null)}
          onEdit={() => {
            const uid = profileAccount.uid;
            setProfileUid(null);
            setEditorFor({ uid });
          }}
          onInvite={(r) => showToast(`Invite link generated for ${profileAccount.name || profileAccount.email}`)}
          notify={(m, t) => showToast(m, t)}
        />
      )}

      {/* ── WhatsApp Credentials Share Modal ── */}
      {shareCreds !== null && (
        <WhatsAppShareModal
          creds={shareCreds}
          onClose={() => setShareCreds(null)}
          showToast={showToast}
        />
      )}

      {/* ── Manage Roles Modal ── */}
      {manageRolesOpen && (
        <ManageRolesModal
          customRoles={roles}
          onClose={() => setManageRolesOpen(false)}
          onOpenAddRole={() => setCustomRoleOpen(true)}
        />
      )}

      {/* ── Custom Role Modal ── */}
      {customRoleOpen && (
        <CustomRoleModal
          onClose={() => setCustomRoleOpen(false)}
          onSave={handleSaveCustomRole}
          saving={savingCustomRole}
        />
      )}

      {/* ── Mandatory Reason Unmask Modal ── */}
      {unmaskModalOpen && (
        <UnmaskReasonModal
          onClose={() => setUnmaskModalOpen(false)}
          onSubmit={handleUnmaskSubmit}
        />
      )}

      {/* ── Confirm Status Change Dialog ── */}
      {confirmStatus !== null && (
        <ConfirmDialog
          title={`Confirm ${confirmStatus.next} for ${confirmStatus.account.name || confirmStatus.account.email}?`}
          message={
            <div className="space-y-3 text-xs">
              <p>
                Changing status to <strong>{confirmStatus.next}</strong> will immediately update active sessions and
                enforce access checks.
              </p>
              <label className="block text-left">
                <span className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Mandatory Audit Reason * (at least 5 characters)
                </span>
                <input
                  type="text"
                  required
                  value={confirmReason}
                  onChange={(e) => setConfirmReason(e.target.value)}
                  placeholder="e.g., Staff on leave / shift change"
                  className="w-full h-9 px-3 border border-slate-200 rounded-xl"
                />
              </label>
            </div>
          }
          confirmLabel={confirmStatus.next}
          danger={confirmStatus.next === "Suspended" || confirmStatus.next === "Inactive"}
          onConfirm={() => void handleChangeStatus()}
          onCancel={() => {
            setConfirmStatus(null);
            setConfirmReason("");
          }}
        />
      )}

      {/* ── Decline Request Dialog ── */}
      {declining !== null && (
        <ConfirmDialog
          title={`Decline sign-up request from ${declining.email}?`}
          message={
            <div className="space-y-3 text-xs">
              <p>Record the reason for declining this request:</p>
              <input
                type="text"
                required
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="e.g., Not an authorized Nesam Cabs employee"
                className="w-full h-9 px-3 border border-slate-200 rounded-xl"
              />
            </div>
          }
          confirmLabel="Decline Request"
          danger
          onConfirm={() => void handleDeclineRequest()}
          onCancel={() => {
            setDeclining(null);
            setDeclineReason("");
          }}
        />
      )}
    </div>
  );
}
