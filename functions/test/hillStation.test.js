// Hill Station Allowance / Charge (Customer UX v8, section 08): detection by postal pincode (no radius), the separate fare line for One Way and
// Round Trip, the 5-hour / 8-hour restriction, partner payout, GST handling and the final fare.
// Run: npm run build && node --test test/hillStation.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/domain/tariff');
const H = require('../lib/domain/hillStations');
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');

const IST = (s) => Date.parse(`${s}+05:30`);
const sedan = {
  customerRate: 14, customerBata: 500, partnerRate: 12.6, partnerBata: 400, minKmPerDay: 250,
  timeBased: { fiveFare: 2080, fiveKm: 100, fivePartner: 1870, eightFare: 2780, eightKm: 150, eightPartner: 2500, morningFare: 4500, morningKm: 250, morningPartner: 4050 },
};
// Hill stations are always on. The charge is the "Hill station" rows of the fare table (brand overrides): no row, no charge.
const hillStation = { chargePer: 'trip' };
const hillRates = { 'One Way': { sedan: { hillCharge: 500, partnerHillCharge: 400 } }, 'Round Trip': { sedan: { hillCharge: 800, partnerHillCharge: 650 } } };
const baseNoHill = { ...CONFIRMED_TARIFF_V2, version: 8, enabled: true, roundTrip: { maxDays: 30, timeBased: { enabled: true }, classes: { sedan } }, roundTripExtras: { sedan: { extraKmRate: 14, waitingPerHour: 150 } } };
const base = { ...baseNoHill, brandOverrides: { common: hillRates } };
const cfg = T.parseTariffConfig({ ...base, hillStation });
const cfgNoHill = T.parseTariffConfig(baseNoHill);

const category = mapCategory('sedan', { name: 'Sedan', status: 'Active', seatingCapacity: 4 });
// A place as the map search gives it: the pincode is in the formatted address (Google writes "State 643001, India").
const place = (name, lat, lng, address) => ({ id: 'pin', name, address: address ?? name, lat, lng, type: 'other' });
const at = (name, lat, lng, state, pin) => place(name, lat, lng, `${name}, ${state} ${pin}, India`);
const theni = at('Theni', 10.0104, 77.4768, 'Tamil Nadu', '625531');
const madurai = at('Madurai', 9.9195, 78.1193, 'Tamil Nadu', '625001');
const ooty = at('Ooty', 11.4102, 76.695, 'Tamil Nadu', '643001');
const coonoor = at('Coonoor', 11.3531, 76.7959, 'Tamil Nadu', '643101');
const coimbatore = at('Coimbatore', 11.0168, 76.9558, 'Tamil Nadu', '641001');
const kodaikanal = at('Kodaikanal', 10.2381, 77.4892, 'Tamil Nadu', '624101');
const cumbum = at('Cumbum', 9.7353, 77.2849, 'Tamil Nadu', '625516');

const price = (o = {}) => priceBooking({
  category, route: { distanceKm: o.km ?? 60, durationMin: o.min ?? 90 }, tripType: o.tripType ?? 'Round Trip', pickup: o.pickup ?? theni, drop: o.drop ?? ooty, stops: o.stops,
  pickupAt: new Date(IST(o.at ?? '2026-11-17T09:00:00')), tripEndAt: o.tripEndAt ?? null, tariff: o.tariff ?? cfg, adjustment: null,
  customerChannel: o.office ? undefined : true, tripDays: o.days ?? 1, timePackage: o.pkg,
});

test('detection is by pincode only: every hill station of the guide is found by each of its pincodes; plain cities are not', () => {
  assert.equal(H.HILL_STATIONS.length, 29);
  for (const st of H.HILL_STATIONS) {
    assert.ok(st.pincodes.length > 0, st.name);
    for (const pin of st.pincodes) {
      assert.match(pin, /^[1-9]\d{5}$/, `${st.name} ${pin}`);
      const found = H.detectHillStations([{ role: 'drop', name: 'Somewhere', address: `Somewhere, India ${pin}` }]);
      assert.equal(found.length, 1, `${st.name} ${pin}`);
      assert.equal(found[0].pincode, pin);
    }
  }
  for (const city of [coimbatore, madurai, theni, cumbum, at('Chennai', 13.0827, 80.2707, 'Tamil Nadu', '600001'), at('Trichy', 10.7905, 78.7047, 'Tamil Nadu', '620001'), at('Bengaluru', 12.9716, 77.5946, 'Karnataka', '560001')]) {
    assert.deepEqual(H.detectHillStations([{ role: 'drop', ...city }]), [], city.name);
  }
});

