// Advance-booking workflow against the Firebase emulators (auth + firestore +
// functions): real callables, real security rules. Nothing touches production.
//
//   npm run build
//   ROUTING_URL=http://127.0.0.1:8765 npx firebase-tools@13 emulators:exec \
//     --config ../firebase.e2e.json --project demo-nesam --only auth,firestore,functions \
//     "node --test test/advanceBooking.e2e.test.js"
//
// The test starts a tiny routing stub on :8765 (the functions read ROUTING_URL), so no network is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');

const PROJECT = 'demo-nesam';
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;

const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;

// ── helpers ───────────────────────────────────────────────────────────────

const tokens = {};
async function tokenFor(uid) {
  if (tokens[uid]) return tokens[uid];
  try { await admin.auth().createUser({ uid }); } catch { /* exists */ }
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  tokens[uid] = (await r.json()).idToken;
  return tokens[uid];
}

/** Calls a callable as `uid`. Resolves { ok, data } or { ok:false, status, message, details }. */
async function call(uid, name, data) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` }, body: JSON.stringify({ data }),
  });
  const body = await r.json();
  if (body.error) return { ok: false, status: body.error.status, message: body.error.message, details: body.error.details };
  return { ok: true, data: body.result };
}

/** Reads a document through the security rules, as `uid`. */
async function rest(uid, path) {
  const r = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${await tokenFor(uid)}` } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const val = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { stringValue: String(v) });
const docName = (path) => `projects/${PROJECT}/databases/(default)/documents/${path}`;

/** The vendor accepts the current offer through the server (no client write can assign a duty). */
const claimAsVendor = (vendorUid, bookingId) => call(vendorUid, 'claimMarketplaceDuty', { bookingId });

/** A direct client write to a booking — must always be refused by the rules. */
async function clientPatch(uid, path, fields) {
  const r = await fetch(`${FS}/${path}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)])) }),
  });
  return { ok: r.ok, status: r.status };
}

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const place = (name, lat, lng) => ({ name, address: `${name}, Tamil Nadu`, lat, lng, type: 'other' });

let counter = 0;
const rid = (p) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}abcdefgh`;

/** Creates a booking as `customer`, retrying once with the server's own quote (the app does the same). */
async function bookAs(customer, over = {}) {
  const base = {
    requestId: rid('bk'), pickup: place('Theni', 10.0104, 77.4768), drop: place('Madurai', 9.9195, 78.1193), categoryId: 'sedan',
    tripType: 'One Way', paymentMethod: 'Cash', scheduledAt: inHours(5), termsAccepted: true, expectedFare: 0, notes: '', couponCode: '', ...over,
  };
  let r = await call(customer, 'createBooking', base);
  if (!r.ok && r.details?.fare?.total) r = await call(customer, 'createBooking', { ...base, expectedFare: r.details.fare.total });
  return { ...r, requestId: base.requestId };
}

const booking = async (id) => (await db.doc(`bookings/${id}`).get()).data();
const market = async (id) => (await db.doc(`marketplace_trips/${id}`).get()).data();

// ── world ─────────────────────────────────────────────────────────────────

const U = { admin: 'adm1', cust: 'cust1', vendorA: 'vendA', vendorB: 'vendB', driverVA: 'drvVA', owner: 'drvOwner', ownerBig: 'drvOwnerBig', otherVendorDriver: 'drvVB' };
let routingStub;

test.before(async () => {
  routingStub = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 80000, duration: 5400 }] }));
  });
  await new Promise((resolve) => routingStub.listen(8765, '127.0.0.1', resolve));

  const fare = { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 };
  await db.doc('vehicle_categories/sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', seatingCapacity: 4, displayOrder: 1, fare });
  await db.doc('vehicle_categories/suv').set({ name: 'SUV', status: 'Active', code: 'suv', seatingCapacity: 7, displayOrder: 2, fare: { ...fare, perKmRate: 21 } });
  await db.doc('business_config/commission').set({ base: 'taxable', global: { rate: 10 }, services: {}, categories: {}, version: 1 });
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Test Admin' });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Priya', phone: '+919876543210', email: 'p@example.com', walletBalance: 0 });
  for (const v of [U.vendorA, U.vendorB]) await db.doc(`vendors/${v}`).set({ status: 'APPROVED', companyName: `Fleet ${v}`, name: v });
  // Vendor A's fleet: one approved 4-seat vehicle (right for Sedan, too small for SUV).
  await db.doc('vehicles/vehA1').set({ vendorId: U.vendorA, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN01AB1001', seatingCapacity: 4, category: 'Sedan' });
  await db.doc('vehicles/vehB1').set({ vendorId: U.vendorB, docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN02CD2002', seatingCapacity: 4, category: 'Sedan' });
  await db.doc(`drivers/${U.driverVA}`).set({ status: 'Approved', vendorId: U.vendorA, name: 'Murugan', phone: '+919791234567', presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: 'sedan' });
  await db.doc(`drivers/${U.otherVendorDriver}`).set({ status: 'Approved', vendorId: U.vendorB, name: 'Kumar', phone: '+919791234568', presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: 'sedan' });
  // Independent Owner Drivers with their own approved vehicle record.
  await db.doc('vehicles/vehO1').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN03EF3003', seatingCapacity: 4, assignedDriverId: U.owner });
  await db.doc(`drivers/${U.owner}`).set({ status: 'Approved', name: 'Selvam', phone: '+919791234569', presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: 'sedan', assignedVehicleId: 'vehO1', assignedVehicleNumber: 'TN03EF3003' });
  await db.doc('vehicles/vehO2').set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: 'TN04GH4004', seatingCapacity: 4, assignedDriverId: U.ownerBig });
  await db.doc(`drivers/${U.ownerBig}`).set({ status: 'Approved', name: 'Raja', phone: '+919791234570', presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: 'sedan', assignedVehicleId: 'vehO2', assignedVehicleNumber: 'TN04GH4004' });
});

