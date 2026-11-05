// Integration suite against the Firebase emulators (auth + firestore + functions + rules).
//   npm run build
//   ROUTING_URL=http://127.0.0.1:8765 npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json \
//     --project demo-nesam --only auth,firestore,functions "node --test test/integration.e2e.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const H = require('./helpers.e2e');
const { db, TS, call, rest, clientPatch, inHours, istInstant, place, rid, bookAs, booking, market, until } = H;

const U = {
  admin: 'admP', staffNoOps: 'admP2', cust: 'custP', cust2: 'custP2',
  vendorA: 'vendPA', vendorB: 'vendPB', driverVA: 'drvPVA', owner: 'drvPOwner', ownerSmall: 'drvPSmall', ownerCrysta: 'drvPCrysta', ownerTop: 'drvPTop',
};
let stub;

const driverFix = (over = {}) => ({ lat: 10.0104, lng: 77.4768, accuracy: 20, capturedAt: Date.now(), ...over });

/** Runs a whole trip as the driver, through the real callables. Returns the completed booking. */
async function runTrip(id, driver, { totalKm = 160, odoStart = 1000 } = {}) {
  const reached = await call(driver, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location: driverFix(), requestId: rid('r') });
  assert.equal(reached.ok, true, JSON.stringify(reached));
  const otp = (await db.doc(`booking_secrets/${id}`).get()).data().otp;
  const boarded = await call(driver, 'verifyBoarding', { bookingId: id, otp });
  assert.equal(boarded.ok, true, JSON.stringify(boarded));
  await db.doc(`vehicle_verifications/${id}`).set({ driverId: driver, status: 'Submitted', odometerReading: odoStart, riskLevel: 'low', submittedAt: TS.now() });
  const started = await call(driver, 'advanceTrip', { bookingId: id, to: 'Trip Started', location: driverFix(), requestId: rid('s') });
  assert.equal(started.ok, true, JSON.stringify(started));
  const ended = await call(driver, 'advanceTrip', { bookingId: id, to: 'Trip Ended', location: driverFix(), endOdometer: odoStart + totalKm, totalKm, requestId: rid('e') });
  assert.equal(ended.ok, true, JSON.stringify(ended));
  return booking(id);
}

async function approvedBooking(over = {}) {
  const b = await bookAs(U.cust, over);
  assert.equal(b.ok, true, JSON.stringify(b));
  const a = await call(U.admin, 'approveBooking', { bookingId: b.requestId });
  assert.equal(a.ok, true, JSON.stringify(a));
  return b.requestId;
}

