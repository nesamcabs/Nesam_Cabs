/**
 * Client copy of the booking vocabulary the admin screens need (tabs, payment
 * summary, alert severity, penalty statuses). The booking SERVER
 * (functions/src/domain/bookingFlow.ts) is authoritative and re-validates every
 * action; tests/domain/parity.test.mjs fails if the two copies drift apart.
 * Only erasable TypeScript here so the parity test can load it directly.
 */

export const BOOKING_TABS = ["Pending", "Approved", "Confirmed", "Ongoing", "Completed"] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

/** Tab a stored status is listed under; null for Cancelled / Rejected. */
export function tabOf(status: unknown): BookingTab | null {
  switch (status) {
    case "Pending": return "Pending";
    case "Approved": return "Approved";
    case "Confirmed":
    case "Assigned": return "Confirmed";
    case "Ongoing": return "Ongoing";
    case "Completed": return "Completed";
    default: return null;
  }
}

/** Driver steps, in order: Reached Pickup → Trip Started → Trip Ended (server: functions/src/domain/bookingFlow.ts). */
export type TripSubStatus = "Not Started" | "Reached Pickup" | "Trip Started" | "Trip Ended";

export function tripSubStatusOf(b: { tripSubStatus?: unknown; tripStage?: unknown; status?: unknown }): TripSubStatus {
  const v = String(b.tripSubStatus ?? "");
  // Earlier order: "Trip Started" meant driving to the pickup (stage En Route Pickup).
  if (v === "Trip Started" && b.tripStage === "En Route Pickup") return "Not Started";
  if (v === "Not Started" || v === "Trip Started" || v === "Reached Pickup" || v === "Trip Ended") return v;
  if (b.status === "Completed") return "Trip Ended";
  switch (b.tripStage) {
    case "Reached Pickup": return "Reached Pickup";
    case "In Progress":
    case "Arrived Destination": return "Trip Started";
    case "Completed": return "Trip Ended";
    default: return "Not Started";
  }
}

// ── Payments ──────────────────────────────────────────────────────────────

export type PaymentLabel = "Unpaid" | "Partially Paid" | "Paid" | "Refund Pending" | "Refunded";

export interface PaymentTxn {
  amount: number;
  method: string;
  kind?: string;
  collectorType?: string;
  status?: string;
}

export interface PaymentSummary {
  amountDue: number;
  totalPaid: number;
  balanceDue: number;
  partnerCashHeld: number;
  advancePaid: number;
  paidByMethod: Record<string, number>;
  refunded: number;
  status: PaymentLabel;
  overpaid: number;
  transactions: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0);

export function amountDueFor(b: { fare?: unknown; tollCharges?: unknown; status?: unknown; extraCharges?: unknown }): number {
  return r2(Math.max(0, num(b.fare)) + (b.status === "Completed" ? Math.max(0, num(b.tollCharges)) + approvedExtraCharges(b.extraCharges) : 0));
}

/** The customer's approved extra charges (waiting / hill / roof carrier, incl. any GST), in rupees; 0 until the office approves them. */
export function approvedExtraCharges(x: unknown): number {
  const e = x as { status?: unknown; customer?: { totalPaise?: unknown } } | null | undefined;
  return e && e.status === "approved" && typeof e.customer?.totalPaise === "number" && Number.isFinite(e.customer.totalPaise) && e.customer.totalPaise > 0 ? e.customer.totalPaise / 100 : 0;
}

export function summarizePayments(amountDue: number, txns: PaymentTxn[], refund?: { status?: string; amount?: number } | null): PaymentSummary {
  const live = txns.filter((t) => t.status !== "Voided" && Number.isFinite(t.amount) && t.amount > 0);
  const paidByMethod: Record<string, number> = {};
  let totalPaid = 0, partnerCashHeld = 0, advancePaid = 0;
  for (const t of live) {
    totalPaid += t.amount;
    paidByMethod[t.method] = r2((paidByMethod[t.method] ?? 0) + t.amount);
    if (t.method === "Cash" && (t.collectorType === "driver" || t.collectorType === "vendor")) partnerCashHeld += t.amount;
    if (t.kind === "advance") advancePaid += t.amount;
  }
  totalPaid = r2(totalPaid);
  const refunded = refund?.status === "Completed" ? Math.max(0, refund.amount ?? 0) : 0;
  const net = r2(totalPaid - refunded);
  const due = r2(Math.max(0, amountDue));
  const balanceDue = r2(Math.max(0, due - net));
  let status: PaymentLabel;
  if (refund && (refund.status === "Pending" || refund.status === "Processing")) status = "Refund Pending";
  else if (refunded > 0 && net <= 0) status = "Refunded";
  else if (net <= 0) status = "Unpaid";
  else if (balanceDue > 0) status = "Partially Paid";
  else status = "Paid";
  return { amountDue: due, totalPaid, balanceDue, partnerCashHeld: r2(partnerCashHeld), advancePaid: r2(advancePaid), paidByMethod, refunded: r2(refunded), status, overpaid: r2(Math.max(0, net - due)), transactions: live.length };
}

/**
 * The payment picture of a booking: the server-derived summary when it has one,
 * otherwise (older bookings) derived from the legacy payment flag so they keep loading.
 */
