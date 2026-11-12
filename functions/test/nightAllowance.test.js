const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const { isNightAllowanceTime, nightAllowanceFor, nightAllowanceByBrandOf } = require('../lib/domain/nightAllowance');
const T = require('../lib/domain/tariff');

const policy = (mode) => ({ common: { 'One Way': { default: { supplierState: '33', rate: 0.05, mode, classification: 'passenger', reference: 'Approved test policy' } } } });
const category = (night) => ({ ...mapCategory('suv', { name: 'SUV', seatingCapacity: 6, fare: { perKmRate: 18 }, ...(night ? { nightAllowanceByBrand: night } : {}) }), tariffClass: 'suv' });
const input = (patch = {}, mode = 'excluded') => ({
  category: category({ nesam: 300, people_taxi: 250 }), route: { distanceKm: 160, durationMin: 180 }, tripType: 'One Way',
  pickup: { id: 'pin', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.08, lng: 80.27, type: 'other' },
  drop: { id: 'pin', name: 'Pondicherry', address: 'Pondicherry', lat: 11.94, lng: 79.8, type: 'other' },
  pickupAt: new Date('2026-11-08T23:30:00+05:30'), tripEndAt: null,
  tariff: T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 1, enabled: true, fareGst: policy(mode) }),
  adjustment: null, brand: 'nesam', ...patch,
});
const at = (hhmm) => new Date(`2026-11-08T${hhmm}:00+05:30`);
const cents = (v) => Math.round(v * 100) / 100;

test('the night window is 11 PM to 6 AM India time', () => {
  for (const [time, night] of [['22:59', false], ['23:00', true], ['23:59', true], ['00:00', true], ['05:59', true], ['06:00', false], ['12:00', false]]) {
    assert.equal(isNightAllowanceTime(at(time)), night, time);
  }
  // 6:30 PM UTC is 12:00 AM IST: the window follows India time, not the server's clock.
  assert.equal(isNightAllowanceTime(new Date('2026-11-08T18:30:00Z')), true);
});

test('only valid amounts are kept, per brand', () => {
  assert.deepEqual(nightAllowanceByBrandOf({ nesam: 300, people_taxi: 0, onewaycarrentals: -5, x: 'a', y: 1e9 }), { nesam: 300 });
  assert.deepEqual(nightAllowanceByBrandOf(null), {});
  assert.equal(nightAllowanceFor(category({ nesam: 300 }), 'people_taxi'), 0);
  assert.equal(nightAllowanceFor(category({ nesam: 300 }), undefined), 300);
});

test('a night pickup adds the brand amount plus GST and shows a Night allowance line', () => {
  const day = priceBooking(input({ pickupAt: at('12:00') }));
  const night = priceBooking(input());
  assert.equal(night.fare.nightCharge, 300);
  assert.equal(night.fare.taxableAmount, cents(day.fare.taxableAmount + 300));
  assert.equal(night.fare.total, cents(night.fare.taxableAmount + night.fare.gst));
  assert.equal(night.fare.gst, cents(night.fare.taxableAmount * night.fare.gstRate));
  assert.equal(night.breakup.packageTotal, night.fare.total);
  const lines = night.breakup.lines.filter((l) => l.key === 'night');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, 300);
  assert.equal(lines[0].label, 'Night allowance');
  assert.ok(night.breakup.lines.findIndex((l) => l.key === 'night') < night.breakup.lines.findIndex((l) => l.key === 'gst'));
  assert.deepEqual(night.pricing.nightAllowance, { amount: 300, startHour: 23, endHour: 6 });
});

test('a day pickup is unchanged and has no night line', () => {
  const day = priceBooking(input({ pickupAt: at('12:00') }));
  const none = priceBooking(input({ pickupAt: at('12:00'), category: category() }));
  assert.deepEqual(day, none);
  assert.equal(day.breakup.lines.some((l) => l.key === 'night'), false);
  assert.equal(day.pricing.nightAllowance, undefined);
});

test('each brand uses its own amount, and a brand with none is not charged', () => {
  assert.equal(priceBooking(input({ brand: 'nesam' })).fare.nightCharge, 300);
  assert.equal(priceBooking(input({ brand: 'people_taxi' })).fare.nightCharge, 250);
  const other = priceBooking(input({ brand: 'onewaycarrentals' }));
  assert.equal(other.fare.nightCharge, 0);
  assert.equal(other.breakup.lines.some((l) => l.key === 'night'), false);
});

test('when GST is included in the fare, the entered amount is the customer-facing amount', () => {
  const day = priceBooking(input({ pickupAt: at('12:00') }, 'included'));
  const night = priceBooking(input({}, 'included'));
  assert.equal(cents(night.fare.total - day.fare.total), 300);
  assert.equal(night.fare.total, cents(night.fare.taxableAmount + night.fare.gst));
  assert.equal(night.pricing.nightAllowance.grossAmount, 300);
  assert.equal(night.breakup.packageTotal, night.fare.total);
});

test('the night allowance stays in the final fare', () => {
  const quoted = priceBooking(input());
  const final = T.finalizeFare({ pricing: quoted.pricing, totalKm: 160, endMs: input().pickupAt.getTime() });
  assert.equal(final.fare.nightCharge, 300);
  assert.equal(final.fare.total, quoted.fare.total);
});

test('it combines with the roof carrier add-on without double counting', () => {
  const both = priceBooking(input({ addOns: { roofCarrier: true, pets: false }, category: { ...category({ nesam: 300 }), fare: { ...category().fare, extras: { ...category().fare.extras, carrierCharge: 400 } } } }));
  const base = priceBooking(input({ pickupAt: at('12:00') }));
  assert.equal(cents(both.fare.taxableAmount - base.fare.taxableAmount), 700);
  assert.equal(both.fare.total, cents(both.fare.taxableAmount + both.fare.gst));
});