test.after(async () => {
  await new Promise((resolve) => routingStub.close(resolve));
});

// ── 1 / 2 / 10: creating advance bookings ─────────────────────────────────

let first;
test('1. a future booking reaches Pending Review and is invisible to partners', async () => {
  first = await bookAs(U.cust);
  assert.equal(first.ok, true, JSON.stringify(first));
  const b = await booking(first.requestId);
  assert.equal(b.status, 'Pending');
  assert.equal(b.rideTiming, 'scheduled');
  assert.equal(b.bookingType, 'advance');
  assert.equal(b.termsAccepted, true);
  assert.equal(b.passengerSeatsRequired, 4);
  assert.ok(b.pickupAt.toMillis() > Date.now() + 4 * 3600000);
  // No marketplace record exists, so there is nothing a partner could ever read.
  assert.equal((await db.doc(`marketplace_trips/${first.requestId}`).get()).exists, false);
  for (const partner of [U.vendorA, U.owner]) {
    const r = await rest(partner, `marketplace_trips/${first.requestId}`);
    assert.notEqual(r.status, 200, `${partner} must not read an unpublished booking`);
  }
  // Nor can partners read the booking itself before it is theirs.
  assert.notEqual((await rest(U.vendorA, `bookings/${first.requestId}`)).status, 200);
});

test('2. a missing, past, too-soon, ambiguous or too-late pickup is rejected by the server', async () => {
  const cases = [
    { scheduledAt: undefined, why: 'missing' },
    { scheduledAt: null, why: 'null' },
    { scheduledAt: new Date(Date.now() - 3600000).toISOString(), why: 'past' },
    { scheduledAt: new Date(Date.now() + 10 * 60000).toISOString(), why: 'inside the notice period' },
    { scheduledAt: '2030-01-01T10:00', why: 'no time zone' },
    { scheduledAt: inHours(24 * 45), why: 'beyond the horizon' },
  ];
  for (const c of cases) {
    const r = await bookAs(U.cust, { scheduledAt: c.scheduledAt });
    assert.equal(r.ok, false, `${c.why} must be rejected`);
    assert.equal(r.status, 'INVALID_ARGUMENT', `${c.why}: ${r.message}`);
    assert.equal((await db.doc(`bookings/${r.requestId}`).get()).exists, false);
  }
  const noTerms = await bookAs(U.cust, { termsAccepted: false });
  assert.equal(noTerms.ok, false);
  assert.equal(noTerms.status, 'FAILED_PRECONDITION');
});

