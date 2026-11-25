// Security rules for Local & Rental pricing reads, tested with the Firebase BROWSER SDK (the same client the admin panel uses,
// signed in through the Auth emulator) — not the Admin SDK, which bypasses rules. Also runs the admin panel's own subscribeGeoFares
// (admin/src/services/geoFareService.ts) so the exact query the page makes is the one tested.
//   npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json --project demo-nesam --only auth,firestore \
//     "node --test test/geoRules.e2e.test.js"
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { createRequire } = require('node:module');
const H = require('./helpers.e2e');
const { db } = H;

const web = createRequire(path.resolve(__dirname, '../../admin/package.json'));
const { initializeApp, deleteApp } = web('firebase/app');
const { getAuth, connectAuthEmulator, signInWithCustomToken, signOut } = web('firebase/auth');
const { getFirestore, connectFirestoreEmulator, collection, query, where, getDocs, getDoc, doc, setDoc, terminate } = web('firebase/firestore');

const RULES_URL = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${H.PROJECT}:securityRules`;
const loadRules = async (content) => { const r = await fetch(RULES_URL, { method: 'PUT', body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }) }); assert.equal(r.ok, true, await r.text()); };
const branchRules = fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8');

let n = 0;
/** A browser-SDK client signed in as `uid` (or anonymous when null). */
async function client(uid) {
  const app = initializeApp({ apiKey: 'fake', projectId: H.PROJECT, authDomain: 'localhost' }, `c${n++}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  const fsdb = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(fsdb, host, Number(port));
  if (uid) { try { await H.admin.auth().createUser({ uid }); } catch { /* exists */ } await signInWithCustomToken(auth, await H.admin.auth().createCustomToken(uid)); }
  return { app, auth, db: fsdb, close: async () => { await signOut(auth).catch(() => {}); await terminate(fsdb); await deleteApp(app); } };
}
const denied = async (p) => { await assert.rejects(p, (e) => e.code === 'permission-denied'); };
const appQuery = (fsdb, brand) => query(collection(fsdb, 'geo_fares'), where('service', '==', 'local'), where('brand', 'in', brand === 'common' ? ['common'] : [brand, 'common']));

test.before(async () => {
  await loadRules(branchRules);
  // Isolated from other suites sharing this demo emulator: start from empty pricing collections (never a real project).
  assert.equal(H.PROJECT, 'demo-nesam');
  for (const c of ['geo_fares', 'peak_rules']) for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  await db.doc('admins/rules-master').set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Master' });
  await db.doc('admins/rules-staff').set({ role: 'admin', status: 'active', staffRole: 'staff', staffId: 'S1', accountStatus: 'Active', permissions: ['operations'], name: 'Staff' });
  await db.doc('admins/rules-off').set({ role: 'admin', status: 'inactive', staffRole: 'super_admin', name: 'Inactive' });
  await db.doc('customers/rules-rider').set({ status: 'Approved', name: 'Rider' });
  await db.doc('geo_fares/common__local__d_33_theni').set({ brand: 'common', service: 'local', scopeKey: 'd_33_theni', version: 2, classes: { sedan: { customer: { baseFare: 150 } } } });
  await db.doc('geo_fares/nesam__local__z_zone1').set({ brand: 'nesam', service: 'local', scopeKey: 'z_zone1', version: 1, classes: { sedan: { customer: { baseFare: 180 } } } });
  await db.doc('geo_fares/people_taxi__local__z_zone1').set({ brand: 'people_taxi', service: 'local', scopeKey: 'z_zone1', version: 1, classes: {} });
  await db.doc('peak_rules/p1').set({ brand: '', service: 'local', scopeKey: 'd_33_theni', enabled: false, days: [1], slots: [{ start: '08:00', end: '10:00' }], type: 'percent', value: 10, priority: 1, name: 'Test' });
  await db.doc('locations/loc-theni').set({ name: 'Theni', type: 'City', state: 'Tamil Nadu', district: 'Theni', city: 'Theni', status: 'Active' });
});
test.after(async () => { await loadRules(branchRules); });

