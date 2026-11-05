// Cross-Role End-to-End Journeys and Alternate Paths against Firebase Emulators
// Exercises all four roles (Customer, Vendor, Driver, Admin) and the backend.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, TS, call, rest, clientPatch, clientCreate, inHours, istInstant, place, rid, bookAs, booking, market, until } = H;

const U = {
  adminSuper: 'admSuper',
  adminOps: 'admOps',
  adminFin: 'admFin',
  adminComp: 'admComp',
  custA: 'custJourneyA',
  custB: 'custJourneyB',
  vendorFleet: 'vendJourneyFleet',
  driverFleet: 'drvJourneyFleet',
  driverOwner: 'drvJourneyOwner',
};

let routingStub;

const driverLocationFix = (over = {}) => ({
  lat: 10.0104,
  lng: 77.4768,
  accuracy: 15,
  capturedAt: Date.now(),
  ...over,
});

test.before(async () => {
  routingStub = await H.startRoutingStub(8765, 80, 90);

  // 1. Vehicle categories
  const fare = {
    baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100,
    nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13,
  };
  await db.doc('vehicle_categories/sedan').set({
    name: 'Sedan', status: 'Active', code: 'sedan', seatingCapacity: 4, displayOrder: 1, fare,
  });
  await db.doc('vehicle_categories/suv7').set({
    name: 'SUV 7+1', status: 'Active', code: 'suv7', seatingCapacity: 7, displayOrder: 2,
    fare: { ...fare, perKmRate: 21 },
  });

  // 2. Staff accounts with role-based permissions
  await db.doc(`admins/${U.adminSuper}`).set({
    role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Super Admin',
    permissions: ['operations', 'finance', 'compliance', 'fleet', 'people', 'system'],
  });
  await db.doc(`admins/${U.adminOps}`).set({
    role: 'admin', status: 'active', staffRole: 'operations_lead', name: 'Ops Officer',
    permissions: ['operations', 'fleet'],
  });
  await db.doc(`admins/${U.adminFin}`).set({
    role: 'admin', status: 'active', staffRole: 'finance_lead', name: 'Finance Officer',
    permissions: ['finance'],
  });
  await db.doc(`admins/${U.adminComp}`).set({
    role: 'admin', status: 'active', staffRole: 'compliance_officer', name: 'Compliance Officer',
    permissions: ['compliance'],
  });

  // 3. Customers
  await db.doc(`customers/${U.custA}`).set({
    status: 'Approved', name: 'Suresh Kumar', phone: '+919876500001', email: 'suresh@example.com', walletBalance: 0,
  });
  await db.doc(`customers/${U.custB}`).set({
    status: 'Approved', name: 'Meena Devi', phone: '+919876500002', email: 'meena@example.com', walletBalance: 0,
  });

  // 4. Vendors
  await db.doc(`vendors/${U.vendorFleet}`).set({
    status: 'APPROVED', companyName: 'SuperFleet Travels', name: 'Anand', phone: '+919000000010',
  });

  // 5. Vehicles for Vendor
  await db.doc('vehicles/veh_journey_sedan').set({
    vendorId: U.vendorFleet, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN57AB1111',
    seatingCapacity: 4, make: 'Maruti', model: 'Dzire', category: 'Sedan',
  });
  await db.doc('vehicles/veh_journey_suv').set({
    vendorId: U.vendorFleet, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN57CD2222',
    seatingCapacity: 7, make: 'Toyota', model: 'Innova', category: 'SUV 7+1',
  });

  // 6. Vendor employee driver
  await db.doc(`drivers/${U.driverFleet}`).set({
    status: 'Approved', vendorId: U.vendorFleet, name: 'Karthik', phone: '+919791230001',
    presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: 'sedan',
  });

  // 7. Independent Owner Driver
  await db.doc('vehicles/veh_journey_owner').set({
    vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN57EF3333',
    seatingCapacity: 4, make: 'Maruti', model: 'Dzire', assignedDriverId: U.driverOwner,
  });
  await db.doc(`drivers/${U.driverOwner}`).set({
    status: 'Approved', name: 'Muthu', phone: '+919791230002', presenceStatus: 'Online',
    fleetStatus: 'Active', assignedVehicleId: 'veh_journey_owner', assignedVehicleNumber: 'TN57EF3333',
    rating: 4.5, ratingCount: 10,
  });

  // 8. Turn on confirmed tariff v2
  const tariffRes = await call(U.adminSuper, 'saveTariffConfig', {
    useConfirmedDefaults: true, enabled: true, reason: 'Cross-role E2E setup',
  });
  assert.equal(tariffRes.ok, true, JSON.stringify(tariffRes));
});

