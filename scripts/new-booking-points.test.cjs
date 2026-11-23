// New Booking map pins → quote (admin/src/domain/bookingPoints.ts): run with `npm run test:new-booking` in admin/.
// Regression for the recorded failure: a map pin reached the quote as "Pinned location" with no address, and the
// server refused every cab with "Add the pickup address for the selected map point".
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require(path.resolve(__dirname, '../functions/test/adminServiceLoader.cjs'))({});
const P = load('src/domain/bookingPoints.ts');

const pin = (over = {}) => ({ lat: 11.0168, lng: 76.9558, name: 'Pinned location', address: '', type: 'other', confirmed: false, resolved: false, ...over });

test('a pin still being looked up is not quoted and is shown by its coordinates, never "Pinned location"', () => {
  const r = P.pickedForBooking(pin());
  assert.equal(P.pinNeedsAddress(r.point), true);
  assert.equal(r.label, '11.01680, 76.95580');
});

test('a pin with a looked-up address is quotable and keeps the same coordinates and address', () => {
  const r = P.pickedForBooking(pin({ name: 'Gandhipuram', address: 'Gandhipuram, Coimbatore, Tamil Nadu 641012', resolved: true }));
  assert.equal(P.pinNeedsAddress(r.point), false);
  assert.equal(r.label, 'Gandhipuram');
  assert.equal(r.point.address, 'Gandhipuram, Coimbatore, Tamil Nadu 641012');
  assert.deepEqual([r.point.lat, r.point.lng], [11.0168, 76.9558]);
});

test('when no address was found the coordinates are not accepted as the address; a typed address is, and names the pin', () => {
  const unresolved = P.pickedForBooking(pin({ address: '11.01680, 76.95580', resolved: false }));
  assert.equal(P.pinNeedsAddress(unresolved.point), true);
  const typed = P.pickedForBooking(pin({ address: 'Door 4, 1st Cross, Gandhipuram', resolved: true }));
  assert.equal(P.pinNeedsAddress(typed.point), false);
  assert.equal(typed.point.name, 'Door 4', 'the placeholder name is replaced by the address');
  assert.equal(typed.label, 'Door 4');
});

test('saved locations and search results (no resolved flag) are quotable; an empty address never is', () => {
  assert.equal(P.pinNeedsAddress({ lat: 9.92, lng: 78.12, name: 'Madurai', address: 'Madurai, Tamil Nadu', type: 'other', confirmed: true }), false);
  assert.equal(P.pinNeedsAddress({ lat: 9.92, lng: 78.12, name: 'Madurai', address: ' ', type: 'other', confirmed: true }), true);
  assert.equal(P.pinNeedsAddress(null), false);
  assert.deepEqual(P.pickedForBooking(null), { point: null, label: '' });
});
