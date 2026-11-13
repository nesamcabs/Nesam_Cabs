// Local Taxi driver functions: availability, live location, offers and the ride steps
// (assigned → driver_arriving → driver_arrived → in_progress → completed). Every step is validated against the ride's
// state machine, the driver's identity and a fresh, accurate location fix; the final fare is computed here from
// server-recorded times and the server-tracked distance, never from a total the driver supplies.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { timingSafeEqual } from 'crypto';
import { db } from '../admin';
import { auditInTx } from '../audit';
import { approved } from '../shared';
import { calculateFare, cancellationFeePaise, formatPaise, resolveFinalDistance, validateFareConfig } from './fare';
import { haversineMeters, pointInGeometry } from './geo';
import { COL, boundaryOfDoc, cleanId, str } from './model';
import { advanceDispatch, assignRide, boundaryFor, driverApproved, ltNotify, rejectOffer, releaseDriverTx, rideEventTx, rideRef } from './dispatch';
import { transitionProblem } from './states';

const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCK_MS = 10 * 60000;
const NO_SHOW_WAIT_MS = 5 * 60000;
const MAX_ACCURACY_M = 150;
const MAX_SPEED_MS = 45; // anything faster between two fixes is a GPS jump, not driving
const MAX_REASSIGNMENTS = 4;

async function activeDriver(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const p = await driverApproved(uid);
  if (!p) throw new HttpsError('permission-denied', 'Your driver account is not approved or is suspended.');
  return { uid, profile: p };
}

interface Fix { lat: number; lng: number; accuracy: number | null; heading: number | null; atMs: number }

