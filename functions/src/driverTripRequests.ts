// A Vendor Driver may request (never directly claim) an Outstation Round Trip from the open
// marketplace; the request goes to its own vendor for approval, and approving it assigns the
// driver and their paired vehicle in the same transaction — vendorAssignDriver's own checks
// (eligibility, documents, schedule overlap) applied again at decision time, since the fleet's
// state may have moved on since the request was filed.
//
// driver_trip_requests/{id}: { bookingId, bookingCode, driverId, driverName, vendorId, vehicleId,
// vehicleNumber, status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled', requestedAt, decidedAt?,
// decidedBy?, reason? } + /events (audit-style trail, mirrors partnerLinks.ts).
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { awaitingFulfilment } from './domain/advanceBooking';
import { assertDriverEligible, assertScheduleFree, loadHeldDuties, loadScheduleConfig } from './eligibility';
import { assignableVehicle, docId } from './marketplace';
import { notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { approved, text } from './shared';

const label = (b: DocumentData, id: string) => text(b.bookingId) || id;

export const requestRoundTripDuty = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const bookingId = docId(request.data?.bookingId, 'booking');
  const ref = db.doc(`bookings/${bookingId}`);
  const market = db.doc(`marketplace_trips/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];

  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [driverSnap, snap, m, scheduleCfg] = await Promise.all([
      tx.get(db.doc(`drivers/${uid}`)), tx.get(ref), tx.get(market), loadScheduleConfig(tx),
    ]);
    if (!driverSnap.exists) throw new HttpsError('permission-denied', 'Only an approved driver can request a trip.');
    const driver = driverSnap.data()!;
    const vendorId = text(driver.vendorId);
    if (!vendorId) throw new HttpsError('permission-denied', 'Independent drivers take trips from the marketplace directly.', { code: 'not-fleet' });
    if (!approved(driver.status)) throw new HttpsError('permission-denied', 'Your driver account is not approved yet.');
    if (driver.fleetStatus === 'Suspended') throw new HttpsError('permission-denied', 'Your account is suspended.');
    if (!snap.exists || !m.exists) throw new HttpsError('failed-precondition', 'This trip is no longer available.', { code: 'taken' });
    const b = snap.data()!, offer = m.data()!;
    if (offer.status !== 'Open' || !awaitingFulfilment(b)) throw new HttpsError('failed-precondition', 'This trip is no longer available. Another partner has taken it or it was withdrawn.', { code: 'taken' });
    if (b.service !== 'Outstation' || b.tripType !== 'Round Trip') throw new HttpsError('failed-precondition', 'Only an Outstation Round Trip can be requested directly; other trips are assigned by your fleet.');
    if (b.fareVerified !== true) throw new HttpsError('failed-precondition', 'This trip is not ready to be taken yet.');
    const vehicleId = text(driver.assignedVehicleId);
    if (!vehicleId) throw new HttpsError('failed-precondition', 'Your fleet has not paired a vehicle with you yet.', { code: 'no-vehicle' });

    const existing = await tx.get(db.collection('driver_trip_requests').where('bookingId', '==', bookingId).where('status', '==', 'Pending'));
    if (!existing.empty) throw new HttpsError('failed-precondition', 'Another driver has already requested this trip. Wait for your fleet to decide, or pick a different one.', { code: 'taken' });

    const [driverHeld, vehicleHeld] = await Promise.all([loadHeldDuties(tx, 'assignedDriverId', uid), loadHeldDuties(tx, 'assignedVehicleId', vehicleId)]);
    assertDriverEligible(driver, b, scheduleCfg);
    const vehicle = await assignableVehicle(tx, vehicleId, vendorId, uid, b);
    assertScheduleFree(driverHeld, 'You', b, bookingId, scheduleCfg);
    assertScheduleFree(vehicleHeld, `Vehicle ${vehicle.number}`, b, bookingId, scheduleCfg);

    const stamp = FieldValue.serverTimestamp();
    const mine = label(b, bookingId);
    const reqRef = db.collection('driver_trip_requests').doc();
    tx.create(reqRef, {
      bookingId, bookingCode: mine, driverId: uid, driverName: text(driver.name), vendorId,
      vehicleId: vehicle.id, vehicleNumber: vehicle.number, status: 'Pending', requestedAt: stamp, updatedAt: stamp,
    });
    tx.create(reqRef.collection('events').doc(), { type: 'requested', actorId: uid, actorRole: 'driver', at: stamp });
    const toVendor: NotifyInput = {
      recipientType: 'vendor', recipientId: vendorId, category: 'approvals', severity: 'info', sound: 'general', event: 'driver_request',
      title: 'Driver requests a round trip', message: `${text(driver.name)} wants to take ${mine} in ${vehicle.number}.`,
      bookingId, bookingCode: mine, cta: { label: 'Review', page: 'driver-trip-requests' }, push: true, sentBy: uid,
    };
    pushes.push({ id: notifyInTx(tx, toVendor), input: toVendor });
    return { requestId: reqRef.id };
  });
  await pushAfterCommit(pushes);
  return { ok: true, requestId: out.requestId };
});

export const decideDriverTripRequest = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const requestId = docId(request.data?.requestId, 'request');
  const decision = request.data?.decision === 'reject' ? 'reject' as const : request.data?.decision === 'approve' ? 'approve' as const : null;
  if (!decision) throw new HttpsError('invalid-argument', 'Choose approve or reject.');
  const reason = text(request.data?.reason, 300);
  const reqRef = db.doc(`driver_trip_requests/${requestId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];

  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [vendorSnap, reqSnap] = await Promise.all([tx.get(db.doc(`vendors/${uid}`)), tx.get(reqRef)]);
    if (!vendorSnap.exists || !approved(vendorSnap.data()!.status)) throw new HttpsError('permission-denied', 'Only an approved vendor can decide this.');
    if (!reqSnap.exists) throw new HttpsError('not-found', 'Request not found.');
    const r = reqSnap.data()!;
    if (r.vendorId !== uid) throw new HttpsError('permission-denied', 'This request is not for your fleet.');
    if (r.status !== 'Pending') throw new HttpsError('failed-precondition', `This request was already ${String(r.status).toLowerCase()}.`);
    const bookingId = text(r.bookingId);
    const driverId = text(r.driverId);
    const ref = db.doc(`bookings/${bookingId}`);
    const market = db.doc(`marketplace_trips/${bookingId}`);
    const stamp = FieldValue.serverTimestamp();
    const vendorName = text(vendorSnap.data()!.companyName || vendorSnap.data()!.name);

    if (decision === 'reject') {
      tx.update(reqRef, { status: 'Rejected', decidedAt: stamp, decidedBy: uid, reason, updatedAt: stamp });
      tx.create(reqRef.collection('events').doc(), { type: 'rejected', actorId: uid, actorRole: 'vendor', reason, at: stamp });
      const toDriver: NotifyInput = {
        recipientType: 'driver', recipientId: driverId, category: 'approvals', severity: 'warning', sound: 'general',
        title: 'Round trip request declined', message: reason || `${vendorName} did not approve this request.`,
        bookingId, bookingCode: text(r.bookingCode), push: true, sentBy: uid,
      };
      pushes.push({ id: notifyInTx(tx, toDriver), input: toDriver });
      return { status: 'Rejected' as const };
    }

    // Approve: re-validate everything vendorAssignDriver validates — the booking may have moved on
    // (taken by another driver, cancelled) since the request was filed, and so may the fleet's own state.
    const [snap, m, driverSnap, verification, driverHeld, vehicleHeld, scheduleCfg] = await Promise.all([
      tx.get(ref), tx.get(market), tx.get(db.doc(`drivers/${driverId}`)), tx.get(db.doc(`vehicle_verifications/${bookingId}`)),
      loadHeldDuties(tx, 'assignedDriverId', driverId), loadHeldDuties(tx, 'assignedVehicleId', text(r.vehicleId)), loadScheduleConfig(tx),
    ]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (!m.exists || m.data()!.status !== 'Open' || !awaitingFulfilment(b)) {
      tx.update(reqRef, { status: 'Cancelled', decidedAt: stamp, decidedBy: uid, reason: 'Taken by another partner before this was approved.', updatedAt: stamp });
      throw new HttpsError('failed-precondition', 'This trip was taken by another partner before you approved it.', { code: 'taken' });
    }
    const driver = driverSnap.data();
    if (!driverSnap.exists || !driver || (driver.vendorId || '') !== uid) throw new HttpsError('failed-precondition', 'This driver is no longer in your fleet.');
    if (!approved(driver.status)) throw new HttpsError('failed-precondition', `${text(driver.name) || 'This driver'} is not approved by NESAM yet.`);
    if (driver.fleetStatus === 'Suspended') throw new HttpsError('failed-precondition', `${text(driver.name) || 'This driver'} is suspended in your fleet.`);
    assertDriverEligible(driver, b, scheduleCfg);
    const vehicle = await assignableVehicle(tx, text(r.vehicleId), uid, driverId, b);
    assertScheduleFree(driverHeld, text(driver.name) || 'This driver', b, bookingId, scheduleCfg);
    assertScheduleFree(vehicleHeld, vehicle.number ? `Vehicle ${vehicle.number}` : 'This vehicle', b, bookingId, scheduleCfg);

    const mine = label(b, bookingId);
    const newDriver = { id: driverId, name: text(driver.name), vehicleId: vehicle.id, vehicleNumber: vehicle.number, vendorId: uid };
    tx.update(ref, {
      status: 'Assigned', tripStage: 'Assigned', tripSubStatus: 'Not Started',
      assignedDriverId: driverId, assignedDriverName: text(driver.name), driver: text(driver.name), driverPhone: text(driver.phone),
      assignedVehicleId: vehicle.id, assignedVehicleNumber: vehicle.number, assignedVendorId: uid, assignedVendorName: vendorName,
      fulfilmentRoute: 'driver', assignedAt: stamp,
      lastAssignment: { action: 'assign', by: uid, byName: vendorName, reason: 'Driver-requested round trip, approved', at: stamp },
      assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
    });
    tx.update(market, { status: 'Assigned', assignedDriverId: driverId, assignedDriverName: text(driver.name), acceptedAt: stamp, updatedAt: stamp });
    if (verification.exists && verification.data()!.driverId !== driverId) tx.update(verification.ref, { status: 'Superseded', supersededAt: stamp });
    tx.create(ref.collection('assignments').doc(), { action: 'assign', oldDriver: null, newDriver, changedBy: uid, changedByName: vendorName, reason: 'Driver-requested round trip, approved', at: stamp });
    tx.create(ref.collection('events').doc(), { type: 'driver_assigned', actorId: uid, actorRole: 'vendor', driverId, at: stamp });
    auditInTx(tx, { action: 'driver_assigned', entity: 'booking', entityId: bookingId, performedBy: uid, performedByName: vendorName, role: 'vendor', bookingId, previous: null, next: newDriver });
    tx.update(reqRef, { status: 'Approved', decidedAt: stamp, decidedBy: uid, updatedAt: stamp });
    tx.create(reqRef.collection('events').doc(), { type: 'approved', actorId: uid, actorRole: 'vendor', at: stamp });

    const toDriver: NotifyInput = {
      recipientType: 'driver', recipientId: driverId, category: 'bookings', severity: 'success', sound: 'new_booking', event: 'new_duty',
      title: 'Round trip request approved', message: `${mine} is yours — ${vehicle.number}. Take the vehicle photos before you head to the pickup.`,
      bookingId, bookingCode: mine, cta: { label: 'Open trip', page: 'trip', bookingId }, push: true, sentBy: uid,
    };
    pushes.push({ id: notifyInTx(tx, toDriver), input: toDriver });
    return { status: 'Approved' as const, driverId, driverName: text(driver.name) };
  });
  await pushAfterCommit(pushes);
  return { ok: true, status: out.status };
});
