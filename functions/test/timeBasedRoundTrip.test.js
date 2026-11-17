// Time-based Round Trip + Hill Station charge — every worked example of the "Round Trip & Hill Station Developer Guide" (Customer UX v8, 16 Nov 2026).
// Run: npm run build && node --test test/timeBasedRoundTrip.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/domain/tariff');
const TB = require('../lib/domain/timeBased');

const IST = (s) => Date.parse(`${s}+05:30`);
const sedan = {
  customerRate: 14, customerBata: 500, partnerRate: 12.6, partnerBata: 400, minKmPerDay: 250,
  timeBased: { fiveFare: 2080, fiveKm: 100, fivePartner: 1870, eightFare: 2780, eightKm: 150, eightPartner: 2500, morningFare: 4500, morningKm: 250, morningPartner: 4050 },
};
const cfg = T.parseTariffConfig({
  ...T.CONFIRMED_TARIFF_V2, version: 7, enabled: true,
  roundTrip: { maxDays: 30, timeBased: { enabled: true }, classes: { sedan } },
  roundTripExtras: { sedan: { extraKmRate: 14, waitingPerHour: 150 } },
});
// A route's one-way km / minutes: the engine doubles both for the round trip.
const plan = (pickup, o = {}) => T.planTimeBasedRoundTrip({ config: cfg, tariffClass: 'sedan', pickupMs: IST(pickup), routeKm: o.km ?? 40, durationMin: o.min ?? 60, tripDays: o.days ?? 1 });
const ids = (p) => p.options.map((x) => x.id);
const quote = (pickup, pkg, o = {}) => T.quoteRoundTripTimeBased({ config: cfg, tariffClass: 'sedan', tripType: 'Round Trip', routeKm: o.km ?? 40, durationMin: o.min ?? 60, pickupMs: IST(pickup), endMs: null, tripDays: o.days ?? 1, timePackage: pkg });

test('the saved time-based tariff parses (sedan fares, cutoffs)', () => {
  assert.equal(cfg.roundTrip.timeBased.enabled, true);
  assert.equal(cfg.roundTrip.timeBased.cutoffMinutes, 23 * 60 + 45);
  assert.equal(cfg.roundTrip.classes.sedan.timeBased.eightFare, 2780);
});

test('full day = 250 km × ₹14 + ₹500 bata = ₹4,000 (driver bata included)', () => {
  const q = quote('2026-11-17T09:00:00', 'same:full', { km: 40 });
  assert.equal(q.pricing.packagePaise / 100, 4000);
  assert.equal(q.fare.baseFare, 4000);
  assert.equal(q.fare.driverAllowance, 0);
});

test('v8 pickup-time matrix (1 day): before 3 PM 5h/8h/full, 3:00–3:45 PM 5h/8h + overnight options, 3:46–6:45 PM 5h + overnight, later overnight only', () => {
  assert.deepEqual(ids(plan('2026-11-17T01:00:00')), ['same:eight', 'same:five', 'same:full']);
  assert.deepEqual(ids(plan('2026-11-17T14:59:00')), ['same:eight', 'same:five', 'same:full']);
  // From 3:00 PM there is NO stand-alone Full-Day card; Morning Return and the 8-Hour + Full Day (Next-Day) are listed instead.
  assert.deepEqual(ids(plan('2026-11-17T15:00:00')), ['same:eight', 'same:five', 'morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-17T15:45:00')), ['same:eight', 'same:five', 'morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-17T15:46:00')), ['same:five', 'morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-17T18:45:00')), ['same:five', 'morning', 'next']);
  const late = plan('2026-11-17T18:46:00');
  assert.equal(late.days, 2);
  assert.equal(late.autoDays, true);
  assert.deepEqual(ids(late), ['morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-17T22:00:00')), ['morning', 'next']);
});

test('12:00–12:59 AM pickups belong to the late-night group (no same-day package, 5-hour first slab); 1:00 AM starts the morning group', () => {
  const p = plan('2026-11-17T00:30:00', { days: 1 });
  assert.equal(p.autoDays, true);
  assert.deepEqual(ids(p), ['morning', 'next']);
  const next = quote('2026-11-17T00:30:00', 'next', { days: 2, km: 100 });
  assert.equal(next.pricing.timeBased.base.farePaise / 100, 6080);
  // Morning Return of a night pickup is back by 9:00 AM the same calendar date.
  const m = quote('2026-11-17T00:30:00', 'morning', { days: 2, km: 60, min: 80 });
  assert.equal(m.pricing.timeBased.morningCutoffMs, IST('2026-11-17T09:00:00'));
  assert.equal(quote('2026-11-17T01:00:00', 'next', { days: 2, km: 100 }).pricing.timeBased.base.farePaise / 100, 8000);
});

