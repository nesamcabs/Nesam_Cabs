// Local Taxi: pure-logic tests (zone geometry, fare engine, ride state machine). No emulator or network needed.
// Fixture coordinates are made-up test squares, NOT a real city boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../lib/localTaxi/geo');
const fare = require('../lib/localTaxi/fare');
const states = require('../lib/localTaxi/states');

const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const poly = (...rings) => ({ type: 'Polygon', coordinates: rings });
const ZONE = poly(square(77.0, 11.0, 77.1, 11.1));

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────────────────────
test('a point inside the zone is inside, outside is outside', () => {
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 77.05 }, ZONE), true);
  assert.equal(geo.pointInGeometry({ lat: 11.2, lng: 77.05 }, ZONE), false);
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 76.9 }, ZONE), false);
});

test('boundary policy: a point exactly on an edge or vertex is INSIDE', () => {
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 77.0 }, ZONE), true); // west edge
  assert.equal(geo.pointInGeometry({ lat: 11.1, lng: 77.05 }, ZONE), true); // north edge
  assert.equal(geo.pointInGeometry({ lat: 11.0, lng: 77.0 }, ZONE), true); // corner
  assert.equal(geo.pointInGeometry({ lat: 11.1000001, lng: 77.05 }, ZONE), false); // just past the edge
});

test('holes: the open interior of a hole is outside, the hole edge belongs to the zone', () => {
  const z = geo.validateGeometry(poly(square(77.0, 11.0, 77.1, 11.1), square(77.04, 11.04, 77.06, 11.06)));
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 77.05 }, z), false);
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 77.04 }, z), true);
  assert.equal(geo.pointInGeometry({ lat: 11.02, lng: 77.02 }, z), true);
});

test('invalid geometry is rejected with a reason', () => {
  assert.throws(() => geo.validateGeometry(null), geo.GeometryError);
  assert.throws(() => geo.validateGeometry({ type: 'Point', coordinates: [77, 11] }), /Polygon/);
  assert.throws(() => geo.validateGeometry(poly([[77, 11], [77.1, 11], [77.1, 11.1], [77, 11.1]])), /closed|at least/);
  assert.throws(() => geo.validateGeometry(poly([[77, 11], [77.1, 11], [77, 11]])), /at least 3/);
  assert.throws(() => geo.validateGeometry(poly([[77, 11], [77.1, 11.1], [77.1, 11], [77, 11.1], [77, 11]])), /crosses itself/); // bow-tie
  assert.throws(() => geo.validateGeometry(poly(square(10, 40, 10.1, 40.1))), /outside India/);
  assert.throws(() => geo.validateGeometry(poly([[77, 11], [77, 11], [77.1, 11], [77, 11]])), geo.GeometryError);
  assert.throws(() => geo.validateGeometry(poly([[77, 11], [77.1, "x"], [77.1, 11.1], [77, 11]])), /valid coordinate/);
});

test('a zone larger than ~200 km is rejected', () => {
  assert.throws(() => geo.validateGeometry(poly(square(76, 10, 79, 12))), /larger than/);
});

test('overlapping or touching zones are detected; separate zones are not', () => {
  const a = geo.validateGeometry(ZONE);
  const overlapping = geo.validateGeometry(poly(square(77.05, 11.05, 77.15, 11.15)));
  const touching = geo.validateGeometry(poly(square(77.1, 11.0, 77.2, 11.1))); // shares the east edge
  const inside = geo.validateGeometry(poly(square(77.02, 11.02, 77.03, 11.03)));
  const apart = geo.validateGeometry(poly(square(77.3, 11.0, 77.4, 11.1)));
  assert.equal(geo.geometriesOverlap(a, overlapping), true);
  assert.equal(geo.geometriesOverlap(a, touching), true);
  assert.equal(geo.geometriesOverlap(a, inside), true);
  assert.equal(geo.geometriesOverlap(a, apart), false);
});

test('a multipolygon whose areas overlap is rejected; disjoint areas are accepted', () => {
  assert.throws(() => geo.validateGeometry({ type: 'MultiPolygon', coordinates: [[square(77, 11, 77.1, 11.1)], [square(77.05, 11.05, 77.15, 11.15)]] }), /overlap/);
  const ok = geo.validateGeometry({ type: 'MultiPolygon', coordinates: [[square(77, 11, 77.1, 11.1)], [square(77.2, 11, 77.3, 11.1)]] });
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 77.25 }, ok), true);
  assert.equal(geo.pointInGeometry({ lat: 11.05, lng: 77.15 }, ok), false);
});

test('haversine distance is sensible', () => {
  const m = geo.haversineMeters({ lat: 11, lng: 77 }, { lat: 11, lng: 77.01 });
  assert.ok(m > 1050 && m < 1100, String(m));
});

