const test = require('node:test');
const assert = require('node:assert/strict');
const { routeForRoundTripPricing, routeThrough } = require('../lib/shared');

test('routeThrough totals every ordered itinerary leg', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const leg = calls.length;
    return { ok: true, json: async () => ({ code: 'Ok', routes: [{ distance: leg * 10_000, duration: leg * 600 }] }) };
  };
  try {
    const points = [
      { id: 'a', name: 'A', address: 'A', lat: 10.1111, lng: 77.1111, type: 'other' },
      { id: 'b', name: 'B', address: 'B', lat: 10.2222, lng: 77.2222, type: 'other' },
      { id: 'c', name: 'C', address: 'C', lat: 10.3333, lng: 77.3333, type: 'other' },
    ];
    const route = await routeThrough(points);
    assert.equal(calls.length, 2);
    assert.equal(route.distanceKm, 30);
    assert.equal(route.durationMin, 30);
    assert.equal(route.estimated, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('a closed round-trip itinerary is priced from its full measured circuit exactly once', () => {
  const pickup = { id: 'madurai-a', name: 'Madurai', address: 'Madurai', lat: 9.9252, lng: 78.1198, type: 'other' };
  const sameDrop = { ...pickup, id: 'madurai-b' };
  const measuredCircuit = { distanceKm: 640, durationMin: 780, estimated: false, path: [] };
  const pricingRoute = routeForRoundTripPricing(measuredCircuit, 'Round Trip', pickup, sameDrop, 2);
  // The round-trip fare engine doubles this legacy base, yielding the measured 640 km once.
  assert.equal(pricingRoute.distanceKm, 320);
  assert.equal(pricingRoute.durationMin, 390);
  assert.equal(pricingRoute.distanceKm * 2, measuredCircuit.distanceKm);
});

test('ordinary round trips keep their outward route for return-leg doubling', () => {
  const pickup = { id: 'a', name: 'A', address: 'A', lat: 9.9, lng: 78.1, type: 'other' };
  const drop = { id: 'b', name: 'B', address: 'B', lat: 11.0, lng: 77.0, type: 'other' };
  const outward = { distanceKm: 160, durationMin: 210, estimated: false, path: [] };
  assert.equal(routeForRoundTripPricing(outward, 'Round Trip', pickup, drop, 2), outward);
});
