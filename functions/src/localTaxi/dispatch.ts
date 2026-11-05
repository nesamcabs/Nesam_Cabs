// Local Taxi dispatch: sequential driver offers with radius expansion, atomic assignment, and the cleanup that
// goes with giving a ride back. Everything that changes a ride runs in a transaction that re-reads the ride, so
// two drivers can never both win it, an expired offer can never be accepted, and a ride cancelled a moment ago
// can never be assigned.
//
// How a search runs (advanceDispatch):
//   1. past searchTimeoutSeconds                → no_driver_available
//   2. an offer is pending and not expired      → wait
//   3. the pending offer expired                → mark it expired, go on
//   4. find the nearest eligible driver within the current radius (zone, category, approved, online, available,
//      fresh location INSIDE the zone, not already offered this ride) → create ONE offer with an expiry
//   5. nobody inside the radius                 → widen the radius by one step, up to the zone's maximum
// It is idempotent: the customer's status poll, the driver's response and the periodic sweep all call it.
import { randomInt } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData, DocumentSnapshot, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { auditInTx } from '../audit';
import { notify } from '../notify';
import { approved } from '../shared';
import { Geometry, haversineMeters, pointInGeometry } from './geo';
import { COL, DispatchPolicy, boundaryOfDoc, str, tsMs } from './model';
import { Actor, isTerminal, transitionProblem } from './states';

export const rideRef = (id: string) => db.doc(`${COL.rides}/${id}`);

/** Append-only ride event, inside the transaction that changes the ride. */
export function rideEventTx(tx: Transaction, rideId: string, e: { type: string; from?: string; to?: string; actorId: string; actorRole: Actor; meta?: Record<string, unknown> }) {
  tx.create(rideRef(rideId).collection('events').doc(), { ...e, meta: e.meta ?? {}, at: FieldValue.serverTimestamp(), atMs: Date.now() });
}

/** In-app + push message, never part of the ride's authoritative state: a delivery failure changes nothing. */
export async function ltNotify(recipientId: string, recipientType: 'customer' | 'driver' | 'admin', title: string, message: string, rideId: string, dedupeKey?: string) {
  try {
    await notify({
      recipientId, recipientType, category: 'trips', severity: 'info', sound: recipientType === 'driver' ? 'new_booking' : 'general', title, message, bookingId: rideId,
      brand: recipientType === 'customer' ? 'people_taxi' : undefined, push: true, ...(dedupeKey ? { dedupeKey } : {}),
    } as Parameters<typeof notify>[0]);
  } catch (e) { console.warn('[local taxi] notification failed', e instanceof Error ? e.message : e); }
}

/** The boundary the ride was booked under (its version), so later boundary edits never change a ride in progress. */
export async function boundaryFor(zoneId: string, version: number): Promise<Geometry | null> {
  const v = await db.doc(`${COL.zones}/${zoneId}/versions/${version}`).get();
  const versioned = boundaryOfDoc(v.data());
  if (versioned) return versioned;
  const z = await db.doc(`${COL.zones}/${zoneId}`).get();
  return boundaryOfDoc(z.data());
}

const fresh = (loc: DocumentData | null | undefined, maxAgeMs: number, nowMs: number) => !!loc && typeof loc.atMs === 'number' && nowMs - loc.atMs <= maxAgeMs && nowMs - loc.atMs >= -5000;

export async function driverApproved(driverId: string): Promise<DocumentData | null> {
  const d = await db.doc(`drivers/${driverId}`).get();
  const p = d.data();
  return d.exists && p && approved(p.status) && p.fleetStatus !== 'Suspended' ? p : null;
}

