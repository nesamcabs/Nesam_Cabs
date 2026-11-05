/**
 * Service & Fare Settings rules (service_rules): booking availability, cab types, pricing
 * adjustments and fare limits scoped to a state / city / area and a pickup schedule. The booking
 * server (functions/src/serviceRules.ts) applies the enabled rules to every quote and booking.
 */
import { collection, onSnapshot, type Timestamp } from "firebase/firestore";
import { db } from "./firebase";
import { callFunction } from "./callables";

export type RuleKind = "availability" | "categories" | "pricing" | "limit";
export type RuleStatus = "Enabled" | "Disabled" | "Removed";
export type Side = "Pickup or drop" | "Pickup only" | "Drop only";
export interface Adjustment { mode: "Normal" | "Increase" | "Decrease"; percent: number }

export interface ServiceRule {
  brand?: string;
  fareService?: string;
  id: string;
  kind: RuleKind;
  name: string;
  status: RuleStatus;
  priority: number;
  scope: { state: string; city: string; area: string; side: Side };
  service: string;
  schedule: { mode: "Always" | "Range"; from?: string; to?: string };
  availability?: "Available" | "Limited" | "Paused";
  categories?: string[];
  customer?: Adjustment;
  partner?: Adjustment;
  limit?: { target: "Customer fare" | "Partner payout"; category: string; min: number; max: number; reference: string };
  reason: string;
  history?: { action: string; reason: string; byName: string; byUid?: string; at: Timestamp; rule?: string; location?: string; before?: string; after?: string }[];
  version?: number;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: Timestamp;
}

const COL = "service_rules";

export function subscribeServiceRules(cb: (rows: ServiceRule[]) => void, onError?: (m: string) => void) {
  return onSnapshot(collection(db, COL), (s) => cb(s.docs.map((d) => ({ ...(d.data() as Omit<ServiceRule, "id">), id: d.id }))), (e) => (onError ? onError(e.message) : cb([])));
}

export const summary = (r: Omit<ServiceRule, "id">) =>
  r.kind === "availability" ? r.availability ?? "Available"
  : r.kind === "categories" ? (r.categories ?? []).join(" · ")
  : r.kind === "pricing" ? `Customer ${adjText(r.customer)} · Partner ${adjText(r.partner)}`
  : r.limit ? `${r.limit.target} ₹${r.limit.min}–₹${r.limit.max}` : "";

export const adjText = (a?: Adjustment) => (!a || a.mode === "Normal" ? "normal" : `${a.mode === "Increase" ? "+" : "−"}${a.percent}%`);

/** The rule fields the server accepts; status, history, version and audit data are set by the server. */
const payloadOf = (r: Omit<ServiceRule, "id" | "history" | "updatedBy" | "updatedByName" | "updatedAt">) => ({
  brand: r.brand ?? "", fareService: r.fareService ?? "", kind: r.kind, name: r.name, priority: r.priority, scope: r.scope, service: r.service, schedule: r.schedule,
  ...(r.availability ? { availability: r.availability } : {}), ...(r.categories ? { categories: r.categories } : {}),
  ...(r.customer ? { customer: r.customer } : {}), ...(r.partner ? { partner: r.partner } : {}), ...(r.limit ? { limit: r.limit } : {}),
});

/** Creates or edits a rule on the server (validated, audited, history kept). Rejects with the server's message. */
export const saveRule = (rule: Omit<ServiceRule, "id" | "history" | "updatedBy" | "updatedByName" | "updatedAt">, id?: string, before?: ServiceRule) =>
  callFunction<unknown, { id: string; version: number }>("saveServiceRule", { ...(id ? { id, expectedVersion: before?.version ?? 0 } : {}), rule: payloadOf(rule), reason: rule.reason });

export const setRuleStatus = (r: ServiceRule, status: RuleStatus, reason: string) =>
  callFunction<unknown, { id: string; status: RuleStatus }>("setServiceRuleStatus", { id: r.id, status, reason, expectedVersion: r.version ?? 0 });

/** Schedules are entered, shown and compared in India time (IST, UTC+05:30), whatever the browser's time zone. */
export const IST_OFFSET_MS = 330 * 60000;
/** "YYYY-MM-DDTHH:mm" India time → ISO instant. */
export const istInputToIso = (local: string) => new Date(Date.parse(`${local}:00Z`) - IST_OFFSET_MS).toISOString();
/** ISO instant → "YYYY-MM-DDTHH:mm" India time, for a datetime-local input. */
export const isoToIstInput = (iso?: string) => (iso && Number.isFinite(Date.parse(iso)) ? new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 16) : "");

/** Active now / scheduled / ended for an enabled rule. The start is included, the end is not. */
export function phaseOf(r: ServiceRule, now = Date.now()): "Active" | "Scheduled" | "Ended" | "Disabled" | "Removed" {
  if (r.status !== "Enabled") return r.status;
  if (r.schedule.mode === "Range") {
    if (r.schedule.from && Date.parse(r.schedule.from) > now) return "Scheduled";
    if (r.schedule.to && Date.parse(r.schedule.to) <= now) return "Ended";
  }
  return "Active";
}

/** A rule applies to the selected location when its scope is the same or wider. */
export function inScope(r: ServiceRule, sel: { state: string; city: string; area: string }) {
  if (sel.area && r.scope.area && r.scope.area !== sel.area) return false;
  if (sel.city && r.scope.city && r.scope.city !== sel.city) return false;
  if (sel.state && r.scope.state && r.scope.state !== sel.state) return false;
  return true;
}

/** Booking-server precedence: most specific place, then a service-specific rule, then higher priority. */
export const rankRules = (list: ServiceRule[]) =>
  [...list].sort((a, b) => {
    const spec = (r: ServiceRule) => (r.scope.area ? 3 : r.scope.city ? 2 : r.scope.state ? 1 : 0);
    const svc = (r: ServiceRule) => (r.service && r.service.toLowerCase() !== "all" ? 1 : 0);
    return Number(!!b.brand) - Number(!!a.brand) || spec(b) - spec(a) || svc(b) - svc(a) || (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id);
  });
