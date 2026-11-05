// What the redesigned Driver website and app rely on, checked against the emulators (demo project — nothing here can reach
// production):
//   • settings/operations is readable by a signed-in driver and not writable (the screens read the start window from it);
//   • the first trip step refuses a check-in earlier than the configured window, with the message the screens show;
//   • a bid is submitted and withdrawn with the exact payloads the screens send, and a repeat withdrawal is refused;
//   • duplicate submissions of a trip step change nothing.
//   npm run test:e2e   (runs together with the other emulator suites)
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, rest, clientPatch, inHours, place, rid, bookAs, booking, market } = H;

const U = { admin: 'uiAdmin', cust: 'uiCust', owner: 'uiOwner', stranger: 'uiStranger' };
let stub;

const fix = (over = {}) => ({ lat: 10.0104, lng: 77.4768, accuracy: 20, capturedAt: Date.now(), ...over });

async function approvedBooking(over = {}) {
  const b = await bookAs(U.cust, over);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.equal((await call(U.admin, 'approveBooking', { bookingId: b.requestId })).ok, true);
  return b.requestId;
}

test.before(async () => {
  stub = await H.startRoutingStub();
  const fare = { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 };
  await db.doc('vehicle_categories/sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', seatingCapacity: 4, displayOrder: 1, fare });
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'UI Admin' });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Priya Raman', phone: '+919876543210', email: 'p@example.com', walletBalance: 0 });
  await db.doc('vehicles/vehUiOwner').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN03EF9003', seatingCapacity: 4, make: 'Maruti', model: 'Dzire', assignedDriverId: U.owner });
  await db.doc(`drivers/${U.owner}`).set({ status: 'Approved', name: 'Selvam', phone: '+919791234569', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: 'vehUiOwner', assignedVehicleNumber: 'TN03EF9003', rating: 4.2 });
  await db.doc(`drivers/${U.stranger}`).set({ status: 'Approved', name: 'Other', phone: '+919791234500', presenceStatus: 'Online', fleetStatus: 'Active' });
  const r = await call(U.admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Emulator setup' });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test.after(async () => { await new Promise((r) => stub.close(r)); });

test('UI1. a signed-in driver reads the operating limits but cannot change them', async () => {
  await db.doc('settings/operations').set({ tripStartWindowMinutes: 120, pickupRadiusKm: 3 });
  const read = await rest(U.owner, 'settings/operations');
  assert.equal(read.status, 200);
  assert.equal(Number(read.body.fields.tripStartWindowMinutes.integerValue), 120);
  const write = await clientPatch(U.owner, 'settings/operations', { tripStartWindowMinutes: 15 });
  assert.equal(write.ok, false, 'a driver must not be able to write the operating limits');
  assert.equal(write.status === 403 || write.status === 401, true, `status ${write.status}`);
});

test('UI2. the first trip step opens only inside the configured window, and says when', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(20) });
  assert.equal((await call(U.admin, 'assignDriver', { bookingId: id, driverId: U.owner })).ok, true);

  await db.doc('settings/operations').set({ tripStartWindowMinutes: 120, pickupRadiusKm: 3 });
  const early = await call(U.owner, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location: fix(), requestId: rid('early') });
  assert.equal(early.ok, false);
  assert.equal(early.details?.code, 'too-early');
  assert.match(early.message, /can be started from/);
  assert.equal((await booking(id)).tripSubStatus === 'Reached Pickup', false, 'nothing is recorded by a refused step');

  // A wider window (25 h) lets the same trip through the time gate; the pickup coordinates then decide.
  await db.doc('settings/operations').set({ tripStartWindowMinutes: 1500, pickupRadiusKm: 3 });
  const requestId = rid('reach');
  const ok = await call(U.owner, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location: fix(), requestId });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal((await booking(id)).tripSubStatus, 'Reached Pickup');

  // The same request sent again (a double tap, a retry) changes nothing.
  const again = await call(U.owner, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location: fix(), requestId });
  assert.equal(again.ok, true);
  assert.equal(again.data.duplicate, true);
});

test('UI3. a bid goes in with the screens\' payload, is withdrawn by its id, and cannot be withdrawn twice', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(90) });
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review' })).ok, true);

  // Accepting a bid-only duty is refused with the code the screens use to offer a bid instead.
  const claim = await call(U.owner, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(claim.ok, false);
  assert.equal(claim.details?.code, 'bid-only');

  const bid = await call(U.owner, 'submitMarketplaceBid', { tripId: id, rate: 1700, note: 'Can do it' });
  assert.equal(bid.ok, true, JSON.stringify(bid));
  const stored = (await db.doc(`marketplace_trips/${id}/bids/driver_${U.owner}`).get()).data();
  assert.equal(stored.status, 'Pending Review');
  assert.equal(stored.vendorCounterRate, 1700);

  // Someone else cannot withdraw it; the owner can; a second withdrawal is refused.
  assert.equal((await call(U.stranger, 'withdrawMarketplaceBid', { tripId: id, bidId: `driver_${U.owner}` })).ok, false);
  const out = await call(U.owner, 'withdrawMarketplaceBid', { tripId: id, bidId: `driver_${U.owner}` });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal((await db.doc(`marketplace_trips/${id}/bids/driver_${U.owner}`).get()).data().status, 'Withdrawn');
  const twice = await call(U.owner, 'withdrawMarketplaceBid', { tripId: id, bidId: `driver_${U.owner}` });
  assert.equal(twice.ok, false);
  assert.equal((await market(id)).status, 'Open', 'with no bids left the duty reopens');
});

test('UI4. the photo check: a session and a challenge per photo for the assigned driver only; four photos are required to finish', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(30) });
  assert.equal((await call(U.admin, 'assignDriver', { bookingId: id, driverId: U.owner })).ok, true);

  const denied = await call(U.stranger, 'createCaptureSession', { bookingId: id, platform: 'web' });
  assert.equal(denied.ok, false, 'a driver the trip is not assigned to cannot start the photo check');

  const session = await call(U.owner, 'createCaptureSession', { bookingId: id, platform: 'web' });
  assert.equal(session.ok, true, JSON.stringify(session));
  assert.ok(session.data.sessionId);

  for (const slot of ['selfie', 'front', 'rear', 'interior']) {
    const c = await call(U.owner, 'getSlotChallenge', { sessionId: session.data.sessionId, slot });
    assert.equal(c.ok, true, `${slot}: ${JSON.stringify(c)}`);
    assert.equal(c.data.slot, slot);
    assert.ok(c.data.instruction && c.data.code && c.data.storagePath && c.data.expiresAtMs > Date.now());
  }
  assert.equal((await call(U.stranger, 'getSlotChallenge', { sessionId: session.data.sessionId, slot: 'front' })).ok, false);

  // Nothing was photographed, so the check cannot be completed — the screens only offer Submit after all four.
  const early = await call(U.owner, 'finalizeVehicleVerification', { sessionId: session.data.sessionId, odometerReading: 48210 });
  assert.equal(early.ok, false);
  const v = (await db.doc(`vehicle_verifications/${id}`).get()).data();
  assert.notEqual(v?.status, 'Submitted');
});