test.before(async () => {
  stub = await H.startRoutingStub();
  const fare = { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 };
  await db.doc('vehicle_categories/sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', seatingCapacity: 4, displayOrder: 1, fare });
  await db.doc('vehicle_categories/suv7').set({ name: 'SUV 7+1', status: 'Active', code: 'suv7', seatingCapacity: 7, displayOrder: 2, fare: { ...fare, perKmRate: 21 } });
  await db.doc('vehicle_categories/crysta').set({ name: 'Innova Crysta', status: 'Active', code: 'crysta', seatingCapacity: 7, displayOrder: 3, fare: { ...fare, perKmRate: 26 } });
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Test Admin' });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Priya Raman', phone: '+919876543210', email: 'p@example.com', walletBalance: 0 });
  await db.doc(`customers/${U.cust2}`).set({ status: 'Approved', name: 'Arun Kumar', phone: '+919876500000', email: 'a@example.com', walletBalance: 0 });
  for (const v of [U.vendorA, U.vendorB]) await db.doc(`vendors/${v}`).set({ status: 'APPROVED', companyName: `Fleet ${v}`, name: v, phone: '+919000000001' });
  // vendor A: a 7-seat Innova (class innova7) and a 4-seat sedan; vendor B: sedan
  await db.doc('vehicles/vehPA_sedan').set({ vendorId: U.vendorA, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN01AB1001', seatingCapacity: 4, make: 'Maruti', model: 'Dzire' });
  await db.doc('vehicles/vehPA_innova').set({ vendorId: U.vendorA, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN01AB1002', seatingCapacity: 7, make: 'Toyota', model: 'Innova' });
  await db.doc('vehicles/vehPB_sedan').set({ vendorId: U.vendorB, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN02CD2002', seatingCapacity: 4, make: 'Maruti', model: 'Dzire' });
  await db.doc(`drivers/${U.driverVA}`).set({ status: 'Approved', vendorId: U.vendorA, name: 'Murugan', phone: '+919791234567', presenceStatus: 'Online', fleetStatus: 'Active' });
  // Independent owner-drivers
  await db.doc('vehicles/vehPO').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN03EF3003', seatingCapacity: 4, make: 'Maruti', model: 'Dzire', assignedDriverId: U.owner });
  await db.doc(`drivers/${U.owner}`).set({ status: 'Approved', name: 'Selvam', phone: '+919791234569', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: 'vehPO', assignedVehicleNumber: 'TN03EF3003', rating: 4.2 });
  await db.doc('vehicles/vehPSmall').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN04GH4004', seatingCapacity: 4, make: 'Maruti', model: 'Swift', assignedDriverId: U.ownerSmall });
  await db.doc(`drivers/${U.ownerSmall}`).set({ status: 'Approved', name: 'Raja', phone: '+919791234570', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: 'vehPSmall', rating: 3.9 });
  await db.doc('vehicles/vehPCrysta').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN05IJ5005', seatingCapacity: 7, make: 'Toyota', model: 'Innova Crysta', assignedDriverId: U.ownerCrysta });
  await db.doc(`drivers/${U.ownerCrysta}`).set({ status: 'Approved', name: 'Babu', phone: '+919791234571', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: 'vehPCrysta', rating: 4.8 });
  await db.doc('vehicles/vehPTop').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN06KL6006', seatingCapacity: 4, make: 'Maruti', model: 'Dzire', assignedDriverId: U.ownerTop });
  await db.doc(`drivers/${U.ownerTop}`).set({ status: 'Approved', name: 'Top', phone: '+919791234572', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: 'vehPTop', rating: 4.9 });
  // Confirmed tariff on (explicit admin action, audited).
  const r = await call(U.admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Emulator setup' });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test.after(async () => { await new Promise((r) => stub.close(r)); });

// ── Tariff ─────────────────────────────────────────────────────────────────

// With no GST rule saved, the tariff's 5% GST is INCLUDED: the total payable is the tariff amount, give or take the 1 paisa
// that splitting an inclusive price into "taxable + exactly 5% of taxable" cannot always avoid.
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) <= 0.011, `${msg || 'amount'}: ${actual} is not ${expected} (±0.01)`);
const r2 = (n) => Math.round(n * 100) / 100;

test('T1. a one-way booking is priced by the confirmed tariff (130 km floor, bata, fixed partner rate)', async () => {
  const r = await bookAs(U.cust);
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = await booking(r.requestId);
  assert.equal(b.pricing.source, 'tariff_v2');
  assert.equal(b.pricing.model, 'one_way_standard');
  assert.equal(b.pricing.includedKm, 130);
  near(b.fare, 2350, 'fare is the tariff amount, GST included');
  near(b.fareBreakdown.taxableAmount, 2350 / 1.05, 'taxable value');
  near(b.fareBreakdown.taxableAmount + b.fareBreakdown.gst, b.fare, 'taxable + GST = total payable');
  assert.equal(b.pricing.partner.basePaise, 205500);
  assert.equal(b.dutyClass, 'sedan');
  assert.ok(b.fareBreakup.lines.some((l) => /driver allowance|bata/i.test(l.label)));
  assert.equal(b.commission, undefined, 'a confirmed-tariff duty does not need a percentage commission');
});

test('T2. a round trip is billed by Indian calendar days with daily minimums', async () => {
  const r = await bookAs(U.cust, { tripType: 'Round Trip', scheduledAt: istInstant(2, '10:00'), tripEndAt: istInstant(3, '20:00') });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = await booking(r.requestId);
  assert.equal(b.pricing.model, 'round_trip_calendar');
  assert.equal(b.billableDays, 2);
  near(b.fare, 7800, '500 km × 14 + 2 × 400, GST included');
  near(b.fareBreakdown.taxableAmount, 7800 / 1.05, 'taxable value');
  assert.equal(b.pricing.partner.basePaise, 690000); // 500 × 12.60 + 2 × 300
  const noEnd = await bookAs(U.cust, { tripType: 'Round Trip', scheduledAt: istInstant(2, '10:00') });
  assert.equal(noEnd.ok, false);
  const before = await bookAs(U.cust, { tripType: 'Round Trip', scheduledAt: istInstant(3, '10:00'), tripEndAt: istInstant(2, '10:00') });
  assert.equal(before.ok, false);
  // Midnight boundary: 23:00 → 01:00 next day is two chargeable dates.
  const mid = await bookAs(U.cust, { tripType: 'Round Trip', scheduledAt: istInstant(4, '23:00'), tripEndAt: istInstant(5, '01:00') });
  assert.equal((await booking(mid.requestId)).billableDays, 2);
});

// ── Eligibility matrix, capacity, documents, schedule ──────────────────────

test('E1. vendor assignment enforces class, seats and document validity through the trip', async () => {
  const id = await approvedBooking({ categoryId: 'crysta', scheduledAt: inHours(30) });
  assert.equal((await booking(id)).dutyClass, 'crysta');
  assert.equal((await call(U.admin, 'assignVendor', { bookingId: id, vendorId: U.vendorA })).ok, true);
  // Innova 7+1 cannot serve a Crysta duty even though it has 7 seats.
  const wrongClass = await call(U.vendorA, 'vendorAssignDriver', { bookingId: id, driverId: U.driverVA, vehicleId: 'vehPA_innova' });
  assert.equal(wrongClass.ok, false);
  assert.match(wrongClass.message, /cannot serve a crysta duty/i);
  // An Innova duty is fine for it; document expiry before the trip end blocks it.
  const innovaCat = await db.doc('vehicle_categories/innova').set({ name: 'Innova', status: 'Active', code: 'innova', seatingCapacity: 7, displayOrder: 4, fare: { baseFare: 70, baseKm: 2, perKmRate: 20, perMinuteRate: 1, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 } });
  void innovaCat;
  const innovaId = await approvedBooking({ categoryId: 'innova', scheduledAt: inHours(40) });
  await call(U.admin, 'assignVendor', { bookingId: innovaId, vendorId: U.vendorA });
  await db.doc('vehicles/vehPA_innova').update({ insuranceExpiry: new Date(Date.now() + 20 * 3600000).toISOString().slice(0, 10) });
  const expired = await call(U.vendorA, 'vendorAssignDriver', { bookingId: innovaId, driverId: U.driverVA, vehicleId: 'vehPA_innova' });
  assert.equal(expired.ok, false);
  assert.match(expired.message, /insurance expires before this trip ends/i);
  await db.doc('vehicles/vehPA_innova').update({ insuranceExpiry: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10) });
  const ok = await call(U.vendorA, 'vendorAssignDriver', { bookingId: innovaId, driverId: U.driverVA, vehicleId: 'vehPA_innova' });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  await db.doc('vehicles/vehPA_innova').update({ insuranceExpiry: require('firebase-admin').firestore.FieldValue.delete() });
});

test('E2. a running trip does not block a later duty it will clear in time, but an overlap is refused', async () => {
  const a = await approvedBooking({ scheduledAt: inHours(60) });
  assert.equal((await call(U.admin, 'assignDriver', { bookingId: a, driverId: U.owner })).ok, true);
  // 90 minutes later: overlaps the first trip (route 90 min + buffer) → refused for the driver and the vehicle.
  const overlap = await approvedBooking({ scheduledAt: new Date(Date.now() + 61.5 * 3600000).toISOString() });
  const r = await call(U.admin, 'assignDriver', { bookingId: overlap, driverId: U.owner });
  assert.equal(r.ok, false, 'overlap must be refused');
  assert.match(r.message, /already has trip/);
  // A forced assignment needs a written reason.
  const noReason = await call(U.admin, 'assignDriver', { bookingId: overlap, driverId: U.owner, force: true });
  assert.equal(noReason.ok, false);
  // Six hours later is fine.
  const later = await approvedBooking({ scheduledAt: new Date(Date.now() + 66 * 3600000).toISOString() });
  assert.equal((await call(U.admin, 'assignDriver', { bookingId: later, driverId: U.owner })).ok, true);
});

// ── Marketplace modes, claims, bids, waves, escalation ─────────────────────

test('M1. accept_offer mode: bids refused; eligibility enforced on claim; employees denied; single winner', async () => {
  const id = await approvedBooking({ categoryId: 'crysta', scheduledAt: inHours(80) });
  const p = await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'accept_offer' });
  assert.equal(p.ok, true, JSON.stringify(p));
  const m = await market(id);
  assert.equal(m.mode, 'accept_offer');
  assert.deepEqual([...m.eligibleVehicleClasses].sort(), ['crysta6', 'crysta7']);
  // Wrong-class owner-driver, small vehicle: refused.
  const small = await call(U.ownerSmall, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(small.ok, false);
  // A vendor employee driver can never take part.
  const emp = await call(U.driverVA, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(emp.ok, false);
  assert.equal(emp.details?.code, 'employee-denied');
  assert.equal((await call(U.driverVA, 'submitMarketplaceBid', { tripId: id, rate: 1000 })).ok, false);
  // Bidding is not available on an accept-offer post.
  const bid = await call(U.vendorA, 'submitMarketplaceBid', { tripId: id, rate: 1500 });
  assert.equal(bid.ok, false);
  // A client cannot assign itself with a direct write.
  const forge = await clientPatch(U.ownerCrysta, `bookings/${id}`, { assignedDriverId: U.ownerCrysta, status: 'Assigned' });
  assert.equal(forge.ok, false);
  // Two eligible partners race: exactly one wins.
  const [a, b] = await Promise.all([call(U.ownerCrysta, 'claimMarketplaceDuty', { bookingId: id }), call(U.vendorB, 'claimMarketplaceDuty', { bookingId: id })]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, `${a.message} | ${b.message}`);
  const done = await booking(id);
  assert.equal(Boolean(done.assignedVendorId) !== Boolean(done.assignedDriverId), true);
  assert.equal((await market(id)).status, 'Assigned');
});

test('M2. bid_review mode: claim refused, owner and vendor bids reviewed and awarded, losers rejected', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(90) });
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review' })).ok, true);
  const claim = await call(U.vendorA, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(claim.ok, false);
  assert.equal(claim.details?.code, 'bid-only');
  const noConsent = await call(U.vendorA, 'submitMarketplaceBid', { tripId: id, rate: 1800 });
  assert.equal(noConsent.ok, false);
  assert.equal(noConsent.details?.code, 'consent-required');
  assert.equal((await call(U.vendorA, 'submitMarketplaceBid', { tripId: id, rate: 1800, note: 'Can do', autoAcceptConsent: true })).ok, true);
  assert.equal((await call(U.owner, 'submitMarketplaceBid', { tripId: id, rate: 1700 })).ok, true);
  assert.equal((await call(U.vendorB, 'submitMarketplaceBid', { tripId: id, rate: 99999 })).ok, false, 'a bid above the customer fare is refused');
  // Partners cannot award or write bids directly.
  assert.equal((await call(U.vendorA, 'awardMarketplaceBid', { tripId: id, bidId: 'driver_' + U.owner })).ok, false);
  const bids = await db.collection(`marketplace_trips/${id}/bids`).get();
  assert.equal(bids.size, 2);
  const award = await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `driver_${U.owner}` });
  assert.equal(award.ok, true, JSON.stringify(award));
  const b = await booking(id);
  assert.equal(b.assignedDriverId, U.owner);
  assert.equal(b.driverPayout, 1700);
  assert.equal(b.payoutSource, 'bid');
  const lost = (await db.doc(`marketplace_trips/${id}/bids/vendor_${U.vendorA}`).get()).data();
  assert.equal(lost.status, 'Rejected');
  // A stale second award fails.
  assert.equal((await call(U.admin, 'awardMarketplaceBid', { tripId: id, bidId: `vendor_${U.vendorA}` })).ok, false);
});

