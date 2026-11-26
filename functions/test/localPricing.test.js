const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const L = require('../lib/domain/localPricing');
const T = require('../lib/domain/tariff');
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const { splitPricing } = require('../lib/domain/pricingPrivacy');
const { computeExtraCharges } = require('../lib/domain/extraCharges');
const { localWaitingCredit } = require('../lib/domain/localCharges');
const { adjustPartner } = require('../lib/serviceRules');
const { pinsOfCity } = require('../lib/domain/pincodeLookup');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');

const cents = (v) => Math.round(v * 100) / 100;
const rule = (p = {}) => ({ minimumFare: 150, baseFare: 100, includedKm: 3, extraPerKm: 20, freeWaitMins: 5, waitPerMin: 2, ...p });
const partnerRule = (p = {}) => ({ minimumFare: 120, baseFare: 80, includedKm: 3, extraPerKm: 15, freeWaitMins: 10, waitPerMin: 1, ...p });
const row = (p = {}) => ({ customerFare: 900, partnerPayout: 700, includedKm: 40, extraKmRate: 14, extraHourRate: 150, ...p });
const fares = (p = {}) => ({ district: { customer: { sedan: rule() }, partner: { sedan: partnerRule() }, rental: { sedan: { 4: row() } } }, zones: {}, areas: {}, ...p });
const settings = (edit) => { const s = L.defaultSettings(); edit?.(s); return s; };
const peakOn = (s, patch = {}) => { s.peak.localEnabled = true; s.peak.rentalEnabled = true; Object.assign(s.peak.rules[0], { active: true, value: 10, maxCap: 50 }, patch); };

// 25 Nov 2026 is a Wednesday.
const at = (hhmm, day = '25') => new Date(`2026-11-${day}T${hhmm}:00+05:30`);
const place = (name, extra = {}) => ({ id: 'pin', name, address: `${name}, Theni, Tamil Nadu 625531`, lat: 10.01, lng: 77.47, type: 'other', pincode: '625531', ...extra });
const category = (name = 'Sedan', seats = 4) => ({ ...mapCategory('sedan', { name, seatingCapacity: seats }) });
const context = (p = {}) => ({ key: '33~theni', district: 'Theni', pin: '625531', brand: 'nesam', fares: { common: fares() }, settings: settings(), version: 1, sameDistrict: true, toll: 0, ...p });
const tariff = T.parseTariffConfig({ ...CONFIRMED_TARIFF_V2, version: 1, enabled: true });
const ride = (p = {}) => ({
  category: category(), route: { distanceKm: 10, durationMin: 25 }, tripType: 'One Way', pickup: place('Allinagaram'), drop: place('Bus stand', { lat: 10.02 }),
  pickupAt: at('12:00'), tripEndAt: null, tariff, adjustment: null, brand: 'nesam', localFare: context(), ...p,
});
const rental = (p = {}) => ride({ tripType: 'Local Rental', rentalHours: 4, route: { distanceKm: 1, durationMin: 240 }, ...p });
/** Every line that makes up the taxable fare adds up to it. */
const assertAddsUp = (r) => {
  const keys = ['package', 'distance', 'minimum', 'night', 'peak', 'routeToll', 'airportEntry', 'platformFee'];
  const sum = r.breakup.lines.filter((l) => keys.includes(l.key)).reduce((s, l) => s + (l.amount ?? 0), 0);
  assert.ok(Math.abs(sum - r.fare.subtotal) < 0.02, `lines ${sum} vs subtotal ${r.fare.subtotal}`);
  assert.equal(r.fare.total, cents(r.fare.taxableAmount + r.fare.gst));
  assert.equal(r.breakup.packageTotal, r.fare.total);
};

test('the admin Test quote uses exactly the server pricing rules', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read('../../admin/src/domain/localPricing.ts'), read('../src/domain/localPricing.ts'));
});

test('the pickup district is known from its pincode', () => {
  assert.ok(pinsOfCity('Theni', '33').has('625531'));
  assert.ok(pinsOfCity('Theni', '33').has('625534'));
  assert.equal(L.districtKey('33', 'Theni'), '33~theni');
});