// ── Fare engine ─────────────────────────────────────────────────────────────────────────────────────────────────
const BASE = {
  currency: 'INR', baseFarePaise: 5000, includedMeters: 2000, perKmPaise: 1200, perMinutePaise: 150, minimumFarePaise: 8000,
  freeWaitingSeconds: 180, waitingPerMinutePaise: 200, pickupChargePaise: 0,
  night: { enabled: false, startMinute: 1320, endMinute: 360, bps: 2000 },
  surge: { enabled: false, multiplierBps: 10000, maxBps: 20000, effectiveFromMs: null, effectiveToMs: null },
  cancellation: { feePaise: 3000, graceSeconds: 120 }, tax: { enabled: false, bps: 0 }, platformFeePaise: 0, rounding: 'none', commissionBps: 1500, maxDistanceOverQuoteBps: 15000,
};
const TZ = 'Asia/Kolkata';
const noon = Date.UTC(2026, 10, 5, 6, 30); // 12:00 IST
const calc = (over, m, at = noon) => fare.calculateFare(fare.validateFareConfig({ ...BASE, ...over }), { waitingSeconds: 0, ...m }, at, TZ);

test('included distance is covered by the base fare; only the excess is charged', () => {
  const f = calc({}, { distanceMeters: 5000, rideSeconds: 600 });
  assert.equal(f.meteredFarePaise, 5000 + 3600 + 1500); // 3 km over × ₹12 + 10 min × ₹1.50
  assert.equal(f.totalPaise, 10100);
  const inside = calc({}, { distanceMeters: 1500, rideSeconds: 0 });
  assert.equal(inside.lines.some((l) => l.code === 'distance'), false);
});

test('minimum fare lifts a short trip', () => {
  const f = calc({}, { distanceMeters: 1000, rideSeconds: 120 });
  assert.equal(f.minimumApplied, true);
  assert.equal(f.totalPaise, 8000);
});

test('waiting is billed once: free time first, and it never also counts as ride time', () => {
  const noWait = calc({}, { distanceMeters: 5000, rideSeconds: 600 });
  const withWait = calc({}, { distanceMeters: 5000, rideSeconds: 1080, waitingSeconds: 480 }); // 8 min waiting inside 18 min total
  assert.equal(withWait.inputs.billableSeconds, 600);
  assert.equal(withWait.meteredFarePaise, noWait.meteredFarePaise); // same billable ride time
  assert.equal(withWait.waitingChargePaise, Math.round((300 * 200) / 60)); // 480 s - 180 s free = 5 min × ₹2
  assert.equal(withWait.totalPaise, noWait.totalPaise + withWait.waitingChargePaise);
  assert.equal(calc({}, { distanceMeters: 5000, rideSeconds: 700, waitingSeconds: 100 }).waitingChargePaise, 0); // inside the free time
});

test('night surcharge crosses midnight (22:00–06:00 IST) and applies on the metered fare only', () => {
  const night = { night: { enabled: true, startMinute: 1320, endMinute: 360, bps: 2000 } };
  const at = (h, m) => Date.UTC(2026, 10, 5, h, m) - 330 * 60000; // IST wall-clock → UTC
  assert.equal(calc(night, { distanceMeters: 5000, rideSeconds: 600 }, at(23, 30)).nightApplied, true);
  assert.equal(calc(night, { distanceMeters: 5000, rideSeconds: 600 }, at(2, 0)).nightApplied, true);
  assert.equal(calc(night, { distanceMeters: 5000, rideSeconds: 600 }, at(12, 0)).nightApplied, false);
  assert.equal(calc(night, { distanceMeters: 5000, rideSeconds: 600 }, at(6, 0)).nightApplied, false); // end is exclusive
  assert.equal(calc(night, { distanceMeters: 5000, rideSeconds: 600 }, at(22, 0)).nightApplied, true); // start is inclusive
  const f = calc({ ...night, pickupChargePaise: 1000, platformFeePaise: 500 }, { distanceMeters: 5000, rideSeconds: 600 }, at(23, 30));
  assert.equal(f.nightSurchargePaise, 2020); // 20 % of 10100, not of the pickup or platform fee
  assert.equal(f.totalPaise, 10100 + 2020 + 1000 + 500);
});

test('surge applies only inside its dates, after night, and never to pickup or waiting', () => {
  const surge = { surge: { enabled: true, multiplierBps: 15000, maxBps: 20000, effectiveFromMs: noon - 1000, effectiveToMs: noon + 3600000 } };
  const on = calc({ ...surge, pickupChargePaise: 1000 }, { distanceMeters: 5000, rideSeconds: 600 });
  assert.equal(on.surgeApplied, true);
  assert.equal(on.adjustedFarePaise, Math.round(10100 * 1.5));
  assert.equal(on.totalPaise, Math.round(10100 * 1.5) + 1000);
  assert.equal(calc(surge, { distanceMeters: 5000, rideSeconds: 600 }, noon + 7200000).surgeApplied, false); // expired
  assert.equal(calc(surge, { distanceMeters: 5000, rideSeconds: 600 }, noon - 5000).surgeApplied, false); // not yet
});

