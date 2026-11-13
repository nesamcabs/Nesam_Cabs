// Notifications are stored in one inbox per panel (functions/src/notify.ts) and each app can read only its own.
// Runs inside `firebase emulators:exec` (auth + firestore + functions). Nothing here can reach production.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./helpers.e2e');
const N = require('../lib/notify');
const { noticeFromRequest } = require('../lib/notificationTriggers');
const { migrate } = require(path.resolve(__dirname, '../../scripts/migrate-notifications.cjs'));

const { db, FS, tokenFor, rest, until } = H;
const INBOXES = ['customer_notifications', 'driver_notifications', 'vendor_notifications', 'admin_notifications'];
const stamp = Date.now().toString(36);
const ALL_ROLES = `multi_${stamp}`; // one login that is a rider, a driver and a vendor
const OTHER = `other_${stamp}`;
const STAFF = `staff_${stamp}`;

/** A list query through the rules, as `uid` (what an app's onSnapshot does). */
async function listAs(uid, collectionId, recipientId) {
  const r = await fetch(`${FS}:runQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: 'recipientId' }, op: 'EQUAL', value: { stringValue: recipientId } } },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
      limit: 200,
    } }),
  });
  const body = await r.json().catch(() => []);
  return { ok: r.ok, status: r.status, docs: Array.isArray(body) ? body.filter((x) => x.document).map((x) => x.document) : [] };
}

const enc = (v) => (v === null ? { nullValue: null } : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) });

/** A client create with createdAt = request.time (the SDK's serverTimestamp()), through the rules, as `uid`. */
async function createAs(uid, collectionId, id, fields) {
  const name = `projects/${H.PROJECT}/databases/(default)/documents/${collectionId}/${id}`;
  const r = await fetch(`${FS}:commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ writes: [{
      update: { name, fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    }] }),
  });
  return { ok: r.ok, status: r.status };
}

/** A field-masked client update, through the rules, as `uid`. */
async function patchAs(uid, docPath, fields) {
  const r = await fetch(`${FS}/${docPath}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }),
  });
  return { ok: r.ok, status: r.status };
}

const countIn = async (coll, field, value) => (await db.collection(coll).where(field, '==', value).get()).size;

test.before(async () => {
  // The same uid holds all three partner/rider profiles.
  await Promise.all([
    db.doc(`customers/${ALL_ROLES}`).set({ name: 'Multi Role', status: 'Approved' }),
    db.doc(`drivers/${ALL_ROLES}`).set({ name: 'Multi Role', status: 'Approved' }),
    db.doc(`vendors/${ALL_ROLES}`).set({ companyName: 'Multi Role Travels', status: 'APPROVED' }),
    db.doc(`customers/${OTHER}`).set({ name: 'Other Rider', status: 'Approved' }),
    db.doc(`admins/${STAFF}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Inbox audit staff' }),
    db.doc('settings/config').set({ pushEnabled: true }, { merge: true }),
  ]);
});

test('N1. one login that is a rider, a driver and a vendor: each notification lands only in its own panel inbox', async () => {
  const legacyBefore = (await db.collection('notifications').get()).size;
  const base = { category: 'bookings', severity: 'success', sound: 'approval', push: false };
  const ids = {
    customer: await N.notify({ ...base, recipientType: 'customer', recipientId: ALL_ROLES, brand: 'nesam', title: `Booking confirmed ${stamp}`, message: 'Rider only' }),
    driver: await N.notify({ ...base, recipientType: 'driver', recipientId: ALL_ROLES, title: `Trip assigned to you ${stamp}`, message: 'Driver only' }),
    vendor: await N.notify({ ...base, recipientType: 'vendor', recipientId: ALL_ROLES, title: `Trip assigned to your fleet ${stamp}`, message: 'Vendor only' }),
    admin: await N.notify({ ...base, recipientType: 'admin', recipientId: 'admin', title: `New booking request ${stamp}`, message: 'Office only' }),
  };
  for (const [audience, id] of Object.entries(ids)) {
    assert.ok(id, `${audience} stored`);
    for (const coll of INBOXES) {
      const there = (await db.doc(`${coll}/${id}`).get()).exists;
      assert.equal(there, coll === `${audience}_notifications`, `${audience} record ${there ? 'found' : 'missing'} in ${coll}`);
    }
    const rec = (await db.doc(`${audience}_notifications/${id}`).get()).data();
    assert.equal(rec.recipientType, audience);
    assert.equal(rec.read, false);
    assert.ok(rec.createdAt, 'createdAt is set (the apps order by it)');
    const log = await db.collection('notification_deliveries').where('notificationId', '==', id).get();
    assert.equal(log.docs.filter((d) => d.data().channel === 'in_app').length, 1);
    assert.equal(log.docs[0].data().inbox, `${audience}_notifications`);
  }
  assert.equal((await db.collection('notifications').get()).size, legacyBefore, 'nothing is written to the old shared collection');
});

