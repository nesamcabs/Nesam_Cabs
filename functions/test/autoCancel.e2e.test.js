// Auto-cancel of bookings nobody accepted, on the emulators (demo project — nothing here can reach production):
//   • 30 minutes after pickup, a booking that was not approved, or was approved and not accepted, is cancelled with a clear
//     office reason (and a plain one for the customer); anything paid is marked for a full refund;
//   • an accepted trip is never cancelled this way: the office is alerted once, and its manual cancel records whose side it was;
//   • bookings not yet due, old bookings and a second run change nothing; a booking past the limit cannot be approved.
//   npm run test:e2e:autocancel
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, TS, call } = H;

const U = { admin: 'acAdmin', cust: 'acCust', drv: 'acDriver' };
const ago = (minutes) => TS.fromMillis(Date.now() - minutes * 60000);
const read = async (id) => (await db.doc(`bookings/${id}`).get()).data();

async function seed(id, over = {}) {
  await db.doc(`bookings/${id}`).set({
    bookingId: id.toUpperCase(), customerId: U.cust, customer: 'AC Customer', pickup: 'Theni', drop: 'Madurai', fare: 1000, fareVerified: true,
    status: 'Pending', pickupAt: ago(31), createdAt: ago(300), updatedAt: ago(300), ...over,
  });
}

test.before(async () => {
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'AC Admin' });
  await db.doc(`drivers/${U.drv}`).set({ status: 'Approved', vendorId: '', name: 'AC Driver' });

  await seed('ac_pending');
  await seed('ac_pending_early', { pickupAt: ago(25) });
  await seed('ac_pending_old', { pickupAt: ago(4 * 24 * 60) });
  await seed('ac_unpublished', { status: 'Approved' });
  await seed('ac_published', { status: 'Approved' });
  await db.doc('marketplace_trips/ac_published').set({ status: 'Open', publishedAt: ago(200) });
  await seed('ac_bids', { status: 'Approved' });
  await db.doc('marketplace_trips/ac_bids').set({ status: 'Bidding', publishedAt: ago(200) });
  await db.doc('marketplace_trips/ac_bids/bids/b1').set({ status: 'Pending Review', amount: 700 });
  await seed('ac_paid');
  await db.doc('bookings/ac_paid/payment_transactions/t1').set({ amount: 300, method: 'UPI', status: 'Success', kind: 'advance', collectorType: 'admin' });
  await seed('ac_driver', { status: 'Assigned', assignedDriverId: U.drv, assignedDriverName: 'AC Driver', tripSubStatus: 'Not Started' });
  await seed('ac_reached', { status: 'Assigned', assignedDriverId: U.drv, assignedDriverName: 'AC Driver', tripSubStatus: 'Reached Pickup' });
  await seed('ac_vendor', { status: 'Confirmed', assignedVendorId: 'acVendor', assignedVendorName: 'AC Fleet' });
  await seed('ac_ongoing', { status: 'Ongoing', assignedDriverId: U.drv, tripSubStatus: 'Trip Started' });
});

test('a booking past the limit can no longer be approved', async () => {
  const r = await call(U.admin, 'approveBooking', { bookingId: 'ac_pending' });
  assert.equal(r.ok, false);
  assert.match(r.message, /more than 30 minutes ago/);
  assert.equal((await read('ac_pending')).status, 'Pending');
});

test('only operations staff can ask for the check', async () => {
  for (const uid of [U.cust, U.drv]) assert.equal((await call(uid, 'runBookingAutoCancel', {})).ok, false, uid);
  assert.equal((await read('ac_pending')).status, 'Pending');
});

test('30 minutes after pickup, bookings nobody accepted are cancelled with the reason that applies', async () => {
  const r = await call(U.admin, 'runBookingAutoCancel', {});
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.cancelled, 5, JSON.stringify(r.data));
  const expected = {
    ac_pending: ['not_approved', /not approved within 30 minutes/],
    ac_unpublished: ['not_published', /approved, but never published or assigned/],
    ac_published: ['not_accepted', /no driver or vendor accepted/],
    ac_bids: ['bid_not_awarded', /none was awarded/],
    ac_paid: ['not_approved', /not approved/],
  };
  for (const [id, [kind, reason]] of Object.entries(expected)) {
    const b = await read(id);
    assert.equal(b.status, 'Cancelled', id);
    assert.equal(b.cancelledBy, 'system', id);
    assert.equal(b.cancellation.auto, kind, id);
    assert.match(b.cancellation.reason, reason, id);
    // The customer's app shows cancelReason: no office detail in it.
    assert.equal(b.cancelReason, 'We could not confirm a ride for your pickup time.', id);
    assert.equal(b.cancellationFee, 0, id);
    assert.equal((await db.collection(`bookings/${id}/events`).where('type', '==', 'auto_cancelled').get()).size, 1, id);
  }
  assert.equal((await db.doc('marketplace_trips/ac_published').get()).data().status, 'Closed');
  assert.equal((await db.doc('marketplace_trips/ac_bids/bids/b1').get()).data().status, 'Rejected');
  const paid = await read('ac_paid');
  assert.deepEqual([paid.refund.status, paid.refund.amount], ['Pending', 300]);
  assert.equal((await read('ac_pending')).refund.status, 'Not Applicable');
});

test('accepted, not-yet-due and old bookings are left alone, and the office is asked to check the accepted ones', async () => {
  for (const [id, status] of [['ac_driver', 'Assigned'], ['ac_reached', 'Assigned'], ['ac_vendor', 'Confirmed'], ['ac_ongoing', 'Ongoing'], ['ac_pending_early', 'Pending'], ['ac_pending_old', 'Pending']]) {
    assert.equal((await read(id)).status, status, id);
  }
  const notices = (await db.collection('admin_notifications').get()).docs.map((d) => d.data()).filter((n) => /not started/.test(n.title));
  assert.deepEqual(notices.map((n) => n.bookingId).sort(), ['ac_driver', 'ac_reached', 'ac_vendor']);
  assert.match(notices.find((n) => n.bookingId === 'ac_reached').message, /marked Reached pickup/);
  assert.match(notices.find((n) => n.bookingId === 'ac_driver').message, /has not marked Reached pickup/);
});

test('running the check again changes nothing and repeats no alert', async () => {
  const before = await read('ac_pending');
  const count = (await db.collection('admin_notifications').get()).size;
  // Past the per-instance 30 s throttle.
  await new Promise((r) => setTimeout(r, 31000));
  const r = await call(U.admin, 'runBookingAutoCancel', {});
  assert.deepEqual([r.data.ran, r.data.cancelled, r.data.notStartedAlerts], [true, 0, 0]);
  assert.deepEqual(await read('ac_pending'), before);
  assert.equal((await db.collection('admin_notifications').get()).size, count);
});

test('the office cancels an accepted trip by hand and records whose side it was', async () => {
  const bad = await call(U.admin, 'cancelBooking', { bookingId: 'ac_driver', reason: 'Driver did not go', faultParty: 'someone' });
  assert.equal(bad.ok, false);
  assert.equal((await read('ac_driver')).status, 'Assigned');
  const r = await call(U.admin, 'cancelBooking', { bookingId: 'ac_driver', reason: 'Driver / partner did not reach the pickup (verified by NESAM office).', faultParty: 'driver' });
  assert.equal(r.ok, true, r.message);
  const b = await read('ac_driver');
  assert.equal(b.status, 'Cancelled');
  assert.equal(b.cancellation.fault, 'driver');
  assert.equal(b.cancellation.auto, undefined);
  assert.equal(b.cancellation.cancelledBy.type, 'admin');
});
