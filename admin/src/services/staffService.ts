/**
 * Staff accounts and roles. Reads are live Firestore listeners; every change
 * goes through a super-admin Cloud Function (firestore.rules deny client
 * writes to admins/ and staff_roles/), which also writes the audit log.
 */
import { callBackend } from "./backend";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "./firebase";
import { describeDataError } from "./adminFirestoreService";
import {
  PERMISSIONS, STAFF_ROLE, STAFF_STATUSES, SUPER_ADMIN_ROLE, accessFromAdminDoc, isPermission, normalizeMatrix,
  type DutyAction, type Permission, type StaffMatrix, type StaffPreset, type StaffStatus,
} from "../config/permissions";

/**
 * service    — the server did not answer (not deployed, offline, blocked, timed out): nothing confirmed.
 * permission — the server refused the caller.
 * validation — the server refused the input (the message says what to fix).
 * conflict   — someone else changed the record first.
 */
export type StaffErrorKind = "service" | "permission" | "validation" | "conflict";

export class StaffActionError extends Error {
  kind: StaffErrorKind;
  constructor(message: string, kind: StaffErrorKind) {
    super(message);
    this.kind = kind;
  }
}

export interface StaffAccount {
  uid: string;
  username?: string;
  name: string;
  email: string;
  contactEmail?: string;
  role: string;
  status: string;
  staffRole: string;
  roleName: string;
  permissions: Permission[];
  isSuper: boolean;
  rejectionReason: string;
  createdAt: Date | null;
  /** Master only by the pre-roles default (no staffRole); migrateLegacyAdmins makes it explicit. */
  legacyMaster: boolean;
  /** An admin record the access model does not recognise: it grants nothing. */
  unrecognised: boolean;
  /** Staff IDs made in Staff & Access only (staffRole "individual"). */
  profile?: StaffProfile;
}

export interface StaffStatusEntry {
  action: string;
  from: string;
  to: string;
  reason: string;
  byName: string;
  at: Date | null;
}

export interface StaffProfile {
  staffCode: string;
  phone: string;
  contactEmail?: string;
  branch: string;
  preset: string;
  accountStatus: StaffStatus;
  matrix: StaffMatrix;
  duty: DutyAction[];
  accessVersion: number;
  statusHistory: StaffStatusEntry[];
  updatedAt: Date | null;
}

export interface StaffSessionRecord {
  id: string;
  device: string;
  browser: string;
  status: string;
  startedAt: Date | null;
  lastActiveAt: Date | null;
  endedAt: Date | null;
  endedByName: string;
}

export interface StaffActivityRecord {
  id: string;
  action: string;
  module: string;
  record: string;
  at: Date | null;
}

export interface StaffRole {
  id: string;
  name: string;
  permissions: Permission[];
}

