// Confirmed tariff fixtures from Tariff & Operations v2.0 (pages 3-6) and eligibility rules (V p.14-15).
// Run: npm run build && node --test test/tariff.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/domain/tariff');
const E = require('../lib/domain/eligibility');

const cfg = { ...T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 1, enabled: true }) };
const IST = (s) => Date.parse(`${s}+05:30`);

test('one-way: 130 km floor — Sedan, SUV and Crysta customer base and partner base', () => {
  const near = (cls) => T.quoteOneWay({ config: cfg, tariffClass: cls, tripType: 'One Way', routeKm: 90, durationMin: 120, pickupMs: IST('2026-10-20T10:00:00') });
  const sedan = near('sedan');
  assert.equal(sedan.pricing.packagePaise / 100, 2350);
  assert.equal(sedan.pricing.partner.basePaise / 100, 2055);
  assert.equal(near('suv').pricing.packagePaise / 100, 3000);
  assert.equal(near('suv').pricing.partner.basePaise / 100, 2640);
  assert.equal(near('crysta').pricing.packagePaise / 100, 3980);
  assert.equal(near('crysta').pricing.partner.basePaise / 100, 3520);
  // GST is applied on top by the existing 5% policy; lines add up to the package.
  const f = sedan.fare;
  assert.equal(f.distanceFare + f.minimumFareAdjustment + f.driverAllowance, 2350);
  assert.equal(f.gst, 117.5);
  assert.equal(f.total, 2467.5);
});

test('one-way: a 300 km quote adds only the extra kilometres (no duplicated package)', () => {
  const q = T.quoteOneWay({ config: cfg, tariffClass: 'sedan', tripType: 'One Way', routeKm: 300, durationMin: 400, pickupMs: IST('2026-10-20T10:00:00') });
  assert.equal(q.pricing.packagePaise / 100, 4900);
  const final = T.finalizeFare({ pricing: q.pricing, totalKm: 310, endMs: IST('2026-10-20T20:00:00') });
  assert.equal(final.extraKm, 10);
  assert.equal(final.extraKmPaise / 100, 150);
  assert.equal(final.fare.subtotal, 5050);
  assert.equal(final.partnerPaise / 100, 4485); // 310 × 13.50 + 300
});

test('one-way: a shorter trip never reduces the quoted package', () => {
  const q = T.quoteOneWay({ config: cfg, tariffClass: 'sedan', tripType: 'One Way', routeKm: 300, durationMin: 400, pickupMs: IST('2026-10-20T10:00:00') });
  const final = T.finalizeFare({ pricing: q.pricing, totalKm: 250, endMs: IST('2026-10-20T20:00:00') });
  assert.equal(final.extraKm, 0);
  assert.equal(final.fare.subtotal, 4900);
  assert.equal(final.fare.distanceFare + final.fare.minimumFareAdjustment + final.fare.driverAllowance, 4900);
});

test('round trip: IST calendar days and daily minimums', () => {
  assert.equal(T.calendarDays(IST('2026-10-09T12:00:00'), IST('2026-10-09T22:00:00')), 1);
  assert.equal(T.calendarDays(IST('2026-10-09T12:00:00'), IST('2026-10-10T10:00:00')), 2);
  assert.equal(T.calendarDays(IST('2026-10-09T23:00:00'), IST('2026-10-10T01:00:00')), 2); // midnight boundary
  assert.equal(T.calendarDays(IST('2026-10-10T10:00:00'), IST('2026-10-09T10:00:00')), null);
  const oneDay = (cls) => T.quoteRoundTrip({ config: cfg, tariffClass: cls, tripType: 'Round Trip', routeKm: 40, durationMin: 60, pickupMs: IST('2026-10-09T12:00:00'), endMs: IST('2026-10-09T22:00:00') });
  assert.equal(oneDay('sedan').pricing.packagePaise / 100, 3900);
  assert.equal(oneDay('suv').pricing.packagePaise / 100, 5150);
  assert.equal(oneDay('crysta').pricing.packagePaise / 100, 7100);
  assert.equal(oneDay('sedan').pricing.partner.basePaise / 100, 3450);
  assert.equal(oneDay('suv').pricing.partner.basePaise / 100, 4575);
  assert.equal(oneDay('crysta').pricing.partner.basePaise / 100, 6400);
  const two = T.quoteRoundTrip({ config: cfg, tariffClass: 'sedan', tripType: 'Round Trip', routeKm: 40, durationMin: 60, pickupMs: IST('2026-10-09T12:00:00'), endMs: IST('2026-10-10T10:00:00') });
  assert.equal(two.pricing.days, 2);
  assert.equal(two.pricing.packagePaise / 100, 500 * 14 + 800); // 500 km × 14 + 2 × 400
});

