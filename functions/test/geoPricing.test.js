// Local Pickup & Drop / Hourly Rental location-scoped rates, scheduled peak rules and zone booking rules.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const T = require('../lib/domain/tariff');
const G = require('../lib/domain/geoFares');
const S = require('../lib/domain/geoScope');
const P = require('../lib/domain/peakRules');
const { evaluateRules } = require('../lib/serviceRules');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');

const category = { ...mapCategory('sedan', { name: 'Sedan', seatingCapacity: 4 }), tariffClass: 'sedan' };
const tariff = (extra = {}) => T.parseTariffConfig({ ...CONFIRMED_TARIFF_V2, version: 7, enabled: true, ...extra });
const place = (name, pincode) => ({ id: 'pin', name, address: `${name}, Tamil Nadu ${pincode}`, pincode, lat: 10, lng: 77 });
const THENI = S.scopeKey({ level: 'district', state: '33', district: 'Theni' });
const party = (o = {}) => ({ baseFare: 150, includedKm: 4, extraKmRate: 18, minimumFare: 200, freeWaitingMin: 5, waitingPerMin: 2, ...o });
const doc = (brand, service, key, classes, version = 3) => [G.geoDocId(brand, service, key), { brand, service, scopeKey: key, version, classes }];
const ctx = (service, docs, extra = {}) => {
  const p = { state: '33', district: 'Theni', zoneId: extra.zoneId ?? null, areaIds: extra.areaIds ?? [], airportIds: extra.airportIds ?? [], pincode: '625531' };
  const keys = S.fareKeysOf(p);
  return { service, brand: extra.brand ?? 'nesam', pickup: p, drop: { ...p, airportIds: extra.dropAirports ?? [] }, keys, peakKeys: S.peakKeysOf(p), chain: G.geoChain(extra.brand ?? 'nesam', service, keys), docs: new Map(docs), localEligible: extra.localEligible ?? true, peakRules: extra.peakRules ?? [] };
};
/** The ride fare as configured (these fares include GST: the snapshot keeps the amount before tax). */
const gross = (q) => q.pricing.gstInclusiveBase?.packagePaise ?? q.pricing.packagePaise;
const local = (geo, km = 10, patch = {}) => priceBooking({ category, route: { distanceKm: km, durationMin: 25 }, pickup: place('Theni', '625531'), drop: place('Periyakulam', '625601'), pickupAt: new Date('2026-11-24T10:00:00+05:30'), tripEndAt: null, adjustment: null, brand: 'nesam', tripType: 'One Way', tariff: tariff(), geo, ...patch });

test('scope keys: area → zone → district for fares, then state and everywhere for peak rules', () => {
  const p = { state: '33', district: 'Theni', zoneId: 'z1', areaIds: ['a2', 'a1'] };
  assert.deepEqual(S.fareKeysOf(p), ['a_a2', 'a_a1', 'z_z1', 'd_33_theni']);
  assert.deepEqual(S.peakKeysOf(p).slice(-2), ['s_33', 'all']);
  assert.deepEqual(S.districtOfPin('625531'), { state: '33', district: 'Theni' });
  assert.equal(S.districtOfPin('12345'), null);
});

test('Local formula: max(minimum, base + extra km × rate); included km are never charged twice', () => {
  const p = Object.fromEntries(Object.entries(party()).map(([k, v]) => [k, { value: v, source: 'x' }]));
  const short = G.localRideFarePaise(p, 3);
  assert.equal(short.extraKm, 0);
  assert.equal(short.totalPaise, 20000, 'minimum fare applies to a short trip');
  assert.equal(short.minimumTopUpPaise, 5000);
  const long = G.localRideFarePaise(p, 10);
  assert.equal(long.extraKm, 6);
  assert.equal(long.totalPaise, 15000 + 6 * 1800);
  assert.equal(G.localRideFarePaise(p, 10, 12).waitingPaise, (12 - 5) * 200, 'waiting only after the free minutes');
});

