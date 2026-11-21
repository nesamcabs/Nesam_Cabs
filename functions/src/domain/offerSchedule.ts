/**
 * The marketplace offer schedule and the order bids are decided in. Pure, so the server (escalation job, bid award) and the
 * Master Admin dashboard preview use one rule: tests/domain/commandDesk.parity.test.mjs fails if the two copies drift apart.
 */

/** Offer after `steps` whole hours: min(ceiling, round(start × (1 + step%)^steps)), in rupees. Step 0 is the start offer exactly. */
export function scheduledOffer(start: number, stepPercent: number, ceiling: number, steps: number): number {
  if (!(steps > 0)) return start;
  const raw = Math.round(start * Math.pow(1 + stepPercent / 100, steps));
  return ceiling > 0 ? Math.min(ceiling, raw) : raw;
}

export interface RankableBid { id: string; status?: unknown; amount: number; submittedAtMs: number }

/** Bids still under review, lowest amount first; a tie goes to the bid placed first, then to the lower id, so the order is always the same. */
export function rankPendingBids<T extends RankableBid>(bids: T[]): T[] {
  return bids
    .filter((b) => b.status === 'Pending Review' && Number.isFinite(b.amount) && b.amount > 0)
    .sort((a, z) => a.amount - z.amount || a.submittedAtMs - z.submittedAtMs || (a.id < z.id ? -1 : a.id > z.id ? 1 : 0));
}
