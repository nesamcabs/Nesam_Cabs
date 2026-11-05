const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateRules, assertBookable, assertWithinLimits, adjustPartner } = require('../lib/serviceRules');
const T = require('../lib/domain/tariff');

const pickup = { id: 'chennai', name: 'Chennai', city: 'Chennai', state: 'Tamil Nadu', lat: 13, lng: 80 };
const drop = { id: 'salem', name: 'Salem', city: 'Salem', state: 'Tamil Nadu', lat: 11, lng: 78 };
const at = new Date('2026-10-29T05:00:00Z');
const rule = (patch = {}) => ({ id: 'rule', kind: 'availability', status: 'Enabled', priority: 10, scope: { state: '', city: '', area: '', side: 'Pickup or drop' }, availability: 'Paused', ...patch });
const evaluate = (rules, when = at) => evaluateRules(rules, pickup, drop, when, 'Outstation One Way');

test('disabled and removed rules never pause new bookings', () => {
  for (const status of ['Disabled', 'Removed']) assert.equal(evaluate([rule({ status })]).availability, 'Available');
});

test('pickup schedule includes start and excludes end', () => {
  const r = rule({ schedule: { mode: 'Range', from: at.toISOString(), to: '2026-10-29T06:00:00Z' } });
  assert.equal(evaluate([r]).availability, 'Paused');
  assert.equal(evaluate([r], new Date('2026-10-29T04:59:59Z')).availability, 'Available');
  assert.equal(evaluate([r], new Date('2026-10-29T06:00:00Z')).availability, 'Available');
});

test('city scope wins over a higher priority company rule; state codes match names', () => {
  const city = rule({ id: 'city', priority: 1, availability: 'Limited', scope: { state: '33', city: 'Chennai', side: 'Pickup only' } });
  assert.equal(evaluate([rule({ priority: 100 }), city]).availability, 'Limited');
  assert.equal(evaluate([rule({ scope: { city: 'Salem', side: 'Pickup only' } })]).availability, 'Available');
});

test('cab restrictions and paused locations reject booking', () => {
  assert.throws(() => assertBookable(evaluate([rule()]), 'Sedan'), /paused/);
  const result = evaluate([rule({ kind: 'categories', categories: ['Sedan'] })]);
  assert.doesNotThrow(() => assertBookable(result, 'sedan'));
  assert.throws(() => assertBookable(result, 'SUV'), /not offered/);
});

test('all applicable customer and partner limits apply, including exact bounds', () => {
  const limit = { target: 'Customer fare', category: 'Sedan', min: 100, max: 200 };
  const result = evaluate([rule({ kind: 'limit', limit })]);
  for (const customerFare of [100, 200]) assert.doesNotThrow(() => assertWithinLimits(result, { categoryName: 'Sedan', customerFare, partnerPayout: 150 }));
  for (const customerFare of [99, 201]) assert.throws(() => assertWithinLimits(result, { categoryName: 'Sedan', customerFare, partnerPayout: 150 }), /rate review/);
  const partner = evaluate([rule({ kind: 'limit', limit: { ...limit, target: 'Partner payout' } })]);
  assert.throws(() => assertWithinLimits(partner, { categoryName: 'Sedan', customerFare: 150, partnerPayout: 201 }), /partner payout/);
});

test('partner adjustment preserves bata and original booking snapshot', () => {
  const outcome = evaluate([rule({ kind: 'pricing', partner: { mode: 'Increase', percent: 10 } })]);
  const original = { partner: { ratePaise: 1350, basePaise: 205500, bataPaise: 30000 } };
  const adjusted = adjustPartner(original, outcome);
  assert.equal(adjusted.partner.ratePaise, 1485);
  assert.equal(adjusted.partner.basePaise, 226050);
  assert.equal(adjusted.partner.bataPaise, 30000);
  assert.equal(original.partner.basePaise, 205500);
});

