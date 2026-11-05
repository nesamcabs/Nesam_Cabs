import { doc, onSnapshot } from "firebase/firestore";
import { callBackend } from "./backend";
import { db } from "./firebase";
import { describeDataError } from "./adminFirestoreService";
import { toDate } from "./paymentService";

/**
 * The platform commission policy (business_config/commission). The server
 * (functions/src/commission.ts) is the only writer and resolves the rate for
 * each booking: service rule → vehicle category rule → global rule. With no
 * matching rule the booking is refused — there is no built-in default.
 */
export type CommissionBase = "taxable" | "total";

export interface CommissionPolicy {
  base: CommissionBase;
  global: number | null;
  services: Record<string, number>;
  categories: Record<string, number>;
  version: number;
  updatedByName: string;
  updatedAt: Date | null;
}

export class CommissionActionError extends Error {}

const validRate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

function ratesOf(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") {
    for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
      const rate = r && typeof r === "object" ? (r as { rate?: unknown }).rate : undefined;
      if (validRate(rate)) out[k] = rate;
    }
  }
  return out;
}

/** Same reading as the server: a missing or malformed policy is "not configured". */
export function parseCommissionPolicy(d: Record<string, unknown> | undefined): CommissionPolicy | null {
  if (!d || (d.base !== "taxable" && d.base !== "total")) return null;
  const g = d.global && typeof d.global === "object" ? (d.global as { rate?: unknown }).rate : undefined;
  return {
    base: d.base,
    global: validRate(g) ? g : null,
    services: ratesOf(d.services),
    categories: ratesOf(d.categories),
    version: typeof d.version === "number" ? d.version : 0,
    updatedByName: typeof d.updatedByName === "string" ? d.updatedByName : "",
    updatedAt: toDate(d.updatedAt),
  };
}

export function subscribeCommissionPolicy(cb: (policy: CommissionPolicy | null, exists: boolean) => void, onError: (message: string) => void) {
  return onSnapshot(
    doc(db, "business_config", "commission"),
    (snap) => cb(snap.exists() ? parseCommissionPolicy(snap.data()) : null, snap.exists()),
    (err) => onError(describeDataError(err)),
  );
}

/** The rule a booking of this service / vehicle category would use (null = booking refused). */
export function resolveCommission(policy: CommissionPolicy | null, scope: { serviceId?: string; categoryId?: string }) {
  if (!policy) return null;
  if (scope.serviceId && policy.services[scope.serviceId] !== undefined) return { rate: policy.services[scope.serviceId], source: "service" as const };
  if (scope.categoryId && policy.categories[scope.categoryId] !== undefined) return { rate: policy.categories[scope.categoryId], source: "category" as const };
  return policy.global !== null ? { rate: policy.global, source: "global" as const } : null;
}

export interface CommissionForm {
  base: CommissionBase | "";
  global: string;
  services: Record<string, string>;
  categories: Record<string, string>;
}

export const formFromPolicy = (p: CommissionPolicy | null): CommissionForm => ({
  base: p?.base ?? "",
  global: p?.global !== null && p?.global !== undefined ? String(p.global) : "",
  services: Object.fromEntries(Object.entries(p?.services ?? {}).map(([k, v]) => [k, String(v)])),
  categories: Object.fromEntries(Object.entries(p?.categories ?? {}).map(([k, v]) => [k, String(v)])),
});

/** Blank = no rule at that level. Otherwise a percentage from 0 to 100 with up to two decimals. */
export function parseRate(v: string): number | null | "invalid" {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return "invalid";
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : "invalid";
}

export function validateCommissionForm(f: CommissionForm): { errors: Record<string, string>; policy: { base: CommissionBase; global: { rate: number } | null; services: Record<string, { rate: number }>; categories: Record<string, { rate: number }> } | null } {
  const errors: Record<string, string> = {};
  if (f.base !== "taxable" && f.base !== "total") errors.base = "Choose what the commission is taken from.";
  const global = parseRate(f.global);
  if (global === "invalid") errors.global = "Enter a percentage from 0 to 100.";
  const rules = (m: Record<string, string>, prefix: string) => {
    const out: Record<string, { rate: number }> = {};
    for (const [id, raw] of Object.entries(m)) {
      const r = parseRate(raw);
      if (r === "invalid") errors[`${prefix}:${id}`] = "0–100";
      else if (r !== null) out[id] = { rate: r };
    }
    return out;
  };
  const services = rules(f.services, "service");
  const categories = rules(f.categories, "category");
  if (Object.keys(errors).length || (f.base !== "taxable" && f.base !== "total") || global === "invalid") return { errors, policy: null };
  return { errors, policy: { base: f.base, global: global === null ? null : { rate: global }, services, categories } };
}

function describeCallError(err: unknown, fallback: string): string {
  const code = (err as { code?: string }).code || "";
  const message = (err as { message?: string }).message || "";
  if (/^functions\/(invalid-argument|failed-precondition|permission-denied|not-found|unauthenticated)$/.test(code) && message) return message;
  return fallback;
}

export async function saveCommissionPolicy(policy: NonNullable<ReturnType<typeof validateCommissionForm>["policy"]>, expectedVersion: number): Promise<number> {
  try {
    const res = await callBackend<unknown, { version: number }>("saveCommissionPolicy", { ...policy, expectedVersion });
    return res.version;
  } catch (err) {
    throw new CommissionActionError(describeCallError(err, "The commission policy could not be saved. Check your connection and try again."));
  }
}

export interface LedgerRebuildReport {
  dryRun: boolean;
  tripsToFinalize: number;
  tripEntriesToCreate: number;
  payoutEntriesToCreate: number;
  skippedUnverified: string[];
  missingPayout: string[];
}

/** Super admin: backfills finance snapshots and ledger entries for older records. Dry run changes nothing. */
export async function rebuildPartnerLedger(dryRun: boolean): Promise<LedgerRebuildReport> {
  try {
    return await callBackend<unknown, LedgerRebuildReport>("rebuildPartnerLedger", { dryRun }, 540000);
  } catch (err) {
    throw new CommissionActionError(describeCallError(err, "The ledger check could not be completed. Try again."));
  }
}
