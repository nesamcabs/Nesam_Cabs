const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking, addOnRatesOf } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const { parseNightAllowance, nightAllowancePartnerFor } = require('../lib/domain/nightAllowance');
const T = require('../lib/domain/tariff');

// Roof carrier, pet travel and night allowance: what the customer pays and what the partner gets, set per vehicle in the fare table
// (the night allowance on its own card). The customer amount goes into the total; the partner amount goes into the partner payout.

const policy = { common: { 'One Way': { default: { supplierState: '33', rate: 0.05, mode: 'excluded', classification: 'passenger', reference: 'Approved test policy' } } } };
const category = () => ({ ...mapCategory('suv', { name: 'SUV', seatingCapacity: 6, fare: { perKmRate: 18, carrierCharge: 300 } }), tariffClass: 'suv' });
const tariff = (overrides, extra = {}) => T.parseTariffConfig({ ...T.CONFIRMED_TARIFF_V2, version: 1, enabled: true, petCharge: 200, fareGst: policy, ...(overrides ? { brandOverrides: overrides } : {}), ...extra });
const input = (patch = {}) => ({
  category: category(), route: { distanceKm: 160, durationMin: 180 }, tripType: 'One Way',
  pickup: { id: 'pin', name: 'Chennai', address: 'Chennai, Tamil Nadu', lat: 13.08, lng: 80.27, type: 'other' },
  drop: { id: 'pin', name: 'Pondicherry', address: 'Pondicherry', lat: 11.94, lng: 79.8, type: 'other' },
  pickupAt: new Date('2026-11-08T10:00:00+05:30'), tripEndAt: null, tariff: tariff(null), adjustment: null, brand: 'nesam', ...patch,
});
const cents = (v) => Math.round(v * 100) / 100;
const table = (patch) => ({ common: { 'One Way': { suv: patch } } });

test('with nothing typed in the fare table the older amounts apply: category carrier, common pet, no partner pet', () => {
  const rates = addOnRatesOf(input());
  assert.deepEqual(rates, { carrier: 300, pet: 200, partnerPet: 0 });
});

test('fare table amounts replace the older ones, and a brand value beats the shared one', () => {
  const shared = tariff(table({ carrierCharge: 450, petCharge: 350, partnerPetCharge: 120 }));
  assert.deepEqual(addOnRatesOf(input({ tariff: shared })), { carrier: 450, pet: 350, partnerPet: 120 });
  const branded = tariff({ ...table({ carrierCharge: 450, petCharge: 350, partnerPetCharge: 120 }), nesam: { 'One Way': { suv: { petCharge: 500 } } } });
  assert.deepEqual(addOnRatesOf(input({ tariff: branded })), { carrier: 450, pet: 500, partnerPet: 120 });
  assert.deepEqual(addOnRatesOf(input({ tariff: branded, brand: 'people_taxi' })), { carrier: 450, pet: 350, partnerPet: 120 });
});

test('a typed 0 means no charge, not "use the older amount"', () => {
  assert.deepEqual(addOnRatesOf(input({ tariff: tariff(table({ carrierCharge: 0, petCharge: 0 })) })), { carrier: 0, pet: 0, partnerPet: 0 });
});

test('ticking the add-ons adds the fare-table customer amounts to the total, with GST', () => {
  const t = tariff(table({ carrierCharge: 450, petCharge: 350, partnerPetCharge: 120 }));
  const base = priceBooking(input({ tariff: t }));
  const billed = priceBooking(input({ tariff: t, addOns: { roofCarrier: true, pets: true } }));
  assert.equal(billed.fare.addOns.carrierCharge, 450);
  assert.equal(billed.fare.addOns.petCharge, 350);
  assert.equal(billed.fare.total, cents(base.fare.total + 800 * (1 + base.fare.gstRate)));
  assert.equal(billed.breakup.packageTotal, billed.fare.total);
  // One tick bills only that one.
  const carrierOnly = priceBooking(input({ tariff: t, addOns: { roofCarrier: true, pets: false } }));
  assert.equal(carrierOnly.fare.total, cents(base.fare.total + 450 * (1 + base.fare.gstRate)));
});

