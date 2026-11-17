// Hill Station Allowance / Charge (Customer UX v8, section 08): detection from map positions, the separate fare line for One Way and
// Round Trip, the 5-hour / 8-hour restriction, partner payout, GST handling and the final fare.
// Run: npm run build && node --test test/hillStation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/domain/tariff');
const H = require('../lib/domain/hillStations');
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');

const IST = (s) => Date.parse(`${s}+05:30`);
const sedan = {
  customerRate: 14, customerBata: 500, partnerRate: 12.6, partnerBata: 400, minKmPerDay: 250,
  timeBased: { fiveFare: 2080, fiveKm: 100, fivePartner: 1870, eightFare: 2780, eightKm: 150, eightPartner: 2500, morningFare: 4500, morningKm: 250, morningPartner: 4050 },
};
const hillStation = { enabled: true, chargePer: 'trip', classes: { sedan: { oneWay: { customer: 500, partner: 400 }, roundTrip: { customer: 800, partner: 650 } } } };
const base = { ...T.CONFIRMED_TARIFF_V2, version: 8, enabled: true, roundTrip: { maxDays: 30, timeBased: { enabled: true }, classes: { sedan } }, roundTripExtras: { sedan: { extraKmRate: 14, waitingPerHour: 150 } } };
const cfg = T.parseTariffConfig({ ...base, hillStation });
const cfgNoHill = T.parseTariffConfig(base);

const category = mapCategory('sedan', { name: 'Sedan', status: 'Active', seatingCapacity: 4, fare: { baseFare: 70, baseKm: 2, perKmRate: 16, minimumFare: 100 } });
const place = (name, lat, lng, address) => ({ id: 'pin', name, address: address ?? name, lat, lng, type: 'other' });
const theni = place('Theni', 10.0104, 77.4768);
const madurai = place('Madurai', 9.9195, 78.1193);
const ooty = place('Ooty', 11.4102, 76.695, 'Ooty, Tamil Nadu');
const coonoor = place('Coonoor', 11.3531, 76.7959);
const coimbatore = place('Coimbatore', 11.0168, 76.9558);
const kodaikanal = place('Kodaikanal', 10.2381, 77.4892);

const price = (o = {}) => priceBooking({
  category, route: { distanceKm: o.km ?? 60, durationMin: o.min ?? 90 }, tripType: o.tripType ?? 'Round Trip', pickup: o.pickup ?? theni, drop: o.drop ?? ooty, stops: o.stops,
  pickupAt: new Date(IST(o.at ?? '2026-11-17T09:00:00')), tripEndAt: o.tripEndAt ?? null, tariff: o.tariff ?? cfg, adjustment: null,
  customerChannel: o.office ? undefined : true, tripDays: o.days ?? 1, timePackage: o.pkg,
});

test('detection by map position: every hill station of the guide is found at its centre; plain cities are not', () => {
  for (const s of H.HILL_STATIONS) {
    const found = H.detectHillStations([{ role: 'drop', name: 'Somewhere', lat: s.lat, lng: s.lng }]);
    assert.equal(found.length, 1, s.name);
    assert.equal(found[0].id, s.id);
  }
  assert.equal(H.HILL_STATIONS.length, 15);
  for (const city of [coimbatore, madurai, theni, place('Chennai', 13.0827, 80.2707), place('Trichy', 10.7905, 78.7047)]) {
    assert.deepEqual(H.detectHillStations([{ role: 'drop', ...city }]), [], city.name);
  }
});

test('detection by name: a place on the hill road is found by its address, a road that only carries the name is not', () => {
  // ~19 km from the Ooty centre: outside the radius, inside the wider ring, and it names Ooty.
  const avalanche = H.detectHillStations([{ role: 'stop', name: 'Avalanche Lake', address: 'Avalanche, Ooty, Tamil Nadu', lat: 11.28, lng: 76.58 }]);
  assert.equal(avalanche.length, 1);
  assert.equal(avalanche[0].via, 'name');
  const road = H.detectHillStations([{ role: 'drop', name: 'Ooty Road bus stop', address: 'Ooty Road, Mettupalayam, Coimbatore', lat: 11.0168, lng: 76.9558 }]);
  assert.deepEqual(road, []);
  const tamil = H.detectHillStations([{ role: 'drop', name: 'கொடைக்கானல் ஏரி', address: 'கொடைக்கானல்', lat: 10.2381, lng: 77.4892 }]);
  assert.equal(tamil[0].id, 'kodaikanal');
});

