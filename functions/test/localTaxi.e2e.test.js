// Local Taxi end to end on the emulators: zones, versioned fares, quotes, booking, dispatch, atomic acceptance, ride code,
// completion, cancellation fees, access rules and the failure paths. Fixture zone is a made-up square, not a real city.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./helpers.e2e');
const { db, call, rid, rest, clientPatch, until } = H;

const ADMIN = 'lt-admin', C1 = 'lt-c1', C2 = 'lt-c2', D1 = 'lt-d1', D2 = 'lt-d2';
const square = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const ZONE = { type: 'Polygon', coordinates: [square(77.0, 11.0, 77.1, 11.1)] };
const PICKUP = { name: 'Test pickup', address: 'Test', lat: 11.05, lng: 77.05 };
const DROP = { name: 'Test drop', address: 'Test', lat: 11.06, lng: 77.06 };
const OUTSIDE = { name: 'Elsewhere', address: 'Test', lat: 12.5, lng: 78.5 };
const FARE = {
  currency: 'INR', baseFarePaise: 5000, includedMeters: 2000, perKmPaise: 1200, perMinutePaise: 150, minimumFarePaise: 8000, freeWaitingSeconds: 180, waitingPerMinutePaise: 200, pickupChargePaise: 0,
  night: { enabled: false, startMinute: 1320, endMinute: 360, bps: 2000 }, surge: { enabled: false, multiplierBps: 10000, maxBps: 20000, effectiveFromMs: null, effectiveToMs: null },
  cancellation: { feePaise: 3000, graceSeconds: 3600 }, tax: { enabled: false, bps: 0 }, platformFeePaise: 0, rounding: 'none', commissionBps: 1500, maxDistanceOverQuoteBps: 15000,
};
const loc = (lat, lng) => ({ lat, lng, accuracy: 10, capturedAt: Date.now() });
let routing;
let fareV1;

const quote = async (customer = C1, drop = DROP) => (await call(customer, 'ltGetQuotes', { pickup: PICKUP, drop })).data?.quotes?.[0];
async function newRide(customer = C1, method = 'cash') {
  const q = await quote(customer);
  assert.ok(q, 'a quote is needed');
  const requestId = rid('lt');
  const r = await call(customer, 'ltCreateRide', { requestId, quoteId: q.quoteId, paymentMethod: method });
  return { requestId, r, q };
}
const ride = async (id) => (await db.doc(`lt_rides/${id}`).get()).data();
async function online(uid, lat, lng) { return call(uid, 'ltSetAvailability', { online: true, location: loc(lat, lng) }); }
async function freeEveryone() {
  for (const uid of [D1, D2]) await db.doc(`lt_driver_state/${uid}`).set({ activeRideId: null, available: true, online: true, location: { lat: uid === D1 ? 11.051 : 11.06, lng: uid === D1 ? 77.051 : 77.06, atMs: Date.now() } }, { merge: true });
}
async function activeRideOf(uid) { return (await db.doc(`lt_driver_state/${uid}`).get()).data()?.activeRideId; }