// ── Offers ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function findCandidate(ride: DocumentData, radiusMeters: number, nowMs: number): Promise<{ id: string; distance: number } | null> {
  const policy = ride.zone.dispatch as DispatchPolicy;
  const boundary = await boundaryFor(ride.zone.id, ride.zone.boundaryVersion);
  if (!boundary) return null;
  const snap = await db.collection(COL.driverState).where('zoneIds', 'array-contains', ride.zone.id).where('online', '==', true).where('available', '==', true).limit(300).get();
  const offered: string[] = ride.offeredDriverIds ?? [];
  const pickup = { lat: ride.pickup.lat, lng: ride.pickup.lng };
  const ranked = snap.docs
    .filter((d) => {
      const s = d.data();
      return !offered.includes(d.id) && !s.activeRideId && (s.categoryIds ?? []).includes(ride.categoryId) && fresh(s.location, policy.locationMaxAgeSeconds * 1000, nowMs)
        && pointInGeometry({ lat: s.location.lat, lng: s.location.lng }, boundary);
    })
    .map((d) => ({ id: d.id, distance: haversineMeters({ lat: d.data().location.lat, lng: d.data().location.lng }, pickup) }))
    .filter((c) => c.distance <= radiusMeters)
    .sort((a, b) => a.distance - b.distance);
  for (const c of ranked.slice(0, 8)) if (await driverApproved(c.id)) return c;
  return null;
}

async function createOffer(rideId: string, driverId: string, distanceMeters: number, nowMs: number): Promise<boolean> {
  const offerId = `${rideId}__${driverId}`;
  const done = await db.runTransaction(async (tx) => {
    const [rs, ds, os] = await Promise.all([tx.get(rideRef(rideId)), tx.get(db.doc(`${COL.driverState}/${driverId}`)), tx.get(db.doc(`${COL.offers}/${offerId}`))]);
    const ride = rs.data();
    const st = ds.data();
    if (!ride || ride.status !== 'searching' || ride.currentOfferId || os.exists) return null;
    if (!st || st.online !== true || st.available !== true || st.activeRideId) return null;
    const policy = ride.zone.dispatch as DispatchPolicy;
    tx.create(db.doc(`${COL.offers}/${offerId}`), {
      rideId, driverId, zoneId: ride.zone.id, categoryId: ride.categoryId, status: 'pending', createdAtMs: nowMs, expiresAtMs: nowMs + policy.offerTtlSeconds * 1000,
      pickup: ride.pickup, drop: ride.drop, distanceToPickupMeters: Math.round(distanceMeters), tripDistanceMeters: ride.route.distanceMeters, tripDurationSeconds: ride.route.durationSeconds,
      estimatedEarningsPaise: ride.estimate.driverEarningsPaise, paymentMethod: ride.paymentMethod, round: (ride.offeredDriverIds ?? []).length + 1, createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(rideRef(rideId), { currentOfferId: offerId, offeredDriverIds: FieldValue.arrayUnion(driverId), updatedAt: FieldValue.serverTimestamp() });
    rideEventTx(tx, rideId, { type: 'offer_sent', actorId: 'system', actorRole: 'system', meta: { driverId, distanceMeters: Math.round(distanceMeters) } });
    return { pickupName: ride.pickup.name, customerId: ride.customerId };
  });
  if (!done) return false;
  await ltNotify(driverId, 'driver', 'New Local Taxi request', `Pickup: ${done.pickupName}. Open the app to accept.`, rideId, `lt_offer_${offerId}`);
  return true;
}

async function expireOffer(rideId: string, offerId: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const [rs, os] = await Promise.all([tx.get(rideRef(rideId)), tx.get(db.doc(`${COL.offers}/${offerId}`))]);
    if (os.exists && os.data()!.status === 'pending') {
      tx.update(os.ref, { status: 'expired', closedAtMs: Date.now() });
      rideEventTx(tx, rideId, { type: 'offer_expired', actorId: 'system', actorRole: 'system', meta: { driverId: os.data()!.driverId } });
    }
    if (rs.exists && rs.data()!.currentOfferId === offerId) tx.update(rs.ref, { currentOfferId: '', updatedAt: FieldValue.serverTimestamp() });
  });
}

