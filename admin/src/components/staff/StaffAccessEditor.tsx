import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNT_ACTIONS,
  ACCOUNT_TYPES,
  DUTY_ACTIONS,
  LIMITED_MODULES,
  MASTER_ONLY_MODULES,
  MODULE_ACTIONS,
  STAFF_PRESETS,
  accessProblems,
  describeRequirement,
  missingRequirements,
  normalizeMatrix,
  presetAccess,
  withRequirements,
  type AccountAction,
  type AccountType,
  type DutyAction,
  type FlagGroup,
  type ModuleAction,
  type Requirement,
  type StaffMatrix,
  type StaffModule,
  type StaffPreset,
  type StaffStatus,
} from "../../config/permissions";
import {
  StaffActionError,
  saveStaffProfile,
  validateStaffIdentity,
  type StaffAccount,
  type StaffErrorKind,
  type StaffRole,
  type StaffSaveResult,
} from "../../services/staffService";
import {
  ACCESS_LEVELS,
  USERNAME_RULE,
  joinBranch,
  levelActions,
  moduleCounts,
  moduleLevel,
  splitBranch,
  strongPassword,
  suggestUsername,
  takenUsernames,
} from "../../domain/staffAccess";
import { parseIndianMobile } from "../../utils/phone";
import { presetPolicy } from "./rolePresets";
import { newId } from "../../services/callables";
import { ConfirmDialog } from "../Feedback";
import Icon from "../ui/Icon";

const ACTION_LABEL: Record<ModuleAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  approve: "Approve",
  export: "Export",
  send: "Send",
};

export { ROLE_PRESETS_META, MODULE_GROUPS, type RolePresetMeta } from "./rolePresets";
import { ROLE_PRESETS_META, MODULE_GROUPS, type RolePresetMeta } from "./rolePresets";

const SHIFT_OPTIONS = [
  "General Day Shift (09:00 AM – 06:00 PM)",
  "Morning Shift (06:00 AM – 02:00 PM)",
  "Evening Shift (02:00 PM – 10:00 PM)",
  "Night Shift / After-Hours (10:00 PM – 06:00 AM)",
];

const HUB_OPTIONS = [
  "Coimbatore HQ",
  "Madurai Hub",
  "Chennai Airport Desk",
  "Trichy Hub",
  "Salem Hub",
  "Main Office",
];

interface Draft {
  username: string;
  password: string;
  confirmPassword: string;
  name: string;
  phone: string;
  email: string;
  contactEmail: string;
  shift: string;
  hub: string;
  preset: StaffPreset;
  /** Custom role (staff_roles) this Staff ID uses; "" for a built-in preset. */
  customRoleId: string;
  customRoleName: string;
  accountStatus: "Invited" | "Active";
  matrix: StaffMatrix;
  duty: DutyAction[];
  adminNotes: string;
  reason: string;
}

const clone = (m: StaffMatrix) => normalizeMatrix(JSON.parse(JSON.stringify(m)));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isPreset = (v: string): v is StaffPreset => (STAFF_PRESETS as readonly string[]).includes(v);
const cellAllowed = (m: StaffModule, a: ModuleAction) =>
  !MASTER_ONLY_MODULES.includes(m) && (!LIMITED_MODULES[m] || LIMITED_MODULES[m]!.includes(a));
const metaOf = (preset: string): RolePresetMeta | undefined => ROLE_PRESETS_META.find((r) => r.preset === preset);
const POLICY_TEXT = { none: "Numbers masked", temporary: "Temporary reveal", "on approval": "Reveal on approval" } as const;

function initialDraft(account: StaffAccount | null, startPreset: StaffPreset, taken: ReadonlySet<string>): Draft {
  const p = account?.profile;
  if (!account || !p) {
    const preset = presetAccess(startPreset);
    const pass = strongPassword();
    return {
      username: suggestUsername("", metaOf(startPreset)?.prefix ?? "staff", taken),
      password: pass,
      confirmPassword: pass,
      name: "",
      phone: "",
      email: "",
      contactEmail: "",
      shift: SHIFT_OPTIONS[0],
      hub: HUB_OPTIONS[0],
      preset: startPreset,
      customRoleId: "",
      customRoleName: "",
      accountStatus: "Active",
      matrix: preset.matrix,
      duty: preset.duty,
      adminNotes: "",
      reason: "",
    };
  }
  // Existing values are kept exactly as saved: hub / shift from "Hub · Shift", an unknown preset stays "Custom".
  const { hub, shift } = splitBranch(p.branch || "");
  return {
    username: account.username ?? "",
    password: "",
    confirmPassword: "",
    name: account.name,
    phone: p.phone,
    email: account.email,
    contactEmail: account.contactEmail || p.contactEmail || "",
    shift,
    hub,
    preset: isPreset(p.preset) ? p.preset : "Custom",
    customRoleId: p.customRoleId,
    customRoleName: p.customRoleName,
    accountStatus: p.accountStatus === "Active" ? "Active" : "Invited",
    matrix: clone(p.matrix),
    duty: [...p.duty],
    adminNotes: p.adminNotes,
    reason: "",
  };
}