export function paymentOf(b: { fare?: unknown; tollCharges?: unknown; status?: unknown; payment?: unknown; paymentStatus?: unknown; paymentSummary?: (Partial<Omit<PaymentSummary, "status">> & { status?: string }) | null }): PaymentSummary {
  const s = b.paymentSummary;
  if (s && typeof s.totalPaid === "number" && typeof s.status === "string") {
    return {
      amountDue: s.amountDue ?? amountDueFor(b), totalPaid: s.totalPaid, balanceDue: s.balanceDue ?? 0, partnerCashHeld: s.partnerCashHeld ?? 0,
      advancePaid: s.advancePaid ?? 0, paidByMethod: s.paidByMethod ?? {}, refunded: s.refunded ?? 0, status: s.status as PaymentLabel,
      overpaid: s.overpaid ?? 0, transactions: s.transactions ?? 0,
    };
  }
  const due = amountDueFor(b);
  const paid = b.payment === "Paid" || b.paymentStatus === "Paid";
  const refunded = b.payment === "Refunded" || b.paymentStatus === "Refunded";
  return {
    amountDue: due, totalPaid: paid ? due : 0, balanceDue: paid ? 0 : due, partnerCashHeld: 0, advancePaid: 0, paidByMethod: {}, refunded: 0,
    status: refunded ? "Refunded" : paid ? "Paid" : "Unpaid", overpaid: 0, transactions: 0,
  };
}

// ── Unassigned pickup alert ───────────────────────────────────────────────

export type AlertSeverity = "none" | "normal" | "warning" | "critical";
export interface UnassignedThresholds { warningHours: number; criticalHours: number }
export const DEFAULT_UNASSIGNED_THRESHOLDS: UnassignedThresholds = { warningHours: 3, criticalHours: 1 };

export function unassignedSeverity(
  b: { status?: unknown; assignedDriverId?: unknown },
  pickupAtMs: number | null,
  nowMs: number,
  t: UnassignedThresholds = DEFAULT_UNASSIGNED_THRESHOLDS,
): AlertSeverity {
  if (!["Approved", "Confirmed"].includes(String(b.status))) return "none";
  if (b.assignedDriverId) return "none";
  if (pickupAtMs === null) return "none";
  const hours = (pickupAtMs - nowMs) / 3600000;
  if (hours <= t.criticalHours) return "critical";
  if (hours <= t.warningHours) return "warning";
  return "normal";
}

export function normalizeThresholds(v: unknown): UnassignedThresholds {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 72 ? x : d);
  const warningHours = pick(o.warningHours, DEFAULT_UNASSIGNED_THRESHOLDS.warningHours);
  const criticalHours = Math.min(pick(o.criticalHours, DEFAULT_UNASSIGNED_THRESHOLDS.criticalHours), warningHours);
  return { warningHours, criticalHours };
}

// ── Penalties ─────────────────────────────────────────────────────────────

export const PENALTY_STATUSES = ["Pending", "Acknowledged", "Paid", "Deducted", "Waived", "Disputed"] as const;
export type PenaltyStatusName = (typeof PENALTY_STATUSES)[number];
const LEGACY_PENALTY: Record<string, PenaltyStatusName> = { Applied: "Pending", Recovered: "Paid", Reversed: "Waived" };

export function penaltyStatusOf(v: unknown): PenaltyStatusName {
  const s = String(v ?? "");
  if ((PENALTY_STATUSES as readonly string[]).includes(s)) return s as PenaltyStatusName;
  return LEGACY_PENALTY[s] ?? "Pending";
}

/** Statuses a staff member can move a penalty to from `from`. */
export function penaltyNext(from: unknown): PenaltyStatusName[] {
  const f = penaltyStatusOf(from);
  switch (f) {
    case "Pending": return ["Paid", "Deducted", "Waived"];
    case "Acknowledged": return ["Paid", "Deducted", "Waived"];
    case "Disputed": return ["Pending", "Paid", "Deducted", "Waived"];
    default: return [];
  }
}

// ── Refunds ───────────────────────────────────────────────────────────────

/** Statuses a refund can move to from `from` (Pending is the starting state). */
export function refundNext(from: unknown): string[] {
  switch (String(from)) {
    case "Pending": return ["Processing", "Completed", "Rejected", "Failed"];
    case "Processing": return ["Completed", "Failed", "Rejected"];
    case "Failed": return ["Processing", "Completed", "Rejected"];
    default: return [];
  }
}

// ── Advance-booking fulfilment (mirrors functions/src/domain/advanceBooking.ts) ──

export type Fulfilment =
  | "awaiting_review"
  | "awaiting_fulfilment"
  | "published"
  | "vendor_assigned"
  | "driver_assigned"
  | "in_progress"
  | "completed"
  | "rejected"
  | "cancelled";

/**
 * Where an approved booking is in fulfilment. An approved booking is invisible to
 * partners until an admin publishes it; `fulfilmentRoute === "marketplace"` is the
 * server's record of that. Bookings opened under the older flow carry no route, so
 * pass the marketplace record's status when it is known.
 */
export function fulfilmentOf(
  b: { status?: unknown; assignedVendorId?: unknown; assignedDriverId?: unknown; fulfilmentRoute?: unknown },
  marketStatus?: string,
): Fulfilment {
  switch (b.status) {
    case "Pending": return "awaiting_review";
    case "Rejected": return "rejected";
    case "Cancelled": return "cancelled";
    case "Completed": return "completed";
    case "Ongoing": return "in_progress";
    default: break;
  }
  if (b.assignedDriverId) return "driver_assigned";
  if (b.assignedVendorId) return "vendor_assigned";
  const open = marketStatus ? ["Open", "Bidding"].includes(marketStatus) : b.fulfilmentRoute === "marketplace";
  return open ? "published" : "awaiting_fulfilment";
}

export const FULFILMENT_LABEL: Record<Fulfilment, string> = {
  awaiting_review: "Pending review",
  awaiting_fulfilment: "Approved · awaiting fulfilment",
  published: "Published to marketplace",
  vendor_assigned: "Vendor assigned · driver pending",
  driver_assigned: "Driver & vehicle assigned",
  in_progress: "Trip in progress",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};
