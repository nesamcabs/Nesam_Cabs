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

// ── CNG saved in Service & Fare Settings (admin/src/components/FareMatrix.tsx): business_config/tariff_v2.brandOverrides ──
// The editor saves one card per Brand › Service › Vehicle class with every rate field present (blanks as null).
const FARE_FIELDS = ['customerRate', 'partnerRate', 'customerBase', 'partnerBase', 'minKm', 'minKmPerDay', 'customerBata', 'partnerBata',
  'cngCustomerRate', 'cngPartnerRate', 'cngCustomerBata', 'cngPartnerBata', 'cngExtraKmRate', 'cngMinKmPerDay',
  'extraKmRate', 'waitingPerHour', 'hillCharge', 'carrierCharge', 'partnerWaitingPerHour', 'partnerHillCharge', 'partnerCarrierCharge', 'petCharge', 'partnerPetCharge'];
async function fareSettingsSave(brand, service, cls, values, clearOverride = false) {
  const version = (await db.doc('business_config/tariff_v2').get()).data()?.version ?? 0;
  const data = Object.fromEntries(FARE_FIELDS.map((k) => [k, values[k] ?? null]));
  return ok(await call(admin, 'saveTariffSection', { section: 'brandOverride', brand, service, class: cls, expectedVersion: version, reason: 'CNG from Fare Settings (test)', clearOverride, data }));
}
const quote = async (extra) => ok(await call(admin, 'createAdminBooking', { ...request('cng-suv', extra), requestId: rid('fsq'), quoteOnly: true }));
/** The configured rate the quote used (GST-inclusive when the fare includes GST), in rupees. */
const rateOf = (q, k) => (q.pricing.gstInclusiveBase?.[k] ?? q.pricing[k]) / 100;
const brandOf = (b) => ({ brand: b, bookingSource: b });

test('CNG saved in Fare Settings prices office quotes: Common for every brand, a brand override for its own brand', async () => {
  await fareSettingsSave('common', 'One Way', 'suv', { cngCustomerRate: 17, cngCustomerBata: 350, cngPartnerRate: 15, cngPartnerBata: 300, cngExtraKmRate: 17 });
  await fareSettingsSave('people_taxi', 'One Way', 'suv', { cngCustomerRate: 19 });
  try {
    const diesel = await quote({});
    assert.equal(diesel.fuelType, undefined);
    assert.equal(rateOf(diesel, 'customerRatePaise'), 20, 'Diesel stays on the standard card');
    for (const b of ['nesam', 'onewaycarrentals']) {
      const cng = await quote({ ...brandOf(b), fuelType: 'cng' });
      assert.equal(cng.fuelType, 'cng', b);
      assert.equal(rateOf(cng, 'customerRatePaise'), 17, `${b}: the Common CNG rate`);
      assert.equal(rateOf(cng, 'customerBataPaise'), 350, `${b}: the Common CNG allowance`);
      assert.ok(cng.quote.total < diesel.quote.total);
    }
    const pt = await quote({ ...brandOf('people_taxi'), fuelType: 'cng' });
    assert.equal(rateOf(pt, 'customerRatePaise'), 19, 'People Taxi: its own CNG rate');
    assert.equal(rateOf(pt, 'customerBataPaise'), 350, 'People Taxi: the allowance it inherits from Common');
    assert.equal(rateOf(await quote(brandOf('people_taxi')), 'customerRatePaise'), 20, 'People Taxi Diesel is unchanged');
  } finally {
    await fareSettingsSave('people_taxi', 'One Way', 'suv', {}, true);
    await fareSettingsSave('common', 'One Way', 'suv', {}, true);
  }
});

test('Round Trip CNG from Fare Settings uses its own rate and daily minimum; add-ons are charged on both fuels', async () => {
  await fareSettingsSave('common', 'Round Trip', 'suv', { cngCustomerRate: 15, cngCustomerBata: 400, cngPartnerRate: 13, cngPartnerBata: 300, cngMinKmPerDay: 260 });
  ok(await call(admin, 'saveTariffSection', { section: 'petCharge', latest: true, data: { petCharge: 200 }, reason: 'Pet charge (test)' }));
  try {
    const round = { tripType: 'Round Trip', tripEndAt: inHours(7) };
    const diesel = await quote(round);
    const cng = await quote({ ...round, fuelType: 'cng' });
    assert.equal(cng.fuelType, 'cng');
    assert.equal(rateOf(cng, 'customerRatePaise'), 15);
    assert.equal(cng.pricing.minKmPerDay, 260, 'the CNG daily minimum');
    assert.notEqual(cng.quote.total, diesel.quote.total);
    for (const fuel of [{}, { fuelType: 'cng' }]) {
      const plain = await quote({ ...round, ...fuel });
      const pets = await quote({ ...round, ...fuel, addOns: { roofCarrier: false, pets: true } });
      assert.equal(pets.quote.addOns?.pets, true, JSON.stringify(fuel));
      assert.ok(pets.quote.total > plain.quote.total, `pet charge added (${JSON.stringify(fuel)})`);
      assert.equal(pets.fuelType, plain.fuelType);
    }
  } finally {
    await fareSettingsSave('common', 'Round Trip', 'suv', {}, true);
  }
});

test('a vehicle that offers CNG but has no CNG rate saved is refused for CNG, never priced at the Diesel rate', async () => {
  // The Sedan class has standard rates only (no CNG card in the tariff or in Fare Settings).
  await db.doc('vehicle_categories/cng-sedan').set({ name: 'Sedan', status: 'Active', tariffClass: 'sedan', seatingCapacity: 4, cngEnabled: true });
  const diesel = ok(await call(admin, 'createAdminBooking', { ...request('cng-sedan'), requestId: rid('sedstd'), quoteOnly: true }));
  assert.equal(diesel.cngAvailable, true);
  const r = await call(admin, 'createAdminBooking', { ...request('cng-sedan', { fuelType: 'cng' }), requestId: rid('sedcng'), quoteOnly: true });
  assert.equal(r.ok, false, 'refused');
  assert.match(r.message, /CNG is not available/);
});