test('district default prices a local trip; zone and area overrides win field by field; partner uses its own values', () => {
  const docs = [
    doc('common', 'local', THENI, { sedan: { customer: party(), partner: party({ baseFare: 120, extraKmRate: 14, minimumFare: 160 }) } }),
    doc('common', 'local', 'z_zone1', { sedan: { customer: { extraKmRate: 20 } } }, 5),
    doc('nesam', 'local', 'a_area1', { sedan: { customer: { baseFare: 0 } } }, 9),
  ];
  const q = local(ctx('local', docs, { zoneId: 'zone1', areaIds: ['area1'] }), 10);
  assert.equal(q.pricing.model, 'local_pickup_drop');
  // base 0 (brand area override, a saved zero), extra 6 km × 20 (zone) = 120 → minimum 200 applies.
  assert.equal(gross(q), 20000);
  assert.equal(q.pricing.geoFare.sources['customer.baseFare'], 'nesam__local__a_area1');
  assert.equal(q.pricing.geoFare.sources['customer.extraKmRate'], 'common__local__z_zone1');
  assert.equal(q.pricing.geoFare.sources['customer.minimumFare'], `common__local__${THENI}`);
  assert.equal(q.pricing.partner.basePaise, 12000 + 6 * 1400, 'partner payout from its own rates, not a share of the fare');
  assert.deepEqual(q.pricing.geoFare.versions, { 'nesam__local__a_area1': 9, 'common__local__z_zone1': 5, [`common__local__${THENI}`]: 3 });
});

test('incomplete or other-district rates never price a local trip, and nothing falls back to another district', () => {
  const partial = [doc('common', 'local', THENI, { sedan: { customer: party() } })];
  assert.notEqual(local(ctx('local', partial)).pricing.model, 'local_pickup_drop', 'missing partner values: not priced as Local');
  const madurai = [doc('common', 'local', S.scopeKey({ level: 'district', state: '33', district: 'Madurai' }), { sedan: { customer: party(), partner: party() } })];
  assert.notEqual(local(ctx('local', madurai)).pricing.model, 'local_pickup_drop');
  const full = [doc('common', 'local', THENI, { sedan: { customer: party(), partner: party() } })];
  assert.notEqual(local(ctx('local', full, { localEligible: false })).pricing.model, 'local_pickup_drop', 'drop in another district');
  assert.equal(local(ctx('local', full)).pricing.model, 'local_pickup_drop');
});

test('Local ignores fuel: the same fare with or without CNG', () => {
  const full = [doc('common', 'local', THENI, { sedan: { customer: party(), partner: party() } })];
  assert.equal(local(ctx('local', full), 10, { fuel: 'cng' }).fare.total, local(ctx('local', full), 10).fare.total);
  assert.equal(local(ctx('local', full), 10, { fuel: 'cng' }).pricing.fuelType, undefined);
});

const rentalPkg = (o = {}) => ({ customerFare: 1200, partnerPayout: 900, includedKm: 40, extraKmRate: 16, extraHourRate: 150, ...o });
const rental = (geo, hours = 4, extra = {}) => priceBooking({ category, route: { distanceKm: 5, durationMin: 20 }, pickup: place('Theni', '625531'), drop: place('Theni', '625531'), pickupAt: new Date('2026-11-24T10:00:00+05:30'), tripEndAt: null, adjustment: null, brand: 'nesam', tripType: 'Local Rental', rentalHours: hours, tariff: tariff(extra), geo });