test('N2. the rules let each panel read only its own inbox, and recipients may only mark their own records read', async () => {
  // Each app's query returns exactly that panel's record for the multi-role login.
  for (const [coll, title] of [['customer_notifications', 'Booking confirmed'], ['driver_notifications', 'Trip assigned to you'], ['vendor_notifications', 'Trip assigned to your fleet']]) {
    const r = await listAs(ALL_ROLES, coll, ALL_ROLES);
    assert.equal(r.ok, true, `${coll} query allowed (${r.status})`);
    const titles = r.docs.map((d) => d.fields.title.stringValue);
    assert.ok(titles.includes(`${title} ${stamp}`), `${coll} has its record`);
    assert.ok(titles.every((t) => t.startsWith(title)), `${coll} holds only ${title}: ${titles.join(' | ')}`);
  }
  // Someone else's inbox, the office inbox and the legacy collection are closed to a rider / partner.
  assert.equal((await listAs(OTHER, 'customer_notifications', ALL_ROLES)).ok, false, 'another rider cannot list my inbox');
  assert.equal((await listAs(ALL_ROLES, 'admin_notifications', 'admin')).ok, false, 'a rider cannot read the office inbox');
  assert.equal((await listAs(ALL_ROLES, 'notifications', ALL_ROLES)).ok, false, 'nobody but staff reads the legacy collection');
  // Staff read every inbox.
  for (const coll of INBOXES) assert.equal((await listAs(STAFF, coll, coll === 'admin_notifications' ? 'admin' : ALL_ROLES)).ok, true, `staff reads ${coll}`);

  const mine = (await db.collection('customer_notifications').where('recipientId', '==', ALL_ROLES).limit(1).get()).docs[0];
  assert.equal((await rest(OTHER, `customer_notifications/${mine.id}`)).status, 403, 'another rider cannot open my record');
  assert.equal((await patchAs(ALL_ROLES, `customer_notifications/${mine.id}`, { title: 'Changed' })).ok, false, 'a recipient cannot rewrite a record');
  assert.equal((await patchAs(ALL_ROLES, `customer_notifications/${mine.id}`, { read: false })).ok, false, 'marking read is one-way');
  assert.equal((await patchAs(OTHER, `customer_notifications/${mine.id}`, { read: true })).ok, false, 'nobody else can mark it read');
  assert.equal((await patchAs(ALL_ROLES, `customer_notifications/${mine.id}`, { read: true })).ok, true, 'the recipient marks it read');
  assert.equal((await db.doc(`customer_notifications/${mine.id}`).get()).data().read, true);
  // Apps never create records.
  assert.equal((await createAs(ALL_ROLES, 'customer_notifications', `forged_${stamp}`, { recipientId: ALL_ROLES, recipientType: 'customer', title: 'Forged', message: '', read: false })).ok, false);
  assert.equal((await createAs(ALL_ROLES, 'driver_notifications', `forged_${stamp}`, { recipientId: ALL_ROLES, recipientType: 'driver', title: 'Forged', message: '', read: false })).ok, false);
});