test('10. several future bookings can be open at the same time', async () => {
  const second = await bookAs(U.cust, { scheduledAt: inHours(30) });
  const third = await bookAs(U.cust, { scheduledAt: inHours(52), categoryId: 'suv' });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(third.ok, true, JSON.stringify(third));
  const pending = await db.collection('bookings').where('customerId', '==', U.cust).where('status', '==', 'Pending').get();
  assert.ok(pending.size >= 3);
});

// ── 3: approval ───────────────────────────────────────────────────────────

test('3. approval alone does not publish or notify partners', async () => {
  const before = (await db.collection('notifications').where('title', '==', 'New trip available').get()).size;
  const r = await call(U.admin, 'approveBooking', { bookingId: first.requestId });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.published, false);
  assert.equal(r.data.partnersNotified, 0);
  assert.equal((await booking(first.requestId)).status, 'Approved');
  const m = await market(first.requestId);
  assert.ok(!m || !['Open', 'Bidding'].includes(m.status));
  assert.equal((await db.collection('notifications').where('title', '==', 'New trip available').get()).size, before);
  assert.notEqual((await rest(U.vendorA, `marketplace_trips/${first.requestId}`)).status, 200);
  // The customer is told it is approved and being arranged — not that a driver is assigned.
  const note = (await db.collection('notifications').where('recipientId', '==', U.cust).where('title', '==', 'Booking approved').get()).docs[0].data();
  assert.match(note.message, /arranging your vehicle/);
  assert.doesNotMatch(note.message, /finding your driver/i);
});

// ── 4 / 5: direct Vendor assignment ───────────────────────────────────────