test('bill = base + extra km, never below the minimum fare; waiting uses up the minimum first', () => {
  assert.deepEqual(L.rideParts(rule(), 10), { distanceKm: 10, baseFare: 100, includedKm: 3, extraKm: 7, extraKmCharge: 140, minimumTopUp: 0, rideFare: 240 });
  assert.equal(L.rideFare(rule(), 2), 150);
  assert.equal(L.rideParts(rule(), 2).minimumTopUp, 50);
  assert.deepEqual(L.waitingCharge(rule(), 10, 15), { chargeableMins: 10, metered: 20, charge: 20 });
  // On the floor: base 100, minimum 150: the first 50 rupees of waiting are already paid for.
  assert.equal(L.waitingCharge(rule(), 2, 20).charge, 0);
  assert.equal(L.waitingCharge(rule(), 2, 40).charge, 20);
  assert.equal(L.minimumHeadroom(rule(), 2), 50);
});

test('inheritance is area → zone → district, a brand before the shared rates', () => {
  const geo = { zones: [{ id: 'z1', name: 'Theni Zone', pins: ['625531'] }], tamil: {} };
  const common = fares({ zones: { z1: { customer: { sedan: rule({ baseFare: 110 }) } } }, areas: { 625531: { customer: { sedan: rule({ baseFare: 120 }) } } } });
  const target = { pin: '625531', zoneId: L.zoneOfPin(geo, '625531').id };
  const pick = (brandFares, t = target) => { const r = L.resolveRule(brandFares, 'nesam', 'customer', 'sedan', t); return r && [r.scope, r.brand, r.value.baseFare]; };
  assert.deepEqual(pick({ common }), ['area', 'common', 120]);
  assert.deepEqual(pick({ common }, { pin: '625534', zoneId: 'z1' }), ['zone', 'common', 110]);
  assert.deepEqual(pick({ common }, { pin: '625601' }), ['district', 'common', 100]);
  const nesam = { district: { customer: { sedan: rule({ baseFare: 130 }) } }, zones: {}, areas: {} };
  assert.deepEqual(pick({ common, nesam }), ['district', 'nesam', 130]);
  assert.equal(pick({ common: L.emptyFares() }), null);
  assert.deepEqual(L.resolveCoverage({ common: fares({ coverage: { local: false } }) }, 'nesam'), { local: false, outstation: true });
  assert.deepEqual(L.resolveCoverage({ common: fares({ coverage: { local: false } }), nesam: fares({ coverage: { local: true } }) }, 'nesam'), { local: true, outstation: true });
});

test('a village rate wins over its pincode, and is found from the address', () => {
  assert.equal(L.areaKeyOf('625534', 'Koduvilarpatty'), '625534~koduvilarpatti');
  assert.equal(L.areaSlug('Veerapandi (Theni)'), 'veerapandi');
  assert.ok(L.isAreaKey('625534~koduvilarpatti') && L.isAreaKey('625534'));
  assert.ok(!L.isAreaKey('625534~') && !L.isAreaKey('6255~x'));
  assert.deepEqual(L.areaNamesOf(['Bus stand', 'Allinagaram, Theni, Tamil Nadu 625531'], 'Theni'), ['busstand', 'allinagaram', 'tamilnadu']);
  assert.equal(L.areaNamesOf(['Theni', 'Theni, Tamil Nadu 625531'], 'Theni')[0], 'theni');
  const common = fares({ areas: { '625534~koduvilarpatti': { customer: { sedan: rule({ baseFare: 140 }) } }, 625534: { customer: { sedan: rule({ baseFare: 120 }) } } } });
  const base = (areaNames) => L.resolveRule({ common }, 'nesam', 'customer', 'sedan', { pin: '625534', areaNames }).value.baseFare;
  assert.equal(base(['koduvilarpatti', 'theni']), 140);
  assert.equal(base(['veerapandi']), 120);
  assert.equal(base(undefined), 120);
  assert.deepEqual(Object.keys(L.parseFares(common).areas).sort(), ['625534', '625534~koduvilarpatti']);
  const village = priceBooking(ride({ pickup: place('Koduvilarpatti', { pincode: '625534' }), localFare: context({ pin: '625534', areaNames: ['koduvilarpatti'], fares: { common: fares({ areas: { '625534~koduvilarpatti': { customer: { sedan: rule({ baseFare: 140 }) }, partner: { sedan: partnerRule() } } } }) } }) }));
  assert.equal(village.fare.baseFare, 140);
  assert.equal(village.pricing.localFare.source, 'area');
});