test('pickup, stops and drop are all checked; several places in one station count once; distinct stations stay in trip order', () => {
  const m = H.detectHillStations([
    { role: 'pickup', ...coimbatore }, { role: 'stop', ...coonoor }, { role: 'stop', ...ooty }, { role: 'drop', ...place('Coonoor Bus Stand', 11.3445, 76.7937) },
  ]);
  assert.deepEqual(H.distinctHillStations(m).map((s) => s.id), ['coonoor', 'ooty']);
  const fromHill = H.detectHillStations([{ role: 'pickup', ...ooty }, { role: 'drop', ...coimbatore }]);
  assert.equal(fromHill[0].role, 'pickup');
});

test('Round Trip to a hill station: the hill charge is its own line on top of the package (GST-inclusive entry: ₹4,000 + ₹800)', () => {
  const p = price({ pkg: 'same:full', km: 90, min: 120 });
  assert.equal(p.pricing.timeBased.packageId, 'same:full');
  assert.equal(p.fare.total, 4800);
  assert.equal(p.pricing.hillStation.slab, 'roundTrip');
  assert.equal(p.pricing.hillStation.grossAmount, 800);
  assert.deepEqual(p.pricing.hillStation.stations.map((s) => s.name), ['Ooty']);
  const line = p.breakup.lines.find((l) => l.key === 'hillStation');
  assert.equal(line.label, 'Hill Station Allowance / Charge');
  assert.match(line.detail, /Ooty/);
  assert.equal(p.hill.charged, true);
  // The package itself is untouched by the hill charge.
  assert.equal(p.pricing.gstInclusiveBase.packagePaise / 100, 4000);
  assert.equal(p.fare.hillCharge, p.pricing.hillStation.amount);
  // Partner: the package payout + the hill slab payout.
  assert.equal(p.pricing.partner.hillPaise, 65000);
  assert.equal(p.pricing.partner.basePaise, 355000 + 65000);
});

test('hill stations never use the 5-hour / 8-hour packages, and no same-day short slab is the default', () => {
  const noHill = price({ drop: madurai, km: 40, min: 60 });
  assert.equal(noHill.pricing.timeBased.packageId, 'same:five');
  const hill = price({ km: 40, min: 60 });
  assert.equal(hill.pricing.timeBased.packageId, 'same:full');
  for (const pkg of ['same:five', 'same:eight']) assert.throws(() => price({ pkg, km: 40, min: 60 }), (e) => e.details?.code === 'package-unavailable', pkg);
});

test('3:00 PM+ hill trip goes to the Next-Day / multi-day slab (no stand-alone Full-Day card from 3 PM)', () => {
  const p = price({ at: '2026-11-17T16:00:00', km: 40, min: 60 });
  assert.equal(p.pricing.timeBased.packageId, 'morning');
  const next = price({ at: '2026-11-17T16:00:00', km: 40, min: 60, pkg: 'next', days: 2 });
  assert.equal(next.fare.total, 6780 + 800);
  assert.equal(next.pricing.days, 2);
});

test('One Way: the hill charge uses the One-Way slab as a separate line (base + bata + extra km, then hill)', () => {
  const without = price({ tripType: 'One Way', pickup: coimbatore, drop: place('Pune', 18.5204, 73.8567), km: 200, min: 240, tariff: cfg });
  assert.equal(without.pricing.hillStation, undefined);
  const withHill = price({ tripType: 'One Way', pickup: coimbatore, drop: ooty, km: 200, min: 240 });
  const plain = price({ tripType: 'One Way', pickup: coimbatore, drop: ooty, km: 200, min: 240, tariff: cfgNoHill });
  assert.equal(withHill.pricing.hillStation.slab, 'oneWay');
  assert.ok(Math.abs(withHill.fare.total - plain.fare.total - 500) < 0.011, `${withHill.fare.total} vs ${plain.fare.total}`);
  assert.equal(withHill.breakup.lines.find((l) => l.key === 'hillStation').label, 'Hill Station Allowance / Charge');
  assert.equal(withHill.pricing.partner.hillPaise, 40000);
});

test('a class with no slab, the switch off, or a non-hill trip is never charged; the package rules still apply while the switch is on', () => {
  const off = T.parseTariffConfig({ ...base, hillStation: { ...hillStation, enabled: false } });
  assert.equal(price({ tariff: off, pkg: 'same:full', km: 90, min: 120 }).pricing.hillStation, undefined);
  assert.equal(price({ tariff: off, km: 40, min: 60 }).pricing.timeBased.packageId, 'same:five');
  const noSlab = T.parseTariffConfig({ ...base, hillStation: { ...hillStation, classes: { suv: hillStation.classes.sedan } } });
  const r = price({ tariff: noSlab, pkg: 'same:full', km: 90, min: 120 });
  assert.equal(r.pricing.hillStation, undefined);
  assert.equal(r.hill.charged, false);
  assert.equal(price({ drop: madurai, pkg: 'same:full', km: 90, min: 120 }).pricing.hillStation, undefined);
});