test('ROOT CAUSE: with the rules on main (deployable before this branch) an active admin is refused geo_fares and peak_rules', async () => {
  const mainRules = execSync('git show origin/main:firestore.rules', { cwd: path.resolve(__dirname, '../..') }).toString();
  assert.equal(/geo_fares|peak_rules/.test(mainRules), false, 'main has no rule for these collections');
  await loadRules(mainRules);
  const c = await client('rules-master');
  try {
    await denied(getDocs(appQuery(c.db, 'nesam')));
    await denied(getDocs(query(collection(c.db, 'peak_rules'), where('service', '==', 'local'))));
    // The same account can read other admin data under main's rules: the account is fine, only these paths have no rule.
    await getDocs(collection(c.db, 'service_rules'));
  } finally { await c.close(); await loadRules(branchRules); }
});

test('an active admin reads the app query (own brand + shared rates for inheritance), single docs and peak rules', async () => {
  const c = await client('rules-master');
  try {
    const ids = (await getDocs(appQuery(c.db, 'nesam'))).docs.map((d) => d.id).sort();
    assert.deepEqual(ids, ['common__local__d_33_theni', 'nesam__local__z_zone1'], 'own brand and shared rows; another brand is not in the query');
    assert.equal((await getDoc(doc(c.db, 'geo_fares/common__local__d_33_theni'))).data().version, 2);
    assert.equal((await getDocs(query(collection(c.db, 'peak_rules'), where('service', '==', 'local')))).size, 1);
    // Staff with an active admin record read too (the same rule as service_rules and the tariff).
    const s = await client('rules-staff');
    try { assert.equal((await getDocs(appQuery(s.db, 'common'))).size, 1); } finally { await s.close(); }
  } finally { await c.close(); }
});

test('writes stay server-only; inactive admins, customers and signed-out users are refused', async () => {
  const c = await client('rules-master');
  try {
    await denied(setDoc(doc(c.db, 'geo_fares/common__local__d_33_theni'), { brand: 'common', service: 'local', classes: {} }));
    await denied(setDoc(doc(c.db, 'peak_rules/p2'), { enabled: true }));
  } finally { await c.close(); }
  for (const uid of ['rules-off', 'rules-rider', null]) {
    const x = await client(uid);
    try {
      await denied(getDocs(appQuery(x.db, 'nesam')));
      await denied(getDoc(doc(x.db, 'peak_rules/p1')));
    } finally { await x.close(); }
  }
  const anon = await client(null);
  try { await denied(getDocs(collection(anon.db, 'locations'))); } finally { await anon.close(); }
  const rider = await client('rules-rider');
  try { assert.ok((await getDocs(collection(rider.db, 'locations'))).size >= 1, 'locations stay readable to signed-in users'); } finally { await rider.close(); }
});

test("the admin panel's own subscribeGeoFares: denied → permission-denied failure; Retry after access is restored → data; empty ≠ denied", async () => {
  const c = await client('rules-later');
  const load = require('./adminServiceLoader.cjs')({ db: c.db, auth: c.auth });
  const S = load('src/services/geoFareService.ts');
  const once = (brand, service) => new Promise((resolve) => {
    const unsub = S.subscribeGeoFares(brand, service, (rows) => { unsub(); resolve({ rows }); }, (f) => { unsub(); resolve({ fail: f }); });
  });
  try {
    const first = await once('nesam', 'local');
    assert.equal(first.fail?.code, 'permission-denied', 'a refusal is reported as a failure, never as an empty result');
    await db.doc('admins/rules-later').set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Restored' });
    const retry = await once('nesam', 'local');
    assert.deepEqual([...retry.rows.keys()].sort(), ['common__local__d_33_theni', 'nesam__local__z_zone1']);
    const empty = await once('nesam', 'rental');
    assert.equal(empty.fail, undefined);
    assert.equal(empty.rows.size, 0, 'nothing saved yet: an empty result, distinct from a failure');
  } finally { await c.close(); }
});