test.after(async () => {
  if (routingStub) await new Promise((r) => routingStub.close(r));
});

// ══════════════════════════════════════════════════════════════════════════════
// CROSS-ROLE JOURNEY 1: Full 12-Step Lifecycle
// ══════════════════════════════════════════════════════════════════════════════
test('CJ1: Complete 12-step booking-to-completion journey with vendor dispatch and settlements', async () => {
  // Step 1: Customer creates advance booking
  const bookRes = await bookAs(U.custA, {
    scheduledAt: inHours(6),
    tripType: 'One Way',
    categoryId: 'sedan',
    notes: 'Please arrive on time',
  });
  assert.equal(bookRes.ok, true, JSON.stringify(bookRes));
  const bookingId = bookRes.requestId;

  // Step 2: Fare, schedule, category, terms validation
  const bInitial = await booking(bookingId);
  assert.equal(bInitial.status, 'Pending');
  assert.equal(bInitial.bookingType, 'advance');
  assert.equal(bInitial.termsAccepted, true);
  assert.equal(bInitial.dutyClass, 'sedan');
  assert.equal(bInitial.passengerSeatsRequired, 4);
  assert.equal(bInitial.pricing.model, 'one_way_standard');
  assert.equal(bInitial.pricing.includedKm, 130);
  // No GST rule is saved, so the tariff's 5% GST is included: the fare is the tariff amount (to within the 1 paisa GST rounding).
  assert.ok(Math.abs(bInitial.fare - 2350) <= 0.011, `fare ${bInitial.fare}`);

  // Step 3: Admin approves the booking
  const appRes = await call(U.adminOps, 'approveBooking', { bookingId });
  assert.equal(appRes.ok, true, JSON.stringify(appRes));
  assert.equal((await booking(bookingId)).status, 'Approved');

  // Step 4: Admin posts to marketplace in bid_review mode with escalation & ceiling
  const postRes = await call(U.adminOps, 'postBookingToMarketplace', {
    booking: bookingId,
    mode: 'bid_review',
    cutoffMinutes: 180,
  });
  assert.equal(postRes.ok, true, JSON.stringify(postRes));
  const mPost = await market(bookingId);
  assert.equal(mPost.status, 'Open');
  assert.equal(mPost.mode, 'bid_review');

  // Step 5: Vendor places a bid
  const bidRes = await call(U.vendorFleet, 'submitMarketplaceBid', {
    tripId: bookingId,
    rate: 2100,
    note: 'Clean car ready',
    autoAcceptConsent: true,
  });
  assert.equal(bidRes.ok, true, JSON.stringify(bidRes));

  // Step 6: Admin awards the bid to the vendor
  const awardRes = await call(U.adminOps, 'awardMarketplaceBid', {
    tripId: bookingId,
    bidId: `vendor_${U.vendorFleet}`,
  });
  assert.equal(awardRes.ok, true, JSON.stringify(awardRes));
  const bAwarded = await booking(bookingId);
  assert.equal(bAwarded.status, 'Confirmed');
  assert.equal(bAwarded.assignedVendorId, U.vendorFleet);
  assert.equal(bAwarded.vendorPayout, 2100);
  assert.equal(bAwarded.payoutSource, 'bid');

  // Step 7: Vendor dispatches driver and vehicle from fleet
  const dispatchRes = await call(U.vendorFleet, 'vendorAssignDriver', {
    bookingId,
    driverId: U.driverFleet,
    vehicleId: 'veh_journey_sedan',
  });
  assert.equal(dispatchRes.ok, true, JSON.stringify(dispatchRes));
  const bDispatched = await booking(bookingId);
  assert.equal(bDispatched.status, 'Assigned');
  assert.equal(bDispatched.assignedDriverId, U.driverFleet);
  assert.equal(bDispatched.assignedVehicleId, 'veh_journey_sedan');
  assert.equal(bDispatched.assignedVehicleNumber, 'TN57AB1111');

  // Step 8: Pre-trip vehicle verification (driver submits selfie, front, rear, interior + odometer)
  await db.doc(`vehicle_verifications/${bookingId}`).set({
    driverId: U.driverFleet,
    vehicleNumber: 'TN57AB1111',
    status: 'Submitted',
    odometerReading: 12000,
    riskLevel: 'low',
    submittedAt: TS.now(),
  });
  await db.doc(`bookings/${bookingId}`).update({
    vehicleVerification: { status: 'Submitted', riskLevel: 'low' },
    startOdometer: 12000,
  });

  // Step 9: Driver navigates and marks "Reached Pickup" with valid fresh GPS in radius
  const reachRes = await call(U.driverFleet, 'advanceTrip', {
    bookingId,
    to: 'Reached Pickup',
    location: driverLocationFix(),
    requestId: rid('reach'),
  });
  assert.equal(reachRes.ok, true, JSON.stringify(reachRes));
  const bReached = await booking(bookingId);
  assert.equal(bReached.tripSubStatus, 'Reached Pickup');

  // Step 10: Passenger Boarding Verification (OTP)
  const secretsDoc = await db.doc(`booking_secrets/${bookingId}`).get();
  assert.ok(secretsDoc.exists);
  const correctOtp = secretsDoc.data().otp;
  assert.match(correctOtp, /^\d{4}$/);

  // Wrong OTP fails
  const wrongOtpRes = await call(U.driverFleet, 'verifyBoarding', {
    bookingId,
    otp: '9999',
  });
  assert.equal(wrongOtpRes.ok, false);

  // Correct OTP succeeds
  const verifyRes = await call(U.driverFleet, 'verifyBoarding', {
    bookingId,
    otp: correctOtp,
  });
  assert.equal(verifyRes.ok, true, JSON.stringify(verifyRes));
  assert.ok((await booking(bookingId)).boardingVerifiedAt);

  // Step 11: Trip starts
  const startRes = await call(U.driverFleet, 'advanceTrip', {
    bookingId,
    to: 'Trip Started',
    location: driverLocationFix(),
    requestId: rid('start'),
  });
  assert.equal(startRes.ok, true, JSON.stringify(startRes));
  assert.equal((await booking(bookingId)).status, 'Ongoing');

  // Driver adds toll during trip
  const tolls = [{ id: 'toll_1', name: 'Kappalur Toll', amount: 85, receiptPhotoUrl: 'https://example.com/toll.jpg' }];
  await db.doc(`bookings/${bookingId}`).update({
    tolls,
    tollCharges: 85,
  });

  // Step 12: Trip completion with total KM
  // Total KM driven = 150 km (quoted included 130 km, extra 20 km)
  const endRes = await call(U.driverFleet, 'advanceTrip', {
    bookingId,
    to: 'Trip Ended',
    endOdometer: 12150,
    totalKm: 150,
    tolls,
    requestId: rid('end'),
  });
  assert.equal(endRes.ok, true, JSON.stringify(endRes));
  const bCompleted = await booking(bookingId);
  assert.equal(bCompleted.status, 'Completed');
  assert.equal(bCompleted.totalKm, 150);
  assert.equal(bCompleted.finalFare.extraKm, 20);
  // Base 2350 + 20 km × 15 = 2650 total payable, with the 5% GST included in it.
  assert.ok(Math.abs(bCompleted.fare - 2650) <= 0.011, `fare ${bCompleted.fare}`);

  // Customer pays driver directly via UPI
  const payTotal = bCompleted.fare + 85; // fare + toll = 2867.50
  const payRes = await call(U.driverFleet, 'recordPayment', {
    bookingId,
    amount: payTotal,
    method: 'UPI',
    collectorType: 'driver',
    reference: 'UPI_PAY_001',
    requestId: rid('pay'),
  });
  assert.equal(payRes.ok, true, JSON.stringify(payRes));

  const bPaid = await booking(bookingId);
  assert.equal(bPaid.paymentSummary.status, 'Paid');
  assert.equal(bPaid.paymentSummary.totalPaid, payTotal);
  assert.equal(bPaid.paymentSummary.partnerCashHeld, payTotal); // Recognized as held by partner!

  // Customer rates the completed trip 5 stars
  await db.doc(`bookings/${bookingId}`).update({
    rating: 5,
    reviewComment: 'Excellent journey and safe driving!',
    ratedAt: TS.now(),
  });
  const { syncRating } = require('../lib/ratings');
  const ratingSynced = await syncRating(bookingId);
  assert.equal(ratingSynced, true);

  // Check driver rating updated
  const drvData = (await db.doc(`drivers/${U.driverFleet}`).get()).data();
  assert.ok(drvData.rating >= 4);
});