test.before(async () => {
  routing = await H.startRoutingStub(8765, 6, 15); // every route: 6 km / 15 min
  await db.doc(`admins/${ADMIN}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'LT admin' });
  await db.doc('vehicle_categories/lt-sedan').set({ name: 'Sedan', status: 'Active', seatingCapacity: 4 });
  for (const [id, n] of [[D1, 'Driver One'], [D2, 'Driver Two']]) await db.doc(`drivers/${id}`).set({ status: 'Approved', name: n, phone: '+9190000000' + id.slice(-1), vehicleNumber: 'TN01AB000' + id.slice(-1), vehicleType: 'Sedan' });
  for (const id of [C1, C2]) await db.doc(`customers/${id}`).set({ name: id.toUpperCase(), status: 'Active' });
});
test.after(() => routing?.close());

test('zones and fares: only staff configure; invalid, overlapping and unfinished setups are refused', async () => {
  assert.equal((await call(C1, 'ltSaveZone', { name: 'Hack zone', boundary: ZONE, categoryIds: [] })).ok, false); // a customer cannot
  const bad = await call(ADMIN, 'ltSaveZone', { name: 'Bad', boundary: { type: 'Polygon', coordinates: [[[77, 11], [77.1, 11.1], [77.1, 11], [77, 11.1], [77, 11]]] }, categoryIds: ['lt-sedan'] });
  assert.equal(bad.ok, false); assert.match(bad.message, /crosses itself/);
  const z = await call(ADMIN, 'ltSaveZone', { zoneId: 'lt-test', name: 'Test zone', boundary: ZONE, categoryIds: ['lt-sedan'], cashEnabled: true });
  assert.equal(z.ok, true, JSON.stringify(z));
  assert.equal(z.data.status, 'draft');
  const overlap = await call(ADMIN, 'ltSaveZone', { zoneId: 'lt-two', name: 'Overlap', boundary: { type: 'Polygon', coordinates: [square(77.05, 11.05, 77.15, 11.15)] }, categoryIds: ['lt-sedan'] });
  assert.equal(overlap.ok, false); assert.match(overlap.message, /overlaps/i);
  assert.equal((await call(ADMIN, 'ltSetZoneStatus', { zoneId: 'lt-test', status: 'active' })).ok, false); // no active fare yet
  const badFare = await call(ADMIN, 'ltSaveFare', { zoneId: 'lt-test', categoryId: 'lt-sedan', config: { ...FARE, baseFarePaise: -5 } });
  assert.equal(badFare.ok, false);
  const f = await call(ADMIN, 'ltSaveFare', { zoneId: 'lt-test', categoryId: 'lt-sedan', config: FARE, sample: true, note: 'e2e sample' });
  assert.equal(f.ok, true, JSON.stringify(f));
  fareV1 = f.data.fareId;
  assert.equal((await call(ADMIN, 'ltActivateFare', { fareId: fareV1 })).ok, true);
  const on = await call(ADMIN, 'ltSetZoneStatus', { zoneId: 'lt-test', status: 'active' });
  assert.equal(on.ok, true, JSON.stringify(on));
  const sim = await call(ADMIN, 'ltSimulateFare', { config: FARE, distanceMeters: 5000, rideSeconds: 600 });
  assert.equal(sim.data.totalPaise, 10100);
  const audits = await db.collection('audit_logs').where('entity', '==', 'lt_zone').get();
  assert.ok(audits.size >= 2);
});

test('serviceability: inside, on the boundary, outside, and different places', async () => {
  const inside = await call(C1, 'ltCheckServiceability', { pickup: PICKUP, drop: DROP });
  assert.equal(inside.data.available, true);
  assert.equal((await call(C1, 'ltCheckServiceability', { pickup: { ...PICKUP, lat: 11.0 } })).data.available, true); // exactly on the south edge
  assert.equal((await call(C1, 'ltCheckServiceability', { pickup: OUTSIDE })).data.available, false);
  const dropOut = await call(C1, 'ltCheckServiceability', { pickup: PICKUP, drop: OUTSIDE });
  assert.equal(dropOut.data.available, false); assert.equal(dropOut.data.reason, 'drop_outside_zone');
  const q = await call(C1, 'ltGetQuotes', { pickup: PICKUP, drop: OUTSIDE }); // the server refuses even if the app skipped the check
  assert.equal(q.ok, false); assert.match(q.message, /not available/);
  assert.equal((await call(C1, 'ltGetQuotes', { pickup: PICKUP, drop: { ...PICKUP, lat: 11.0501 } })).ok, false); // too close together
});

test('a quote is priced by the server, expires, belongs to one customer and is single use', async () => {
  const r = await call(C1, 'ltGetQuotes', { pickup: PICKUP, drop: DROP });
  assert.equal(r.ok, true, JSON.stringify(r));
  const q = r.data.quotes[0];
  assert.equal(q.totalPaise, 5000 + Math.round((4000 * 1200) / 1000) + Math.round((900 * 150) / 60)); // 6 km, 15 min
  assert.equal(q.sampleFare, true);
  assert.equal(r.data.payment.cash, true); assert.equal(typeof r.data.payment.online, 'boolean'); // online is offered only when the payment keys are configured (the emulator env has demo keys)
  const stolen = await call(C2, 'ltCreateRide', { requestId: rid('lt'), quoteId: q.quoteId, paymentMethod: 'cash' });
  assert.equal(stolen.ok, false); assert.match(stolen.message, /not yours/);
  await db.doc(`lt_quotes/${q.quoteId}`).update({ expiresAtMs: Date.now() - 1000 });
  const expired = await call(C1, 'ltCreateRide', { requestId: rid('lt'), quoteId: q.quoteId, paymentMethod: 'cash' });
  assert.equal(expired.ok, false); assert.match(expired.message, /expired/i);
});

test('drivers: only enabled, approved drivers inside the zone can go online', async () => {
  assert.equal((await online(D1, 11.051, 77.051)).ok, false); // not enabled yet
  assert.equal((await call(C1, 'ltSetDriverEligibility', { driverId: D1, zoneIds: ['lt-test'], categoryIds: ['lt-sedan'] })).ok, false); // staff only
  for (const d of [D1, D2]) assert.equal((await call(ADMIN, 'ltSetDriverEligibility', { driverId: d, zoneIds: ['lt-test'], categoryIds: ['lt-sedan'] })).ok, true);
  assert.equal((await online(D1, 12.5, 78.5)).ok, false); // outside the zone
  assert.equal((await call(D1, 'ltSetAvailability', { online: true, location: { ...loc(11.05, 77.05), capturedAt: Date.now() - 600000 } })).ok, false); // stale fix
  assert.equal((await online(D1, 11.051, 77.051)).ok, true);
  assert.equal((await online(D2, 11.06, 77.06)).ok, true);
  await db.doc('drivers/lt-d3').set({ status: 'Pending', name: 'Pending driver' });
  assert.equal((await online('lt-d3', 11.05, 77.05)).ok, false);
});

test('booking: idempotent, one active ride per customer, and the nearest driver gets the offer', async () => {
  const { requestId, r, q } = await newRide(C1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.status, 'searching');
  const again = await call(C1, 'ltCreateRide', { requestId, quoteId: q.quoteId, paymentMethod: 'cash' });
  assert.equal(again.ok, true); assert.equal(again.data.duplicate, true); // a retry returns the same ride
  assert.equal((await db.collection('lt_rides').where('customerId', '==', C1).get()).size, 1);
  const second = await call(C1, 'ltCreateRide', { requestId: rid('lt'), quoteId: (await quote(C1)).quoteId, paymentMethod: 'cash' });
  assert.equal(second.ok, false); assert.match(second.message, /already have/);
  const rd = await ride(requestId);
  assert.equal(rd.currentOfferId, `${requestId}__${D1}`); // D1 is closest
  assert.equal(rd.estimate.totalPaise, q.totalPaise);
  assert.equal(rd.fare.version, 1);
  H.rideId = requestId;
});

test('unauthorised access: other customers cannot read the ride, clients cannot write it, the driver cannot see the ride code', async () => {
  const id = H.rideId;
  assert.equal((await call(C2, 'ltGetRide', { rideId: id })).ok, false);
  assert.equal((await rest(C2, `lt_rides/${id}`)).status, 403);
  assert.equal((await rest(C1, `lt_rides/${id}`)).status, 200);
  assert.equal((await clientPatch(C1, `lt_rides/${id}`, { status: 'completed' })).ok, false);
  assert.equal((await clientPatch(D1, `lt_driver_state/${D1}`, { online: true })).ok, false);
  assert.equal((await rest(C1, `lt_fares/${fareV1}`)).status, 403); // customers cannot read fare configuration
  assert.equal((await call(D2, 'ltDriverAdvance', { rideId: id, action: 'depart' })).ok, false);
});

test('simultaneous acceptance: exactly one of a driver and a staff assignment wins', async () => {
  const id = H.rideId;
  const [a, b] = await Promise.all([call(D1, 'ltRespondOffer', { offerId: `${id}__${D1}`, accept: true }), call(ADMIN, 'ltAssignRide', { rideId: id, driverId: D2 })]);
  assert.equal([a, b].filter((x) => x.ok).length, 1, JSON.stringify([a, b]));
  const rd = await ride(id);
  assert.equal(rd.status, 'assigned');
  const winner = rd.driverId;
  assert.equal(await activeRideOf(winner), id);
  const loser = winner === D1 ? D2 : D1;
  assert.notEqual(await activeRideOf(loser), id);
  assert.equal((await call(D1, 'ltRespondOffer', { offerId: `${id}__${D1}`, accept: true })).ok, false); // a second accept cannot succeed
  H.winner = winner; H.loserDriver = loser;
});

test('state machine: steps cannot be skipped; arrival needs the driver at the pickup', async () => {
  const id = H.rideId, d = H.winner;
  const skip = await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: '1234', location: loc(11.05, 77.05) });
  assert.equal(skip.ok, false); assert.match(skip.message, /cannot move/);
  assert.equal((await call(d, 'ltDriverAdvance', { rideId: id, action: 'complete', location: loc(11.05, 77.05) })).ok, false);
  assert.equal((await call(d, 'ltDriverAdvance', { rideId: id, action: 'depart' })).ok, true);
  const far = await call(d, 'ltDriverAdvance', { rideId: id, action: 'arrived', location: loc(11.09, 77.09) });
  assert.equal(far.ok, false); assert.match(far.message, /not at the pickup/);
  assert.equal((await call(d, 'ltDriverAdvance', { rideId: id, action: 'arrived', location: { ...loc(11.0505, 77.0505), accuracy: 900 } })).ok, false); // weak GPS
  assert.equal((await call(d, 'ltDriverAdvance', { rideId: id, action: 'arrived', location: loc(11.0505, 77.0505) })).ok, true);
});

test('ride code: the customer sees it, the driver cannot; wrong codes are limited; the right one starts the ride once', async () => {
  const id = H.rideId, d = H.winner;
  const secret = (await db.doc(`lt_ride_secrets/${id}`).get()).data();
  assert.match(secret.otp, /^\d{4}$/);
  assert.equal((await rest(C1, `lt_ride_secrets/${id}`)).status, 200);
  assert.equal((await rest(d, `lt_ride_secrets/${id}`)).status, 403);
  assert.equal((await call(C1, 'ltGetRide', { rideId: id })).data.otp, secret.otp);
  const wrong = secret.otp === '0000' ? '1111' : '0000';
  const w = await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: wrong, location: loc(11.0505, 77.0505) });
  assert.equal(w.ok, false); assert.match(w.message, /not correct/);
  for (let i = 0; i < 3; i++) await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: wrong, location: loc(11.0505, 77.0505) });
  const locked = await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: wrong, location: loc(11.0505, 77.0505) }); // 5th wrong code
  assert.equal(locked.ok, false); assert.match(locked.message, /Too many/);
  const blocked = await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: secret.otp, location: loc(11.0505, 77.0505) });
  assert.equal(blocked.ok, false); assert.match(blocked.message, /Too many|Try again/); // the lock holds even for the right code
  await db.doc(`lt_ride_secrets/${id}`).update({ 'attempts.lockedUntilMs': 0 }); // staff-side reset, as the lock expiring would do
  const ok = await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: secret.otp, location: loc(11.0505, 77.0505) });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const replay = await call(d, 'ltDriverAdvance', { rideId: id, action: 'start', otp: secret.otp, location: loc(11.0505, 77.0505) });
  assert.equal(replay.ok, false); // a replayed code finds the ride already started
  assert.equal((await call(C1, 'ltCancelRide', { rideId: id })).ok, false); // a ride in progress cannot be cancelled by the customer
});

test('live tracking, then completion with a server-computed fare; fare edits and zone changes never touch a ride in progress', async () => {
  const id = H.rideId, d = H.winner;
  const live = await call(d, 'ltUpdateLocation', { location: loc(11.055, 77.055) });
  assert.equal(live.ok, true);
  assert.equal((await db.doc(`lt_ride_live/${id}`).get()).data().location.lat, 11.055);
  assert.equal((await call(C1, 'ltGetRide', { rideId: id })).ok, true);
  // An admin now changes the fare and switches the zone off: the ride keeps its own snapshot.
  const v2 = await call(ADMIN, 'ltSaveFare', { zoneId: 'lt-test', categoryId: 'lt-sedan', config: { ...FARE, baseFarePaise: 99000, minimumFarePaise: 99000 }, sample: true });
  assert.equal(v2.data.version, 2);
  assert.equal((await call(ADMIN, 'ltActivateFare', { fareId: v2.data.fareId })).ok, true);
  assert.equal((await call(ADMIN, 'ltSetZoneStatus', { zoneId: 'lt-test', status: 'inactive' })).ok, true);
  assert.equal((await call(C2, 'ltGetQuotes', { pickup: PICKUP, drop: DROP })).ok, false); // new bookings stop
  const done = await call(d, 'ltDriverAdvance', { rideId: id, action: 'complete', location: loc(11.06, 77.06) });
  assert.equal(done.ok, true, JSON.stringify(done));
  const rd = await ride(id);
  assert.equal(rd.status, 'completed');
  assert.equal(rd.final.fareVersion, 1); // priced with the version it was booked under
  assert.ok(rd.final.totalPaise < 20000 && rd.final.totalPaise >= 8000, String(rd.final.totalPaise));
  assert.equal(rd.final.basis, 'quoted'); // too few tracked points to trust: the quote distance stands
  assert.equal(rd.paymentStatus, 'cash_due');
  assert.equal(await activeRideOf(d), null);
  assert.equal((await db.doc(`lt_ride_live/${id}`).get()).exists, false); // location is no longer exposed
  assert.equal((await db.doc(`lt_ride_secrets/${id}`).get()).data().otp, ''); // the code is spent
  const events = await db.collection(`lt_rides/${id}/events`).get();
  assert.ok(events.size >= 8);
  await call(ADMIN, 'ltSetZoneStatus', { zoneId: 'lt-test', status: 'active' });
});

test('cash and rating: the amount collected must match, once; the customer rates once', async () => {
  const id = H.rideId, d = H.winner;
  const total = (await ride(id)).final.totalPaise;
  assert.equal((await call(d, 'ltDriverAdvance', { rideId: id, action: 'collect_cash', amountPaise: total - 100 })).ok, false);
  assert.equal((await call(d, 'ltDriverAdvance', { rideId: id, action: 'collect_cash', amountPaise: total })).ok, true);
  assert.equal((await ride(id)).paymentStatus, 'cash_collected');
  assert.equal((await db.doc(`lt_settlements/${id}`).get()).data().status, 'cash_collected');
  assert.equal((await call(C2, 'ltRateRide', { rideId: id, rating: 5 })).ok, false);
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 9 })).ok, false);
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 5, comment: 'good' })).ok, true);
  assert.equal((await call(C1, 'ltRateRide', { rideId: id, rating: 4 })).ok, false); // once only
  assert.equal((await call(C1, 'ltCreatePaymentOrder', { rideId: id })).ok, false); // no provider keys / cash ride
});

test('cancellation: free while searching; a fee after the grace period must be acknowledged; the driver is freed', async () => {
  await freeEveryone();
  const a = await newRide(C1);
  assert.equal((await call(C1, 'ltCancellationQuote', { rideId: a.requestId })).data.feePaise, 0);
  assert.equal((await call(C1, 'ltCancelRide', { rideId: a.requestId })).data.feePaise, 0);
  assert.equal((await ride(a.requestId)).status, 'cancelled');
  // fare v2 has the default grace (1 h), so use a fresh version with no grace for the fee case
  const v3 = await call(ADMIN, 'ltSaveFare', { zoneId: 'lt-test', categoryId: 'lt-sedan', config: { ...FARE, cancellation: { feePaise: 3000, graceSeconds: 0 } }, sample: true });
  assert.equal((await call(ADMIN, 'ltActivateFare', { fareId: v3.data.fareId })).ok, true);
  const b = await newRide(C1);
  const offerDriver = (await ride(b.requestId)).currentOfferId.split('__')[1];
  assert.equal((await call(offerDriver, 'ltRespondOffer', { offerId: `${b.requestId}__${offerDriver}`, accept: true })).ok, true);
  await new Promise((r) => setTimeout(r, 1100));
  const quoted = await call(C1, 'ltCancellationQuote', { rideId: b.requestId });
  assert.equal(quoted.data.feePaise, 3000);
  const noAck = await call(C1, 'ltCancelRide', { rideId: b.requestId });
  assert.equal(noAck.ok, false); assert.match(noAck.message, /CANCELLATION_FEE/);
  const yes = await call(C1, 'ltCancelRide', { rideId: b.requestId, acceptFeePaise: 3000 });
  assert.equal(yes.ok, true); assert.equal(yes.data.feePaise, 3000);
  const rd = await ride(b.requestId);
  assert.equal(rd.paymentStatus, 'cancellation_fee_due');
  assert.equal(await activeRideOf(offerDriver), null);
  assert.equal((await call(C1, 'ltCancelRide', { rideId: b.requestId })).ok, false); // already ended
});

test('a driver who gives the ride back sends it to the next driver; a rejected offer moves on', async () => {
  await freeEveryone();
  const a = await newRide(C1);
  const first = (await ride(a.requestId)).currentOfferId.split('__')[1];
  assert.equal((await call(first, 'ltRespondOffer', { offerId: `${a.requestId}__${first}`, accept: false })).ok, true);
  const second = first === D1 ? D2 : D1;
  const rd = await until(async () => { const x = await ride(a.requestId); return x.currentOfferId === `${a.requestId}__${second}` && x; }, { what: 'offer to the other driver' });
  assert.deepEqual(rd.offeredDriverIds.sort(), [D1, D2]);
  assert.equal((await call(second, 'ltRespondOffer', { offerId: `${a.requestId}__${second}`, accept: true })).ok, true);
  const released = await call(second, 'ltDriverAdvance', { rideId: a.requestId, action: 'release', reason: 'Vehicle problem' });
  assert.equal(released.ok, true);
  const after = await ride(a.requestId);
  assert.equal(after.status, 'searching'); assert.equal(after.reassignments, 1); assert.equal(after.driverId, '');
  assert.equal(await activeRideOf(second), null);
  assert.equal((await call(ADMIN, 'ltAdminCancelRide', { rideId: a.requestId, reason: 'test cleanup' })).ok, true);
});

test('no driver available: stale locations are never offered, and the search ends cleanly', async () => {
  await freeEveryone();
  for (const uid of [D1, D2]) await db.doc(`lt_driver_state/${uid}`).update({ 'location.atMs': Date.now() - 10 * 60000 }); // both fixes are stale
  const a = await newRide(C1);
  assert.equal((await ride(a.requestId)).currentOfferId, ''); // nobody offered
  await db.doc(`lt_rides/${a.requestId}`).update({ searchStartedAtMs: Date.now() - 10 * 60000 });
  const r = await call(C1, 'ltGetRide', { rideId: a.requestId });
  assert.equal(r.data.ride.status, 'no_driver_available');
  assert.equal((await db.doc(`lt_customer_state/${C1}`).get()).data().activeRideId, ''); // the customer can book again
});

test('driver offline and availability rules', async () => {
  await freeEveryone();
  assert.equal((await call(D1, 'ltSetAvailability', { online: false })).ok, true);
  assert.equal((await db.doc(`lt_driver_state/${D1}`).get()).data().available, false);
  const a = await newRide(C1);
  const rd = await ride(a.requestId);
  assert.equal(rd.currentOfferId, `${a.requestId}__${D2}`); // the offline driver is skipped
  assert.equal((await call(ADMIN, 'ltAssignRide', { rideId: a.requestId, driverId: D1 })).ok, false); // staff cannot bypass availability
  assert.equal((await call(D2, 'ltRespondOffer', { offerId: `${a.requestId}__${D2}`, accept: true })).ok, true);
  assert.equal((await call(D2, 'ltSetAvailability', { online: false })).ok, false); // busy: cannot go offline
  await call(ADMIN, 'ltAdminCancelRide', { rideId: a.requestId, reason: 'test cleanup' });
});