test('Rental: location package with inheritance; the existing package stays the broadest default; never another package', () => {
  const existing = { rentalPackages: { sedan: { packages: { 4: { customerFare: 1000, partnerPayout: 700, includedKm: 40, extraKmRate: 15, extraHourRate: 120, gstMode: 'excluded', enabled: true } } } } };
  // Nothing location-scoped: the existing package, unchanged.
  assert.equal(rental(ctx('rental', []), 4, existing).pricing.packagePaise, 100000);
  // District changes only the customer fare: everything else comes from the existing package.
  const d = [doc('common', 'rental', THENI, { sedan: { packages: { 4: { customerFare: 1300 } } } })];
  const q = rental(ctx('rental', d), 4, existing);
  assert.equal(q.pricing.packagePaise, 130000);
  assert.equal(q.pricing.extraHourRatePaise, 12000);
  assert.equal(q.pricing.partner.basePaise, 70000);
  assert.equal(q.pricing.geoFare.sources.customerFare, `common__rental__${THENI}`);
  // A package only partly saved for a place with no existing package is refused, not substituted.
  const half = [doc('common', 'rental', THENI, { sedan: { gstMode: 'excluded', packages: { 6: { customerFare: 1500 } } } })];
  assert.throws(() => rental(ctx('rental', half), 6), /6-hour rental package is not complete/);
  const whole = [doc('common', 'rental', THENI, { sedan: { gstMode: 'included', packages: { 6: rentalPkg() } } })];
  const inc = rental(ctx('rental', whole), 6);
  assert.equal(inc.fare.total, 1200, 'GST included: the customer pays exactly the package');
  assert.equal(inc.pricing.gstInclusiveBase?.extraKmRatePaise ?? inc.pricing.extraKmRatePaise, 1600);
});

const peak = (o = {}) => ({ id: 'p1', brand: '', service: 'local', scopeKey: THENI, enabled: true, days: [5], slots: [{ start: '22:00', end: '02:00' }], type: 'percent', value: 10, priority: 1, name: 'Late', version: 2, ...o });

test('peak: overnight window keeps the evening weekday (Fri 22:00–02:00 covers Saturday 01:30, not Saturday 22:30)', () => {
  const r = peak();
  assert.equal(P.windowStart(r, Date.parse('2026-11-27T23:00:00+05:30')), '2026-11-27');
  assert.equal(P.windowStart(r, Date.parse('2026-11-28T01:30:00+05:30')), '2026-11-27');
  assert.equal(P.windowStart(r, Date.parse('2026-11-28T02:00:00+05:30')), null, 'the end minute is not included');
  assert.equal(P.windowStart(r, Date.parse('2026-11-28T22:30:00+05:30')), null);
  assert.equal(P.windowStart({ ...r, until: '2026-11-26' }, Date.parse('2026-11-28T01:30:00+05:30')), null, 'dates follow the window start');
  // IST, not UTC: 2026-11-27T17:00Z is 22:30 IST on Friday.
  assert.equal(P.windowStart(r, Date.parse('2026-11-27T17:00:00Z')), '2026-11-27');
});

test('peak: one rule per quote, ambiguity refused, cap applied, overlaps found at save time', () => {
  const keys = S.peakKeysOf({ state: '33', district: 'Theni', zoneId: 'z1', areaIds: [] });
  const at = Date.parse('2026-11-27T23:00:00+05:30');
  const q = { brand: 'nesam', service: 'local', keys, pickupMs: at };
  assert.equal(P.selectPeakRule([peak(), peak({ id: 'p2', scopeKey: 'z_z1' })], q).rule.id, 'p2', 'the zone rule beats the district rule');
  assert.equal(P.selectPeakRule([peak(), peak({ id: 'p3', brand: 'nesam', scopeKey: 's_33' })], q).rule.id, 'p3', "the brand's own rule beats a shared one");
  assert.equal(P.selectPeakRule([peak(), peak({ id: 'p4', priority: 2 })], q).rule.id, 'p4');
  assert.equal(P.selectPeakRule([peak(), peak({ id: 'p5' })], q).ambiguous.length, 2);
  assert.equal(P.peakAmountPaise({ type: 'percent', value: 10, cap: 25 }, 50000), 2500);
  assert.equal(P.peakAmountPaise({ type: 'fixed', value: 40 }, 50000), 4000);
  assert.equal(P.overlappingRules(peak({ id: 'new', slots: [{ start: '01:00', end: '03:00' }], days: [6] }), [peak()]).length, 1, 'Sat 01:00 overlaps the Friday overnight window');
  assert.equal(P.overlappingRules(peak({ id: 'new', priority: 2 }), [peak()]).length, 0);
  assert.equal(P.overlappingRules(peak({ id: 'new', from: '2027-01-01' }), [peak({ until: '2026-12-31' })]).length, 0);
  assert.throws(() => P.validatePeakRule({ ...peak(), slots: [{ start: '10:00', end: '10:00' }] }), /different time/);
});