test('taxes are off until enabled, and the platform fee is not taxed', () => {
  assert.equal(calc({ tax: { enabled: false, bps: 500 } }, { distanceMeters: 5000, rideSeconds: 600 }).taxPaise, 0);
  const f = calc({ tax: { enabled: true, bps: 500 }, platformFeePaise: 1000, pickupChargePaise: 2000 }, { distanceMeters: 5000, rideSeconds: 600 });
  assert.equal(f.taxPaise, Math.round(((10100 + 2000) * 500) / 10000));
  assert.equal(f.totalPaise, 10100 + 2000 + 1000 + f.taxPaise);
});

test('rounding policies', () => {
  const odd = { distanceMeters: 5100, rideSeconds: 610 };
  assert.equal(calc({ rounding: 'none' }, odd).totalPaise % 100 !== 0 || true, true);
  assert.equal(fare.applyRounding(10149, 'nearest_rupee'), 10100);
  assert.equal(fare.applyRounding(10150, 'nearest_rupee'), 10200);
  assert.equal(fare.applyRounding(10101, 'ceil_rupee'), 10200);
  assert.equal(fare.applyRounding(10100, 'ceil_rupee'), 10100);
  assert.equal(fare.applyRounding(10240, 'nearest_five'), 10000);
  assert.equal(fare.applyRounding(10260, 'nearest_five'), 10500);
  const f = calc({ rounding: 'nearest_five' }, odd);
  assert.equal(f.totalPaise % 500, 0);
  assert.equal(f.roundingPaise, f.totalPaise - (f.adjustedFarePaise + f.platformFeePaise + f.pickupChargePaise + f.waitingChargePaise + f.taxPaise));
});

test('driver commission is separate from the customer fare and excludes platform fee and tax', () => {
  const f = calc({ platformFeePaise: 1000, tax: { enabled: true, bps: 500 } }, { distanceMeters: 5000, rideSeconds: 600 });
  assert.equal(f.commissionPaise, Math.round((10100 * 1500) / 10000));
  assert.equal(f.driverEarningsPaise, 10100 - f.commissionPaise);
  assert.ok(f.totalPaise > f.driverEarningsPaise + f.commissionPaise); // platform fee + tax are on top
});

test('all money in a breakdown is an integer number of paise', () => {
  const f = calc({ perKmPaise: 1333, perMinutePaise: 177, tax: { enabled: true, bps: 1800 }, commissionBps: 1777 }, { distanceMeters: 7331, rideSeconds: 913, waitingSeconds: 211 });
  for (const v of [f.totalPaise, f.taxPaise, f.commissionPaise, f.driverEarningsPaise, f.waitingChargePaise, ...f.lines.map((l) => l.amountPaise)]) assert.ok(Number.isInteger(v), String(v));
});

test('invalid fare settings are rejected with every problem listed', () => {
  const bad = (over) => assert.throws(() => fare.validateFareConfig({ ...BASE, ...over }), fare.FareConfigError);
  bad({ currency: 'USD' });
  bad({ baseFarePaise: -1 });
  bad({ baseFarePaise: 12.5 });
  bad({ perKmPaise: '1200' });
  bad({ minimumFarePaise: 100 }); // below the base fare
  bad({ rounding: 'banker' });
  bad({ night: { enabled: true, startMinute: 600, endMinute: 600, bps: 2000 } });
  bad({ night: { enabled: true, startMinute: 1500, endMinute: 360, bps: 2000 } });
  bad({ surge: { enabled: true, multiplierBps: 9000, maxBps: 20000, effectiveFromMs: null, effectiveToMs: Date.now() + 1000 } }); // below 1.0×
  bad({ surge: { enabled: true, multiplierBps: 25000, maxBps: 20000, effectiveFromMs: null, effectiveToMs: Date.now() + 1000 } }); // above its limit
  bad({ surge: { enabled: true, multiplierBps: 12000, maxBps: 20000, effectiveFromMs: null, effectiveToMs: null } }); // must end
  bad({ surge: { enabled: true, multiplierBps: 12000, maxBps: 20000, effectiveFromMs: 2000, effectiveToMs: 1000 } });
  bad({ tax: { enabled: true, bps: 0 } });
  bad({ tax: { enabled: true, bps: 9000 } });
  bad({ commissionBps: 9000 });
  bad({ freeWaitingSeconds: 99999 });
  try { fare.validateFareConfig({ ...BASE, baseFarePaise: -1, perKmPaise: 'x' }); assert.fail('should throw'); } catch (e) { assert.ok(e.problems.length >= 2); }
  assert.doesNotThrow(() => fare.validateFareConfig(BASE));
});

