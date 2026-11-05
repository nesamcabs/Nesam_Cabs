// Local Taxi customer functions (serviceability, quotes, booking, cancellation, rating) and staff ride controls
// (manual dispatch, cancel). The customer never sends a price: a quote is computed here from the road route and the
// zone's active fare version, stored with an expiry, and a booking is only accepted against an unexpired quote that
// belongs to the same signed-in customer.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentData } from 'firebase-admin/firestore';
import { db } from '../admin';
import { auditInTx } from '../audit';
import { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, configured } from '../payments';
import { GeoPlace } from '../domain/types';
import { requirePermission, routeFor } from '../shared';
import { calculateFare, cancellationFeePaise, validateFareConfig } from './fare';
import { haversineMeters } from './geo';
import { COL, Zone, activeZoneAt, actorName, cleanId, placeOf, requestId, resolveFare, str, zoneForTrip } from './model';
import { advanceDispatch, assignRide, ltNotify, releaseDriverTx, rideEventTx, rideRef } from './dispatch';
import { transitionProblem } from './states';

export const FARE_POLICY = {
  estimate: 'This is an estimate based on the road route and expected travel time. The final fare is calculated from the actual trip.',
  final: 'Your final fare uses the actual ride time and the tracked distance, never more than the distance cap below, plus any waiting after the free waiting time. A higher or lower final fare is possible; a minimum fare applies.',
  boundary: 'Pickup and drop must be inside the service area. The road route may briefly leave the area; that does not change the fare.',
} as const;

const asPlace = (p: { lat: number; lng: number; name: string; address: string }) => ({ id: 'lt', name: p.name, address: p.address, type: 'other', lat: p.lat, lng: p.lng }) as GeoPlace;

function onlineConfigured(): boolean {
  try { return configured(RAZORPAY_KEY_ID.value(), RAZORPAY_KEY_SECRET.value()); } catch { return false; }
}

const MIN_TRIP_M = 150;
const MAX_TRIP_M = 100_000;

/** Is Local Taxi available here? Safe for signed-out visitors: it reveals only the zone name. */
export const ltCheckServiceability = onCall(async (request) => {
  const d = (request.data ?? {}) as Record<string, any>;
  const pickup = placeOf(d.pickup, 'pickup location');
  const zone = await activeZoneAt(pickup);
  if (!zone) return { available: false, reason: 'pickup_outside_zone', message: 'Local Taxi is not available at this location yet.' };
  if (d.drop) {
    const drop = placeOf(d.drop, 'drop location');
    const z2 = await activeZoneAt(drop);
    if (!z2) return { available: false, zoneId: zone.id, zoneName: zone.name, reason: 'drop_outside_zone', message: 'Local Taxi is not available at the drop location.' };
    if (z2.id !== zone.id) return { available: false, zoneId: zone.id, zoneName: zone.name, reason: 'different_zones', message: 'Pickup and drop must be inside the same Local Taxi service area.' };
  }
  return { available: true, zoneId: zone.id, zoneName: zone.name };
});

async function driverSupply(zone: Zone, categoryId: string, pickup: { lat: number; lng: number }, nowMs: number) {
  const snap = await db.collection(COL.driverState).where('zoneIds', 'array-contains', zone.id).where('online', '==', true).where('available', '==', true).limit(300).get();
  let count = 0;
  let nearest = Infinity;
  for (const s of snap.docs) {
    const v = s.data();
    if (v.activeRideId || !(v.categoryIds ?? []).includes(categoryId) || !v.location || nowMs - Number(v.location.atMs) > zone.dispatch.locationMaxAgeSeconds * 1000) continue;
    const dist = haversineMeters({ lat: v.location.lat, lng: v.location.lng }, pickup);
    if (dist > zone.dispatch.radiusMaxMeters) continue;
    count++;
    nearest = Math.min(nearest, dist);
  }
  return { count, etaMinutes: count ? Math.max(2, Math.round(nearest / 1000 / 20 * 60)) : null };
}

