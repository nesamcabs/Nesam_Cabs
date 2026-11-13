// The booking call exactly as the People Taxi website sends it (brand "peopletaxi", add-ons, WhatsApp, email), for every trip type.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, inHours, place, rid } = H;

const U = { admin: 'ptAdmin', cust: 'ptCustomer' };
let routing;
const withId = (p, id) => ({ id, ...p });
const theni = withId(place('Theni', 10.0104, 77.4768), 'g-theni');
const madurai = withId(place('Madurai', 9.9252, 78.1198), 'g-madurai');
const trichy = withId(place('Trichy', 10.7905, 78.7047), 'g-trichy');

/** What rideService.createRideRequest sends (undefined fields are dropped by JSON, as in the browser). */
const payload = (over) => JSON.parse(JSON.stringify({
  requestId: rid('pt'), pickup: theni, drop: madurai, stops: [], termsAccepted: true, categoryId: 'pt-sedan', tripType: 'One Way', expectedFare: 0,
  addOns: { roofCarrier: false, pets: true }, paymentMethod: 'Cash', couponCode: '', notes: '', fuelType: undefined,
  whatsapp: { sameAsMobile: false, countryCode: '+91', number: '9876500012' }, email: undefined,
  scheduledAt: inHours(30), tripEndAt: undefined, rentalHours: undefined, source: 'peopletaxi', bookingSource: 'peopletaxi', brand: 'peopletaxi', ...over,
}));

/** Books like the app: the first call may answer with the server's own fare, which the app then confirms. */
async function book(over) {
  const base = payload(over);
  const quote = await call(U.cust, 'quoteBooking', { brand: 'peopletaxi', tripType: base.tripType, pickup: base.pickup, drop: base.drop, stops: base.stops, categoryId: base.categoryId, scheduledAt: base.scheduledAt, tripEndAt: base.tripEndAt, rentalHours: base.rentalHours, addOns: base.addOns });
  let r = await call(U.cust, 'createBooking', base);
  if (!r.ok && r.details?.fare?.total) r = await call(U.cust, 'createBooking', { ...base, expectedFare: r.details.fare.total });
  return { quote, r };
}

test.before(async () => {
  routing = await H.startRoutingStub(8765, 80, 90);
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Admin', permissions: ['operations', 'finance', 'compliance', 'fleet', 'people', 'system'] });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'People Customer', phone: '+919876500012', email: 'p@example.com', walletBalance: 0 });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/pt-sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', tariffClass: 'sedan', dutyClass: 'sedan', seatingCapacity: 4, seats: 4, displayOrder: 1, fare: { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 } });
  for (const [id, p] of [['g-theni', theni], ['g-madurai', madurai], ['g-trichy', trichy]]) await db.doc(`locations/${id}`).set({ ...p, id, status: 'Active', state: '33', type: 'City', city: p.name });
  const saved = await call(U.admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'People Taxi payload fixture' });
  assert.equal(saved.ok, true, JSON.stringify(saved));
});
test.after(async () => { if (routing) await new Promise((r) => routing.close(r)); });

const cases = {
  'One Way': {},
  'Round Trip': { tripType: 'Round Trip', tripEndAt: inHours(80) },
  'Round Trip with a stop': { tripType: 'Round Trip', stops: [madurai], drop: theni, tripEndAt: inHours(80) },
  Multicity: { tripType: 'Multicity', stops: [madurai, trichy], drop: theni, tripEndAt: inHours(80) },
  'Local Rental': { tripType: 'Local Rental', rentalHours: 8, drop: theni },
};
for (const [name, over] of Object.entries(cases)) {
  test(`People Taxi ${name} booking is accepted with the website's own payload`, async () => {
    const { quote, r } = await book(over);
    assert.equal(quote.ok, true, `quote: ${JSON.stringify(quote)}`);
    assert.equal(r.ok, true, `create: ${JSON.stringify(r)}`);
  });
}
