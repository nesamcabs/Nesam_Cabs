// Customers Directory against the emulators: real rules, real callables, Master / Staff identities. Demo project only.
const test = require('node:test');
const assert = require('node:assert/strict');
if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== 'demo-nesam') throw Error('Run with demo-nesam emulators only');
const H = require('./helpers.e2e');

const MASTER = 'cd-master';
const STAFF = 'cd-staff';          // Customers view+edit+create, may reveal
const VIEWER = 'cd-viewer';        // Customers view only
const NOBODY = 'cd-nobody';        // a customer account, not staff
const matrix = (modules, privacy = {}) => ({ modules, accountControls: {}, bankLimit: 0, sensitive: {}, privacy, fleetSwap: {}, partnerRights: {} });
const RAW = '9876543210';

test.before(async () => {
  await H.db.doc(`admins/${MASTER}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Master Admin' });
  await H.db.doc(`admins/${STAFF}`).set({ role: 'admin', status: 'active', staffRole: 'individual', name: 'Karthik Raja', permissions: ['people'], staffAccess: matrix({ Customers: ['view', 'edit', 'create'] }, { temporaryReveal: true }) });
  await H.db.doc(`admins/${VIEWER}`).set({ role: 'admin', status: 'active', staffRole: 'individual', name: 'View Only', permissions: ['people'], staffAccess: matrix({ Customers: ['view'] }) });
  await H.db.doc(`customers/${NOBODY}`).set({ name: 'Plain Customer', phone: '+91 90000 11111', status: 'Approved', role: 'customer' });
  // Legacy record: stale counters, "N/A" email, phone written without formatting.
  await H.db.doc('customers/legacy1').set({ name: 'Legacy Rider', phone: RAW, email: 'N/A', status: 'Approved', bookings: 77, spent: 999999, notes: 'old note' });
  await H.db.doc('customers/corp1').set({ name: 'Sri Tex', phone: '+919842277890', status: 'Active', isCorporate: true, gstin: '33AABCS8890K1Z2', company: 'Sri Tex Exports', leadSource: 'Corporate B2B' });
  await H.db.doc('bookings/b1').set({ customerId: 'corp1', brand: 'people_taxi', status: 'Completed', createdAt: H.TS.now() });
  await H.db.doc('bookings/b2').set({ phone: '9876543210', status: 'Completed', createdAt: H.TS.now() });           // unlinked legacy booking, no brand
  await H.db.doc('booking_contacts/b3').set({ phone: '+91 98422 77890', name: 'x', customerId: '' });
  await H.db.doc('bookings/b3').set({ phoneMasked: '+91 98••• ••890', status: 'Completed', brand: 'nesam', createdAt: H.TS.now() });
  await H.db.doc('saved_places/sp1').set({ ownerId: 'legacy1', name: 'Home', address: 'RS Puram, Coimbatore' });
});

test('direct reads: Master and the owner can read a customer document; a Staff ID cannot (it carries the raw number)', async () => {
  assert.equal((await H.rest(MASTER, 'customers/legacy1')).status, 200);
  assert.equal((await H.rest(NOBODY, `customers/${NOBODY}`)).status, 200);
  assert.equal((await H.rest(STAFF, 'customers/legacy1')).status, 403);
  assert.equal((await H.rest(VIEWER, 'customers/legacy1')).status, 403);
  assert.equal((await H.rest(NOBODY, 'customers/legacy1')).status, 403);
});

test('direct writes: no Staff ID may create or change a customer document; the trusted function is the path', async () => {
  assert.equal((await H.clientPatch(STAFF, 'customers/legacy1', { phone: '9000000001' })).ok, false);
  assert.equal((await H.clientPatch(STAFF, 'customers/legacy1', { notes: 'direct edit' })).ok, false);
  assert.equal((await H.clientCreate(STAFF, 'customers', 'direct1', { name: 'Direct', phone: '9111111111', status: 'Active', role: 'staff-made' })).ok, false);
  assert.equal((await H.db.doc('customers/legacy1').get()).data().phone, RAW);
});

test('the directory projection reaches Staff without any raw number', async () => {
  for (const who of [STAFF, VIEWER]) {
    const r = await H.call(who, 'getCustomerDirectory', { directory: true });
    assert.ok(r.ok, JSON.stringify(r));
    const body = JSON.stringify(r.data);
    for (const raw of ['9876543210', '98765 43210', '9842277890', '98422 77890', '9000011111', '90000 11111']) assert.ok(!body.includes(raw), `${who} received ${raw}`);
    const legacy = r.data.customers.find((c) => c.id === 'legacy1');
    assert.equal(legacy.phone, '');
    assert.equal(legacy.phoneMasked, '+91 98765 •••••');
    assert.equal(legacy.email, '');
    assert.equal(legacy.customerCode, 'NSM-CU-LEGACY');
    assert.ok(!('bookings' in legacy) && !('spent' in legacy));
  }
  const master = (await H.call(MASTER, 'getCustomerDirectory', { directory: true })).data;
  assert.equal(master.viewer.canExport, true);
  assert.equal(JSON.stringify(master).includes('98765 43210'), false, 'the Master list is masked too');
});

test('ownership and brand come from bookings: by id, by unambiguous mobile (booking or contact document), never guessed', async () => {
  const { customers } = (await H.call(STAFF, 'getCustomerDirectory', { directory: true })).data;
  const corp = customers.find((c) => c.id === 'corp1');
  const legacy = customers.find((c) => c.id === 'legacy1');
  assert.deepEqual(corp.linkedBookingIds, ['b3'], 'the unlinked booking is linked through its contact document');
  assert.deepEqual([...corp.brands].sort(), ['nesam', 'people_taxi']);
  assert.deepEqual(legacy.linkedBookingIds, ['b2']);
  assert.deepEqual(legacy.brands, [], 'a booking with no recorded brand gives the customer no brand');
  assert.equal(corp.isCorporate, true);
  assert.equal(corp.leadSource, 'Corporate B2B');
});

test('a non-staff account gets nothing from the directory functions', async () => {
  for (const [fn, data] of [['getCustomerDirectory', {}], ['revealCustomerNumber', { customerId: 'legacy1', category: 'New booking confirmation call', note: 'confirming pickup' }], ['getCustomerNumberViews', {}], ['exportCustomerNumbers', { customerIds: ['legacy1'], includeNumbers: false }], ['saveCustomerProfile', { name: 'Nope', phone: '9222222222' }], ['findCustomerByMobile', { phone: RAW }]]) {
    const r = await H.call(NOBODY, fn, data);
    assert.equal(r.ok, false, fn);
    assert.equal(r.status, 'PERMISSION_DENIED', fn);
  }
});

test('reveal: denied without the right, validated, logged with the actor, and the number returned only afterwards', async () => {
  const cat = 'Pickup landmark / address clarification';
  const denied = await H.call(VIEWER, 'revealCustomerNumber', { customerId: 'legacy1', category: cat, note: 'confirming the gate' });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 'PERMISSION_DENIED');
  assert.ok(!JSON.stringify(denied).includes('98765 43210'));

  const noCat = await H.call(STAFF, 'revealCustomerNumber', { customerId: 'legacy1', category: 'because', note: 'confirming the gate' });
  assert.equal(noCat.status, 'INVALID_ARGUMENT');
  const short = await H.call(STAFF, 'revealCustomerNumber', { customerId: 'legacy1', category: cat, note: '   short   ' });
  assert.equal(short.status, 'INVALID_ARGUMENT');
  const missing = await H.call(STAFF, 'revealCustomerNumber', { customerId: 'nobody-here', category: cat, note: 'confirming the gate' });
  assert.equal(missing.status, 'NOT_FOUND');

  const before = (await H.db.collection('customer_number_views').where('outcome', '==', 'granted').get()).size;
  const ok = await H.call(STAFF, 'revealCustomerNumber', { customerId: 'legacy1', category: cat, note: '  confirming the Peelamedu gate  ' });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.data.phone, '+91 98765 43210');
  assert.ok(ok.data.revealSeconds >= 10);
  const logs = (await H.db.collection('customer_number_views').where('outcome', '==', 'granted').get()).docs.map((d) => d.data());
  assert.equal(logs.length, before + 1);
  const log = logs.find((l) => l.actorId === STAFF);
  assert.equal(log.customerId, 'legacy1');
  assert.equal(log.customerName, 'Legacy Rider');
  assert.equal(log.category, cat);
  assert.equal(log.note, 'confirming the Peelamedu gate', 'the note is trimmed');
  assert.equal(log.actorName, 'Karthik Raja');
  assert.ok(log.at && typeof log.at.toMillis === 'function', 'server time');
  assert.ok(!JSON.stringify(log).includes('98765'), 'the log never holds the number');
  // the denial was recorded too, and is not a "view"
  assert.ok((await H.db.collection('customer_number_views').where('outcome', '==', 'denied').get()).size >= 1);
  // the log is not readable from a client
  assert.equal((await H.rest(MASTER, `customer_number_views/${ok.data.logId}`)).status, 403);
});

test('reveal ledger: the Master sees every view, a Staff ID only its own; newest first', async () => {
  await H.call(MASTER, 'revealCustomerNumber', { customerId: 'corp1', category: 'GST invoice / payment receipt follow-up', note: 'monthly B2B statement' });
  const all = (await H.call(MASTER, 'getCustomerNumberViews', {})).data;
  assert.equal(all.scope, 'all');
  assert.ok(all.entries.length >= 2 && all.total >= 2);
  assert.deepEqual(all.entries.map((e) => e.atMs), [...all.entries.map((e) => e.atMs)].sort((a, b) => b - a));
  assert.ok(all.entries.every((e) => e.reason.includes(' — ')));
  const own = (await H.call(STAFF, 'getCustomerNumberViews', {})).data;
  assert.equal(own.scope, 'own');
  assert.ok(own.entries.length >= 1 && own.entries.every((e) => e.viewedBy === 'Karthik Raja'));
  const none = (await H.call(VIEWER, 'getCustomerNumberViews', {})).data;
  assert.deepEqual(none.entries, []);
});

test('mobile lookup returns ids only, in any stored spelling', async () => {
  for (const q of ['9876543210', '+91 98765 43210', '+919876543210']) {
    const r = await H.call(VIEWER, 'findCustomerByMobile', { phone: q });
    assert.deepEqual(r.data.ids, ['legacy1'], q);
    assert.ok(!JSON.stringify(r.data).includes('98765'));
  }
  assert.deepEqual((await H.call(VIEWER, 'findCustomerByMobile', { phone: '9333333333' })).data.ids, []);
  assert.equal((await H.call(VIEWER, 'findCustomerByMobile', { phone: '98765' })).status, 'INVALID_ARGUMENT');
});

test('saved pickup addresses come from the customer-owned records', async () => {
  const r = await H.call(VIEWER, 'getCustomerSavedPlaces', { customerId: 'legacy1' });
  assert.deepEqual(r.data.places.map((p) => p.address), ['RS Puram, Coimbatore']);
  assert.deepEqual((await H.call(VIEWER, 'getCustomerSavedPlaces', { customerId: 'corp1' })).data.places, []);
});

test('create: validated, normalised, and one customer per mobile in every spelling', async () => {
  const mk = (over) => H.call(STAFF, 'saveCustomerProfile', { name: 'New Rider', leadSource: 'Justdial', city: 'Madurai', ...over });
  assert.equal((await mk({ phone: '12345' })).status, 'INVALID_ARGUMENT');
  assert.equal((await mk({ phone: '5876543210' })).status, 'INVALID_ARGUMENT', 'must start 6-9');
  assert.equal((await mk({ phone: '9111111111', name: 'x' })).status, 'INVALID_ARGUMENT');
  assert.equal((await mk({ phone: '9111111111', gstin: '33BADGSTIN' })).status, 'INVALID_ARGUMENT');
  assert.equal((await mk({ phone: '9111111111', leadSource: 'Made Up' })).status, 'INVALID_ARGUMENT');
  const noRight = await H.call(VIEWER, 'saveCustomerProfile', { name: 'Viewer Made', phone: '9444444444' });
  assert.equal(noRight.status, 'PERMISSION_DENIED');

  const made = await mk({ phone: '+91 91111 11111', gstin: '33aabcn1234f1z5', company: 'Sri Tex', isCorporate: true });
  assert.ok(made.ok, JSON.stringify(made));
  const doc = (await H.db.doc(`customers/${made.data.id}`).get()).data();
  assert.equal(doc.phone, '+91 91111 11111');
  assert.equal(doc.status, 'Active');
  assert.equal(doc.gstin, '33AABCN1234F1Z5');
  assert.equal(doc.isCorporate, true);
  assert.equal(doc.createdBy, STAFF);
  assert.equal(doc.city, 'Madurai');
  assert.ok(!('savedAddresses' in doc));
  for (const dup of ['9111111111', '+919111111111', '91111 11111', '+91 91111 11111']) {
    const r = await mk({ phone: dup, name: 'Copycat' });
    assert.equal(r.status, 'ALREADY_EXISTS', dup);
  }
  // an older record saved in another spelling is found too
  assert.equal((await mk({ phone: '+91 98765 43210' })).status, 'ALREADY_EXISTS');
  assert.equal((await mk({ phone: '9842277890' })).status, 'ALREADY_EXISTS');
});

test('concurrent creates of one number produce exactly one customer', async () => {
  // The Functions emulator starts a full worker per parallel request, so the race runs in-process: the same handler, real Firestore transactions.
  const { saveCustomerProfile } = require('../lib/customerDirectory');
  const run = (uid, i) => saveCustomerProfile.run({ data: { name: `Racer ${i}`, phone: i % 2 ? '+91 95555 55555' : '9555555555' }, auth: { uid, token: {} } }).then(() => 'ok', (e) => e.code);
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => run(i % 3 ? STAFF : MASTER, i)));
  assert.equal(results.filter((r) => r === 'ok').length, 1, JSON.stringify(results));
  assert.equal(results.filter((r) => r === 'already-exists').length, 7, JSON.stringify(results));
  assert.equal((await H.db.collection('customers').where('phone', '==', '+91 95555 55555').get()).size, 1);
  assert.equal((await H.db.doc('customer_phone_index/9555555555').get()).exists, true);
});

test('edit: the number cannot change; block uses Active/Blocked; VIP keeps GST and corporate; historical lead source survives', async () => {
  const phoneTry = await H.call(STAFF, 'saveCustomerProfile', { customerId: 'corp1', phone: '9000000009' });
  assert.equal(phoneTry.status, 'INVALID_ARGUMENT');
  assert.equal((await H.db.doc('customers/corp1').get()).data().phone, '+919842277890');

  const vip = await H.call(STAFF, 'saveCustomerProfile', { customerId: 'corp1', isVip: true });
  assert.ok(vip.ok, JSON.stringify(vip));
  const after = (await H.db.doc('customers/corp1').get()).data();
  assert.equal(after.isVip, true);
  assert.equal(after.isCorporate, true, 'corporate membership kept');
  assert.equal(after.gstin, '33AABCS8890K1Z2', 'GST kept');
  assert.equal(after.company, 'Sri Tex Exports');

  assert.ok((await H.call(STAFF, 'saveCustomerProfile', { customerId: 'corp1', leadSource: 'Corporate B2B', notes: 'Monthly invoice', preferredCab: 'Innova Crysta', preferredDriver: 'Anand K' })).ok, 'an unchanged historical lead source stays editable');
  const prefs = (await H.db.doc('customers/corp1').get()).data();
  assert.deepEqual([prefs.notes, prefs.preferredCab, prefs.preferredDriver], ['Monthly invoice', 'Innova Crysta', 'Anand K']);
  assert.equal((await H.call(STAFF, 'saveCustomerProfile', { customerId: 'corp1', leadSource: 'Another New Thing' })).status, 'INVALID_ARGUMENT');
  assert.equal((await H.call(STAFF, 'saveCustomerProfile', { customerId: 'corp1', status: 'Approved' })).status, 'INVALID_ARGUMENT', 'the prototype\'s "Approved" is never written');

  assert.ok((await H.call(STAFF, 'saveCustomerProfile', { customerId: 'legacy1', status: 'Blocked' })).ok);
  assert.equal((await H.db.doc('customers/legacy1').get()).data().status, 'Blocked');
  assert.ok((await H.call(STAFF, 'saveCustomerProfile', { customerId: 'legacy1', status: 'Active' })).ok);
  assert.equal((await H.db.doc('customers/legacy1').get()).data().status, 'Active');
  assert.equal((await H.call(VIEWER, 'saveCustomerProfile', { customerId: 'legacy1', notes: 'no right' })).status, 'PERMISSION_DENIED');
  assert.equal((await H.call(STAFF, 'saveCustomerProfile', { customerId: 'ghost', notes: 'x' })).status, 'NOT_FOUND');
  assert.ok((await H.db.collection('audit_logs').where('entityId', '==', 'corp1').get()).docs.some((d) => d.data().action === 'customer_updated'), 'edits are audited');
});

test('export: Master only, enforced by the function; full numbers need a reason and are logged first', async () => {
  const ids = ['legacy1', 'corp1'];
  for (const who of [STAFF, VIEWER]) {
    for (const includeNumbers of [false, true]) {
      const r = await H.call(who, 'exportCustomerNumbers', { customerIds: ids, includeNumbers, reason: 'monthly audit export' });
      assert.equal(r.ok, false);
      assert.equal(r.status, 'PERMISSION_DENIED');
      assert.ok(!JSON.stringify(r).includes('98765'));
    }
  }
  const plain = await H.call(MASTER, 'exportCustomerNumbers', { customerIds: ids, includeNumbers: false });
  assert.ok(plain.ok);
  assert.deepEqual(plain.data.numbers, {}, 'a plain export carries no numbers');
  assert.equal((await H.call(MASTER, 'exportCustomerNumbers', { customerIds: ids, includeNumbers: true, reason: 'short' })).status, 'INVALID_ARGUMENT');
  assert.equal((await H.call(MASTER, 'exportCustomerNumbers', { customerIds: [], includeNumbers: false })).status, 'INVALID_ARGUMENT');
  const before = (await H.db.collection('customer_number_views').where('kind', '==', 'export').get()).size;
  const full = await H.call(MASTER, 'exportCustomerNumbers', { customerIds: ids, includeNumbers: true, reason: 'year-end customer reconciliation' });
  assert.ok(full.ok);
  assert.deepEqual(full.data.numbers, { legacy1: '+91 98765 43210', corp1: '+91 98422 77890' });
  const exports = (await H.db.collection('customer_number_views').where('kind', '==', 'export').get()).docs.map((d) => d.data());
  assert.equal(exports.length, before + 1);
  assert.ok(exports.some((e) => e.count === 2 && e.actorId === MASTER && e.note === 'year-end customer reconciliation'));
  assert.ok(!JSON.stringify(exports).includes('98765'), 'the export log holds no numbers');
  assert.ok((await H.db.collection('audit_logs').where('action', '==', 'customer_export_authorized').get()).size >= 1);
  const ledger = (await H.call(MASTER, 'getCustomerNumberViews', {})).data;
  assert.ok(ledger.entries.some((e) => e.kind === 'export' && e.customer === '2 customers'));
});

test('the lite directory (used by other screens) serves Staff the same masked rows without bookings work', async () => {
  const r = await H.call(STAFF, 'getCustomerDirectory', {});
  assert.ok(r.ok);
  assert.ok(r.data.customers.length >= 3);
  assert.ok(r.data.customers.every((c) => c.phone === '' && Array.isArray(c.linkedBookingIds) && c.linkedBookingIds.length === 0));
});
