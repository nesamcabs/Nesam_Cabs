const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, rid, place, inHours } = H;
const admin = 'addon-master', customer = 'addon-customer';
let routing;
const trip = () => ({ pickup: place('Theni', 10.0104, 77.4768), drop: place('Madurai', 9.9195, 78.1193), tripType: 'One Way', scheduledAt: inHours(5) });
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; };

test.before(async () => {
  routing = await H.startRoutingStub();
  await db.doc(`admins/${admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Add-on test admin' });
  await db.doc(`customers/${customer}`).set({ status: 'Approved', name: 'Test Rider', phone: '+919000000001' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('business_config/commission').set({ base: 'taxable', global: { rate: 10 }, version: 1 });
  await db.doc('vehicle_categories/addon-suv').set({ name: 'SUV', status: 'Active', tariffClass: 'suv', seatingCapacity: 6, fare: { perKmRate: 18, carrierCharge: 300, petCharge: 200 } });
  ok(await call(admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Isolated add-on integration test' }));
  ok(await call(admin, 'saveTariffSection', { section: 'petCharge', latest: true, data: { petCharge: 200 }, reason: 'Common pet price integration fixture' }));
});
test.after(async () => { if (routing) await new Promise(resolve => routing.close(resolve)); });

for (const brand of ['nesam', 'people_taxi', 'onewaycarrentals']) {
  test(`${brand}: the customer quote and booking save both paid add-ons exactly once`, async () => {
    const t = trip(), addOns = { roofCarrier: true, pets: true, carrierCharge: 1, petCharge: 1 };
    const quoted = ok(await call(customer, 'quoteBooking', { ...t, brand, addOns }));
    const entry = quoted.quotes.find(q => q.categoryId === 'addon-suv');
    assert.equal(entry.ok, true, JSON.stringify(entry));
    assert.equal(entry.fare.addOns.roofCarrier, true);
    assert.equal(entry.fare.addOns.pets, true);
    const created = ok(await call(customer, 'createBooking', { ...t, brand, addOns, requestId: rid('addon'), categoryId: 'addon-suv', paymentMethod: 'Cash', termsAccepted: true, expectedFare: entry.fare.total }));
    const saved = (await db.doc(`bookings/${created.id}`).get()).data();
    assert.equal(saved.fare, entry.fare.total);
    assert.deepEqual(saved.fareBreakdown.addOns, entry.fare.addOns);
    assert.equal(saved.fareBreakup.lines.filter(l => l.key === 'carrierAddon').length, 1);
    assert.equal(saved.fareBreakup.lines.filter(l => l.key === 'petAddon').length, 1);
    assert.equal(saved.pricing.bookingAddOns.petCharge, entry.fare.addOns.petCharge);
  });
}

test('admin quote and booking include selected fees; a later category edit reprices only new quotes', async () => {
  const t = trip(), addOns = { roofCarrier: true, pets: true };
  const request = { ...t, pickupPoint: t.pickup, dropPoint: t.drop, categoryId: 'addon-suv', addOns, customerName: 'Test Rider', customerPhone: '+919000000001', paymentMethod: 'Cash', termsAccepted: true, brand: 'nesam' };
  const quoted = ok(await call(admin, 'createAdminBooking', { ...request, requestId: rid('addonquote'), quoteOnly: true }));
  const created = ok(await call(admin, 'createAdminBooking', { ...request, requestId: rid('addonadmin'), expectedFare: quoted.quote.total }));
  const original = (await db.doc(`bookings/${created.id}`).get()).data();
  assert.equal(original.fare, quoted.quote.total);
  ok(await call(admin, 'saveTariffSection', { section: 'petCharge', latest: true, data: { petCharge: 400 }, reason: 'Common pet price edited in integration test' }));
  const fresh = ok(await call(admin, 'createAdminBooking', { ...request, requestId: rid('addonfresh'), quoteOnly: true }));
  assert.ok(fresh.quote.total > quoted.quote.total);
  assert.equal((await db.doc(`bookings/${created.id}`).get()).data().fare, original.fare);
});

test('the common pet price cannot be changed without pricing permission or exceed its limit', async () => {
  const rejected = await call(customer, 'saveTariffSection', { section: 'petCharge', latest: true, data: { petCharge: 1 }, reason: 'Attempt to change the common pet price' });
  assert.equal(rejected.ok, false);
  const invalid = await call(admin, 'saveTariffSection', { section: 'petCharge', latest: true, data: { petCharge: 100001 }, reason: 'Reject excessive pet charge' });
  assert.equal(invalid.ok, false);
});
