// District local fares through the real callables: save (permissions, validation, versions), customer quote and booking,
// office quote, trip end billing, waiting approval, brand / zone overrides and coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const L = require('../lib/domain/localPricing');
const { db, call, rest, rid, istInstant } = H;

const admin = 'local-fares-admin', rider = 'local-fares-rider', driver = 'local-fares-driver';
const DISTRICT = { state: '33', district: 'Theni' };
const ok = (value) => { assert.equal(value.ok, true, JSON.stringify(value)); return value.data; };
const refused = (value, pattern) => { assert.equal(value.ok, false, JSON.stringify(value.data)); assert.match(value.message, pattern); };
const spot = (name, pin, lat, lng) => ({ name, address: `${name}, Theni, Tamil Nadu ${pin}`, lat, lng, type: 'other' });
const PICKUP = spot('Allinagaram', '625531', 10.0104, 77.4768);
const DROP = spot('Veerapandi', '625534', 9.9695, 77.4393);
const rule = (p = {}) => ({ minimumFare: 150, baseFare: 100, includedKm: 3, extraPerKm: 20, freeWaitMins: 5, waitPerMin: 2, ...p });
const partner = { minimumFare: 120, baseFare: 80, includedKm: 3, extraPerKm: 15, freeWaitMins: 10, waitPerMin: 1 };
const row = { customerFare: 900, partnerPayout: 700, includedKm: 40, extraKmRate: 14, extraHourRate: 150 };
const district = () => ({ district: { customer: { sedan: rule() }, partner: { sedan: partner }, rental: { sedan: { 4: row } } }, zones: {}, areas: {} });
const settings = () => {
  const s = L.defaultSettings();
  s.peak.rentalEnabled = true;
  s.peak.weekdays = [...L.WEEKDAYS];
  Object.assign(s.peak.rules[0], { startHour: 7, endHour: 10, active: true, value: 10, maxCap: 50 });
  Object.assign(s.additional, { autoToll: true, tollAmount: 60, corridors: [{ id: 'c1', fromPin: '625531', toPin: '625534', name: 'Test plaza', amount: 85 }] });
  return s;
};
const save = (over) => call(admin, 'saveLocalFares', { brand: 'common', ...DISTRICT, reason: 'District fares end to end test', ...over });
const localTrip = (over = {}) => ({ brand: 'nesam', tripType: 'One Way', scheduledAt: istInstant(2, '12:00'), pickup: PICKUP, drop: DROP, ...over });
const rentalTrip = (over = {}) => ({ brand: 'nesam', tripType: 'Local Rental', rentalHours: 4, scheduledAt: istInstant(2, '08:00'), pickup: PICKUP, drop: { ...spot('Within City Disposal', '625531', 10.0134, 77.4798), id: 'place-local-disposal' }, ...over });
const quoteOf = async (trip) => ok(await call(rider, 'quoteBooking', trip)).quotes.find((q) => q.categoryId === 'local-sedan');
let routing;

