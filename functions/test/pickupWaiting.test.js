const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { pickupWaitedMinutes, pickupWaitFields } = require('../lib/domain/pickupWaiting');
const { computeExtraCharges } = require('../lib/domain/extraCharges');

const at = (hhmm) => Date.parse(`2026-11-08T${hhmm}:00+05:30`);
const ts = (ms) => ({ toMillis: () => ms });

test('the driver reached at 4:00 PM for a 4:00 PM pickup and the trip started at 5:00 PM: the customer kept the driver waiting 60 minutes', () => {
  assert.equal(pickupWaitedMinutes(at('16:00'), at('16:00'), at('17:00')), 60);
});

test('a driver who arrives early waits from the booked time, not from when they arrived', () => {
  assert.equal(pickupWaitedMinutes(at('15:30'), at('16:00'), at('17:00')), 60);
  assert.equal(pickupWaitedMinutes(at('15:30'), at('16:00'), at('15:50')), 0);
});

test('a driver who arrives late waits from their own arrival', () => {
  assert.equal(pickupWaitedMinutes(at('16:20'), at('16:00'), at('16:50')), 30);
});

test('whole minutes only, never negative, and nothing is measured without a "reached pickup" tap', () => {
  assert.equal(pickupWaitedMinutes(at('16:00'), at('16:00'), at('16:00') + 59_000), 0);
  assert.equal(pickupWaitedMinutes(at('16:00'), at('16:00'), at('16:00') + 119_000), 1);
  assert.equal(pickupWaitedMinutes(at('17:00'), at('16:00'), at('16:00')), 0);
  assert.equal(pickupWaitedMinutes(null, at('16:00'), at('17:00')), null);
});

const booking = (patch = {}) => ({ pickupAt: new Date(at('16:00')), reachedPickupAt: ts(at('16:00')), ...patch });

test('starting the trip records the wait and a usage revision holding it for finance to approve', () => {
  const f = pickupWaitFields(booking(), at('17:00'), 'STAMP');
  assert.equal(f.pickupWait.minutes, 60);
  assert.equal(f.extraUsage.status, 'submitted');
  assert.equal(f.extraUsage.revision, 1);
  assert.deepEqual(f.extraUsage.usage.stops, [{ stopId: 'pickup', waitedMinutes: 60 }]);
  assert.equal(f.extraUsage.usage.hill, false);
  assert.equal(f.extraUsage.usage.carrier, false);
});

test('hill travel and the roof carrier follow what the customer booked', () => {
  const f = pickupWaitFields(booking({ pricing: { hillStation: { amount: 500 }, bookingAddOns: { roofCarrier: true } } }), at('17:00'), 'S');
  assert.equal(f.extraUsage.usage.hill, true);
  assert.equal(f.extraUsage.usage.carrier, true);
  const g = pickupWaitFields(booking({ tripExtras: { hillTravel: true, roofCarrier: true } }), at('17:00'), 'S');
  assert.equal(g.extraUsage.usage.hill, true);
  assert.equal(g.extraUsage.usage.carrier, true);
});

test('usage somebody already recorded is never replaced, and no tap means nothing is written', () => {
  const f = pickupWaitFields(booking({ extraUsage: { revision: 2, status: 'submitted' } }), at('17:00'), 'S');
  assert.equal(f.extraUsage, undefined);
  assert.equal(f.pickupWait.minutes, 60);
  assert.deepEqual(pickupWaitFields({ pickupAt: new Date(at('16:00')) }, at('17:00'), 'S'), {});
});

// What approval then bills: free minutes per stop, rounding up, the customer's waiting rate, GST.
const snapshot = { schema: 1, version: 1, tariffVersion: 1, categoryId: 'suv', freeWaitingMinutes: 30, waitingRoundingMinutes: 15, roundingScope: 'per_stop', taxTreatment: 'tariff_gst',
  customer: { waitingPerHourPaise: 20000, hillPaise: 0, carrierPaise: 0 }, partner: { waitingPerHourPaise: 12000, hillPaise: 0, carrierPaise: 0 } };

test('4:00 PM pickup, driver there at 4:00 PM, customer boards at 5:00 PM: 30 free + 30 billed minutes at the waiting rate, plus GST', () => {
  const f = pickupWaitFields(booking(), at('17:00'), 'S');
  const c = computeExtraCharges(snapshot, snapshot.partner, f.extraUsage.usage, 0.05);
  assert.deepEqual(c.blocked, []);
  assert.equal(c.waiting.chargeableMinutes, 30);
  assert.equal(c.waiting.billedMinutes, 30);
  assert.equal(c.customer.waitingPaise, 10000);
  assert.equal(c.customerGstPaise, 500);
  assert.equal(c.customerTotalPaise, 10500);
  assert.equal(c.partner.waitingPaise, 6000);
});

test('a customer inside the free 30 minutes pays nothing for waiting', () => {
  const f = pickupWaitFields(booking(), at('16:25'), 'S');
  const c = computeExtraCharges(snapshot, snapshot.partner, f.extraUsage.usage, 0.05);
  assert.equal(c.customer.waitingPaise, 0);
  assert.equal(c.customerTotalPaise, 0);
});
