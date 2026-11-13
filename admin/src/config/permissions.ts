/**
 * Staff permissions. These keys are enforced by firestore.rules / storage.rules
 * (can('…')) and by the server functions (functions/src/permissions.ts);
 * the Staff & Access matrix contract below is the same code in both files.
 * Hiding a page or an action here is only a convenience — the rules and the
 * functions are what actually allow or deny each action.
 */
export const SUPER_ADMIN_ROLE = "super_admin";

export const PERMISSIONS = [
  "operations",
  "people",
  "fleet",
  "pricing",
  "content",
  "finance",
  "compliance",
  "reports",
  "engagement",
  "system",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_INFO: Record<Permission, { label: string; description: string }> = {
  operations: { label: "Operations", description: "Bookings, live trips, marketplace, manual bookings and dispatch" },
  people: { label: "People", description: "Customers, vendors and drivers, including KYC review and approvals" },
  fleet: { label: "Fleet", description: "Vehicles and their document review" },
  pricing: { label: "Pricing", description: "Vehicle category fares, fare rules, offers and coupons" },
  content: { label: "Content", description: "Services, tour packages and locations" },
  finance: { label: "Finance", description: "Payments, invoices, earnings, payouts and fare overrides" },
  compliance: { label: "Compliance", description: "Penalties and disputes" },
  reports: { label: "Reports", description: "Reports & analytics (read access to financial records)" },
  engagement: { label: "Engagement", description: "Notifications, reviews and support tickets" },
  system: { label: "System", description: "Company settings and B2B integrations" },
};

/** Permission a page needs. null = every active admin; "super" = super admins only. */
export const PAGE_ACCESS: Record<string, Permission | null | "super"> = {
  dashboard: null,
  trips: "operations",
  bookings: "operations",
  "booking-detail": "operations",
  "new-booking": "operations",
  "quick-fare": "operations",
  marketplace: "operations",
  customers: "people",
  business: "people",
  vendors: "people",
  "vendor-drivers": "people",
  verification: "people",
  drivers: "people",
  "partner-links": "people",
  // Listing is open to every active admin; each decision checks operations / finance / people on the server.
  "partner-requests": null,
  vehicles: "fleet",
  categories: "pricing",
  pricing: "pricing",
  "local-taxi": "pricing",
  "fare-rules": "pricing",
  "extra-charges": "pricing",
  offers: "pricing",
  services: "content",
  packages: "content",
  locations: "content",
  accounts: "finance",
  "full-final": "finance",
  payments: "finance",
  invoices: "finance",
  earnings: "finance",
  "vendor-finance": "finance",
  "security-deposit": "finance",
  penalties: "compliance",
  reports: "reports",
  notifications: "engagement",
  reviews: "engagement",
  support: "engagement",
  b2b: "system",
  settings: "system",
  security: "system",
  legal: "system",
  staff: "super",
};

/**
 * Matrix module(s) whose View a Staff ID needs to open a page (any one of a list). Pages are kept
 * under the module the Staff & Access matrix names them by; the permission above still applies.
 */
export const PAGE_MODULE: Record<string, StaffModule | StaffModule[]> = {
  dashboard: "Dashboard",
  bookings: "Bookings",
  "booking-detail": "Bookings",
  "new-booking": "Bookings",
  "quick-fare": "Bookings",
  trips: "Bookings",
  marketplace: "Bookings",
  "partner-requests": ["Bookings", "Partners & Fleet", "Accounts"],
  customers: "Customers",
  business: "Business accounts",
  drivers: "Driver Partners",
  vendors: "Vendors",
  "vendor-drivers": "Vendor Drivers",
  vehicles: "Vehicles",
  verification: "Partners & Fleet",
  "partner-links": "Partners & Fleet",
  categories: "Settings",
  accounts: "Accounts",
  "full-final": "Accounts",
  payments: "Accounts",
  earnings: "Accounts",
  "vendor-finance": "Accounts",
  "security-deposit": "Accounts",
  invoices: "Invoices",
  penalties: "Penalties",
  reports: "Reports & GST",
  notifications: "Communication",
  support: "Support",
  reviews: "Support",
  pricing: "Settings",
  "local-taxi": "Settings",
  "fare-rules": "Settings",
  "extra-charges": "Settings",
  offers: "Settings",
  services: "Settings",
  packages: "Settings",
  locations: "Settings",
  b2b: "Settings",
  settings: "Settings",
  security: "Settings",
  legal: "Settings",
  staff: "Staff & Access",
};

/** Page-level action a Staff ID needs beyond View (e.g. opening the new-booking form). */
const PAGE_ACTION: Record<string, ModuleAction> = { "new-booking": "create", "quick-fare": "create" };

/** Staff & Access › Duty permissions (enforced by the booking server for Staff IDs). */
export const DUTY_ACTIONS = [["approve", "Approve booking"], ["publish", "Publish duty"], ["payout", "Change payout / bidding"], ["assign", "Assign on behalf"], ["remove", "Remove allocation"]] as const;
export type DutyAction = (typeof DUTY_ACTIONS)[number][0];
const DUTY_KEYS: DutyAction[] = DUTY_ACTIONS.map(([k]) => k);
export const DUTY_LABEL = Object.fromEntries(DUTY_ACTIONS) as Record<DutyAction, string>;

export interface AdminAccess {
  /** master / legacy (role-based) / staff (Staff ID) / none — identityKindOf, same as the server and rules. */
  kind: IdentityKind;
  isSuper: boolean;
  staffRole: string;
  roleName: string;
  permissions: Permission[];
  /** Effective duty actions (Staff ID: its own; role-based: legacy mapping; Master: all). */
  duty: DutyAction[];
  /** Effective matrix (Staff ID: its own; role-based: legacyAccessOf; Master and none: empty, never consulted for Master). */
  matrix: StaffMatrix;
  staffCode?: string;
  /** Lifecycle status of a Staff ID (Invited / Active / Inactive / Suspended). */
  accountStatus?: StaffStatus;
  /** Bumped by the server on every access or status change. */
  accessVersion?: number;
}

const NO_MATRIX: StaffMatrix = { modules: {}, accountControls: {}, bankLimit: 0, sensitive: {}, privacy: {}, fleetSwap: {}, partnerRights: {} };
export const NO_ACCESS: AdminAccess = { kind: "none", isSuper: false, staffRole: "", roleName: "", permissions: [], duty: [], matrix: NO_MATRIX };

export const isPermission = (v: unknown): v is Permission =>
  typeof v === "string" && (PERMISSIONS as readonly string[]).includes(v);

/**
 * Same interpretation as the rules and functions/src/permissions.ts accessOf. A missing record or an
 * unrecognised one grants nothing; role-based staff get the explicit legacy mapping; a Staff ID is
 * limited by its matrix (a missing or damaged matrix grants nothing).
 */
export function accessFromAdminDoc(d: Record<string, unknown> | undefined): AdminAccess {
  if (!d) return NO_ACCESS;
  const kind = identityKindOf(d);
  const listed = Array.isArray(d.permissions) ? d.permissions.filter(isPermission) : [];
  const common = {
    staffRole: typeof d.staffRole === "string" ? d.staffRole : "",
    ...(typeof d.staffCode === "string" ? { staffCode: d.staffCode } : {}),
    ...((STAFF_STATUSES as readonly string[]).includes(String(d.accountStatus)) ? { accountStatus: d.accountStatus as StaffStatus } : {}),
    ...(typeof d.accessVersion === "number" ? { accessVersion: d.accessVersion } : {}),
  };
  const roleName = typeof d.roleName === "string" && d.roleName ? d.roleName : "Staff";
  if (kind === "master") return { ...common, kind, isSuper: true, roleName: "Super Admin", permissions: [...PERMISSIONS], duty: [...DUTY_KEYS], matrix: NO_MATRIX };
  if (kind === "legacy") {
    const legacy = legacyAccessOf(listed);
    return { ...common, kind, isSuper: false, roleName, permissions: listed, duty: legacy.duty, matrix: legacy.matrix };
  }
  if (kind === "staff") {
    const matrix = normalizeMatrix(d.staffAccess);
    const duty = Array.isArray(d.dutyPermissions) ? DUTY_KEYS.filter((x) => (d.dutyPermissions as unknown[]).includes(x)) : [];
    return { ...common, kind, isSuper: false, roleName, permissions: listed.filter((p) => permissionsOf(matrix).includes(p)), duty, matrix };
  }
  return { ...NO_ACCESS, ...common, roleName: "Unrecognised access" };
}

/** Module action from the effective matrix (role-based staff included, via the legacy mapping). */
export function canDo(access: AdminAccess, module: StaffModule, action: ModuleAction): boolean {
  return access.isSuper || matrixAllows(access.matrix, module, action);
}

/** Separate right (sensitive data, swaps, partner rights, privacy) from the effective matrix. */
export function hasFlag(access: AdminAccess, group: FlagGroup, key: string): boolean {
  return access.isSuper || matrixFlag(access.matrix, group, key);
}

/** Separate right a page's data needs on top of its module (the rules refuse the reads otherwise). */
const PAGE_FLAG: Record<string, [FlagGroup, string]> = {
  marketplace: ["sensitive", "vendorPayout"],
  offers: ["partnerRights", "viewCoupons"],
};

export function canAccessPage(access: AdminAccess, page: string): boolean {
  const need = PAGE_ACCESS[page];
  if (need === "super") return access.isSuper;
  if (access.isSuper) return true;
  if (access.kind === "none") return false;
  // Preserve coupon readers from either former entry point; the workspace gates writes separately.
  if (page === "offers") return hasFlag(access, "partnerRights", "viewCoupons") && (
    (access.permissions.includes("pricing") && matrixAllows(access.matrix, "Settings", "view")) ||
    (access.permissions.includes("engagement") && matrixAllows(access.matrix, "Communication", "view"))
  );
  if (need && !access.permissions.includes(need)) return false;
  const flag = PAGE_FLAG[page];
  if (flag && !hasFlag(access, flag[0], flag[1])) return false;
  const modules = PAGE_MODULE[page];
  if (!modules) return false;
  const action = PAGE_ACTION[page] ?? "view";
  return (Array.isArray(modules) ? modules : [modules]).some((m) => matrixAllows(access.matrix, m, action));
}

/** Export / print from a page: Export on the page's module in the effective matrix. */
export function canExportFrom(access: AdminAccess, page: string): boolean {
  if (access.isSuper) return true;
  const modules = PAGE_MODULE[page];
  return !!modules && (Array.isArray(modules) ? modules : [modules]).some((m) => matrixAllows(access.matrix, m, "export"));
}

/** Booking documents carry partner payouts and margin: without the payout right they come redacted from the server. */
export const needsRedactedBookings = (access: AdminAccess): boolean => !hasFlag(access, "sensitive", "vendorPayout");

/** The first page in navigation order the admin may open; null when none (access unavailable). */
export function landingPage(access: AdminAccess, order: readonly string[]): string | null {
  if (canAccessPage(access, "dashboard")) return "dashboard";
  return order.find((p) => canAccessPage(access, p)) ?? null;
}

// ── Staff & Access: the per-person matrix (admins/{uid}.staffAccess) ────────
// Identical contract in functions/src/permissions.ts. A Staff ID (staffRole STAFF_ROLE) is
// limited by this matrix in the functions and the rules; role-based staff and super admins are
// limited by `permissions` only, exactly as before. Nothing here grants anything by role label:
// presets only pre-fill the editor, and the saved matrix is what counts.
export const STAFF_ROLE = "individual";
export const STAFF_MODULES = [
  "Dashboard", "Bookings", "Customers", "Partners & Fleet", "Accounts", "Invoices", "Reports & GST", "Communication", "Support",
  "Staff & Access", "Settings", "Driver Partners", "Vendors", "Vendor Drivers", "Vehicles", "Business accounts", "Penalties",
] as const;
export type StaffModule = (typeof STAFF_MODULES)[number];
export const MODULE_ACTIONS = ["view", "create", "edit", "approve", "export", "send"] as const;
export type ModuleAction = (typeof MODULE_ACTIONS)[number];
export const ACCOUNT_TYPES = ["Driver Partners", "Vendors", "Vendor Drivers", "Vehicles"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_ACTIONS = ["suspend", "reactivate", "inactive", "dispute"] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];
export const STAFF_STATUSES = ["Invited", "Active", "Inactive", "Suspended"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];
export const STAFF_PRESETS = ["Booking staff", "Dispatcher", "Accounts staff", "Support staff", "Manager", "Custom"] as const;
export type StaffPreset = (typeof STAFF_PRESETS)[number];
export const STAFF_FLAGS = {
  sensitive: ["vendorPayout", "bankDetails"],
  privacy: ["temporaryReveal", "requestApproval", "copyAfterReveal"],
  fleetSwap: ["driver", "vehicle"],
  partnerRights: ["viewCoupons", "applyCoupon", "createVehicle", "createDriver", "approveVehicleDocs", "approveDriverDocs"],
} as const;
export type FlagGroup = keyof typeof STAFF_FLAGS;
/** Modules a Staff ID can never hold, and modules limited to the listed actions: Master-only work. */
export const MASTER_ONLY_MODULES: readonly StaffModule[] = ["Staff & Access"];
export const LIMITED_MODULES: Partial<Record<StaffModule, readonly ModuleAction[]>> = { Settings: ["view", "export"] };
/** Modules whose records include partner payouts / company margin. */
export const PAYOUT_MODULES: readonly StaffModule[] = ["Accounts", "Invoices", "Reports & GST"];

/** Module "view" → the permission key(s) the rules and functions enforce. */
export const MODULE_PERMISSION: Record<StaffModule, Permission[]> = {
  Dashboard: [], Bookings: ["operations"], Customers: ["people"], "Partners & Fleet": ["people", "fleet"], Accounts: ["finance"], Invoices: ["finance"],
  "Reports & GST": ["reports"], Communication: ["engagement"], Support: ["engagement"], "Staff & Access": [], Settings: ["system", "pricing", "content"],
  "Driver Partners": ["people"], Vendors: ["people"], "Vendor Drivers": ["people"], Vehicles: ["fleet"], "Business accounts": ["people"], Penalties: ["compliance"],
};

export interface StaffMatrix {
  modules: Partial<Record<StaffModule, ModuleAction[]>>;
  accountControls: Partial<Record<AccountType, AccountAction[]>>;
  /** Largest single settlement / payout (₹) this Staff ID may mark paid. 0 = none. */
  bankLimit: number;
  sensitive: Record<string, boolean>;
  privacy: Record<string, boolean>;
  fleetSwap: Record<string, boolean>;
  partnerRights: Record<string, boolean>;
}

const pickList = <T extends string>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? allowed.filter((a) => v.includes(a)) : []);
const flagMap = (v: unknown, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, !!(v && typeof v === "object" && (v as Record<string, unknown>)[k] === true)]));