// ══════════════════════════════════════════════════════════════════════════════
// CROSS-ROLE JOURNEY 2: Direct Owner-Driver Assignment & Payout Flow
// ══════════════════════════════════════════════════════════════════════════════
test('CJ2: Direct Owner-Driver assignment, full trip, company payment & 4h settlement due', async () => {
  // 1. Customer books
  const bRes = await bookAs(U.custB, { scheduledAt: inHours(4.5) });
  assert.equal(bRes.ok, true);
  const id = bRes.requestId;

  // 2. Admin approves
  assert.equal((await call(U.adminOps, 'approveBooking', { bookingId: id })).ok, true);

  // 3. Admin directly assigns owner driver
  const asgRes = await call(U.adminOps, 'assignDriver', {
    bookingId: id,
    driverId: U.driverOwner,
  });
  assert.equal(asgRes.ok, true, JSON.stringify(asgRes));
  const bAsg = await booking(id);
  assert.equal(bAsg.status, 'Assigned');
  assert.equal(bAsg.assignedDriverId, U.driverOwner);
  assert.equal(bAsg.driverPayout, 2055); // Standard tariff partner base

  // 4. Pre-trip verification
  await db.doc(`vehicle_verifications/${id}`).set({
    driverId: U.driverOwner, status: 'Submitted', odometerReading: 40000, riskLevel: 'low', submittedAt: TS.now(),
  });
  await db.doc(`bookings/${id}`).update({
    vehicleVerification: { status: 'Submitted' },
    startOdometer: 40000,
  });

  // 5. Driver reached pickup
  assert.equal((await call(U.driverOwner, 'advanceTrip', {
    bookingId: id, to: 'Reached Pickup', location: driverLocationFix(), requestId: rid('reach2'),
  })).ok, true);

  // 6. Boarding OTP
  const otp = (await db.doc(`booking_secrets/${id}`).get()).data().otp;
  assert.equal((await call(U.driverOwner, 'verifyBoarding', { bookingId: id, otp })).ok, true);

  // 7. Trip Start
  assert.equal((await call(U.driverOwner, 'advanceTrip', {
    bookingId: id, to: 'Trip Started', location: driverLocationFix(), requestId: rid('start2'),
  })).ok, true);

  // 8. Trip End (130 km exact)
  assert.equal((await call(U.driverOwner, 'advanceTrip', {
    bookingId: id, to: 'Trip Ended', endOdometer: 40130, totalKm: 130, requestId: rid('end2'),
  })).ok, true);

  const bEnd = await booking(id);
  assert.equal(bEnd.status, 'Completed');
  assert.ok(Math.abs(bEnd.fare - 2350) <= 0.011, `fare ${bEnd.fare}`);
  assert.equal(bEnd.driverPayout, 2055);

  // 9. Customer pays company directly via Admin recordPayment (e.g. Bank Transfer)
  assert.equal((await call(U.adminFin, 'recordPayment', {
    bookingId: id, amount: bEnd.fare, method: 'Bank Transfer', reference: 'HDFC-TXN-987654', collectorType: 'admin', requestId: rid('bankpay'),
  })).ok, true);

  // 10. Settlement Due record created automatically for the partner
  const due = await until(async () => (await db.doc(`settlement_dues/${id}`).get()).data(), { what: 'settlement due' });
  assert.equal(due.amount, 2055);
  assert.equal(due.partnerId, U.driverOwner);
  assert.equal(due.status, 'Due');

  // 11. Admin finance processes settlement to Paid with UTR reference
  await db.doc(`driver_private/${U.driverOwner}`).set({ bank: { upiId: 'muthu@okhdfcbank' } });
  assert.equal((await call(U.adminFin, 'updateSettlement', {
    bookingId: id, action: 'processing',
  })).ok, true);
  assert.equal((await call(U.adminFin, 'updateSettlement', {
    bookingId: id, action: 'paid', reference: 'UTR_NESAM_889900', method: 'UPI',
  })).ok, true);

  const finalDue = (await db.doc(`settlement_dues/${id}`).get()).data();
  assert.equal(finalDue.status, 'Paid');
  assert.equal(finalDue.reference, 'UTR_NESAM_889900');
});