/** Releases the customer and any pending offer when a search ends without a driver. */
async function finishNoDriver(rideId: string): Promise<void> {
  let customerId = '';
  await db.runTransaction(async (tx) => {
    const rs = await tx.get(rideRef(rideId));
    const ride = rs.data();
    if (!ride || ride.status !== 'searching') return;
    const cur = ride.currentOfferId ? await tx.get(db.doc(`${COL.offers}/${ride.currentOfferId}`)) : null;
    const problem = transitionProblem('searching', 'no_driver_available', 'system');
    if (problem) return;
    customerId = ride.customerId;
    if (cur?.exists && cur.data()!.status === 'pending') tx.update(cur.ref, { status: 'cancelled', closedAtMs: Date.now() });
    tx.update(rs.ref, { status: 'no_driver_available', statusAtMs: Date.now(), currentOfferId: '', updatedAt: FieldValue.serverTimestamp(), endedAtMs: Date.now() });
    tx.set(db.doc(`lt_customer_state/${ride.customerId}`), { activeRideId: '' }, { merge: true });
    rideEventTx(tx, rideId, { type: 'status', from: 'searching', to: 'no_driver_available', actorId: 'system', actorRole: 'system' });
  });
  if (customerId) await ltNotify(customerId, 'customer', 'No driver available', 'We could not find a driver nearby. You have not been charged. Please try again in a few minutes.', rideId, `lt_nodriver_${rideId}`);
}

export interface DispatchResult { status: string; action: 'none' | 'waiting' | 'offered' | 'no_driver' | 'searching' }

export async function advanceDispatch(rideId: string, nowMs = Date.now()): Promise<DispatchResult> {
  for (let attempt = 0; attempt < 14; attempt++) {
    const snap = await rideRef(rideId).get();
    if (!snap.exists) return { status: 'missing', action: 'none' };
    const ride = snap.data()!;
    if (ride.status !== 'searching') return { status: ride.status, action: 'none' };
    const policy = ride.zone.dispatch as DispatchPolicy;
    if (nowMs - Number(ride.searchStartedAtMs ?? nowMs) > policy.searchTimeoutSeconds * 1000) {
      await finishNoDriver(rideId);
      return { status: 'no_driver_available', action: 'no_driver' };
    }
    if (ride.currentOfferId) {
      const offer = await db.doc(`${COL.offers}/${ride.currentOfferId}`).get();
      if (offer.exists && offer.data()!.status === 'pending' && Number(offer.data()!.expiresAtMs) > nowMs) return { status: 'searching', action: 'waiting' };
      await expireOffer(rideId, String(ride.currentOfferId));
      continue;
    }
    const step = Number(ride.radiusStep ?? 0);
    const radius = Math.min(policy.radiusMaxMeters, policy.radiusStartMeters + step * policy.radiusStepMeters);
    const candidate = await findCandidate(ride, radius, nowMs);
    if (candidate) {
      if (await createOffer(rideId, candidate.id, candidate.distance, nowMs)) return { status: 'searching', action: 'offered' };
      continue;
    }
    if (radius < policy.radiusMaxMeters) {
      await rideRef(rideId).update({ radiusStep: step + 1, updatedAt: FieldValue.serverTimestamp() });
      continue;
    }
    return { status: 'searching', action: 'searching' };
  }
  return { status: 'searching', action: 'searching' };
}

// ── Assignment ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface AssignInput { rideId: string; driverId: string; actor: Actor; actorId: string; offerId?: string; nowMs?: number }

/**
 * Atomically gives the ride to the driver. Used by a driver accepting an offer and by staff assigning manually; the
 * checks are the same, so manual dispatch cannot bypass eligibility.
 */
