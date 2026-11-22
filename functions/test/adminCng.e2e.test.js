// Office (admin) quotes and bookings priced on CNG: the Quick Fare desk's CNG / Diesel switch.
//   Runs inside the emulators: npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json --project demo-nesam --only auth,firestore,functions "node --test test/adminCng.e2e.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');
const H = require('./helpers.e2e');
const { db, call, rid, place, inHours } = H;
const admin = 'cng-master';
let routing;
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };
const request = (categoryId, extra = {}) => {
  const pickup = place('Theni', 10.0104, 77.4768), drop = place('Madurai', 9.9195, 78.1193);
  return { pickup, drop, pickupPoint: pickup, dropPoint: drop, tripType: 'One Way', scheduledAt: inHours(5), categoryId, customerName: 'CNG Rider', customerPhone: '+919000000002', paymentMethod: 'Cash', termsAccepted: true, brand: 'nesam', ...extra };
};

// The SUV class gets a CNG rate card: ₹16/km against the standard ₹20/km.
const TARIFF = JSON.parse(JSON.stringify(CONFIRMED_TARIFF_V2));
TARIFF.oneWay.classes.suv.cng = { customerRate: 16, customerBata: 400, partnerRate: 14, partnerBata: 300 };

test.before(async () => {
  routing = await H.startRoutingStub();
  await db.doc(`admins/${admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'CNG test admin' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('business_config/commission').set({ base: 'taxable', global: { rate: 10 }, version: 1 });
  await db.doc('vehicle_categories/cng-suv').set({ name: 'SUV', status: 'Active', tariffClass: 'suv', seatingCapacity: 6, cngEnabled: true });
  await db.doc('vehicle_categories/diesel-suv').set({ name: 'SUV Diesel', status: 'Active', tariffClass: 'suv', seatingCapacity: 6 });
  ok(await call(admin, 'saveTariffConfig', { ...TARIFF, enabled: true, reason: 'Isolated admin CNG integration test' }));
});
test.after(async () => { if (routing) await new Promise((resolve) => routing.close(resolve)); });

test('admin quote prices CNG from the CNG rate card and confirms it', async () => {
  const standard = ok(await call(admin, 'createAdminBooking', { ...request('cng-suv'), requestId: rid('cngstd'), quoteOnly: true }));
  const cng = ok(await call(admin, 'createAdminBooking', { ...request('cng-suv', { fuelType: 'cng' }), requestId: rid('cngquote'), quoteOnly: true }));
  assert.equal(standard.fuelType, undefined);
  assert.equal(standard.cngAvailable, true);
  assert.equal(cng.fuelType, 'cng');
  assert.equal(cng.pricing.fuelType, 'cng');
  // Rates are stored before GST, so compare the cards: ₹16 CNG against ₹20 standard = 80%.
  assert.equal(Math.round((cng.pricing.customerRatePaise / standard.pricing.customerRatePaise) * 100), 80);
  assert.ok(cng.quote.total < standard.quote.total, `${cng.quote.total} < ${standard.quote.total}`);
});

test('CNG is refused on a vehicle that does not offer it', async () => {
  const r = await call(admin, 'createAdminBooking', { ...request('diesel-suv', { fuelType: 'cng' }), requestId: rid('cngoff'), quoteOnly: true });
  assert.equal(r.ok, false);
  assert.match(r.message, /CNG is not offered on this vehicle/);
  const plain = ok(await call(admin, 'createAdminBooking', { ...request('diesel-suv'), requestId: rid('cngplain'), quoteOnly: true }));
  assert.equal(plain.cngAvailable, false);
});

test('an admin booking keeps the CNG fare and records the fuel', async () => {
  const quoted = ok(await call(admin, 'createAdminBooking', { ...request('cng-suv', { fuelType: 'cng' }), requestId: rid('cngq2'), quoteOnly: true }));
  const created = ok(await call(admin, 'createAdminBooking', { ...request('cng-suv', { fuelType: 'cng' }), requestId: rid('cngbook'), expectedFare: quoted.quote.total }));
  const saved = (await db.doc(`bookings/${created.id}`).get()).data();
  assert.equal(saved.fuelType, 'cng');
  assert.equal(saved.fare, quoted.quote.total);
  // A standard booking stays without a fuel type.
  const std = ok(await call(admin, 'createAdminBooking', { ...request('cng-suv'), requestId: rid('stdq'), quoteOnly: true }));
  const stdBooking = ok(await call(admin, 'createAdminBooking', { ...request('cng-suv'), requestId: rid('stdbook'), expectedFare: std.quote.total }));
  assert.equal((await db.doc(`bookings/${stdBooking.id}`).get()).data().fuelType, undefined);
});
