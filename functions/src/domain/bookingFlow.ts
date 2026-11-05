// Booking-level state machine, driver trip sub-states, payment arithmetic,
// refund/penalty vocabularies and the unassigned-pickup alert rule.
// Pure functions only. firestore.rules enforces the same transitions for
// direct partner writes; the callables below use these for everything else.

// ── Booking status ────────────────────────────────────────────────────────

/**
 * Pending   → waiting for admin review
 * Approved  → admin approved; visible to eligible drivers/vendors
 * Confirmed → a vendor accepted (no driver yet)
 * Assigned  → a driver is set (shown with Confirmed in the admin tabs)
 * Ongoing   → the driver has started the trip
 * Completed | Cancelled | Rejected are final.
 */
export const BOOKING_STATUSES = ['Pending', 'Approved', 'Confirmed', 'Assigned', 'Ongoing', 'Completed', 'Cancelled', 'Rejected'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** The five operational tabs of the admin Bookings page. */
export const BOOKING_TABS = ['Pending', 'Approved', 'Confirmed', 'Ongoing', 'Completed'] as const;
export type BookingTab = (typeof BOOKING_TABS)[number];

export const isBookingStatus = (v: unknown): v is BookingStatus => (BOOKING_STATUSES as readonly string[]).includes(String(v));

/** Tab a stored status is listed under; null for Cancelled / Rejected (their own filter). */
export function tabOf(status: unknown): BookingTab | null {
  switch (status) {
    case 'Pending': return 'Pending';
    case 'Approved': return 'Approved';
    case 'Confirmed':
    case 'Assigned': return 'Confirmed';
    case 'Ongoing': return 'Ongoing';
    case 'Completed': return 'Completed';
    default: return null;
  }
}

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  Pending: ['Approved', 'Rejected', 'Cancelled'],
  // Approved may fall back to Approved from Confirmed/Assigned when an assignment is removed.
  Approved: ['Confirmed', 'Assigned', 'Cancelled'],
  Confirmed: ['Assigned', 'Ongoing', 'Approved', 'Cancelled'],
  Assigned: ['Ongoing', 'Confirmed', 'Approved', 'Cancelled'],
  Ongoing: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
  Rejected: [],
};

export function canTransition(from: unknown, to: BookingStatus): boolean {
  if (!isBookingStatus(from)) return false;
  return TRANSITIONS[from].includes(to);
}

/** Why a transition is refused, or '' when it is allowed. */
export function transitionBlocker(from: unknown, to: BookingStatus): string {
  if (!isBookingStatus(from)) return `Unknown booking status "${String(from)}".`;
  if (from === to) return `The booking is already ${from}.`;
  if (canTransition(from, to)) return '';
  if (TRANSITIONS[from].length === 0) return `A ${from.toLowerCase()} booking cannot be changed.`;
  return `A ${from.toLowerCase()} booking cannot become ${to.toLowerCase()}.`;
}

/** Bookings drivers and vendors may see in the marketplace. */
export const isMarketplaceVisible = (status: unknown) => status === 'Approved';

// ── Driver trip sub-status (separate from the booking status) ─────────────

// Driver workflow: Reached Pickup Location → Trip Started → Trip Ended.
//   Reached Pickup  the driver is at the pickup (booking stays Assigned).
//   Trip Started    the customer's boarding OTP and the vehicle photos are
//                   verified; the booking becomes Ongoing.
//   Trip Ended      the booking becomes Completed.
export const TRIP_SUB_STATUSES = ['Not Started', 'Reached Pickup', 'Trip Started', 'Trip Ended'] as const;
export type TripSubStatus = (typeof TRIP_SUB_STATUSES)[number];

export const isTripSubStatus = (v: unknown): v is TripSubStatus => (TRIP_SUB_STATUSES as readonly string[]).includes(String(v));

/**
 * A booking without a sub-status is Not Started; legacy tripStage values map across.
 * Trips recorded under the earlier order (Trip Started = driving to the pickup,
 * mirrored as tripStage 'En Route Pickup') have not reached the pickup yet.
 */