test('N3. undeliverable notifications are skipped, never stored under an id no app can read', async () => {
  const title = `Undeliverable ${stamp}`;
  assert.equal(await N.notify({ recipientType: 'customer', recipientId: '', category: 'trips', title, message: 'x', push: false }), null);
  assert.equal(await N.notify({ recipientType: 'driver', recipientId: '   ', category: 'trips', title, message: 'x', push: false }), null);
  assert.equal(await N.notify({ recipientType: 'rider', recipientId: ALL_ROLES, category: 'trips', title, message: 'x', push: false }), null);
  // Inside a transaction too: nothing is written and the push list skips it.
  let inTx = 'unset';
  await db.runTransaction(async (tx) => { inTx = N.notifyInTx(tx, { recipientType: 'customer', recipientId: '', category: 'trips', title, message: 'x' }); });
  assert.equal(inTx, '');
  await N.pushAfterCommit([{ id: inTx, input: { recipientType: 'customer', recipientId: '', category: 'trips', title, message: 'x' } }]);
  for (const coll of [...INBOXES, 'notifications']) assert.equal(await countIn(coll, 'title', title), 0, coll);
  // The office inbox always has the literal recipient 'admin'.
  const id = await N.notify({ recipientType: 'admin', recipientId: 'someone', category: 'general', title: `Office ${stamp}`, message: 'x', push: false });
  assert.equal((await db.doc(`admin_notifications/${id}`).get()).data().recipientId, 'admin');
});

test('N4. extra fields can never change who a record is for', async () => {
  const id = await N.notify({ recipientType: 'driver', recipientId: ALL_ROLES, category: 'general', title: `Meta ${stamp}`, message: 'x', push: false,
    meta: { recipientId: OTHER, recipientType: 'customer', read: true, campaignId: `camp_${stamp}` } });
  const rec = (await db.doc(`driver_notifications/${id}`).get()).data();
  assert.equal(rec.recipientId, ALL_ROLES);
  assert.equal(rec.recipientType, 'driver');
  assert.equal(rec.read, false);
  assert.equal(rec.campaignId, `camp_${stamp}`);
});

test('N5. a de-duplicated alert repeats in no inbox, and inboxes never collide', async () => {
  const key = `dedupe_${stamp}`;
  const input = { recipientType: 'driver', recipientId: ALL_ROLES, category: 'general', title: `Licence expires ${stamp}`, message: 'x', push: false, dedupeKey: key };
  assert.ok(await N.notify(input));
  assert.equal(await N.notify(input), null, 'the same alert is stored once');
  assert.ok(await N.notify({ ...input, recipientType: 'vendor' }), 'the vendor inbox is separate');
  assert.equal(await countIn('driver_notifications', 'dedupeKey', key), 1);
  assert.equal(await countIn('vendor_notifications', 'dedupeKey', key), 1);
});

test('N6. money in a notification is never shown as ₹18,907.9', () => {
  assert.equal(N.inr(18907.9), '₹18,907.90');
  assert.equal(N.inr(18908), '₹18,908');
  assert.equal(N.inr(1234567.456), '₹12,34,567.46');
  assert.equal(N.inr('2350'), '₹2,350');
  assert.equal(N.inr(undefined), '₹0');
});

test('N7. a push goes only to the devices registered by that panel\'s app', () => {
  const docs = [
    { id: 'a', data: () => ({ token: 'T-rider', role: 'customer' }) },
    { id: 'b', data: () => ({ token: 'T-driver', role: 'driver' }) },
    { id: 'c', data: () => ({ token: 'T-vendor', role: 'vendor' }) },
    { id: 'd', data: () => ({ token: 'T-driver', role: 'driver' }) }, // registered twice
    { id: 'e', data: () => ({ token: 'T-unknown' }) }, // no app recorded
    { id: 'f', data: () => ({ role: 'driver' }) }, // no token
  ];
  assert.deepEqual(N.pushTargets('customer', docs).map((t) => t.token), ['T-rider']);
  assert.deepEqual(N.pushTargets('driver', docs).map((t) => t.token), ['T-driver']);
  assert.deepEqual(N.pushTargets('vendor', docs).map((t) => t.token), ['T-vendor']);
  assert.deepEqual(N.pushTargets('admin', docs), []);
});

