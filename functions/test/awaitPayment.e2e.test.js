// "Pay online now": the rider is told "Booking confirmed" only AFTER the online payment is recorded — never when the booking is first created.
const test = require('node:test');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, inHours, place, rid } = H;

const U = { admin: 'apAdmin', cust: 'apCustomer' };
let routing;
const withId = (p, id) => ({ id, ...p });
const theni = withId(place('Theni', 10.0104, 77.4768), 'ap-theni');
const madurai = withId(place('Madurai', 9.9252, 78.1198), 'ap-madurai');
const confirmedNotices = async () => (await db.collection('customer_notifications').where('recipientId', '==', U.cust).get()).docs.map((d) => d.data()).filter((n) => n.title === 'Booking confirmed');

async function book(over = {}) {
  const base = JSON.parse(JSON.stringify({
    requestId: rid('ap'), pickup: theni, drop: madurai, stops: [], termsAccepted: true, categoryId: 'ap-sedan', tripType: 'One Way', expectedFare: 0,
    addOns: { roofCarrier: false, pets: false }, paymentMethod: 'Cash', couponCode: '', notes: '', whatsapp: { sameAsMobile: false, countryCode: '+91', number: '9876500099' },
    scheduledAt: inHours(30), source: 'peopletaxi', bookingSource: 'peopletaxi', brand: 'peopletaxi', ...over,
  }));
  let r = await call(U.cust, 'createBooking', base);
  if (!r.ok && r.details?.fare?.total) r = await call(U.cust, 'createBooking', { ...base, expectedFare: r.details.fare.total });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.data.id;
}

test.before(async () => {
  routing = await H.startRoutingStub(8765, 80, 90);
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Admin' });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Pay Customer', phone: '+919876500099', email: 'p@example.com', walletBalance: 0 });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('vehicle_categories/ap-sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', tariffClass: 'sedan', dutyClass: 'sedan', seatingCapacity: 4, seats: 4, displayOrder: 1, fare: { baseFare: 0, baseKm: 0, perKmRate: 15, minimumFare: 0, driverAllowance: 0, nightAllowance: 0, waitingChargePerHour: 0, extraHourCharge: 0, extraKmCharge: 15, tollIncluded: false, parkingIncluded: false, permitCharge: 0 } });
  for (const [id, p] of [['ap-theni', theni], ['ap-madurai', madurai]]) await db.doc(`locations/${id}`).set({ ...p, id, status: 'Active', state: '33', type: 'City', city: p.name });
  const saved = await call(U.admin, 'saveTariffConfig', { ...CONFIRMED_TARIFF_V2, enabled: true, reason: 'await payment fixture' });
  assert.equal(saved.ok, true, JSON.stringify(saved));
});
test.after(async () => { if (routing) await new Promise((r) => routing.close(r)); });

test('a pay-later booking is confirmed to the rider at once (unchanged)', async () => {
  const before = (await confirmedNotices()).length;
  const id = await book();
  assert.equal((await confirmedNotices()).length, before + 1);
  assert.equal((await db.doc(`bookings/${id}`).get()).data().awaitingOnlinePayment, undefined);
});

test('a pay-online booking is NOT confirmed when it is created; it is flagged as waiting for its payment', async () => {
  const before = (await confirmedNotices()).length;
  const id = await book({ awaitPayment: true });
  assert.equal((await confirmedNotices()).length, before, 'no "Booking confirmed" yet');
  assert.equal((await db.doc(`bookings/${id}`).get()).data().awaitingOnlinePayment, true);
});

test('once the online payment is recorded the rider is confirmed exactly once, even if the payment is reported twice', async () => {
  const { recordGatewayReceipt } = require('../lib/payments');
  const id = await book({ awaitPayment: true });
  const fare = (await db.doc(`bookings/${id}`).get()).data().fare;
  const before = (await confirmedNotices()).length;
  const pay = { bookingId: id, paymentId: `pay_${Date.now()}`, orderId: 'order_x', amountPaise: Math.round(fare * 100), method: 'upi' };
  const first = await recordGatewayReceipt({ ...pay, source: 'checkout' });
  assert.equal(first.recorded, true);
  const after = await confirmedNotices();
  assert.equal(after.length, before + 1, 'confirmed after the payment');
  assert.match(after.find((n) => n.bookingId === id).message, /payment is received/);
  assert.equal((await db.doc(`bookings/${id}`).get()).data().awaitingOnlinePayment, undefined, 'flag cleared');
  // The webhook delivers the same payment again: nothing is recorded or sent twice.
  const again = await recordGatewayReceipt({ ...pay, source: 'webhook' });
  assert.equal(again.recorded, false);
  assert.equal((await confirmedNotices()).length, before + 1);
});

test('a pay-later booking that is paid online later gets no second "Booking confirmed"', async () => {
  const { recordGatewayReceipt } = require('../lib/payments');
  const id = await book();
  const fare = (await db.doc(`bookings/${id}`).get()).data().fare;
  const before = (await confirmedNotices()).length;
  await recordGatewayReceipt({ bookingId: id, paymentId: `pay_${Date.now()}_b`, orderId: 'order_y', amountPaise: Math.round(fare * 100), method: 'card', source: 'checkout' });
  assert.equal((await confirmedNotices()).length, before);
});