test('half-filled rates are refused and empty ones inherit', () => {
  assert.equal(L.ruleProblem(L.emptyRule()), '');
  assert.match(L.ruleProblem({ ...L.emptyRule(), baseFare: 100 }), /beyond the included km/);
  assert.match(L.ruleProblem({ ...L.emptyRule(), extraPerKm: 10 }), /minimum fare or a base fare/);
  assert.match(L.rowProblem({ ...L.emptyRow(), customerFare: 900 }), /partner payout/);
  assert.deepEqual(L.parseLevel({ customer: { sedan: L.emptyRule() }, rental: { sedan: { 4: L.emptyRow() } } }), {});
});

test('peak: chosen weekdays and window, one rule, capped', () => {
  const s = settings((x) => peakOn(x));
  assert.equal(L.matchPeak(s, 'local', 'Wed', 7).id, 'morning_rush');
  assert.equal(L.matchPeak(s, 'local', 'Wed', 10), null);
  assert.equal(L.matchPeak(s, 'local', 'Sun', 8), null);
  assert.equal(L.matchPeak(settings(), 'local', 'Wed', 8), null);
  assert.equal(L.peakAmount(s.peak.rules[0], 240), 24);
  assert.equal(L.peakAmount(s.peak.rules[0], 2000), 50);
  assert.equal(L.peakAmount({ ...s.peak.rules[0], chargeMode: 'fixed', value: 30 }, 240), 30);
  assert.deepEqual(L.istParts(Date.parse('2026-11-25T08:00:00+05:30')), { weekday: 'Wed', hour: 8 });
  assert.deepEqual(L.istParts(Date.parse('2026-11-25T00:30:00+05:30')), { weekday: 'Wed', hour: 0 });
});

test('settings are validated', () => {
  assert.equal(L.settingsProblem(settings()), '');
  assert.match(L.settingsProblem(settings((s) => peakOn(s, { maxCap: 0 }))), /max cap/);
  assert.match(L.settingsProblem(settings((s) => { peakOn(s); Object.assign(s.peak.rules[1], { active: true, startHour: 9, endHour: 12, value: 5, maxCap: 20 }); })), /overlap/);
  assert.match(L.settingsProblem(settings((s) => { s.peak.rules[0].endHour = 6; })), /after the start/);
  assert.match(L.settingsProblem(settings((s) => { s.additional.airportEnabled = true; })), /airport/i);
  assert.match(L.settingsProblem(settings((s) => { s.additional.autoToll = true; s.additional.tollSource = 'route_api'; })), /fallback/);
});

test('route tolls: mapped corridor either way, live route with a fallback, or at actuals', () => {
  const s = settings((x) => { Object.assign(x.additional, { autoToll: true, tollAmount: 60, corridors: [{ id: 'c1', fromPin: '625531', toPin: '625534', name: 'Plaza', amount: 85 }, { id: 'c2', fromPin: '625531', toPin: '625601', name: '', amount: 0 }] }); });
  assert.equal(L.autoTollAmount(s, '625534', '625531', null), 85);
  assert.equal(L.autoTollAmount(s, '625531', '625601', null), 60);
  assert.equal(L.autoTollAmount(s, '625531', '625602', null), 0);
  s.additional.tollSource = 'route_api';
  assert.equal(L.autoTollAmount(s, 'a', 'b', { hasToll: true, price: 95 }), 95);
  assert.equal(L.autoTollAmount(s, 'a', 'b', { hasToll: true, price: null }), 60);
  assert.equal(L.autoTollAmount(s, 'a', 'b', { hasToll: false, price: null }), 0);
  assert.equal(L.autoTollAmount(s, 'a', 'b', null), 0);
  s.additional.tollSource = 'at_actuals';
  assert.equal(L.autoTollAmount(s, '625531', '625534', null), 0);
});