export function tripSubStatusOf(b: { tripSubStatus?: unknown; tripStage?: unknown; status?: unknown }): TripSubStatus {
  if (b.tripSubStatus === 'Trip Started' && b.tripStage === 'En Route Pickup') return 'Not Started';
  if (isTripSubStatus(b.tripSubStatus)) return b.tripSubStatus;
  if (b.status === 'Completed') return 'Trip Ended';
  switch (b.tripStage) {
    case 'Reached Pickup': return 'Reached Pickup';
    case 'In Progress':
    case 'Arrived Destination': return 'Trip Started';
    case 'Completed': return 'Trip Ended';
    default: return 'Not Started';
  }
}

const TRIP_NEXT: Record<TripSubStatus, TripSubStatus | null> = {
  'Not Started': 'Reached Pickup',
  'Reached Pickup': 'Trip Started',
  'Trip Started': 'Trip Ended',
  'Trip Ended': null,
};

/** The step a driver can take next, or null once the trip has ended. */
export const nextTripStep = (current: TripSubStatus): TripSubStatus | null => TRIP_NEXT[current];

/** Only the next stage is legal: Trip End needs Trip Started, which needs Reached Pickup. */
export function tripStageBlocker(current: TripSubStatus, to: TripSubStatus): string {
  if (current === to) return `This trip is already at "${to}".`;
  if (TRIP_NEXT[current] === to) return '';
  if (current === 'Trip Ended') return 'This trip has already ended.';
  const next = TRIP_NEXT[current]!;
  return `"${to}" cannot be recorded yet. The next step is "${next}".`;
}

/** Legacy tripStage vocabulary that older apps and the customer panels still read. */
export const LEGACY_STAGE_FOR: Record<TripSubStatus, string> = {
  'Not Started': 'Assigned',
  'Reached Pickup': 'Reached Pickup',
  'Trip Started': 'In Progress',
  'Trip Ended': 'Completed',
};

// ── Payments ──────────────────────────────────────────────────────────────

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer', 'Gateway'] as const;
export type PaymentMethodName = (typeof PAYMENT_METHODS)[number];
/** Methods staff or partners may record by hand. 'Gateway' receipts are written only by the verified provider flow. */
export const MANUAL_PAYMENT_METHODS = ['Cash', 'UPI', 'Bank Transfer'] as const;
export const isPaymentMethod = (v: unknown): v is PaymentMethodName => (PAYMENT_METHODS as readonly string[]).includes(String(v));

export const COLLECTOR_TYPES = ['admin', 'driver', 'vendor', 'staff', 'system'] as const;
export type CollectorType = (typeof COLLECTOR_TYPES)[number];

export const PAYMENT_KINDS = ['advance', 'partial', 'final'] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export type PaymentLabel = 'Unpaid' | 'Partially Paid' | 'Paid' | 'Refund Pending' | 'Refunded';

export interface PaymentTxn {
  amount: number;
  method: string;
  kind?: string;
  collectorType?: string;
  /** Only 'Success' (or an older record without a status) counts. Voided, Pending and Failed stay in the history. */
  status?: string;
  paymentDate?: number | null;
}

export interface RefundState {
  status?: string;
  amount?: number;
}