test('the partner pet amount joins the partner payout only when pets are ticked', () => {
  const t = tariff(table({ petCharge: 350, partnerPetCharge: 120 }));
  const base = priceBooking(input({ tariff: t }));
  const pets = priceBooking(input({ tariff: t, addOns: { roofCarrier: false, pets: true } }));
  const carrier = priceBooking(input({ tariff: t, addOns: { roofCarrier: true, pets: false } }));
  assert.equal(pets.pricing.partner.basePaise, base.pricing.partner.basePaise + 12000);
  assert.equal(pets.pricing.partner.petPaise, 12000);
  assert.equal(carrier.pricing.partner.basePaise, base.pricing.partner.basePaise);
  assert.equal(carrier.pricing.partner.petPaise, undefined);
  // The customer's total does not include the partner's amount.
  assert.equal(pets.fare.total, cents(base.fare.total + 350 * (1 + base.fare.gstRate)));
});

test('the final fare keeps the add-ons as booked and the partner payout keeps the pet amount', () => {
  const t = tariff(table({ carrierCharge: 450, petCharge: 350, partnerPetCharge: 120 }));
  const quoted = priceBooking(input({ tariff: t, addOns: { roofCarrier: true, pets: true } }));
  const final = T.finalizeFare({ pricing: quoted.pricing, totalKm: 190, endMs: Date.parse('2026-11-08T18:00:00+05:30') });
  assert.equal(final.fare.addOns.carrierCharge, 450);
  assert.equal(final.fare.addOns.petCharge, 350);
  const noPet = priceBooking(input({ tariff: t }));
  const finalNoPet = T.finalizeFare({ pricing: noPet.pricing, totalKm: 190, endMs: Date.parse('2026-11-08T18:00:00+05:30') });
  assert.equal(final.partnerPaise, finalNoPet.partnerPaise + 12000);
});

test('night allowance: the partner amount is read, and applies only to its own vehicle class', () => {
  const cfg = parseNightAllowance({ enabled: true, amount: 0, classes: { suv: 300 }, partnerClasses: { suv: 100, sedan: 80 }, version: 2 });
  assert.deepEqual(cfg.partnerClasses, { suv: 100, sedan: 80 });
  assert.equal(nightAllowancePartnerFor(cfg, 'suv'), 100);
  assert.equal(nightAllowancePartnerFor(cfg, 'innova'), 0);
  assert.equal(nightAllowancePartnerFor({ ...cfg, enabled: false }, 'suv'), 0);
  assert.equal(nightAllowancePartnerFor(null, 'suv'), 0);
  assert.equal(parseNightAllowance({ enabled: true, amount: 300 }).partnerClasses, undefined);
});

test('a night pickup pays the partner their night amount, and the customer the customer amount', () => {
  const night = { enabled: true, amount: 0, classes: { suv: 300 }, partnerClasses: { suv: 100 }, version: 1 };
  const day = priceBooking(input({ nightAllowance: night }));
  const n = priceBooking(input({ nightAllowance: night, pickupAt: new Date('2026-11-08T23:30:00+05:30') }));
  assert.equal(n.fare.nightCharge, 300);
  assert.equal(day.fare.nightCharge ?? 0, 0);
  assert.equal(n.pricing.partner.basePaise, day.pricing.partner.basePaise + 10000);
  assert.equal(n.pricing.partner.nightPaise, 10000);
  assert.equal(day.pricing.partner.nightPaise, undefined);
});

test('a partner night amount alone leaves the customer fare unchanged', () => {
  const night = { enabled: true, amount: 0, classes: { suv: 0 }, partnerClasses: { suv: 100 }, version: 1 };
  const at = new Date('2026-11-08T23:30:00+05:30');
  const day = priceBooking(input({ pickupAt: at }));
  const n = priceBooking(input({ nightAllowance: night, pickupAt: at }));
  assert.equal(n.fare.total, day.fare.total);
  assert.equal(n.pricing.nightAllowance, undefined);
  assert.equal(n.pricing.partner.basePaise, day.pricing.partner.basePaise + 10000);
});

test('the quote records the night and pet partner amounts apart so a time-based final fare can add them back', () => {
  const night = { enabled: true, amount: 0, classes: { suv: 300 }, partnerClasses: { suv: 100 }, version: 1 };
  const t = tariff(table({ partnerPetCharge: 120 }));
  const quoted = priceBooking(input({ tariff: t, nightAllowance: night, addOns: { roofCarrier: false, pets: true }, pickupAt: new Date('2026-11-08T23:30:00+05:30') }));
  assert.equal(quoted.pricing.partner.nightPaise, 10000);
  assert.equal(quoted.pricing.partner.petPaise, 12000);
});
