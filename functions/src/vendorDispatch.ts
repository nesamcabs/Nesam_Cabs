// Vendor: assign one of its own approved drivers, in one of its own approved
// vehicles, to a booking the vendor holds (claimed from the marketplace, won by
// bid, or assigned directly by NESAM). The checks that used to rely on a direct
// client write (vendorDispatchOk) now run here, in one transaction, together with
// the ones a rule cannot do: vehicle seats, document validity through the pickup
// and driver / vehicle schedule overlap.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { sendCustomerMessage } from './customerComms';
import { tripSubStatusOf } from './domain/bookingFlow';
import { formatDateTime12, pickupInstant } from './domain/time';
import { assertDriverEligible, assertScheduleFree, loadHeldDuties, loadScheduleConfig } from './eligibility';
import { assignableVehicle, docId } from './marketplace';
import { notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { approved, text } from './shared';

const code = (b: FirebaseFirestore.DocumentData, id: string) => text(b.bookingId) || id;

export const vendorAssignDriver = onCall({ timeoutSeconds: 60 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const input = request.data ?? {};
  const bookingId = docId(input.bookingId, 'booking');
  const driverId = docId(input.driverId, 'driver');
  const vehicleId = docId(input.vehicleId, 'vehicle');
  const ref = db.doc(`bookings/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];

  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [vendorSnap, snap, driverSnap, verification, driverHeld, vehicleHeld, scheduleCfg] = await Promise.all([
      tx.get(db.doc(`vendors/${uid}`)), tx.get(ref), tx.get(db.doc(`drivers/${driverId}`)), tx.get(db.doc(`vehicle_verifications/${bookingId}`)),
      loadHeldDuties(tx, 'assignedDriverId', driverId), loadHeldDuties(tx, 'assignedVehicleId', vehicleId), loadScheduleConfig(tx),
    ]);
    if (!vendorSnap.exists || !approved(vendorSnap.data()!.status)) throw new HttpsError('permission-denied', 'Only an approved vendor can assign drivers.');
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    // The booking must already be this vendor's. This is also what stops a vendor assigning a trip it only saw.
    if (b.assignedVendorId !== uid) throw new HttpsError('permission-denied', 'This booking is not assigned to your fleet.');
    if (!['Confirmed', 'Assigned'].includes(b.status)) throw new HttpsError('failed-precondition', `A ${String(b.status).toLowerCase()} booking cannot be assigned.`);
    if (tripSubStatusOf(b) !== 'Not Started') throw new HttpsError('failed-precondition', 'The trip has already started — the driver can no longer be changed.');
    if (b.assignedDriverId === driverId && b.assignedVehicleId === vehicleId) throw new HttpsError('failed-precondition', 'That driver and vehicle are already assigned.');

    const driver = driverSnap.data();
    if (!driverSnap.exists || !driver || (driver.vendorId || '') !== uid) throw new HttpsError('failed-precondition', 'Choose a driver from your own fleet.');
    if (!approved(driver.status)) throw new HttpsError('failed-precondition', `${text(driver.name) || 'This driver'} is not approved by NESAM yet.`);
    if (driver.fleetStatus === 'Suspended') throw new HttpsError('failed-precondition', `${text(driver.name) || 'This driver'} is suspended in your fleet.`);
    const when = pickupInstant(b);
    assertDriverEligible(driver, b, scheduleCfg);
    const vehicle = await assignableVehicle(tx, vehicleId, uid, driverId, b);
    assertScheduleFree(driverHeld, text(driver.name) || 'This driver', b, bookingId, scheduleCfg);
    assertScheduleFree(vehicleHeld, vehicle.number ? `Vehicle ${vehicle.number}` : 'This vehicle', b, bookingId, scheduleCfg);

    const stamp = FieldValue.serverTimestamp();
    const action = b.assignedDriverId ? 'reassign' : 'assign';
    const oldDriver = { id: text(b.assignedDriverId), name: text(b.assignedDriverName || b.driver), vehicleId: text(b.assignedVehicleId), vehicleNumber: text(b.assignedVehicleNumber), vendorId: uid };
    const newDriver = { id: driverId, name: text(driver.name), vehicleId: vehicle.id, vehicleNumber: vehicle.number, vendorId: uid };
    tx.update(ref, {
      status: 'Assigned', tripStage: 'Assigned', tripSubStatus: 'Not Started',
      assignedDriverId: driverId, assignedDriverName: text(driver.name), driver: text(driver.name), driverPhone: text(driver.phone),
      assignedVehicleId: vehicle.id, assignedVehicleNumber: vehicle.number,
      assignedAt: stamp, lastAssignment: { action, by: uid, byName: text(vendorSnap.data()!.companyName || vendorSnap.data()!.name), reason: '', at: Timestamp.now() },
      assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
    });
    // Evidence submitted by a previous driver does not carry over.
    if (verification.exists && verification.data()!.driverId !== driverId) tx.update(verification.ref, { status: 'Superseded', supersededAt: stamp });
    tx.create(ref.collection('assignments').doc(), { action, oldDriver: oldDriver.id ? oldDriver : null, newDriver, changedBy: uid, changedByName: text(vendorSnap.data()!.companyName || vendorSnap.data()!.name), reason: '', at: stamp });
    tx.create(ref.collection('events').doc(), { type: action === 'assign' ? 'driver_assigned' : 'driver_reassigned', actorId: uid, actorRole: 'vendor', driverId, oldDriverId: oldDriver.id, at: stamp });
    auditInTx(tx, { action: action === 'assign' ? 'driver_assigned' : 'driver_reassigned', entity: 'booking', entityId: bookingId, performedBy: uid, performedByName: text(vendorSnap.data()!.companyName || vendorSnap.data()!.name), role: 'vendor', bookingId, previous: oldDriver.id ? oldDriver : null, next: newDriver });
    const label = code(b, bookingId);
    const toDriver: NotifyInput = {
      recipientType: 'driver', recipientId: driverId, category: 'bookings', severity: 'info', sound: 'new_booking', title: 'Trip assigned to you',
      message: `${text(b.pickup)} → ${text(b.drop)}${when ? ` · ${formatDateTime12(when)}` : ''} (${label}) · ${vehicle.number}`,
      bookingId, bookingCode: label, cta: { label: 'Open trip', page: 'trip', bookingId }, push: true, sentBy: uid,
    };
    pushes.push({ id: notifyInTx(tx, toDriver), input: toDriver });
    if (text(b.customerId)) {
      const toCustomer: NotifyInput = {
        recipientType: 'customer', brand: b.brand, recipientId: text(b.customerId), category: 'trips', severity: 'success', sound: 'approval',
        title: action === 'assign' ? 'Driver assigned' : 'Your driver has changed',
        message: `${text(driver.name)} (${vehicle.number}) will pick you up${when ? ` at ${formatDateTime12(when)}` : ''}. Share your boarding OTP only at the pickup.`,
        bookingId, bookingCode: label, cta: { label: 'Open trip', page: 'trips', bookingId }, push: true, sentBy: uid,
      };
      pushes.push({ id: notifyInTx(tx, toCustomer), input: toCustomer });
    }
    if (oldDriver.id && oldDriver.id !== driverId) {
      const gone: NotifyInput = { recipientType: 'driver', recipientId: oldDriver.id, category: 'trips', severity: 'warning', sound: 'general', title: 'Trip reassigned', message: `Booking ${label} was reassigned to another driver.`, bookingId, bookingCode: label, push: true, sentBy: uid };
      pushes.push({ id: notifyInTx(tx, gone), input: gone });
    }
    return { action, booking: { ...b, assignedDriverName: text(driver.name), assignedVehicleNumber: vehicle.number }, driverName: text(driver.name) };
  });
  await pushAfterCommit(pushes);
  await sendCustomerMessage(bookingId, out.booking, 'driver_assigned').catch((err) => console.warn('customer message failed', err));
  return { ok: true, action: out.action, driverName: out.driverName };
});
