// Driver ratings.
//
// At the end of a trip the customer rates the driver (1–5 stars). Every rating is kept as its own record in
// `driverRatings` (one per trip: the booking id, or `lt_<rideId>` for a Local Taxi ride) and rolled into the driver's
// profile: running average (`rating`, `ratingCount`), a star breakdown (`ratingBreakdown.1..5`), `lowRatingCount` and
// `lastRatingAt`. A low rating (see ratingPolicy.LOW_RATING_MAX) must carry a reason and feedback, and opens a
// follow-up the office works through on the Driver Ratings page.
//
// The customer reaches this only through `rateDriver` (bookings) or `ltRateRide` (Local Taxi). The older direct
// booking write (firestore.rules: rating / reviewComment) is still counted by the trigger below so an app that has
// not been updated yet keeps working; the aggregate is only ever written here, once per trip, never from a client.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { DocumentData, DocumentReference, FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { notifyAdmins } from './notify';
import { FOLLOW_UP_STATUSES, CleanRating, RatingProblem, cleanRating, isLowRating, nextAverage, summaryText } from './domain/ratingPolicy';
import { docId } from './marketplace';
import { requireAction, requirePermission, text } from './shared';

export const DRIVER_RATINGS = 'driverRatings';

/** Turns a validation problem into the error a customer sees. */
export function cleanOrThrow(raw: unknown): CleanRating {
  try {
    return cleanRating(raw);
  } catch (err) {
    if (err instanceof RatingProblem) throw new HttpsError('invalid-argument', err.message);
    throw err;
  }
}

/** The fields to write on a driver's profile for one more rating. */
export function driverProfileUpdate(d: DocumentData, stars: number): Record<string, unknown> {
  const upd: Record<string, unknown> = {
    ...nextAverage(d.rating, d.ratingCount, stars),
    [`ratingBreakdown.${stars}`]: FieldValue.increment(1),
    lastRatingAt: FieldValue.serverTimestamp(),
  };
  if (isLowRating(stars)) upd.lowRatingCount = FieldValue.increment(1);
  return upd;
}

export interface RatingRecordInput {
  source: 'booking' | 'local_taxi';
  /** Booking id or ride id. */
  refId: string;
  code: string;
  driverId: string;
  driverName: string;
  vendorId?: string;
  vehicleNumber?: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  serviceName: string;
  rating: CleanRating;
}

/** The per-trip record the Driver Ratings page reads. */
export function ratingRecord(i: RatingRecordInput): Record<string, unknown> {
  const c = i.rating;
  return {
    source: i.source,
    bookingId: i.source === 'booking' ? i.refId : '',
    rideId: i.source === 'local_taxi' ? i.refId : '',
    tripCode: i.code,
    driverId: i.driverId,
    driverName: i.driverName,
    vendorId: i.vendorId ?? '',
    vehicleNumber: i.vehicleNumber ?? '',
    customerId: i.customerId,
    customerName: i.customerName,
    customerPhone: i.customerPhone ?? '',
    serviceName: i.serviceName,
    stars: c.stars,
    low: c.low,
    tags: c.tags,
    reason: c.reason,
    feedback: c.feedback,
    improvements: c.improvements,
    comment: c.comment,
    // Only a low rating needs the office to act.
    followUp: c.low ? 'New' : 'None',
    adminNote: '',
    createdAt: FieldValue.serverTimestamp(),
  };
}

export const recordId = (source: 'booking' | 'local_taxi', refId: string): string => (source === 'booking' ? refId : `lt_${refId}`);

/** Tells the office about a low rating (once per trip). Never blocks or fails the rating itself. */
export async function alertLowRating(i: { id: string; stars: number; driverName: string; tripCode: string; reason: string; bookingId?: string }): Promise<void> {
  try {
    await notifyAdmins({
      category: 'trips',
      severity: 'warning',
      title: `${i.stars}-star rating for ${i.driverName || 'a driver'}`,
      message: `${i.tripCode ? `Trip ${i.tripCode}. ` : ''}Reason: ${i.reason || 'not given'}. Open Driver Ratings to follow up.`,
      bookingId: i.bookingId,
      dedupeKey: `low-rating:${i.id}`,
      push: true,
    });
  } catch (err) {
    console.warn('low-rating alert failed', err);
  }
}