test('peak is charged once on the ride fare only, shown as its own line, and survives the final fare', () => {
  const full = [doc('common', 'local', THENI, { sedan: { customer: party(), partner: party() } })];
  const geo = ctx('local', full, { peakRules: [peak({ days: [2], slots: [{ start: '09:00', end: '11:00' }] })] });
  const base = local(ctx('local', full), 10);
  const q = local(geo, 10);
  const ride = base.pricing.packagePaise / 100;
  assert.equal(q.pricing.peakCharge.amount, Math.round(ride * 10) / 100, '10% of the eligible ride fare');
  assert.equal(q.fare.peakCharge, q.pricing.peakCharge.amount);
  assert.ok(q.breakup.lines.some((l) => l.key === 'peakCharge'));
  assert.equal(q.fare.taxableAmount, Math.round((base.fare.taxableAmount + q.pricing.peakCharge.amount) * 100) / 100);
  const fin = T.finalizeFare({ pricing: q.pricing, totalKm: 10, endMs: Date.parse('2026-11-24T10:40:00+05:30') });
  assert.equal(fin.fare.peakCharge, q.pricing.peakCharge.amount, 'a confirmed fare keeps its peak charge');
  // Outside the window: no charge.
  assert.equal(local(geo, 10, { pickupAt: new Date('2026-11-24T12:00:00+05:30') }).pricing.peakCharge, undefined);
});

test('airport entry: only a chosen Airport record with a saved fee, once, outside GST and peak', () => {
  const full = [
    doc('common', 'local', THENI, { sedan: { customer: party(), partner: party() } }),
    [G.geoDocId('common', 'local', 'a_mdu'), { brand: 'common', service: 'local', scopeKey: 'a_mdu', version: 1, classes: {}, airportEntry: { customerFee: 50, partnerFee: 50, appliesTo: 'both' } }],
  ];
  const plain = local(ctx('local', full), 10);
  const at = local(ctx('local', full, { airportIds: ['mdu'], dropAirports: ['mdu'] }), 10);
  assert.equal(at.fare.airportEntry, 50);
  assert.equal(at.fare.total, Math.round((plain.fare.total + 50) * 100) / 100);
  assert.equal(at.fare.gst, plain.fare.gst);
  assert.equal(at.breakup.lines.filter((l) => l.key === 'airportEntry').length, 1);
  assert.equal(local(ctx('local', full, { airportIds: ['other'] }), 10).fare.airportEntry, undefined);
});

test('a Service Zone booking rule matches by the zone pincodes and beats the district rule', () => {
  const rule = (o) => ({ id: o.id, kind: 'availability', status: 'Enabled', priority: 1, schedule: { mode: 'Always' }, scope: { state: '33', city: 'Theni', area: '', side: 'Pickup or drop', ...o.scope }, availability: o.availability });
  const rules = [rule({ id: 'd', availability: 'Available', scope: {} }), rule({ id: 'z', availability: 'Paused', scope: { zoneId: 'z1', zonePins: ['625531'] } })];
  const at = new Date('2026-11-24T10:00:00+05:30');
  const inZone = evaluateRules(rules, { ...place('Theni', '625531'), state: 'Tamil Nadu' }, { ...place('Theni', '625531'), state: 'Tamil Nadu' }, at, 'Local');
  assert.equal(inZone.availability, 'Paused');
  const outside = evaluateRules(rules, { ...place('Periyakulam', '625601'), state: 'Tamil Nadu' }, { ...place('Periyakulam', '625601'), state: 'Tamil Nadu' }, at, 'Local');
  assert.equal(outside.availability, 'Available');
});