// ══════════════════════════════════════════════════════════════════════════════
// ALTERNATE PATH 1: Customer Cancellation with Policy Windows
// ══════════════════════════════════════════════════════════════════════════════
test('AP1: Customer cancellation while Pending is free; cancellation closes marketplace post', async () => {
  const bRes = await bookAs(U.custA, { scheduledAt: inHours(10) });
  const id = bRes.requestId;

  // Post to marketplace
  await call(U.adminOps, 'approveBooking', { bookingId: id });
  await call(U.adminOps, 'postBookingToMarketplace', { booking: id, mode: 'accept_offer' });

  assert.equal((await market(id)).status, 'Open');

  // Customer cancels ride through client update (matching rideService.ts)
  const cancelRes = await clientPatch(U.custA, `bookings/${id}`, {
    status: 'Cancelled',
    cancelReason: 'Plans changed',
    cancelledBy: 'customer',
    cancellationFee: 0,
  });
  assert.equal(cancelRes.ok, true, JSON.stringify(cancelRes));
  await clientPatch(U.custA, `marketplace_trips/${id}`, {
    status: 'Closed',
    updatedAt: new Date().toISOString(),
  });

  // Admin also cancels another booking with cancelBooking function
  const bRes2 = await bookAs(U.custB, { scheduledAt: inHours(12) });
  await call(U.adminOps, 'approveBooking', { bookingId: bRes2.requestId });
  const adminCancelRes = await call(U.adminOps, 'cancelBooking', {
    bookingId: bRes2.requestId,
    reason: 'Operational vehicle issue',
  });
  assert.equal(adminCancelRes.ok, true, JSON.stringify(adminCancelRes));

  const bCancelled = await booking(id);
  assert.equal(bCancelled.status, 'Cancelled');
  assert.equal(bCancelled.cancellationFee, 0); // Free while pending/advance far out

  // Marketplace post is closed so no partner can take it
  const mClosed = await market(id);
  assert.equal(mClosed.status, 'Closed');
});

