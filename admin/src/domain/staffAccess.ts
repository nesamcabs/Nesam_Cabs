/**
 * Pure rules behind Staff & Access Control: per-day working hours from real sessions, module access levels,
 * login ID suggestions and one-time passwords. No Firebase here, so the rules are unit tested
 * (scripts/staff-access.test.cjs).
 */
import {
  LIMITED_MODULES,
  MASTER_ONLY_MODULES,
  MODULE_ACTIONS,
  STAFF_MODULES,
  type ModuleAction,
  type StaffMatrix,
  type StaffModule,
} from "../config/permissions";

// ── Working hours ──────────────────────────────────────────────────────────

/** India Standard Time has no daylight saving: a calendar day is a fixed 24 h window at +05:30. */
const IST_OFFSET = "+05:30";
const DAY_MS = 86_400_000;
/** A session with no heartbeat for this long is no longer counted as online. */
export const ONLINE_WINDOW_MS = 30 * 60_000;

export interface SessionLike {
  uid?: string;
  status: string;
  startedAt: Date | null;
  lastActiveAt: Date | null;
  endedAt: Date | null;
}

export interface DayAttendance {
  /** First moment worked on the day (a session carried over from the night before starts at 00:00). */
  firstAt: Date | null;
  /** Latest logout, or latest activity when the person is still signed in or left without logging out. */
  lastAt: Date | null;
  /** Sum of the time covered by the person's sessions on that day; overlapping sessions (two devices) count once. */
  workedMs: number;
  sessions: number;
  online: boolean;
}

/** [start, end) of an India calendar day ("YYYY-MM-DD"). */
export function dayWindowIST(isoDay: string): [number, number] {
  const start = Date.parse(`${isoDay}T00:00:00${IST_OFFSET}`);
  return [start, start + DAY_MS];
}

/** A session is live while it is not ended, says Online, and its heartbeat is recent. */
export function isLive(s: SessionLike, now: number): boolean {
  return !s.endedAt && s.status === "Online" && !!s.lastActiveAt && now - s.lastActiveAt.getTime() < ONLINE_WINDOW_MS;
}

/** When a session really ended: the logout time; for a live session now; otherwise its last activity (never a guessed fixed length). */
export function sessionEnd(s: SessionLike, now: number): number | null {
  if (s.endedAt) return s.endedAt.getTime();
  if (isLive(s, now)) return now;
  return s.lastActiveAt?.getTime() ?? s.startedAt?.getTime() ?? null;
}

/** One person's attendance on an India calendar day, from their real session timestamps. */
export function attendanceOnDay(sessions: readonly SessionLike[], isoDay: string, now: number): DayAttendance {
  const [from, to] = dayWindowIST(isoDay);
  const spans: [number, number][] = [];
  let lastAt: number | null = null;
  let online = false;
  for (const s of sessions) {
    const start = s.startedAt?.getTime();
    const end = sessionEnd(s, now);
    if (start === undefined || end === null || end < start) continue;
    if (end <= from || start >= to) continue;
    spans.push([Math.max(start, from), Math.min(end, to)]);
    lastAt = Math.max(lastAt ?? 0, Math.min(end, to));
    if (isLive(s, now)) online = true;
  }
  spans.sort((a, b) => a[0] - b[0]);
  let worked = 0;
  let cur: [number, number] | null = null;
  for (const sp of spans) {
    if (cur && sp[0] <= cur[1]) cur[1] = Math.max(cur[1], sp[1]);
    else {
      if (cur) worked += cur[1] - cur[0];
      cur = [sp[0], sp[1]];
    }
  }
  if (cur) worked += cur[1] - cur[0];
  return { firstAt: spans.length ? new Date(spans[0][0]) : null, lastAt: lastAt === null ? null : new Date(lastAt), workedMs: worked, sessions: spans.length, online };
}

/** "7h 05m" */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

