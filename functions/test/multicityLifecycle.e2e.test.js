// Multicity tour, end to end across every role: a customer books a multi-city tour directly, the admin reviews it,
// publishes it, a vendor bids and is awarded, dispatches a driver, and the driver runs the trip to completion.
// Checks at each step that the itinerary (the cities in order) and the Multicity fare are carried through intact.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, inHours, place, rid, booking, market, until } = H;

const U = { admin: 'mcAdmin', cust: 'mcCustomer', vendor: 'mcVendor', driver: 'mcDriver', owner: 'mcOwnerDriver' };
let routing;
const fix = (over = {}) => ({ lat: 10.0104, lng: 77.4768, accuracy: 15, capturedAt: Date.now(), ...over });
const pickup = place('Theni', 10.0104, 77.4768);
const stops = [place('Madurai', 9.9252, 78.1198), place('Trichy', 10.7905, 78.7047)];
const drop = place('Theni', 10.0104, 77.4768);

/** Books the tour the way People Taxi does (tripType "Multicity", stops, a tour end), retrying once on the server's own fare. */
async function bookTour(over = {}) {
  const base = {
    requestId: rid('mc'), pickup, drop, stops, categoryId: 'mc-sedan', tripType: 'Multicity', paymentMethod: 'Cash',
    scheduledAt: inHours(6), tripEndAt: inHours(70), termsAccepted: true, expectedFare: 0, notes: '', couponCode: '', ...over,
  };
  let r = await call(U.cust, 'createBooking', base);
  if (!r.ok && r.details?.fare?.total) r = await call(U.cust, 'createBooking', { ...base, expectedFare: r.details.fare.total });
  return { ...r, requestId: base.requestId };
}

