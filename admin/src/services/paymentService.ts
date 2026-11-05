import { paymentOf } from "../domain/bookingFlow";
import { parseAmount } from "../utils/analytics";
import type { Booking, PaymentTransaction } from "../types";

// Recording a payment is a server function (recordPayment in services/bookingOpsService.ts):
// every receipt is its own record with who collected it, and totals are derived from them.

/** Normalised payment row (new reconciliation records and older documents). */
export interface PaymentRow {
  id: string;
  bookingCode: string;
  bookingDocumentId: string;
  customer: string;
  customerId: string;
  amount: number;
  method: string;
  gateway: string;
  reference: string;
  status: string;
  date: Date | null;
  verifiedBy: string;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === "function") return t.toDate();
  if (typeof t.seconds === "number") return new Date(t.seconds * 1000);
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function mapPayment(p: PaymentTransaction & Record<string, unknown>): PaymentRow {
  return {
    id: p.id,
    bookingCode: text(p.bookingId),
    bookingDocumentId: text(p.bookingDocumentId),
    customer: text(p.customer),
    customerId: text(p.customerId),
    amount: parseAmount(p.amount as string | number),
    method: text(p.method) || "—",
    gateway: text(p.gateway),
    reference: text(p.reference),
    status: text(p.status) || "—",
    date: toDate(p.createdAt) ?? toDate(p.date),
    verifiedBy: text(p.verifiedBy),
  };
}

export const isSuccessfulPayment = (status: string) =>
  ["success", "paid", "completed", "captured"].includes(status.toLowerCase());

/** What the customer still owes: derived from the recorded payment transactions (or the legacy paid flag). */
export const expectedAmount = (b: Booking) => paymentOf(b).balanceDue;

/** Completed trips that still have a balance due. */
export function bookingsAwaitingPayment(bookings: Booking[]): Booking[] {
  return bookings
    .filter((b) => b.status === "Completed" && paymentOf(b).balanceDue > 0)
    .sort((a, b) => (toDate(b.completedAt ?? b.createdAt)?.getTime() ?? 0) - (toDate(a.completedAt ?? a.createdAt)?.getTime() ?? 0));
}
