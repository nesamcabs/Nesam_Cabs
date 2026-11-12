const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const P = require('../lib/domain/platformFee');
const T = require('../lib/domain/tariff');

const rule = (patch = {}) => ({ enabled: true, percent: 5, min: 50, cap: 250, ...patch });
const cents = (v) => Math.round(v * 100) / 100;

test('hybrid fee: percent of the fare, raised to the minimum and lowered to the cap', () => {
  assert.equal(P.platformFeeAmount(rule(), 3000), 150); // 5% of 3000
  assert.equal(P.platformFeeAmount(rule(), 500), 50); // 5% = 25, raised to the 50 minimum
  assert.equal(P.platformFeeAmount(rule(), 20000), 250); // 5% = 1000, lowered to the 250 cap
  assert.equal(P.platformFeeAmount(rule({ cap: 0 }), 20000), 1000); // cap 0 = no cap
  assert.equal(P.platformFeeAmount(rule({ min: 0 }), 100), 5);
  assert.equal(P.platformFeeAmount(rule({ enabled: false }), 3000), 0);
  assert.equal(P.platformFeeAmount(rule(), 0), 0);
  assert.equal(P.platformFeeAmount(rule({ percent: 4.5 }), 3333), 150); // whole rupees: 149.985 → 150
});

test('settings are read safely: nothing is on until an admin switches it on', () => {
  const none = P.parsePlatformFee(null);
  assert.equal(none.version, 0);
  for (const s of P.PLATFORM_FEE_SERVICES) assert.deepEqual(none.services[s], { enabled: false, percent: 5, min: 50, cap: 250 });
  const some = P.parsePlatformFee({ version: 3, services: { airport: { enabled: true, percent: 10, min: 80, cap: 400 }, local: { enabled: 'yes', percent: -4, min: 'x', cap: 1e9 } } });
  assert.deepEqual(some.services.airport, { enabled: true, percent: 10, min: 80, cap: 400 });
  assert.deepEqual(some.services.local, { enabled: false, percent: 5, min: 50, cap: 250 });
  assert.equal(some.version, 3);
});

const category = () => ({ ...mapCategory('suv', { name: 'SUV', seatingCapacity: 6, fare: { perKmRate: 18 }, }), tariffClass: 'suv' });
const policy = (mode) => ({ common: { 'One Way': { default: { supplierState: '33', rate: 0.05, mode, classification: 'passenger', reference: 'Approved test policy' } } } });
const config = (services = {}) => ({ version: 1, services: Object.fromEntries(P.PLATFORM_FEE_SERVICES.map((s) => [s, services[s] ?? { enabled: false, percent: 5, min: 50, cap: 250 }])) });
const input = (patch = {}, mode = 'excluded') => ({
  nightAllowance: { enabled: true, amount: 300, version: 1 }, category: category(), route: { distanceKm: 160, durationMin: 180 }, tripType: 'One Way',
  pickup: { id: 'pin', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.08, lng: 80.27, type: 'other' },
  drop: { id: 'pin', name: 'Pondicherry', address: 'Pondicherry', lat: 11.94, lng: 79.8, type: 'other' },
  pickupAt: new Date('2026-11-08T12:00:00+05:30'), tripEndAt: null,
  tariff: T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 1, enabled: true, fareGst: policy(mode) }),
  adjustment: null, brand: 'nesam', ...patch,
});