test('a district Pickup & Drop ride is priced with GST on top', () => {
  const r = priceBooking(ride());
  assert.equal(r.pricing.model, 'local_pickup_drop');
  assert.equal(r.fare.subtotal, 240);
  assert.equal(r.fare.gst, 12);
  assert.equal(r.fare.total, 252);
  assert.equal(r.outstation, false);
  assert.equal(r.pricing.partner.basePaise, 18500); // 80 + 7 × 15
  assert.equal(r.pricing.localFare.source, 'district');
  assert.equal(r.breakup.lines.find((l) => l.key === 'waiting').detail, '₹2 per minute after 5 free minutes');
  assertAddsUp(r);
  assert.equal(priceBooking(ride({ route: { distanceKm: 2, durationMin: 8 } })).fare.total, 157.5);
});

test('peak and night apply to the ride fare only; toll and airport entry are added after', () => {
  const s = settings((x) => { peakOn(x, { startHour: 0, endHour: 24 }); x.night.percent = 20; Object.assign(x.additional, { airportEnabled: true, airportFee: 40 }); });
  const r = priceBooking(ride({ pickupAt: at('23:00'), pickup: place('Airport', { type: 'airport' }), localFare: context({ settings: s, toll: 85 }), nightAllowance: { enabled: true, amount: 300, version: 1 } }));
  assert.equal(r.fare.peakCharge, 24);
  assert.equal(r.fare.nightCharge, 48); // 20% of 240, and the common ₹300 is not added on top
  assert.equal(r.fare.routeToll, 85);
  assert.equal(r.fare.airportEntry, 40);
  assert.equal(r.fare.subtotal, 437);
  assert.equal(r.fare.total, 458.85);
  assert.equal(r.pricing.partner.basePaise, 18500 + 12500);
  assert.equal(r.pricing.nightAllowance, undefined);
  assertAddsUp(r);
});

test('with 0% local night the common night allowance still applies', () => {
  const r = priceBooking(ride({ pickupAt: at('23:30'), nightAllowance: { enabled: true, amount: 100, version: 1 } }));
  assert.equal(r.fare.nightCharge, 100);
  assert.equal(r.fare.total, 357);
});

test('GST included: the total is exactly the entered amounts', () => {
  const s = settings((x) => { x.gst.mode = 'included'; Object.assign(x.additional, { airportEnabled: true, airportFee: 40 }); });
  const r = priceBooking(ride({ drop: place('Airport', { type: 'airport' }), localFare: context({ settings: s, toll: 85 }) }));
  assert.equal(r.fare.total, 365);
  assert.equal(r.pricing.gstInFare, true);
  assertAddsUp(r);
});

test('platform fee still applies to district fares', () => {
  const services = Object.fromEntries(['outstation', 'local', 'rental', 'airport', 'multicity'].map((k) => [k, { enabled: true, percent: 10, min: 0, cap: 0 }]));
  const r = priceBooking(ride({ platformFee: { version: 1, services } }));
  assert.equal(r.pricing.platformFee.service, 'local');
  assert.equal(r.fare.total, 277.2);
  assertAddsUp(r);
  assert.equal(priceBooking(rental({ platformFee: { version: 1, services } })).pricing.platformFee.service, 'rental');
});

test('hourly rental: the district package, peak on the package, no night percentage', () => {
  const s = settings((x) => { peakOn(x, { startHour: 0, endHour: 24 }); x.night.percent = 20; });
  const r = priceBooking(rental({ localFare: context({ settings: s }), pickupAt: at('23:30') }));
  assert.equal(r.pricing.model, 'rental_package');
  assert.equal(r.fare.baseFare, 900);
  assert.equal(r.fare.peakCharge, 50);
  assert.equal(r.fare.nightCharge, 0);
  assert.equal(r.fare.total, 997.5);
  assert.equal(r.pricing.rentalHours, 4);
  assert.equal(r.pricing.partner.basePaise, 70000);
  assertAddsUp(r);
  // No hours chosen: the shortest package set here.
  assert.equal(priceBooking(rental({ rentalHours: null, localFare: context() })).pricing.rentalHours, 4);
  assert.throws(() => priceBooking(rental({ rentalHours: 6 })), /6-hour rental package is not configured/);
});

