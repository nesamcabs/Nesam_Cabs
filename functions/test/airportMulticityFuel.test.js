// CNG on Airport Taxi and Multicity: priced only from the CNG rates saved in Service & Fare Settings, never from Diesel.
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.GCLOUD_PROJECT ||= 'demo-nesam';
const { priceBooking } = require('../lib/quote');
const { mapCategory } = require('../lib/domain/pricing');
const T = require('../lib/domain/tariff');
const { CONFIRMED_TARIFF_V2 } = require('./support/confirmedTariff');

const category = { ...mapCategory('suv', { name: 'SUV', seatingCapacity: 6, cngEnabled: true }), tariffClass: 'suv' };
const tariff = (brandOverrides) => T.parseTariffConfig({ ...CONFIRMED_TARIFF_V2, version: 1, enabled: true, brandOverrides });
const place = (name, lat, lng, type = 'other') => ({ id: 'pin', name, address: `${name}, Tamil Nadu`, lat, lng, type });
const input = (patch) => ({
  category, route: { distanceKm: 100, durationMin: 150 }, pickup: place('Theni', 10.0104, 77.4768), drop: place('Madurai Airport', 9.8345, 78.0934, 'airport'),
  pickupAt: new Date('2026-11-19T10:00:00+05:30'), tripEndAt: null, adjustment: null, brand: 'nesam', ...patch,
});
/** The rate the quote used, GST-inclusive when the fare includes GST. */
const extraRate = (q) => (q.pricing.gstInclusiveBase?.extraKmRatePaise ?? q.pricing.extraKmRatePaise) / 100;
/** These fares include 5% GST: the saved snapshot keeps rates and amounts before tax. */
const net = (rupees) => Math.round((rupees * 100) / 1.05);
const refused = (fn) => assert.throws(fn, /CNG is not available/);

const DIESEL_AIRPORT = { customerBase: 900, partnerBase: 750, minKm: 40, extraKmRate: 20, partnerRate: 15 };
const CNG_AIRPORT = { cngCustomerBase: 700, cngPartnerBase: 600, cngExtraKmRate: 14, cngPartnerRate: 11 };

test('Airport Taxi prices CNG from its CNG card and Diesel is unchanged', () => {
  const t = tariff({ common: { 'Airport Taxi': { suv: { ...DIESEL_AIRPORT, ...CNG_AIRPORT } } } });
  const diesel = priceBooking(input({ tripType: 'Airport Taxi', tariff: t }));
  const cng = priceBooking(input({ tripType: 'Airport Taxi', tariff: t, fuel: 'cng' }));
  assert.equal(diesel.pricing.model, 'airport_transfer');
  assert.equal(diesel.pricing.fuelType, undefined);
  assert.equal(cng.pricing.fuelType, 'cng');
  assert.equal(extraRate(diesel), 20);
  assert.equal(extraRate(cng), 14);
  // No CNG "included km" of its own: the standard 40 km applies, so 60 km are extra. 700 + 60 × 14.
  assert.equal(cng.pricing.minKmPerDay, 40);
  assert.equal(cng.pricing.partner.basePaise, (600 + 60 * 11) * 100);
  assert.equal(cng.fare.total, 700 + 60 * 14);
  assert.equal(cng.pricing.packagePaise, net(700 + 60 * 14));
});

test('Airport Taxi: a brand overrides single CNG fields and inherits the rest from Common', () => {
  const t = tariff({
    common: { 'Airport Taxi': { suv: { ...DIESEL_AIRPORT, ...CNG_AIRPORT } } },
    people_taxi: { 'Airport Taxi': { suv: { cngExtraKmRate: 16, cngMinKm: 50 } } },
  });
  const own = priceBooking(input({ tripType: 'Airport Taxi', tariff: t, fuel: 'cng', brand: 'people_taxi' }));
  assert.equal(extraRate(own), 16);
  assert.equal(own.fare.total, 700 + 50 * 16);
  assert.equal(extraRate(priceBooking(input({ tripType: 'Airport Taxi', tariff: t, fuel: 'cng' }))), 14);
});

test('Airport Taxi without a complete CNG card refuses CNG instead of charging Diesel under that name', () => {
  for (const cngCard of [{}, { cngCustomerBase: 700, cngExtraKmRate: 14 }]) {
    const t = tariff({ common: { 'Airport Taxi': { suv: { ...DIESEL_AIRPORT, ...cngCard } } } });
    refused(() => priceBooking(input({ tripType: 'Airport Taxi', tariff: t, fuel: 'cng' })));
    assert.equal(priceBooking(input({ tripType: 'Airport Taxi', tariff: t })).pricing.model, 'airport_transfer');
  }
});

const CNG_TOUR = { cngCustomerRate: 14, cngPartnerRate: 11, cngCustomerBata: 400, cngPartnerBata: 300 };
const tour = (patch) => input({
  tripType: 'Round Trip', multicity: true, route: { distanceKm: 700, durationMin: 900 }, drop: place('Kanyakumari', 8.0883, 77.5385),
  tripEndAt: new Date('2026-11-20T18:00:00+05:30'), ...patch,
});

test('Multicity prices CNG from the Multicity CNG rates', () => {
  const t = tariff({ common: { Multicity: { suv: CNG_TOUR } } });
  const diesel = priceBooking(tour({ tariff: t }));
  const cng = priceBooking(tour({ tariff: t, fuel: 'cng' }));
  assert.equal(diesel.service, 'Multicity');
  assert.equal(diesel.pricing.fuelType, undefined);
  assert.equal(cng.pricing.fuelType, 'cng');
  assert.equal(cng.pricing.customerRatePaise, net(14));
  assert.equal(cng.pricing.extraKmRatePaise, net(14));
  assert.equal(cng.pricing.minKmPerDay, diesel.pricing.minKmPerDay);
  assert.ok(cng.fare.total < diesel.fare.total);
  const km = Math.max(700, cng.pricing.minKmPerDay * 2);
  assert.equal(cng.pricing.partner.basePaise, (km * 11 + 2 * 300) * 100);
});

test('Multicity: CNG daily minimum km and a brand override apply', () => {
  const t = tariff({ common: { Multicity: { suv: CNG_TOUR } }, onewaycarrentals: { Multicity: { suv: { cngCustomerRate: 15, cngMinKmPerDay: 400, cngExtraKmRate: 18 } } } });
  const own = priceBooking(tour({ tariff: t, fuel: 'cng', brand: 'onewaycarrentals' }));
  assert.equal(own.pricing.customerRatePaise, net(15));
  assert.equal(own.pricing.extraKmRatePaise, net(18));
  assert.equal(own.pricing.includedKm, 800);
});

test('Multicity without CNG rates refuses CNG', () => {
  refused(() => priceBooking(tour({ tariff: tariff(), fuel: 'cng' })));
  refused(() => priceBooking(tour({ tariff: tariff({ common: { Multicity: { suv: { cngCustomerRate: 14 } } } }), fuel: 'cng' })));
});

test('the saved CNG fields survive parsing', () => {
  const o = tariff({ common: { 'Airport Taxi': { suv: { ...CNG_AIRPORT, cngMinKm: 45 } } } }).brandOverrides.common['Airport Taxi'].suv;
  assert.deepEqual(o, { ...CNG_AIRPORT, cngMinKm: 45 });
});
