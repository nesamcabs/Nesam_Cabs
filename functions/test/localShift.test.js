// Local duty ("continuous moving") rules: which orders a duty serves, how many a driver may hold, the duty window, the
// rental clock and usage record, and the duty totals.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/domain/localShift');

test('local mode: rentals and in-city pickup & drop are recognised, other services are not', () => {
  assert.equal(L.localModeOf({ tripType: 'Local Rental', service: 'Local Rental' }), 'rental');
  assert.equal(L.localModeOf({ tripType: 'One Way', pricing: { model: 'rental_package' } }), 'rental');
  assert.equal(L.localModeOf({ tripType: 'One Way', pricing: { model: 'local_pickup_drop' }, distanceKm: 12 }), 'pickup_drop');
  assert.equal(L.localModeOf({ tripType: 'One Way', service: 'Pickup & Drop', distanceKm: 0 }), 'pickup_drop');
  assert.equal(L.localModeOf({ tripType: 'One Way', service: 'One Way', distanceKm: 18 }), 'pickup_drop');
  assert.equal(L.localModeOf({ tripType: 'One Way', service: 'One Way', distanceKm: 140 }), null);
  assert.equal(L.localModeOf({ tripType: 'Airport Taxi', service: 'Airport Taxi', distanceKm: 20 }), null);
  assert.equal(L.localModeOf({ tripType: 'Round Trip', distanceKm: 20 }), null);
  assert.equal(L.localModeOf({ tripType: 'One Way', service: 'Multicity', distanceKm: 20 }), null);
});

test('services list keeps only known modes, in a fixed order', () => {
  assert.deepEqual(L.servicesOf(['pickup_drop', 'rental', 'x']), ['rental', 'pickup_drop']);
  assert.deepEqual(L.servicesOf('rental'), []);
});

test('duty window: length, order, past and plan-ahead limits', () => {
  const now = Date.parse('2026-11-14T08:00:00+05:30');
  const h = 3600000;
  assert.equal(L.shiftWindowProblem(now, now + 8 * h, now), '');
  assert.match(L.shiftWindowProblem(now, now, now), /after it starts/);
  assert.match(L.shiftWindowProblem(now, now + 30 * 60000, now), /at least 1 hour/);
  assert.match(L.shiftWindowProblem(now, now + 17 * h, now), /at most 16 hours/);
  assert.match(L.shiftWindowProblem(now - 5 * h, now - h, now), /already passed/);
  assert.match(L.shiftWindowProblem(now - 3 * h, now + 2 * h, now), /start time has already passed/);
  assert.equal(L.shiftWindowProblem(now - 3 * h, now + 2 * h, now, false), '');
  assert.match(L.shiftWindowProblem(now + 8 * 86400000, now + 8 * 86400000 + 2 * h, now), /7 days/);
});

test('queue: a current order plus one next order, and an hourly rental keeps the car', () => {
  const pd = (status, subStatus) => ({ id: status + subStatus, mode: 'pickup_drop', status, subStatus });
  assert.equal(L.queueProblem([], 'pickup_drop'), '');
  assert.equal(L.queueProblem([], 'rental'), '');
  assert.equal(L.queueProblem([pd('Ongoing', 'Trip Started')], 'pickup_drop'), '');
  assert.equal(L.queueProblem([pd('Ongoing', 'Trip Started')], 'rental'), '');
  assert.match(L.queueProblem([pd('Ongoing', 'Trip Started'), pd('Assigned', 'Not Started')], 'pickup_drop'), /current order and a next order/);
  assert.match(L.queueProblem([{ id: 'r', code: 'BK1', mode: 'rental', status: 'Ongoing', subStatus: 'Trip Started' }], 'pickup_drop'), /Finish your hourly rental BK1/);
  assert.match(L.queueProblem([pd('Assigned', 'Not Started')], 'rental'), /Start your next order/);
});