// ── Module access levels (Off / View / Edit / Full), mapped onto the permission registry ──

export type AccessLevel = "Off" | "View" | "Edit" | "Full" | "Custom";
export const ACCESS_LEVELS: readonly Exclude<AccessLevel, "Custom">[] = ["Off", "View", "Edit", "Full"];

/** Actions a Staff ID may hold on a module (Master-only modules: none; limited modules: their list). */
export function allowedActions(m: StaffModule): readonly ModuleAction[] {
  if (MASTER_ONLY_MODULES.includes(m)) return [];
  return LIMITED_MODULES[m] ?? MODULE_ACTIONS;
}

/** The actions a level grants on a module, within what the module allows. */
export function levelActions(m: StaffModule, level: Exclude<AccessLevel, "Custom">): ModuleAction[] {
  const allowed = allowedActions(m);
  const want: readonly ModuleAction[] = level === "Off" ? [] : level === "View" ? ["view"] : level === "Edit" ? ["view", "create", "edit"] : MODULE_ACTIONS;
  return MODULE_ACTIONS.filter((a) => want.includes(a) && allowed.includes(a));
}

/** The level a module's current actions match, or "Custom" for an individual override. */
export function moduleLevel(matrix: StaffMatrix, m: StaffModule): AccessLevel {
  const have = matrix.modules[m] ?? [];
  const key = (a: readonly ModuleAction[]) => MODULE_ACTIONS.filter((x) => a.includes(x)).join(",");
  for (const level of ["Off", "View", "Edit", "Full"] as const) if (key(levelActions(m, level)) === key(have)) return level;
  return "Custom";
}

/** Modules a Staff ID can hold, and how many of them this matrix enables. */
export function moduleCounts(matrix: StaffMatrix): { enabled: number; available: number } {
  const available = STAFF_MODULES.filter((m) => allowedActions(m).length > 0);
  return { enabled: available.filter((m) => (matrix.modules[m] ?? []).length > 0).length, available: available.length };
}

// ── Login IDs and one-time passwords ─────────────────────────────────────────

export const USERNAME_RULE = /^[a-z][a-z0-9._-]{2,31}$/;

/** "booking.rajesh", then "booking.rajesh2", … — the first one no existing account uses. */
export function suggestUsername(name: string, prefix: string, taken: ReadonlySet<string>): string {
  const first = name.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  const base = `${prefix}.${first || "staff"}`.slice(0, 28);
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
  return `${base}${Date.now() % 10000}`;
}

/** Login IDs already in use (usernames, and the local part of staff sign-in emails). */
export function takenUsernames(accounts: readonly { username?: string; email?: string }[]): Set<string> {
  const out = new Set<string>();
  for (const a of accounts) {
    if (a.username) out.add(a.username.toLowerCase());
    const e = (a.email ?? "").toLowerCase();
    if (e.endsWith("@staff.nesam.invalid")) out.add(e.split("@")[0]);
  }
  return out;
}

const SETS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "@#$%&*!?"];

/** A 14-character one-time password from the browser's cryptographic generator, with every character class present. */
export function strongPassword(random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const all = SETS.join("");
  const r = random(14 + 14);
  const chars = SETS.map((set, i) => set[r[i] % set.length]);
  for (let i = SETS.length; i < 14; i++) chars.push(all[r[i] % all.length]);
  // Fisher–Yates shuffle with the remaining random words, so the class order is not predictable.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = r[14 + i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ── Hub and shift (stored together in `branch` as "Hub · Shift") ─────────────

export function splitBranch(branch: string): { hub: string; shift: string } {
  const i = branch.indexOf(" · ");
  return i < 0 ? { hub: branch.trim(), shift: "" } : { hub: branch.slice(0, i).trim(), shift: branch.slice(i + 3).trim() };
}

export const joinBranch = (hub: string, shift: string): string => [hub.trim(), shift.trim()].filter(Boolean).join(" · ");
