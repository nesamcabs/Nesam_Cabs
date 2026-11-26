// District local fares page: the Test quote must show what the booking server charges, and editing a tab must write the right
// level. Run after building the functions: npm --prefix functions run build, then npm --prefix admin run test:local-fares.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const root = path.resolve(__dirname, '../admin/src');
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (!id.startsWith('.')) throw Error('Unexpected dependency: ' + id);
    return load(path.resolve(path.dirname(file), id) + '.ts');
  }, module, module.exports);
  return module.exports;
}
const L = load('domain/localPricing.ts');
const Q = load('components/localFares/quotePreview.ts');
const M = load('components/localFares/model.ts');
const { priceBooking } = require('../functions/lib/quote');
const T = require('../functions/lib/domain/tariff');
const { mapCategory } = require('../functions/lib/domain/pricing');
const { computeExtraCharges } = require('../functions/lib/domain/extraCharges');
const { localWaitingCredit } = require('../functions/lib/domain/localCharges');
const { parsePlatformFee } = require('../functions/lib/domain/platformFee');
const { parseNightAllowance } = require('../functions/lib/domain/nightAllowance');
const { CONFIRMED_TARIFF_V2 } = require('../functions/test/support/confirmedTariff');

const rule = { minimumFare: 150, baseFare: 100, includedKm: 3, extraPerKm: 17.5, freeWaitMins: 5, waitPerMin: 1.5 };
const partner = { minimumFare: 120, baseFare: 80, includedKm: 3, extraPerKm: 13, freeWaitMins: 10, waitPerMin: 1 };
const row = { customerFare: 949, partnerPayout: 700, includedKm: 40, extraKmRate: 14, extraHourRate: 150 };
const fares = { common: { district: { customer: { sedan: rule }, partner: { sedan: partner }, rental: { sedan: { 4: row } } }, zones: {}, areas: {} } };
const geo = { zones: [], tamil: {} };
const category = mapCategory('sedan', { name: 'Sedan', seatingCapacity: 4 });
const tariff = T.parseTariffConfig({ ...CONFIRMED_TARIFF_V2, version: 1, enabled: true });
const spot = (name, airport) => ({ id: 'pin', name, address: `${name} 625531`, lat: 10, lng: 77.4, type: airport ? 'airport' : 'other', pincode: '625531' });
const feeRaw = (on) => ({ services: Object.fromEntries(['local', 'rental'].map((k) => [k, { enabled: on, percent: 5, min: 20, cap: 100 }])) });

test('the Test quote total equals the server total for every combination of the settings', () => {
  let compared = 0;
  for (const mode of ['excluded', 'included']) for (const percent of [0, 5, 12]) for (const peak of [false, true]) for (const nightPct of [0, 18])
  for (const commonOn of [false, true]) for (const feeOn of [false, true]) for (const hour of [4, 5, 8, 12, 22, 23]) for (const service of ['ride', 'rental'])
  for (const [km, extras] of service === 'ride' ? [[2, false], [11.3, true], [25.5, false]] : [[1, false]]) {
    const settings = L.defaultSettings();
    settings.gst = { percent, mode };
    settings.night.percent = nightPct;
    if (peak) { settings.peak.localEnabled = settings.peak.rentalEnabled = true; settings.peak.weekdays = [...L.WEEKDAYS]; Object.assign(settings.peak.rules[0], { startHour: 0, endHour: 24, active: true, value: 12, maxCap: 40 }); }
    Object.assign(settings.additional, { autoToll: true, tollAmount: 65, airportEnabled: true, airportFee: 45 });
    const pickupMs = Date.parse(`2026-11-25T${String(hour).padStart(2, '0')}:00:00+05:30`);
    const commonRaw = { enabled: commonOn, amount: 90, version: 1 };
    const shown = Q.testQuote({
      service, fares, brand: 'nesam', geo, settings, district: 'Theni', cls: 'sedan', vehicle: 'Sedan', pin: '625531', km, hours: 4, waitMins: 0, pickupMs,
      routeHasToll: extras, airport: extras, platform: Q.parsePlatformRules(feeRaw(feeOn)), night: Q.parseCommonNight(commonRaw),
    });
    const server = priceBooking({
      category, route: { distanceKm: km, durationMin: 20 }, tripType: service === 'ride' ? 'One Way' : 'Local Rental', rentalHours: service === 'ride' ? null : 4,
      pickup: spot('A', extras), drop: spot('B'), pickupAt: new Date(pickupMs), tripEndAt: null, tariff, adjustment: null, brand: 'nesam',
      platformFee: parsePlatformFee(feeRaw(feeOn)), nightAllowance: parseNightAllowance(commonRaw),
      localFare: { key: '33~theni', district: 'Theni', pin: '625531', brand: 'nesam', fares, settings, version: 1, sameDistrict: true, toll: extras && service === 'ride' ? 65 : 0 },
    });
    const label = JSON.stringify({ mode, percent, peak, nightPct, commonOn, feeOn, hour, service, km });
    assert.equal(shown.ok, true, label);
    assert.ok(Math.abs(shown.total - server.fare.total) <= 0.011, `${label}: shown ${shown.total}, server ${server.fare.total}`);
    assert.ok(Math.abs(shown.gst - server.fare.gst) <= 0.021, `${label}: GST shown ${shown.gst}, server ${server.fare.gst}`);
    compared++;
  }
  assert.ok(compared > 2000);
});