test('a hill stop on the way counts; "per station" charges every distinct station once, "per trip" charges once', () => {
  const stopOnly = price({ drop: madurai, stops: [coonoor], pkg: 'same:full', km: 90, min: 120 });
  assert.equal(stopOnly.pricing.hillStation.units, 1);
  const two = price({ pickup: coimbatore, drop: ooty, stops: [coonoor], pkg: 'same:full', km: 90, min: 120 });
  assert.equal(two.pricing.hillStation.units, 1);
  assert.equal(two.pricing.hillStation.grossAmount, 800);
  const perStation = T.parseTariffConfig({ ...base, hillStation: { ...hillStation, chargePer: 'station' } });
  const x = price({ tariff: perStation, pickup: coimbatore, drop: ooty, stops: [coonoor], pkg: 'same:full', km: 90, min: 120 });
  assert.equal(x.pricing.hillStation.units, 2);
  assert.equal(x.pricing.hillStation.grossAmount, 1600);
  assert.equal(x.fare.total, 5600);
});

test('GST added on top: the hill charge is taxed with the fare and the totals still add up', () => {
  const rule = { rate: 0.05, mode: 'excluded', classification: 'passenger', supplierState: '33', reference: 'GST-2026' };
  const t = T.parseTariffConfig({ ...base, hillStation, fareGst: { common: { 'Round Trip': { default: rule } } } });
  const p = priceBooking({
    category, route: { distanceKm: 90, durationMin: 120 }, tripType: 'Round Trip', pickup: theni, drop: ooty, pickupAt: new Date(IST('2026-11-17T09:00:00')), tripEndAt: null,
    tariff: t, adjustment: null, customerChannel: true, tripDays: 1, timePackage: 'same:full', boardingState: '33',
  });
  assert.equal(p.fare.taxableAmount, 4800);
  assert.equal(p.fare.total, 5040);
  assert.equal(p.fare.hillCharge, 800);
  assert.equal(Math.round((p.fare.taxableAmount + p.fare.gst) * 100), Math.round(p.fare.total * 100));
});

test('final fare keeps the booked hill charge and the partner payout, with extra km on the package', () => {
  const q = price({ pkg: 'same:full', km: 90, min: 120 });
  const done = T.finalizeFare({ pricing: q.pricing, totalKm: 300, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T20:00:00') });
  // Package ₹4,000 + 50 extra km × ₹14 (GST included) + the hill ₹800.
  assert.equal(done.fare.total, 4000 + 700 + 800);
  assert.equal(done.fare.hillCharge, q.pricing.hillStation.amount);
  assert.equal(done.partnerPaise / 100, 3550 + 50 * 12.6 + 650);
});

test('time-based package + hill: the multi-day fare adds the hill line once', () => {
  const q = price({ at: '2026-11-16T12:00:00', days: 3, pkg: 'next', km: 100, min: 120 });
  assert.equal(q.fare.total, 12000 + 800);
  assert.equal(q.pricing.days, 3);
});

test('hill station settings parse: malformed slabs, unknown classes and bad stations are dropped', () => {
  const c = H.parseHillStationConfig({ enabled: true, chargePer: 'bogus', classes: { sedan: { oneWay: { customer: 5, partner: 3 }, roundTrip: { customer: -1, partner: 1 } }, nope: { oneWay: { customer: 1, partner: 1 } } },
    stations: [{ id: 'munnar', name: 'Munnar', lat: 10.0889, lng: 77.0595, radiusKm: 12, aliases: ['munnar'] }, { id: 'x', name: 'Bad', lat: 0, lng: 0, radiusKm: 5 }], disabledStations: ['topslip'] }, T.TARIFF_CLASSES);
  assert.equal(c.chargePer, 'trip');
  assert.deepEqual(Object.keys(c.classes), ['sedan']);
  assert.equal(c.classes.sedan.roundTrip, undefined);
  assert.deepEqual(c.stations.map((s) => s.id), ['munnar']);
  const list = H.hillStationsOf(c);
  assert.ok(list.some((s) => s.id === 'munnar'));
  assert.ok(!list.some((s) => s.id === 'topslip'));
  assert.equal(H.detectHillStations([{ role: 'drop', lat: 10.0889, lng: 77.0595 }], c)[0].id, 'munnar');
});