test.before(async () => {
  routing = await H.startRoutingStub(8765, 12, 30);
  await db.doc(`admins/${admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Local fares admin' });
  await db.doc(`customers/${rider}`).set({ status: 'Approved', name: 'Local Rider', phone: '+919000000002' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/local-sedan').set({ name: 'Sedan', status: 'Active', seatingCapacity: 4 });
  await H.seedTariff();
  for (const d of ['local_fare_index', 'local_geo_33~theni', 'local_fares_33~theni_common', 'local_fares_33~theni_people_taxi', 'local_settings_common', 'local_settings_people_taxi']) await db.doc(`business_config/${d}`).delete();
});
test.after(async () => { if (routing) await new Promise((resolve) => routing.close(resolve)); });

test('only pricing staff may save, and half-filled or foreign data is refused', async () => {
  refused(await call(rider, 'saveLocalFares', { brand: 'common', ...DISTRICT, reason: 'Not allowed at all', fares: { data: district(), expectedVersion: 0 } }), /./);
  refused(await save({ fares: { data: { district: { customer: { sedan: rule({ extraPerKm: 0 }) } } }, expectedVersion: 0 } }), /beyond the included km/);
  refused(await save({ fares: { data: { district: {}, areas: { 600001: { customer: { sedan: rule() } } } }, expectedVersion: 0 } }), /not a pincode of Theni/);
  refused(await save({ geo: { data: { zones: [{ id: 'z1', name: 'A', pins: ['625531'] }, { id: 'z2', name: 'B', pins: ['625531'] }] }, expectedVersion: 0 } }), /one zone only/);
  const capless = settings(); capless.peak.rules[0].maxCap = 0;
  refused(await save({ settings: { data: capless, expectedVersion: 0 } }), /max cap/);
  refused(await save({ fares: { data: district(), expectedVersion: 0 }, reason: 'no' }), /reason/i);
});

test('rates, zones and settings save together and a stale edit is refused', async () => {
  const out = ok(await save({ fares: { data: district(), expectedVersion: 0 }, geo: { data: { zones: [], tamil: { 625531: 'அல்லிநகரம்' } }, expectedVersion: 0 }, settings: { data: settings(), expectedVersion: 0 } }));
  assert.deepEqual(out, { geoVersion: 1, faresVersion: 1, settingsVersion: 1 });
  const index = (await db.doc('business_config/local_fare_index').get()).data();
  assert.deepEqual(index.districts['33~theni'].brands, ['common']);
  refused(await save({ fares: { data: district(), expectedVersion: 0 } }), /changed by someone else/);
  assert.equal((await rest(rider, 'business_config/local_fares_33~theni_common')).status, 403);
  assert.equal((await rest(admin, 'business_config/local_fares_33~theni_common')).status, 200);
});

test('customers are quoted the district Pickup & Drop fare with the mapped toll', async () => {
  const q = await quoteOf(localTrip());
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.model, 'local_pickup_drop');
  // 100 + 9 km × 20 = 280, + 85 toll = 365, + 5% GST.
  assert.equal(q.fare.total, 383.25);
  assert.equal(q.fare.routeToll, 85);
});

test('customers are quoted the district rental package with the morning peak', async () => {
  const q = await quoteOf(rentalTrip());
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.fare.peakCharge, 50);
  assert.equal(q.fare.total, 997.5);
  const offPeak = await quoteOf(rentalTrip({ scheduledAt: istInstant(2, '12:00') }));
  assert.equal(offPeak.fare.total, 945);
  const missing = await quoteOf(rentalTrip({ rentalHours: 6 }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /6-hour rental package is not configured/);
});

let bookingId;
test('a booking keeps the district pricing, with the partner side private; the office quotes the same', async () => {
  const created = ok(await call(rider, 'createBooking', { ...localTrip(), requestId: rid('local'), categoryId: 'local-sedan', paymentMethod: 'Cash', expectedFare: 383.25, termsAccepted: true }));
  bookingId = created.id;
  const b = (await db.doc(`bookings/${bookingId}`).get()).data();
  assert.equal(b.fare, 383.25);
  assert.equal(b.pricing.localFare.district, 'Theni');
  assert.equal(b.pricing.partner, null);
  const priv = (await db.doc(`booking_pricing_private/${bookingId}`).get()).data();
  assert.equal(priv.partner.localRule.extraPerKm, 15);
  assert.equal(priv.partner.basePaise, 30000); // 80 + 9 × 15 + 85 toll
  const t = localTrip();
  const office = ok(await call(admin, 'createAdminBooking', { ...t, requestId: rid('officeq'), quoteOnly: true, categoryId: 'local-sedan', pickupPoint: t.pickup, dropPoint: t.drop }));
  assert.equal(office.quote.total, 383.25);
});

test('trip end bills the extra km, only unincluded tolls, and keeps the toll in the partner payout', async () => {
  await db.doc(`bookings/${bookingId}`).update({ status: 'Ongoing', assignedDriverId: driver, tripSubStatus: 'Trip Started' });
  const closed = ok(await call(admin, 'officeCloseTrip', { bookingId, totalKm: 15, charges: { toll: 120, parking: 30 }, reason: 'Closing the local test trip', requestId: rid('close') }));
  assert.ok(closed);
  const b = await H.booking(bookingId);
  assert.equal(b.status, 'Completed');
  assert.equal(b.fare, 446.25); // (340 + 85) × 1.05
  assert.equal(b.tollCharges, 65); // 120 − 85 already in the fare, + 30 parking
  assert.equal(b.finalFare.extraKm, 3);
});

test('approved pickup waiting is charged per minute after the free minutes', async () => {
  await db.doc(`bookings/${bookingId}`).update({ extraUsage: { schema: 1, revision: 1, status: 'submitted', usage: { stops: [{ stopId: 'pickup', waitedMinutes: 20 }], hill: false, carrier: false } } });
  const r = ok(await call(admin, 'reviewExtraUsage', { bookingId, revision: 1, decision: 'approve' }));
  assert.equal(r.status, 'approved');
  assert.equal(r.customerTotalPaise, 3150); // 15 min × ₹2 + 5% GST
  const priv = (await db.doc(`booking_pricing_private/${bookingId}`).get()).data();
  assert.equal(priv.extraApproved.partner.waitingPaise, 1000); // 10 min × ₹1
});

test('a brand override and a zone override win over the shared district rate', async () => {
  ok(await call(admin, 'saveLocalFares', { brand: 'people_taxi', ...DISTRICT, reason: 'People Taxi own district rate', fares: { data: { district: { customer: { sedan: rule({ baseFare: 130 }) }, partner: { sedan: partner } }, zones: {}, areas: {} }, expectedVersion: 0 } }));
  assert.equal((await quoteOf(localTrip({ brand: 'people_taxi' }))).fare.total, 414.75); // (310 + 85) × 1.05
  assert.equal((await quoteOf(localTrip())).fare.total, 383.25);
  const zoned = { ...district(), zones: { z1: { customer: { sedan: rule({ baseFare: 200 }) } } } };
  ok(await save({ geo: { data: { zones: [{ id: 'z1', name: 'Theni Zone', pins: ['625531'] }], tamil: {} }, expectedVersion: 1 }, fares: { data: zoned, expectedVersion: 1 } }));
  assert.equal((await quoteOf(localTrip())).fare.total, 488.25); // (380 + 85) × 1.05
  // Removing the zone removes its override.
  ok(await save({ geo: { data: { zones: [], tamil: {} }, expectedVersion: 2 }, fares: { data: zoned, expectedVersion: 2 } }));
  assert.deepEqual((await db.doc('business_config/local_fares_33~theni_common').get()).data().zones, {});
  assert.equal((await quoteOf(localTrip())).fare.total, 383.25);
});

test('a village rate applies only to pickups whose address names that village', async () => {
  const withVillage = { ...district(), areas: { '625531~allinagaram': { customer: { sedan: rule({ baseFare: 180 }) } } } };
  ok(await save({ fares: { data: withVillage, expectedVersion: 3 } }));
  assert.equal((await quoteOf(localTrip())).fare.total, 467.25); // (360 + 85) × 1.05
  const other = spot('Palanichettipatti', '625531', 10.0104, 77.4768);
  assert.equal((await quoteOf(localTrip({ pickup: other }))).fare.total, 383.25);
  refused(await save({ fares: { data: { ...district(), areas: { '600001~adyar': { customer: { sedan: rule() } } } }, expectedVersion: 4 } }), /not a pincode of Theni/);
});

test('brand settings can be set and handed back to the shared ones; coverage OFF refuses the trip', async () => {
  const own = settings(); own.additional.autoToll = false; own.gst.percent = 0;
  const asPeople = (data, expectedVersion) => call(admin, 'saveLocalFares', { brand: 'people_taxi', ...DISTRICT, reason: 'People Taxi settings test', settings: { data, expectedVersion } });
  ok(await asPeople(own, 0));
  assert.equal((await quoteOf(localTrip({ brand: 'people_taxi' }))).fare.total, 310);
  ok(await asPeople(null, 1));
  assert.equal((await quoteOf(localTrip({ brand: 'people_taxi' }))).fare.total, 414.75);
  ok(await save({ fares: { data: { ...district(), coverage: { local: false } }, expectedVersion: 4 } }));
  const q = await quoteOf(localTrip());
  assert.equal(q.ok, false);
  assert.match(q.error, /Local trips are not available from Theni/);
});

test('a pickup outside every configured district keeps the earlier pricing', async () => {
  const q = await quoteOf({ brand: 'nesam', tripType: 'One Way', scheduledAt: istInstant(2, '12:00'), pickup: spot('Madurai', '625001', 9.9195, 78.1193), drop: spot('Anna Nagar Madurai', '625020', 9.93, 78.14) });
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.model, 'one_way_standard');
});
