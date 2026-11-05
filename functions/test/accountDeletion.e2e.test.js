// Account deletion requests: every signed-in role can ask, nothing is erased automatically, repeats do not duplicate,
// and a stranger without an account is turned away. Emulator only (demo project).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, call } = require('./helpers.e2e');

const stamp = Date.now().toString(36);

test('a customer can request deletion once; the request reaches Support and the account is left intact', async () => {
  const uid = `del_customer_${stamp}`;
  await db.doc(`customers/${uid}`).set({ name: 'Delete Me', phone: '+919000000001', email: '' });
  await db.doc(`bookings/del_open_${stamp}`).set({ customerId: uid, status: 'Pending' });
  await db.doc(`bookings/del_done_${stamp}`).set({ customerId: uid, status: 'Completed' });

  const first = await call(uid, 'requestAccountDeletion', { role: 'customer', reason: 'No longer travelling' });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.data.requested, true);
  assert.equal(first.data.alreadyOpen, false);
  assert.equal(first.data.liveBookings, 1, 'only the Pending booking is still open');

  const ticket = (await db.doc(`support_tickets/acctdel_${uid}`).get()).data();
  assert.equal(ticket.category, 'Account deletion');
  assert.equal(ticket.status, 'Open');
  assert.equal(ticket.customerId, uid);
  assert.equal(ticket.source, 'account-deletion');
  assert.match(ticket.description, /1 booking\(s\) still open/);

  // Nothing is erased by the request itself.
  assert.equal((await db.doc(`customers/${uid}`).get()).data().name, 'Delete Me');

  // A repeated tap does not create a second ticket.
  const again = await call(uid, 'requestAccountDeletion', {});
  assert.equal(again.ok, true);
  assert.equal(again.data.alreadyOpen, true);
  const tickets = await db.collection('support_tickets').where('customerId', '==', uid).get();
  assert.equal(tickets.size, 1);

  const audit = await db.collection('audit_logs').where('entityId', '==', `acctdel_${uid}`).get();
  assert.ok(audit.size >= 1, 'the request is audited');
});

test('drivers and vendors can request deletion with their own role recorded', async () => {
  const driver = `del_driver_${stamp}`;
  const vendor = `del_vendor_${stamp}`;
  await db.doc(`drivers/${driver}`).set({ name: 'Driver D', phone: '+919000000002', status: 'Approved' });
  await db.doc(`vendors/${vendor}`).set({ companyName: 'Vendor V', phone: '+919000000003', status: 'APPROVED' });
  assert.equal((await call(driver, 'requestAccountDeletion', {})).ok, true);
  assert.equal((await call(vendor, 'requestAccountDeletion', { role: 'vendor' })).ok, true);
  assert.equal((await db.doc(`support_tickets/acctdel_${driver}`).get()).data().accountRole, 'driver');
  assert.equal((await db.doc(`support_tickets/acctdel_${vendor}`).get()).data().accountRole, 'vendor');
});

test('someone with no account, or no sign-in, is refused', async () => {
  const stranger = await call(`del_nobody_${stamp}`, 'requestAccountDeletion', {});
  assert.equal(stranger.ok, false);
  assert.equal(stranger.status, 'FAILED_PRECONDITION');
  const r = await fetch('http://127.0.0.1:5001/demo-nesam/us-central1/requestAccountDeletion', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: {} }),
  });
  assert.equal((await r.json()).error.status, 'UNAUTHENTICATED');
});

test('a closed request can be raised again', async () => {
  const uid = `del_again_${stamp}`;
  await db.doc(`customers/${uid}`).set({ name: 'Again', phone: '+919000000004' });
  assert.equal((await call(uid, 'requestAccountDeletion', {})).data.alreadyOpen, false);
  await db.doc(`support_tickets/acctdel_${uid}`).update({ status: 'Closed' });
  const next = await call(uid, 'requestAccountDeletion', {});
  assert.equal(next.data.alreadyOpen, false);
  assert.equal((await db.doc(`support_tickets/acctdel_${uid}`).get()).data().status, 'Open');
});

test.after(async () => { await db.terminate(); });