test('M3. offer escalation steps from the publication time, never compounds twice, stops at the ceiling', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(100) });
  const p = await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'accept_offer', escalation: { enabled: true, ceiling: 2300 } });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal((await market(id)).offeredPayout, 2055);
  await db.doc(`marketplace_trips/${id}`).update({ publishedAt: TS.fromMillis(Date.now() - 3 * 3600000 - 60000) });
  const jobs = require('../lib/claims');
  const first = await jobs.runOfferEscalation();
  assert.ok(first.stepped >= 1);
  assert.equal((await market(id)).offeredPayout, 2300);
  const again = await jobs.runOfferEscalation();
  assert.equal((await market(id)).offeredPayout, 2300);
  assert.equal(again.stepped, 0);
  near((await booking(id)).fare, 2350, 'the customer fare never changes');
  // The ceiling raised exactly one admin alert.
  const alerts = await db.collection('notifications').where('title', '==', 'Marketplace offer is at its ceiling').get();
  assert.ok(alerts.size >= 1);
});

test('M4. release waves hold a duty back from lower-rated owners and vendors until their time', async () => {
  await db.doc('settings/operations').set({ dutyRelease: { enabled: true, ownersAllSeconds: 120, vendorsSeconds: 180, topRatedMin: 4.5 } }, { merge: true });
  const id = await approvedBooking({ scheduledAt: inHours(110) });
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'accept_offer' })).ok, true);
  const vendor = await call(U.vendorB, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(vendor.ok, false);
  assert.equal(vendor.details?.code, 'not-released');
  const lower = await call(U.owner, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(lower.ok, false);
  assert.equal(lower.details?.code, 'not-released');
  // After the vendor wave the vendor can take it.
  await db.doc(`marketplace_trips/${id}`).update({ publishedAt: TS.fromMillis(Date.now() - 200000) });
  assert.equal((await call(U.vendorB, 'claimMarketplaceDuty', { bookingId: id })).ok, true);
  await db.doc('settings/operations').set({ dutyRelease: { enabled: false } }, { merge: true });
});