test('4. direct Vendor assignment works without a marketplace record', async () => {
  assert.equal((await db.doc(`marketplace_trips/${first.requestId}`).get()).exists, false);
  const r = await call(U.admin, 'assignVendor', { bookingId: first.requestId, vendorId: U.vendorA, reason: 'Regular partner' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = await booking(first.requestId);
  assert.equal(b.status, 'Confirmed');
  assert.equal(b.assignedVendorId, U.vendorA);
  assert.ok(b.vendorPayout > 0);
  assert.equal(b.fulfilmentRoute, 'vendor');
  assert.ok(!b.assignedDriverId, 'no driver is claimed to exist yet');
  assert.equal((await db.doc(`marketplace_trips/${first.requestId}`).get()).exists, false);
  const history = await db.collection(`bookings/${first.requestId}/assignments`).get();
  assert.equal(history.docs.some((d) => d.data().action === 'assign_vendor'), true);
  // The customer sees progress that is true: a partner has it, driver details pending.
  const note = (await db.collection('notifications').where('recipientId', '==', U.cust).where('title', '==', 'Your booking is with a NESAM partner').get()).docs[0].data();
  assert.match(note.message, /Driver and vehicle details will follow/);
  // An unapproved vendor or a second assignment is refused.
  const again = await call(U.admin, 'assignVendor', { bookingId: first.requestId, vendorId: U.vendorB });
  assert.equal(again.ok, false);
});

test('5. the vendor dispatches a driver with the selected vehicle id and matching registration', async () => {
  const wrongVendor = await call(U.vendorB, 'vendorAssignDriver', { bookingId: first.requestId, driverId: U.otherVendorDriver, vehicleId: 'vehB1' });
  assert.equal(wrongVendor.ok, false, 'a vendor cannot dispatch a booking it does not hold');
  const foreignVehicle = await call(U.vendorA, 'vendorAssignDriver', { bookingId: first.requestId, driverId: U.driverVA, vehicleId: 'vehB1' });
  assert.equal(foreignVehicle.ok, false, 'a vehicle from another fleet is refused');
  const foreignDriver = await call(U.vendorA, 'vendorAssignDriver', { bookingId: first.requestId, driverId: U.otherVendorDriver, vehicleId: 'vehA1' });
  assert.equal(foreignDriver.ok, false, 'a driver from another fleet is refused');
  const r = await call(U.vendorA, 'vendorAssignDriver', { bookingId: first.requestId, driverId: U.driverVA, vehicleId: 'vehA1' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = await booking(first.requestId);
  assert.equal(b.status, 'Assigned');
  assert.equal(b.assignedDriverId, U.driverVA);
  assert.equal(b.assignedVehicleId, 'vehA1');
  assert.equal(b.assignedVehicleNumber, 'TN01AB1001');
  assert.equal(b.assignedVendorId, U.vendorA);
  assert.equal(b.tripSubStatus, 'Not Started');
  const note = (await db.collection('notifications').where('recipientId', '==', U.cust).where('title', '==', 'Driver assigned').get()).docs[0].data();
  assert.match(note.message, /Murugan \(TN01AB1001\)/);
});

test('5b. a vehicle without enough seats cannot take the duty (capacity is separate from model)', async () => {
  const suv = (await db.collection('bookings').where('customerId', '==', U.cust).where('vehicleCategoryId', '==', 'suv').get()).docs[0];
  assert.equal((await call(U.admin, 'approveBooking', { bookingId: suv.id })).ok, true);
  assert.equal((await call(U.admin, 'assignVendor', { bookingId: suv.id, vendorId: U.vendorA })).ok, true);
  // Vendors see the duty regardless of fleet; assigning the 4-seat vehicle to a 7-seat booking is refused.
  const r = await call(U.vendorA, 'vendorAssignDriver', { bookingId: suv.id, driverId: U.driverVA, vehicleId: 'vehA1' });
  assert.equal(r.ok, false);
  assert.match(r.message, /needs 7/);
});

// ── 6: direct Owner Driver assignment ─────────────────────────────────────

let second;
test('6. direct Owner Driver assignment works without publishing', async () => {
  second = await bookAs(U.cust, { scheduledAt: inHours(8) });
  assert.equal(second.ok, true, JSON.stringify(second));
  // Before approval the driver route is refused.
  const early = await call(U.admin, 'assignDriver', { bookingId: second.requestId, driverId: U.owner });
  assert.equal(early.ok, false);
  assert.equal((await call(U.admin, 'approveBooking', { bookingId: second.requestId })).ok, true);
  const r = await call(U.admin, 'assignDriver', { bookingId: second.requestId, driverId: U.owner });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = await booking(second.requestId);
  assert.equal(b.status, 'Assigned');
  assert.equal(b.assignedDriverId, U.owner);
  assert.equal(b.assignedVehicleId, 'vehO1');
  assert.equal(b.assignedVehicleNumber, 'TN03EF3003');
  assert.ok(b.driverPayout > 0);
  assert.ok(!b.assignedVendorId);
  assert.equal(b.fulfilmentRoute, 'driver');
  assert.equal((await db.doc(`marketplace_trips/${second.requestId}`).get()).exists, false);
});

test('6b. a booking reserved to a vendor cannot be handed to an outside driver', async () => {
  const held = await bookAs(U.cust, { scheduledAt: inHours(20) });
  await call(U.admin, 'approveBooking', { bookingId: held.requestId });
  await call(U.admin, 'assignVendor', { bookingId: held.requestId, vendorId: U.vendorA });
  const r = await call(U.admin, 'assignDriver', { bookingId: held.requestId, driverId: U.owner });
  assert.equal(r.ok, false);
  assert.match(r.message, /reserved to/);
});

// ── 7: explicit publication ───────────────────────────────────────────────

let published;
test('7. explicit publication exposes the duty to eligible partners only', async () => {
  published = await bookAs(U.cust, { scheduledAt: inHours(12) });
  await call(U.admin, 'approveBooking', { bookingId: published.requestId });
  assert.notEqual((await rest(U.vendorB, `marketplace_trips/${published.requestId}`)).status, 200);
  const r = await call(U.admin, 'postBookingToMarketplace', { booking: published.requestId });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.data.partnersNotified >= 2);
  const m = await market(published.requestId);
  assert.equal(m.status, 'Open');
  assert.ok(m.offeredPayout > 0);
  assert.ok(Array.isArray(m.eligibleVehicleTypes) && m.eligibleVehicleTypes.length > 0);
  // The offer shows the area, never the exact address or the customer's contact details.
  assert.equal(m.customerPhone, undefined);
  assert.equal(m.pickup.address, 'Theni');
  for (const partner of [U.vendorA, U.vendorB, U.owner]) {
    assert.equal((await rest(partner, `marketplace_trips/${published.requestId}`)).status, 200, `${partner} should see the published duty`);
  }
  assert.equal((await booking(published.requestId)).fulfilmentRoute, 'marketplace');
  // Publishing something that is not approved or already held is refused.
  const pend = await bookAs(U.cust, { scheduledAt: inHours(40) });
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: pend.requestId })).ok, false);
  assert.equal((await call(U.admin, 'postBookingToMarketplace', { booking: first.requestId })).ok, false);
});