test('distance eligibility: 5-hour up to 100 km, 8-hour up to 150 km, above that only a full day', () => {
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 50, min: 60 })), ['same:eight', 'same:five', 'same:full']); // exactly 100 km round trip
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 50.1, min: 60 })), ['same:eight', 'same:full']);
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 75, min: 90 })), ['same:eight', 'same:full']); // exactly 150 km round trip
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 75.1, min: 90 })), ['same:full']);
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 125, min: 150 })), ['same:full']); // 250 km
});

test('above 250 km the same-day Full Day carries the extra km: 300 km = 300 × ₹14 + ₹500 = ₹4,700', () => {
  const q = quote('2026-11-17T09:00:00', 'same:full', { km: 150, min: 200 });
  assert.equal(q.pricing.quotedKm, 300);
  assert.equal(q.pricing.packagePaise / 100, 4700);
  assert.equal(q.pricing.days, 1);
});

test('a drive too long to be back by 11:45 PM goes the overnight way', () => {
  const p = plan('2026-11-17T14:00:00', { km: 300, min: 330 }); // 11 h of driving from 2 PM
  assert.equal(p.days, 2);
  assert.equal(p.autoDays, true);
});

test('estimated duration over 5 h offers the 8-hour slab, over 8 h only the full day', () => {
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 70, min: 170 })), ['same:eight', 'same:full']); // 5 h 40
  assert.deepEqual(ids(plan('2026-11-17T09:00:00', { km: 70, min: 250 })), ['same:full']); // 8 h 20
});

test('Next-Day Return by original pickup: <3 PM full+full, 3–9:59 PM 8h+full, ≥10 PM 5h+full', () => {
  const a = quote('2026-11-17T12:00:00', 'next', { days: 2, km: 100 });
  assert.equal(a.pricing.timeBased.base.farePaise / 100, 8000);
  assert.equal(a.pricing.timeBased.base.includedKm, 500);
  const b = quote('2026-11-17T20:00:00', 'next', { days: 2, km: 100 });
  assert.equal(b.pricing.timeBased.base.farePaise / 100, 6780);
  assert.equal(b.pricing.timeBased.base.includedKm, 400);
  const c = quote('2026-11-17T22:00:00', 'next', { days: 2, km: 100 });
  assert.equal(c.pricing.timeBased.base.farePaise / 100, 6080);
  assert.equal(c.pricing.timeBased.base.includedKm, 350);
  const edge = quote('2026-11-17T21:59:00', 'next', { days: 2, km: 100 });
  assert.equal(edge.pricing.timeBased.base.farePaise / 100, 6780);
});

test('Next-Day Return ends the next day at 11:45 PM IST (never 48 hours)', () => {
  const q = quote('2026-11-16T20:00:00', 'next', { days: 2, km: 100 });
  assert.equal(q.pricing.timeBased.coverageEndMs, IST('2026-11-17T23:45:00'));
  assert.equal(q.pricing.endDate, '2026-11-17');
  assert.equal(q.pricing.days, 2);
});

test('extra km: 8 PM pickup, Next-Day Return, 450 km = ₹6,780 + 50 × ₹14 = ₹7,480', () => {
  const q = quote('2026-11-16T20:00:00', 'next', { days: 2, km: 225, min: 200 });
  assert.equal(q.pricing.quotedKm, 450);
  assert.equal(q.pricing.packagePaise / 100, 7480);
  // GST is added on top (this tariff has no Fare GST rule saved): 7,480 + 5%.
  assert.equal(q.fare.subtotal, 7480);
  assert.equal(q.fare.total, 7854);
});