// ── The three payment choices (Service & Fare Settings › Payment options) ──
const choices = (over = {}) => {
  const rule = () => ({ visible: true, schedule: { mode: 'Always', from: '', to: '' }, basis: 'booking', districts: { mode: 'All', list: [] } });
  return { options: { later: rule(), part: rule(), full: rule(), ...over.options }, partPercent: over.partPercent ?? 25, recommended: 'part' };
};
const saveChoices = async (over) => {
  const cur = await call(U.admin, 'getPaymentChoiceSettings', {});
  assert.equal(cur.ok, true, JSON.stringify(cur));
  const r = await call(U.admin, 'savePaymentChoiceSettings', { ...choices(over), expectedVersion: cur.data.version });
  assert.equal(r.ok, true, JSON.stringify(r));
};
const bookRaw = async (over) => {
  const base = { requestId: rid('pc'), pickup: theni, drop: madurai, stops: [], termsAccepted: true, categoryId: 'ap-sedan', tripType: 'One Way', expectedFare: 0, addOns: { roofCarrier: false, pets: false }, paymentMethod: 'Cash', couponCode: '', notes: '', whatsapp: { sameAsMobile: false, countryCode: '+91', number: '9876500099' }, scheduledAt: inHours(30), source: 'peopletaxi', bookingSource: 'peopletaxi', brand: 'peopletaxi', ...over };
  let r = await call(U.cust, 'createBooking', JSON.parse(JSON.stringify(base)));
  if (!r.ok && r.details?.fare?.total) r = await call(U.cust, 'createBooking', JSON.parse(JSON.stringify({ ...base, expectedFare: r.details.fare.total })));
  return r;
};

test('"Pay 25% now" records the advance, rounded up, and waits for the payment', async () => {
  await saveChoices({ partPercent: 25 });
  const r = await bookRaw({ paymentOption: 'part' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = (await db.doc(`bookings/${r.data.id}`).get()).data();
  assert.equal(b.awaitingOnlinePayment, true);
  assert.equal(b.paymentOption, 'part');
  assert.deepEqual(b.paymentPlan, { option: 'part', percent: 25, advanceAmount: Math.ceil(b.fare * 0.25 - 1e-9) });
});

test('"Pay later" through the new field behaves like before: confirmed at once, no plan', async () => {
  await saveChoices({});
  const before = (await confirmedNotices()).length;
  const r = await bookRaw({ paymentOption: 'later' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const b = (await db.doc(`bookings/${r.data.id}`).get()).data();
  assert.equal(b.awaitingOnlinePayment, undefined);
  assert.equal(b.paymentPlan, undefined);
  assert.equal((await confirmedNotices()).length, before + 1);
});

test('a hidden option cannot be booked by calling the server directly', async () => {
  await saveChoices({ options: { part: { visible: false, schedule: { mode: 'Always', from: '', to: '' }, basis: 'booking', districts: { mode: 'All', list: [] } } } });
  const r = await bookRaw({ paymentOption: 'part' });
  assert.equal(r.ok, false);
  assert.match(JSON.stringify(r), /not available/);
  assert.equal((await bookRaw({ paymentOption: 'full' })).ok, true);
});

test('district limits use the pickup place: Only Madurai refuses a Theni pickup, and an Except Theni list does too', async () => {
  const rule = (mode, list) => ({ visible: true, schedule: { mode: 'Always', from: '', to: '' }, basis: 'booking', districts: { mode, list } });
  await saveChoices({ options: { full: rule('Only', ['Madurai']) } });
  assert.equal((await bookRaw({ paymentOption: 'full' })).ok, false);
  await saveChoices({ options: { full: rule('Only', ['Theni']) } });
  assert.equal((await bookRaw({ paymentOption: 'full' })).ok, true);
  await saveChoices({ options: { full: rule('Except', ['Theni']) } });
  assert.equal((await bookRaw({ paymentOption: 'full' })).ok, false);
});

test('a date window that has not started yet hides the option', async () => {
  const rule = { visible: true, schedule: { mode: 'Range', from: '2099-01-01', to: '' }, basis: 'booking', districts: { mode: 'All', list: [] } };
  await saveChoices({ options: { part: rule } });
  assert.equal((await bookRaw({ paymentOption: 'part' })).ok, false);
});

test('only staff with pricing access can read or change the options, and bad settings are refused', async () => {
  assert.equal((await call(U.cust, 'getPaymentChoiceSettings', {})).ok, false);
  assert.equal((await call(U.cust, 'savePaymentChoiceSettings', choices())).ok, false);
  const none = { visible: false, schedule: { mode: 'Always', from: '', to: '' }, basis: 'booking', districts: { mode: 'All', list: [] } };
  const r = await call(U.admin, 'savePaymentChoiceSettings', choices({ options: { later: none, part: none, full: none } }));
  assert.equal(r.ok, false);
  await saveChoices({});
});
