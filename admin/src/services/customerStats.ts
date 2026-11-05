import type { Booking, Customer } from "../types";
import { parseAmount } from "../utils/analytics";
import { toDate } from "./paymentService";

/**
 * Customer activity derived from bookings — never from counters stored on the
 * customer document (older records carry stale "bookings" / "spent" values).
 * A booking belongs to a customer by customerId; admin phone bookings made
 * without an account are matched by the customer's mobile number.
 */
export interface CustomerStats {
  total: number;
  completed: number;
  cancelled: number;
  /** Fares plus tolls on bookings whose payment is recorded as received. */
  paid: number;
  /** Fares on completed trips whose payment is not recorded yet. */
  outstanding: number;
  lastBookingAt: Date | null;
}

export const EMPTY_STATS: CustomerStats = { total: 0, completed: 0, cancelled: 0, paid: 0, outstanding: 0, lastBookingAt: null };

/** Last 10 digits of an Indian mobile number ("+91 98765 43210" → "9876543210"). */
export function phoneKey(v: unknown): string {
  const digits = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return digits.length >= 10 ? digits.slice(-10) : "";
}

const isPaid = (b: Booking) => b.payment === "Paid" || b.paymentStatus === "Paid";

export function buildCustomerStats(customers: Pick<Customer, "id" | "phone">[], bookings: Booking[]): Map<string, CustomerStats> {
  const out = new Map<string, CustomerStats>();
  const byPhone = new Map<string, string>();
  for (const c of customers) {
    out.set(c.id, { ...EMPTY_STATS });
    const key = phoneKey(c.phone);
    // Two customers with the same number: unlinked bookings cannot be attributed.
    if (key) byPhone.set(key, byPhone.has(key) ? "" : c.id);
  }
  for (const b of bookings) {
    const owner = b.customerId ? b.customerId : byPhone.get(phoneKey(b.phone || b.customerPhone)) || "";
    const s = owner ? out.get(owner) : undefined;
    if (!s) continue;
    s.total += 1;
    if (b.status === "Completed") s.completed += 1;
    if (b.status === "Cancelled") s.cancelled += 1;
    if (isPaid(b)) s.paid += parseAmount(b.fare) + (Number(b.tollCharges) || 0);
    else if (b.status === "Completed") s.outstanding += parseAmount(b.fare);
    const at = toDate(b.createdAt);
    if (at && (!s.lastBookingAt || at > s.lastBookingAt)) s.lastBookingAt = at;
  }
  return out;
}
