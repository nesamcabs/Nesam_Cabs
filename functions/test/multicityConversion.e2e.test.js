const test = require('node:test'), assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, TS, inHours, place, rest } = H;
const admin = 'multicity-master', customer = 'multicity-rider';
let routing;

test.before(async () => {
  routing = await H.startRoutingStub();
  await db.doc(`admins/${admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Tour desk' });
  await db.doc(`customers/${customer}`).set({ status: 'Active', name: 'Tour Customer', phone: '+919000000001' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/tour-sedan').set({ name: 'Sedan', status: 'Active', tariffClass: 'sedan', dutyClass: 'sedan', seats: 4, seatingCapacity: 4 });
  const saved = await call(admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Multicity emulator fixture' });
  assert.equal(saved.ok, true, JSON.stringify(saved));
});
test.after(async () => { if (routing) await new Promise(resolve => routing.close(resolve)); });

async function enquiry(id) {
  const pickup = { ...place('Theni', 10.0104, 77.4768), id: 'tour-pickup' };
  const drop = { ...place('Theni', 10.0104, 77.4768), id: 'tour-drop' };
  const stops = [{ ...place('Madurai', 9.9252, 78.1198), id: 'stop-one' }, { ...place('Trichy', 10.7905, 78.7047), id: 'stop-two' }];
  await db.doc('locations/tour-pickup').set({ ...pickup, status: 'Active', state: '33', type: 'City' });
  const e = { code: id, status: 'New', brand: 'nesam', customerId: customer, customerName: 'Tour Customer', phone: '+919000000001', pickup: pickup.name, drop: drop.name, pickupPoint: pickup, dropPoint: drop, stops, itinerary: [pickup, ...stops, drop], pickupAt: TS.fromDate(new Date(inHours(48))), tripEndAt: TS.fromDate(new Date(inHours(72))), tripType: 'Multicity', serviceId: 'multicity', service: 'Multicity', createdBy: customer };
  await db.doc(`enquiries/${id}`).set(e);
  const quoted = await call(admin, 'priceMulticityEnquiry', { enquiryId: id, categoryId: 'tour-sedan', save: true });
  assert.equal(quoted.ok, true, JSON.stringify(quoted));
  return (await db.doc(`enquiries/${id}`).get()).data();
}
const input = (id, e) => ({ enquiryId: id, expectedRevision: e.quoteRevision, customerName: e.customerName, phone: e.phone, paymentMethod: 'UPI', customerAccepted: true, acceptanceReference: 'Customer agreed on recorded call' });

test('saved quote converts once under concurrent retries and preserves route, tax, private payout and agreement', async () => {
  const id = 'NSM-QT-870001', e = await enquiry(id);
  const results = await Promise.all([call(admin, 'convertMulticityEnquiry', input(id, e)), call(admin, 'convertMulticityEnquiry', input(id, e))]);
  for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(results[0].data.id, results[1].data.id);
  const b = (await db.doc(`bookings/${results[0].data.id}`).get()).data();
  assert.deepEqual(b.stops.map(p => p.id), ['stop-one', 'stop-two']);
  assert.equal(b.itinerary.length, 4); assert.equal(b.service, 'Multicity'); assert.equal(b.status, 'Pending');
  assert.equal(b.fare, e.estimate); assert.equal(b.pricing.partner, null); assert.equal(b.termsAcceptance.quoteRevision, e.quoteRevision);
  assert.ok((await db.doc(`booking_pricing_private/${results[0].data.id}`).get()).data().partner.basePaise > 0);
  assert.equal((await db.doc(`enquiries/${id}`).get()).data().status, 'Converted');
  assert.equal((await rest(customer, `enquiries/${id}`)).status, 403);
  assert.equal((await rest(customer, `multicity_quote_snapshots/${e.quoteRevision}`)).status, 403);
});

test('stale itinerary, expired quote, missing agreement and customer invocation cannot convert', async () => {
  const id = 'NSM-QT-870002', e = await enquiry(id), i = input(id, e);
  assert.equal((await call(customer, 'convertMulticityEnquiry', i)).ok, false);
  assert.equal((await call(admin, 'convertMulticityEnquiry', { ...i, customerAccepted: false })).ok, false);
  await db.doc(`enquiries/${id}`).update({ stops: [...e.stops].reverse() });
  const changed = await call(admin, 'convertMulticityEnquiry', i); assert.equal(changed.ok, false); assert.match(changed.message, /changed/i);
  await db.doc(`enquiries/${id}`).update({ stops: e.stops });
  await db.doc(`multicity_quote_snapshots/${e.quoteRevision}`).update({ validUntil: TS.fromMillis(Date.now() - 1) });
  const expired = await call(admin, 'convertMulticityEnquiry', i); assert.equal(expired.ok, false); assert.match(expired.message, /expired/i);
  assert.equal((await db.doc(`bookings/multicity_${id}`).get()).exists, false);
  await db.doc(`enquiries/${id}`).update({ tripEndAt: TS.fromMillis(e.pickupAt.toMillis() - 86400000) });
  const badDates = await call(admin, 'priceMulticityEnquiry', { enquiryId: id, categoryId: 'tour-sedan', save: false });
  assert.equal(badDates.ok, false); assert.match(badDates.message, /tour end/i);
});

test('pickup-state GST override is used and an unverified pin fails instead of using default GST', async () => {
  await db.doc('business_config/tariff_v2').update({ 'fareGst.nesam.Multicity': { default: { rate: .05, mode: 'excluded', classification: 'passenger', supplierState: '33', reference: 'Approved test default' }, states: { '33': { rate: .12, mode: 'excluded', classification: 'passenger', supplierState: '33', reference: 'Approved state test' } } } });
  const id = 'NSM-QT-870003', e = await enquiry(id);
  assert.equal(e.gstRate, .12);
  await db.doc(`enquiries/${id}`).update({ pickupPoint: { ...e.pickupPoint, id: 'pin' } });
  const rejected = await call(admin, 'priceMulticityEnquiry', { enquiryId: id, categoryId: 'tour-sedan', save: false });
  assert.equal(rejected.ok, false); assert.match(rejected.message, /verified pickup state/i);
});

test('customer acceptance binds to a sent quote revision; repricing invalidates the old acceptance', async () => {
  const id = 'NSM-QT-870004', e = await enquiry(id);
  const accept = { enquiryId: id, expectedEstimate: e.estimate, expectedRevision: e.quoteRevision };
  assert.equal((await call(customer, 'acceptEnquiryQuote', accept)).ok, false);
  await db.doc(`enquiries/${id}`).update({ status: 'Quote sent' });
  const accepted = await call(customer, 'acceptEnquiryQuote', accept); assert.equal(accepted.ok, true, JSON.stringify(accepted));
  assert.equal((await db.doc(`enquiries/${id}`).get()).data().acceptedQuoteRevision, e.quoteRevision);
  const refreshed = await call(admin, 'priceMulticityEnquiry', { enquiryId: id, categoryId: 'tour-sedan', save: true }); assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  const current = (await db.doc(`enquiries/${id}`).get()).data();
  assert.notEqual(current.quoteRevision, e.quoteRevision); assert.equal(current.acceptedAt, undefined); assert.equal(current.status, 'Draft');
  await db.doc(`enquiries/${id}`).update({ status: 'Quote sent' });
  assert.equal((await call(customer, 'acceptEnquiryQuote', accept)).ok, false);
  assert.equal((await call(admin, 'convertMulticityEnquiry', input(id, e))).ok, false);
});