test('without a district rate the trip keeps its earlier pricing', () => {
  const plain = priceBooking(ride({ localFare: null }));
  assert.equal(plain.pricing.localFare, undefined);
  assert.equal(plain.pricing.model, 'one_way_standard');
  // A vehicle with no district rate, a drop outside the district, or no partner rate: also unchanged.
  for (const patch of [{ category: category('Innova Crysta', 7) }, { localFare: context({ sameDistrict: false }) }, { localFare: context({ fares: { common: { district: { customer: { sedan: rule() } }, zones: {}, areas: {} } } }) }]) {
    assert.equal(priceBooking(ride(patch)).pricing.localFare, undefined);
  }
  assert.equal(priceBooking(ride({ route: { distanceKm: 160, durationMin: 200 } })).pricing.localFare, undefined);
});

test('coverage switched off refuses that kind of trip from the district', () => {
  const off = (coverage) => context({ fares: { common: fares({ coverage }) } });
  assert.throws(() => priceBooking(ride({ localFare: off({ local: false }) })), /Local trips are not available from Theni/);
  assert.throws(() => priceBooking(rental({ localFare: off({ local: false }) })), /Local trips are not available/);
  assert.throws(() => priceBooking(ride({ route: { distanceKm: 160, durationMin: 200 }, localFare: off({ outstation: false }) })), /Outstation trips are not available/);
  assert.equal(priceBooking(ride({ localFare: off({ outstation: false }) })).fare.total, 252);
});

test('the partner rate never reaches the customer-readable snapshot', () => {
  const r = priceBooking(ride());
  const { pub, priv } = splitPricing(r.pricing);
  assert.equal(pub.partner, null);
  assert.equal(pub.extraCharges.partner, undefined);
  assert.doesNotMatch(JSON.stringify(pub), /"extraPerKm":15/);
  assert.equal(priv.partner.localRule.extraPerKm, 15);
});

test('trip end: extra km beyond the quote, and a shorter trip never costs less', () => {
  const r = priceBooking(ride());
  const same = T.finalizeFare({ pricing: r.pricing, totalKm: 10, endMs: Date.now() });
  assert.equal(same.fare.total, 252);
  assert.equal(same.partnerPaise, 18500);
  assert.equal(T.finalizeFare({ pricing: r.pricing, totalKm: 6, endMs: Date.now() }).fare.total, 252);
  const longer = T.finalizeFare({ pricing: r.pricing, totalKm: 15, endMs: Date.now() });
  assert.equal(longer.fare.subtotal, 340);
  assert.equal(longer.fare.total, 357);
  assert.equal(longer.partnerPaise, 26000); // 80 + 12 × 15
  assert.equal(longer.fare.baseFare + longer.fare.distanceFare + longer.fare.minimumFareAdjustment, 340);
  // Quoted on the minimum fare: extra distance first uses up what the minimum already covered.
  const short = priceBooking(ride({ route: { distanceKm: 2, durationMin: 8 } }));
  assert.equal(T.finalizeFare({ pricing: short.pricing, totalKm: 5, endMs: Date.now() }).fare.subtotal, 150);
  assert.equal(T.finalizeFare({ pricing: short.pricing, totalKm: 8, endMs: Date.now() }).fare.subtotal, 200);
});

test('trip end keeps peak, night, toll and airport entry, in both GST modes', () => {
  for (const mode of ['excluded', 'included']) {
    const s = settings((x) => { x.gst.mode = mode; peakOn(x, { startHour: 0, endHour: 24 }); x.night.percent = 20; Object.assign(x.additional, { airportEnabled: true, airportFee: 40 }); });
    const r = priceBooking(ride({ pickupAt: at('23:00'), pickup: place('Airport', { type: 'airport' }), localFare: context({ settings: s, toll: 85 }) }));
    const f = T.finalizeFare({ pricing: r.pricing, totalKm: 10, endMs: Date.now() });
    assert.ok(Math.abs(f.fare.total - r.fare.total) < 0.02, `${mode}: ${f.fare.total} vs ${r.fare.total}`);
    assert.equal(f.partnerPaise, r.pricing.partner.basePaise);
    const longer = T.finalizeFare({ pricing: r.pricing, totalKm: 15, endMs: Date.now() });
    const expected = mode === 'included' ? r.fare.total + 100 : r.fare.total + 105;
    assert.ok(Math.abs(longer.fare.total - expected) < 0.03, `${mode}: ${longer.fare.total} vs ${expected}`);
  }
});

