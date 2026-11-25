// Local Pickup & Drop / Hourly Rental location-scoped rates, scheduled peak rules and airport entry, end to end on the emulators:
// the admin saves through saveGeoFares / savePeakRule (permissions, reason, version check, audit), and the customer quote, the office
// quote and a customer booking are priced from the booking's own pickup location. Isolated demo project: nothing reaches production.
//   ROUTING_URL=http://127.0.0.1:8765 npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json --project demo-nesam \
//     --only auth,firestore,functions "node --test test/geoPricing.e2e.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');
const H = require('./helpers.e2e');
const { db, call, rid } = H;

const admin = 'geo-admin', viewer = 'geo-viewer', rider = 'geo-rider';
const ok = (v) => { assert.equal(v.ok, true, JSON.stringify(v)); return v.data; };
const THENI = { level: 'district', state: '33', district: 'Theni' };
const party = (o = {}) => ({ baseFare: 150, includedKm: 4, extraKmRate: 18, minimumFare: 200, freeWaitingMin: 5, waitingPerMin: 2, ...o });
// Both ends in Theni district (India Post pincodes), 12 km apart by the routing stub.
const pickup = { id: 'pin', name: 'Theni Bus Stand', address: 'Theni Bus Stand, Theni, Tamil Nadu 625531', lat: 10.0104, lng: 77.4768, type: 'other' };
const drop = { id: 'pin', name: 'Periyakulam', address: 'Periyakulam, Tamil Nadu 625601', lat: 10.1239, lng: 77.5475, type: 'other' };
const IST = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
const when = H.inHours(30);
const localTrip = (over = {}) => ({ tripType: 'One Way', scheduledAt: when, pickup, drop, ...over });
let routing;
const quoteFor = async (brand, trip = localTrip()) => ok(await call(rider, 'quoteBooking', { ...trip, brand })).quotes.find((q) => q.categoryId === 'geo-sedan');