/** Any stored or submitted value → a clean matrix (unknown keys dropped, nothing defaulted to true). */
export function normalizeMatrix(v: unknown): StaffMatrix {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const rawModules = (o.modules && typeof o.modules === "object" ? o.modules : {}) as Record<string, unknown>;
  const rawControls = (o.accountControls && typeof o.accountControls === "object" ? o.accountControls : {}) as Record<string, unknown>;
  const limit = Number(o.bankLimit);
  return {
    modules: Object.fromEntries(STAFF_MODULES.map((m) => [m, pickList(rawModules[m], MODULE_ACTIONS)]).filter(([, a]) => (a as string[]).length)),
    accountControls: Object.fromEntries(ACCOUNT_TYPES.map((t) => [t, pickList(rawControls[t], ACCOUNT_ACTIONS)]).filter(([, a]) => (a as string[]).length)),
    bankLimit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 0,
    sensitive: flagMap(o.sensitive, STAFF_FLAGS.sensitive), privacy: flagMap(o.privacy, STAFF_FLAGS.privacy),
    fleetSwap: flagMap(o.fleetSwap, STAFF_FLAGS.fleetSwap), partnerRights: flagMap(o.partnerRights, STAFF_FLAGS.partnerRights),
  };
}

export const emptyMatrix = (): StaffMatrix => normalizeMatrix({});
export const matrixAllows = (m: StaffMatrix | undefined, module: StaffModule, action: ModuleAction): boolean => !!m?.modules?.[module]?.includes(action);
export const matrixFlag = (m: StaffMatrix | undefined, group: FlagGroup, key: string): boolean => m?.[group]?.[key] === true;