/** One priced quote per vehicle category that has an active fare in the zone. Each quote expires. */
export const ltGetQuotes = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const d = (request.data ?? {}) as Record<string, any>;
  const pickup = placeOf(d.pickup, 'pickup location');
  const drop = placeOf(d.drop, 'drop location');
  const zone = await zoneForTrip(pickup, drop);
  if (haversineMeters(pickup, drop) < MIN_TRIP_M) throw new HttpsError('invalid-argument', 'Pickup and drop are too close together.');
  const route = await routeFor(asPlace(pickup), asPlace(drop));
  const distanceMeters = Math.round(route.distanceKm * 1000);
  const durationSeconds = Math.round(route.durationMin * 60);
  if (distanceMeters > MAX_TRIP_M) throw new HttpsError('failed-precondition', 'This trip is too long for Local Taxi.');
  const nowMs = Date.now();
  const expiresAtMs = nowMs + zone.dispatch.quoteTtlSeconds * 1000;
  const cats = await Promise.all(zone.categoryIds.map((id) => db.doc(`vehicle_categories/${id}`).get()));
  const quotes: Record<string, unknown>[] = [];
  const batch = db.batch();
  for (const cat of cats) {
    if (!cat.exists || String(cat.data()!.status ?? 'Active') !== 'Active') continue;
    const fare = await resolveFare(zone.id, cat.id, nowMs);
    if (!fare) continue;
    const breakdown = calculateFare(fare.config, { distanceMeters, rideSeconds: durationSeconds, waitingSeconds: 0, includePickup: true }, nowMs, zone.timezone);
    const supply = await driverSupply(zone, cat.id, pickup, nowMs);
    const ref = db.collection(COL.quotes).doc();
    const doc = {
      customerId: uid, zoneId: zone.id, boundaryVersion: zone.boundaryVersion, policyVersion: zone.policyVersion, categoryId: cat.id, categoryName: str(cat.data()!.name, 60), pickup, drop,
      distanceMeters, durationSeconds, routeEstimated: route.estimated, fareId: fare.id, fareVersion: fare.version, sampleFare: fare.sample, breakdown, totalPaise: breakdown.totalPaise,
      expiresAtMs, used: false, createdAtMs: nowMs, createdAt: FieldValue.serverTimestamp(),
    };
    batch.set(ref, doc);
    quotes.push({
      quoteId: ref.id, categoryId: cat.id, categoryName: doc.categoryName, seats: cat.data()!.seatingCapacity ?? null, imageUrl: cat.data()!.imageUrl ?? '', totalPaise: breakdown.totalPaise, lines: breakdown.lines,
      expiresAtMs, available: supply.count > 0, availableDrivers: supply.count, etaMinutes: supply.etaMinutes, sampleFare: fare.sample, distanceCapMeters: Math.round(distanceMeters * fare.config.maxDistanceOverQuoteBps / 10000),
      cancellationFeePaise: fare.config.cancellation.feePaise, cancellationGraceSeconds: fare.config.cancellation.graceSeconds,
    });
  }
  if (!quotes.length) throw new HttpsError('failed-precondition', 'No vehicle is bookable in this area right now.', { reason: 'no_fares' });
  await batch.commit();
  return {
    zone: { id: zone.id, name: zone.name }, distanceMeters, durationSeconds, routeEstimated: route.estimated, quotes, policy: FARE_POLICY,
    payment: { cash: zone.cashEnabled, online: onlineConfigured() },
  };
});