/** What a booking says about its rating: the new fields, or (older apps) just the star count and comment. */
function ratingOfBooking(b: DocumentData): CleanRating {
  const stars = Number(b.rating);
  const low = isLowRating(stars);
  const comment = text(b.reviewComment, 1200);
  return {
    stars,
    low,
    tags: Array.isArray(b.ratingTags) ? b.ratingTags.map((t: unknown) => text(t, 40)).filter(Boolean) : [],
    reason: text(b.ratingReason, 60),
    feedback: low ? text(b.ratingFeedback, 600) || comment : '',
    improvements: text(b.ratingImprovements, 600),
    comment: low ? '' : comment,
  };
}

/** Counts the booking's rating into its partners' averages. Idempotent through `ratingCounted`. */
export async function syncRating(bookingId: string): Promise<boolean> {
  const ref = db.doc(`bookings/${bookingId}`);
  let alert: Parameters<typeof alertLowRating>[0] | null = null;
  const counted = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const b = snap.data();
    if (!snap.exists || !b || b.status !== 'Completed') return false;
    const rating = b.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5 || b.ratingCounted === true) return false;
    const driverRef = b.assignedDriverId ? db.doc(`drivers/${b.assignedDriverId}`) : null;
    const vendorRef = b.assignedVendorId ? db.doc(`vendors/${b.assignedVendorId}`) : null;
    const [driver, vendor, customer] = await Promise.all([
      driverRef ? tx.get(driverRef) : null,
      vendorRef ? tx.get(vendorRef) : null,
      b.customerId ? tx.get(db.doc(`customers/${b.customerId}`)) : null,
    ]);
    if (driver?.exists) tx.update(driverRef!, driverProfileUpdate(driver.data()!, rating));
    if (vendor?.exists) tx.update(vendorRef!, nextAverage(vendor.data()!.rating, vendor.data()!.ratingCount, rating));

    const c = ratingOfBooking(b);
    const code = text(b.bookingId) || bookingId;
    const driverName = text(b.assignedDriverName || b.driver || driver?.data()?.name, 80);
    tx.set(db.doc(`${DRIVER_RATINGS}/${bookingId}`), ratingRecord({
      source: 'booking',
      refId: bookingId,
      code,
      driverId: text(b.assignedDriverId, 128),
      driverName,
      vendorId: text(b.assignedVendorId, 128),
      vehicleNumber: text(b.assignedVehicleNumber, 20),
      customerId: text(b.customerId, 128),
      customerName: text(customer?.data()?.name, 80),
      customerPhone: text(customer?.data()?.phone, 20),
      serviceName: text(b.serviceName || b.service || b.tripType, 80),
      rating: c,
    }));
    tx.update(ref, { ratingCounted: true, ratingCountedAt: FieldValue.serverTimestamp() });
    if (c.low) alert = { id: bookingId, stars: c.stars, driverName, tripCode: code, reason: c.reason, bookingId };
    return true;
  });
  if (counted && alert) await alertLowRating(alert);
  return counted;
}

export const onBookingRated = onDocumentUpdated('bookings/{bookingId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.rating === undefined || before?.rating === after.rating) return;
  await syncRating(event.params.bookingId);
});

// ── Customer: rate the driver at the end of a trip ────────────────────────────────────────────────────────────────

