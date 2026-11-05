const test = require('node:test');
const assert = require('node:assert/strict');
const { multicityBookingAmounts, multicityFingerprint } = require('../lib/domain/multicitySnapshot');
const { quoteMulticity, finalizeFare } = require('../lib/domain/tariff');
const { splitPricing } = require('../lib/domain/pricingPrivacy');
const { fareGstForScope } = require('../lib/fareGstPricing');

const rates = { customerRate: 17, partnerRate: 13, customerBata: 400, partnerBata: 300, minKmPerDay: 250, extraKmRate: 20 };
const pickupMs = Date.parse('2026-11-10T08:00:00+05:30');
const endMs = Date.parse('2026-11-11T18:00:00+05:30');
const meta = { tariffVersion: 8, tariffClass: 'sedan', brand: 'people_taxi', pickupMs, endMs, durationMin: 600, gst: null };

for (const included of [false, true]) test(`Multicity ${included ? 'inclusive' : 'exclusive'} quote survives conversion and trip-end billing`, () => {
  const q = quoteMulticity({ rates, totalKm: 420, days: 2, gstRate: 0.05, gstIncluded: included });
  const { fare, pricing } = multicityBookingAmounts(q, meta);
  assert.equal(fare.total * 100, q.totalPaise);
  assert.equal(Math.round((fare.distanceFare + fare.driverAllowance) * 100), q.taxablePaise);
  const final = finalizeFare({ pricing, totalKm: 420, endMs });
  assert.equal(final.fare.total, fare.total);
  assert.equal(final.partnerPaise, q.partnerPaise);
  const { pub, priv } = splitPricing(pricing);
  assert.equal(pub.partner, null);
  assert.equal(priv.partner.basePaise, q.partnerPaise);
});

test('route identity binds ordered stops, map positions, dates and customer brand', () => {
  const p = (id, lat) => ({ id, name: id, address: id, lat, lng: 78 });
  const e = { brand: 'nesam', customerId: 'rider', pickupPoint: p('a', 10), dropPoint: p('d', 13), stops: [p('b', 11), p('c', 12)], pickupAt: { toMillis: () => pickupMs }, tripEndAt: { toMillis: () => endMs } };
  const hash = multicityFingerprint(e);
  assert.notEqual(hash, multicityFingerprint({ ...e, stops: [...e.stops].reverse() }));
  assert.notEqual(hash, multicityFingerprint({ ...e, brand: 'people_taxi' }));
  assert.notEqual(hash, multicityFingerprint({ ...e, tripEndAt: { toMillis: () => endMs + 60000 } }));
  assert.equal(hash, multicityFingerprint({ ...e, status: 'Customer accepted', estimate: 20000 }));
});

test('Multicity GST uses brand pickup-state policy, preserves shared precedence and rejects an unverified state', () => {
  const policy = rate => ({ rate, mode: 'excluded', classification: 'passenger', supplierState: '33', reference: 'approved policy' });
  const tariff = { fareGst: { common: { Multicity: { default: policy(.05), states: { '29': policy(.12) } } }, people_taxi: { Multicity: { states: { '33': policy(.18) } } } } };
  assert.equal(fareGstForScope({ tariff, brand: 'people_taxi', service: 'Multicity', boardingState: '33' }).rate, .18);
  assert.equal(fareGstForScope({ tariff, brand: 'people_taxi', service: 'Multicity', boardingState: '29' }).rate, .12);
  assert.throws(() => fareGstForScope({ tariff, brand: 'people_taxi', service: 'Multicity', boardingState: '' }), /verified pickup state/);
});