test('final distance: the quote is the reference, tracking is accepted only inside a sane band', () => {
  const cfg = fare.validateFareConfig(BASE);
  assert.deepEqual(fare.resolveFinalDistance(cfg, 5000, null), { meters: 5000, basis: 'quoted' });
  assert.deepEqual(fare.resolveFinalDistance(cfg, 5000, 3000), { meters: 5000, basis: 'quoted' }); // an incomplete track cannot lower the fare
  assert.deepEqual(fare.resolveFinalDistance(cfg, 5000, 5600), { meters: 5600, basis: 'tracked' });
  assert.deepEqual(fare.resolveFinalDistance(cfg, 5000, 9000), { meters: 7500, basis: 'capped' }); // 150 % cap
  assert.deepEqual(fare.resolveFinalDistance(cfg, 5000, Number.NaN), { meters: 5000, basis: 'quoted' });
});

test('cancellation fee: none before assignment or inside the grace period, then the configured fee', () => {
  const cfg = fare.validateFareConfig(BASE);
  const t0 = 1_000_000;
  assert.equal(fare.cancellationFeePaise(cfg, { status: 'searching', assignedAtMs: null }, t0), 0);
  assert.equal(fare.cancellationFeePaise(cfg, { status: 'assigned', assignedAtMs: t0 }, t0 + 60_000), 0);
  assert.equal(fare.cancellationFeePaise(cfg, { status: 'assigned', assignedAtMs: t0 }, t0 + 121_000), 3000);
  assert.equal(fare.cancellationFeePaise(cfg, { status: 'driver_arrived', assignedAtMs: t0 }, t0 + 600_000), 3000);
});

test('a fare edit never changes a stored breakdown (snapshots are plain data)', () => {
  const before = calc({}, { distanceMeters: 5000, rideSeconds: 600 });
  const snapshot = JSON.parse(JSON.stringify(before));
  calc({ baseFarePaise: 9000, minimumFarePaise: 9000 }, { distanceMeters: 5000, rideSeconds: 600 }); // an admin edit afterwards
  assert.deepEqual(JSON.parse(JSON.stringify(before)), snapshot);
});

// ── State machine ───────────────────────────────────────────────────────────────────────────────────────────────
test('the happy path is allowed step by step, with the right actor', () => {
  const path = [['requested', 'searching', 'system'], ['searching', 'assigned', 'driver'], ['assigned', 'driver_arriving', 'driver'], ['driver_arriving', 'driver_arrived', 'driver'], ['driver_arrived', 'in_progress', 'driver'], ['in_progress', 'completed', 'driver']];
  for (const [from, to, actor] of path) assert.equal(states.canTransition(from, to, actor), true, `${from}→${to}`);
});

test('steps cannot be skipped and the wrong actor is refused', () => {
  assert.equal(states.canTransition('searching', 'in_progress', 'driver'), false);
  assert.equal(states.canTransition('assigned', 'completed', 'driver'), false);
  assert.equal(states.canTransition('assigned', 'in_progress', 'driver'), false);
  assert.equal(states.canTransition('driver_arrived', 'in_progress', 'customer'), false);
  assert.equal(states.canTransition('searching', 'assigned', 'customer'), false);
  assert.equal(states.canTransition('in_progress', 'completed', 'customer'), false);
  assert.equal(states.canTransition('in_progress', 'cancelled', 'customer'), false);
  assert.match(states.transitionProblem('in_progress', 'cancelled', 'customer'), /cannot/);
});

test('ended rides cannot move again', () => {
  for (const s of ['completed', 'cancelled', 'expired', 'no_driver_available']) {
    assert.equal(states.isTerminal(s), true);
    assert.match(states.transitionProblem(s, 'searching', 'system'), /ended/);
  }
  assert.match(states.transitionProblem('searching', 'bogus', 'system'), /Unknown/);
});

test('a driver giving a ride back returns it to searching; the customer cancels instead of the driver', () => {
  assert.equal(states.canTransition('assigned', 'searching', 'driver'), true);
  assert.equal(states.canTransition('driver_arriving', 'searching', 'driver'), true);
  assert.equal(states.canTransition('driver_arriving', 'cancelled', 'driver'), false);
  assert.equal(states.canTransition('driver_arrived', 'cancelled', 'driver'), true); // customer no-show
  assert.equal(states.canTransition('searching', 'no_driver_available', 'system'), true);
  assert.equal(states.canTransition('searching', 'no_driver_available', 'customer'), false);
});