test('the Test quote waiting equals what is billed after the trip', () => {
  for (const mode of ['excluded', 'included']) for (const km of [2, 11.3]) for (const waitMins of [0, 4, 20, 90]) {
    const settings = L.defaultSettings();
    settings.gst = { percent: 5, mode };
    const base = { service: 'ride', fares, brand: 'nesam', geo, settings, district: 'Theni', cls: 'sedan', vehicle: 'Sedan', pin: '625531', km, hours: 4, pickupMs: Date.parse('2026-11-25T12:00:00+05:30'), routeHasToll: false, airport: false, platform: Q.parsePlatformRules(null), night: Q.parseCommonNight(null) };
    const waited = Q.testQuote({ ...base, waitMins }), none = Q.testQuote({ ...base, waitMins: 0 });
    const server = priceBooking({
      category, route: { distanceKm: km, durationMin: 20 }, tripType: 'One Way', pickup: spot('A'), drop: spot('B'), pickupAt: new Date(base.pickupMs), tripEndAt: null, tariff, adjustment: null, brand: 'nesam',
      localFare: { key: '33~theni', district: 'Theni', pin: '625531', brand: 'nesam', fares, settings, version: 1, sameDistrict: true, toll: 0 },
    });
    const x = server.pricing.extraCharges;
    const billed = computeExtraCharges(x, x.partner, { stops: [{ stopId: 'pickup', waitedMinutes: waitMins }], hill: false, carrier: false }, server.pricing.gstRate, undefined, localWaitingCredit(server.pricing, km));
    assert.ok(Math.abs((waited.total - none.total) - billed.customerTotalPaise / 100) <= 0.031, `${mode} ${km}km ${waitMins}min: ${waited.total - none.total} vs ${billed.customerTotalPaise / 100}`);
  }
});

test('the Test quote explains why a trip is not priced here', () => {
  const base = { service: 'ride', fares, brand: 'nesam', geo, settings: L.defaultSettings(), district: 'Theni', cls: 'sedan', vehicle: 'Sedan', pin: '625531', km: 8, hours: 4, waitMins: 0, pickupMs: Date.now(), routeHasToll: false, airport: false, platform: Q.parsePlatformRules(null), night: Q.parseCommonNight(null) };
  assert.match(Q.testQuote({ ...base, km: 0 }).message, /distance/);
  assert.match(Q.testQuote({ ...base, km: 41 }).message, /Outstation/);
  assert.match(Q.testQuote({ ...base, cls: 'suv' }).message, /older fares/);
  assert.match(Q.testQuote({ ...base, service: 'rental', hours: 7 }).message, /7-hour/);
  assert.match(Q.testQuote({ ...base, fares: { common: { ...fares.common, coverage: { local: false } } } }).message, /switched OFF/);
});

// ── Editing ─────────────────────────────────────────────────────────────────

const zoneGeo = { zones: [{ id: 'z1', name: 'One', pins: ['625531'] }, { id: 'z2', name: 'Two', pins: ['625534'] }], tamil: {} };
const ctx = (mine, brand = 'common', shared) => ({ brand, geo: zoneGeo, mine, all: brand === 'common' ? { common: mine } : { common: shared, [brand]: mine } });

test('typing in the district tab writes the district; clearing it all removes it', () => {
  let mine = L.emptyFares();
  const at = [{ scope: 'district' }];
  mine = M.editRule(ctx(mine), 'customer', 'sedan', at, 'minimumFare', 150);
  assert.equal(M.readRule(ctx(mine), 'customer', 'sedan', at).incomplete, true);
  assert.match(M.faresProblem(mine, { district: 'Theni', zone: String, vehicle: String }), /rate beyond/);
  mine = M.editRule(ctx(mine), 'customer', 'sedan', at, 'extraPerKm', 20);
  assert.equal(M.faresProblem(mine, { district: 'Theni', zone: String, vehicle: String }), '');
  assert.equal(M.sourceLabel(M.readRule(ctx(mine), 'customer', 'sedan', at), 'common'), 'District default');
  mine = M.editRule(ctx(mine), 'customer', 'sedan', at, 'minimumFare', 0);
  mine = M.editRule(ctx(mine), 'customer', 'sedan', at, 'extraPerKm', 0);
  assert.deepEqual(mine.district, {});
  assert.ok(M.sameData(mine, L.emptyFares()));
});

