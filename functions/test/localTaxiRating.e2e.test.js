// Local Taxi rating on the emulators, from a ride that is already completed (no routing or dispatch needed):
// a 1-2 star rating needs a reason and feedback, the record lands on the driver's profile, and it counts once.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, rest } = H;

const C1 = 'ltrCust1', C2 = 'ltrCust2', D = 'ltrDriver', ADMIN = 'ltrAdmin';

test.before(async () => {
  await db.doc(`customers/${C1}`).set({ status: 'Approved', name: 'Meena', phone: '+919800000001' });
  await db.doc(`customers/${C2}`).set({ status: 'Approved', name: 'Other', phone: '+919800000002' });
  await db.doc(`drivers/${D}`).set({ status: 'Approved', name: 'Anand', phone: '+919800000003', rating: 5 });
  await db.doc(`admins/${ADMIN}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Test Admin' });
});

const completedRide = async (id, over = {}) => {
  await db.doc(`lt_rides/${id}`).set({ customerId: C1, customerName: 'Meena', status: 'completed', driverId: D, driverName: 'Anand', driverVehicle: { number: 'TN10AB1234', type: 'Sedan' }, categoryName: 'Mini', ...over });
  await db.doc(`lt_driver_state/${D}`).set({ ratingSum: 0, ratingCount: 0 }, { merge: true });
  return id;
};

test('Local Taxi: who may rate, and what a low rating needs', async () => {
  const id = await completedRide('ltr-low');
  assert.equal((await call(C2, 'ltRateRide', { rideId: id, rating: 5 })).ok, false, "not someone else's ride");
  assert.equal((await call(C1, 'ltRateRide', { rideId: await completedRide('ltr-open', { status: 'in_progress' }), rating: 5 })).ok, false, 'only after the ride is completed');
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 9 })).ok, false);
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 1 })).ok, false, 'a low rating needs a reason');
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 2, reason: 'Late pickup or late arrival' })).ok, false, 'and what happened');
  assert.equal((await db.doc(`lt_rides/${id}`).get()).data().rating, undefined, 'a refused rating stores nothing');
  assert.equal((await db.doc(`driverRatings/lt_${id}`).get()).exists, false);

  const r = await call(C1, 'ltRateRide', { rideId: id, rating: 1, reason: 'Late pickup or late arrival', feedback: 'Driver came 25 minutes late', improvements: 'Share a live ETA' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.low, true);
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 4 })).ok, false, 'once only');

  const rec = (await db.doc(`driverRatings/lt_${id}`).get()).data();
  assert.equal(rec.source, 'local_taxi');
  assert.equal(rec.rideId, id);
  assert.equal(rec.stars, 1);
  assert.equal(rec.low, true);
  assert.equal(rec.reason, 'Late pickup or late arrival');
  assert.equal(rec.feedback, 'Driver came 25 minutes late');
  assert.equal(rec.improvements, 'Share a live ETA');
  assert.equal(rec.followUp, 'New');
  assert.equal(rec.driverId, D);
  assert.equal(rec.customerName, 'Meena');
  assert.equal(rec.vehicleNumber, 'TN10AB1234');

  const ride = (await db.doc(`lt_rides/${id}`).get()).data();
  assert.equal(ride.rating.stars, 1);
  const drv = (await db.doc(`drivers/${D}`).get()).data();
  assert.equal(drv.ratingCount, 1);
  assert.equal(drv.rating, 1);
  assert.equal(drv.lowRatingCount, 1);
  assert.equal(drv.ratingBreakdown['1'], 1);
  assert.equal((await db.doc(`lt_driver_state/${D}`).get()).data().ratingCount, 1, 'the dispatch rating still counts');
});

test('Local Taxi: a good rating needs only the stars, and joins the same driver profile', async () => {
  const id = await completedRide('ltr-good');
  const r = await call(C1, 'ltRateRide', { rideId: id, rating: 5, tags: ['Clean car'], comment: 'Smooth' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.low, false);
  const rec = (await db.doc(`driverRatings/lt_${id}`).get()).data();
  assert.equal(rec.followUp, 'None');
  assert.deepEqual(rec.tags, ['Clean car']);
  const drv = (await db.doc(`drivers/${D}`).get()).data();
  assert.equal(drv.ratingCount, 2);
  assert.equal(drv.rating, 3);
  assert.equal(drv.ratingBreakdown['5'], 1);
});

test('Local Taxi: a rating works when the driver has no profile record', async () => {
  const id = await completedRide('ltr-orphan', { driverId: 'ltrNoProfile', driverName: 'Walk-in' });
  const r = await call(C1, 'ltRateRide', { rideId: id, rating: 4 });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal((await db.doc(`driverRatings/lt_${id}`).get()).data().driverId, 'ltrNoProfile');
});

test('Local Taxi ratings are readable by staff, not by the rider', async () => {
  assert.equal((await rest(C1, 'driverRatings/lt_ltr-low')).status, 403);
  assert.equal((await rest(ADMIN, 'driverRatings/lt_ltr-low')).status, 200);
});