// ── 8 / 9: races and stale claims ─────────────────────────────────────────

test('8. a vendor claim and an admin assignment racing for one duty produce one winner', async () => {
  const dutyId = (await bookAs(U.cust, { scheduledAt: inHours(14) })).requestId;
  await call(U.admin, 'approveBooking', { bookingId: dutyId });
  await call(U.admin, 'postBookingToMarketplace', { booking: dutyId });
  const [claim, direct] = await Promise.all([
    claimAsVendor(U.vendorA, dutyId),
    call(U.admin, 'assignDriver', { bookingId: dutyId, driverId: U.ownerBig }),
  ]);
  const winners = [claim.ok, direct.ok].filter(Boolean).length;
  assert.equal(winners, 1, `claim=${claim.ok}/${claim.message} direct=${direct.ok}/${direct.message}`);
  const b = await booking(dutyId);
  assert.equal(Boolean(b.assignedVendorId) !== Boolean(b.assignedDriverId), true, 'exactly one holder');
  assert.equal(['Confirmed', 'Assigned'].includes(b.status), true);
  assert.equal((await market(dutyId)).status, 'Assigned');
});

test('8b. two vendors claiming the same published duty: one wins', async () => {
  const dutyId = (await bookAs(U.cust, { scheduledAt: inHours(16) })).requestId;
  await call(U.admin, 'approveBooking', { bookingId: dutyId });
  await call(U.admin, 'postBookingToMarketplace', { booking: dutyId });
  const [a, b] = await Promise.all([claimAsVendor(U.vendorA, dutyId), claimAsVendor(U.vendorB, dutyId)]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1);
  const holder = (await booking(dutyId)).assignedVendorId;
  assert.equal(holder, a.ok ? U.vendorA : U.vendorB);
});

test('9. a stale claim fails after a direct assignment or a cancellation', async () => {
  // Published, then directly assigned to a vendor: the offer is closed in the same transaction.
  const one = (await bookAs(U.cust, { scheduledAt: inHours(18) })).requestId;
  await call(U.admin, 'approveBooking', { bookingId: one });
  await call(U.admin, 'postBookingToMarketplace', { booking: one });
  assert.equal((await call(U.admin, 'assignVendor', { bookingId: one, vendorId: U.vendorA })).ok, true);
  assert.equal((await market(one)).status, 'Assigned');
  const stale = await claimAsVendor(U.vendorB, one);
  assert.equal(stale.ok, false);
  assert.equal((await booking(one)).assignedVendorId, U.vendorA);

  // Published, then cancelled by admin: nobody can claim it afterwards.
  const two = (await bookAs(U.cust, { scheduledAt: inHours(22) })).requestId;
  await call(U.admin, 'approveBooking', { bookingId: two });
  await call(U.admin, 'postBookingToMarketplace', { booking: two });
  assert.equal((await call(U.admin, 'cancelBooking', { bookingId: two, reason: 'Customer asked to cancel' })).ok, true);
  const late = await claimAsVendor(U.vendorB, two);
  assert.equal(late.ok, false);
  assert.equal((await booking(two)).status, 'Cancelled');
});