test.before(async () => {
  routing = await H.startRoutingStub(8765, 12, 25);
  await db.doc(`admins/${admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Geo test admin' });
  await db.doc(`customers/${rider}`).set({ status: 'Approved', name: 'Geo Rider', phone: '+919000000077' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/geo-sedan').set({ name: 'Sedan', tariffClass: 'sedan', status: 'Active', seatingCapacity: 4, fare: { perKmRate: 16 } });
  await db.doc('locations/geo-zone').set({ name: 'Theni Town Zone', type: 'Service Zone', state: 'Tamil Nadu', district: 'Theni', city: 'Theni', pincodes: ['625531'], status: 'Active', pickupEnabled: true, dropEnabled: true });
  await db.doc('locations/geo-airport').set({ name: 'Theni Helipad Airport', type: 'Airport', state: 'Tamil Nadu', district: 'Theni', city: 'Theni', pincode: '625601', status: 'Active', pickupEnabled: true, dropEnabled: true, lat: 10.12, lng: 77.54 });
  ok(await call(admin, 'saveTariffConfig', { enabled: true, ...CONFIRMED_TARIFF_V2, reason: 'Geo pricing test fixture' }));
});
test.after(async () => { if (routing) await new Promise((r) => routing.close(r)); });

test('saves need pricing access and a reason; a stale version is refused; values reload as saved', async () => {
  const body = { brand: 'common', service: 'local', targets: [THENI], data: { classes: { sedan: { customer: party(), partner: party({ baseFare: 120, extraKmRate: 14, minimumFare: 160 }) } } }, expected: {} };
  assert.equal((await call(viewer, 'saveGeoFares', { ...body, reason: 'No access here' })).ok, false);
  assert.match((await call(admin, 'saveGeoFares', { ...body, reason: '' })).message, /reason/i);
  assert.match((await call(admin, 'saveGeoFares', { ...body, targets: [{ level: 'district', state: '33', district: 'Nowhere' }], reason: 'Unknown district' })).message, /district/i);
  ok(await call(admin, 'saveGeoFares', { ...body, reason: 'Theni district local rates' }));
  const saved = (await db.doc('geo_fares/common__local__d_33_theni').get()).data();
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.classes.sedan.customer, party());
  assert.equal(saved.history.length, 1);
  const stale = await call(admin, 'saveGeoFares', { ...body, expected: { common__local__d_33_theni: 0 }, reason: 'Saved against an old version' });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /changed by someone else/);
  const audit = await db.collection('audit_logs').where('action', '==', 'geo_fares_saved').get();
  assert.ok(audit.size >= 1);
});

test('customer and office quotes match and resolve from the pickup location (district default)', async () => {
  const q = await quoteFor('nesam');
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.equal(q.model, 'local_pickup_drop');
  const office = ok(await call(admin, 'createAdminBooking', { ...localTrip(), brand: 'nesam', requestId: rid('geoq'), quoteOnly: true, categoryId: 'geo-sedan', pickupPoint: pickup, dropPoint: drop }));
  assert.equal(office.pricing.model, 'local_pickup_drop');
  assert.equal(office.quote.total, q.fare.total, 'the office sees the same total as the customer');
  // 12 km: 150 + (12 − 4) × 18 = 294 before tax (above the 200 minimum).
  assert.equal(office.pricing.gstInclusiveBase?.packagePaise ?? office.pricing.packagePaise, 29400);
  assert.deepEqual(office.pricing.geoFare.keys.slice(-2), ['z_geo-zone', 'd_33_theni']);
});

test('a brand override changes only that brand; removing a field restores inheritance', async () => {
  ok(await call(admin, 'saveGeoFares', { brand: 'people_taxi', service: 'local', targets: [{ level: 'zone', state: '33', district: 'Theni', zoneId: 'geo-zone' }], data: { classes: { sedan: { customer: { baseFare: 250 } } } }, expected: {}, reason: 'People Taxi zone base fare' }));
  const nesam = await quoteFor('nesam'), people = await quoteFor('people_taxi');
  assert.ok(people.fare.total > nesam.fare.total, 'People Taxi uses its zone override');
  ok(await call(admin, 'saveGeoFares', { brand: 'people_taxi', service: 'local', targets: [{ level: 'zone', state: '33', district: 'Theni', zoneId: 'geo-zone' }], data: { classes: { sedan: { customer: { baseFare: null } } } }, expected: {}, reason: 'Back to the district base fare' }));
  assert.equal((await quoteFor('people_taxi')).fare.total, nesam.fare.total);
  const doc = (await db.doc('geo_fares/people_taxi__local__z_geo-zone').get()).data();
  assert.equal(doc.classes.sedan, undefined, 'a cleared field is removed, never stored as zero');
});

test('bulk save writes only the edited field to each target and keeps their other values', async () => {
  const z = { level: 'zone', state: '33', district: 'Theni', zoneId: 'geo-zone' };
  const a = { level: 'area', state: '33', district: 'Theni', locationId: 'geo-airport' };
  ok(await call(admin, 'saveGeoFares', { brand: 'common', service: 'rental', targets: [z], data: { classes: { sedan: { packages: { 2: { customerFare: 700 } } } } }, expected: {}, reason: 'Zone 2-hour fare' }));
  ok(await call(admin, 'saveGeoFares', { brand: 'common', service: 'rental', targets: [a], data: { classes: { sedan: { packages: { 2: { customerFare: 900 } } } } }, expected: {}, reason: 'Airport 2-hour fare' }));
  ok(await call(admin, 'saveGeoFares', { brand: 'common', service: 'rental', targets: [z, a], data: { classes: { sedan: { packages: { 2: { extraHourRate: 160 } } } } }, expected: {}, reason: 'Bulk extra-hour rate' }));
  const zd = (await db.doc('geo_fares/common__rental__z_geo-zone').get()).data(), ad = (await db.doc('geo_fares/common__rental__a_geo-airport').get()).data();
  assert.deepEqual(zd.classes.sedan.packages['2'], { customerFare: 700, extraHourRate: 160 });
  assert.deepEqual(ad.classes.sedan.packages['2'], { customerFare: 900, extraHourRate: 160 });
});

test('rental: an incomplete location package is refused (never substituted); a complete one is quoted with its overage rates', async () => {
  const rental = (hours) => ({ tripType: 'Local Rental', rentalHours: hours, scheduledAt: when, pickup, drop: { ...pickup, name: 'Theni Market', lat: 10.0124, lng: 77.4788 } });
  const refused = await quoteFor('nesam', rental(2));
  assert.equal(refused.ok, false);
  assert.match(refused.error ?? refused.message ?? JSON.stringify(refused), /not complete/);
  ok(await call(admin, 'saveGeoFares', { brand: 'common', service: 'rental', targets: [THENI], data: { classes: { sedan: { gstMode: 'excluded', packages: { 2: { partnerPayout: 500, includedKm: 25, extraKmRate: 15 } } } } }, expected: {}, reason: 'Complete the 2-hour package' }));
  const office = ok(await call(admin, 'createAdminBooking', { ...rental(2), brand: 'nesam', requestId: rid('geor'), quoteOnly: true, categoryId: 'geo-sedan', pickupPoint: pickup, dropPoint: { ...pickup, name: 'Theni Market', lat: 10.0124, lng: 77.4788 } }));
  assert.equal(office.pricing.model, 'rental_package');
  assert.equal(office.pricing.rentalHours, 2);
  assert.equal(office.pricing.packagePaise, 70000, 'zone fare 700 (the pickup is in the zone)');
  assert.equal(office.pricing.extraHourRatePaise, 16000);
  assert.equal(office.pricing.extraKmRatePaise, 1500);
  assert.equal(office.pricing.partner.basePaise, 50000);
});

test('scheduled peak: overlaps are refused, the charge applies on the scheduled IST pickup once, and a confirmed booking keeps its fare', async () => {
  const parts = Object.fromEntries(IST.formatToParts(new Date(when)).map((p) => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const min = Number(parts.hour) * 60 + Number(parts.minute);
  const hhmm = (m) => `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m + 1440) % 1440) % 60).padStart(2, '0')}`;
  // A window that starts before midnight belongs to the evening it starts on (the previous weekday).
  const startDay = min - 60 < 0 ? (day + 6) % 7 : day;
  const rule = { brand: 'common', service: 'local', scope: THENI, name: 'Test peak', enabled: true, days: [startDay], slots: [{ start: hhmm(min - 60), end: hhmm(min + 60) }], type: 'percent', value: 10, cap: 25, priority: 3, reason: 'Peak test rule' };
  const before = await quoteFor('nesam');
  ok(await call(admin, 'savePeakRule', rule));
  const clash = await call(admin, 'savePeakRule', { ...rule, name: 'Clash', days: [day], slots: [{ start: hhmm(min), end: hhmm(min + 90) }] });
  assert.equal(clash.ok, false);
  assert.match(clash.message, /Overlaps/);
  const q = await quoteFor('nesam');
  // 10% of the ride fare (₹294) = 29.40 → capped at ₹25, on the taxable fare only.
  assert.equal(q.pricing?.peakCharge?.amount ?? q.peakCharge?.amount ?? q.fare.peakCharge, 25);
  assert.ok(q.fare.total > before.fare.total);
  const created = ok(await call(rider, 'createBooking', { ...localTrip(), brand: 'nesam', requestId: rid('geob'), categoryId: 'geo-sedan', paymentMethod: 'Cash', expectedFare: q.fare.total, termsAccepted: true }));
  const booked = (await db.doc(`bookings/${created.id}`).get()).data();
  assert.equal(booked.pricing.peakCharge.amount, 25);
  assert.equal(booked.pricing.geoFare.service, 'local');
  // A later rate change never reprices the confirmed booking.
  ok(await call(admin, 'saveGeoFares', { brand: 'common', service: 'local', targets: [THENI], data: { classes: { sedan: { customer: { baseFare: 400 } } } }, expected: {}, reason: 'Raise the district base fare' }));
  const after = (await db.doc(`bookings/${created.id}`).get()).data();
  assert.equal(after.fare.total, booked.fare.total);
  assert.deepEqual(after.pricing.geoFare.versions, booked.pricing.geoFare.versions);
});

test('airport entry: only a booked Airport record with a saved fee, once; a name in the address does not trigger it', async () => {
  ok(await call(admin, 'saveGeoFares', { brand: 'common', service: 'local', targets: [{ level: 'area', state: '33', district: 'Theni', locationId: 'geo-airport' }], data: { airportEntry: { customerFee: 60, appliesTo: 'drop' } }, expected: {}, reason: 'Airport entry fee' }));
  const toAirport = await quoteFor('nesam', localTrip({ drop: { ...drop, id: 'geo-airport', name: 'Theni Helipad Airport', lat: 10.12, lng: 77.54 } }));
  assert.equal(toAirport.ok, true, JSON.stringify(toAirport));
  assert.equal(toAirport.fare.airportEntry, 60);
  const byName = await quoteFor('nesam', localTrip({ drop: { ...drop, name: 'Theni Helipad Airport', lat: 10.12, lng: 77.54 } }));
  assert.equal(byName.fare.airportEntry, undefined);
  assert.equal((await call(admin, 'saveGeoFares', { brand: 'common', service: 'local', targets: [THENI], data: { airportEntry: { customerFee: 60, appliesTo: 'drop' } }, expected: {}, reason: 'Wrong target' })).ok, false);
});

test('Local and Rental have no fuel split: a CNG choice left on the office form is ignored, not refused', async () => {
  const local = ok(await call(admin, 'createAdminBooking', { ...localTrip(), brand: 'nesam', requestId: rid('geoc'), quoteOnly: true, categoryId: 'geo-sedan', fuelType: 'cng', pickupPoint: pickup, dropPoint: drop }));
  assert.equal(local.pricing.model, 'local_pickup_drop');
  assert.equal(local.fuelType, undefined);
  assert.equal(local.pricing.extraCharges.freeWaitingMinutes, 5, 'trip-end waiting uses the location free minutes');
  const rentalDrop = { ...pickup, name: 'Theni Market', lat: 10.0124, lng: 77.4788 };
  const rental = ok(await call(admin, 'createAdminBooking', { tripType: 'Local Rental', rentalHours: 2, scheduledAt: when, pickup, drop: rentalDrop, brand: 'nesam', requestId: rid('geocr'), quoteOnly: true, categoryId: 'geo-sedan', fuelType: 'cng', pickupPoint: pickup, dropPoint: rentalDrop }));
  assert.equal(rental.pricing.model, 'rental_package');
  assert.equal(rental.fuelType, undefined);
});

test('other services are unchanged: an 80 km One Way is still priced on the One Way rate card', async () => {
  await new Promise((r) => routing.close(r));
  routing = await H.startRoutingStub(8765, 80, 90);
  const q = await quoteFor('nesam', localTrip({ drop: { ...drop, name: 'Madurai', address: 'Madurai, Tamil Nadu 625001', lat: 9.92, lng: 78.12 } }));
  assert.equal(q.ok, true, JSON.stringify(q));
  assert.notEqual(q.model, 'local_pickup_drop');
  assert.equal(q.fare.peakCharge, undefined);
  const far = { ...drop, name: 'Madurai', address: 'Madurai, Tamil Nadu 625001', lat: 9.92, lng: 78.12 };
  const cng = await call(admin, 'createAdminBooking', { ...localTrip({ drop: far }), brand: 'nesam', requestId: rid('geocng'), quoteOnly: true, categoryId: 'geo-sedan', fuelType: 'cng', pickupPoint: pickup, dropPoint: far });
  assert.equal(cng.ok, false, 'a vehicle without CNG is still refused for CNG on other services');
  assert.match(cng.message, /CNG is not offered/);
});
