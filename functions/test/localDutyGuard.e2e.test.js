// Local duty validation, checked against the emulators with the real firestore.rules (demo project — nothing here can reach
// production):
//   • the fleet partner and the driver run a duty only through the server functions, and valid actions succeed;
//   • a refused action leaves the duty record exactly as it was;
//   • no client (driver, fleet partner or staff) can create, change or delete a local_shifts record directly;
//   • the duty's own driver, fleet partner and staff can still read it, with the queries the apps use;
//   • the duty's active driver can send the position with localShiftPing, and nobody else can.
//   npm run test:e2e:localduty
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, TS, call, rest, clientPatch, clientCreate, tokenFor, FS } = H;

const U = { vendor: 'ldVendor', otherVendor: 'ldOtherVendor', drv: 'ldDriver', owner: 'ldOwner', stranger: 'ldStranger', admin: 'ldAdmin' };
const HERE = { lat: 10.0204, lng: 77.4868, accuracy: 20 };
const PICKUP = { lat: 10.0104, lng: 77.4768 };

const duty = async (id) => (await db.doc(`local_shifts/${id}`).get()).data();
const dutyCount = async () => (await db.collection('local_shifts').get()).size;
const inMs = (hours) => Date.now() + hours * 3600000;

/** Calls `name` expecting a refusal, and checks the duty record did not change at all. */
async function refusedUnchanged(uid, name, data, shiftId, pattern) {
  const before = await duty(shiftId);
  const r = await call(uid, name, data);
  assert.equal(r.ok, false, `${name} should be refused, got ${JSON.stringify(r.data)}`);
  if (pattern) assert.match(r.message, pattern);
  assert.deepEqual(await duty(shiftId), before, `${name} was refused but the duty record changed`);
  return r;
}

async function ok(uid, name, data) {
  const r = await call(uid, name, data);
  assert.equal(r.ok, true, `${name}: ${r.message}`);
  return r.data;
}

/** A list query through the rules, shaped like the apps' where(field, '==', uid). */
async function query(uid, field, value) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'local_shifts' }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } }),
  });
  const body = await r.json();
  return { status: r.status, ids: Array.isArray(body) ? body.filter((x) => x.document).map((x) => x.document.name.split('/').pop()) : [] };
}

async function clientDelete(uid, path) {
  const r = await fetch(`${FS}/${path}`, { method: 'DELETE', headers: { authorization: `Bearer ${await tokenFor(uid)}` } });
  return r.status;
}

const vehicle = (vendorId, driverId, number) => ({ vendorId, assignedDriverId: driverId, vehicleNumber: number, docStatus: 'Approved', status: 'Active', category: 'Sedan', make: 'Toyota', model: 'Etios', seatingCapacity: 5 });

let shiftId = '';

test.before(async () => {
  await db.doc(`vendors/${U.vendor}`).set({ status: 'Approved', companyName: 'LD Fleet' });
  await db.doc(`vendors/${U.otherVendor}`).set({ status: 'Approved', companyName: 'Other Fleet' });
  await db.doc(`drivers/${U.drv}`).set({ status: 'Approved', vendorId: U.vendor, assignedVehicleId: 'ldVeh', name: 'LD Driver' });
  await db.doc(`drivers/${U.owner}`).set({ status: 'Approved', vendorId: '', assignedVehicleId: 'ldOwnVeh', name: 'LD Owner' });
  await db.doc(`drivers/${U.stranger}`).set({ status: 'Approved', vendorId: '', assignedVehicleId: '', name: 'LD Stranger' });
  await db.doc(`vehicles/ldVeh`).set(vehicle(U.vendor, U.drv, 'TN00LD0001'));
  await db.doc(`vehicles/ldOwnVeh`).set(vehicle('', U.owner, 'TN00LD0002'));
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'LD Admin' });
});

test('the fleet partner plans a duty through the server; a refused plan creates nothing', async () => {
  const input = { driverId: U.drv, vehicleId: 'ldVeh', cityName: 'Theni', services: ['pickup_drop', 'rental'], startsAt: 'now', endsAt: inMs(8), radiusKm: 15, note: '' };
  const made = await ok(U.vendor, 'createLocalShift', input);
  shiftId = made.shiftId;
  assert.equal((await duty(shiftId)).status, 'Scheduled', 'a new duty waits for the driver’s photo check and start');

  // The apps' built-in city list has no server records, so such an id is refused (the Vendor app sends the name alone).
  const unknownCity = await call(U.owner, 'createLocalShift', { cityId: 'erode', cityName: 'Erode', services: ['pickup_drop'], startsAt: 'now', endsAt: inMs(4) });
  assert.equal(unknownCity.ok, false);
  assert.match(unknownCity.message, /Choose an active city/);

  const clash = await call(U.vendor, 'createLocalShift', input);
  assert.equal(clash.ok, false);
  assert.match(clash.message, /already has local duty/);
  const foreign = await call(U.otherVendor, 'createLocalShift', input);
  assert.equal(foreign.ok, false);
  assert.match(foreign.message, /your own fleet/);
  const noVehicle = await call(U.stranger, 'createLocalShift', { cityName: 'Theni', services: ['pickup_drop'], startsAt: 'now', endsAt: inMs(8) });
  assert.equal(noVehicle.ok, false);
  assert.match(noVehicle.message, /Attach an approved vehicle/);
  assert.equal(await dutyCount(), 1);
});