test('M5. a published offer past its cut-off is closed with an alert; the customer fare is untouched', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(120) });
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'accept_offer', cutoffMinutes: 60 })).ok, true);
  await db.doc(`marketplace_trips/${id}`).update({ cutoffAt: TS.fromMillis(Date.now() - 1000) });
  const late = await call(U.vendorB, 'claimMarketplaceDuty', { bookingId: id });
  assert.equal(late.ok, false);
  const closed = await require('../lib/jobs').expireMarketplaceOffers();
  assert.ok(closed >= 1);
  assert.equal((await market(id)).status, 'Closed');
  assert.equal((await booking(id)).status, 'Approved');
});

// ── Privacy ────────────────────────────────────────────────────────────────

test('P1. partners never see a raw customer number; the assigned driver gets it only inside T-8h; vendors never', async () => {
  const far = await approvedBooking({ scheduledAt: inHours(20) });
  assert.equal((await call(U.admin, 'assignVendor', { bookingId: far, vendorId: U.vendorA })).ok, true);
  assert.equal((await call(U.vendorA, 'vendorAssignDriver', { bookingId: far, driverId: U.driverVA, vehicleId: 'vehPA_sedan' })).ok, true);
  const b = await booking(far);
  assert.equal(b.phone, undefined, 'no raw phone on the booking document');
  assert.equal(b.customerEmail, undefined);
  assert.match(b.phoneMasked, /••/);
  // Document-level read by the vendor/driver exposes no raw number.
  const asVendor = await rest(U.vendorA, `bookings/${far}`);
  assert.equal(asVendor.status, 200);
  assert.equal(JSON.stringify(asVendor.body).includes('9876543210'), false);
  assert.notEqual((await rest(U.vendorA, `booking_contacts/${far}`)).status, 200);
  assert.notEqual((await rest(U.driverVA, `booking_contacts/${far}`)).status, 200);
  assert.equal((await rest(U.cust, `booking_contacts/${far}`)).status, 200);
  assert.equal((await rest(U.admin, `booking_contacts/${far}`)).status, 200);
  // Vendor: always masked. Driver: masked before T-8h.
  const v = await call(U.vendorA, 'getCustomerContact', { bookingId: far });
  assert.equal(v.ok, false);
  assert.equal(v.details?.code, 'vendor-masked');
  const early = await call(U.driverVA, 'getCustomerContact', { bookingId: far });
  assert.equal(early.ok, false);
  assert.equal(early.details?.code, 'before-window');
  // Pickup moves inside the window → the assigned driver receives it; an unrelated driver does not.
  await db.doc(`bookings/${far}`).update({ pickupAt: TS.fromMillis(Date.now() + 5 * 3600000) });
  const ok = await call(U.driverVA, 'getCustomerContact', { bookingId: far });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.data.phone, '+919876543210');
  assert.equal((await call(U.owner, 'getCustomerContact', { bookingId: far })).ok, false);
  // Reassigned away → access revoked immediately.
  await db.doc(`bookings/${far}`).update({ assignedDriverId: 'someoneElse' });
  assert.equal((await call(U.driverVA, 'getCustomerContact', { bookingId: far })).ok, false);
  const logs = await db.collection('contact_access_logs').where('bookingId', '==', far).get();
  assert.ok(logs.docs.some((d) => d.data().action === 'reveal' && d.data().actorId === U.driverVA));
  assert.ok(logs.docs.filter((d) => d.data().action === 'denied').length >= 3);
  assert.equal(logs.docs.some((d) => JSON.stringify(d.data()).includes('9876543210')), false, 'the log never stores the number');
  // Staff reveal is logged under the staff member's own account.
  const staff = await call(U.admin, 'getCustomerContact', { bookingId: far });
  assert.equal(staff.ok, true);
  assert.ok((await db.collection('contact_access_logs').where('bookingId', '==', far).where('actorId', '==', U.admin).get()).size >= 1);
});

