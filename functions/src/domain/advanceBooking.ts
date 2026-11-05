// Advance-booking rules. NESAM takes advance reservations only: there is no
// "ride now" and no instant customer-to-driver dispatch. Everything here is a
// pure function so the same rules can be tested without a database.
//
// Booking journey:
//   customer submits a future pickup → Pending (admin review queue)
//   admin approves                   → Approved, awaiting fulfilment (NOT visible to partners)
//   admin then deliberately chooses ONE route:
//       publish to the marketplace · assign a Vendor · assign an Owner Driver

/** Pickup window. The defaults are the limits the customer booking already enforced. */
export interface BookingWindow {
  /** Earliest pickup, in minutes from the moment of submission. */
  minLeadMinutes: number;
  /** Latest pickup, in days from the moment of submission. */
  maxAdvanceDays: number;
}

/**
 * Retained from the previous customer rules (30 minutes' notice, up to 30 days
 * ahead). They are not new business decisions: staff may change them in
 * settings/operations (bookingMinLeadMinutes / bookingMaxAdvanceDays).
 */
export const DEFAULT_BOOKING_WINDOW: BookingWindow = { minLeadMinutes: 30, maxAdvanceDays: 30 };

/** Phone / walk-in bookings keep their longer horizon. */
export const DEFAULT_ADMIN_MAX_ADVANCE_DAYS = 180;

const MAX_LEAD_MINUTES = 7 * 24 * 60;
const MAX_ADVANCE_DAYS = 365;

/** Reads the optional staff settings, falling back to the retained defaults for anything missing or out of range. */
export function bookingWindowFrom(settings: unknown, defaults: BookingWindow = DEFAULT_BOOKING_WINDOW): BookingWindow {
  const s = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>;
  const pick = (v: unknown, min: number, max: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback;
  return {
    minLeadMinutes: pick(s.bookingMinLeadMinutes, 0, MAX_LEAD_MINUTES, defaults.minLeadMinutes),
    maxAdvanceDays: pick(s.bookingMaxAdvanceDays, 1, MAX_ADVANCE_DAYS, defaults.maxAdvanceDays),
  };
}

/**
 * Parses a pickup instant from a client. Only unambiguous values are accepted:
 * an ISO-8601 string that carries "Z" or a UTC offset, or epoch milliseconds.
 * A bare "2026-10-20T10:00" is rejected because its time zone is a guess.
 */
export function parsePickupInstant(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Why a pickup cannot be booked, or '' when it can. `null` means the customer sent no schedule. */
export function pickupWindowProblem(at: Date | null, now: Date, w: BookingWindow = DEFAULT_BOOKING_WINDOW): string {
  if (!at) return 'Choose the pickup date and time. NESAM takes advance bookings only.';
  const leadMin = (at.getTime() - now.getTime()) / 60000;
  if (leadMin < w.minLeadMinutes) {
    return w.minLeadMinutes > 0
      ? `Pickup must be at least ${w.minLeadMinutes} minutes from now. NESAM takes advance bookings only.`
      : 'Pickup must be in the future. NESAM takes advance bookings only.';
  }
  if (leadMin > w.maxAdvanceDays * 1440) return `Pickups can be booked up to ${w.maxAdvanceDays} days ahead.`;
  return '';
}

// ── Where a booking is in fulfilment ──────────────────────────────────────

export type MarketplaceState = 'none' | 'unpublished' | 'open' | 'bidding' | 'assigned' | 'closed';

/** Marketplace record status → what it means for partners. Anything other than Open / Bidding is invisible to them. */
export function marketplaceStateOf(status: unknown): MarketplaceState {
  switch (status) {
    case 'Open': return 'open';
    case 'Bidding': return 'bidding';
    case 'Assigned': return 'assigned';
    case 'Closed': return 'closed';
    case undefined:
    case null:
    case '': return 'none';
    // 'Awaiting Approval' (older bookings) and 'Unpublished' are internal drafts.
    default: return 'unpublished';
  }
}

export type Fulfilment =
  | 'awaiting_review'
  | 'awaiting_fulfilment'
  | 'published'
  | 'vendor_assigned'
  | 'driver_assigned'
  | 'in_progress'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface FulfilmentInput {
  status?: unknown;
  assignedVendorId?: unknown;
  assignedDriverId?: unknown;
}

/**
 * The fulfilment state staff and customers see, derived from fields that
 * already exist. "Published" needs the marketplace record's status because an
 * approved booking is invisible to partners until an admin publishes it.
 */
export function fulfilmentOf(b: FulfilmentInput, market: MarketplaceState = 'none'): Fulfilment {
  switch (b.status) {
    case 'Pending': return 'awaiting_review';
    case 'Rejected': return 'rejected';
    case 'Cancelled': return 'cancelled';
    case 'Completed': return 'completed';
    case 'Ongoing': return 'in_progress';
    default: break;
  }
  if (b.assignedDriverId) return 'driver_assigned';
  if (b.assignedVendorId) return 'vendor_assigned';
  return market === 'open' || market === 'bidding' ? 'published' : 'awaiting_fulfilment';
}

/** Customer-facing wording for each state (never claims a driver before there is one). */
export const CUSTOMER_FULFILMENT_LABEL: Record<Fulfilment, string> = {
  awaiting_review: 'Awaiting review',
  awaiting_fulfilment: 'Approved — arranging your vehicle',
  published: 'Approved — arranging your vehicle',
  vendor_assigned: 'Vendor assigned — driver details pending',
  driver_assigned: 'Driver and vehicle assigned',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
};

/** The three routes an admin may choose after approval. */
export const FULFILMENT_ROUTES = ['marketplace', 'vendor', 'driver'] as const;
export type FulfilmentRoute = (typeof FULFILMENT_ROUTES)[number];

/** A booking can be published, or assigned, only while approved and not already held by a partner. */
export function awaitingFulfilment(b: { status?: unknown; assignedVendorId?: unknown; assignedDriverId?: unknown }): boolean {
  return b.status === 'Approved' && !b.assignedVendorId && !b.assignedDriverId;
}