test('round trip: a trip that runs into another date adds that day', () => {
  const q = T.quoteRoundTrip({ config: cfg, tariffClass: 'sedan', tripType: 'Round Trip', routeKm: 40, durationMin: 60, pickupMs: IST('2026-10-09T12:00:00'), endMs: IST('2026-10-09T22:00:00') });
  const final = T.finalizeFare({ pricing: q.pricing, totalKm: 240, endMs: IST('2026-10-10T01:00:00') });
  assert.equal(final.days, 2);
  assert.equal(final.extraDays, 1);
  assert.equal(final.fare.subtotal, 500 * 14 + 2 * 400);
});

test('round trip is rejected without an end, before the start, or beyond the limit', () => {
  const base = { config: cfg, tariffClass: 'sedan', tripType: 'Round Trip', routeKm: 40, durationMin: 60, pickupMs: IST('2026-10-09T12:00:00') };
  assert.throws(() => T.quoteRoundTrip({ ...base, endMs: null }), /Choose the date/);
  assert.throws(() => T.quoteRoundTrip({ ...base, endMs: IST('2026-10-08T12:00:00') }), /cannot end before/);
  assert.throws(() => T.quoteRoundTrip({ ...base, endMs: IST('2026-12-01T12:00:00') }), /up to 30 days/);
});

test('rental time: minimum fare plus minute-based overtime, never rounded to an hour', () => {
  const r = cfg.rental.classes;
  assert.equal(T.rentalTimeFare(r.sedan, 4 * 60 + 30).timePaise / 100, 1725);
  assert.equal(T.rentalTimeFare(r.suv, 5 * 60 + 20).timePaise / 100, 2650);
  assert.equal(T.rentalTimeFare(r.crysta, 10 * 60 + 15).timePaise / 100, 6350);
  assert.equal(T.rentalTimeFare(r.sedan, 120).timePaise / 100, 1550); // under the minimum
});

test('city drop package: 20 km base, extra km only beyond it; no zones configured → no zone match', () => {
  const s = T.cityDropFare(cfg, 'sedan', 30);
  assert.equal(s.customerPaise / 100, 1150);
  assert.equal(s.partnerPaise / 100, 750);
  assert.equal(T.withinCityZone(cfg, { lat: 13.08, lng: 80.27 }, { lat: 13.1, lng: 80.28 }), null);
  const withZone = { ...cfg, cityDrop: { ...cfg.cityDrop, zones: [{ id: 'chn', name: 'Chennai', lat: 13.08, lng: 80.27, radiusKm: 25 }] } };
  assert.equal(T.withinCityZone(withZone, { lat: 13.08, lng: 80.27 }, { lat: 13.1, lng: 80.28 }).id, 'chn');
});

test('paise arithmetic is exact: 13.50/km and 12.60/km carry no float error', () => {
  assert.equal(T.kmAmountPaise(310, 1350), 418500);
  assert.equal(T.kmAmountPaise(500, 1260), 630000);
  assert.equal(T.kmAmountPaise(77.7, 1710), Math.round(77.7 * 1710));
});

test('a partial rate card is not a price (missing class is left out, never zero)', () => {
  const c = T.parseTariffConfig({ enabled: true, oneWay: { classes: { sedan: { customerRate: 15, customerBata: 400, partnerRate: 13.5 } } } });
  assert.equal(c.oneWay.classes.sedan, undefined);
  assert.throws(() => T.quoteOneWay({ config: c, tariffClass: 'sedan', tripType: 'One Way', routeKm: 200, durationMin: 200, pickupMs: 0 }), /not configured/);
});

