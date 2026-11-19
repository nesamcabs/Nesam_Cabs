import { pickupInstant } from './time';

// Waiting at the pickup, measured by the server: from the moment the driver tapped "Reached pickup" (or the booked pickup time, if the driver was
// early) until the driver started the trip with the customer on board. It is written onto the booking as the "pickup" stop of the trip's extra
// usage. What it costs is not decided here: when finance approves the usage, the free minutes per stop, the rounding, the customer's waiting
// rate (₹/hour, from the fare table) and the GST rule saved on the booking turn those minutes into the amount added to the customer's bill and
// credited to the partner (see extraUsage.ts and domain/extraCharges.ts).

export const PICKUP_STOP_ID = 'pickup';
const MAX_MINUTES = 1440;

/** Whole minutes the customer kept the driver waiting. Null when the driver never tapped "Reached pickup". An early driver waits from the booked time. */
export function pickupWaitedMinutes(reachedMs: number | null, scheduledMs: number | null, startedMs: number): number | null {
  if (reachedMs === null || !Number.isFinite(reachedMs) || !Number.isFinite(startedMs)) return null;
  const from = scheduledMs !== null && Number.isFinite(scheduledMs) ? Math.max(reachedMs, scheduledMs) : reachedMs;
  return Math.max(0, Math.min(MAX_MINUTES, Math.floor((startedMs - from) / 60000)));
}

const millisOf = (v: unknown): number | null => {
  const t = v as { toMillis?: () => number } | null | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : null;
};

/**
 * The booking fields to write when the trip starts: the measured pickup wait, and (when nobody has recorded usage yet) a submitted extra-usage
 * revision holding it, for finance to approve. Hill travel and roof carrier are filled from what the customer booked, so the revision is complete;
 * whoever records usage afterwards replaces it with a new revision. Returns nothing when there is nothing to measure.
 */
export function pickupWaitFields(b: Record<string, any>, startedMs: number, stamp: unknown): Record<string, unknown> {
  const reachedMs = millisOf(b.reachedPickupAt);
  const scheduledMs = pickupInstant(b)?.getTime() ?? null;
  const minutes = pickupWaitedMinutes(reachedMs, scheduledMs, startedMs);
  if (minutes === null) return {};
  const out: Record<string, unknown> = {
    pickupWait: { minutes, reachedAtMs: reachedMs, scheduledAtMs: scheduledMs, startedAtMs: startedMs },
  };
  if (b.extraUsage === undefined || b.extraUsage === null) {
    out.extraUsage = {
      schema: 1, revision: 1, status: 'submitted',
      usage: {
        stops: [{ stopId: PICKUP_STOP_ID, waitedMinutes: minutes }],
        hill: !!b.pricing?.hillStation || b.tripExtras?.hillTravel === true,
        carrier: b.pricing?.bookingAddOns?.roofCarrier === true || b.tripExtras?.roofCarrier === true,
      },
      note: 'Pickup waiting measured automatically: the driver reached the pickup and the trip started later.',
      submittedBy: 'system', submittedByName: 'Automatic', submittedRole: 'system', submittedAt: stamp,
    };
  }
  return out;
}