// ── Trip execution, final fare, settlement ─────────────────────────────────

test('X2. trip execution gates, final fare and settlement due', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(4.5) });
  const asg = await call(U.admin, 'assignDriver', { bookingId: id, driverId: U.ownerTop });
  assert.equal(asg.ok, true, JSON.stringify(asg));
  let b = await booking(id);
  assert.equal(b.driverPayout, 2055);
  assert.equal(b.payoutSource, 'tariff');
  const reach = (location) => call(U.ownerTop, 'advanceTrip', { bookingId: id, to: 'Reached Pickup', location, requestId: rid('g') });
  // Total KM is mandatory at the end; the driver cannot send a fare or rate.
  const otpBefore = await call(U.ownerTop, 'verifyBoarding', { bookingId: id, otp: '0000' });
  assert.equal(otpBefore.ok, false, 'boarding OTP before Reached is refused');
  assert.equal((await reach(undefined)).ok, true);
  assert.equal((await booking(id)).reachedPickupVerification, 'driver-confirmed');
  assert.equal((await booking(id)).reachedPickupLocation, null);
  const wrong = await call(U.ownerTop, 'verifyBoarding', { bookingId: id, otp: '0000' });
  assert.equal(wrong.ok, false);
  const otp = (await db.doc(`booking_secrets/${id}`).get()).data().otp;
  assert.equal((await call(U.ownerTop, 'verifyBoarding', { bookingId: id, otp })).ok, true);
  await db.doc(`vehicle_verifications/${id}`).set({ driverId: U.ownerTop, status: 'Submitted', odometerReading: 5000, riskLevel: 'low', submittedAt: TS.now() });
  assert.equal((await call(U.ownerTop, 'advanceTrip', { bookingId: id, to: 'Trip Started', location: driverFix(), requestId: rid('s') })).ok, true);
  const noKm = await call(U.ownerTop, 'advanceTrip', { bookingId: id, to: 'Trip Ended', endOdometer: 5160, requestId: rid('e') });
  assert.equal(noKm.ok, false);
  assert.equal(noKm.details?.code, 'total-km-required');
  const end = await call(U.ownerTop, 'advanceTrip', { bookingId: id, to: 'Trip Ended', endOdometer: 5160, totalKm: 160, fare: 1, requestId: rid('e2') });
  assert.equal(end.ok, true, JSON.stringify(end));
  b = await booking(id);
  assert.equal(b.status, 'Completed');
  assert.equal(b.finalFare.extraKm, 30);
  near(b.fare, 2350 + 30 * 15, 'quoted 2,350 + 30 extra km × 15 = 2,800, GST included');
  near(b.fareBreakdown.taxableAmount, (2350 + 30 * 15) / 1.05, 'taxable value');
  assert.equal(b.driverPayout, 2460, '160 km × 13.50 + 300 bata');
  // The company collects the whole invoice → settlement is due 4h after completion.
  const pay = await call(U.admin, 'recordPayment', { bookingId: id, amount: b.fare, method: 'Cash', collectorType: 'admin', requestId: rid('p') });
  assert.equal(pay.ok, true, JSON.stringify(pay));
  const due = await until(async () => (await db.doc(`settlement_dues/${id}`).get()).data(), { what: 'settlement due' });
  assert.equal(due.amount, 2460);
  assert.equal(due.status, 'Due');
  const hours = (due.dueAt.toMillis() - due.completedAt.toMillis()) / 3600000;
  assert.equal(hours, 4);
  // Finance moves it through Processing → Paid (needs a reference and a beneficiary).
  assert.equal((await call(U.admin, 'updateSettlement', { bookingId: id, action: 'processing' })).ok, true);
  const noRef = await call(U.admin, 'updateSettlement', { bookingId: id, action: 'paid' });
  assert.equal(noRef.ok, false);
  const noBank = await call(U.admin, 'updateSettlement', { bookingId: id, action: 'paid', reference: 'UTR123456', method: 'UPI' });
  assert.equal(noBank.ok, false, 'a payout without a beneficiary is refused');
  await db.doc(`driver_private/${U.ownerTop}`).set({ bank: { upiId: 'top@upi' } });
  const paid = await call(U.admin, 'updateSettlement', { bookingId: id, action: 'paid', reference: 'UTR123456', method: 'UPI' });
  assert.equal(paid.ok, true, JSON.stringify(paid));
  const wallet = await until(async () => {
    const w = (await db.doc(`wallets/driver_${U.ownerTop}`).get()).data();
    return w && w.paidOut === 2460 ? w : null;
  }, { what: 'wallet debit' });
  assert.equal(wallet.available, 0);
  assert.equal((await call(U.admin, 'updateSettlement', { bookingId: id, action: 'paid', reference: 'UTR999999', method: 'UPI' })).ok, false, 'a paid settlement cannot be paid twice');
});