test('vehicle class matrix: 35 cells match the confirmed table', () => {
  const expect = {
    sedan: ['sedan'], suv6: ['sedan', 'suv6'], suv7: ['sedan', 'suv6', 'suv7'], innova6: ['sedan', 'suv6', 'innova'],
    innova7: ['sedan', 'suv6', 'suv7', 'innova'], crysta6: ['sedan', 'suv6', 'innova', 'crysta'], crysta7: ['sedan', 'suv6', 'suv7', 'innova', 'crysta'],
  };
  let cells = 0;
  for (const v of E.VEHICLE_CLASSES) for (const d of E.DUTY_CLASSES) { cells++; assert.equal(E.classAllows(v, d), expect[v].includes(d), `${v}→${d}`); }
  assert.equal(cells, 35);
});

test('seats are checked separately from the category label', () => {
  const ok = E.vehicleServesDuty({ vehicleClass: 'crysta7', seatingCapacity: 7 }, { dutyClass: 'suv7', passengerSeatsRequired: 7 });
  assert.equal(ok.ok, true);
  const tooSmall = E.vehicleServesDuty({ vehicleClass: 'crysta7', seatingCapacity: 5 }, { dutyClass: 'suv7', passengerSeatsRequired: 7 });
  assert.equal(tooSmall.ok, false);
  const wrongClass = E.vehicleServesDuty({ model: 'Dzire', seatingCapacity: 4 }, { dutyClass: 'innova', passengerSeatsRequired: 4 });
  assert.equal(wrongClass.ok, false);
  assert.equal(E.dutyClassOf({ name: 'Innova Crysta', seats: 7 }), 'crysta');
  assert.equal(E.dutyClassOf({ name: 'SUV 7+1', seats: 7 }), 'suv7');
  assert.equal(E.vehicleClassOf({ make: 'Toyota', model: 'Innova', seatingCapacity: 7 }), 'innova7');
});

test('schedule: a running trip does not block a later duty it will clear in time', () => {
  const cfgS = { bufferMinutes: 30, repositionKmh: 40, defaultTripMinutes: 120 };
  const hour = 3600000;
  const t0 = IST('2026-10-20T05:00:00');
  const running = { start: t0, end: t0 + 5 * hour, pickup: null, drop: null };
  assert.equal(E.scheduleVerdict({ start: t0 + 5.5 * hour + 1, end: t0 + 8 * hour }, running, cfgS).ok, true);
  assert.equal(E.scheduleVerdict({ start: t0 + 6.5 * hour, end: t0 + 9 * hour }, running, cfgS).ok, true);
  const tooSoon = E.scheduleVerdict({ start: t0 + 5.2 * hour, end: t0 + 8 * hour }, running, cfgS);
  assert.equal(tooSoon.ok, false);
  assert.ok(tooSoon.readyAt);
  assert.equal(E.scheduleVerdict({ start: t0 + hour, end: t0 + 2 * hour }, running, cfgS).ok, false);
});

test('functional spec fixture: 300 km quote ₹5,145.00; 310 km final ₹5,302.50 (GST ₹252.50, extra ₹157.50)', () => {
  const q = T.quoteOneWay({ config: cfg, tariffClass: 'sedan', tripType: 'One Way', routeKm: 300, durationMin: 400, pickupMs: IST('2026-10-20T10:00:00') });
  assert.equal(q.fare.subtotal, 4900);
  assert.equal(q.fare.gst, 245);
  assert.equal(q.fare.total, 5145);
  const final = T.finalizeFare({ pricing: q.pricing, totalKm: 310, endMs: IST('2026-10-20T20:00:00') });
  assert.equal(final.fare.subtotal, 5050);
  assert.equal(final.fare.gst, 252.5);
  assert.equal(final.fare.total, 5302.5);
  assert.equal(final.fare.total - q.fare.total, 157.5);
  // Partner holds the whole 5,302.50 → NESAM debits fee + GST per the spec's wallet table.
  assert.equal(T.r2(5302.5 - 4585), 717.5);
});

test('GST is kept to the paise, half-up, with integer arithmetic', () => {
  assert.equal(T.gstOn(5050, 0.05), 252.5);
  assert.equal(T.gstOn(2350, 0.05), 117.5);
  assert.equal(T.gstOn(1000.1, 0.05), 50.01);
  assert.equal(T.gstOn(0, 0.05), 0);
});