test('an override starts from the inherited rate and can be handed back', () => {
  let mine = structuredClone(fares.common);
  const area = [{ scope: 'area', id: '625531' }];
  assert.deepEqual(M.editedLevels('area', zoneGeo, '', ''), []);
  assert.deepEqual(M.editedLevels('area', zoneGeo, '', '625531~theni'), [{ scope: 'area', id: '625531~theni' }]);
  assert.equal(M.readRule(ctx(mine), 'customer', 'sedan', area).own, 'none');
  mine = M.editRule(ctx(mine), 'customer', 'sedan', area, 'baseFare', 130);
  assert.deepEqual(mine.areas['625531'].customer.sedan, { ...rule, baseFare: 130 });
  assert.equal(mine.district.customer.sedan.baseFare, 100);
  assert.equal(M.sourceLabel(M.readRule(ctx(mine), 'customer', 'sedan', area), 'common'), 'Area override');
  mine = M.clearRules(ctx(mine), 'sedan', area);
  assert.deepEqual(mine.areas, {});
});

test('a village starts from its pincode rate, and zones are suggested from the listed towns', () => {
  let mine = structuredClone(fares.common);
  mine.areas = { 625534: { customer: { sedan: { ...rule, baseFare: 120 } } } };
  const village = [{ scope: 'area', id: '625534~koduvilarpatti' }];
  assert.equal(M.readRule(ctx(mine), 'customer', 'sedan', village).value.baseFare, 120);
  mine = M.editRule(ctx(mine), 'customer', 'sedan', village, 'baseFare', 150);
  assert.equal(mine.areas['625534~koduvilarpatti'].customer.sedan.baseFare, 150);
  assert.equal(mine.areas['625534'].customer.sedan.baseFare, 120);
  assert.deepEqual(M.suggestedZones([['Bodinayakanur', ['625582', '625513']]]), [{ id: 's_bodinayakanur', name: 'Bodinayakanur Zone', pins: ['625513', '625582'] }]);
  const areas = require('../admin/src/domain/areas/33.json');
  assert.equal(areas.areas.Theni.length, 161);
  const theni = M.suggestedZones(areas.zones.Theni);
  assert.ok(theni.length >= 6);
  const pins = theni.flatMap((z) => z.pins);
  assert.equal(pins.length, new Set(pins).size);
  assert.deepEqual([...new Set(pins)].sort(), [...new Set(areas.areas.Theni.map((a) => a[0]))].sort());
});

test('several zones: differing values show as Mixed and typing keeps the other values of each', () => {
  let mine = structuredClone(fares.common);
  mine.zones = { z1: { customer: { sedan: { ...rule, baseFare: 111 } } } };
  const both = M.editedLevels('zone', zoneGeo, '', '');
  assert.deepEqual(both.map((l) => l.id), ['z1', 'z2']);
  const cell = M.readRule(ctx(mine), 'customer', 'sedan', both);
  assert.deepEqual(cell.mixed, ['baseFare']);
  assert.equal(cell.value.baseFare, 0);
  assert.equal(cell.own, 'some');
  assert.equal(M.sourceLabel(cell, 'common'), 'Mixed');
  mine = M.editRule(ctx(mine), 'customer', 'sedan', both, 'extraPerKm', 25);
  assert.deepEqual([mine.zones.z1.customer.sedan.baseFare, mine.zones.z2.customer.sedan.baseFare], [111, 100]);
  assert.deepEqual([mine.zones.z1.customer.sedan.extraPerKm, mine.zones.z2.customer.sedan.extraPerKm], [25, 25]);
});

test('a brand sees the shared rate marked, and its edit never changes the shared one', () => {
  const shared = structuredClone(fares.common);
  let mine = L.emptyFares();
  const at = [{ scope: 'district' }];
  assert.equal(M.sourceLabel(M.readRow(ctx(mine, 'nesam', shared), 'sedan', 4, at), 'nesam'), 'District default · shared');
  mine = M.editRow(ctx(mine, 'nesam', shared), 'sedan', 4, at, 'customerFare', 999);
  assert.deepEqual(mine.district.rental.sedan['4'], { ...row, customerFare: 999 });
  assert.equal(shared.district.rental.sedan['4'].customerFare, 949);
  assert.deepEqual(M.clearRow(ctx(mine, 'nesam', shared), 'sedan', 4, at).district, {});
});

test('a customer rate without a partner payout is pointed out', () => {
  const mine = { district: { customer: { sedan: rule } }, zones: {}, areas: {} };
  assert.deepEqual(M.unpairedRules(ctx(mine), [{ scope: 'district' }], ['sedan', 'suv']), ['sedan']);
  assert.deepEqual(M.unpairedRules(ctx(fares.common), [{ scope: 'district' }], ['sedan']), []);
});