test('Morning Return: ₹4,500 test fare, 250 km, 9:00 AM strict cutoff, only for 6:46–11:45 PM pickups', () => {
  const p = plan('2026-11-16T20:00:00', { days: 2, km: 100, min: 120 });
  assert.deepEqual(ids(p), ['morning', 'next']);
  const m = quote('2026-11-16T20:00:00', 'morning', { days: 2, km: 100, min: 120 });
  assert.equal(m.pricing.packagePaise / 100, 4500);
  assert.equal(m.pricing.timeBased.morningCutoffMs, IST('2026-11-17T09:00:00'));
  // v8: offered from 3:00 PM (not before), only for round trips of at most 250 km, and only when the drive can be back by 9 AM.
  assert.deepEqual(ids(plan('2026-11-16T14:59:00', { days: 2 })), ['next']);
  assert.deepEqual(ids(plan('2026-11-16T15:00:00', { days: 2 })), ['morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-16T17:00:00', { days: 2 })), ['morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-16T20:00:00', { days: 2, km: 400, min: 540 })), ['next']);
  assert.deepEqual(ids(plan('2026-11-16T20:00:00', { days: 2, km: 125, min: 150 })), ['morning', 'next']); // exactly 250 km
  assert.deepEqual(ids(plan('2026-11-16T20:00:00', { days: 2, km: 126, min: 150 })), ['next']); // 252 km
  assert.deepEqual(ids(plan('2026-11-16T23:50:00', { days: 2 })), ['morning', 'next']);
  assert.deepEqual(ids(plan('2026-11-16T20:00:00', { days: 3 })), ['next']);
});

test('Morning Return finished by 9 AM stays at ₹4,500', () => {
  const q = quote('2026-11-16T20:00:00', 'morning', { days: 2, km: 100, min: 120 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 240, startMs: IST('2026-11-16T20:05:00'), endMs: IST('2026-11-17T08:30:00') });
  assert.equal(f.customerPackagePaise / 100, 4500);
  assert.equal(f.extraKm, 0);
  assert.equal(f.timeBased.upgraded, false);
  assert.equal(f.partnerPaise / 100, 4050);
});

test('Morning Return past 9 AM upgrades to Next-Day Return by original pickup: 8 PM → ₹6,780 / 400 km, package increase ₹2,280', () => {
  const q = quote('2026-11-16T20:00:00', 'morning', { days: 2, km: 100, min: 120 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 300, endMs: IST('2026-11-17T09:20:00') });
  assert.equal(f.timeBased.upgraded, true);
  assert.equal(f.timeBased.label, 'Next-Day Return');
  assert.equal(f.customerPackagePaise / 100, 6780);
  assert.equal(f.customerPackagePaise / 100 - 4500, 2280);
  assert.equal(f.extraKm, 0); // extra km is recalculated on the new 400 km inclusion
  assert.equal(f.fare.subtotal, 6780);
  assert.equal(f.timeBased.coverageExceeded, false);
});

test('upgraded Morning Return: extra km counts from the NEW 400 km inclusion, old extra-km charge is not kept', () => {
  const q = quote('2026-11-16T20:00:00', 'morning', { days: 2, km: 125, min: 120 }); // 250 km estimate: exactly the Morning Return inclusion (a longer trip is not offered it)
  assert.equal(q.pricing.packagePaise / 100, 4500);
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 450, endMs: IST('2026-11-17T10:00:00') });
  assert.equal(f.extraKm, 50);
  assert.equal(f.fare.subtotal, 6780 + 50 * 14);
});

test('a 10 PM+ Morning Return that overruns upgrades to the ₹6,080 / 350 km package', () => {
  const q = quote('2026-11-16T22:30:00', 'morning', { days: 2, km: 80, min: 100 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 200, endMs: IST('2026-11-17T09:01:00') });
  assert.equal(f.customerPackagePaise / 100, 6080);
  assert.equal(f.includedKm ?? f.timeBased.includedKm, 350);
});

