// A same-day package trip that is still running: the customer is warned an hour before the package ends, and the trip moves to the next package
// that fits when it runs past it. Works for every short slab: the built-in 5-hour and 8-hour, and any extra hour slab the office adds.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const T = require('../lib/domain/tariff');
const { timePackageStep } = require('../lib/timePackageJobs');

const IST = (s) => Date.parse(`${s}+05:30`);
const sedan = {
  customerRate: 14, customerBata: 500, partnerRate: 12.6, partnerBata: 400, minKmPerDay: 250,
  timeBased: { fiveFare: 2080, fiveKm: 100, fivePartner: 1870, eightFare: 2780, eightKm: 150, eightPartner: 2500, morningFare: 4500, morningKm: 250, morningPartner: 4050 },
};
const config = (extraSlabs, extra) => T.parseTariffConfig({
  ...T.CONFIRMED_TARIFF_V2, version: 8, enabled: true,
  roundTrip: { maxDays: 30, timeBased: { enabled: true, ...(extraSlabs ? { extraSlabs } : {}) }, classes: { sedan: { ...sedan, timeBased: { ...sedan.timeBased, ...(extra ? { extra } : {}) } } } },
  roundTripExtras: { sedan: { extraKmRate: 14, waitingPerHour: 150 } },
});
const plain = config();
const withExtras = config([{ hours: 3, kmLimit: 60 }, { hours: 10, kmLimit: 200 }], { h3: { fare: 1400, km: 60, partner: 1250 }, h10: { fare: 3300, km: 200, partner: 2950 } });

const START = IST('2026-11-17T09:00:00');
const hr = (h) => START + h * 3_600_000;
const booking = (cfg, pkg) => {
  const q = T.quoteRoundTripTimeBased({ config: cfg, tariffClass: 'sedan', tripType: 'Round Trip', routeKm: 20, durationMin: 40, pickupMs: START, endMs: IST('2026-11-17T23:45:00'), tripDays: 1, timePackage: pkg });
  return { status: 'Ongoing', pricing: q.pricing, tripStartedAt: { toMillis: () => START } };
};
const clock = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

test('5-hour package: no notice at 3 h, a notice in the last hour, the 8-hour package once it runs past 5 h', () => {
  const b = booking(plain, 'same:five');
  assert.equal(timePackageStep(b, hr(3)).warn, undefined);
  const warn = timePackageStep(b, hr(4.2));
  assert.equal(warn.now.slab, 'five');
  assert.equal(warn.warn.slab, 'eight');
  assert.equal(warn.warn.fromFarePaise / 100, 2080);
  assert.equal(warn.warn.toFarePaise / 100, 2780);
  assert.equal(warn.warn.toKm, 150);
  assert.equal(clock(warn.warn.endsAtMs), clock(hr(5)));
  assert.equal(timePackageStep(b, hr(4.99)).now.upgraded, false);
  const past = timePackageStep(b, hr(5.2));
  assert.equal(past.now.slab, 'eight');
  assert.equal(past.now.upgraded, true);
  assert.equal(past.toFarePaise / 100, 2780);
});

test('8-hour package: warned an hour before, then it moves up to the Full Day', () => {
  const b = booking(plain, 'same:eight');
  assert.equal(timePackageStep(b, hr(6.9)).warn, undefined);
  const warn = timePackageStep(b, hr(7.3));
  assert.equal(warn.warn.slab, 'full');
  assert.equal(clock(warn.warn.endsAtMs), clock(hr(8)));
  const past = timePackageStep(b, hr(8.3));
  assert.equal(past.now.slab, 'full');
  assert.equal(past.now.upgraded, true);
});

test('an extra 3-hour slab behaves the same: warned at 2 h, on to the next slab (5-hour) after 3 h', () => {
  const b = booking(withExtras, 'same:h3');
  assert.equal(timePackageStep(b, hr(1.5)).warn, undefined);
  const warn = timePackageStep(b, hr(2.2));
  assert.equal(warn.warn.slab, 'five');
  assert.equal(clock(warn.warn.endsAtMs), clock(hr(3)));
  const past = timePackageStep(b, hr(3.2));
  assert.equal(past.now.slab, 'five');
  assert.equal(past.now.upgraded, true);
});

test('an extra 10-hour slab is the one the 8-hour package moves up to', () => {
  const b = booking(withExtras, 'same:eight');
  assert.equal(timePackageStep(b, hr(7.3)).warn.slab, 'h10');
  assert.equal(timePackageStep(b, hr(8.3)).now.slab, 'h10');
});

test('after one move the next package gets its own warning', () => {
  const b = booking(plain, 'same:five');
  // 5 h → 8 h at 5 h; the 8-hour package ends at 8 h, warned from 7 h.
  const s = timePackageStep(b, hr(7.3));
  assert.equal(s.now.slab, 'eight');
  assert.equal(s.now.upgraded, true);
  assert.equal(s.warn.slab, 'full');
});

test('trips with nothing to move: not started, not a same-day package, or already on the Full Day', () => {
  const b = booking(plain, 'same:five');
  assert.equal(timePackageStep({ ...b, tripStartedAt: undefined }, hr(4.5)), null);
  assert.equal(timePackageStep({ ...b, pricing: { ...b.pricing, timeBased: { ...b.pricing.timeBased, kind: 'next' } } }, hr(4.5)), null);
  assert.equal(timePackageStep({ status: 'Ongoing' }, hr(4.5)), null);
  const full = timePackageStep(booking(plain, 'same:full'), hr(7));
  assert.equal(full.warn, undefined);
  assert.equal(full.now.upgraded, false);
});