test('there is no radius: coordinates and place names do not make a hill station, a pincode does', () => {
  // Exactly at the Ooty centre, but the address carries a plains pincode: not a hill station.
  assert.deepEqual(H.detectHillStations([{ role: 'drop', name: 'Ooty', address: 'Ooty Road, Coimbatore, Tamil Nadu 641001, India', lat: 11.4102, lng: 76.695 }]), []);
  // No pincode at all: nothing is guessed from the name or the position.
  assert.deepEqual(H.detectHillStations([{ role: 'drop', name: 'Ooty', address: 'Ooty, Tamil Nadu', lat: 11.4102, lng: 76.695 }]), []);
  // The pincode the app sent wins over one in the address text.
  assert.equal(H.detectHillStations([{ role: 'drop', address: 'Somewhere 600001', pincode: '643001' }])[0].id, 'ooty');
  // Tamil addresses work the same way (the pincode is a number).
  assert.equal(H.detectHillStations([{ role: 'drop', name: 'கொடைக்கானல் ஏரி', address: 'கொடைக்கானல், தமிழ்நாடு 624101, இந்தியா' }])[0].id, 'kodaikanal');
  assert.equal(H.pincodeIn('Flat 123456789, Anna Nagar, Madurai 625020, India'), '625020');
  assert.equal(H.pincodeIn('Phone 9876543210'), '');
  assert.equal(H.pincodeIn('Plot 12-345678'), '');
  assert.equal(H.validPincode('043001'), '');
  assert.equal(H.validPincode(' 643001 '), '643001');
});

test('the plains towns at the foot of the hills are not hill stations (Cumbum, Uthamapalayam, Jolarpettai, Sendamangalam, Salem, Mettupalayam, Dindigul…)', () => {
  const plains = [
    ['Cumbum', '625516'], ['Uthamapalayam', '625533'], ['Chinnamanur', '625515'], ['Periyakulam', '625601'], ['Jolarpettai', '635851'], ['Sendamangalam', '637409'],
    ['Namakkal', '637001'], ['Salem', '636001'], ['Mettupalayam', '641301'], ['Palani', '624601'], ['Pollachi', '642001'], ['Dindigul', '624001'], ['Yelandur', '571441'],
  ];
  for (const [name, pin] of plains) assert.deepEqual(H.detectHillStations([{ role: 'stop', name, address: `${name}, India ${pin}` }]), [], name);
});

test('Tamil Nadu, Kerala and Karnataka (Bangalore side) hill stations are all covered', () => {
  const byState = (state) => H.HILL_STATIONS.filter((x) => x.state === state).map((x) => x.id);
  assert.equal(byState('Tamil Nadu').length, 14);
  assert.equal(byState('Kerala').length, 7);
  assert.equal(byState('Karnataka').length, 8);
  const cases = [['Munnar', '685612', 'munnar'], ['Thekkady', '685509', 'thekkady'], ['Vagamon', '685503', 'vagamon'], ['Vythiri', '673576', 'wayanad'], ['Ponmudi', '695551', 'ponmudi'],
    ['Madikeri', '571201', 'madikeri'], ['Chikmagalur', '577101', 'chikmagalur'], ['Sakleshpur', '573134', 'sakleshpur'], ['Agumbe', '577411', 'agumbe'], ['Kudremukh', '577142', 'kudremukh'],
    ['Nandi Hills', '562103', 'nandi-hills']];
  for (const [name, pin, id] of cases) assert.equal(H.detectHillStations([{ role: 'drop', name, address: `${name} ${pin}` }])[0].id, id, name);
});

test('Theni to Cumbum and back (80 km round trip, 9 AM) is not a hill trip: the 5-hour package is offered and priced', () => {
  const p = price({ pickup: theni, drop: cumbum, km: 40, min: 46, pkg: 'same:five' });
  assert.equal(p.pricing.timeBased.packageId, 'same:five');
  assert.equal(p.pricing.hillStation, undefined);
  assert.equal(p.hill, undefined);
  // The same trip with Cumbum only as a stop on the way to a plains drop.
  const via = price({ pickup: theni, drop: madurai, stops: [cumbum], km: 40, min: 46, pkg: 'same:five' });
  assert.equal(via.pricing.timeBased.packageId, 'same:five');
  assert.equal(via.hill, undefined);
  // A bare pin (no pincode anywhere) is not a hill-station place either: the 5-hour package stays.
  const pin = price({ pickup: theni, drop: place('Pinned location', 9.67, 77.38), km: 40, min: 46, pkg: 'same:five' });
  assert.equal(pin.pricing.timeBased.packageId, 'same:five');
});