export async function assignRide(input: AssignInput): Promise<{ otpIssued: boolean; customerId: string; driverName: string }> {
  const nowMs = input.nowMs ?? Date.now();
  const driverDoc = await driverApproved(input.driverId);
  if (!driverDoc) throw new HttpsError('permission-denied', 'This driver account is not approved or is suspended.');
  const out = await db.runTransaction(async (tx) => {
    const reads: Promise<DocumentSnapshot>[] = [tx.get(rideRef(input.rideId)), tx.get(db.doc(`${COL.driverState}/${input.driverId}`))];
    if (input.offerId) reads.push(tx.get(db.doc(`${COL.offers}/${input.offerId}`)));
    const [rs, ds, os] = await Promise.all(reads);
    const ride = rs!.data();
    const st = ds!.data();
    if (!ride) throw new HttpsError('not-found', 'This ride no longer exists.');
    if (ride.status !== 'searching') throw new HttpsError('failed-precondition', isTerminal(ride.status) ? 'This ride is no longer available.' : 'This ride has already been taken.', { reason: 'ride_taken' });
    const problem = transitionProblem('searching', 'assigned', input.actor);
    if (problem) throw new HttpsError('failed-precondition', problem);
    if (input.offerId) {
      const o = os!.data();
      if (!o || o.driverId !== input.driverId || o.rideId !== input.rideId) throw new HttpsError('permission-denied', 'This offer is not yours.');
      if (o.status !== 'pending') throw new HttpsError('failed-precondition', 'This offer is no longer open.', { reason: 'offer_closed' });
      if (Number(o.expiresAtMs) <= nowMs) throw new HttpsError('deadline-exceeded', 'This offer has expired.', { reason: 'offer_expired' });
      if (ride.currentOfferId !== input.offerId) throw new HttpsError('failed-precondition', 'This offer is no longer current.', { reason: 'offer_closed' });
    }
    if (!st || st.online !== true || st.available !== true || st.activeRideId) throw new HttpsError('failed-precondition', st?.activeRideId ? 'Finish your current ride first.' : 'Go online to take rides.', { reason: 'driver_unavailable' });
    if (!(st.zoneIds ?? []).includes(ride.zone.id) || !(st.categoryIds ?? []).includes(ride.categoryId)) throw new HttpsError('permission-denied', 'You are not enabled for this zone or vehicle type.');
    return { ride, st, offer: os?.data() ?? null };
  }).then(async (pre) => {
    // Re-check the driver's position against the boundary the ride was booked under (outside the transaction: a read-only lookup).
    const policy = pre.ride.zone.dispatch as DispatchPolicy;
    const boundary = await boundaryFor(pre.ride.zone.id, pre.ride.zone.boundaryVersion);
    if (!boundary || !fresh(pre.st.location, policy.locationMaxAgeSeconds * 1000, nowMs) || !pointInGeometry({ lat: pre.st.location.lat, lng: pre.st.location.lng }, boundary)) {
      throw new HttpsError('failed-precondition', 'Your location is outside the service area or out of date. Turn on location and try again.', { reason: 'driver_location' });
    }
    return pre;
  }).then(() => db.runTransaction(async (tx) => {
    const [rs, ds, os] = await Promise.all([
      tx.get(rideRef(input.rideId)), tx.get(db.doc(`${COL.driverState}/${input.driverId}`)), input.offerId ? tx.get(db.doc(`${COL.offers}/${input.offerId}`)) : Promise.resolve(null),
    ]);
    const ride = rs.data();
    const st = ds.data();
    if (!ride || ride.status !== 'searching') throw new HttpsError('failed-precondition', 'This ride has already been taken.', { reason: 'ride_taken' });
    if (!st || st.available !== true || st.activeRideId || st.online !== true) throw new HttpsError('failed-precondition', 'You are not available for this ride.', { reason: 'driver_unavailable' });
    if (input.offerId) {
      const o = os?.data();
      if (!o || o.status !== 'pending' || Number(o.expiresAtMs) <= nowMs || ride.currentOfferId !== input.offerId) throw new HttpsError('failed-precondition', 'This offer is no longer open.', { reason: 'offer_closed' });
      tx.update(os!.ref, { status: 'accepted', closedAtMs: nowMs });
    }
    const otp = String(randomInt(1000, 10000));
    tx.update(rs.ref, {
      status: 'assigned', statusAtMs: nowMs, driverId: input.driverId, driverName: str(driverDoc.name, 80), driverPhone: str(driverDoc.phone, 20),
      driverVehicle: { number: str(driverDoc.vehicleNumber, 20), type: str(driverDoc.vehicleType, 40) }, assignedAtMs: nowMs, currentOfferId: '', updatedAt: FieldValue.serverTimestamp(),
      assignedBy: input.actor === 'admin' ? input.actorId : 'driver', version: FieldValue.increment(1),
    });
    tx.set(db.doc(`${COL.rideSecrets}/${input.rideId}`), { customerId: ride.customerId, otp, attempts: { count: 0 }, createdAtMs: nowMs });
    tx.set(db.doc(`${COL.rideLive}/${input.rideId}`), { customerId: ride.customerId, driverId: input.driverId, location: st.location ?? null, status: 'assigned', updatedAtMs: nowMs });
    tx.update(ds.ref, { available: false, activeRideId: input.rideId, updatedAt: FieldValue.serverTimestamp() });
    // Any other pending offer for this ride (staff assignment) is closed.
    if (!input.offerId && ride.currentOfferId) tx.update(db.doc(`${COL.offers}/${ride.currentOfferId}`), { status: 'cancelled', closedAtMs: nowMs });
    rideEventTx(tx, input.rideId, { type: 'status', from: 'searching', to: 'assigned', actorId: input.actorId, actorRole: input.actor, meta: { driverId: input.driverId } });
    auditInTx(tx, { action: input.actor === 'admin' ? 'lt_ride_assigned_by_admin' : 'lt_ride_accepted', entity: 'lt_ride', entityId: input.rideId, performedBy: input.actorId, role: input.actor === 'admin' ? 'admin' : 'driver', next: { driverId: input.driverId } });
    return { otpIssued: true, customerId: ride.customerId as string, driverName: str(driverDoc.name, 80) };
  }));
  await ltNotify(out.customerId, 'customer', 'Driver assigned', `${out.driverName} is on the way. Share your ride code only when you board.`, input.rideId, `lt_assigned_${input.rideId}_${input.driverId}`);
  return out;
}