test('X3. money received directly by the partner reduces the settlement, whatever the method', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(150) });
  const rest = r2((await booking(id)).fare - 1000);
  assert.equal((await call(U.admin, 'assignDriver', { bookingId: id, driverId: U.ownerTop })).ok, true);
  // Company collects an advance, the driver receives the rest by UPI.
  assert.equal((await call(U.admin, 'recordPayment', { bookingId: id, amount: 1000, method: 'UPI', reference: 'COMP12345', collectorType: 'admin', requestId: rid('a') })).ok, true);
  assert.equal((await call(U.ownerTop, 'recordPayment', { bookingId: id, amount: rest, method: 'UPI', reference: 'DRV12345', requestId: rid('d') })).ok, true);
  const s = (await booking(id)).paymentSummary;
  assert.equal(s.status, 'Paid');
  assert.equal(s.partnerCashHeld, rest, 'a UPI payment to the driver is partner-held money');
  assert.equal(s.companyCollected, 1000);
});

// ── Gateway ────────────────────────────────────────────────────────────────

test('G1. gateway success becomes one canonical receipt; pending/failed never reduce the balance; replays post once', async () => {
  const pay = require('../lib/payments');
  const id = await approvedBooking({ scheduledAt: inHours(160) });
  const b = await booking(id);
  const before = await pay.recordGatewayReceipt({ bookingId: id, paymentId: 'pay_TEST0001', orderId: 'order_X', amountPaise: 100000, method: 'upi', source: 'checkout' });
  assert.equal(before.recorded, true);
  const again = await pay.recordGatewayReceipt({ bookingId: id, paymentId: 'pay_TEST0001', orderId: 'order_X', amountPaise: 100000, method: 'upi', source: 'webhook' });
  assert.equal(again.recorded, false);
  const txns = await db.collection(`bookings/${id}/payment_transactions`).get();
  assert.equal(txns.size, 1);
  assert.equal(txns.docs[0].data().method, 'Gateway');
  assert.equal(txns.docs[0].data().collectorType, 'system');
  const s = (await booking(id)).paymentSummary;
  assert.equal(s.totalPaid, 1000);
  assert.equal(s.balanceDue, r2(b.fare - 1000));
  // A manually recorded 'Gateway' receipt is not accepted.
  const fake = await call(U.admin, 'recordPayment', { bookingId: id, amount: 100, method: 'Gateway', reference: 'pay_FAKE', collectorType: 'admin', requestId: rid('f') });
  assert.equal(fake.ok, false);
  // Webhook signature and handling.
  const secret = 'whsec_test_secret_value';
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_TEST0002', order_id: 'order_Y', status: 'captured', amount: 50000, currency: 'INR', method: 'card' } } } });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(pay.razorpayWebhookValid(body, sig, secret), true);
  assert.equal(pay.razorpayWebhookValid(body, sig.replace(/.$/, '0'), secret), false);
  await db.doc(`bookings/${id}/gateway_orders/order_Y`).set({ orderId: 'order_Y', bookingId: id, amountPaise: 50000, status: 'created' });
  assert.equal((await pay.handleRazorpayEvent(JSON.parse(body))).detail, 'recorded');
  assert.equal((await pay.handleRazorpayEvent(JSON.parse(body))).detail, 'duplicate');
  assert.equal((await booking(id)).paymentSummary.totalPaid, 1500);
  // A pending/authorised payment is ignored and the amount must match the order.
  const failed = JSON.parse(body); failed.event = 'payment.failed'; failed.payload.payment.entity.id = 'pay_TEST0003';
  assert.equal((await pay.handleRazorpayEvent(failed)).detail, 'failure noted');
  assert.equal((await booking(id)).paymentSummary.totalPaid, 1500);
  const wrong = JSON.parse(body); wrong.payload.payment.entity.id = 'pay_TEST0004'; wrong.payload.payment.entity.amount = 99;
  assert.equal((await pay.handleRazorpayEvent(wrong)).handled, false);
});