/** Enforced permission keys: those a module the matrix can view maps to. */
export function permissionsOf(m: StaffMatrix): Permission[] {
  return PERMISSIONS.filter((p) => STAFF_MODULES.some((mod) => matrixAllows(m, mod, "view") && MODULE_PERMISSION[mod].includes(p)));
}

/** Initial selections for a preset. Custom starts from the dashboard only. */
export function presetAccess(preset: StaffPreset): { matrix: StaffMatrix; duty: DutyAction[] } {
  const m = emptyMatrix();
  const give = (mod: StaffModule, acts: string) => { m.modules[mod] = MODULE_ACTIONS.filter((a) => acts.split(" ").includes(a) || m.modules[mod]?.includes(a)); };
  let duty: DutyAction[] = [];
  give("Dashboard", "view");
  m.privacy.requestApproval = true;
  if (preset === "Booking staff") { give("Bookings", "view create edit"); give("Customers", "view create edit"); give("Support", "view create"); }
  if (preset === "Dispatcher") {
    give("Bookings", "view edit approve"); give("Support", "view edit approve");
    for (const mod of ["Partners & Fleet", "Driver Partners", "Vendors", "Vendor Drivers", "Vehicles"] as const) give(mod, "view");
    duty = ["publish", "assign"];
    m.sensitive.vendorPayout = true;
  }
  if (preset === "Accounts staff") {
    give("Accounts", "view create approve export"); give("Invoices", "view create edit approve export"); give("Reports & GST", "view export"); give("Bookings", "view");
    m.sensitive.vendorPayout = true;
  }
  if (preset === "Support staff") { give("Customers", "view"); give("Bookings", "view"); give("Support", "view create edit"); }
  if (preset === "Manager") {
    for (const mod of STAFF_MODULES) if (mod !== "Dashboard" && !MASTER_ONLY_MODULES.includes(mod) && !LIMITED_MODULES[mod]) give(mod, "view create edit approve export");
    duty = ["approve"];
    m.sensitive.vendorPayout = true;
  }
  return { matrix: m, duty };
}