test('an outstation booking gets the fee on top, inside the taxable amount, with a Platform fee line', () => {
  const base = priceBooking(input());
  const fee = priceBooking(input({ platformFee: config({ outstation: rule() }) }));
  const expected = P.platformFeeAmount(rule(), base.fare.taxableAmount);
  assert.ok(expected >= 50 && expected <= 250);
  assert.equal(fee.fare.platformFee, expected);
  assert.equal(fee.fare.taxableAmount, cents(base.fare.taxableAmount + expected));
  assert.equal(fee.fare.total, cents(fee.fare.taxableAmount + fee.fare.gst)); // total = taxable + GST still holds
  assert.equal(fee.breakup.packageTotal, fee.fare.total);
  const lines = fee.breakup.lines.filter((l) => l.key === 'platformFee');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].amount, expected);
  assert.equal(lines[0].label, 'Platform fee');
  assert.match(lines[0].detail, /5% of the fare/);
  assert.match(lines[0].detail, /minimum ₹50/);
  assert.match(lines[0].detail, /maximum ₹250/);
  assert.ok(fee.breakup.lines.findIndex((l) => l.key === 'platformFee') < fee.breakup.lines.findIndex((l) => l.key === 'gst'));
  assert.deepEqual(fee.pricing.platformFee, { service: 'outstation', amount: expected, percent: 5, min: 50, cap: 250 });
});

test('a service with the fee off, or no settings at all, is unchanged', () => {
  const base = priceBooking(input());
  assert.deepEqual(priceBooking(input({ platformFee: config({ local: rule(), airport: rule() }) })), base); // outstation is off
  assert.deepEqual(priceBooking(input({ platformFee: null })), base);
  assert.equal(base.breakup.lines.some((l) => l.key === 'platformFee'), false);
});

test('each kind of service reads its own setting', () => {
  const of = (model, service, multicity) => P.platformFeeServiceOf({ pricing: { model }, service }, multicity);
  assert.equal(of('one_way_standard', 'Outstation'), 'outstation');
  assert.equal(of('round_trip_calendar', 'Outstation'), 'outstation');
  assert.equal(of('fixed_route', 'Outstation'), 'outstation');
  assert.equal(of('local_pickup_drop', 'Local'), 'local');
  assert.equal(of('legacy_category', 'Local'), 'local');
  assert.equal(of('rental_package', 'Rental'), 'rental');
  assert.equal(of('airport_transfer', 'Airport'), 'airport');
  assert.equal(of('round_trip_calendar', 'Outstation', true), 'multicity');
});

test('the cap and minimum apply to the fare as priced', () => {
  const base = priceBooking(input());
  const capped = priceBooking(input({ platformFee: config({ outstation: rule({ percent: 50, cap: 100 }) }) }));
  assert.equal(capped.fare.platformFee, 100);
  const floored = priceBooking(input({ platformFee: config({ outstation: rule({ percent: 0.1, min: 75 }) }) }));
  assert.equal(floored.fare.platformFee, 75);
  assert.ok(capped.fare.total > base.fare.total);
});

test('GST included in the fare: the customer pays the fee plus its GST', () => {
  const base = priceBooking(input({}, 'included'));
  const fee = priceBooking(input({ platformFee: config({ outstation: rule() }) }, 'included'));
  assert.equal(fee.fare.total, cents(fee.fare.taxableAmount + fee.fare.gst));
  assert.ok(fee.fare.total > base.fare.total);
  assert.equal(fee.breakup.packageTotal, fee.fare.total);
});

test('it combines with the night allowance (the fee is taken on the fare including it)', () => {
  const night = priceBooking(input({ pickupAt: new Date('2026-11-08T23:30:00+05:30') }));
  const both = priceBooking(input({ pickupAt: new Date('2026-11-08T23:30:00+05:30'), platformFee: config({ outstation: rule() }) }));
  assert.equal(both.fare.nightCharge, 300);
  assert.equal(both.fare.platformFee, P.platformFeeAmount(rule(), night.fare.taxableAmount));
  assert.equal(both.fare.total, cents(both.fare.taxableAmount + both.fare.gst));
});

test('the fee stays as booked in the final fare', () => {
  const quoted = priceBooking(input({ platformFee: config({ outstation: rule() }) }));
  const final = T.finalizeFare({ pricing: quoted.pricing, totalKm: 160, endMs: input().pickupAt.getTime() });
  assert.equal(final.fare.platformFee, quoted.fare.platformFee);
  assert.equal(final.fare.total, quoted.fare.total);
});
