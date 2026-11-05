// One verified rating per completed booking feeds the driver's (and vendor's) running average and
// review count. The customer writes only `rating` on their own completed booking (firestore.rules);
// the aggregate is maintained here, once per booking, and never from the client.
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';

/** Counts the booking's rating into its partners' averages. Idempotent through `ratingCounted`. */
export async function syncRating(bookingId: string): Promise<boolean> {
  const ref = db.doc(`bookings/${bookingId}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const b = snap.data();
    if (!snap.exists || !b || b.status !== 'Completed') return false;
    const rating = b.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || b.ratingCounted === true) return false;
    const targets = [
      b.assignedDriverId ? db.doc(`drivers/${b.assignedDriverId}`) : null,
      b.assignedVendorId ? db.doc(`vendors/${b.assignedVendorId}`) : null,
    ].filter((x): x is FirebaseFirestore.DocumentReference => !!x);
    const docs = await Promise.all(targets.map((t) => tx.get(t)));
    docs.forEach((d, i) => {
      if (!d.exists) return;
      const count = Number(d.data()!.ratingCount) || 0;
      const avg = Number(d.data()!.rating) || 0;
      const next = Math.round(((avg * count + rating) / (count + 1)) * 100) / 100;
      tx.update(targets[i]!, { rating: next, ratingCount: count + 1 });
    });
    tx.update(ref, { ratingCounted: true, ratingCountedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

export const onBookingRated = onDocumentUpdated('bookings/{bookingId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.rating === undefined || before?.rating === after.rating) return;
  await syncRating(event.params.bookingId);
});