test('an owner-driver plans their own duty through the server, and can cancel it', async () => {
  const made = await ok(U.owner, 'createLocalShift', { cityName: 'Theni', services: ['pickup_drop'], startsAt: 'now', endsAt: inMs(4) });
  assert.equal((await duty(made.shiftId)).status, 'Scheduled');
  assert.equal((await ok(U.owner, 'endLocalShift', { shiftId: made.shiftId })).status, 'Cancelled');
  assert.equal((await duty(made.shiftId)).status, 'Cancelled');
});

test('the duty is readable by its driver, its fleet partner and staff, and by nobody else', async () => {
  for (const uid of [U.drv, U.vendor, U.admin]) assert.equal((await rest(uid, `local_shifts/${shiftId}`)).status, 200, uid);
  for (const uid of [U.stranger, U.otherVendor]) assert.equal((await rest(uid, `local_shifts/${shiftId}`)).status, 403, uid);
  assert.deepEqual(await query(U.drv, 'driverId', U.drv), { status: 200, ids: [shiftId] });
  assert.deepEqual(await query(U.vendor, 'vendorId', U.vendor), { status: 200, ids: [shiftId] });
  assert.equal((await query(U.stranger, 'driverId', U.drv)).status, 403);
});

test('no client can create, change or delete a duty record directly', async () => {
  const before = await duty(shiftId);
  for (const uid of [U.drv, U.vendor, U.admin]) {
    for (const [field, value] of [['status', 'Active'], ['status', 'Ended'], ['paused', true], ['verification', 'Submitted'], ['lastLocation', 'here'], ['endsAt', 'later'], ['services', 'rental'], ['radiusKm', 99], ['releases', 0]]) {
      assert.equal((await clientPatch(uid, `local_shifts/${shiftId}`, { [field]: value })).status, 403, `${uid} changed ${field}`);
    }
    assert.equal(await clientDelete(uid, `local_shifts/${shiftId}`), 403, `${uid} deleted the duty`);
  }
  assert.equal((await clientCreate(U.drv, 'local_shifts', 'forgedByDriver', { driverId: U.drv, vendorId: U.vendor, status: 'Active' })).status, 403);
  assert.equal((await clientCreate(U.vendor, 'local_shifts', 'forgedByVendor', { driverId: U.drv, vendorId: U.vendor, status: 'Active' })).status, 403);
  assert.deepEqual(await duty(shiftId), before);
  assert.equal(await dutyCount(), 2);
});

test('a start is refused until the photo check, and for anyone but the duty’s driver', async () => {
  await refusedUnchanged(U.drv, 'localShiftAction', { shiftId, action: 'start', location: HERE }, shiftId, /photo check/i);
  await refusedUnchanged(U.stranger, 'localShiftAction', { shiftId, action: 'start', location: HERE }, shiftId, /not assigned to you/);
  await refusedUnchanged(U.drv, 'localShiftAction', { shiftId, action: 'pause' }, shiftId, /Start the duty first/);
  // A ping does nothing before the duty is running.
  const before = await duty(shiftId);
  assert.deepEqual(await ok(U.drv, 'localShiftPing', { shiftId, location: HERE }), { ok: false });
  assert.deepEqual(await duty(shiftId), before);
});

test('a start is refused when the vehicle is no longer approved', async () => {
  // The photo check itself has its own flow (camera uploads); here its stored result is what the start looks at.
  await db.doc(`local_shifts/${shiftId}`).update({ verification: { status: 'Submitted' } });
  await db.doc('vehicles/ldVeh').update({ docStatus: 'Pending' });
  await refusedUnchanged(U.drv, 'localShiftAction', { shiftId, action: 'start', location: HERE }, shiftId, /not approved/);
  await db.doc('vehicles/ldVeh').update({ docStatus: 'Approved' });
});