test('rental clock counts used, left and overtime from the trip start', () => {
  const start = Date.parse('2026-11-14T10:00:00+05:30');
  const c = L.rentalClock(start, 4, start + 90 * 60000);
  assert.equal(c.started, true);
  assert.equal(c.remainingMs, 150 * 60000);
  assert.equal(c.overtimeMs, 0);
  assert.equal(Math.round(c.progress * 100), 38);
  const over = L.rentalClock(start, 4, start + 4 * 3600000 + 25 * 60000);
  assert.equal(over.remainingMs, 0);
  assert.equal(over.overtimeMs, 25 * 60000);
  assert.equal(L.rentalClock(null, 4, start).started, false);
});

test('rental usage is recorded for the office, never billed', () => {
  const b = { tripType: 'Local Rental', pricing: { model: 'rental_package', rentalHours: 4, extraHourRatePaise: 25000, includedKm: 40 } };
  const start = Date.parse('2026-11-14T10:00:00+05:30');
  const u = L.rentalUsageOf(b, start, start + (4 * 60 + 70) * 60000);
  assert.deepEqual(u, { schema: 1, packageHours: 4, usedMinutes: 310, overtimeMinutes: 70, extraHours: 2, extraHourRate: 250, indicativeExtra: 500, includedKm: 40 });
  assert.equal(L.rentalUsageOf(b, start, start + 3 * 3600000).extraHours, 0);
  assert.equal(L.rentalUsageOf({ tripType: 'One Way', distanceKm: 10 }, start, start + 3600000), null);
  assert.equal(L.rentalUsageOf(b, null, start), null);
});

test('duty totals come from the duty bookings: completed money, cash with the driver, cancellations apart', () => {
  const t = L.shiftTotals([
    { status: 'Completed', tripType: 'One Way', distanceKm: 8, totalKm: 9.5, fare: 240, vendorPayout: 190, tollCharges: 0, paymentSummary: { totalPaid: 240, balanceDue: 0, partnerCashHeld: 240, companyCollected: 0 } },
    { status: 'Completed', tripType: 'Local Rental', fare: 1550, vendorPayout: 1200, totalKm: 52, paymentSummary: { totalPaid: 1550, balanceDue: 0, partnerCashHeld: 0, companyCollected: 1550 }, rentalUsage: { usedMinutes: 250, overtimeMinutes: 10 } },
    { status: 'Ongoing', tripType: 'One Way', distanceKm: 6, fare: 200 },
    { status: 'Cancelled', tripType: 'One Way', distanceKm: 6, fare: 200 },
  ]);
  assert.equal(t.orders, 3);
  assert.equal(t.completed, 2);
  assert.equal(t.active, 1);
  assert.equal(t.cancelled, 1);
  assert.equal(t.rental, 1);
  assert.equal(t.pickupDrop, 2);
  assert.equal(t.km, 61.5);
  assert.equal(t.fare, 1790);
  assert.equal(t.payout, 1390);
  assert.equal(t.collected, 1790);
  assert.equal(t.cashInHand, 240);
  assert.equal(t.paidOnline, 1550);
  assert.equal(t.rentalMinutes, 250);
  assert.equal(t.overtimeMinutes, 10);
});

test('duty minutes leave out breaks, including one still open', () => {
  const s = Date.parse('2026-11-14T09:00:00+05:30');
  assert.equal(L.dutyMinutes(s, null, 15 * 60000, null, s + 3 * 3600000), 165);
  assert.equal(L.dutyMinutes(s, null, 0, s + 2 * 3600000, s + 3 * 3600000), 120);
  assert.equal(L.dutyMinutes(null, null, 0, null, s), 0);
});

test('radius is kept inside the allowed range', () => {
  assert.equal(L.radiusOf(undefined), L.RADIUS_DEFAULT_KM);
  assert.equal(L.radiusOf(1), L.RADIUS_MIN_KM);
  assert.equal(L.radiusOf(500), L.RADIUS_MAX_KM);
  assert.equal(L.radiusOf(22.4), 22);
});
