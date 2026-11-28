/**
 * How a cancelled booking reads in the office: cancelled by itself (and why) or by hand (and, for an accepted trip, whose
 * side it was). Mirrors functions/src/domain/autoCancel.ts; nothing here writes data.
 */
import type { Booking } from "../types";
import { bookingPickupDate } from "../utils/time";
import { tripSubStatusOf } from "./bookingFlow";

export type CancelFault = "customer" | "driver" | "other";

const AUTO_LABEL: Record<string, string> = {
  not_approved: "Auto · Not approved in time",
  not_published: "Auto · Approved, not published",
  not_accepted: "Auto · Approved, nobody accepted",
  bid_not_awarded: "Auto · Bids not awarded",
};

export const FAULT_LABEL: Record<CancelFault, string> = {
  customer: "Customer did not come",
  driver: "Driver / partner mistake",
  other: "Other reason",
};

/** The reason text offered for each choice; the office may edit it. The customer and the driver see it. */
export const FAULT_REASON: Record<CancelFault, string> = {
  customer: "Customer did not come to the pickup (checked by NESAM office).",
  driver: "Driver / partner did not complete the pickup (checked by NESAM office).",
  other: "",
};

/** Short tag for a cancelled or rejected booking. */
export function cancelTag(b: Booking): string {
  const c = b.cancellation;
  if (b.status === "Rejected" || c?.rejected) return "Rejected by office";
  if (c?.auto) return AUTO_LABEL[c.auto] ?? "Auto-cancelled";
  if (c?.fault) return FAULT_LABEL[c.fault as CancelFault] ?? "Cancelled";
  const by = c?.cancelledBy?.type || (b as { cancelledBy?: string }).cancelledBy;
  return by === "customer" ? "Cancelled by customer" : by === "admin" ? "Cancelled by office" : "Cancelled";
}

/** The office reason (cancelReason is the wording the customer sees, so it comes after). */
export const officeCancelReason = (b: Booking): string => b.cancellation?.reason || b.rejectionReason || b.cancelReason || "";

/** An accepted booking whose pickup time has passed: cancelling it needs the office's finding. */
export function needsFault(b: Booking, now = Date.now()): boolean {
  const at = bookingPickupDate(b)?.getTime();
  return (b.status === "Confirmed" || b.status === "Assigned") && at !== undefined && at <= now;
}

export const reachedPickup = (b: Booking): boolean => tripSubStatusOf(b) === "Reached Pickup";