test('same-day: a trip outgrowing the 5-hour slab bills the 8-hour slab, then the full day — never lower', () => {
  const q = quote('2026-11-17T09:00:00', 'same:five', { km: 40, min: 60 });
  assert.equal(q.pricing.packagePaise / 100, 2080);
  const within = T.finalizeFare({ pricing: q.pricing, totalKm: 100, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T13:30:00') });
  assert.equal(within.customerPackagePaise / 100, 2080);
  const over5h = T.finalizeFare({ pricing: q.pricing, totalKm: 100, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T14:30:00') });
  assert.equal(over5h.customerPackagePaise / 100, 2780);
  assert.equal(over5h.timeBased.upgraded, true);
  const over8h = T.finalizeFare({ pricing: q.pricing, totalKm: 100, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T17:30:00') });
  assert.equal(over8h.customerPackagePaise / 100, 4000);
  const over150 = T.finalizeFare({ pricing: q.pricing, totalKm: 151, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T12:00:00') });
  assert.equal(over150.customerPackagePaise / 100, 4000);
  // A customer who booked the 8-hour package is never downgraded because the trip was quick.
  const q8 = quote('2026-11-17T09:00:00', 'same:eight', { km: 40, min: 60 });
  assert.equal(T.finalizeFare({ pricing: q8.pricing, totalKm: 60, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T10:00:00') }).customerPackagePaise / 100, 2780);
});

test('exactly 150 km never stays on the 5-hour package; it moves to the 8-hour', () => {
  const q = quote('2026-11-17T09:00:00', 'same:five', { km: 40, min: 60 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 150, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T12:00:00') });
  assert.equal(f.customerPackagePaise / 100, 2780);
  assert.equal(f.extraKm, 0);
});

test('same-day: km beyond the package inclusion is billed at ₹14 (5-hour: 130 km = ₹2,080 + 30 × ₹14)', () => {
  const q = quote('2026-11-17T09:00:00', 'same:five', { km: 40, min: 60 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 130, startMs: IST('2026-11-17T09:00:00'), endMs: IST('2026-11-17T13:00:00') });
  assert.equal(f.extraKm, 30);
  assert.equal(f.fare.subtotal, 2080 + 30 * 14);
  assert.equal(f.partnerPaise / 100, 1870 + 30 * 12.6);
});

test('a late-time upgrade: 5-hour at 6 PM cannot move to the 8-hour slab (no room before 11:45 PM) — it becomes the full day', () => {
  const q = quote('2026-11-17T18:00:00', 'same:five', { km: 40, min: 60 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 100, startMs: IST('2026-11-17T18:00:00'), endMs: IST('2026-11-17T23:30:00') });
  assert.equal(f.customerPackagePaise / 100, 4000);
});

test('a Next-Day Return running past 11:45 PM of the end date is flagged for fare review, not silently charged', () => {
  const q = quote('2026-11-16T12:00:00', 'next', { days: 2, km: 100 });
  const f = T.finalizeFare({ pricing: q.pricing, totalKm: 400, endMs: IST('2026-11-18T01:00:00') });
  assert.equal(f.timeBased.coverageExceeded, true);
  assert.equal(f.customerPackagePaise / 100, 8000);
});

test('3 days = first-day slab + two Full Days: ₹12,000 / ₹10,780 / ₹10,080 and the last calendar date 11:45 PM', () => {
  const a = quote('2026-11-16T12:00:00', 'next', { days: 3, km: 100 });
  assert.equal(a.pricing.timeBased.base.farePaise / 100, 12000);
  assert.equal(a.pricing.timeBased.base.includedKm, 750);
  assert.deepEqual(a.pricing.timeBased.dayKm, [250, 250, 250]);
  assert.equal(a.pricing.days, 3);
  assert.equal(a.pricing.endDate, '2026-11-18');
  assert.equal(a.pricing.timeBased.coverageEndMs, IST('2026-11-18T23:45:00'));
  const b = quote('2026-11-16T20:00:00', 'next', { days: 3, km: 100 });
  assert.equal(b.pricing.timeBased.base.farePaise / 100, 10780);
  assert.equal(b.pricing.timeBased.base.includedKm, 650);
  const c = quote('2026-11-16T22:20:00', 'next', { days: 3, km: 100 });
  assert.equal(c.pricing.timeBased.base.farePaise / 100, 10080);
  assert.equal(c.pricing.timeBased.base.includedKm, 600);
});

test('3 days, 10:20 PM pickup, 700 km: ₹10,080 + 100 × ₹14 = ₹11,480', () => {
  const q = quote('2026-11-16T22:20:00', 'next', { days: 3, km: 350, min: 400 });
  assert.equal(q.pricing.quotedKm, 700);
  assert.equal(q.pricing.packagePaise / 100, 11480);
});

test('3+ days protection: a customer who chose 3 days is never quoted fewer, whatever the pickup time or package', () => {
  for (const at of ['2026-11-16T12:00:00', '2026-11-16T16:00:00', '2026-11-16T23:00:00']) {
    const p = plan(at, { days: 3 });
    assert.ok(p.options.every((o) => o.days === 3), at);
    assert.ok(!ids(p).includes('morning'));
  }
});

test('beyond the configured maximum days is a custom quote, never priced', () => {
  assert.throws(() => plan('2026-11-16T12:00:00', { days: 31 }), (e) => e.code === 'custom-quote');
});

test('an unavailable package id is refused', () => {
  assert.throws(() => quote('2026-11-17T16:30:00', 'same:eight'), (e) => e.code === 'package-unavailable');
});

test('a class with no time-based amounts keeps calendar pricing (not available here)', () => {
  assert.equal(T.timeBasedContext(cfg, 'crysta'), null);
});

test('IST minute helpers handle UTC dates correctly', () => {
  assert.equal(TB.istMinutes(IST('2026-11-17T00:00:00')), 0);
  assert.equal(TB.istMinutes(IST('2026-11-17T23:45:00')), 1425);
  assert.equal(TB.istInstant(IST('2026-11-16T20:00:00'), 1, 540), IST('2026-11-17T09:00:00'));
});

// ── Through the real pricing path (priceBooking): GST handling, channels and the stored snapshot ──
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const category = mapCategory('sedan', { name: 'Sedan', status: 'Active', seatingCapacity: 4, fare: { baseFare: 70, baseKm: 2, perKmRate: 16, minimumFare: 100 } });
const pickup = { id: 'pin', name: 'Theni', address: 'Theni', lat: 10.0104, lng: 77.4768, type: 'other' };
const drop = { id: 'pin', name: 'Madurai', address: 'Madurai', lat: 9.9195, lng: 78.1193, type: 'other' };
const price = (o = {}) => priceBooking({
  category, route: { distanceKm: o.km ?? 40, durationMin: o.min ?? 60 }, tripType: 'Round Trip', pickup, drop, pickupAt: new Date(IST(o.pickup ?? '2026-11-17T09:00:00')), tripEndAt: null,
  tariff: o.tariff ?? cfg, adjustment: null, customerChannel: true, tripDays: o.days ?? 1, timePackage: o.pkg, ...(o.extra ?? {}),
});

test('customer price: the entered package amount is the GST-inclusive total (₹4,000 full day, ₹2,080 five hours)', () => {
  assert.equal(price({ pkg: 'same:full' }).fare.total, 4000);
  assert.equal(price({ pkg: 'same:five' }).fare.total, 2080);
  assert.equal(price({ pkg: 'same:full' }).pricing.gstInFare, true);
});

test('customer price: with a GST-excluded rule the 5% is added on top', () => {
  const rule = { rate: 0.05, mode: 'excluded', classification: 'passenger', supplierState: '33', reference: 'GST-2026' };
  const t = T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 7, enabled: true, roundTrip: { maxDays: 30, timeBased: { enabled: true }, classes: { sedan } }, roundTripExtras: { sedan: { extraKmRate: 14, waitingPerHour: 150 } }, fareGst: { common: { 'Round Trip': { default: rule } } } });
  assert.equal(price({ tariff: t, pkg: 'same:full', extra: { boardingState: '33' } }).fare.total, 4200);
});

test('customer price: 3 days is priced by the multi-day slab; beyond the maximum days is a custom quote; the 3-day office booking keeps calendar pricing', () => {
  assert.equal(price({ days: 3, pkg: 'next', pickup: '2026-11-17T12:00:00' }).fare.total, 12000);
  assert.throws(() => price({ days: 31, pkg: undefined }), (e) => e.details?.code === 'custom-quote');
  const office = priceBooking({ category, route: { distanceKm: 40, durationMin: 60 }, tripType: 'Round Trip', pickup, drop, pickupAt: new Date(IST('2026-11-17T09:00:00')), tripEndAt: new Date(IST('2026-11-19T20:00:00')), tariff: cfg, adjustment: null });
  assert.equal(office.pricing.model, 'round_trip_calendar');
  assert.equal(office.pricing.days, 3);
});

test('no package named: the cheapest package that fits is quoted, and an old client sending only a return date still prices', () => {
  const p = price({});
  assert.equal(p.pricing.timeBased.packageId, 'same:five');
  const old = priceBooking({ category, route: { distanceKm: 40, durationMin: 60 }, tripType: 'Round Trip', pickup, drop, pickupAt: new Date(IST('2026-11-17T09:00:00')), tripEndAt: new Date(IST('2026-11-17T20:00:00')), tariff: cfg, adjustment: null, customerChannel: true });
  assert.equal(old.pricing.model, 'round_trip_time_based');
});

test('stored snapshot → final fare: Morning Return upgrade survives GST-inclusive pricing and keeps the partner payout', () => {
  const q = price({ pickup: '2026-11-16T20:00:00', days: 2, km: 100, min: 120, pkg: 'morning' });
  assert.equal(q.fare.total, 4500);
  const done = T.finalizeFare({ pricing: q.pricing, totalKm: 300, endMs: IST('2026-11-17T09:30:00') });
  assert.equal(done.fare.total, 6780);
  assert.equal(done.timeBased.upgraded, true);
  // Upgraded payout = the 8-hour payout (₹2,500) + one full day (12.6 × 250 + ₹400 = ₹3,550); no extra km on the 400 km inclusion.
  assert.equal(done.partnerPaise / 100, 6050);
});