/** The driver declines an offer: it closes, the ride stays searching, and the next driver is tried. */
export async function rejectOffer(driverId: string, offerId: string): Promise<string> {
  let rideId = '';
  await db.runTransaction(async (tx) => {
    const os = await tx.get(db.doc(`${COL.offers}/${offerId}`));
    const o = os.data();
    if (!o || o.driverId !== driverId) throw new HttpsError('permission-denied', 'This offer is not yours.');
    rideId = o.rideId;
    if (o.status !== 'pending') return;
    const rs = await tx.get(rideRef(o.rideId));
    tx.update(os.ref, { status: 'rejected', closedAtMs: Date.now() });
    if (rs.exists && rs.data()!.currentOfferId === offerId) tx.update(rs.ref, { currentOfferId: '', updatedAt: FieldValue.serverTimestamp() });
    rideEventTx(tx, o.rideId, { type: 'offer_rejected', actorId: driverId, actorRole: 'driver' });
  });
  return rideId;
}

/** Frees the driver after a ride ends or is given back. Call inside the same transaction as the ride change. */
export function releaseDriverTx(tx: Transaction, driverId: string, rideId: string, driverState: DocumentData | undefined) {
  if (driverState && driverState.activeRideId === rideId) tx.update(db.doc(`${COL.driverState}/${driverId}`), { activeRideId: null, available: driverState.online === true, updatedAt: FieldValue.serverTimestamp() });
}

export const endedAt = (ride: DocumentData) => tsMs(ride.endedAtMs);

/**
 * The periodic safety net (every minute): expires stale offers, finishes searches that ran out of time, and nudges
 * searching rides forward even if nobody is polling. It also promotes fares that have come due.
 */
export async function sweepDispatch(nowMs = Date.now()): Promise<{ advanced: number }> {
  const searching = await db.collection(COL.rides).where('status', '==', 'searching').limit(100).get();
  let advanced = 0;
  for (const d of searching.docs) {
    try { await advanceDispatch(d.id, nowMs); advanced++; } catch (e) { console.warn('[local taxi] sweep failed for', d.id, e instanceof Error ? e.message : e); }
  }
  return { advanced };
}
