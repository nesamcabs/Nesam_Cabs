// Pure rules of the advance-booking flow. Run: npm run build && node --test test/advanceBooking.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_BOOKING_WINDOW, bookingWindowFrom, parsePickupInstant, pickupWindowProblem,
  fulfilmentOf, marketplaceStateOf, awaitingFulfilment, CUSTOMER_FULFILMENT_LABEL,
} = require('../lib/domain/advanceBooking');

const NOW = new Date('2026-10-14T10:00:00Z');
const at = (min) => new Date(NOW.getTime() + min * 60000);

test('a pickup is required: there is no ride now', () => {
  assert.match(pickupWindowProblem(null, NOW), /advance bookings only/);
});

test('past pickups and pickups inside the notice period are rejected', () => {
  assert.match(pickupWindowProblem(at(-5), NOW), /at least 30 minutes/);
  assert.match(pickupWindowProblem(at(0), NOW), /at least 30 minutes/);
  assert.match(pickupWindowProblem(at(29), NOW), /at least 30 minutes/);
  assert.equal(pickupWindowProblem(at(30), NOW), '');
});

test('the horizon is enforced', () => {
  assert.equal(pickupWindowProblem(at(30 * 1440), NOW), '');
  assert.match(pickupWindowProblem(at(30 * 1440 + 1), NOW), /up to 30 days ahead/);
});

test('the window is configurable and falls back to the retained defaults', () => {
  assert.deepEqual(bookingWindowFrom(undefined), DEFAULT_BOOKING_WINDOW);
  assert.deepEqual(bookingWindowFrom({ bookingMinLeadMinutes: 'soon', bookingMaxAdvanceDays: -3 }), DEFAULT_BOOKING_WINDOW);
  const w = bookingWindowFrom({ bookingMinLeadMinutes: 120, bookingMaxAdvanceDays: 60 });
  assert.deepEqual(w, { minLeadMinutes: 120, maxAdvanceDays: 60 });
  assert.match(pickupWindowProblem(at(90), NOW, w), /at least 120 minutes/);
  assert.equal(pickupWindowProblem(at(120), NOW, w), '');
});

test('only unambiguous instants are accepted as a pickup', () => {
  assert.equal(parsePickupInstant('2026-10-15T09:30:00Z')?.toISOString(), '2026-10-15T09:30:00.000Z');
  assert.equal(parsePickupInstant('2026-10-15T15:00:00+05:30')?.toISOString(), '2026-10-15T09:30:00.000Z');
  assert.equal(parsePickupInstant(Date.UTC(2026, 9, 15, 9, 30))?.toISOString(), '2026-10-15T09:30:00.000Z');
  // A wall-clock time with no zone could be read as UTC or IST: refuse to guess.
  assert.equal(parsePickupInstant('2026-10-15T15:00'), null);
  assert.equal(parsePickupInstant('2026-10-15'), null);
  assert.equal(parsePickupInstant('tomorrow'), null);
  assert.equal(parsePickupInstant(null), null);
  assert.equal(parsePickupInstant(''), null);
});

test('fulfilment state is derived without a marketplace record', () => {
  assert.equal(fulfilmentOf({ status: 'Pending' }), 'awaiting_review');
  // Approved but not published: awaiting fulfilment, whatever the draft record says.
  assert.equal(fulfilmentOf({ status: 'Approved' }, 'none'), 'awaiting_fulfilment');
  assert.equal(fulfilmentOf({ status: 'Approved' }, marketplaceStateOf('Unpublished')), 'awaiting_fulfilment');
  assert.equal(fulfilmentOf({ status: 'Approved' }, marketplaceStateOf('Awaiting Approval')), 'awaiting_fulfilment');
  assert.equal(fulfilmentOf({ status: 'Approved' }, marketplaceStateOf('Open')), 'published');
  assert.equal(fulfilmentOf({ status: 'Confirmed', assignedVendorId: 'v1' }, 'assigned'), 'vendor_assigned');
  assert.equal(fulfilmentOf({ status: 'Assigned', assignedVendorId: 'v1', assignedDriverId: 'd1' }), 'driver_assigned');
  assert.equal(fulfilmentOf({ status: 'Ongoing', assignedDriverId: 'd1' }), 'in_progress');
  assert.equal(fulfilmentOf({ status: 'Completed' }), 'completed');
  assert.equal(fulfilmentOf({ status: 'Rejected' }), 'rejected');
  assert.equal(fulfilmentOf({ status: 'Cancelled' }), 'cancelled');
});

test('a booking is only offered or assigned while approved and unheld', () => {
  assert.equal(awaitingFulfilment({ status: 'Approved' }), true);
  assert.equal(awaitingFulfilment({ status: 'Pending' }), false);
  assert.equal(awaitingFulfilment({ status: 'Approved', assignedVendorId: 'v1' }), false);
  assert.equal(awaitingFulfilment({ status: 'Assigned', assignedDriverId: 'd1' }), false);
});

test('customer wording never promises a driver before there is one', () => {
  for (const key of ['awaiting_review', 'awaiting_fulfilment', 'published', 'vendor_assigned']) {
    assert.doesNotMatch(CUSTOMER_FULFILMENT_LABEL[key], /driver (is|has) (assigned|arriving)|arriving in/i);
  }
  assert.equal(CUSTOMER_FULFILMENT_LABEL.vendor_assigned, 'Vendor assigned — driver details pending');
  assert.equal(CUSTOMER_FULFILMENT_LABEL.driver_assigned, 'Driver and vehicle assigned');
});