export type Requirement =
  | { kind: "module"; module: StaffModule; action: ModuleAction; because: string }
  | { kind: "flag"; group: FlagGroup; key: string; because: string }
  | { kind: "duty"; action: DutyAction; because: string };

const SWAP_LABEL: Record<string, string> = { driver: "Driver swap", vehicle: "Vehicle swap" };
const RIGHT_NEEDS: Record<string, [StaffModule, ModuleAction]> = {
  viewCoupons: ["Bookings", "view"], applyCoupon: ["Bookings", "create"], createVehicle: ["Vehicles", "create"],
  createDriver: ["Driver Partners", "create"], approveVehicleDocs: ["Vehicles", "approve"], approveDriverDocs: ["Driver Partners", "approve"],
};

/** Grants the selections depend on and do not hold yet. The editor adds them visibly; the server refuses a save that lacks them. */
export function missingRequirements(m: StaffMatrix, duty: readonly DutyAction[]): Requirement[] {
  const out: Requirement[] = [];
  const needModule = (module: StaffModule, action: ModuleAction, because: string) => {
    if (!matrixAllows(m, module, action) && !out.some((r) => r.kind === "module" && r.module === module && r.action === action)) out.push({ kind: "module", module, action, because });
  };
  const needFlag = (group: FlagGroup, key: string, because: string) => {
    if (!matrixFlag(m, group, key) && !out.some((r) => r.kind === "flag" && r.group === group && r.key === key)) out.push({ kind: "flag", group, key, because });
  };
  for (const mod of STAFF_MODULES) if ((m.modules[mod] ?? []).some((a) => a !== "view")) needModule(mod, "view", `${mod} actions`);
  for (const d of duty) { needModule("Bookings", "view", DUTY_LABEL[d]); needModule("Bookings", "approve", DUTY_LABEL[d]); }
  if (duty.includes("payout")) needFlag("sensitive", "vendorPayout", DUTY_LABEL.payout);
  for (const t of ACCOUNT_TYPES) if ((m.accountControls[t] ?? []).length) { needModule(t, "view", `${t} account controls`); needModule(t, "approve", `${t} account controls`); }
  if (m.bankLimit > 0) { needModule("Accounts", "view", "Settlement approval limit"); needModule("Accounts", "approve", "Settlement approval limit"); }
  if (m.sensitive.bankDetails) needModule("Accounts", "view", "Bank settlement details");
  if (m.sensitive.vendorPayout) needModule("Bookings", "view", "Vendor payout / company margin");
  // Finance records, invoices and reports read booking finance snapshots; duties other than approval
  // show or set the partner payout. Both need the payout right (the booking record carries it).
  for (const mod of PAYOUT_MODULES) if (matrixAllows(m, mod, "view")) needFlag("sensitive", "vendorPayout", `${mod} view`);
  for (const d of duty) if (d !== "approve") needFlag("sensitive", "vendorPayout", DUTY_LABEL[d]);
  for (const k of STAFF_FLAGS.fleetSwap) if (m.fleetSwap[k]) {
    needModule("Bookings", "edit", SWAP_LABEL[k]);
    if (!duty.includes("assign") && !out.some((r) => r.kind === "duty")) out.push({ kind: "duty", action: "assign", because: SWAP_LABEL[k] });
  }
  for (const k of STAFF_FLAGS.partnerRights) if (m.partnerRights[k]) needModule(RIGHT_NEEDS[k][0], RIGHT_NEEDS[k][1], k);
  if (m.partnerRights.applyCoupon) needFlag("partnerRights", "viewCoupons", "Apply coupon");
  if (STAFF_FLAGS.privacy.some((k) => m.privacy[k])) needModule("Bookings", "view", "Customer privacy access");
  if (m.privacy.copyAfterReveal && !m.privacy.temporaryReveal && !m.privacy.requestApproval) needFlag("privacy", "requestApproval", "Copy after reveal");
  return out;
}