test.before(async () => {
  routing = await H.startRoutingStub(8765, 80, 90);
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Tour desk', permissions: ['operations', 'finance', 'compliance', 'fleet', 'people', 'system'] });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Tour Customer', phone: '+919876500011', email: 'tour@example.com', walletBalance: 0 });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/mc-sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', tariffClass: 'sedan', dutyClass: 'sedan', seatingCapacity: 4, seats: 4, displayOrder: 1, fare: { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 } });
  const files = [{ url: 'https://example.com/doc.jpg', name: 'doc.jpg' }];
  await db.doc(`vendors/${U.vendor}`).set({
    status: 'APPROVED', companyName: 'Tour Fleet', name: 'Anand', phone: '+919000000020',
    documents: { businessRegistration: { files }, identityProof: { files } },
    fleet: { rcFiles: files, insuranceFiles: files, fcFiles: files, permitFiles: files, vehiclePhotos: files },
  });
  await db.doc('vehicles/mc_veh').set({ vendorId: U.vendor, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN57MC0001', seatingCapacity: 4, make: 'Maruti', model: 'Dzire', category: 'Sedan' });
  await db.doc(`drivers/${U.driver}`).set({ status: 'Approved', vendorId: U.vendor, name: 'Karthik', phone: '+919791230021', presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: 'sedan' });
  const saved = await call(U.admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Multicity lifecycle fixture' });
  assert.equal(saved.ok, true, JSON.stringify(saved));
});
test.after(async () => { if (routing) await new Promise((r) => routing.close(r)); });

test('a customer can quote and book a Multicity tour directly; the itinerary and the Multicity fare are stored', async () => {
  const q = await call(U.cust, 'quoteBooking', { brand: 'nesam', tripType: 'Multicity', pickup, drop, stops, categoryId: 'mc-sedan', scheduledAt: inHours(6), tripEndAt: inHours(70) });
  assert.equal(q.ok, true, JSON.stringify(q));
  const res = await bookTour();
  assert.equal(res.ok, true, JSON.stringify(res));
  const b = await booking(res.requestId);
  assert.equal(b.service, 'Multicity');
  assert.equal(b.tourType, 'Multicity');
  assert.equal(b.tripType, 'Round Trip');
  assert.equal(b.status, 'Pending');
  assert.deepEqual(b.stops.map((s) => s.name), ['Madurai', 'Trichy']);
  assert.deepEqual(b.itinerary.map((s) => s.name), ['Theni', 'Madurai', 'Trichy', 'Theni']);
  assert.ok(b.fare > 0 && b.billableDays >= 3, `fare ${b.fare} days ${b.billableDays}`);
});

test('a Multicity booking without a city between pickup and drop is refused with a readable message', async () => {
  const r = await bookTour({ stops: [] });
  assert.equal(r.ok, false);
  assert.match(r.message, /at least one city/i);
});

test('admin approves, publishes; the vendor sees the cities, bids, is awarded, dispatches; the driver runs the tour', async () => {
  const res = await bookTour();
  assert.equal(res.ok, true, JSON.stringify(res));
  const id = res.requestId;

  assert.equal((await call(U.admin, 'approveBooking', { bookingId: id })).ok, true);
  const post = await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review', cutoffMinutes: 180 });
  assert.equal(post.ok, true, JSON.stringify(post));
  const m = await market(id);
  assert.deepEqual(m.via, ['Madurai', 'Trichy'], 'the open duty lists the tour cities');
  assert.equal(m.tourType, 'Multicity');

  const bid = await call(U.vendor, 'submitMarketplaceBid', { tripId: id, rate: 9000, note: 'Ready', autoAcceptConsent: true });
  assert.equal(bid.ok, true, JSON.stringify(bid));
  const award = await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendor}` });
  assert.equal(award.ok, true, JSON.stringify(award));
  const dispatch = await call(U.vendor, 'vendorAssignDriver', { bookingId: id, driverId: U.driver, vehicleId: 'mc_veh' });
  assert.equal(dispatch.ok, true, JSON.stringify(dispatch));
  assert.equal((await booking(id)).status, 'Assigned');

  await db.doc(`vehicle_verifications/${id}`).set({ driverId: U.driver, vehicleNumber: 'TN57MC0001', status: 'Submitted', odometerReading: 5000, riskLevel: 'low', submittedAt: H.TS.now() });
  await db.doc(`bookings/${id}`).update({ vehicleVerification: { status: 'Submitted', riskLevel: 'low' }, startOdometer: 5000 });
  const reach = await call(U.driver, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location: fix(), requestId: rid('r') });
  assert.equal(reach.ok, true, JSON.stringify(reach));
  const otp = (await db.doc(`booking_secrets/${id}`).get()).data().otp;
  assert.equal((await call(U.driver, 'verifyBoarding', { bookingId: id, otp })).ok, true);
  const start = await call(U.driver, 'advanceTrip', { bookingId: id, to: 'Trip Started', location: fix(), requestId: rid('s') });
  assert.equal(start.ok, true, JSON.stringify(start));
  assert.equal((await booking(id)).status, 'Ongoing');

  const end = await call(U.driver, 'advanceTrip', { bookingId: id, to: 'Trip Ended', endOdometer: 5900, totalKm: 900, tolls: [], requestId: rid('e') });
  assert.equal(end.ok, true, JSON.stringify(end));
  const done = await booking(id);
  assert.equal(done.status, 'Completed');
  assert.equal(done.service, 'Multicity');
  assert.deepEqual(done.stops.map((s) => s.name), ['Madurai', 'Trichy'], 'the itinerary survives completion');
  const booked = (await db.doc(`bookings/${id}`).get()).data();
  const final = await until(async () => (await db.doc(`bookings/${id}`).get()).data().finalFare, { what: 'final fare' });
  // 900 km driven against a multi-day tour: the extra kilometres and the calendar days come from the saved Multicity snapshot.
  assert.ok(final.extraKm > 0, `extra km ${final.extraKm}`);
  assert.ok(final.days >= 3, `billed days ${final.days}`);
  assert.ok(final.finalFare > final.quotedFare, `final ${final.finalFare} vs quoted ${final.quotedFare}`);
  assert.equal(booked.fare, final.finalFare, 'the booking carries the final fare');
  assert.equal(booked.pricing?.model ?? done.pricing?.model, 'round_trip_calendar');
});