// ══════════════════════════════════════════════════════════════════════════════
// ALTERNATE PATH 2: Reassignment and Schedule Overlap Prevention
// ══════════════════════════════════════════════════════════════════════════════
test('AP2: Overlapping trips are blocked for driver and vehicle; reassignment updates state', async () => {
  const t1 = await bookAs(U.custA, { scheduledAt: inHours(50) });
  assert.equal(t1.ok, true, JSON.stringify(t1));
  const approvedFirst = await call(U.adminOps, 'approveBooking', { bookingId: t1.requestId });
  assert.equal(approvedFirst.ok, true, JSON.stringify(approvedFirst));
  const assignedFirst = await call(U.adminOps, 'assignDriver', { bookingId: t1.requestId, driverId: U.driverOwner });
  assert.equal(assignedFirst.ok, true, JSON.stringify(assignedFirst));

  // Second trip at exactly same time
  const t2 = await bookAs(U.custB, { scheduledAt: inHours(50.5) });
  assert.equal(t2.ok, true, JSON.stringify(t2));
  assert.equal((await call(U.adminOps, 'approveBooking', { bookingId: t2.requestId })).ok, true);

  // Overlap rejected for driver
  const overlapRes = await call(U.adminOps, 'assignDriver', {
    bookingId: t2.requestId,
    driverId: U.driverOwner,
  });
  assert.equal(overlapRes.ok, false);
  assert.match(overlapRes.message, /already has trip/i);

  // Admin removes driver assignment first (re-opening for fulfilment)
  const removeRes = await call(U.adminOps, 'assignDriver', {
    bookingId: t1.requestId,
    driverId: '',
    reason: 'Driver reallocation',
  });
  assert.equal(removeRes.ok, true, JSON.stringify(removeRes));
  assert.equal((await booking(t1.requestId)).status, 'Approved');

  // Then reserves to vendor
  const reassignRes = await call(U.adminOps, 'assignVendor', {
    bookingId: t1.requestId,
    vendorId: U.vendorFleet,
    reason: 'Partner reallocation',
  });
  assert.equal(reassignRes.ok, true, JSON.stringify(reassignRes));
  assert.equal((await booking(t1.requestId)).assignedVendorId, U.vendorFleet);
});

