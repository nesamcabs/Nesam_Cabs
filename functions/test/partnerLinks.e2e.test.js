// Partner linking against the local emulators: owner-driver and vendor-driver moves, vehicle swaps confirmed by the
// last-trip driver's code, office review, overrides, and who may do what. Nothing here can reach production.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, TS, call, rest, clientCreate } = H;

const U = { admin: 'plAdmin', adminOps: 'plOps', vA: 'plVendorA', vB: 'plVendorB', owner: 'plOwnerDriver', drvB: 'plDriverOfB', drvLast: 'plLastTripDriver', pending: 'plPendingVendor' };
const PH = { owner: '9000000001', drvB: '9000000002', drvLast: '9000000003' };

const seed = async () => {
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Office Lead' });
  await db.doc(`admins/${U.adminOps}`).set({ role: 'admin', status: 'active', staffRole: 'ops', name: 'Ops', permissions: ['operations'] });
  for (const [uid, name] of [[U.vA, 'Alpha Travels'], [U.vB, 'Bravo Travels']]) {
    await db.doc(`vendors/${uid}`).set({ uid, role: 'vendor', status: 'APPROVED', companyName: name, phone: '+919800000000' });
  }
  await db.doc(`vendors/${U.pending}`).set({ uid: U.pending, role: 'vendor', status: 'PENDING_APPROVAL', companyName: 'Pending Co', phone: '+919800000009' });
  await db.doc(`drivers/${U.owner}`).set({ role: 'driver', status: 'Approved', name: 'Owner Murugan', phone: `+91${PH.owner}`, vendorId: '', docStatus: 'Approved' });
  await db.doc(`drivers/${U.drvB}`).set({ role: 'driver', status: 'Approved', name: 'Bala Kumar', phone: `+91${PH.drvB}`, vendorId: U.vB, vendorName: 'Bravo Travels', assignedVehicleId: 'carB', assignedVehicleNumber: 'TN 60 AB 1234' });
  await db.doc(`drivers/${U.drvLast}`).set({ role: 'driver', status: 'Approved', name: 'Last Trip Selvam', phone: `+91${PH.drvLast}`, vendorId: U.vB });
  await db.doc('vehicles/carB').set({ vehicleNumber: 'TN 60 AB 1234', vendorId: U.vB, docStatus: 'Approved', status: 'Active', assignedDriverId: U.drvB, assignedDriverName: 'Bala Kumar', make: 'Maruti', model: 'Dzire', category: 'Sedan' });
  await db.doc('vehicles/carBusy').set({ vehicleNumber: 'TN 60 CD 5678', vendorId: U.vB, docStatus: 'Approved', status: 'Active', assignedDriverId: '', make: 'Toyota', model: 'Innova', category: 'Innova' });
  await db.doc('vehicles/carNoTrip').set({ vehicleNumber: 'TN 60 EF 9012', vendorId: U.vB, docStatus: 'Approved', status: 'Active', assignedDriverId: '' });
  await db.doc('vehicles/carHold').set({ vehicleNumber: 'TN 60 GH 3456', vendorId: U.vB, docStatus: 'Approved', status: 'Accident Hold', assignedDriverId: '' });
  // Completed trips: the last one on carB was driven by drvLast.
  await db.doc('bookings/oldB').set({ status: 'Completed', assignedVehicleId: 'carB', assignedDriverId: U.drvB, completedAt: TS.fromMillis(Date.now() - 9 * 86400000) });
  await db.doc('bookings/lastB').set({ status: 'Completed', assignedVehicleId: 'carB', assignedDriverId: U.drvLast, completedAt: TS.fromMillis(Date.now() - 2 * 86400000) });
  await db.doc('bookings/lastBusy').set({ status: 'Completed', assignedVehicleId: 'carBusy', assignedDriverId: U.drvLast, completedAt: TS.fromMillis(Date.now() - 86400000) });
  await db.doc('bookings/openBusy').set({ status: 'Assigned', bookingId: 'NSM-OPEN-1', assignedVehicleId: 'carBusy', assignedDriverId: U.drvLast });
  await db.doc('bookings/lastHold').set({ status: 'Completed', assignedVehicleId: 'carHold', assignedDriverId: U.drvLast, completedAt: TS.fromMillis(Date.now() - 86400000) });
};