function fixOf(v: unknown, nowMs: number): Fix {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const lat = o.lat, lng = o.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 6.5 || lat > 35.7 || lng < 68.1 || lng > 97.4) throw new HttpsError('invalid-argument', 'Location is missing or invalid.');
  const accuracy = typeof o.accuracy === 'number' && Number.isFinite(o.accuracy) ? Math.round(o.accuracy) : null;
  if (accuracy !== null && accuracy > MAX_ACCURACY_M) throw new HttpsError('failed-precondition', 'Your GPS signal is weak. Move to an open area and try again.', { reason: 'weak_gps' });
  const captured = typeof o.capturedAt === 'number' && Number.isFinite(o.capturedAt) ? o.capturedAt : nowMs;
  if (nowMs - captured > 45000 || captured - nowMs > 5000) throw new HttpsError('failed-precondition', 'Your location is out of date. Wait for a fresh GPS fix.', { reason: 'stale_location' });
  return { lat, lng, accuracy, heading: typeof o.heading === 'number' && Number.isFinite(o.heading) ? Math.round(o.heading) : null, atMs: nowMs };
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Go online / offline. Online needs an enabled zone + category and a fresh fix inside one of the driver's active zones. */
export const ltSetAvailability = onCall(async (request) => {
  const { uid } = await activeDriver(request.auth?.uid);
  const online = request.data?.online === true;
  const ref = db.doc(`${COL.driverState}/${uid}`);
  const nowMs = Date.now();
  const st = (await ref.get()).data();
  if (!online) {
    if (st?.activeRideId) throw new HttpsError('failed-precondition', 'Finish your current ride before going offline.');
    await ref.set({ online: false, available: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { online: false };
  }
  if (!st || !(st.zoneIds ?? []).length || !(st.categoryIds ?? []).length) throw new HttpsError('failed-precondition', 'You are not enabled for Local Taxi yet. Ask the office to enable your zone and vehicle type.', { reason: 'not_enabled' });
  const fix = fixOf(request.data?.location, nowMs);
  let inside = false;
  for (const zid of st.zoneIds as string[]) {
    const z = await db.doc(`${COL.zones}/${zid}`).get();
    const b = boundaryOfDoc(z.data());
    if (z.exists && z.data()!.status === 'active' && b && pointInGeometry(fix, b)) { inside = true; break; }
  }
  if (!inside) throw new HttpsError('failed-precondition', 'You are outside your Local Taxi service area.', { reason: 'outside_zone' });
  await ref.set({ online: true, available: !st.activeRideId, location: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: fix.heading, atMs: nowMs }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { online: true, available: !st.activeRideId };
});

/** The driver app's location heartbeat. Mirrors the position to the customer and tracks distance while a ride runs. */
export const ltUpdateLocation = onCall(async (request) => {
  const { uid } = await activeDriver(request.auth?.uid);
  const nowMs = Date.now();
  const fix = fixOf(request.data?.location, nowMs);
  const ref = db.doc(`${COL.driverState}/${uid}`);
  return db.runTransaction(async (tx) => {
    const ds = await tx.get(ref);
    const st = ds.data();
    if (!st || st.online !== true) throw new HttpsError('failed-precondition', 'You are offline.', { reason: 'offline' });
    const loc = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, heading: fix.heading, atMs: nowMs };
    const rideId = String(st.activeRideId ?? '');
    if (!rideId) { tx.update(ref, { location: loc, updatedAt: FieldValue.serverTimestamp() }); return { ok: true }; }
    const [rs, ts] = await Promise.all([tx.get(rideRef(rideId)), tx.get(db.doc(`${COL.rideTracking}/${rideId}`))]);
    tx.update(ref, { location: loc, updatedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`${COL.rideLive}/${rideId}`), { location: loc, updatedAtMs: nowMs }, { merge: true });
    if (rs.data()?.status === 'in_progress') {
      const t = ts.data() ?? { trackedMeters: 0, pings: 0, lastLat: null, lastLng: null, lastAtMs: null };
      let add = 0;
      if (typeof t.lastLat === 'number' && typeof t.lastLng === 'number' && typeof t.lastAtMs === 'number') {
        const meters = haversineMeters({ lat: t.lastLat, lng: t.lastLng }, fix);
        const secs = Math.max(1, (nowMs - t.lastAtMs) / 1000);
        if (meters >= 5 && meters / secs <= MAX_SPEED_MS) add = meters;
        else if (meters < 5) add = 0;
      }
      tx.set(db.doc(`${COL.rideTracking}/${rideId}`), { trackedMeters: Number(t.trackedMeters ?? 0) + add, pings: Number(t.pings ?? 0) + 1, lastLat: fix.lat, lastLng: fix.lng, lastAtMs: nowMs }, { merge: true });
    }
    return { ok: true };
  });
});

/** Accept or decline the current offer. Accepting is atomic: only the driver whose offer is current can win the ride. */
export const ltRespondOffer = onCall(async (request) => {
  const { uid } = await activeDriver(request.auth?.uid);
  const offerId = cleanId(request.data?.offerId, 'offer');
  if (request.data?.accept === true) {
    const rideId = String((await db.doc(`${COL.offers}/${offerId}`).get()).data()?.rideId ?? '');
    if (!rideId) throw new HttpsError('not-found', 'This offer does not exist.');
    await assignRide({ rideId, driverId: uid, actor: 'driver', actorId: uid, offerId });
    return { accepted: true, rideId };
  }
  const rideId = await rejectOffer(uid, offerId);
  if (rideId) await advanceDispatch(rideId).catch(() => null);
  return { accepted: false, rideId };
});

type Step = 'depart' | 'arrived' | 'start' | 'complete' | 'release' | 'no_show' | 'collect_cash';
const STEPS: readonly Step[] = ['depart', 'arrived', 'start', 'complete', 'release', 'no_show', 'collect_cash'];

export const ltDriverAdvance = onCall(async (request) => {
  const { uid, profile } = await activeDriver(request.auth?.uid);
  const d = (request.data ?? {}) as Record<string, any>;
  const rideId = cleanId(d.rideId, 'ride');
  const step = d.action as Step;
  if (!STEPS.includes(step)) throw new HttpsError('invalid-argument', 'Unknown action.');
  const nowMs = Date.now();
  const needsFix = step === 'arrived' || step === 'start' || step === 'complete';
  const fix = needsFix ? fixOf(d.location, nowMs) : null;
  const otp = step === 'start' ? str(d.otp, 8) : '';
  if (step === 'start' && !/^\d{4}$/.test(otp)) throw new HttpsError('invalid-argument', 'Enter the 4-digit ride code from the customer.');
  let notifyCustomer: { id: string; title: string; body: string } | null = null;
  let reDispatch = false;
  let wrongOtp: { remaining: number; locked: boolean } | null = null;

  const result = await db.runTransaction(async (tx) => {
    notifyCustomer = null; reDispatch = false; wrongOtp = null;
    const [rs, ds, ss, ts] = await Promise.all([tx.get(rideRef(rideId)), tx.get(db.doc(`${COL.driverState}/${uid}`)), tx.get(db.doc(`${COL.rideSecrets}/${rideId}`)), tx.get(db.doc(`${COL.rideTracking}/${rideId}`))]);
    const ride = rs.data();
    if (!ride) throw new HttpsError('not-found', 'This ride does not exist.');
    if (ride.driverId !== uid) throw new HttpsError('permission-denied', 'This ride is not assigned to you.');
    const policy = ride.zone.dispatch as { arrivalRadiusMeters: number };
    const near = (meters: number) => fix && haversineMeters(fix, ride.pickup) <= meters;
    const to = (next: string) => {
      const problem = transitionProblem(ride.status, next, 'driver');
      if (problem) throw new HttpsError('failed-precondition', problem);
    };
    const base = { updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1) };
    const live = db.doc(`${COL.rideLive}/${rideId}`);

    switch (step) {
      case 'depart': {
        to('driver_arriving');
        tx.update(rs.ref, { ...base, status: 'driver_arriving', statusAtMs: nowMs });
        tx.set(live, { status: 'driver_arriving' }, { merge: true });
        rideEventTx(tx, rideId, { type: 'status', from: ride.status, to: 'driver_arriving', actorId: uid, actorRole: 'driver' });
        notifyCustomer = { id: ride.customerId, title: 'Driver is on the way', body: `${ride.driverName} is heading to your pickup.` };
        return { status: 'driver_arriving' };
      }
      case 'arrived': {
        to('driver_arrived');
        if (!near(policy.arrivalRadiusMeters)) throw new HttpsError('failed-precondition', `You are not at the pickup point yet. Get within ${policy.arrivalRadiusMeters} m of the pickup to mark arrival.`, { reason: 'not_at_pickup' });
        tx.update(rs.ref, { ...base, status: 'driver_arrived', statusAtMs: nowMs, arrivedAtMs: nowMs });
        tx.set(live, { status: 'driver_arrived' }, { merge: true });
        rideEventTx(tx, rideId, { type: 'status', from: ride.status, to: 'driver_arrived', actorId: uid, actorRole: 'driver' });
        notifyCustomer = { id: ride.customerId, title: 'Your driver has arrived', body: `${ride.driverName} is at the pickup. Share your ride code when you board.` };
        return { status: 'driver_arrived' };
      }
      case 'start': {
        to('in_progress');
        if (!near(policy.arrivalRadiusMeters * 2)) throw new HttpsError('failed-precondition', 'You must be at the pickup point to start the ride.', { reason: 'not_at_pickup' });
        const secret = ss.data();
        if (!secret || !secret.otp) throw new HttpsError('failed-precondition', 'This ride has no ride code. Contact support.');
        const attempts = (secret.attempts ?? { count: 0 }) as { count?: number; lockedUntilMs?: number };
        if (Number(attempts.lockedUntilMs ?? 0) > nowMs) throw new HttpsError('resource-exhausted', `Too many wrong codes. Try again in ${Math.ceil((Number(attempts.lockedUntilMs) - nowMs) / 60000)} minutes.`);
        if (!safeEqual(otp, String(secret.otp))) {
          const count = Number(attempts.count ?? 0) + 1;
          const locked = count >= OTP_MAX_ATTEMPTS;
          tx.update(ss.ref, { attempts: locked ? { count: 0, lockedUntilMs: nowMs + OTP_LOCK_MS } : { count } });
          wrongOtp = { remaining: Math.max(0, OTP_MAX_ATTEMPTS - count), locked };
          return { status: ride.status, otpOk: false };
        }
        // The code is single use: a replay finds the ride already in progress and the secret spent.
        tx.update(ss.ref, { otp: '', usedAtMs: nowMs, attempts: { count: 0 } });
        tx.update(rs.ref, { ...base, status: 'in_progress', statusAtMs: nowMs, startedAtMs: nowMs, boardingVerifiedAtMs: nowMs });
        tx.set(db.doc(`${COL.rideTracking}/${rideId}`), { trackedMeters: 0, pings: 0, lastLat: fix!.lat, lastLng: fix!.lng, lastAtMs: nowMs, startedAtMs: nowMs });
        tx.set(live, { status: 'in_progress' }, { merge: true });
        rideEventTx(tx, rideId, { type: 'status', from: ride.status, to: 'in_progress', actorId: uid, actorRole: 'driver' });
        notifyCustomer = { id: ride.customerId, title: 'Ride started', body: 'Your trip has started. Have a safe ride.' };
        return { status: 'in_progress', otpOk: true };
      }
      case 'complete': {
        to('completed');
        const cfg = validateFareConfig(ride.fare.config);
        const trackedMeters = ts.exists ? Number(ts.data()!.trackedMeters ?? 0) : null;
        const resolved = resolveFinalDistance(cfg, ride.route.distanceMeters, trackedMeters && ts.data()!.pings >= 3 ? trackedMeters : null);
        const startedAt = Number(ride.startedAtMs ?? nowMs);
        const arrivedAt = Number(ride.arrivedAtMs ?? startedAt);
        // Waiting is the time between arrival and boarding; ride time is everything after boarding. The engine bills waiting once.
        const breakdown = calculateFare(cfg, { distanceMeters: resolved.meters, rideSeconds: Math.max(0, (nowMs - arrivedAt) / 1000), waitingSeconds: Math.max(0, (startedAt - arrivedAt) / 1000), includePickup: true }, startedAt, ride.zone.timezone);
        const method = ride.paymentMethod as string;
        tx.update(rs.ref, {
          ...base, status: 'completed', statusAtMs: nowMs, completedAtMs: nowMs, endedAtMs: nowMs, paymentStatus: method === 'cash' ? 'cash_due' : 'payment_due',
          final: { totalPaise: breakdown.totalPaise, breakdown, distanceMeters: resolved.meters, basis: resolved.basis, quotedMeters: ride.route.distanceMeters, trackedMeters, fareVersion: ride.fare.version },
        });
        tx.set(db.doc(`${COL.settlements}/${rideId}`), { rideId, driverId: uid, customerId: ride.customerId, zoneId: ride.zone.id, method, totalPaise: breakdown.totalPaise, commissionPaise: breakdown.commissionPaise, driverEarningsPaise: breakdown.driverEarningsPaise, platformFeePaise: breakdown.platformFeePaise, taxPaise: breakdown.taxPaise, status: 'pending_payment', createdAtMs: nowMs });
        releaseDriverTx(tx, uid, rideId, ds.data());
        tx.delete(live);
        tx.set(db.doc(`lt_customer_state/${ride.customerId}`), { activeRideId: '' }, { merge: true });
        tx.set(db.doc(`${COL.driverState}/${uid}`), { completedRides: FieldValue.increment(1) }, { merge: true });
        rideEventTx(tx, rideId, { type: 'status', from: ride.status, to: 'completed', actorId: uid, actorRole: 'driver', meta: { totalPaise: breakdown.totalPaise, distanceBasis: resolved.basis } });
        auditInTx(tx, { action: 'lt_ride_completed', entity: 'lt_ride', entityId: rideId, performedBy: uid, performedByName: str(profile.name, 80), role: 'driver', next: { totalPaise: breakdown.totalPaise, distanceMeters: resolved.meters, basis: resolved.basis, fareVersion: ride.fare.version } });
        notifyCustomer = { id: ride.customerId, title: 'Ride completed', body: `Your fare is ${formatPaise(breakdown.totalPaise)}. Thanks for riding with us.` };
        return { status: 'completed', totalPaise: breakdown.totalPaise };
      }
      case 'release': {
        to('searching');
        if (Number(ride.reassignments ?? 0) >= MAX_REASSIGNMENTS) throw new HttpsError('failed-precondition', 'This ride has been handed back too many times. Contact the office.');
        tx.update(rs.ref, { ...base, status: 'searching', statusAtMs: nowMs, searchStartedAtMs: nowMs, radiusStep: 0, driverId: '', driverName: '', driverPhone: '', driverVehicle: null, assignedAtMs: null, arrivedAtMs: null, reassignments: Number(ride.reassignments ?? 0) + 1, currentOfferId: '' });
        tx.delete(live);
        tx.set(ss.ref, { otp: '', attempts: { count: 0 } }, { merge: true });
        releaseDriverTx(tx, uid, rideId, ds.data());
        rideEventTx(tx, rideId, { type: 'driver_released', from: ride.status, to: 'searching', actorId: uid, actorRole: 'driver', meta: { reason: str(d.reason, 120) } });
        notifyCustomer = { id: ride.customerId, title: 'Finding you another driver', body: 'Your driver could not make it. We are finding another driver for you.' };
        reDispatch = true;
        return { status: 'searching' };
      }
      case 'no_show': {
        to('cancelled');
        if (nowMs - Number(ride.arrivedAtMs ?? nowMs) < NO_SHOW_WAIT_MS) throw new HttpsError('failed-precondition', 'Please wait at least 5 minutes at the pickup before marking a no-show.');
        const cfg = validateFareConfig(ride.fare.config);
        const fee = cancellationFeePaise(cfg, { status: ride.status, assignedAtMs: Number(ride.assignedAtMs ?? nowMs) }, nowMs);
        tx.update(rs.ref, { ...base, status: 'cancelled', statusAtMs: nowMs, endedAtMs: nowMs, cancelledAtMs: nowMs, cancelledBy: 'driver', cancelReason: 'Customer did not arrive', cancellationFeePaise: fee, paymentStatus: fee > 0 ? 'cancellation_fee_due' : 'none' });
        tx.delete(live);
        releaseDriverTx(tx, uid, rideId, ds.data());
        tx.set(db.doc(`lt_customer_state/${ride.customerId}`), { activeRideId: '' }, { merge: true });
        rideEventTx(tx, rideId, { type: 'status', from: ride.status, to: 'cancelled', actorId: uid, actorRole: 'driver', meta: { noShow: true, feePaise: fee } });
        notifyCustomer = { id: ride.customerId, title: 'Ride cancelled', body: fee > 0 ? 'Your driver waited at the pickup and the ride was cancelled. A cancellation fee applies.' : 'Your driver waited at the pickup and the ride was cancelled.' };
        return { status: 'cancelled', feePaise: fee };
      }
      case 'collect_cash': {
        if (ride.status !== 'completed' || ride.paymentMethod !== 'cash') throw new HttpsError('failed-precondition', 'There is no cash to collect for this ride.');
        if (ride.paymentStatus === 'cash_collected') return { status: 'completed', alreadyCollected: true };
        if (Number(d.amountPaise) !== Number(ride.final?.totalPaise)) throw new HttpsError('invalid-argument', 'The amount collected must equal the fare shown.', { dueRupees: Number(ride.final?.totalPaise) / 100 });
        tx.update(rs.ref, { ...base, paymentStatus: 'cash_collected', paidAtMs: nowMs });
        tx.set(db.doc(`${COL.payments}/cash_${rideId}`), { rideId, customerId: ride.customerId, driverId: uid, method: 'cash', amountPaise: ride.final.totalPaise, currency: 'INR', status: 'collected', recordedBy: uid, createdAtMs: nowMs, createdAt: FieldValue.serverTimestamp() });
        tx.set(db.doc(`${COL.settlements}/${rideId}`), { status: 'cash_collected', cashCollectedPaise: ride.final.totalPaise, collectedAtMs: nowMs }, { merge: true });
        rideEventTx(tx, rideId, { type: 'payment', actorId: uid, actorRole: 'driver', meta: { method: 'cash', amountPaise: ride.final.totalPaise } });
        auditInTx(tx, { action: 'lt_cash_collected', entity: 'lt_ride', entityId: rideId, performedBy: uid, role: 'driver', next: { amountPaise: ride.final.totalPaise } });
        return { status: 'completed', collected: true };
      }
    }
  });
  const n = notifyCustomer as { id: string; title: string; body: string } | null;
  if (n) await ltNotify(n.id, 'customer', n.title, n.body, rideId);
  if (reDispatch) await advanceDispatch(rideId).catch(() => null);
  const w = wrongOtp as { remaining: number; locked: boolean } | null;
  if (w) throw new HttpsError('permission-denied', w.locked ? 'Too many wrong codes. Wait 10 minutes or ask the customer to check the code.' : `That ride code is not correct. ${w.remaining} attempt${w.remaining === 1 ? '' : 's'} left.`, { reason: 'wrong_otp', remaining: w.remaining, locked: w.locked });
  return result;
});

void approved;
