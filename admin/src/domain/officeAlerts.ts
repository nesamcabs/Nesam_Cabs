/**
 * Booking alerts the office works from (Master Admin "Booking alerts & assignment"): every upcoming
 * booking that still has no driver and car, the urgent subset (pickup within 2 hours or the
 * assignment deadline missed) and assigned duties whose driver has not acknowledged them yet.
 */
import type { Booking, MarketplaceTrip } from "../types";
import { bookingPickupDate } from "../utils/time";
import { assignmentDeadline, officeStageOf } from "./officeStage";
import type { Followup } from "../services/officeOpsService";

export interface AlertRow {
  b: Booking;
  pickup: Date;
  deadline: Date | null;
  /** New booking (not approved yet) or Assignment pending. */
  status: "New booking" | "Assignment pending";
  accepted: boolean;
  urgent: boolean;
  missed: boolean;
}

const URGENT_MS = 2 * 3600000;

export function bookingAlerts(bookings: Booking[], market: Map<string, MarketplaceTrip>, now: Date, deadlineHours: number): AlertRow[] {
  const rows: AlertRow[] = [];
  for (const b of bookings) {
    const stage = officeStageOf(b, market.get(b.id));
    if (!stage || b.assignedDriverId) continue;
    const pickup = bookingPickupDate(b);
    if (!pickup || pickup.getTime() < now.getTime() - 3600000) continue;
    const deadline = assignmentDeadline(b, deadlineHours);
    const missed = !!deadline && deadline.getTime() < now.getTime();
    rows.push({
      b, pickup, deadline,
      status: stage === "New bookings" ? "New booking" : "Assignment pending",
      accepted: !!b.assignedVendorId,
      urgent: missed || pickup.getTime() - now.getTime() <= URGENT_MS,
      missed,
    });
  }
  // Assignment work first (nearest pickup), new bookings after them.
  return rows.sort((a, z) => Number(a.status === "New booking") - Number(z.status === "New booking") || a.pickup.getTime() - z.pickup.getTime());
}

export interface AckRow {
  b: Booking;
  pickup: Date;
  last: Followup | undefined;
  /** Needs a call: no follow-up yet, or the last one asked for a call back / reassignment. */
  needsFollowUp: boolean;
}

/** Assigned, not started duties whose driver confirmation has not been recorded. */
export function ackReminders(bookings: Booking[], latest: Map<string, Followup>, now: Date): AckRow[] {
  return bookings
    .filter((b) => b.assignedDriverId && ["Assigned", "Confirmed"].includes(b.status) && (b.tripSubStatus ?? "Not Started") === "Not Started")
    .filter((b) => !(b as { driverAcknowledgedAt?: unknown }).driverAcknowledgedAt)
    .map((b) => ({ b, pickup: bookingPickupDate(b) ?? now, last: latest.get(b.id) }))
    .filter((r) => r.pickup.getTime() > now.getTime() - 3600000 && r.last?.outcome !== "Driver confirmed")
    .map((r) => ({ ...r, needsFollowUp: !r.last || r.last.outcome !== "Driver confirmed" && (r.pickup.getTime() - now.getTime() < 12 * 3600000 || r.last.outcome === "Reassignment needed") }))
    .sort((a, z) => a.pickup.getTime() - z.pickup.getTime());
}