export interface PaymentSummary {
  /** Fare after adjustment and discount (GST included) plus recorded tolls once the trip is done. */
  amountDue: number;
  totalPaid: number;
  balanceDue: number;
  /**
   * Everything a driver or vendor received directly, whatever the method (cash, UPI to the partner,
   * transfer). Owed to the platform and deducted from the partner's entitlement at settlement.
   * (The field keeps its original name for existing readers.)
   */
  partnerCashHeld: number;
  /** Received by NESAM itself (office advance, company UPI, gateway). */
  companyCollected: number;
  advancePaid: number;
  paidByMethod: Record<string, number>;
  refunded: number;
  status: PaymentLabel;
  overpaid: number;
  transactions: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const countsAsPaid = (t: PaymentTxn) => (t.status === undefined || t.status === 'Success') && Number.isFinite(t.amount) && t.amount > 0;
/** A receipt belongs to the partner when a driver or vendor collected it, otherwise to the company. */
export const receivedByPartner = (t: Pick<PaymentTxn, 'collectorType'>) => t.collectorType === 'driver' || t.collectorType === 'vendor';

/** The payable amount of a booking. Tolls are added once the trip has ended. */
export function amountDueFor(b: { fare?: unknown; tollCharges?: unknown; status?: unknown; extraCharges?: unknown }): number {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
  return r2(Math.max(0, num(b.fare)) + (b.status === 'Completed' ? Math.max(0, num(b.tollCharges)) + approvedExtraCharges(b.extraCharges) : 0));
}

/** The customer's approved extra charges (waiting / hill / roof carrier, incl. any GST), in rupees; 0 until the office approves them. */
export function approvedExtraCharges(x: unknown): number {
  const e = x as { status?: unknown; customer?: { totalPaise?: unknown } } | null | undefined;
  return e && e.status === 'approved' && typeof e.customer?.totalPaise === 'number' && Number.isFinite(e.customer.totalPaise) && e.customer.totalPaise > 0 ? e.customer.totalPaise / 100 : 0;
}

/**
 * Payment status is always derived from the transactions — never typed in —
 * so the history and the label cannot disagree.
 */
export function summarizePayments(amountDue: number, txns: PaymentTxn[], refund?: RefundState | null): PaymentSummary {
  const live = txns.filter(countsAsPaid);
  const paidByMethod: Record<string, number> = {};
  let totalPaid = 0, partnerCashHeld = 0, companyCollected = 0, advancePaid = 0;
  for (const t of live) {
    totalPaid += t.amount;
    paidByMethod[t.method] = r2((paidByMethod[t.method] ?? 0) + t.amount);
    if (receivedByPartner(t)) partnerCashHeld += t.amount;
    else companyCollected += t.amount;
    if (t.kind === 'advance') advancePaid += t.amount;
  }
  totalPaid = r2(totalPaid);
  const refunded = refund?.status === 'Completed' ? Math.max(0, refund.amount ?? 0) : 0;
  const net = r2(totalPaid - refunded);
  const due = r2(Math.max(0, amountDue));
  const balanceDue = r2(Math.max(0, due - net));
  let status: PaymentLabel;
  if (refund && (refund.status === 'Pending' || refund.status === 'Processing')) status = 'Refund Pending';
  else if (refunded > 0 && net <= 0) status = 'Refunded';
  else if (net <= 0) status = 'Unpaid';
  else if (balanceDue > 0) status = 'Partially Paid';
  else status = 'Paid';
  return {
    amountDue: due, totalPaid, balanceDue, partnerCashHeld: r2(partnerCashHeld), companyCollected: r2(companyCollected), advancePaid: r2(advancePaid), paidByMethod,
    refunded: r2(refunded), status, overpaid: r2(Math.max(0, net - due)), transactions: live.length,
  };
}

/** Value written to the legacy bookings.payment field the finance ledger reads. */
export function legacyPaymentField(s: PaymentSummary): 'Paid' | 'Pending' | 'Refunded' {
  if (s.status === 'Paid') return 'Paid';
  if (s.status === 'Refunded') return 'Refunded';
  return 'Pending';
}

// ── Cancellation & refunds ────────────────────────────────────────────────

export const REFUND_STATUSES = ['Not Applicable', 'Pending', 'Processing', 'Completed', 'Failed', 'Rejected'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

const REFUND_NEXT: Record<RefundStatus, readonly RefundStatus[]> = {
  'Not Applicable': [],
  Pending: ['Processing', 'Completed', 'Rejected', 'Failed'],
  Processing: ['Completed', 'Failed', 'Rejected'],
  Failed: ['Processing', 'Completed', 'Rejected'],
  Completed: [],
  Rejected: [],
};

export function refundBlocker(from: unknown, to: RefundStatus): string {
  const f = (REFUND_STATUSES as readonly string[]).includes(String(from)) ? (from as RefundStatus) : 'Pending';
  if (f === to) return `The refund is already ${f.toLowerCase()}.`;
  return REFUND_NEXT[f].includes(to) ? '' : `A ${f.toLowerCase()} refund cannot become ${to.toLowerCase()}.`;
}

/** Most that may be refunded: what the customer paid minus the cancellation charge. */
export function maxRefund(totalPaid: number, cancellationCharge: number): number {
  return r2(Math.max(0, totalPaid - Math.max(0, cancellationCharge)));
}

// ── Penalties ─────────────────────────────────────────────────────────────

export const PENALTY_STATUSES = ['Pending', 'Acknowledged', 'Paid', 'Deducted', 'Waived', 'Disputed'] as const;
export type PenaltyStatusName = (typeof PENALTY_STATUSES)[number];

/** Spellings the earlier Penalties screen wrote. They keep loading and read as the new status. */
export const LEGACY_PENALTY_STATUS: Record<string, PenaltyStatusName> = {
  Applied: 'Pending',
  Recovered: 'Paid',
  Reversed: 'Waived',
};

export function penaltyStatusOf(v: unknown): PenaltyStatusName {
  const s = String(v ?? '');
  if ((PENALTY_STATUSES as readonly string[]).includes(s)) return s as PenaltyStatusName;
  return LEGACY_PENALTY_STATUS[s] ?? 'Pending';
}

const PENALTY_NEXT: Record<PenaltyStatusName, readonly PenaltyStatusName[]> = {
  Pending: ['Acknowledged', 'Disputed', 'Waived', 'Paid', 'Deducted'],
  Acknowledged: ['Paid', 'Deducted', 'Waived', 'Disputed'],
  Disputed: ['Pending', 'Acknowledged', 'Waived', 'Paid', 'Deducted'],
  Paid: [],
  Deducted: [],
  Waived: [],
};

export function penaltyBlocker(from: unknown, to: PenaltyStatusName): string {
  const f = penaltyStatusOf(from);
  if (f === to) return `This penalty is already ${f.toLowerCase()}.`;
  return PENALTY_NEXT[f].includes(to) ? '' : `A ${f.toLowerCase()} penalty cannot become ${to.toLowerCase()}.`;
}

// ── Unassigned pickup alert ───────────────────────────────────────────────

export type AlertSeverity = 'none' | 'normal' | 'warning' | 'critical';

export interface UnassignedThresholds {
  /** Hours before pickup at which a warning starts. */
  warningHours: number;
  /** Hours before pickup at which the alert turns critical. */
  criticalHours: number;
}

export const DEFAULT_UNASSIGNED_THRESHOLDS: UnassignedThresholds = { warningHours: 3, criticalHours: 1 };

/**
 * Severity of an approved/confirmed booking that still has no driver.
 * More than the warning window away → normal; inside it → warning; inside the
 * critical window (or already past pickup) → critical.
 */
export function unassignedSeverity(
  b: { status?: unknown; assignedDriverId?: unknown; assignedVendorId?: unknown },
  pickupAtMs: number | null,
  nowMs: number,
  t: UnassignedThresholds = DEFAULT_UNASSIGNED_THRESHOLDS,
): AlertSeverity {
  if (!['Approved', 'Confirmed'].includes(String(b.status))) return 'none';
  if (b.assignedDriverId) return 'none';
  if (pickupAtMs === null) return 'none';
  const hours = (pickupAtMs - nowMs) / 3600000;
  if (hours <= t.criticalHours) return 'critical';
  if (hours <= t.warningHours) return 'warning';
  return 'normal';
}

export function normalizeThresholds(v: unknown): UnassignedThresholds {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 72 ? x : d);
  const warningHours = num(o.warningHours, DEFAULT_UNASSIGNED_THRESHOLDS.warningHours);
  const criticalHours = Math.min(num(o.criticalHours, DEFAULT_UNASSIGNED_THRESHOLDS.criticalHours), warningHours);
  return { warningHours, criticalHours };
}