/** Books a ride from a quote. Idempotent on requestId (the ride id): a retry returns the same ride. */
export const ltCreateRide = onCall({ secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET] }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const d = (request.data ?? {}) as Record<string, any>;
  const rideId = requestId(d.requestId);
  const quoteId = cleanId(d.quoteId, 'quote');
  const method = d.paymentMethod === 'online' ? 'online' : d.paymentMethod === 'cash' ? 'cash' : '';
  if (!method) throw new HttpsError('invalid-argument', 'Choose how you will pay.');
  const nowMs = Date.now();

  const existing = await rideRef(rideId).get();
  if (existing.exists) {
    if (existing.data()!.customerId !== uid) throw new HttpsError('permission-denied', 'This request ID is already used.');
    return { rideId, status: existing.data()!.status, duplicate: true };
  }
  const q = await db.doc(`${COL.quotes}/${quoteId}`).get();
  const quote = q.data();
  if (!quote || quote.customerId !== uid) throw new HttpsError('permission-denied', 'This quote is not yours.');
  if (quote.used) throw new HttpsError('failed-precondition', 'This quote has already been used.', { reason: 'quote_used' });
  if (Number(quote.expiresAtMs) <= nowMs) throw new HttpsError('failed-precondition', 'This fare has expired. Please check the fare again.', { reason: 'quote_expired' });
  // Availability is re-checked now, not trusted from the quote: the zone may have been switched off or redrawn since.
  const zone = await zoneForTrip(quote.pickup, quote.drop);
  if (zone.id !== quote.zoneId) throw new HttpsError('failed-precondition', 'The service area changed. Please check the fare again.', { reason: 'quote_expired' });
  if (!zone.categoryIds.includes(quote.categoryId)) throw new HttpsError('failed-precondition', 'This vehicle type is no longer available here.', { reason: 'category_unavailable' });
  if (method === 'cash' && !zone.cashEnabled) throw new HttpsError('failed-precondition', 'Cash payment is not available in this area.', { reason: 'cash_disabled' });
  if (method === 'online' && !onlineConfigured()) throw new HttpsError('failed-precondition', 'Online payment is not available right now.', { reason: 'online_unavailable' });
  const fareDoc = await db.doc(`${COL.fares}/${quote.fareId}`).get();
  if (!fareDoc.exists) throw new HttpsError('failed-precondition', 'This fare is no longer available. Please check the fare again.', { reason: 'quote_expired' });
  const config = validateFareConfig(fareDoc.data()!.config);
  const customer = await db.doc(`customers/${uid}`).get();
  if (customer.exists && ['Blocked', 'Suspended'].includes(String(customer.data()!.status ?? ''))) throw new HttpsError('permission-denied', 'Your account cannot book rides right now.');

  await db.runTransaction(async (tx) => {
    const [rs, qs, cs] = await Promise.all([tx.get(rideRef(rideId)), tx.get(q.ref), tx.get(db.doc(`lt_customer_state/${uid}`))]);
    if (rs.exists) return;
    if (!qs.exists || qs.data()!.used) throw new HttpsError('failed-precondition', 'This quote has already been used.', { reason: 'quote_used' });
    const active = String(cs.data()?.activeRideId ?? '');
    if (active) {
      const a = await tx.get(rideRef(active));
      if (a.exists && !['completed', 'cancelled', 'expired', 'no_driver_available'].includes(a.data()!.status)) throw new HttpsError('failed-precondition', 'You already have a Local Taxi ride in progress.', { reason: 'active_ride', rideId: active });
    }
    tx.create(rideRef(rideId), {
      customerId: uid, customerName: str(customer.data()?.name, 80) || 'Customer', quoteId, status: 'searching', statusAtMs: nowMs, searchStartedAtMs: nowMs, radiusStep: 0,
      zone: { id: zone.id, name: zone.name, boundaryVersion: zone.boundaryVersion, policyVersion: zone.policyVersion, timezone: zone.timezone, dispatch: zone.dispatch, cashEnabled: zone.cashEnabled },
      categoryId: quote.categoryId, categoryName: quote.categoryName, pickup: quote.pickup, drop: quote.drop,
      route: { distanceMeters: quote.distanceMeters, durationSeconds: quote.durationSeconds, estimated: quote.routeEstimated === true },
      fare: { fareId: quote.fareId, version: quote.fareVersion, config, sample: quote.sampleFare === true },
      estimate: { totalPaise: quote.totalPaise, driverEarningsPaise: quote.breakdown.driverEarningsPaise, breakdown: quote.breakdown },
      paymentMethod: method, paymentStatus: 'unpaid', currentOfferId: '', offeredDriverIds: [], reassignments: 0, version: 1, createdAtMs: nowMs,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(qs.ref, { used: true, rideId });
    tx.set(db.doc(`lt_customer_state/${uid}`), { activeRideId: rideId }, { merge: true });
    rideEventTx(tx, rideId, { type: 'status', to: 'requested', actorId: uid, actorRole: 'customer' });
    rideEventTx(tx, rideId, { type: 'status', from: 'requested', to: 'searching', actorId: 'system', actorRole: 'system' });
    auditInTx(tx, { action: 'lt_ride_requested', entity: 'lt_ride', entityId: rideId, performedBy: uid, role: 'customer', next: { zoneId: zone.id, categoryId: quote.categoryId, totalPaise: quote.totalPaise, method, fareVersion: quote.fareVersion, boundaryVersion: zone.boundaryVersion } });
  });
  await advanceDispatch(rideId).catch((e) => console.warn('[local taxi] first dispatch failed', e instanceof Error ? e.message : e));
  const after = await rideRef(rideId).get();
  return { rideId, status: after.data()?.status ?? 'searching', duplicate: false };
});