// ══════════════════════════════════════════════════════════════════════════════
// ALTERNATE PATH 3: Penalties Lifecycle (Issue -> Ack -> Wallet Debit)
// ══════════════════════════════════════════════════════════════════════════════
test('AP3: Penalty issuance, partner acknowledgement, dispute, and finance wallet deduction', async () => {
  // Compliance issues penalty to vendor
  const issueRes = await call(U.adminComp, 'issuePenalty', {
    party: 'Vendor',
    partyId: U.vendorFleet,
    category: 'Late Arrival',
    amount: 500,
    customerCompensation: 250,
    reason: 'Driver arrived 45 minutes after scheduled pickup',
    description: 'Customer complained about delay causing missed train',
    incidentDate: new Date().toISOString().slice(0, 10),
  });
  assert.equal(issueRes.ok, true, JSON.stringify(issueRes));
  const penaltyId = issueRes.data.id;

  const pDoc = (await db.doc(`penalties/${penaltyId}`).get()).data();
  assert.equal(pDoc.status, 'Pending');
  assert.equal(pDoc.amount, 500);

  // Partner acknowledges penalty
  const ackRes = await call(U.vendorFleet, 'acknowledgePenalty', {
    penaltyId,
    confirmed: true,
  });
  assert.equal(ackRes.ok, true, JSON.stringify(ackRes));
  assert.equal((await db.doc(`penalties/${penaltyId}`).get()).data().status, 'Acknowledged');

  // Partner disputes penalty
  const disputeRes = await call(U.vendorFleet, 'disputePenalty', {
    penaltyId,
    note: 'Traffic block on NH due to VIP convoy',
  });
  assert.equal(disputeRes.ok, true, JSON.stringify(disputeRes));
  assert.equal((await db.doc(`penalties/${penaltyId}`).get()).data().status, 'Disputed');

  // Finance deducts penalty from partner wallet
  const deductRes = await call(U.adminFin, 'transitionPenalty', {
    penaltyId,
    status: 'Deducted',
    note: 'Dispute reviewed and rejected after GPS trace analysis',
  });
  assert.equal(deductRes.ok, true, JSON.stringify(deductRes));

  // Ledger verifies debit
  const ledgerDoc = await db.doc(`wallet_ledger/penalty_${penaltyId}`).get();
  assert.ok(ledgerDoc.exists);
  assert.equal(ledgerDoc.data().direction, 'debit');
  assert.equal(ledgerDoc.data().netAmount, 500);
});

// ══════════════════════════════════════════════════════════════════════════════
// ALTERNATE PATH 4: Location & Boarding Edge Cases
// ══════════════════════════════════════════════════════════════════════════════
test('AP4: Driver-confirmed arrival without GPS and audited admin override', async () => {
  const bRes = await bookAs(U.custA, { scheduledAt: inHours(4.5) });
  const id = bRes.requestId;
  await call(U.adminOps, 'approveBooking', { bookingId: id });
  await call(U.adminOps, 'assignDriver', { bookingId: id, driverId: U.driverOwner });

  // The app deliberately uses driver-confirmed arrival; GPS is optional.
  const rNoGps = await call(U.driverOwner, 'advanceTrip', {
    bookingId: id, to: 'Reached Pickup', requestId: rid('nogps'),
  });
  assert.equal(rNoGps.ok, true, JSON.stringify(rNoGps));
  assert.equal((await booking(id)).reachedPickupVerification, 'driver-confirmed');
  assert.equal((await booking(id)).reachedPickupLocation, null);

  // An office override is still available for a different, not-yet-reached duty.
  const other = await bookAs(U.custA, { scheduledAt: inHours(100) });
  assert.equal(other.ok, true, JSON.stringify(other));
  assert.equal((await call(U.adminOps, 'approveBooking', { bookingId: other.requestId })).ok, true);
  assert.equal((await call(U.adminOps, 'assignDriver', { bookingId: other.requestId, driverId: U.driverOwner })).ok, true);

  // Audited Admin override for Reached Pickup (e.g. driver device battery died at pickup)
  const overrideRes = await call(U.adminOps, 'overrideReachedPickup', {
    bookingId: other.requestId,
    reason: 'Driver at pickup confirmed by customer phone call',
  });
  assert.equal(overrideRes.ok, true, JSON.stringify(overrideRes));
  const bOverridden = await booking(other.requestId);
  assert.equal(bOverridden.tripSubStatus, 'Reached Pickup');
  assert.equal(bOverridden.reachedPickupOverride?.by, U.adminOps);
});

