// Every price comes from the admin panel's settings. A vehicle category record carries no fare, and a trip nothing in the
// admin panel prices is refused instead of being priced from a built-in number.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const T = require('../lib/domain/tariff');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');

const category = () => ({ ...mapCategory('suv', { name: 'SUV', seatingCapacity: 6 }), tariffClass: 'suv' });
const tariff = (extra = {}) => T.parseTariffConfig({ ...CONFIRMED_TARIFF_V2, version: 1, enabled: true, ...extra });
const place = (name, lat, lng) => ({ id: 'pin', name, address: `${name}, Tamil Nadu`, lat, lng, type: 'other' });
const input = (patch = {}) => ({
  category: category(), route: { distanceKm: 10.6, durationMin: 19 }, tripType: 'One Way',
  pickup: place('Alukuli', 11.4, 77.4), drop: place('Gobichettipalayam', 11.45, 77.44),
  pickupAt: new Date('2026-11-19T20:20:00+05:30'), tripEndAt: null, tariff: tariff(), adjustment: null, brand: 'nesam', ...patch,
});

test('a category record carries no fare, whatever old fields it still has', () => {
  const c = mapCategory('x', { name: 'Sedan', seatingCapacity: 4, fare: { baseFare: 762, baseKm: 20, perKmRate: 15 } });
  assert.equal(c.fare, undefined);
});

test('a short One Way trip with no local fare is priced by the admin One Way rate card, with the admin minimum km', () => {
  const q = priceBooking(input());
  assert.equal(q.pricing.source, 'tariff_v2');
  assert.equal(q.pricing.model, 'one_way_standard');
  assert.equal(q.pricing.includedKm, 130);
});

test('the minimum km the admin sets for a brand and vehicle applies to a short trip', () => {
  const t = tariff({ brandOverrides: { people_taxi: { 'One Way': { suv: { minKm: 5 } } } } });
  const q = priceBooking(input({ tariff: t, brand: 'people_taxi' }));
  assert.equal(q.pricing.model, 'one_way_standard');
  assert.equal(q.pricing.includedKm, 10.6);
});

test('an enabled Local Pickup & Drop fare takes the short trip', () => {
  const localPickupDrop = { city1: { cityName: 'Gobichettipalayam', classes: { suv: { minKm: 5, customerRate: 20, partnerRate: 16, extraKmRate: 22, waitingPerHour: 150, enabled: true } } } };
  const q = priceBooking(input({ tariff: tariff({ localPickupDrop }), localCityId: 'city1' }));
  assert.equal(q.pricing.model, 'local_pickup_drop');
  assert.equal(q.pricing.includedKm, 10.6);
});

test('an Airport trip with no complete Airport Taxi fares is priced by the admin One Way rate card', () => {
  const q = priceBooking(input({ tripType: 'Airport Taxi', route: { distanceKm: 60, durationMin: 80 } }));
  assert.equal(q.pricing.model, 'one_way_standard');
});

test('with no tariff saved, a short trip is refused, never priced', () => {
  assert.throws(() => priceBooking(input({ tariff: null })), (e) => e.code === 'failed-precondition' && e.details?.code === 'rate-missing');
});

test('a Local Rental with no admin package is refused', () => {
  assert.throws(() => priceBooking(input({ tripType: 'Local Rental' })), (e) => e.details?.code === 'rate-missing');
});
