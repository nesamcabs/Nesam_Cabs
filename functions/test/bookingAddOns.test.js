const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const { withBookingAddOns, bookingAddOnsOf } = require('../lib/domain/bookingAddOns');
const { withFareGst } = require('../lib/domain/gst');
const T = require('../lib/domain/tariff');

const category = () => ({ ...mapCategory('suv', { name: 'SUV', seatingCapacity: 6, fare: {
  perKmRate: 18, carrierCharge: 300, petCharge: 200,
} }), tariffClass: 'suv' });
const input = (patch = {}) => ({
  category: category(), route: { distanceKm: 160, durationMin: 180 }, tripType: 'One Way',
  pickup: { id: 'pin', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.08, lng: 80.27, type: 'other' },
  drop: { id: 'pin', name: 'Pondicherry', address: 'Pondicherry', lat: 11.94, lng: 79.8, type: 'other' },
  pickupAt: new Date('2026-11-08T10:00:00+05:30'), tripEndAt: null,
  tariff: T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 1, enabled: true, petCharge: 200, fareGst: { common: { 'One Way': { default: { supplierState: '33', rate: 0.05, mode: 'excluded', classification: 'passenger', reference: 'Approved test policy' } } } } }),
  adjustment: null, ...patch,
});

test('no selection leaves the quoted fare unchanged', () => {
  const base = priceBooking(input());
  assert.deepEqual(priceBooking(input({ addOns: { roofCarrier: false, pets: false } })), base);
});

for (const brand of ['nesam', 'people_taxi', 'onewaycarrentals']) {
  test(`${brand}: selected carrier and pets are billed at category rates plus GST`, () => {
    const base = priceBooking(input({ brand }));
    const billed = priceBooking(input({ brand, addOns: { roofCarrier: true, pets: true, carrierCharge: 1, petCharge: 1 } }));
    assert.equal(billed.fare.total, Math.round((base.fare.total + 500 * (1 + base.fare.gstRate)) * 100) / 100);
    assert.equal(billed.fare.addOns.carrierCharge, 300);
    assert.equal(billed.fare.addOns.petCharge, 200);
    assert.equal(billed.breakup.packageTotal, billed.fare.total);
    assert.equal(billed.breakup.lines.filter(l => l.key === 'carrierAddon').length, 1);
    assert.equal(billed.breakup.lines.filter(l => l.key === 'petAddon').length, 1);
    assert.equal(billed.breakup.lines.some(l => l.key === 'carrier'), false);
    assert.equal(billed.fare.gst, Math.round(billed.fare.taxableAmount * billed.fare.gstRate * 100) / 100);
  });
}

test('a single selected add-on never bills the other', () => {
  const carrier = priceBooking(input({ addOns: { roofCarrier: true, pets: false } }));
  const pets = priceBooking(input({ addOns: { roofCarrier: false, pets: true } }));
  assert.equal(carrier.fare.addOns.petCharge, 0);
  assert.equal(pets.fare.addOns.carrierCharge, 0);
  assert.equal(carrier.breakup.lines.some(l => l.key === 'petAddon'), false);
});

test('GST-inclusive add-on prices stay exact and tax split reconciles', () => {
  const base = priceBooking(input());
  const tax = { ...base.fare.gstDetails, mode: 'included', rate: 0.05, split: 'CGST + SGST' };
  const inclusive = { ...base, fare: withFareGst(base.fare, tax, true) };
  const billed = withBookingAddOns(inclusive, { roofCarrier: true, pets: true }, category().fare.extras, 200);
  assert.equal(billed.fare.total, inclusive.fare.total + 500);
  assert.equal(Math.round((billed.fare.taxableAmount + billed.fare.gst) * 100), Math.round(billed.fare.total * 100));
  assert.equal(Math.round((billed.fare.gstDetails.cgst + billed.fare.gstDetails.sgst) * 100), Math.round(billed.fare.gst * 100));
});

test('final-distance billing retains the quoted add-ons after the common pet rate changes', () => {
  const i = input({ addOns: { roofCarrier: true, pets: true } });
  const quoted = priceBooking(i);
  i.tariff.petCharge = 900;
  assert.equal(priceBooking(i).fare.addOns.petCharge, 900);
  const baseFinal = T.finalizeFare({ pricing: { ...quoted.pricing, bookingAddOns: undefined }, totalKm: 190, endMs: Date.parse('2026-11-08T18:00:00+05:30') });
  const final = T.finalizeFare({ pricing: quoted.pricing, totalKm: 190, endMs: Date.parse('2026-11-08T18:00:00+05:30') });
  assert.equal(final.fare.addOns.petCharge, 200);
  assert.equal(final.fare.addOns.carrierCharge, 300);
  assert.equal(final.fare.total, Math.round((baseFinal.fare.total + 500 * (1 + baseFinal.fare.gstRate)) * 100) / 100);
});

test('only explicit boolean selections are accepted', () => {
  assert.deepEqual(bookingAddOnsOf({ roofCarrier: 'true', pets: 1 }), { roofCarrier: false, pets: false });
  assert.deepEqual(bookingAddOnsOf(null), { roofCarrier: false, pets: false });
});

test('a prepaid carrier is not billed twice while its partner reimbursement remains payable', () => {
  const { ratesAfterPrepaidAddOns } = require('../lib/domain/bookingAddOns');
  const { computeExtraCharges } = require('../lib/domain/extraCharges');
  const snapshot = { schema: 1, version: 1, tariffVersion: 1, categoryId: 'suv', freeWaitingMinutes: 10,
    waitingRoundingMinutes: 5, roundingScope: 'per_stop', taxTreatment: 'tariff_gst', customer: { carrierPaise: 30000 }, partner: { carrierPaise: 9000 } };
  const billing = ratesAfterPrepaidAddOns(snapshot, true);
  const calc = computeExtraCharges(billing, snapshot.partner, { stops: [], hill: false, carrier: true }, 0.05);
  assert.deepEqual(calc.blocked, []);
  assert.equal(calc.customer.carrierPaise, 0);
  assert.equal(calc.customerTotalPaise, 0);
  assert.equal(calc.partner.carrierPaise, 9000);
  assert.equal(snapshot.customer.carrierPaise, 30000);
});

test('GST-inclusive final-distance billing retains both fees exactly once', () => {
  const i = input();
  delete i.tariff.fareGst;
  const quoted = priceBooking({ ...i, addOns: { roofCarrier: true, pets: true } });
  const args = { totalKm: 190, endMs: Date.parse('2026-11-08T18:00:00+05:30') };
  const base = T.finalizeFare({ ...args, pricing: { ...quoted.pricing, bookingAddOns: undefined } });
  const billed = T.finalizeFare({ ...args, pricing: quoted.pricing });
  assert.equal(billed.fare.total, base.fare.total + 500);
  assert.equal(billed.fare.addOns.petCharge, quoted.fare.addOns.petCharge);
});

test('pet travel uses one common rate and ignores legacy category pet prices', () => {
  const first = input({ addOns: { roofCarrier: false, pets: true } });
  const second = input({ addOns: { roofCarrier: false, pets: true } });
  first.category.fare.extras.petCharge = 9999;
  second.category.fare.extras.petCharge = 1;
  assert.equal(priceBooking(first).fare.addOns.petCharge, 200);
  assert.equal(priceBooking(second).fare.addOns.petCharge, 200);
  delete first.tariff.petCharge;
  assert.equal(priceBooking(first).fare.addOns.petCharge, 0);
});
