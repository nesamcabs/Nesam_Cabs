const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/domain/tariff');
const { rentalHoursOf } = require('../lib/quote');
const pkg = h => ({ customerFare: h * 100, partnerPayout: h * 70, includedKm: h * 10, extraKmRate: 15, extraHourRate: 100, gstMode: 'excluded', enabled: true });

test('all whole-hour rental packages from 1 through 15 survive parsing and quoting', () => {
  const rentalPackages = Object.fromEntries(T.TARIFF_CLASSES.map(c => [c, { minHours: 10, packages: Object.fromEntries(Array.from({ length: 15 }, (_, i) => [String(i + 1), pkg(i + 1)])) }]));
  const cfg = T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, rentalPackages, version: 1 });
  assert.deepEqual(T.RENTAL_HOURS, Array.from({ length: 15 }, (_, i) => i + 1));
  for (const tariffClass of T.TARIFF_CLASSES) {
    assert.equal(T.rentalMinHours(cfg, tariffClass), 1);
    assert.equal(T.defaultRentalHours(cfg, tariffClass), 1);
    for (let hours = 1; hours <= 15; hours++) {
      const q = T.quoteRentalPackage({ config: cfg, tariffClass, hours, tripType: 'One Way', routeKm: 1, durationMin: 1, pickupMs: Date.now() });
      assert.equal(q.pricing.rentalHours, hours);
      assert.equal(q.fare.total, hours * 105);
      assert.equal(q.pricing.partner.basePaise, hours * 7000);
    }
  }
});

test('request validation rejects invalid durations instead of silently choosing another package', () => {
  for (let h = 1; h <= 15; h++) assert.equal(rentalHoursOf(h), h);
  for (const value of [0, 16, 1.5, '1', NaN]) assert.throws(() => rentalHoursOf(value), /1 to 15/);
  assert.equal(rentalHoursOf(undefined), null);
});

test('unsupported and unpriced packages do not invent a fare', () => {
  const cfg = T.parseTariffConfig(T.CONFIRMED_TARIFF_V2);
  assert.match(T.rentalPackageFor(cfg, 'sedan', 1).error, /not configured/);
  assert.match(T.rentalPackageFor(cfg, 'sedan', 16).error, /not offered/);
});