test.before(seed);

test('lookups say what a number or plate is, without exposing more than a first name', async () => {
  const owner = await call(U.vA, 'findPartnerDriver', { phone: PH.owner });
  assert.equal(owner.ok, true);
  assert.deepEqual({ found: owner.data.found, kind: owner.data.kind, name: owner.data.name }, { found: true, kind: 'owner_driver', name: 'Owner' });
  assert.equal(JSON.stringify(owner.data).includes('9000000001'), false, 'the full number is never returned');

  const other = await call(U.vA, 'findPartnerDriver', { phone: `+91 ${PH.drvB}` });
  assert.equal(other.data.kind, 'vendor_driver');
  assert.equal(other.data.fleet, 'Bravo Travels');

  assert.equal((await call(U.vA, 'findPartnerDriver', { phone: '9111111111' })).data.found, false);

  const car = await call(U.vA, 'findPartnerVehicle', { plate: 'tn60ab1234' });
  assert.equal(car.data.found, true);
  assert.equal(car.data.owner, 'Bravo Travels');
  assert.equal(car.data.otpReceiver.name, 'Last', 'the code goes to the most recent trip driver');
  assert.equal((await call(U.vA, 'findPartnerVehicle', { plate: 'TN99ZZ0000' })).data.found, false);
});

test('only an approved vendor or staff can look anything up', async () => {
  assert.equal((await call(U.pending, 'findPartnerDriver', { phone: PH.owner })).ok, false);
  assert.equal((await call(U.owner, 'findPartnerVehicle', { plate: 'TN60AB1234' })).ok, false);
});

test('a vendor-driver moves to another fleet after the driver confirms with a code', async () => {
  const r = await call(U.vA, 'requestDriverLink', { phone: PH.drvB });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.status, 'Awaiting OTP');
  assert.match(r.data.testCode, /^\d{6}$/);

  const wrong = await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode === '000000' ? '111111' : '000000' });
  assert.equal(wrong.ok, false);
  assert.match(wrong.message, /not correct/);

  const again = await call(U.vA, 'requestDriverLink', { phone: PH.drvB });
  assert.equal(again.data.existing, true, 'a second request for the same driver reuses the open one');

  const ok = await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode });
  assert.equal(ok.ok, true, ok.message);
  assert.equal(ok.data.status, 'Completed');
  const d = (await db.doc(`drivers/${U.drvB}`).get()).data();
  assert.equal(d.vendorId, U.vA);
  assert.equal(d.previousVendorId, U.vB);
  assert.equal(d.assignedVehicleId, '', 'the pairing with the old vendor vehicle is released');
  assert.equal((await db.doc('vehicles/carB').get()).data().assignedDriverId, '');
  const link = (await db.doc(`partner_links/${r.data.linkId}`).get()).data();
  assert.deepEqual([link.status, link.method, link.consent], ['Completed', 'Driver code', true]);
  const events = await db.collection(`partner_links/${r.data.linkId}/events`).get();
  assert.ok(events.size >= 3);
  const audit = await db.collection('audit_logs').where('action', '==', 'driver_attachment_changed').get();
  assert.ok(audit.docs.some((x) => x.data().entityId === U.drvB));

  // the code is single-use
  assert.equal((await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode })).ok, false);
});