// ── Cancellation ───────────────────────────────────────────────────────────────────────────────────────────────
async function cancelRideCore(p: { rideId: string; actor: 'customer' | 'admin'; actorId: string; actorName?: string; reason: string; ackFeePaise?: number }) {
  let driverId = '';
  let fee = 0;
  let customerId = '';
  await db.runTransaction(async (tx) => {
    driverId = '';
    const rs = await tx.get(rideRef(p.rideId));
    const ride = rs.data();
    if (!ride) throw new HttpsError('not-found', 'This ride does not exist.');
    if (p.actor === 'customer' && ride.customerId !== p.actorId) throw new HttpsError('permission-denied', 'This ride is not yours.');
    const problem = transitionProblem(ride.status, 'cancelled', p.actor);
    if (problem) throw new HttpsError('failed-precondition', ride.status === 'in_progress' ? 'A ride in progress cannot be cancelled. Ask your driver to end the trip.' : problem);
    const cfg = validateFareConfig(ride.fare.config);
    fee = p.actor === 'admin' ? 0 : cancellationFeePaise(cfg, { status: ride.status, assignedAtMs: typeof ride.assignedAtMs === 'number' ? ride.assignedAtMs : null }, Date.now());
    if (p.actor === 'customer' && fee > 0 && p.ackFeePaise !== fee) throw new HttpsError('failed-precondition', 'CANCELLATION_FEE', { feePaise: fee });
    driverId = String(ride.driverId ?? '');
    customerId = ride.customerId;
    const ds = driverId ? await tx.get(db.doc(`${COL.driverState}/${driverId}`)) : null;
    const offer = ride.currentOfferId ? await tx.get(db.doc(`${COL.offers}/${ride.currentOfferId}`)) : null;
    const now = Date.now();
    tx.update(rs.ref, {
      status: 'cancelled', statusAtMs: now, endedAtMs: now, cancelledAtMs: now, cancelledBy: p.actor, cancelReason: str(p.reason, 300), cancellationFeePaise: fee,
      paymentStatus: fee > 0 ? 'cancellation_fee_due' : 'none', currentOfferId: '', updatedAt: FieldValue.serverTimestamp(), version: FieldValue.increment(1),
    });
    if (offer?.exists && offer.data()!.status === 'pending') tx.update(offer.ref, { status: 'cancelled', closedAtMs: now });
    if (driverId) { releaseDriverTx(tx, driverId, p.rideId, ds?.data()); tx.delete(db.doc(`${COL.rideLive}/${p.rideId}`)); }
    tx.set(db.doc(`lt_customer_state/${ride.customerId}`), { activeRideId: '' }, { merge: true });
    rideEventTx(tx, p.rideId, { type: 'status', from: ride.status, to: 'cancelled', actorId: p.actorId, actorRole: p.actor, meta: { feePaise: fee, reason: str(p.reason, 120) } });
    auditInTx(tx, { action: 'lt_ride_cancelled', entity: 'lt_ride', entityId: p.rideId, performedBy: p.actorId, performedByName: p.actorName, role: p.actor === 'admin' ? 'admin' : 'customer', previous: { status: ride.status }, next: { status: 'cancelled', feePaise: fee }, reason: str(p.reason, 300) });
  });
  if (driverId) await ltNotify(driverId, 'driver', 'Ride cancelled', 'The customer cancelled this ride. You are available for new rides.', p.rideId, `lt_cancel_${p.rideId}`);
  return { feePaise: fee, customerId };
}

/** What cancelling costs right now, shown before the customer confirms. */
export const ltCancellationQuote = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const rideId = cleanId(request.data?.rideId, 'ride');
  const ride = (await rideRef(rideId).get()).data();
  if (!ride || ride.customerId !== uid) throw new HttpsError('not-found', 'This ride does not exist.');
  const problem = transitionProblem(ride.status, 'cancelled', 'customer');
  const cfg = validateFareConfig(ride.fare.config);
  const feePaise = problem ? 0 : cancellationFeePaise(cfg, { status: ride.status, assignedAtMs: typeof ride.assignedAtMs === 'number' ? ride.assignedAtMs : null }, Date.now());
  return { canCancel: !problem, message: problem, feePaise, graceSeconds: cfg.cancellation.graceSeconds };
});

export const ltCancelRide = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const rideId = cleanId(request.data?.rideId, 'ride');
  const ack = typeof request.data?.acceptFeePaise === 'number' ? Math.round(request.data.acceptFeePaise) : 0;
  const r = await cancelRideCore({ rideId, actor: 'customer', actorId: uid, reason: str(request.data?.reason, 300) || 'Cancelled by customer', ackFeePaise: ack });
  return { cancelled: true, feePaise: r.feePaise };
});