test('final billing keeps the scoped partner payout and adds only extra usage', () => {
  const { CONFIRMED_TARIFF_V2, quoteOneWay, quoteRoundTrip, finalizeFare } = require('../lib/domain/tariff');
  const pickupMs = Date.parse('2026-11-10T08:00:00+05:30');
  for (const direction of ['Increase','Decrease']) {
    const outcome = evaluate([rule({ kind:'pricing', partner:{mode:direction,percent:10} })]);
    for (const tour of [false,true]) {
      const q = tour ? quoteRoundTrip({config:CONFIRMED_TARIFF_V2,tariffClass:'sedan',tripType:tour?'Round Trip':'One Way',routeKm:400,durationMin:90,pickupMs,endMs:pickupMs+8*3600000})
        : quoteOneWay({config:CONFIRMED_TARIFF_V2,tariffClass:'sedan',tripType:tour?'Round Trip':'One Way',routeKm:400,durationMin:90,pickupMs});
      const pricing=adjustPartner(q.pricing,outcome);
      for(const totalKm of [pricing.quotedKm-100,pricing.quotedKm]) assert.equal(finalizeFare({pricing,totalKm,endMs:pickupMs+8*3600000}).partnerPaise,pricing.partner.basePaise);
      assert.equal(finalizeFare({pricing,totalKm:pricing.quotedKm+10,endMs:pickupMs+8*3600000}).partnerPaise,pricing.partner.basePaise+10*pricing.partner.ratePaise);
    }
  }
});

test('local pickup fare uses city minimum without the outstation floor', () => {
  const config = T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, localPickupDrop: { chennai: { cityName: 'Chennai', classes: { sedan: { minKm: 10, customerRate: 20, partnerRate: 15, extraKmRate: 22, waitingPerHour: 60, enabled: true } } } } });
  const q = T.quoteLocalPickupDrop({ config, cityId: 'chennai', tariffClass: 'sedan', routeKm: 5, durationMin: 20, pickupMs: at.getTime(), tripType: 'One Way' });
  assert.equal(q.fare.total, 210);
  assert.equal(q.pricing.partner.basePaise, 15000);
  assert.equal(q.pricing.includedKm, 10);
  assert.equal(T.localFareFor(config, 'salem', 'sedan'), null);
});

test('rental package honors included GST and refuses packages below the minimum', () => {
  const config = T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, rentalPackages: { sedan: { minHours: 4, packages: { '4': { customerFare: 1050, partnerPayout: 800, includedKm: 40, extraKmRate: 15, extraHourRate: 150, gstMode: 'included', enabled: true } } } } });
  const q = T.quoteRentalPackage({ config, hours: 4, tariffClass: 'sedan', routeKm: 20, durationMin: 240, pickupMs: at.getTime(), tripType: 'One Way' });
  assert.equal(q.fare.total, 1050);
  assert.equal(q.pricing.partner.basePaise, 80000);
  config.rentalPackages.sedan.minHours = 5;
  assert.throws(() => T.quoteRentalPackage({ config, hours: 4, tariffClass: 'sedan', pickupMs: at.getTime() }), /starts at 5/);
});

test('fixed route honors direction, category, date and explicit peak exclusion', () => {
  const route = { id: 'route', originId: 'a', destinationId: 'b', categoryId: 'sedan', serviceId: '', customerFare: 1050, partnerPayout: 800, gstMode: 'included', peakAdjustment: 'exclude', reverseDirection: false, priority: 1, effectiveFrom: '2026-10-29', effectiveUntil: '2026-10-29', version: 2 };
  const search = { originId: 'a', destinationId: 'b', categoryId: 'sedan', serviceId: '', date: '2026-10-29' };
  assert.ok(T.matchFixedRoute([route], search));
  assert.equal(T.matchFixedRoute([route], { ...search, originId: 'b', destinationId: 'a' }), null);
  assert.equal(T.matchFixedRoute([route], { ...search, date: '2026-10-30' }), null);
  assert.equal(T.matchFixedRoute([route], { ...search, categoryId: 'suv' }), null);
  const q = T.quoteFixedRoute({ rule: route, reversed: false, gstRate: 0.05, tariffVersion: 1, tariffClass: 'sedan', routeKm: 100, durationMin: 120, pickupMs: at.getTime(), adjustmentPercent: 20 });
  assert.equal(q.fare.total, 1050);
  assert.equal(q.pricing.partner.basePaise, 80000);
  assert.equal(q.pricing.fixedRouteVersion, 2);
});

