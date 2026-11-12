const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const { isNightAllowanceTime, nightAllowanceFor, parseNightAllowance } = require('../lib/domain/nightAllowance');
const T = require('../lib/domain/tariff');

const policy = (mode) => ({ common: { 'One Way': { default: { supplierState: '33', rate: 0.05, mode, classification: 'passenger', reference: 'Approved test policy' } } } });
const category = (id = 'suv') => ({ ...mapCategory(id, { name: 'SUV', seatingCapacity: 6, fare: { perKmRate: 18 } }), tariffClass: 'suv' });
const night = (patch = {}) => ({ enabled: true, amount: 300, version: 1, ...patch });
const input = (patch = {}, mode = 'excluded') => ({
  category: category(), route: { distanceKm: 160, durationMin: 180 }, tripType: 'One Way',
  pickup: { id: 'pin', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.08, lng: 80.27, type: 'other' },
  drop: { id: 'pin', name: 'Pondicherry', address: 'Pondicherry', lat: 11.94, lng: 79.8, type: 'other' },
  pickupAt: new Date('2026-11-08T23:30:00+05:30'), tripEndAt: null,
  tariff: T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 1, enabled: true, fareGst: policy(mode) }),
  adjustment: null, brand: 'nesam', nightAllowance: night(), ...patch,
});
const at = (hhmm) => new Date(`2026-11-08T${hhmm}:00+05:30`);
const cents = (v) => Math.round(v * 100) / 100;

test('the night window is 11 PM to 6 AM India time', () => {
  for (const [time, isNight] of [['22:59', false], ['23:00', true], ['23:59', true], ['00:00', true], ['05:59', true], ['06:00', false], ['12:00', false]]) {
    assert.equal(isNightAllowanceTime(at(time)), isNight, time);
  }
  // 6:30 PM UTC is 12:00 AM IST: the window follows India time, not the server's clock.
  assert.equal(isNightAllowanceTime(new Date('2026-11-08T18:30:00Z')), true);
});

test('the setting is read safely: nothing is charged until it is on with an amount', () => {
  assert.deepEqual(parseNightAllowance(null), { enabled: false, amount: 0, version: 0 });
  assert.deepEqual(parseNightAllowance({ enabled: true, amount: 300, version: 4 }), { enabled: true, amount: 300, version: 4 });
  assert.equal(parseNightAllowance({ enabled: true, amount: -5 }).amount, 0);
  assert.equal(parseNightAllowance({ enabled: true, amount: 1e9 }).amount, 0);
  assert.equal(nightAllowanceFor(night()), 300);
  assert.equal(nightAllowanceFor(night({ enabled: false })), 0);
  assert.equal(nightAllowanceFor(null), 0);
});

test('a night pickup adds the amount plus GST and shows a Night allowance line', () => {
  const day = priceBooking(input({ pickupAt: at('12:00') }));
  const n = priceBooking(input());
  assert.equal(n.fare.nightCharge, 300);
  assert.equal(n.fare.taxableAmount, cents(day.fare.taxableAmount + 300));
  assert.equal(n.fare.total, cents(n.fare.taxableAmount + n.fare.gst));
  assert.equal(n.fare.gst, cents(n.fare.taxableAmount * n.fare.gstRate));
  assert.equal(n.breakup.packageTotal, n.fare.total);
  const lines = n.breakup.lines.filter((l) => l.key === 'night');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 300);
  assert.equal(lines[0].label, 'Night allowance');
  assert.ok(n.breakup.lines.findIndex((l) => l.key === 'night') < n.breakup.lines.findIndex((l) => l.key === 'gst'));
  assert.deepEqual(n.pricing.nightAllowance, { amount: 300, startHour: 23, endHour: 6 });
});

test('a day pickup, or the setting being off, leaves the fare unchanged', () => {
  const day = priceBooking(input({ pickupAt: at('12:00') }));
  assert.deepEqual(day, priceBooking(input({ pickupAt: at('12:00'), nightAllowance: null })));
  assert.equal(day.breakup.lines.some((l) => l.key === 'night'), false);
  assert.equal(day.pricing.nightAllowance, undefined);
  const off = priceBooking(input({ nightAllowance: night({ enabled: false }) }));
  assert.equal(off.fare.nightCharge, 0);
  assert.equal(off.breakup.lines.some((l) => l.key === 'night'), false);
});

test('the one amount applies to every brand and every vehicle', () => {
  for (const brand of ['nesam', 'people_taxi', 'onewaycarrentals']) {
    assert.equal(priceBooking(input({ brand })).fare.nightCharge, 300, brand);
  }
  assert.equal(priceBooking(input({ category: category('other-vehicle') })).fare.nightCharge, 300);
});

test('when GST is included in the fare, the entered amount is the customer-facing amount', () => {
  const day = priceBooking(input({ pickupAt: at('12:00') }, 'included'));
  const n = priceBooking(input({}, 'included'));
  assert.equal(cents(n.fare.total - day.fare.total), 300);
  assert.equal(n.fare.total, cents(n.fare.taxableAmount + n.fare.gst));
  assert.equal(n.pricing.nightAllowance.grossAmount, 300);
  assert.equal(n.breakup.packageTotal, n.fare.total);
});

test('the night allowance stays in the final fare', () => {
  const quoted = priceBooking(input());
  const final = T.finalizeFare({ pricing: quoted.pricing, totalKm: 160, endMs: input().pickupAt.getTime() });
  assert.equal(final.fare.nightCharge, 300);
  assert.equal(final.fare.total, quoted.fare.total);
});

test('it combines with the roof carrier add-on without double counting', () => {
  const cat = { ...category(), fare: { ...category().fare, extras: { ...category().fare.extras, carrierCharge: 400 } } };
  const both = priceBooking(input({ addOns: { roofCarrier: true, pets: false }, category: cat }));
  const base = priceBooking(input({ pickupAt: at('12:00'), nightAllowance: null }));
  assert.equal(cents(both.fare.taxableAmount - base.fare.taxableAmount), 700);
  assert.equal(both.fare.total, cents(both.fare.taxableAmount + both.fare.gst));
});
