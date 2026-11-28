// When a booking is cancelled by itself, and why. A booking nobody has accepted is cancelled once its pickup time is
// AUTO_CANCEL_AFTER_MINUTES old. A booking a driver or vendor HAS accepted is never cancelled this way: the office checks with
// the customer and the driver first and cancels it by hand, recording whose side it was. Pure functions only.
import { tripSubStatusOf } from './bookingFlow';
import { pickupInstant } from './time';

export const AUTO_CANCEL_AFTER_MINUTES = 30;
/**
 * Only pickups that went past within this long are cancelled automatically, so switching the job on (or restarting it after
 * a long stop) never cancels, and messages customers about, old bookings. Older ones stay for the office to close.
 */
export const AUTO_CANCEL_LOOKBACK_HOURS = 48;

export const AUTO_CANCEL_KINDS = ['not_approved', 'not_published', 'not_accepted', 'bid_not_awarded'] as const;
export type AutoCancelKind = (typeof AUTO_CANCEL_KINDS)[number];

/** What the office reads on the booking. */
export const AUTO_CANCEL_REASON: Record<AutoCancelKind, string> = {
  not_approved: 'Auto-cancelled: the booking was not approved within 30 minutes after the pickup time.',
  not_published: 'Auto-cancelled: approved, but never published or assigned, so no driver or vendor was on it 30 minutes after the pickup time.',
  not_accepted: 'Auto-cancelled: approved and published, but no driver or vendor accepted it by 30 minutes after the pickup time.',
  bid_not_awarded: 'Auto-cancelled: approved and published, bids came in, but none was awarded by 30 minutes after the pickup time.',
};

/** What the customer reads (their app shows cancelReason): no office detail. */
export const AUTO_CANCEL_CUSTOMER_REASON = 'We could not confirm a ride for your pickup time.';

/** Whose side an accepted trip that did not happen was on, as the office records it when cancelling by hand. */
export const CANCEL_FAULTS = ['customer', 'driver', 'other'] as const;
export type CancelFault = (typeof CANCEL_FAULTS)[number];

export interface AutoCancelBooking {
  status?: unknown;
  assignedDriverId?: unknown;
  assignedVendorId?: unknown;
  pickupAt?: unknown;
  scheduledAt?: unknown;
  tripSubStatus?: unknown;
  tripStage?: unknown;
}

/** True when the pickup is at least 30 minutes old (an unknown pickup time never is). */
export function pickupExpired(b: AutoCancelBooking, nowMs: number): boolean {
  const at = pickupInstant(b)?.getTime();
  return at !== undefined && nowMs - at >= AUTO_CANCEL_AFTER_MINUTES * 60000;
}

const recentlyExpired = (b: AutoCancelBooking, nowMs: number) =>
  pickupExpired(b, nowMs) && nowMs - pickupInstant(b)!.getTime() <= AUTO_CANCEL_AFTER_MINUTES * 60000 + AUTO_CANCEL_LOOKBACK_HOURS * 3600000;

/**
 * Why this booking is cancelled now, or null when it must be left alone. `market` is its marketplace record (if any) and
 * `pendingBids` the bids on it still waiting for a decision.
 */
export function autoCancelKindOf(b: AutoCancelBooking, market: { publishedAt?: unknown } | null | undefined, pendingBids: number, nowMs: number): AutoCancelKind | null {
  if (b.status !== 'Pending' && b.status !== 'Approved') return null;
  if (b.assignedDriverId || b.assignedVendorId || !recentlyExpired(b, nowMs)) return null;
  if (b.status === 'Pending') return 'not_approved';
  if (pendingBids > 0) return 'bid_not_awarded';
  return market?.publishedAt ? 'not_accepted' : 'not_published';
}

/** An accepted trip that has not started 30 minutes after pickup: the office has to check and decide. */
export function acceptedNotStarted(b: AutoCancelBooking, nowMs: number): boolean {
  if (b.status !== 'Confirmed' && b.status !== 'Assigned') return false;
  const step = tripSubStatusOf(b);
  return step !== 'Trip Started' && step !== 'Trip Ended' && recentlyExpired(b, nowMs);
}
