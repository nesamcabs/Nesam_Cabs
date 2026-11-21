import type { Booking, Customer } from "../types";
import { parseAmount } from "../utils/analytics";
import { paymentOf } from "../domain/bookingFlow";
import { bookingPickupDate } from "../utils/time";
import { toDate } from "./paymentService";

/**
 * Customer activity derived from bookings — never from counters stored on the
 * customer document (older records carry stale "bookings" / "spent" values).
 * A booking belongs to a customer by customerId. An unlinked booking (admin phone
 * booking made without an account) belongs to the customer the server attributed it to
 * (`linkedBookingIds`, by an unambiguous mobile number), or — where raw numbers are
 * loaded — by the customer's mobile number here.
 */
export interface CustomerStats {
  total: number;
  completed: number;
  cancelled: number;
  /** Fares plus tolls on bookings whose payment is recorded as received. */
  paid: number;
  /** Balance still due on completed trips (derived from the recorded payments). */
  outstanding: number;
  /** Amount due on completed trips: what the customer has spent (or owes) with the company. */
  spend: number;
  lastBookingAt: Date | null;
  /** Pickup time of the latest completed trip. */
  lastCompletedAt: Date | null;
}

export const EMPTY_STATS: CustomerStats = { total: 0, completed: 0, cancelled: 0, paid: 0, outstanding: 0, spend: 0, lastBookingAt: null, lastCompletedAt: null };

/** Last 10 digits of an Indian mobile number ("+91 98765 43210" → "9876543210"). */
export function phoneKey(v: unknown): string {
  const digits = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return digits.length >= 10 ? digits.slice(-10) : "";
}

const isPaid = (b: Booking) => b.payment === "Paid" || b.paymentStatus === "Paid";

export interface CustomerLedger {
  stats: Map<string, CustomerStats>;
  /** Each customer's bookings under the same ownership rule, newest pickup first. */
  owned: Map<string, Booking[]>;
}

export function buildCustomerLedger(customers: Pick<Customer, "id" | "phone" | "linkedBookingIds">[], bookings: Booking[]): CustomerLedger {
  const stats = new Map<string, CustomerStats>();
  const owned = new Map<string, Booking[]>();
  const byPhone = new Map<string, string>();
  const linked = new Map<string, string>();
  for (const c of customers) {
    stats.set(c.id, { ...EMPTY_STATS });
    owned.set(c.id, []);
    for (const id of c.linkedBookingIds ?? []) linked.set(id, c.id);
    const key = phoneKey(c.phone);
    // Two customers with the same number: unlinked bookings cannot be attributed.
    if (key) byPhone.set(key, byPhone.has(key) ? "" : c.id);
  }
  for (const b of bookings) {
    const owner = b.customerId ? b.customerId : linked.get(b.id) || byPhone.get(phoneKey(b.phone || b.customerPhone)) || "";
    const s = owner ? stats.get(owner) : undefined;
    if (!s) continue;
    owned.get(owner)!.push(b);
    s.total += 1;
    if (b.status === "Cancelled") s.cancelled += 1;
    if (b.status === "Completed") {
      s.completed += 1;
      const p = paymentOf(b);
      s.spend += p.amountDue;
      s.outstanding += p.balanceDue;
      const at = bookingPickupDate(b);
      if (at && (!s.lastCompletedAt || at > s.lastCompletedAt)) s.lastCompletedAt = at;
    }
    if (isPaid(b)) s.paid += parseAmount(b.fare) + (Number(b.tollCharges) || 0);
    const at = toDate(b.createdAt);
    if (at && (!s.lastBookingAt || at > s.lastBookingAt)) s.lastBookingAt = at;
  }
  for (const list of owned.values()) list.sort((a, z) => (bookingPickupDate(z)?.getTime() ?? 0) - (bookingPickupDate(a)?.getTime() ?? 0));
  return { stats, owned };
}

export function buildCustomerStats(customers: Pick<Customer, "id" | "phone" | "linkedBookingIds">[], bookings: Booking[]): Map<string, CustomerStats> {
  return buildCustomerLedger(customers, bookings).stats;
}