export default function StaffAccessEditor({
  account,
  accounts,
  customRoles,
  startPreset = "Booking & Enquiry Executive",
  pendingRole,
  onPendingRoleUsed,
  onClose,
  onSaved,
  onOpenCustomRole,
}: {
  account: StaffAccount | null;
  /** Every admin account (login IDs and mobiles already in use). */
  accounts: StaffAccount[];
  /** Custom roles; null while they are still loading. */
  customRoles: StaffRole[] | null;
  /** Preset a new Staff ID starts with. */
  startPreset?: StaffPreset;
  /** A custom role created from this drawer: selected as soon as it is saved (no wait for the list to refresh). */
  pendingRole?: StaffRole | null;
  onPendingRoleUsed?: () => void;
  onClose: () => void;
  onSaved: (
    result: StaffSaveResult,
    created: boolean,
    who: { name: string; email: string },
    creds?: { username: string; password?: string; shift?: string; role?: string }
  ) => void;
  onOpenCustomRole?: () => void;
}) {
  const editing = !!account;
  const taken = useMemo(() => takenUsernames(accounts.filter((a) => a.uid !== account?.uid)), [accounts, account]);
  const [initial] = useState(() => initialDraft(account, startPreset, taken));
  // A typed login ID is never overwritten by the name-based suggestion.
  const [usernameEdited, setUsernameEdited] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [baseVersion] = useState(() => account?.profile?.accessVersion ?? 0);
  const [d, setD] = useState<Draft>(initial);
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [added, setAdded] = useState<Requirement[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ kind: StaffErrorKind; message: string } | null>(null);
  const [requestId] = useState(() => newId("staff"));
  const [touched, setTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [enabledOnly, setEnabledOnly] = useState(false);

  const dirty = !same(d, initial);
  const status: StaffStatus = editing ? account!.profile?.accountStatus ?? "Inactive" : d.accountStatus;

  // Real-time identity & credentials check
  const identityErrors = validateStaffIdentity({
    ...d,
    email: editing ? d.email : `${d.username.trim().toLowerCase()}@staff.nesam.invalid`,
    contactEmail: d.contactEmail,
  });

  const loginId = d.username.trim().toLowerCase();
  const phoneKey = parseIndianMobile(d.phone);
  const phoneTaken = !!phoneKey && accounts.some((a) => a.uid !== account?.uid && a.profile?.phone === phoneKey);
  if (phoneTaken && !identityErrors.phone) identityErrors.phone = "This mobile number already has a Staff ID.";
  const credentialError = !editing
    ? !USERNAME_RULE.test(loginId)
      ? "Login ID must be 3–32 characters, start with a letter, and use letters, numbers, dots, underscores or hyphens."
      : taken.has(loginId)
      ? `The login ID "${loginId}" is already in use. Choose another one.`
      : d.password.length < 8 || d.password.length > 128
      ? "Use a password between 8 and 128 characters."
      : d.password !== d.confirmPassword
      ? "Passwords do not match."
      : ""
    : "";

  const missing = useMemo(() => missingRequirements(d.matrix, d.duty), [d.matrix, d.duty]);
  const problems = useMemo(
    () => accessProblems(d.matrix, d.duty, status).filter((p) => !p.startsWith("Missing ")),
    [d.matrix, d.duty, status]
  );
  const reasonError = editing && d.reason.trim().length < 5 ? "Record why this access is changing (at least 5 characters)." : "";
  const step1Blocked = Object.keys(identityErrors).length > 0 || !!credentialError;
  const blocked = step1Blocked || missing.length > 0 || problems.length > 0 || !!reasonError;

  // Before unload warning
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Escape closes the drawer (only when it is the top dialog), focus starts inside it, Tab stays inside, and focus returns.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("input,select,button:not([aria-label='Close'])")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  const prefixOf = (x: Pick<Draft, "preset" | "customRoleId">) => {
    const base = x.customRoleId ? [...(customRoles ?? []), ...localRoles].find((r) => r.id === x.customRoleId)?.basePreset ?? "" : x.preset;
    return metaOf(base)?.prefix ?? "staff";
  };

  // The login ID follows the name until it is typed by hand.
  const handleNameChange = (name: string) => {
    setD((curr) => ({ ...curr, name, ...(editing || usernameEdited ? {} : { username: suggestUsername(name, prefixOf(curr), taken) }) }));
  };

  const regeneratePassword = () => {
    const pass = strongPassword();
    setD((curr) => ({ ...curr, password: pass, confirmPassword: pass }));
    setShowPassword(false);
  };

  const update = (next: { matrix: StaffMatrix; duty: DutyAction[] }, granting: boolean) => {
    if (granting) {
      const r = withRequirements(next.matrix, next.duty);
      setAdded(r.added);
      setD((x) => ({ ...x, matrix: r.matrix, duty: r.duty }));
    } else {
      setAdded([]);
      setD((x) => ({ ...x, matrix: next.matrix, duty: next.duty }));
    }
  };

  const toggleModule = (m: StaffModule, a: ModuleAction, on: boolean) => {
    const matrix = clone(d.matrix);
    const row = matrix.modules[m] ?? [];
    matrix.modules[m] = on ? MODULE_ACTIONS.filter((x) => x === a || row.includes(x)) : a === "view" ? [] : row.filter((x) => x !== a);
    update({ matrix, duty: d.duty }, on);
  };

  const toggleDuty = (k: DutyAction, on: boolean) =>
    update(
      {
        matrix: d.matrix,
        duty: on ? DUTY_ACTIONS.map(([x]) => x).filter((x) => x === k || d.duty.includes(x)) : d.duty.filter((x) => x !== k),
      },
      on
    );

  const toggleControl = (t: AccountType, a: AccountAction, on: boolean) => {
    const matrix = clone(d.matrix);
    const row = matrix.accountControls[t] ?? [];
    matrix.accountControls[t] = on ? ACCOUNT_ACTIONS.filter((x) => x === a || row.includes(x)) : row.filter((x) => x !== a);
    update({ matrix, duty: d.duty }, on);
  };

  const toggleFlag = (g: FlagGroup, k: string, on: boolean) => {
    const matrix = clone(d.matrix);
    matrix[g][k] = on;
    update({ matrix, duty: d.duty }, on);
  };

  const setLimit = (v: string) => {
    const n = Math.max(0, Math.round(Number(v) || 0));
    const matrix = clone(d.matrix);
    matrix.bankLimit = n;
    update({ matrix, duty: d.duty }, n > d.matrix.bankLimit);
  };

  const choosePreset = (p: StaffPreset) => {
    const next = presetAccess(p);
    setAdded([]);
    setD((x) => ({
      ...x,
      preset: p,
      customRoleId: "",
      customRoleName: "",
      ...(editing || usernameEdited ? {} : { username: suggestUsername(x.name, metaOf(p)?.prefix ?? "staff", taken) }),
      matrix: next.matrix,
      duty: next.duty,
    }));
  };

  /** A custom role starts from its base preset's modules and duties; an older role without one keeps the current access. */
  const chooseCustomRole = (role: StaffRole) => {
    const base = isPreset(role.basePreset) && role.basePreset !== "Custom" ? role.basePreset : null;
    const next = base ? presetAccess(base) : { matrix: d.matrix, duty: d.duty };
    setAdded([]);
    setD((x) => ({
      ...x,
      preset: "Custom",
      customRoleId: role.id,
      customRoleName: role.name,
      ...(editing || usernameEdited ? {} : { username: suggestUsername(x.name, metaOf(base ?? "")?.prefix ?? "staff", taken) }),
      matrix: next.matrix,
      duty: next.duty,
    }));
  };

  // A role created from this drawer is selected straight away, from the saved role itself, and listed until the
  // role list catches up.
  const [localRoles, setLocalRoles] = useState<StaffRole[]>([]);
  const shownRoles = useMemo(() => {
    const list = customRoles ?? [];
    return [...list, ...localRoles.filter((r) => !list.some((x) => x.id === r.id))];
  }, [customRoles, localRoles]);
  useEffect(() => {
    if (!pendingRole) return;
    setLocalRoles((l) => (l.some((r) => r.id === pendingRole.id) ? l : [...l, pendingRole]));
    chooseCustomRole(pendingRole);
    onPendingRoleUsed?.();
  }, [pendingRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const setLevel = (m: StaffModule, level: (typeof ACCESS_LEVELS)[number]) => {
    const matrix = clone(d.matrix);
    matrix.modules[m] = levelActions(m, level);
    update({ matrix, duty: d.duty }, level !== "Off");
  };

  const missingRole = editing && !!d.customRoleId && customRoles !== null && !shownRoles.some((r) => r.id === d.customRoleId);

  const close = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  const save = async () => {
    if (saving) return;
    setTouched(true);
    if (step1Blocked) { setActiveStep(1); return; }
    if (blocked) return;
    setSaving(true);
    setError(null);
    try {
      // Hub and shift are saved on every edit; an untouched legacy free-text branch is sent back unchanged.
      const before = account?.profile ? splitBranch(account.profile.branch || "") : null;
      const hubShiftChanged = !before || before.hub !== d.hub.trim() || before.shift !== d.shift.trim();
      const branchValue = hubShiftChanged ? joinBranch(d.hub, d.shift) : account!.profile!.branch;
      const result = await saveStaffProfile({
        ...(editing
          ? { uid: account!.uid, expectedVersion: baseVersion }
          : {
              accountStatus: "Active",
              requestId,
              username: loginId,
              password: d.password,
            }),
        name: d.name,
        phone: phoneKey ?? d.phone,
        email: editing ? d.email : `${loginId}@staff.nesam.invalid`,
        contactEmail: d.contactEmail,
        branch: branchValue,
        preset: d.preset,
        access: d.matrix,
        duty: d.duty,
        reason: d.reason,
        ...(!editing || d.customRoleId !== initial.customRoleId ? { customRoleId: d.customRoleId } : {}),
        ...(!editing || d.adminNotes !== initial.adminNotes ? { adminNotes: d.adminNotes.trim() } : {}),
      });

      const roleLabel = d.customRoleId ? d.customRoleName : d.preset;
      const creds = !editing ? { username: loginId, password: d.password, shift: d.shift, role: roleLabel } : undefined;
      setD((curr) => ({ ...curr, password: "", confirmPassword: "" }));
      onSaved(result, !editing, { name: d.name.trim(), email: d.email.trim().toLowerCase() }, creds);
    } catch (e) {
      setError(
        e instanceof StaffActionError
          ? { kind: e.kind, message: e.message }
          : { kind: "service", message: "The server did not confirm the save. Your entries are kept; try again." }
      );
    } finally {
      setSaving(false);
    }
  };

  const counts = useMemo(() => moduleCounts(d.matrix), [d.matrix]);
  const revealMode = d.matrix.privacy.temporaryReveal ? "Temporary reveal" : d.matrix.privacy.requestApproval ? "Reveal on approval" : "Numbers masked";

  return (
    <>
      <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex justify-end" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="staff-editor-title" className="w-full sm:max-w-2xl min-w-0 bg-white h-full shadow-2xl flex flex-col drawer-slide-in">
          {/* Drawer Header */}
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-crimson-50 text-[#991B1B] flex items-center justify-center font-bold">
                <Icon name="user-round-plus" size={18} />
              </div>
              <div>
                <h2 id="staff-editor-title" className="text-sm font-bold text-slate-900 break-words">
                  {editing ? `Edit Access · ${account!.name || account!.email}` : "Create Staff Login ID"}
                </h2>
                <p className="text-[11px] text-slate-500">
                  {editing
                    ? `${account!.profile?.staffCode ?? ""} · ${status}`
                    : "The login ID is suggested from the name; you can type your own."}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              disabled={saving}
              aria-label="Close"
              className="w-8 h-8 shrink-0 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors"
            >
              <Icon name="x" size={16} />
            </button>
          </div>

          {/* 3-Step Navigation Bar */}
          <nav aria-label="Steps" className="px-3 sm:px-5 py-2.5 bg-slate-50 border-b border-slate-200/80 grid grid-cols-3 gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveStep(1)}
              className={`py-2 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeStep === 1
                  ? "bg-white text-[#991B1B] shadow-xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                  activeStep === 1 ? "bg-[#991B1B] text-white" : "bg-slate-200 text-slate-700"
                }`}
              >
                1
              </span>
              <span>Profile &amp; Role</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTouched(true);
                if (!step1Blocked) setActiveStep(2);
              }}
              className={`py-2 px-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                activeStep === 2
                  ? "bg-white text-[#991B1B] font-bold shadow-xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                  activeStep === 2 ? "bg-[#991B1B] text-white font-bold" : "bg-slate-200 text-slate-700"
                }`}
              >
                2
              </span>
              <span>Modules ({counts.enabled}/{counts.available})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTouched(true);
                if (!step1Blocked) setActiveStep(3);
              }}
              className={`py-2 px-2.5 rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                activeStep === 3
                  ? "bg-white text-[#991B1B] font-bold shadow-xs border border-slate-200/80"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${
                  activeStep === 3 ? "bg-[#991B1B] text-white font-bold" : "bg-slate-200 text-slate-700"
                }`}
              >
                3
              </span>
              <span>Duty &amp; Privacy</span>
            </button>
          </nav>

          {/* Drawer Scrollable Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {error && (
              <div
                role="alert"
                className={`p-3 rounded-xl border text-xs ${
                  error.kind === "service"
                    ? "bg-amber-50 border-amber-200 text-amber-900"
                    : "bg-red-50 border-red-200 text-red-700"
                }`}
              >
                <strong className="block mb-0.5">
                  {error.kind === "service"
                    ? "Server not reachable"
                    : error.kind === "permission"
                    ? "Not permitted"
                    : error.kind === "conflict"
                    ? "Changed by someone else"
                    : "Check the details"}
                </strong>
                {error.message}
              </div>
            )}

            {/* ── STEP 1: IDENTITY, CREDENTIALS & ROLE PRESETS ── */}
            {activeStep === 1 && (
              <div className="space-y-4 fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder="e.g., Rajesh Kumar"
                      className="w-full h-10 px-3 text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                    />
                    {touched && identityErrors.name && (
                      <p className="text-[10px] text-red-600 mt-1">{identityErrors.name}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Mobile Number *
                    </label>
                    <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
                      <span className="px-2.5 text-xs font-semibold text-slate-500 bg-slate-50 h-full flex items-center border-r border-slate-200">
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="tel"
                        maxLength={18}
                        value={d.phone}
                        onChange={(e) => setD({ ...d, phone: e.target.value })}
                        placeholder="10-digit mobile (+91 optional)"
                        className="w-full h-full px-2.5 text-sm font-medium text-slate-900 focus:outline-none"
                      />
                    </div>
                    {touched && identityErrors.phone && (
                      <p className="text-[10px] text-red-600 mt-1">{identityErrors.phone}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Email ID (Optional)
                    </label>
                    <input
                      type="email"
                      value={d.contactEmail}
                      onChange={(e) => setD({ ...d, contactEmail: e.target.value })}
                      placeholder="staff@nesamtravels.com"
                      className="w-full h-10 px-3 text-xs sm:text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                    />
                    {touched && identityErrors.contactEmail && (
                      <p className="text-[10px] text-red-600 mt-1">{identityErrors.contactEmail}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Branch / Hub
                    </label>
                    <input
                      type="text"
                      list="hub-options"
                      value={d.hub}
                      onChange={(e) => setD({ ...d, hub: e.target.value })}
                      placeholder="e.g. Coimbatore HQ"
                      className="w-full h-10 px-3 text-xs sm:text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                    />
                    <datalist id="hub-options">
                      {HUB_OPTIONS.map((h) => (
                        <option key={h} value={h} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {/* Working Shift Selector */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Assigned Working Shift
                  </label>
                  <input
                    type="text"
                    list="shift-options"
                    value={d.shift}
                    onChange={(e) => setD({ ...d, shift: e.target.value })}
                    placeholder="e.g. General Day Shift (09:00 AM – 06:00 PM)"
                    className="w-full h-10 px-3 text-xs sm:text-sm font-medium text-slate-900 bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                  />
                  <datalist id="shift-options">
                    {SHIFT_OPTIONS.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </div>

                {/* Login ID & one-time password (new Staff IDs). Existing passwords are never shown. */}
                {!editing ? (
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <Icon name="key-round" size={14} className="text-[#991B1B]" />
                      <span>Login ID &amp; one-time password</span>
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <label htmlFor="staff-login-id" className="block text-[10px] font-semibold text-slate-500 mb-1">Login ID *</label>
                        <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
                          <span className="px-2.5 text-xs font-bold text-slate-400 bg-slate-50 h-full flex items-center border-r border-slate-200">@</span>
                          <input id="staff-login-id" type="text" autoComplete="off" spellCheck={false} value={d.username}
                            onChange={(e) => { setUsernameEdited(true); setD({ ...d, username: e.target.value.toLowerCase().replace(/\s+/g, "") }); }}
                            maxLength={32} className="w-full min-w-0 h-full px-2.5 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none" />
                        </div>
                        {usernameEdited && (
                          <button type="button" onClick={() => { setUsernameEdited(false); setD((x) => ({ ...x, username: suggestUsername(x.name, prefixOf(x), taken) })); }}
                            className="mt-1 text-[11px] font-semibold text-[#991B1B] hover:underline">Use suggestion</button>
                        )}
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="staff-password" className="block text-[10px] font-semibold text-slate-500 mb-1">One-time password *</label>
                        <div className="flex items-center h-10 bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-[#991B1B]">
                          <input id="staff-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={d.password}
                            onChange={(e) => setD({ ...d, password: e.target.value, confirmPassword: e.target.value })}
                            className="w-full min-w-0 h-full px-3 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none" />
                          <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"} className="px-2 h-full text-slate-400 hover:text-slate-700">
                            <Icon name={showPassword ? "eye-off" : "eye"} size={14} />
                          </button>
                          <button type="button" onClick={regeneratePassword} title="Generate a new strong password"
                            className="px-2.5 h-full text-[11px] font-bold text-[#991B1B] bg-crimson-50 hover:bg-crimson-100 border-l border-slate-200">New</button>
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-500">After the Staff ID is created you can copy the sign-in details once. Passwords are not stored or shown again; use Reset password in the profile later.</p>
                    {touched && credentialError && <p role="alert" className="text-[11px] text-red-600 font-medium">{credentialError}</p>}
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs min-w-0">
                    <span className="font-semibold text-slate-700">Login ID: </span>
                    <span className="font-mono text-slate-900 font-bold break-all">@{account!.username || account!.email}</span>
                    <span className="block text-[11px] text-slate-500 mt-1">The login ID is fixed. To issue a new password, use Reset password in the profile.</span>
                  </div>
                )}

                {/* Role Presets Selection Grid */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                      Select Nesam Cabs Role Preset
                    </label>
                    {onOpenCustomRole && (
                      <button
                        type="button"
                        onClick={onOpenCustomRole}
                        className="text-[11px] font-semibold text-[#991B1B] hover:underline flex items-center gap-1"
                      >
                        <Icon name="plus" size={12} />
                        <span>Add Extra Role</span>
                      </button>
                    )}
                  </div>
                  {missingRole && (
                    <p role="alert" className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                      The custom role “{d.customRoleName || d.customRoleId}” assigned to this Staff ID no longer exists. Its saved modules are kept; choose a role below to change it.
                    </p>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Role">
                    {ROLE_PRESETS_META.map((meta) => {
                      const isSelected = !d.customRoleId && d.preset === meta.preset;
                      const pol = presetPolicy(meta.preset);
                      return (
                        <button key={meta.id} type="button" role="radio" aria-checked={isSelected} onClick={() => choosePreset(meta.preset)}
                          className={`text-left p-3 rounded-2xl border transition-all min-w-0 ${isSelected ? "bg-red-50/50 border-red-500 ring-2 ring-red-500/10 shadow-xs" : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"}`}>
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border truncate ${meta.badgeClass}`}>{meta.shortName}</span>
                            {isSelected && <Icon name="check" size={14} className="text-red-600 shrink-0" />}
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 break-words">{meta.name}</h4>
                          <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{meta.desc}</p>
                          <p className="mt-2 text-[10px] text-slate-500">{POLICY_TEXT[pol.reveal]} · {pol.exports ? "Some exports" : "No exports"}</p>
                        </button>
                      );
                    })}
                    {customRoles === null && <p className="text-[11px] text-slate-500 p-3">Loading custom roles…</p>}
                    {shownRoles.map((role) => {
                      const isSelected = d.customRoleId === role.id;
                      return (
                        <button key={role.id} type="button" role="radio" aria-checked={isSelected} onClick={() => chooseCustomRole(role)}
                          className={`text-left p-3 rounded-2xl border transition-all min-w-0 ${isSelected ? "bg-amber-50/60 border-amber-500 ring-2 ring-amber-500/10 shadow-xs" : "bg-white border-amber-200 hover:bg-amber-50/40"}`}>
                          <div className="flex items-center justify-between gap-1.5 mb-1">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-200">Custom role</span>
                            {isSelected && <Icon name="check" size={14} className="text-amber-700 shrink-0" />}
                          </div>
                          <h4 className="text-xs font-bold text-slate-900 break-words">{role.name}</h4>
                          <p className="text-[11px] text-slate-500 mt-0.5">{role.basePreset ? `Starts from ${role.basePreset}` : "Keeps the current module access"}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: GROUPED WORKSPACE MODULES (17 MODULES) ── */}
            {activeStep === 2 && (
              <div className="space-y-4 fade-in">
                <div className="flex items-center justify-between gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                  <p className="text-xs text-slate-600">
                    Choose Off, View, Edit or Full per module; tick individual actions for an exception (shown as Custom). {counts.enabled} of {counts.available} modules enabled.
                  </p>
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 shrink-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enabledOnly}
                      onChange={(e) => setEnabledOnly(e.target.checked)}
                      className="rounded border-slate-300 text-[#991B1B]"
                    />
                    <span>Enabled Only</span>
                  </label>
                </div>

                <div className="space-y-4">
                  {MODULE_GROUPS.map((grp) => {
                    const filteredItems = enabledOnly
                      ? grp.items.filter((m) => (d.matrix.modules[m] ?? []).length > 0)
                      : grp.items;
                    if (filteredItems.length === 0) return null;

                    return (
                      <div key={grp.title} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                            {grp.title}
                          </span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/40">
                                <th className="px-4 py-2 text-left">Module</th>
                                <th className="px-2 py-2 text-left">Access</th>
                                {MODULE_ACTIONS.map((a) => (
                                  <th key={a} className="px-2 py-2 text-center">
                                    {ACTION_LABEL[a]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {filteredItems.map((m) => {
                                const isMasterOnly = MASTER_ONLY_MODULES.includes(m);
                                return (
                                  <tr key={m} className="hover:bg-slate-50/50">
                                    <td className="px-4 py-2.5 font-semibold text-slate-800">
                                      {m}
                                      {isMasterOnly && (
                                        <span className="block text-[10px] font-normal text-amber-700">Master Only</span>
                                      )}
                                      {m === "Customers" && (
                                        <span className="block text-[10px] font-normal text-slate-500">
                                          Customer list export stays Master-only · number reveals need “Temporary reveal” (step 3)
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-2 py-2">
                                      {isMasterOnly ? <span className="text-[11px] text-slate-400">Off</span> : (
                                        <select aria-label={`${m} access level`} disabled={saving} value={moduleLevel(d.matrix, m)}
                                          onChange={(e) => e.target.value !== "Custom" && setLevel(m, e.target.value as (typeof ACCESS_LEVELS)[number])}
                                          className="h-8 px-2 text-[11px] font-semibold border border-slate-200 rounded-lg bg-white focus:outline-none focus:border-[#991B1B]">
                                          {ACCESS_LEVELS.map((l) => <option key={l}>{l}</option>)}
                                          {moduleLevel(d.matrix, m) === "Custom" && <option value="Custom">Custom</option>}
                                        </select>
                                      )}
                                    </td>
                                    {MODULE_ACTIONS.map((a) => (
                                      <td key={a} className="px-2 py-2.5 text-center">
                                        <input
                                          type="checkbox"
                                          disabled={!cellAllowed(m, a) || saving}
                                          checked={!!d.matrix.modules[m]?.includes(a)}
                                          onChange={(e) => toggleModule(m, a, e.target.checked)}
                                          className="rounded border-slate-300 text-[#991B1B] focus:ring-[#991B1B]"
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── STEP 3: DUTY PERMISSIONS, PRIVACY & ACCOUNT CONTROLS ── */}
            {activeStep === 3 && (
              <div className="space-y-4 fade-in">
                {/* Duty Permissions */}
                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2.5 shadow-xs">
                  <h4 className="text-xs font-bold text-slate-900">Duty Permissions</h4>
                  <p className="text-[11px] text-slate-500">Each duty action requires Bookings view &amp; approve access.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                    {DUTY_ACTIONS.map(([k, label]) => (
                      <label
                        key={k}
                        className="flex items-center gap-2 p-2 rounded-xl border border-slate-200/80 hover:bg-slate-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          disabled={saving}
                          checked={d.duty.includes(k)}
                          onChange={(e) => toggleDuty(k, e.target.checked)}
                          className="rounded border-slate-300 text-[#991B1B]"
                        />
                        <span className="font-medium text-slate-800">{label}</span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2 p-2 rounded-xl border border-slate-200/80 hover:bg-slate-50 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={saving}
                        checked={d.matrix.fleetSwap.driver && d.matrix.fleetSwap.vehicle}
                        onChange={(e) => {
                          const on = e.target.checked;
                          const m = clone(d.matrix);
                          m.fleetSwap.driver = on;
                          m.fleetSwap.vehicle = on;
                          update({ matrix: m, duty: d.duty }, on);
                        }}
                        className="rounded border-slate-300 text-[#991B1B]"
                      />
                      <span className="font-medium text-slate-800">Driver &amp; Vehicle Swap</span>
                    </label>
                  </div>
                </div>

                {/* Customer Privacy & Sensitive Data */}
                <div className="p-4 rounded-2xl border border-amber-200/90 bg-amber-50/40 space-y-3 shadow-xs">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                      <Icon name="shield-alert" size={16} className="text-amber-700" />
                      <span>Customer Privacy &amp; Sensitive Data</span>
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                      Audit Logged
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-white border border-amber-200/70">
                      <p className="font-bold text-slate-900 flex items-center gap-1.5"><Icon name="eye-off" size={14} className="text-amber-700" />Customer numbers stay masked</p>
                      <p className="text-[11px] text-slate-500">Every Staff ID sees masked numbers. A reveal needs a mandatory reason, is logged under this Staff ID, and hides again automatically.</p>
                    </div>

                    <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer">
                      <div>
                        <p className="font-semibold text-slate-800">Request a reveal for Master approval</p>
                        <p className="text-[11px] text-slate-500">Asks the Master to approve a reveal on other bookings</p>
                      </div>
                      <input type="checkbox" checked={d.matrix.privacy.requestApproval === true} onChange={(e) => toggleFlag("privacy", "requestApproval", e.target.checked)}
                        className="w-4 h-4 shrink-0 rounded border-slate-300 text-[#991B1B]" />
                    </label>

                    <label className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer">
                      <div>
                        <p className="font-semibold text-slate-800">Temporary reveal on handled bookings</p>
                        <p className="text-[11px] text-slate-500">
                          Allows reveal only on duties this person accepted, published, or handled
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={d.matrix.privacy.temporaryReveal === true}
                        onChange={(e) => toggleFlag("privacy", "temporaryReveal", e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-[#991B1B]"
                      />
                    </label>

                    <label className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer">
                      <div>
                        <p className="font-semibold text-slate-800">Copy button after authorised reveal</p>
                        <p className="text-[11px] text-slate-500">Allows copying number after an approved reveal</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={d.matrix.privacy.copyAfterReveal === true}
                        onChange={(e) => toggleFlag("privacy", "copyAfterReveal", e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-[#991B1B]"
                      />
                    </label>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-red-50/60 border border-red-200/80">
                      <div>
                        <p className="font-bold text-red-900 flex items-center gap-1.5">
                          <Icon name="lock" size={14} className="text-red-700" />
                          <span>Customer &amp; Driver Data Export</span>
                        </p>
                        <p className="text-[11px] text-red-700/90">
                          Permanently disabled for all Staff IDs — Master Admin Only
                        </p>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase bg-red-100 text-red-800 border border-red-200 shrink-0">
                        Master Only
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                        Settlement Approval Limit (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={d.matrix.bankLimit}
                        onChange={(e) => setLimit(e.target.value)}
                        className="w-full h-9 px-3 text-xs font-bold bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]"
                      />
                    </div>
                    <div className="flex flex-col justify-center gap-1.5 text-xs pt-2">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.matrix.sensitive.vendorPayout === true}
                          onChange={(e) => toggleFlag("sensitive", "vendorPayout", e.target.checked)}
                          className="rounded border-slate-300 text-[#991B1B]"
                        />
                        <span className="font-medium text-slate-700">View Vendor Margin</span>
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={d.matrix.sensitive.bankDetails === true}
                          onChange={(e) => toggleFlag("sensitive", "bankDetails", e.target.checked)}
                          className="rounded border-slate-300 text-[#991B1B]"
                        />
                        <span className="font-medium text-slate-700">View Bank Settlement Details</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Account Controls Matrix */}
                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-2.5 shadow-xs">
                  <h4 className="text-xs font-bold text-slate-900">Account Controls (Driver / Vendor / Vehicle)</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400">
                          <th className="py-2">Account Type</th>
                          {ACCOUNT_ACTIONS.map((a) => (
                            <th key={a} className="py-2 text-center capitalize">
                              {a}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {ACCOUNT_TYPES.map((t) => (
                          <tr key={t}>
                            <td className="py-2 font-medium text-slate-800">{t}</td>
                            {ACCOUNT_ACTIONS.map((a) => (
                              <td key={a} className="py-2 text-center">
                                <input
                                  type="checkbox"
                                  disabled={saving}
                                  checked={!!d.matrix.accountControls[t]?.includes(a)}
                                  onChange={(e) => toggleControl(t, a, e.target.checked)}
                                  className="rounded border-slate-300 text-[#991B1B]"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Requirements Resolution / Warnings */}
                {added.length > 0 && (
                  <div role="status" className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs">
                    <strong className="block mb-1">Also granted automatically:</strong>
                    <ul className="list-disc pl-5">
                      {added.map((r, i) => (
                        <li key={i}>{describeRequirement(r)}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(missing.length > 0 || problems.length > 0) && (
                  <div role="alert" className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
                    <strong className="block mb-1">Resolve before saving:</strong>
                    <ul className="list-disc pl-5">
                      {problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                      {missing.map((r, i) => (
                        <li key={i}>Missing {describeRequirement(r)}</li>
                      ))}
                    </ul>
                    {missing.length > 0 && (
                      <button
                        type="button"
                        onClick={() => update({ matrix: d.matrix, duty: d.duty }, true)}
                        className="mt-2 px-3 py-1 bg-amber-700 text-white rounded-lg text-xs font-semibold hover:bg-amber-800"
                      >
                        Add Required Access
                      </button>
                    )}
                  </div>
                )}

                {/* Admin notes (saved with the profile) and, when editing, the audited reason for this change */}
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label htmlFor="staff-admin-notes" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Admin notes · Master only</label>
                    <textarea id="staff-admin-notes" rows={2} maxLength={1000} value={d.adminNotes} onChange={(e) => setD({ ...d, adminNotes: e.target.value })}
                      placeholder="e.g., Handles Coimbatore morning enquiries & quotes"
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B] resize-y" />
                  </div>
                  <div>
                    <label htmlFor="staff-reason" className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">{editing ? "Reason for this change *" : "Reason (optional, kept in the history)"}</label>
                    <input id="staff-reason" type="text" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} maxLength={300}
                      placeholder={editing ? "e.g., Shift updated to night desk" : "e.g., New booking desk hire"}
                      className="w-full h-10 px-3 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-[#991B1B]" />
                    {touched && reasonError && <p className="text-[10px] text-red-600 mt-1">{reasonError}</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Sticky Drawer Footer with Live Summary Pill */}
          <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
            <div className="min-w-0 text-[11px] font-semibold text-slate-600 bg-white border border-slate-200 px-3 py-1.5 rounded-xl truncate">
              Role: <strong className="text-slate-900">{d.customRoleId ? d.customRoleName : d.preset}</strong> • {counts.enabled}/{counts.available} modules • {revealMode}
            </div>

            <div className="flex items-center gap-2 shrink-0 justify-end">
              {activeStep > 1 && (
                <button
                  type="button"
                  onClick={() => setActiveStep((s) => (s > 1 ? ((s - 1) as 1 | 2) : 1))}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-100"
                >
                  ← Back
                </button>
              )}

              {activeStep < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    setTouched(true);
                    if (activeStep === 1 && step1Blocked) return;
                    setActiveStep((s) => ((s + 1) as 2 | 3));
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800"
                >
                  Next Step →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || (touched && blocked)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-[#991B1B] hover:bg-[#7F1D1D] text-white shadow-xs flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Icon name="check" size={14} />
                  <span>{saving ? "Saving…" : editing ? "Save Profile & Permissions" : "Create Staff Login"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="The changes in this form have not been saved."
          confirmLabel="Discard"
          danger
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </>
  );
}