test('an owner-driver joining a fleet is confirmed by the driver and then by the office', async () => {
  const r = await call(U.vB, 'requestDriverLink', { phone: PH.owner });
  assert.equal(r.ok, true, r.message);
  const v = await call(U.vB, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode });
  assert.equal(v.data.status, 'Office review');
  assert.equal((await db.doc(`drivers/${U.owner}`).get()).data().vendorId, '', 'not moved before the office decides');

  // another vendor cannot act on it, and neither can staff without the people permission
  assert.equal((await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: '123456' })).ok, false);
  assert.equal((await call(U.adminOps, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve' })).ok, false);

  const d = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve' });
  assert.equal(d.ok, true, d.message);
  const driver = (await db.doc(`drivers/${U.owner}`).get()).data();
  assert.equal(driver.vendorId, U.vB);
  assert.equal(driver.previousAccountType, 'owner_driver');
  assert.equal((await db.doc(`partner_links/${r.data.linkId}`).get()).data().method, 'Office approved');
});

test('a vehicle moves once the last-trip driver confirms; the pairing is released', async () => {
  const r = await call(U.vA, 'requestVehicleLink', { plate: 'TN 60 AB 1234' });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.status, 'Awaiting OTP');
  const secret = await db.doc(`partner_link_secrets/${r.data.linkId}`).get();
  assert.equal(secret.data().receiverId, U.drvLast, 'the code is for the most recent completed trip');
  assert.equal(JSON.stringify(secret.data()).includes(r.data.testCode), false, 'the code is stored hashed');

  const v = await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode });
  assert.equal(v.data.status, 'Completed');
  const car = (await db.doc('vehicles/carB').get()).data();
  assert.equal(car.vendorId, U.vA);
  assert.equal(car.previousVendorId, U.vB);
  assert.equal((await call(U.vA, 'requestVehicleLink', { plate: 'TN60AB1234' })).ok, false, 'already in this fleet');
});

test('open duties block a move; staff cannot approve around them', async () => {
  const r = await call(U.vA, 'requestVehicleLink', { plate: 'TN60CD5678' });
  const v = await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode });
  assert.equal(v.data.status, 'Office review');
  const link = (await db.doc(`partner_links/${r.data.linkId}`).get()).data();
  assert.match(link.blockedReason, /NSM-OPEN-1/);
  const a = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve' });
  assert.equal(a.ok, false);
  const o = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve', override: true, reason: 'Office checked the car' });
  assert.equal(o.ok, false, 'an override never moves a vehicle that has an open duty');
  assert.equal((await db.doc('vehicles/carBusy').get()).data().vendorId, U.vB);
  // once the duty is done the office can finish it
  await db.doc('bookings/openBusy').update({ status: 'Completed' });
  const done = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve' });
  assert.equal(done.ok, true, done.message);
  assert.equal((await db.doc('vehicles/carBusy').get()).data().vendorId, U.vA);
});

test('a vehicle with no trip history goes to the office, and an override needs a reason', async () => {
  const r = await call(U.vA, 'requestVehicleLink', { plate: 'TN60EF9012' });
  assert.equal(r.data.status, 'Office review');
  assert.equal((await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: '123456' })).ok, false);
  const none = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve' });
  assert.equal(none.ok, false);
  assert.match(none.message, /Override/);
  const noReason = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve', override: true, reason: '' });
  assert.equal(noReason.ok, false);
  const ok = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve', override: true, reason: 'Old driver unreachable, RC checked' });
  assert.equal(ok.ok, true, ok.message);
  const link = (await db.doc(`partner_links/${r.data.linkId}`).get()).data();
  assert.deepEqual([link.method, link.overrideReason], ['Admin override', 'Old driver unreachable, RC checked']);
});

test('a vehicle on hold only moves by override, and stays on hold', async () => {
  const r = await call(U.vA, 'requestVehicleLink', { plate: 'TN60GH3456' });
  const v = await call(U.vA, 'verifyPartnerLinkOtp', { linkId: r.data.linkId, code: r.data.testCode });
  assert.equal(v.data.status, 'Office review');
  const o = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve', override: true, reason: 'Hold reviewed by fleet office' });
  assert.equal(o.ok, true, o.message);
  const car = (await db.doc('vehicles/carHold').get()).data();
  assert.deepEqual([car.vendorId, car.status], [U.vA, 'Accident Hold']);
});