/** The selections plus everything they depend on (repeated until stable). */
export function withRequirements(m: StaffMatrix, duty: readonly DutyAction[]): { matrix: StaffMatrix; duty: DutyAction[]; added: Requirement[] } {
  const next = normalizeMatrix(JSON.parse(JSON.stringify(m)));
  const nextDuty = [...duty];
  const added: Requirement[] = [];
  for (let i = 0; i < 5; i++) {
    const missing = missingRequirements(next, nextDuty);
    if (!missing.length) break;
    for (const r of missing) {
      added.push(r);
      if (r.kind === "module") next.modules[r.module] = MODULE_ACTIONS.filter((a) => a === r.action || next.modules[r.module]?.includes(a));
      else if (r.kind === "flag") next[r.group][r.key] = true;
      else if (!nextDuty.includes(r.action)) nextDuty.push(r.action);
    }
  }
  return { matrix: next, duty: DUTY_KEYS.filter((d) => nextDuty.includes(d)), added };
}

export function describeRequirement(r: Requirement): string {
  if (r.kind === "module") return `${r.module} · ${r.action} (needed for ${r.because})`;
  if (r.kind === "flag") return `${r.key} (needed for ${r.because})`;
  return `${DUTY_LABEL[r.action]} (needed for ${r.because})`;
}

