// Trip payout text and category matching. Balances and earnings totals come
// from the server's wallet and ledger (utils/ledger.ts); nothing is computed here.
import type { TripDetails } from '../types/driver';
import { formatINR } from './format';

/** The payout as recorded by NESAM — the finalized amount once finance has closed the trip, else the agreed one. Never an estimate. */
export function payoutText(t: Pick<TripDetails, 'fleetTrip' | 'payoutRecorded' | 'driverEarnings'>): string {
  if (t.fleetTrip) return 'Paid by your fleet';
  return t.payoutRecorded ? formatINR(t.driverEarnings) : 'Not recorded';
}

/** Short note on where the payout figure comes from. */
export function payoutNote(t: Pick<TripDetails, 'fleetTrip' | 'payoutRecorded' | 'payoutFinalized'>): string {
  if (t.fleetTrip) return 'Your fleet operator receives this trip’s payout.';
  if (t.payoutFinalized) return 'Finalized by NESAM finance.';
  return t.payoutRecorded ? 'Agreed when the trip was assigned; finalized after the trip.' : 'No payout has been recorded yet — contact NESAM support.';
}

/**
 * Trip categories are admin-defined names ("Sedan (AC)", "Innova Crysta"), so
 * match loosely on the driver's vehicle type; a plain SUV must not match
 * "Premium SUV" trips (from driver/web DashboardScreen.tsx).
 */
export function categoryMatches(tripCategory: string, driverType: string): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
  const cat = normalise(tripCategory);
  const mine = normalise(driverType);
  if (!cat) return true;
  if (cat.includes('premium') !== mine.includes('premium')) return false;
  if ((cat === 'mini' && mine === 'hatchback') || (cat === 'hatchback' && mine === 'mini')) return true;
  return cat.includes(mine) || mine.includes(cat);
}