export const ltAdminCancelRide = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  const rideId = cleanId(request.data?.rideId, 'ride');
  const reason = str(request.data?.reason, 300);
  if (reason.length < 3) throw new HttpsError('invalid-argument', 'Give a reason for the cancellation.');
  await cancelRideCore({ rideId, actor: 'admin', actorId: admin.uid, actorName: actorName(admin), reason });
  return { cancelled: true };
});

/** Manual dispatch: staff give a searching ride to an eligible driver (the same checks as a driver accepting). */
export const ltAssignRide = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  const rideId = cleanId(request.data?.rideId, 'ride');
  const driverId = cleanId(request.data?.driverId, 'driver');
  const r = await assignRide({ rideId, driverId, actor: 'admin', actorId: admin.uid });
  return { assigned: true, driverName: r.driverName };
});

// ── Reading and rating ───────────────────────────────────────────────────────────────────────────────────────────
function publicRide(id: string, d: DocumentData) {
  const t = (k: string) => (typeof d[k] === 'number' ? d[k] : null);
  return {
    id, status: d.status, statusAtMs: t('statusAtMs'), zoneName: d.zone?.name ?? '', categoryName: d.categoryName, pickup: d.pickup, drop: d.drop, route: d.route,
    estimate: { totalPaise: d.estimate?.totalPaise ?? 0, lines: d.estimate?.breakdown?.lines ?? [] }, final: d.final ? { totalPaise: d.final.totalPaise, lines: d.final.breakdown?.lines ?? [], distanceMeters: d.final.distanceMeters, basis: d.final.basis } : null,
    paymentMethod: d.paymentMethod, paymentStatus: d.paymentStatus, driverName: d.driverName ?? '', driverPhone: d.driverPhone ?? '', driverVehicle: d.driverVehicle ?? null,
    assignedAtMs: t('assignedAtMs'), arrivedAtMs: t('arrivedAtMs'), startedAtMs: t('startedAtMs'), completedAtMs: t('completedAtMs'), cancelledBy: d.cancelledBy ?? '', cancelReason: d.cancelReason ?? '',
    cancellationFeePaise: d.cancellationFeePaise ?? 0, rating: d.rating ?? null, createdAtMs: t('createdAtMs'),
  };
}

/** Resync / fallback read for the customer app (and a heartbeat that keeps a search moving). */
export const ltGetRide = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const rideId = cleanId(request.data?.rideId, 'ride');
  let snap = await rideRef(rideId).get();
  const ride = snap.data();
  if (!ride) throw new HttpsError('not-found', 'This ride does not exist.');
  if (ride.customerId !== uid && ride.driverId !== uid) throw new HttpsError('permission-denied', 'This ride is not yours.');
  if (ride.status === 'searching') { await advanceDispatch(rideId).catch(() => null); snap = await rideRef(rideId).get(); }
  const r = snap.data()!;
  const isCustomer = r.customerId === uid;
  const [secret, live] = isCustomer && ['assigned', 'driver_arriving', 'driver_arrived'].includes(r.status)
    ? await Promise.all([db.doc(`${COL.rideSecrets}/${rideId}`).get(), db.doc(`${COL.rideLive}/${rideId}`).get()]) : [null, null];
  return { ride: publicRide(rideId, r), otp: secret?.data()?.otp ?? null, driverLocation: live?.data()?.location ?? null, serverTimeMs: Date.now() };
});

export const ltRateRide = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const rideId = cleanId(request.data?.rideId, 'ride');
  const stars = request.data?.rating;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpsError('invalid-argument', 'Choose 1 to 5 stars.');
  const comment = str(request.data?.comment, 400);
  await db.runTransaction(async (tx) => {
    const rs = await tx.get(rideRef(rideId));
    const ride = rs.data();
    if (!ride || ride.customerId !== uid) throw new HttpsError('not-found', 'This ride does not exist.');
    if (ride.status !== 'completed') throw new HttpsError('failed-precondition', 'You can rate a ride after it is completed.');
    if (ride.rating) throw new HttpsError('already-exists', 'You have already rated this ride.');
    const ds = ride.driverId ? await tx.get(db.doc(`${COL.driverState}/${ride.driverId}`)) : null;
    tx.update(rs.ref, { rating: { stars, comment, atMs: Date.now() }, updatedAt: FieldValue.serverTimestamp() });
    if (ds?.exists) tx.update(ds.ref, { ratingSum: FieldValue.increment(stars), ratingCount: FieldValue.increment(1) });
    rideEventTx(tx, rideId, { type: 'rated', actorId: uid, actorRole: 'customer', meta: { stars } });
  });
  return { rated: true };
});

