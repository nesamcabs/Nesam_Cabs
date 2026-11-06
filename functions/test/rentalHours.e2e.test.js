const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, place, inHours, rid } = H;
const admin = 'rental-range-admin', rider = 'rental-range-rider';
let routing;
const rule = { firstHourFare: 500, additionalHourFare: 350, partnerPerHour: 250, includedKm: 20, kmMode: 'per_hour', extraKmRate: 25, extraHourRate: 350 };
const packages = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [String(i + 1), { customerFare: 500 + i * 350, partnerPayout: (i + 1) * 250, includedKm: (i + 1) * 20, extraKmRate: 25, extraHourRate: 350 }]));
const ok = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.data; };
const trip = hours => ({ tripType: 'Local Rental', rentalHours: hours, scheduledAt: inHours(12), pickup: place('Theni', 10.0104, 77.4768), drop: { ...place('Within City Disposal', 10.0134, 77.4798), id: 'place-local-disposal' } });
test.before(async () => {
  routing = await H.startRoutingStub();
  await db.doc(`admins/${admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Rental test admin' });
  await db.doc(`customers/${rider}`).set({ status: 'Approved', name: 'Rental Rider', phone: '+919000000001' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/rental-test').set({ name: 'Sedan', tariffClass: 'sedan', status: 'Active', seatingCapacity: 4, fare: { perKmRate: 16 } });
  ok(await call(admin, 'saveTariffConfig', { enabled: true, useConfirmedDefaults: true, reason: 'Rental duration range test fixture' }));
});
test.after(async () => { if (routing) await new Promise(resolve => routing.close(resolve)); });

test('admin saves package rules and every duration from 1 through 15', async () => {
  ok(await call(admin, 'saveTariffSection', { section: 'brandOverride', latest: true, brand: 'common', service: 'Local Rental', class: 'sedan', data: { rentalPackageRule: rule, rentalPackages: packages }, reason: 'Enable all 1 to 15 hour rental packages' }));
  const saved = (await db.doc('business_config/tariff_v2').get()).data();
  assert.deepEqual(saved.brandOverrides.common['Local Rental'].sedan.rentalPackageRule, rule);
  assert.equal(Object.keys(saved.brandOverrides.common['Local Rental'].sedan.rentalPackages).length, 15);
});

for (const brand of ['nesam', 'people_taxi', 'onewaycarrentals']) {
  test(`${brand}: all 15 customer rental durations use the saved fare and kilometre rules`, async () => {
    for (let h = 1; h <= 15; h++) {
      const result = ok(await call(rider, 'quoteBooking', { ...trip(h), brand }));
      const q = result.quotes.find(q => q.categoryId === 'rental-test');
      assert.equal(q.ok, true, JSON.stringify(q));
      assert.equal(q.rentalHours, h);
      assert.equal(q.includedKm, h * 20);
      assert.equal(q.fare.total, Math.round((500 + (h - 1) * 350) * 105) / 100);
    }
  });
}

test('admin quotation and customer booking retain the selected 15-hour package', async () => {
  const t = trip(15);
  const q = ok(await call(admin, 'createAdminBooking', { ...t, brand: 'nesam', requestId: rid('rentq'), quoteOnly: true, categoryId: 'rental-test', pickupPoint: t.pickup, dropPoint: t.drop }));
  assert.equal(q.pricing.rentalHours, 15);
  const quoted = ok(await call(rider, 'quoteBooking', { ...t, brand: 'nesam' }));
  const fare = quoted.quotes.find(q => q.categoryId === 'rental-test').fare;
  const created = ok(await call(rider, 'createBooking', { ...t, brand: 'nesam', requestId: rid('rentbook'), categoryId: 'rental-test', paymentMethod: 'Cash', expectedFare: fare.total, termsAccepted: true }));
  const b = (await db.doc(`bookings/${created.id}`).get()).data();
  assert.equal(b.pricing.rentalHours, 15);
  assert.equal(b.pricing.includedKm, 300);
});

test('unsupported fractional and out-of-range durations are rejected', async () => {
  for (const h of [0, 16, 1.5]) {
    const invalid = await call(rider, 'quoteBooking', { ...trip(h), brand: 'nesam' });
    assert.equal(invalid.ok, false);
  }
});