test('after the photo check the driver starts, takes a break and resumes', async () => {
  await ok(U.drv, 'localShiftAction', { shiftId, action: 'start', location: HERE });
  let s = await duty(shiftId);
  assert.equal(s.status, 'Active');
  assert.equal(s.lastLocation.lat, HERE.lat);
  await ok(U.drv, 'localShiftAction', { shiftId, action: 'pause' });
  assert.equal((await duty(shiftId)).paused, true);
  await refusedUnchanged(U.stranger, 'localShiftAction', { shiftId, action: 'resume' }, shiftId);
  await ok(U.drv, 'localShiftAction', { shiftId, action: 'resume' });
  s = await duty(shiftId);
  assert.equal(s.paused, false);
});

test('the active driver’s localShiftPing saves the position and riders nearby see the cab; others cannot ping', async () => {
  await db.doc(`local_shifts/${shiftId}`).update({ lastLocation: { lat: HERE.lat, lng: HERE.lng, at: TS.fromMillis(Date.now() - 11 * 60000) } });
  const moved = { lat: 10.0151, lng: 77.4802, accuracy: 12 };
  assert.deepEqual(await ok(U.drv, 'localShiftPing', { shiftId, location: moved }), { ok: true });
  const s = await duty(shiftId);
  assert.equal(s.lastLocation.lat, moved.lat);
  assert.equal(s.lastLocation.lng, moved.lng);
  assert.ok(Date.now() - s.lastLocation.at.toMillis() < 60000, 'the position is stamped now');
  await refusedUnchanged(U.stranger, 'localShiftPing', { shiftId, location: HERE }, shiftId, /not assigned to you/);
  await refusedUnchanged(U.vendor, 'localShiftPing', { shiftId, location: HERE }, shiftId, /not assigned to you/);
  // The running-duty list is cached for 15 s per server instance.
  await new Promise((r) => setTimeout(r, 16000));
  const seen = await ok(U.stranger, 'nearbyLocalDrivers', { ...PICKUP, mode: 'pickup_drop' });
  assert.equal(seen.count, 1);
  assert.deepEqual(Object.keys(seen.drivers[0]).sort(), ['kind', 'lat', 'lng']);
});

test('the fleet partner changes the duty through the server; refused changes leave it as it was', async () => {
  // One field at a time, as the Change sheet sends it.
  assert.equal((await ok(U.vendor, 'updateLocalShift', { shiftId, radiusKm: 20 })).changed, true);
  assert.equal((await duty(shiftId)).radiusKm, 20);
  assert.equal((await ok(U.vendor, 'updateLocalShift', { shiftId, services: ['pickup_drop'] })).changed, true);
  assert.deepEqual((await duty(shiftId)).services, ['pickup_drop']);
  const endsAt = inMs(9);
  assert.equal((await ok(U.vendor, 'updateLocalShift', { shiftId, endsAt })).changed, true);
  assert.equal((await duty(shiftId)).endsAt.toMillis(), endsAt);
  await refusedUnchanged(U.vendor, 'updateLocalShift', { shiftId, endsAt: Date.now() - 60000 }, shiftId, /at least 5 minutes/);
  await refusedUnchanged(U.vendor, 'updateLocalShift', { shiftId, services: [] }, shiftId, /Choose Hourly Rental/);
  await refusedUnchanged(U.otherVendor, 'updateLocalShift', { shiftId, radiusKm: 5 }, shiftId, /not found in your fleet/);
});

test('handing back an order that is not the driver’s is refused and changes nothing', async () => {
  await db.doc('bookings/ldBooking').set({ status: 'Confirmed', assignedDriverId: '', localShiftId: '' });
  await refusedUnchanged(U.drv, 'releaseLocalOrder', { shiftId, bookingId: 'ldBooking', reason: 'Too far' }, shiftId, /no longer yours/);
  assert.deepEqual((await db.doc('bookings/ldBooking').get()).data(), { status: 'Confirmed', assignedDriverId: '', localShiftId: '' });
});

test('only the duty’s driver or fleet partner can end it; an ended duty cannot be revived', async () => {
  await refusedUnchanged(U.stranger, 'endLocalShift', { shiftId }, shiftId, /not yours/);
  await refusedUnchanged(U.otherVendor, 'endLocalShift', { shiftId }, shiftId, /not yours/);
  assert.equal((await ok(U.drv, 'endLocalShift', { shiftId, reason: 'Done for today' })).status, 'Ended');
  assert.equal((await duty(shiftId)).status, 'Ended');
  await refusedUnchanged(U.drv, 'localShiftAction', { shiftId, action: 'start', location: HERE }, shiftId, /closed/);
  await refusedUnchanged(U.drv, 'localShiftAction', { shiftId, action: 'resume' }, shiftId);
  await refusedUnchanged(U.vendor, 'updateLocalShift', { shiftId, radiusKm: 10 }, shiftId);
  const before = await duty(shiftId);
  assert.deepEqual(await ok(U.drv, 'localShiftPing', { shiftId, location: HERE }), { ok: false });
  assert.deepEqual(await duty(shiftId), before);
});