/** Selections that can never be saved for a Staff ID, plus unmet dependencies. Empty = valid. */
export function accessProblems(m: StaffMatrix, duty: readonly DutyAction[], status: StaffStatus): string[] {
  const out: string[] = [];
  for (const mod of MASTER_ONLY_MODULES) if ((m.modules[mod] ?? []).length) out.push(`${mod} is managed by the Master account only.`);
  for (const [mod, allowed] of Object.entries(LIMITED_MODULES) as [StaffModule, readonly ModuleAction[]][]) {
    const extra = (m.modules[mod] ?? []).filter((a) => !allowed.includes(a));
    if (extra.length) out.push(`${mod} can only be granted ${allowed.join(" / ")}; changes stay with the Master account.`);
  }
  if (!Number.isFinite(m.bankLimit) || m.bankLimit < 0 || m.bankLimit > 100_000_000) out.push("Enter a valid settlement approval limit.");
  if (status === "Active" && !STAFF_MODULES.some((mod) => matrixAllows(m, mod, "view"))) out.push("An active Staff ID needs at least one module with View access.");
  for (const r of missingRequirements(m, duty)) out.push(`Missing ${describeRequirement(r)}.`);
  return out;
}

// ── Identity kinds and the legacy compatibility policy ─────────────────────
// master  — staffRole SUPER_ADMIN_ROLE, or a pre-roles admin record that carries no other access
//           data (what scripts/set-admin-claim.mjs wrote). migrateLegacyAdmins makes those explicit.
// legacy  — staffRole is a staff_roles/{id}: limited by LEGACY mapping of its permission keys.
// staff   — a Staff ID (STAFF_ROLE): limited by its own matrix.
// none    — anything else (malformed record, unknown role id): no access at all.
export type IdentityKind = "master" | "legacy" | "staff" | "none";
export const STAFF_ROLE_ID = /^[A-Za-z0-9_-]{2,40}$/;
const ACCESS_FIELDS = ["permissions", "staffAccess", "dutyPermissions", "roleName"];