test('trip end of a rental adds only the extra km; the partner keeps the package payout', () => {
  const r = priceBooking(rental());
  const f = T.finalizeFare({ pricing: r.pricing, totalKm: 50, endMs: Date.now() });
  assert.equal(f.fare.subtotal, 1040);
  assert.equal(f.fare.total, 1092);
  assert.equal(f.partnerPaise, 70000);
});

test('waiting is billed per minute after each side\'s free minutes, less what the minimum fare covers', () => {
  const r = priceBooking(ride());
  const usage = { stops: [{ stopId: 'pickup', waitedMinutes: 20 }], hill: false, carrier: false };
  const x = r.pricing.extraCharges;
  const calc = computeExtraCharges(x, x.partner, usage, 0.05, r.pricing.waitingPerHourPaise, localWaitingCredit(r.pricing, 10));
  assert.deepEqual(calc.blocked, []);
  assert.equal(calc.customer.waitingPaise, 3000); // 15 min × ₹2
  assert.equal(calc.customerTotalPaise, 3150);
  assert.equal(calc.partner.waitingPaise, 1000); // 10 min × ₹1
  const floor = priceBooking(ride({ route: { distanceKm: 2, durationMin: 8 } }));
  const y = floor.pricing.extraCharges;
  const covered = computeExtraCharges(y, y.partner, usage, 0.05, floor.pricing.waitingPerHourPaise, localWaitingCredit(floor.pricing, 2));
  assert.equal(covered.customer.waitingPaise, 0);
});

test('driver receipts: parking and unmapped tolls only, never the toll already in the fare', () => {
  const receipts = [{ name: 'Toll plaza', amount: 120 }, { name: 'Parking', amount: 30 }];
  assert.equal(L.billableReceipts(receipts, { tollsAtActuals: true, parkingAtActuals: true, prepaidToll: 85 }), 65);
  assert.equal(L.billableReceipts(receipts, { tollsAtActuals: true, parkingAtActuals: false, prepaidToll: 0 }), 120);
  assert.equal(L.billableReceipts(receipts, { tollsAtActuals: false, parkingAtActuals: true, prepaidToll: 85 }), 30);
  const office = [{ name: 'Toll', amount: 85 }, { name: 'Parking / entry', amount: 100 }, { name: 'State permit / extra bata', amount: 200 }];
  assert.equal(L.billableReceipts(office, { tollsAtActuals: true, parkingAtActuals: true, prepaidToll: 85, prepaidEntry: 40 }), 260);
  assert.equal(L.billableReceipts(office, { tollsAtActuals: false, parkingAtActuals: false, prepaidToll: 85, prepaidEntry: 40 }), 200);
});

test('a partner price change scales the partner rate, never the toll paid back', () => {
  const r = priceBooking(ride({ localFare: context({ toll: 85 }) }));
  const raised = adjustPartner(r.pricing, { partner: { direction: 'increase', percent: 10 } });
  assert.equal(raised.partner.basePaise, 20350 + 8500); // (80 + 7 × 15) + 10%, plus the toll as it is
  assert.equal(T.finalizeFare({ pricing: raised, totalKm: 15, endMs: Date.now() }).partnerPaise, 28600 + 8500);
});

test('every mapped toll route needs both areas', () => {
  const s = settings((x) => { x.additional.corridors = [{ id: 'c1', fromPin: '625531', toPin: '', name: '', amount: 5 }]; });
  assert.match(L.settingsProblem(s), /both areas/);
});

test('a coupon discount and a price change apply to the ride, not to the pass-through charges', () => {
  const r = priceBooking(ride({ discount: 40, localFare: context({ toll: 85 }) }));
  assert.equal(r.fare.discount, 40);
  assert.equal(r.fare.taxableAmount, 285);
  assert.equal(r.fare.total, 299.25);
  const up = priceBooking(ride({ adjustment: { id: 'a', name: 'Festival', direction: 'increase', percent: 10 }, localFare: context({ toll: 85 }) }));
  assert.equal(up.fare.taxableAmount, 349);
});
