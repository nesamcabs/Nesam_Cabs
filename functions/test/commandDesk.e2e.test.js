// Master Admin command desk, against the emulators: the office trip close, the lowest-bid award and the hourly offer schedule.
//   npm run build
//   npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json --project demo-nesam --only auth,firestore,functions \
//     "node test/runE2e.cjs test/commandDesk.e2e.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');
const H = require('./helpers.e2e');
const { db, TS, call, inHours, rid, bookAs, booking, market } = H;

const U = { admin: 'admCD', ops: 'admCDops', cust: 'custCD', vendorA: 'vendCDA', vendorB: 'vendCDB', driver: 'drvCD', rival: 'drvCDRival' };
let stub;

async function approvedBooking(over = {}) {
  const b = await bookAs(U.cust, over);
  assert.equal(b.ok, true, JSON.stringify(b));
  const a = await call(U.admin, 'approveBooking', { bookingId: b.requestId });
  assert.equal(a.ok, true, JSON.stringify(a));
  return b.requestId;
}

/** Assigns the driver and runs the trip as the driver up to "Trip Started" (status Ongoing). */
async function ongoingTrip() {
  const id = await approvedBooking({ scheduledAt: inHours(1) });
  const as = await call(U.admin, 'assignDriver', { bookingId: id, driverId: U.driver, vehicleId: 'vehCD', reason: 'Command desk test' });
  assert.equal(as.ok, true, JSON.stringify(as));
  const fix = { lat: 10.0104, lng: 77.4768, accuracy: 20, capturedAt: Date.now() };
  assert.equal((await call(U.driver, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location: fix, requestId: rid('r') })).ok, true);
  const otp = (await db.doc(`booking_secrets/${id}`).get()).data().otp;
  assert.equal((await call(U.driver, 'verifyBoarding', { bookingId: id, otp })).ok, true);
  await db.doc(`vehicle_verifications/${id}`).set({ driverId: U.driver, status: 'Submitted', odometerReading: 1000, riskLevel: 'low', submittedAt: TS.now() });
  const started = await call(U.driver, 'advanceTrip', { bookingId: id, to: 'Trip Started', location: fix, requestId: rid('s') });
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal((await booking(id)).status, 'Ongoing');
  return id;
}

test.before(async () => {
  stub = await H.startRoutingStub();
  const fare = { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 };
  await db.doc('vehicle_categories/sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', seatingCapacity: 4, displayOrder: 1, fare });
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Test Admin' });
  // A role-based admin with operations only (no finance): may not close a trip.
  await db.doc(`admins/${U.ops}`).set({ role: 'admin', status: 'active', staffRole: 'Booking staff', permissions: ['operations'], name: 'Ops Only' });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Priya Raman', phone: '+919876543210', email: 'p@example.com', walletBalance: 0 });
  const docs = { documents: { businessRegistration: { files: ['x'] }, identityProof: { files: ['x'] } }, fleet: { rcFiles: ['x'], insuranceFiles: ['x'], fcFiles: ['x'], permitFiles: ['x'], vehiclePhotos: ['x'] } };
  for (const v of [U.vendorA, U.vendorB]) await db.doc(`vendors/${v}`).set({ status: 'APPROVED', companyName: `Fleet ${v}`, name: v, phone: '+919000000001', ...docs });
  await db.doc('vehicles/vehCD').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN03CD3003', seatingCapacity: 4, make: 'Maruti', model: 'Dzire', assignedDriverId: U.driver });
  await db.doc(`drivers/${U.driver}`).set({ status: 'Approved', name: 'Selvam', phone: '+919791234569', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: 'vehCD', assignedVehicleNumber: 'TN03CD3003', rating: 4.2 });
  const r = await call(U.admin, 'saveTariffConfig', { ...CONFIRMED_TARIFF_V2, enabled: true, reason: 'Emulator setup' });
  assert.equal(r.ok, true, JSON.stringify(r));
});
test.after(async () => { await new Promise((r) => stub.close(r)); });

test('C1. the office closes an ongoing trip once: same fare rules as the driver, actual charges added once, a retry changes nothing', async () => {
  const id = await ongoingTrip();
  const before = await booking(id);
  // Without finance access nothing happens, not even a preview.
  const denied = await call(U.ops, 'officeCloseTrip', { bookingId: id, totalKm: 90, dryRun: true });
  assert.equal(denied.ok, false);
  // A preview returns the figures and saves nothing.
  const preview = await call(U.admin, 'officeCloseTrip', { bookingId: id, totalKm: 200, charges: { toll: 120, parking: 30, permit: 0 }, dryRun: true });
  assert.equal(preview.ok, true, JSON.stringify(preview));
  assert.equal(preview.data.dryRun, true);
  assert.equal(preview.data.summary.tollCharges, 150);
  assert.ok(preview.data.summary.extraKm > 0, 'extra km billed beyond the included km');
  assert.equal((await booking(id)).status, 'Ongoing');
  assert.equal((await booking(id)).fare, before.fare);
  // A reason and a request id are required to save.
  const noReason = await call(U.admin, 'officeCloseTrip', { bookingId: id, totalKm: 200, requestId: rid('close') });
  assert.equal(noReason.ok, false);
  const requestId = rid('close');
  const closed = await call(U.admin, 'officeCloseTrip', { bookingId: id, totalKm: 200, charges: { toll: 120, parking: 30 }, reason: 'Driver phone off, closed by phone call', requestId });
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.data.duplicate, false);
  const done = await booking(id);
  assert.equal(done.status, 'Completed');
  assert.equal(done.tripSubStatus, 'Trip Ended');
  assert.equal(done.tollCharges, 150, 'tolls and parking are counted once');
  assert.equal(done.totalKm, 200);
  assert.equal(done.closedByOffice.reason, 'Driver phone off, closed by phone call');
  assert.equal(closed.data.summary.fare, done.fare);
  assert.equal(preview.data.summary.fare, done.fare, 'the preview is the saved result');
  assert.equal(closed.data.summary.amountDue, Math.round((done.fare + 150) * 100) / 100);
  assert.ok(done.finalFare && done.finalFare.totalKm === 200);
  const events = (await db.collection(`bookings/${id}/events`).where('type', '==', 'trip_ended_by_office').get()).size;
  assert.equal(events, 1);
  // Retrying the same request is a no-op that returns the saved result.
  const again = await call(U.admin, 'officeCloseTrip', { bookingId: id, totalKm: 999, charges: { toll: 5000 }, reason: 'Driver phone off, closed by phone call', requestId });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.data.duplicate, true);
  const after = await booking(id);
  assert.equal(after.fare, done.fare);
  assert.equal(after.tollCharges, 150);
  assert.equal((await db.collection(`bookings/${id}/events`).where('type', '==', 'trip_ended_by_office').get()).size, 1);
  // A different request on a completed trip is refused.
  const other = await call(U.admin, 'officeCloseTrip', { bookingId: id, totalKm: 200, reason: 'Second attempt by someone else', requestId: rid('close') });
  assert.equal(other.ok, false);
  assert.equal(other.details?.code, 'already-completed');
});