export function identityKindOf(d: Record<string, unknown> | undefined | null): IdentityKind {
  if (!d) return "none";
  const role = d.staffRole;
  if (role === SUPER_ADMIN_ROLE) return "master";
  if (role === undefined || role === null || role === "") return ACCESS_FIELDS.some((k) => k in d) ? "none" : "master";
  if (role === STAFF_ROLE) return "staff";
  return typeof role === "string" && STAFF_ROLE_ID.test(role) ? "legacy" : "none";
}

/** Legacy finance roles were never limited; this cap stands in until the account becomes a Staff ID. */
export const LEGACY_SETTLEMENT_LIMIT = 100_000_000;

/** Separate rights a legacy role keeps, by the permission keys that granted them before (any one). */
export const LEGACY_FLAG_NEEDS: Record<FlagGroup, Record<string, Permission[]>> = {
  sensitive: { vendorPayout: ["operations", "finance", "reports", "compliance"], bankDetails: ["finance"] },
  privacy: { temporaryReveal: ["operations"], requestApproval: ["operations"], copyAfterReveal: ["operations"] },
  fleetSwap: { driver: ["operations"], vehicle: ["operations"] },
  partnerRights: {
    viewCoupons: ["operations", "pricing", "finance"], applyCoupon: ["pricing", "finance"], createVehicle: ["fleet"],
    approveVehicleDocs: ["fleet"], createDriver: ["people"], approveDriverDocs: ["people"],
  },
};
const LEGACY_CONTROL_NEEDS: Record<AccountType, Permission> = { "Driver Partners": "people", Vendors: "people", "Vendor Drivers": "people", Vehicles: "fleet" };

/**
 * Explicit compatibility mapping for role-based staff: every module whose permission key the role
 * holds, with all actions (what those keys allowed before); Staff & Access never; the separate
 * rights in LEGACY_FLAG_NEEDS; account controls of the people / fleet areas except permanent block;
 * every duty with operations. Nothing here is granted that the role"s keys did not already allow.
 */
export function legacyAccessOf(permissions: readonly Permission[]): { matrix: StaffMatrix; duty: DutyAction[] } {
  const m = emptyMatrix();
  const has = (p: Permission) => permissions.includes(p);
  for (const mod of STAFF_MODULES) {
    if (MASTER_ONLY_MODULES.includes(mod)) continue;
    const keys = MODULE_PERMISSION[mod];
    if (mod === "Dashboard" ? permissions.length > 0 : keys.some(has)) m.modules[mod] = [...MODULE_ACTIONS];
  }
  for (const group of Object.keys(LEGACY_FLAG_NEEDS) as FlagGroup[]) {
    for (const [key, needs] of Object.entries(LEGACY_FLAG_NEEDS[group])) m[group][key] = needs.some(has);
  }
  for (const t of ACCOUNT_TYPES) if (has(LEGACY_CONTROL_NEEDS[t])) m.accountControls[t] = [...ACCOUNT_ACTIONS];
  m.bankLimit = has("finance") ? LEGACY_SETTLEMENT_LIMIT : 0;
  return { matrix: m, duty: has("operations") ? [...DUTY_KEYS] : [] };
}
