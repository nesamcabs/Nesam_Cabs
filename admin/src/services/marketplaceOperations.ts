import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';

/**
 * Marketplace steps that don't touch money. Awarding a bid, posting a booking
 * and assigning a driver set partner payouts, so they run on the server
 * (functions/src/marketplace.ts) — see marketplaceService.ts.
 */
export function createMarketplaceService(db: Firestore) {
  async function rejectBid(tripId: string, bidId: string): Promise<void> {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, 'marketplace_trips', tripId, 'bids', bidId);
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status !== 'Pending Review') throw new Error('This bid has already been reviewed.');
      tx.update(ref, { status: 'Rejected', reviewedAt: serverTimestamp() });
    });
  }
  return { rejectBid };
}