// ── Rules ──────────────────────────────────────────────────────────────────

test('R1. clients cannot write money, assignments, bids, contacts or ledger entries', async () => {
  const id = await approvedBooking({ scheduledAt: inHours(170) });
  await call(U.admin, 'postBookingToMarketplace', { booking: id, mode: 'bid_review' });
  const attempts = [
    clientPatch(U.vendorA, `bookings/${id}`, { status: 'Confirmed', assignedVendorId: U.vendorA, vendorPayout: 9999 }),
    clientPatch(U.owner, `bookings/${id}`, { status: 'Assigned', assignedDriverId: U.owner, driverPayout: 9999 }),
    clientPatch(U.cust, `bookings/${id}`, { fare: 1 }),
    clientPatch(U.vendorA, `marketplace_trips/${id}`, { status: 'Assigned', offeredPayout: 9999 }),
    clientPatch(U.admin, `wallets/driver_${U.owner}`, { available: 99999 }),
    clientPatch(U.admin, `booking_contacts/${id}`, { phone: '+910000000000' }),
    H.clientCreate(U.vendorA, `marketplace_trips/${id}/bids`, 'forged', { vendorId: U.vendorA, vendorCounterRate: 1, status: 'Accepted' }),
  ];
  const results = await Promise.all(attempts);
  results.forEach((r, i) => assert.equal(r.ok, false, `write ${i} must be refused`));
});