export const rateDriver = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to rate your trip.');
  const bookingId = docId(request.data?.bookingId, 'booking');
  const c = cleanOrThrow(request.data);
  const ref = db.doc(`bookings/${bookingId}`);
  const customer = (await db.doc(`customers/${uid}`).get()).data() ?? {};
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const b = snap.data();
    if (!snap.exists || !b || b.customerId !== uid) throw new HttpsError('not-found', 'This trip does not exist.');
    if (b.status !== 'Completed') throw new HttpsError('failed-precondition', 'You can rate a trip once it is completed.');
    if (b.rating != null) throw new HttpsError('already-exists', 'You have already rated this trip.');
    const comment = summaryText(c);
    tx.update(ref, {
      rating: c.stars,
      reviewComment: comment,
      ratingTags: c.tags,
      ratingReason: c.reason,
      ratingFeedback: c.feedback,
      ratingImprovements: c.improvements,
      ratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // The public-reviews moderation queue (admin Reviews page) keeps working as before.
    tx.set(db.doc(`reviews/${bookingId}`), {
      bookingId,
      bookingCode: text(b.bookingId) || bookingId,
      customerId: uid,
      customerName: text(customer.name, 80),
      customerPhone: text(customer.phone, 20),
      driverId: text(b.assignedDriverId, 128),
      driverName: text(b.assignedDriverName || b.driver, 80),
      vehicleNumber: text(b.assignedVehicleNumber, 20),
      serviceName: text(b.serviceName || b.service || b.tripType, 80),
      overallRating: c.stars,
      driverRating: c.stars,
      reviewText: comment,
      status: 'Pending',
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  // Count it now so the driver's profile is current; the trigger would do the same a moment later (idempotent).
  await syncRating(bookingId).catch((err) => console.warn('syncRating after rateDriver failed', err));
  return { rated: true, low: c.low };
});

/** Writes everything a Local Taxi rating changes. Reads must already have happened in this transaction. */
export function localTaxiRatingWrites(
  tx: Transaction,
  i: { rideId: string; ride: DocumentData; driver: DocumentData | null; driverRef: DocumentReference | null; rating: CleanRating },
): { id: string; alert: Parameters<typeof alertLowRating>[0] | null } {
  const { ride, rating: c } = i;
  const id = recordId('local_taxi', i.rideId);
  if (i.driver && i.driverRef) tx.update(i.driverRef, driverProfileUpdate(i.driver, c.stars));
  tx.set(db.doc(`${DRIVER_RATINGS}/${id}`), ratingRecord({
    source: 'local_taxi',
    refId: i.rideId,
    code: i.rideId.slice(0, 8).toUpperCase(),
    driverId: text(ride.driverId, 128),
    driverName: text(ride.driverName, 80),
    vehicleNumber: text(ride.driverVehicle?.number, 20),
    customerId: text(ride.customerId, 128),
    customerName: text(ride.customerName, 80),
    serviceName: text(ride.categoryName, 80) || 'Local Taxi',
    rating: c,
  }));
  return { id, alert: c.low ? { id, stars: c.stars, driverName: text(ride.driverName, 80), tripCode: i.rideId.slice(0, 8).toUpperCase(), reason: c.reason } : null };
}

// ── Office: follow up on a low rating ─────────────────────────────────────────────────────────────────────────────

export const reviewDriverRating = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'engagement');
  requireAction(admin, 'Support', 'edit');
  const id = docId(request.data?.ratingId, 'rating');
  const followUp = request.data?.followUp;
  if (typeof followUp !== 'string' || !(FOLLOW_UP_STATUSES as readonly string[]).includes(followUp)) throw new HttpsError('invalid-argument', 'Choose a follow-up status.');
  const note = text(request.data?.note, 500);
  if ((followUp === 'Resolved' || followUp === 'Dismissed') && note.length < 3) throw new HttpsError('invalid-argument', 'Add a short note saying what was done.');
  const ref = db.doc(`${DRIVER_RATINGS}/${id}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const r = snap.data();
    if (!snap.exists || !r) throw new HttpsError('not-found', 'This rating does not exist.');
    if (!r.low) throw new HttpsError('failed-precondition', 'Only low ratings need a follow-up.');
    tx.update(ref, {
      followUp,
      adminNote: note || r.adminNote || '',
      handledBy: admin.uid,
      handledByName: admin.name,
      handledAt: FieldValue.serverTimestamp(),
    });
    auditInTx(tx, {
      action: 'driver_rating_follow_up',
      entity: 'driver_rating',
      entityId: id,
      performedBy: admin.uid,
      performedByName: admin.name,
      role: 'admin',
      previous: { followUp: r.followUp },
      next: { followUp },
      reason: note,
      bookingId: r.bookingId || undefined,
      meta: { driverId: r.driverId, stars: r.stars },
    });
  });
  return { ok: true };
});