test('C2. only a trip that is on the road can be closed by the office', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(6) });
  const r = await call(U.admin, 'officeCloseTrip', { bookingId: id, totalKm: 50, reason: 'Not started yet', requestId: rid('close') });
  assert.equal(r.ok, false);
  assert.equal(r.details?.code, 'not-ongoing');
  assert.equal((await booking(id)).status, 'Approved');
});

test('B1. assigning the lowest bid: a lower or earlier bid is never skipped and only one award can win', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(30) });
  const p = await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review' });
  assert.equal(p.ok, true, JSON.stringify(p));
  const fare = (await booking(id)).fare;
  const high = Math.floor(fare * 0.9), low = Math.floor(fare * 0.8);
  for (const [v, rate] of [[U.vendorA, high], [U.vendorB, low]]) {
    const r = await call(v, 'submitMarketplaceBid', { tripId: id, rate, note: '', autoAcceptConsent: true });
    assert.equal(r.ok, true, JSON.stringify(r));
  }
  // The higher bid is not the lowest: refused, nothing assigned.
  const wrong = await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorA}`, requireLowest: true });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.details?.code, 'not-lowest');
  assert.equal((await market(id)).status, 'Bidding');
  // Two operators press Assign Lowest at once: exactly one wins.
  const [x, y] = await Promise.all([
    call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorB}`, requireLowest: true }),
    call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorB}`, requireLowest: true }),
  ]);
  assert.equal([x, y].filter((r) => r.ok).length, 1, JSON.stringify([x, y]));
  const b = await booking(id);
  assert.equal(b.assignedVendorId, U.vendorB);
  assert.equal(b.vendorPayout, low);
  assert.equal(b.status, 'Confirmed');
  // A bid placed after the award is refused as closed, and a second award of the old bid fails.
  const late = await call(U.vendorA, 'submitMarketplaceBid', { tripId: id, rate: low - 10, autoAcceptConsent: true });
  assert.equal(late.ok, false);
  const stale = await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorA}`, requireLowest: true });
  assert.equal(stale.ok, false);
});

test('B2. a tie on the amount goes to the bid placed first', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(40) });
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review' })).ok, true);
  const rate = Math.floor((await booking(id)).fare * 0.85);
  assert.equal((await call(U.vendorB, 'submitMarketplaceBid', { tripId: id, rate, autoAcceptConsent: true })).ok, true);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await call(U.vendorA, 'submitMarketplaceBid', { tripId: id, rate, autoAcceptConsent: true })).ok, true);
  const second = await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorA}`, requireLowest: true });
  assert.equal(second.ok, false);
  const first = await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorB}`, requireLowest: true });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal((await booking(id)).assignedVendorId, U.vendorB);
});

test('E1. the offer is start × 1.05^hours from the publication time: start, +1 hour, +2 hours, then the cap', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(60) });
  const p = await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review', escalation: { enabled: true, ceiling: 2300 } });
  assert.equal(p.ok, true, JSON.stringify(p));
  const start = (await market(id)).startOffer;
  assert.ok(start > 0 && start < 2300);
  const claims = require('../lib/claims');
  const { scheduledOffer } = require('../lib/domain/offerSchedule');
  const published = (await market(id)).publishedAt.toMillis();
  const expectAt = (hours) => scheduledOffer(start, 5, 2300, hours);
  // Exactly at the start nothing has moved.
  await claims.runOfferEscalation(published + 59 * 60000);
  assert.equal((await market(id)).offeredPayout, start);
  await claims.runOfferEscalation(published + 61 * 60000);
  assert.equal((await market(id)).offeredPayout, expectAt(1));
  // A repeated run in the same hour compounds nothing.
  await claims.runOfferEscalation(published + 62 * 60000);
  assert.equal((await market(id)).offeredPayout, expectAt(1));
  await claims.runOfferEscalation(published + 121 * 60000);
  assert.equal((await market(id)).offeredPayout, expectAt(2));
  // A long gap catches up in one run and stops at the cap.
  await claims.runOfferEscalation(published + 30 * 3600000);
  assert.equal((await market(id)).offeredPayout, 2300);
});