export interface LegacyStaffRecord {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  targetId: string;
  actorName: string;
  at: Date | null;
  details: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const toDate = (v: unknown): Date | null =>
  v && typeof (v as { toDate?: unknown }).toDate === "function" ? (v as { toDate: () => Date }).toDate() : null;

function mapProfile(d: Record<string, unknown>): StaffProfile {
  const access = accessFromAdminDoc(d);
  const history = Array.isArray(d.statusHistory) ? (d.statusHistory as Record<string, unknown>[]) : [];
  return {
    staffCode: str(d.staffCode),
    phone: str(d.phone),
    contactEmail: str(d.contactEmail),
    branch: str(d.branch),
    preset: str(d.roleName) || "Custom",
    accountStatus: (STAFF_STATUSES as readonly string[]).includes(str(d.accountStatus)) ? (d.accountStatus as StaffStatus) : d.status === "active" ? "Active" : "Inactive",
    matrix: normalizeMatrix(d.staffAccess),
    duty: access.duty ?? [],
    accessVersion: typeof d.accessVersion === "number" ? d.accessVersion : 0,
    statusHistory: history
      .map((h) => ({ action: str(h.action), from: str(h.from), to: str(h.to), reason: str(h.reason), byName: str(h.byName), at: toDate(h.at) }))
      .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
    updatedAt: toDate(d.updatedAt),
  };
}

function mapAccount(uid: string, d: Record<string, unknown>): StaffAccount {
  const access = accessFromAdminDoc(d);
  return {
    uid,
    username: str(d.username),
    name: str(d.name),
    email: str(d.email),
    contactEmail: str(d.contactEmail),
    role: str(d.role),
    status: str(d.status),
    staffRole: access.isSuper ? SUPER_ADMIN_ROLE : access.staffRole,
    roleName: access.roleName,
    permissions: access.permissions,
    isSuper: access.isSuper,
    rejectionReason: str(d.rejectionReason),
    createdAt: toDate(d.createdAt),
    legacyMaster: access.isSuper && d.staffRole !== SUPER_ADMIN_ROLE,
    unrecognised: access.kind === "none" && d.role === "admin",
    ...(d.staffRole === STAFF_ROLE ? { profile: mapProfile(d) } : {}),
  };
}

type OnError = (message: string) => void;

export function subscribeStaffAccounts(cb: (accounts: StaffAccount[]) => void, onError: OnError) {
  return onSnapshot(
    collection(db, "admins"),
    (snap) => cb(snap.docs.map((d) => mapAccount(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name))),
    (err) => onError(describeDataError(err)),
  );
}

export function subscribeStaffRoles(cb: (roles: StaffRole[]) => void, onError: OnError) {
  return onSnapshot(
    collection(db, "staff_roles"),
    (snap) =>
      cb(
        snap.docs
          .map((d) => ({
            id: d.id,
            name: str(d.data().name),
            permissions: (Array.isArray(d.data().permissions) ? d.data().permissions : []).filter(isPermission),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    (err) => onError(describeDataError(err)),
  );
}

/** Records from the old Staff screen — never linked to a sign-in account. */
export function subscribeLegacyStaff(cb: (records: LegacyStaffRecord[]) => void, onError: OnError) {
  return onSnapshot(
    collection(db, "staff"),
    (snap) =>
      cb(snap.docs.map((d) => ({ id: d.id, name: str(d.data().name), email: str(d.data().email), role: str(d.data().role), status: str(d.data().status) }))),
    (err) => onError(describeDataError(err)),
  );
}

export function subscribeAuditLog(cb: (entries: AuditEntry[]) => void, onError: OnError) {
  return onSnapshot(
    query(collection(db, "admin_audit"), orderBy("at", "desc"), limit(50)),
    (snap) =>
      cb(
        snap.docs.map((d) => ({
          id: d.id,
          action: str(d.data().action),
          targetId: str(d.data().targetId),
          actorName: str(d.data().actorName),
          at: toDate(d.data().at),
          details: (d.data().details as Record<string, unknown>) || {},
        })),
      ),
    (err) => onError(describeDataError(err)),
  );
}

function toStaffError(err: unknown): StaffActionError {
  const code = ((err as { code?: string }).code || "").replace(/^functions\//, "");
  const message = (err as { message?: string }).message || "";
  if (["invalid-argument", "failed-precondition", "not-found", "already-exists"].includes(code) && message) return new StaffActionError(message, "validation");
  if (["permission-denied", "unauthenticated"].includes(code)) return new StaffActionError(message || "You do not have permission to do this.", "permission");
  if (code === "aborted" && message) return new StaffActionError(message, "conflict");
  // A function that is not deployed, a blocked request (the browser then reports a CORS error), no
  // network or a timeout all arrive here: the server never confirmed anything.
  return new StaffActionError(
    "The NESAM server did not respond, so nothing was confirmed. Check your connection; if this continues, the server functions may not be deployed. Your entries are kept and retrying will not create a duplicate.",
    "service",
  );
}

async function call<T = void>(name: string, data: Record<string, unknown>): Promise<T> {
  try {
    return await callBackend<Record<string, unknown>, T>(name, data);
  } catch (err) {
    throw toStaffError(err);
  }
}

export const approveAdminRequest = (uid: string, staffRole: string) => call("approveAdminRequest", { uid, staffRole });
export const rejectAdminRequest = (uid: string, reason: string) => call("rejectAdminRequest", { uid, reason: reason.trim() });
export const updateAdminAccess = (uid: string, change: { staffRole?: string; status?: "active" | "inactive" }) =>
  call("updateAdminAccess", { uid, ...change });
export const deleteStaffRole = (roleId: string) => call("deleteStaffRole", { roleId });

export interface LegacyAdminReport {
  dryRun: boolean;
  scanned: number;
  explicitMaster: number;
  legacyMaster: number;
  converted: number;
  remaining: number;
  roleBased: number;
  staffIds: number;
  unrecognised: string[];
}
/** Preview (dryRun) or convert pre-roles Master records to an explicit staffRole super_admin. */
export const migrateLegacyAdmins = (dryRun: boolean) => call<LegacyAdminReport>("migrateLegacyAdmins", { dryRun, limit: 100 });

export function validateRole(name: string, permissions: Permission[], roles: StaffRole[], editingId: string | null) {
  const e: { name?: string; permissions?: string } = {};
  const n = name.trim();
  if (n.length < 2 || n.length > 40) e.name = "Use 2–40 characters.";
  else if (n.toLowerCase() === "super admin") e.name = "Super Admin is a built-in role.";
  else if (roles.some((r) => r.id !== editingId && r.name.toLowerCase() === n.toLowerCase())) e.name = "Another role already has this name.";
  if (!permissions.length) e.permissions = "Choose at least one area.";
  return e;
}

export async function saveStaffRole(name: string, permissions: Permission[], roleId: string | null) {
  await call("saveStaffRole", {
    name: name.trim(),
    permissions: PERMISSIONS.filter((p) => permissions.includes(p)),
    ...(roleId ? { roleId } : {}),
  });
}

// ── Staff IDs (Staff & Access matrix) ──────────────────────────────────────

export interface StaffProfileInput {
  uid?: string;
  username?: string;
  password?: string;
  name: string;
  phone: string;
  email: string;
  contactEmail?: string;
  branch: string;
  preset: StaffPreset;
  /** New Staff IDs only: Invited (password link) or Active. */
  accountStatus?: "Invited" | "Active";
  access: StaffMatrix;
  duty: DutyAction[];
  /** Why the access is being changed (required when editing). */
  reason: string;
  /** accessVersion the editor loaded; the server refuses the save if it changed since. */
  expectedVersion?: number;
  resendInvite?: boolean;
  /** New Staff IDs: one id per Add staff form, so a retry cannot create a second account. */
  requestId?: string;
}

export interface StaffSaveResult {
  uid: string;
  username?: string;
  staffCode: string;
  contactEmail?: string;
  accessVersion: number;
  invite: { sent: boolean; link?: string; error?: string };
  /** Steps after the save that did not complete (the profile itself was saved). */
  warnings?: string[];
}

/** Same checks the server makes on identity fields; the server stays the authority. */
export function validateStaffIdentity(v: { name: string; phone: string; email: string; contactEmail?: string }) {
  const e: { name?: string; phone?: string; email?: string; contactEmail?: string } = {};
  if (v.name.trim().length < 2) e.name = "Enter the full name.";
  if (!/^[6-9]\d{9}$/.test(v.phone.replace(/\D/g, "").slice(-10))) e.phone = "Enter a valid 10-digit mobile number.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Enter a valid email address.";
  const cEmail = (v.contactEmail ?? "").trim();
  if (cEmail.length > 120) e.contactEmail = "Contact email must be 120 characters or fewer.";
  else if (cEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cEmail)) e.contactEmail = "Enter a valid contact email address.";
  return e;
}

export const saveStaffProfile = (input: StaffProfileInput) =>
  call<StaffSaveResult>("saveStaffProfile", {
    ...input,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail.trim().toLowerCase() } : {}),
    branch: input.branch.trim(),
    reason: input.reason.trim(),
  });

export const setStaffStatus = (uid: string, status: "Active" | "Inactive" | "Suspended", reason: string, expectedVersion: number) =>
  call<{ ok: boolean; grantsRevoked: number; sessionsEnded: number }>("setStaffStatus", { uid, status, reason: reason.trim(), expectedVersion });

export const resetStaffPassword = (uid: string, password: string, reason: string) =>
  call<{ ok: boolean; warnings: string[] }>("resetStaffPassword", { uid, password, reason: reason.trim() });

const SESSION_ROWS = 50;

/** Real staff_sessions records of one person (newest first). */
export function subscribeStaffSessions(uid: string, cb: (rows: StaffSessionRecord[]) => void, onError: OnError) {
  return onSnapshot(
    query(collection(db, "staff_sessions"), where("uid", "==", uid), limit(200)),
    (snap) =>
      cb(
        snap.docs
          .map((d) => ({
            id: d.id,
            device: str(d.data().device),
            browser: str(d.data().browser),
            status: str(d.data().status),
            startedAt: toDate(d.data().startedAt),
            lastActiveAt: toDate(d.data().lastActiveAt),
            endedAt: toDate(d.data().endedAt),
            endedByName: str(d.data().endedByName),
          }))
          .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0))
          .slice(0, SESSION_ROWS),
      ),
    (err) => onError(describeDataError(err)),
  );
}

/** Page views, logins and logouts recorded by the person's own sessions (newest first). */
export function subscribeStaffActivity(uid: string, cb: (rows: StaffActivityRecord[]) => void, onError: OnError) {
  return onSnapshot(
    query(collection(db, "staff_activity"), where("uid", "==", uid), limit(300)),
    (snap) =>
      cb(
        snap.docs
          .map((d) => ({ id: d.id, action: str(d.data().action), module: str(d.data().module), record: str(d.data().record), at: toDate(d.data().at) }))
          .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))
          .slice(0, 100),
      ),
    (err) => onError(describeDataError(err)),
  );
}

/** Access and status changes made to one person (admin_audit, newest first). */
export function subscribeStaffAudit(uid: string, cb: (rows: AuditEntry[]) => void, onError: OnError) {
  return onSnapshot(
    query(collection(db, "admin_audit"), where("targetId", "==", uid), limit(100)),
    (snap) =>
      cb(
        snap.docs
          .map((d) => ({
            id: d.id,
            action: str(d.data().action),
            targetId: str(d.data().targetId),
            actorName: str(d.data().actorName),
            at: toDate(d.data().at),
            details: (d.data().details as Record<string, unknown>) || {},
          }))
          .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
      ),
    (err) => onError(describeDataError(err)),
  );
}