test('rejecting and cancelling', async () => {
  await db.doc('vehicles/carX').set({ vehicleNumber: 'TN 60 XX 1111', vendorId: U.vB, docStatus: 'Approved', status: 'Active' });
  const r = await call(U.vA, 'requestVehicleLink', { plate: 'TN60XX1111' });
  assert.equal(r.data.status, 'Office review');
  assert.equal((await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'reject', reason: '' })).ok, false);
  assert.equal((await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'reject', reason: 'Not this vendor' })).data.status, 'Rejected');
  assert.equal((await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve', override: true, reason: 'Second thoughts' })).ok, false, 'a closed request stays closed');

  await db.doc('vehicles/carY').set({ vehicleNumber: 'TN 60 YY 2222', vendorId: U.vB, docStatus: 'Approved', status: 'Active' });
  const c = await call(U.vA, 'requestVehicleLink', { plate: 'TN60YY2222' });
  assert.equal((await call(U.vB, 'cancelPartnerLink', { linkId: c.data.linkId })).ok, false, 'only the requester');
  assert.equal((await call(U.vA, 'cancelPartnerLink', { linkId: c.data.linkId })).data.status, 'Cancelled');
});

test('help request, resend limits and staff-started links', async () => {
  const r = await call(U.vA, 'requestDriverLink', { phone: PH.drvLast });
  assert.equal(r.ok, true, r.message);
  const again = await call(U.vA, 'resendPartnerLinkOtp', { linkId: r.data.linkId });
  assert.equal(again.ok, false);
  assert.match(again.message, /Wait/);
  const help = await call(U.vA, 'requestPartnerLinkHelp', { linkId: r.data.linkId, note: 'Driver phone is off' });
  assert.equal(help.data.status, 'Office review');
  const link = (await db.doc(`partner_links/${r.data.linkId}`).get()).data();
  assert.equal(link.officeHelp, true);
  // the driver agreed by phone, so the office approves with an override and a reason
  const ok = await call(U.admin, 'decidePartnerLink', { linkId: r.data.linkId, decision: 'approve', override: true, reason: 'Driver confirmed on a call' });
  assert.equal(ok.ok, true, ok.message);
  assert.equal((await db.doc(`drivers/${U.drvLast}`).get()).data().vendorId, U.vA);

  // staff start a link for a vendor
  await db.doc('vehicles/carZ').set({ vehicleNumber: 'TN 60 ZZ 3333', vendorId: U.vB, docStatus: 'Approved', status: 'Active' });
  const s = await call(U.admin, 'adminCreatePartnerLink', { kind: 'vehicle', plate: 'TN60ZZ3333', toVendorId: U.vA, sendOtp: false });
  assert.equal(s.data.status, 'Office review');
  assert.equal((await call(U.adminOps, 'adminCreatePartnerLink', { kind: 'vehicle', plate: 'TN60ZZ3333', toVendorId: U.vA })).ok, false, 'needs the fleet permission');
});

test('clients can read their own requests but never write them or read the codes', async () => {
  const mine = await db.collection('partner_links').where('toVendorId', '==', U.vA).limit(1).get();
  const id = mine.docs[0].id;
  assert.equal((await rest(U.vA, `partner_links/${id}`)).status, 200);
  assert.equal((await rest(U.pending, `partner_links/${id}`)).status, 403);
  assert.equal((await rest(U.vA, `partner_link_secrets/${id}`)).status, 403);
  assert.equal((await rest(U.admin, `partner_link_secrets/${id}`)).status, 403);
  const w = await clientCreate(U.vA, 'partner_links', 'forged1', { kind: 'vehicle', status: 'Completed', toVendorId: U.vA });
  assert.equal(w.ok, false);
  assert.equal((await rest(U.admin, `partner_links/${id}`)).status, 200);
});