test('9b. removing an assignment returns the booking to awaiting fulfilment without republishing it', async () => {
  const id = (await bookAs(U.cust, { scheduledAt: inHours(26) })).requestId;
  await call(U.admin, 'approveBooking', { bookingId: id });
  await call(U.admin, 'postBookingToMarketplace', { booking: id });
  await call(U.admin, 'assignDriver', { bookingId: id, driverId: U.ownerBig });
  const r = await call(U.admin, 'assignDriver', { bookingId: id, reason: 'Driver unavailable' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await booking(id)).status, 'Approved');
  assert.equal((await market(id)).status, 'Closed');
  assert.notEqual((await rest(U.vendorA, `marketplace_trips/${id}`)).status, 200);
});

// ── 12: historical and downstream compatibility ───────────────────────────

test('12. historical bookings and the payment flow keep working', async () => {
  // A booking made under the previous flow: approved, and already open on the marketplace.
  const legacy = 'legacyBooking0001';
  await db.doc(`bookings/${legacy}`).set({
    id: legacy, bookingId: 'NT-LEGACY-1', customerId: U.cust, customer: 'Priya', phone: '+919876543210', status: 'Approved', fare: 1800, fareVerified: true,
    fareBreakdown: { total: 1800, taxableAmount: 1714.29, subtotal: 1714.29, gst: 85.71 }, commission: { rate: 10, base: 'taxable', source: 'global', policyVersion: 1 },
    pickup: 'Theni', drop: 'Madurai', pickupLat: 10.01, pickupLng: 77.47, dropLat: 9.92, dropLng: 78.12, vehicleCategory: 'Sedan', vehicleCategoryId: 'sedan',
    rideTiming: 'now', date: '01 Oct 2026', time: 'Now', pickupAt: TS.fromMillis(Date.now() + 70 * 3600000), tripSubStatus: 'Not Started', createdAt: TS.now(),
  });
  await db.doc(`marketplace_trips/${legacy}`).set({ id: legacy, status: 'Open', offeredPayout: 1500, vehicleCategoryId: 'sedan', eligibleVehicleTypes: ['sedan'], pickup: { address: 'Theni' }, drop: { address: 'Madurai' } });
  assert.equal((await rest(U.vendorB, `marketplace_trips/${legacy}`)).status, 200, 'an already-open duty stays open');
  const r = await call(U.admin, 'assignDriver', { bookingId: legacy, driverId: U.owner });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = await booking(legacy);
  assert.equal(b.driverPayout, 1500, 'the published offer is the agreed payout');
  assert.equal((await market(legacy)).status, 'Assigned');

  // Payments and the boarding OTP are untouched by the new flow.
  const assigned = first.requestId;
  const pay = await call(U.admin, 'recordPayment', { bookingId: assigned, amount: 500, method: 'Cash', collectorType: 'admin', requestId: rid('pay') });
  assert.equal(pay.ok, true, JSON.stringify(pay));
  assert.equal((await booking(assigned)).paymentSummary.totalPaid, 500);
  const secret = (await db.doc(`booking_secrets/${assigned}`).get()).data();
  assert.match(secret.otp, /^\d{4}$/);
  assert.equal(secret.customerId, U.cust);
  // Customers keep seeing their own bookings, and only theirs.
  assert.equal((await rest(U.cust, `bookings/${assigned}`)).status, 200);
  assert.notEqual((await rest(U.vendorB, `bookings/${assigned}`)).status, 200);
});