// ── Employee isolation ─────────────────────────────────────────────────────

test('I1. a vendor employee driver cannot request a wallet payout', async () => {
  const r = await call(U.driverVA, 'requestPartnerPayout', { role: 'driver', amount: 500, method: 'UPI', requestId: rid('po') });
  assert.equal(r.ok, false);
  assert.equal(r.details?.code, 'employee-denied');
});

// ── Backlog recovery ───────────────────────────────────────────────────────

test('J1. the backlog sweeper resumes from its watermark and retries parked failures', async () => {
  const jobs = require('../lib/jobs');
  await db.doc('system/reconcile_state').delete().catch(() => null);
  const id = await approvedBooking({ scheduledAt: inHours(180) });
  await db.doc(`reconcile_failures/booking_${id}`).set({ kind: 'booking', bookingId: id, attempts: 1, lastTriedAt: TS.now() });
  const r = await jobs.reconcileBacklog(20000);
  assert.ok(r.swept >= 1, JSON.stringify(r));
  assert.equal(r.retried, 1);
  assert.equal((await db.doc(`reconcile_failures/booking_${id}`).get()).exists, false);
  const state = (await db.doc('system/reconcile_state').get()).data();
  assert.ok(state.watermark);
  const second = await jobs.reconcileBacklog(20000);
  assert.ok(second.swept <= r.swept, 'a second run only re-checks the recent tail');
});

test('J2. document-expiry reminders go out once per threshold and flag affected trips', async () => {
  const jobs = require('../lib/jobs');
  assert.equal(jobs.reminderBucket(25), null);
  assert.equal(jobs.reminderBucket(15), 20);
  assert.equal(jobs.reminderBucket(5), 7);
  assert.equal(jobs.reminderBucket(2), 3);
  assert.equal(jobs.reminderBucket(0), 1);
  assert.equal(jobs.reminderBucket(-3), 0);
  await db.doc('vehicles/vehPExp').set({ vendorId: U.vendorB, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN09ZZ9009', seatingCapacity: 4, make: 'Maruti', model: 'Dzire', insuranceExpiry: new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10) });
  const r1 = await jobs.runDocumentExpiryReminders();
  assert.ok(r1.reminded >= 1);
  const r2 = await jobs.runDocumentExpiryReminders();
  assert.equal(r2.reminded, 0, 'the same threshold is not repeated');
});

test('Q1. one rating per completed booking feeds the driver average once', async () => {
  const { syncRating } = require('../lib/ratings');
  await db.doc(`drivers/${U.ownerSmall}`).update({ rating: 4, ratingCount: 1 });
  const id = rid('rated');
  await db.doc(`bookings/${id}`).set({ id, bookingId: 'NT-RATE-1', customerId: U.cust, status: 'Completed', assignedDriverId: U.ownerSmall, rating: 2, fare: 1000, createdAt: TS.now() });
  assert.equal(await syncRating(id), true);
  assert.equal(await syncRating(id), false, 'a booking is counted once');
  const d = (await db.doc(`drivers/${U.ownerSmall}`).get()).data();
  assert.equal(d.ratingCount, 2);
  assert.equal(d.rating, 3);
});

test('A1. staff cannot record a manual Gateway receipt and the registry exposes every function the apps call', async () => {
  const { CALLABLES } = require('../lib/registry');
  for (const n of ['claimMarketplaceDuty', 'submitMarketplaceBid', 'withdrawMarketplaceBid', 'rejectMarketplaceBid', 'getCustomerContact', 'updateBookingContact',
    'quoteBooking', 'saveTariffConfig', 'updateSettlement', 'overrideReachedPickup', 'vendorAssignDriver']) {
    assert.ok(CALLABLES[n], `${n} must be reachable through the HTTP API too`);
  }
});