test('N8. device tokens must name the app (role) that registered them', async () => {
  // Registered for OTHER, who is never sent a push here (a real FCM call must not happen in the emulator).
  const fields = { ownerId: OTHER, token: `tok_${stamp}`, platform: 'android' };
  const post = async (id, extra) => fetch(`${FS}/device_tokens?documentId=${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(OTHER)}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries({ ...fields, ...extra }).map(([k, v]) => [k, enc(v)])) }),
  });
  assert.equal((await post(`${OTHER}_x_${stamp}`, {})).ok, false, 'no role');
  assert.equal((await post(`${OTHER}_admin_${stamp}`, { role: 'admin' })).ok, false, 'not an app audience');
  assert.equal((await post(`${OTHER}_driver_${stamp}`, { role: 'driver' })).ok, true, 'driver app token');
});

test('N9. a staff decision reaches only that partner\'s inbox through the server, which pushes and logs it', async () => {
  const req = { audience: 'driver', recipientId: ALL_ROLES, title: `Account approved ${stamp}`, message: 'Your NESAM partner account is approved.', category: 'approvals', severity: 'success', sentBy: STAFF };
  // Staff cannot write an inbox directly, even with every field right.
  assert.equal((await createAs(STAFF, 'driver_notifications', `direct_${stamp}`, { recipientId: ALL_ROLES, recipientType: 'driver', title: 'Direct', message: '', read: false })).ok, false, 'no client writes an inbox');
  assert.equal((await createAs(ALL_ROLES, 'partner_notice_requests', `rq_rider_${stamp}`, { ...req, sentBy: ALL_ROLES })).ok, false, 'only staff file requests');
  assert.equal((await createAs(STAFF, 'partner_notice_requests', `rq_cust_${stamp}`, { ...req, audience: 'customer' })).ok, false, 'never a rider inbox');
  assert.equal((await createAs(STAFF, 'partner_notice_requests', `rq_imp_${stamp}`, { ...req, sentBy: OTHER })).ok, false, 'sentBy must be the writer');
  assert.equal((await createAs(STAFF, 'partner_notice_requests', `rq_extra_${stamp}`, { ...req, recipientType: 'customer' })).ok, false, 'no extra fields');
  const id = `rq_${stamp}`;
  assert.equal((await createAs(STAFF, 'partner_notice_requests', id, req)).ok, true, 'a valid staff request is accepted');

  const done = await until(async () => {
    const d = (await db.doc(`partner_notice_requests/${id}`).get()).data();
    return d && d.status ? d : null;
  }, { timeout: 60000, what: 'the partner notice request to be processed' });
  assert.equal(done.status, 'Delivered');
  const rec = (await db.doc(`driver_notifications/${done.notificationId}`).get()).data();
  assert.equal(rec.recipientId, ALL_ROLES);
  assert.equal(rec.recipientType, 'driver');
  assert.equal(rec.title, req.title);
  assert.equal(rec.sentBy, STAFF);
  for (const coll of ['customer_notifications', 'vendor_notifications', 'admin_notifications']) assert.equal(await countIn(coll, 'title', req.title), 0, `not in ${coll}`);
  const rows = await db.collection('notification_deliveries').where('notificationId', '==', done.notificationId).get();
  assert.deepEqual(rows.docs.map((d) => d.data().channel).sort(), ['in_app', 'push'], 'stored and pushed (push logged as skipped: no driver-app device here)');

  // A retried event (same request) never notifies twice.
  assert.equal(await N.notify(noticeFromRequest(id, req)), null);
  assert.equal(await countIn('driver_notifications', 'title', req.title), 1);
  assert.equal(noticeFromRequest('x', { ...req, audience: 'customer' }), null);
  assert.equal(noticeFromRequest('x', { ...req, recipientId: '' }), null);
  assert.equal(noticeFromRequest('x', { ...req, category: 'nonsense' }).category, 'approvals');
});

test('N10. the migration moves every legacy record into the right inbox, once, and leaves the undecidable ones', async () => {
  const L = (id) => db.doc(`notifications/${id}`);
  const legacyId = (k) => `legacy_${stamp}_${k}`;
  await Promise.all([
    L(legacyId('cust')).set({ recipientId: ALL_ROLES, recipientType: 'customer', title: 'Booking confirmed (old)', message: 'm', read: false, createdAt: H.TS.now(), brand: 'nesam' }),
    L(legacyId('drv')).set({ recipientId: ALL_ROLES, recipientType: 'driver', title: 'Trip assigned (old)', message: 'm', read: true, createdAt: H.TS.now() }),
    L(legacyId('office')).set({ recipientId: 'admin', title: 'Office (old)', message: 'm', read: false }),
    L(legacyId('system')).set({ title: 'System alert (old)', message: 'm' }),
    L(legacyId('onlyrider')).set({ recipientId: OTHER, title: 'No role (old)', message: 'm', read: false, createdAt: H.TS.now() }),
    L(legacyId('hinted')).set({ recipientId: ALL_ROLES, type: 'vendor', title: 'Vendor approved (old)', message: 'm', read: false, createdAt: H.TS.now() }),
    L(legacyId('ambiguous')).set({ recipientId: ALL_ROLES, type: 'booking', title: 'Ambiguous (old)', message: 'm', read: false, createdAt: H.TS.now() }),
    L(legacyId('orphan')).set({ recipientId: '', recipientType: 'customer', title: 'Orphan (old)', message: 'm' }),
  ]);
  const opts = { limit: 2000 };
  const dry = await migrate(db, H.admin, opts);
  assert.equal(dry.counts.copied, 0, 'a dry run writes nothing');
  assert.ok(dry.counts.wouldCopy >= 6);
  assert.equal((await db.doc(`customer_notifications/${legacyId('cust')}`).get()).exists, false);

  const run = await migrate(db, H.admin, { ...opts, apply: true });
  assert.ok(run.unresolved.includes(legacyId('ambiguous')));
  const where = {
    cust: 'customer_notifications', drv: 'driver_notifications', office: 'admin_notifications', system: 'admin_notifications',
    onlyrider: 'customer_notifications', hinted: 'vendor_notifications',
  };
  for (const [k, coll] of Object.entries(where)) {
    const snap = await db.doc(`${coll}/${legacyId(k)}`).get();
    assert.ok(snap.exists, `${k} → ${coll}`);
    assert.ok(snap.data().createdAt, `${k} has createdAt`);
    assert.equal(snap.data().migratedFrom, 'notifications');
    for (const other of INBOXES.filter((c) => c !== coll)) assert.equal((await db.doc(`${other}/${legacyId(k)}`).get()).exists, false, `${k} not in ${other}`);
  }
  assert.equal((await db.doc(`driver_notifications/${legacyId('drv')}`).get()).data().read, true, 'read state is kept');
  assert.equal((await db.doc(`admin_notifications/${legacyId('system')}`).get()).data().recipientId, 'admin');
  for (const coll of INBOXES) assert.equal((await db.doc(`${coll}/${legacyId('orphan')}`).get()).exists, false, 'an orphan is not copied');

  const again = await migrate(db, H.admin, { ...opts, apply: true });
  assert.equal(again.counts.copied, 0, 're-running copies nothing twice');

  await migrate(db, H.admin, { ...opts, apply: true, deleteLegacy: true });
  for (const k of Object.keys(where)) assert.equal((await L(legacyId(k)).get()).exists, false, `legacy ${k} deleted after its copy`);
  assert.equal((await L(legacyId('ambiguous')).get()).exists, true, 'an unresolved record stays where it was');
});