test('pickup, stops and drop are all checked; several places in one station count once; distinct stations stay in trip order', () => {
  const m = H.detectHillStations([
    { role: 'pickup', ...coimbatore }, { role: 'stop', ...coonoor }, { role: 'stop', ...ooty }, { role: 'drop', ...at('Coonoor Bus Stand', 11.3445, 76.7937, 'Tamil Nadu', '643102') },
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

test('a vehicle with no hill station row in the fare table, or a non-hill trip, is never charged', () => {
  // No hill amount typed anywhere: nothing is charged and the 5-hour package is still offered.
  assert.equal(price({ tariff: cfgNoHill, pkg: 'same:full', km: 90, min: 120 }).pricing.hillStation, undefined);
  assert.equal(price({ tariff: cfgNoHill, km: 40, min: 60 }).pricing.timeBased.packageId, 'same:five');
  // An amount for another vehicle only: this vehicle has none, so it is not charged either.
  const otherVehicle = T.parseTariffConfig({ ...baseNoHill, brandOverrides: { common: { 'Round Trip': { suv: { hillCharge: 800, partnerHillCharge: 650 } } } } });
  const r = price({ tariff: otherVehicle, pkg: 'same:full', km: 90, min: 120 });
  assert.equal(r.pricing.hillStation, undefined);
  assert.equal(r.hill, undefined);
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
    stations: [{ id: 'my-hill', name: 'My Hill', state: 'Kerala', pincodes: ['685999', ' 685998 ', '12345', 'abc'] }, { id: 'old-radius', name: 'Old', lat: 10.0889, lng: 77.0595, radiusKm: 12 }, { id: 'ooty', name: 'Ooty', pincodes: ['643001'] }], disabledStations: ['topslip'] }, T.TARIFF_CLASSES);
  assert.equal(c.chargePer, 'trip');
  assert.deepEqual(Object.keys(c.classes), ['sedan']);
  assert.equal(c.classes.sedan.roundTrip, undefined);
  // A radius-style entry has no pincodes and is dropped; bad pincodes are dropped from the rest.
  assert.deepEqual(c.stations.map((s) => s.id), ['my-hill', 'ooty']);
  assert.deepEqual(c.stations[0].pincodes, ['685999', '685998']);
  const list = H.hillStationsOf(c);
  assert.ok(list.some((x) => x.id === 'my-hill'));
  assert.ok(!list.some((x) => x.id === 'topslip'));
  assert.equal(H.detectHillStations([{ role: 'drop', address: 'Somewhere 685999' }], c)[0].id, 'my-hill');
  assert.deepEqual(H.detectHillStations([{ role: 'drop', address: 'Topslip 642133' }], c), []);
});

test('a Multicity tour through a hill station is charged the hill rate set on the Multicity fare table, as its own line', () => {
  const rates = { customerRate: 14, partnerRate: 12.6, customerBata: 500, partnerBata: 400, minKmPerDay: 250, hillCharge: 700, partnerHillCharge: 500 };
  const cfgM = T.parseTariffConfig({ ...base, hillStation, brandOverrides: { common: { Multicity: { sedan: rates } } } });
  const tour = (o = {}) => priceBooking({
    category, route: { distanceKm: 420, durationMin: 600 }, tripType: 'Round Trip', multicity: true, pickup: theni, drop: o.drop ?? madurai, stops: o.stops ?? [ooty],
    pickupAt: new Date(IST('2026-11-17T09:00:00')), tripEndAt: new Date(IST('2026-11-18T09:00:00')), tariff: o.tariff ?? cfgM, adjustment: null, customerChannel: true, tripDays: 2, brand: o.brand,
  });
  const plain = tour({ stops: [coimbatore] });
  assert.equal(plain.hill, undefined, 'no hill station on the tour: no charge');
  const hilly = tour();
  assert.equal(hilly.hill.charged, true);
  assert.deepEqual(hilly.hill.stations.map((s) => s.id), ['ooty']);
  assert.equal(hilly.pricing.hillStation.slab, 'multicity');
  assert.ok(hilly.breakup.lines.some((l) => l.key === 'hillStation' && l.label === 'Hill Station Allowance / Charge'));
  // The charge is added on top of the same tour fare; with GST on top, 700 + 5% of it.
  const added = Math.round((hilly.fare.total - plain.fare.total) * 100) / 100;
  assert.ok(added >= 700 && added <= 700 * 1.18 + 0.01, `added ${added}`);
  assert.ok(hilly.pricing.partner.basePaise - plain.pricing.partner.basePaise === 50000, 'the partner is paid the Multicity partner hill rate');
  // No Multicity hill amount for the vehicle: nothing is charged.
  const noRate = tour({ tariff: T.parseTariffConfig({ ...baseNoHill, hillStation, brandOverrides: { common: { Multicity: { sedan: { ...rates, hillCharge: undefined, partnerHillCharge: undefined } } } } }) });
  assert.equal(noRate.hill, undefined);
  assert.equal(noRate.fare.total, plain.fare.total);
});
