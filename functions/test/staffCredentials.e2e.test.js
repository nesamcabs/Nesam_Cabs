const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.GCLOUD_PROJECT !== 'demo-nesam' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run only with demo-nesam Auth and Firestore emulators.');
}
const { createRequire } = require('node:module');
const path = require('node:path');
const client = createRequire(path.resolve(__dirname, '../../admin/package.json'));
const appSdk = client('firebase/app');
const authSdk = client('firebase/auth');
const fsSdk = client('firebase/firestore');
const admin = require('firebase-admin');
const { db } = require('../lib/admin');
const { saveStaffProfile, resetStaffPassword, setStaffStatus } = require('../lib/staffProfiles');
const { presetAccess } = require('../lib/permissions');
const app = appSdk.initializeApp({ projectId: 'demo-nesam', apiKey: 'fake', authDomain: 'demo-nesam.firebaseapp.com' }, 'staff-credentials');
const auth = authSdk.getAuth(app);
authSdk.connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
const load = require('./adminServiceLoader.cjs')({ auth, db: fsSdk.getFirestore(app) });
const { signInAdmin } = load('src/services/authService.ts');
const master = 'credentials-master';
const suffix = Date.now().toString();
const username = `staff.${suffix}`;
const password = 'Staff-Example-927!';
const invoke = (fn, data, uid = master) => fn.run({ auth: { uid, token: {} }, data });
const preset = presetAccess('Booking staff');
const input = {
  name: 'Credential staff', phone: '9876543210', username, password, email: '', branch: 'Office',
  preset: 'Booking staff', accountStatus: 'Active', access: preset.matrix, duty: preset.duty,
  requestId: `credentials_${suffix}`, reason: '',
};
let saved;

test.before(async () => {
  await db.doc(`admins/${master}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Master' });
});

test('master creates a username account, real frontend signs in, and no plaintext password is persisted', async () => {
  saved = await invoke(saveStaffProfile, input);
  assert.equal(saved.username, username);
  assert.equal(saved.invite.sent, false);
  assert.equal(saved.invite.link, undefined);
  assert.deepEqual(saved.warnings, []);
  const doc = (await db.doc(`admins/${saved.uid}`).get()).data();
  assert.equal(doc.accountStatus, 'Active');
  assert.equal(doc.username, username);
  assert.equal(doc.staffRole, 'individual');
  assert.equal(JSON.stringify(doc).includes(password), false);
  assert.equal(JSON.stringify(saved).includes(password), false);
  await signInAdmin(` ${username.toUpperCase()} `, password);
  assert.equal(auth.currentUser.uid, saved.uid);
  await authSdk.signOut(auth);
  await assert.rejects(signInAdmin(username, 'wrong-password'));
  const audit = await db.collection('admin_audit').where('targetId', '==', saved.uid).get();
  assert.equal(JSON.stringify(audit.docs.map((d) => d.data())).includes(password), false);
});

test('retry recovers a disabled sign-in without changing credentials or duplicating the staff ID', async () => {
  await admin.auth().updateUser(saved.uid, { disabled: true });
  const retry = await invoke(saveStaffProfile, { ...input, password: 'Different-Retry-928!' });
  assert.equal(retry.uid, saved.uid);
  assert.equal((await admin.auth().getUser(saved.uid)).disabled, false);
  await signInAdmin(username, password);
  await authSdk.signOut(auth);
  const matches = await db.collection('admins').where('username', '==', username).get();
  assert.equal(matches.size, 1);
});

test('duplicate usernames, invalid passwords and non-master creation are rejected', async () => {
  await assert.rejects(invoke(saveStaffProfile, { ...input, username: username.toUpperCase(), requestId: `duplicate_${suffix}` }), { code: 'already-exists' });
  await assert.rejects(invoke(saveStaffProfile, { ...input, username: `invalid.${suffix}`, password: 'short', requestId: `invalid_${suffix}` }), { code: 'invalid-argument' });
  await assert.rejects(invoke(saveStaffProfile, { ...input, requestId: `forbidden_${suffix}` }, saved.uid), { code: 'permission-denied' });
});

test('only master resets passwords and existing sessions are revoked', async () => {
  const next = 'Replacement-Password-938!';
  await db.doc(`staff_sessions/credentials-${suffix}`).set({ uid: saved.uid, status: 'Online' });
  await assert.rejects(invoke(resetStaffPassword, { uid: saved.uid, password: next, reason: 'Forgot password' }, saved.uid));
  const result = await invoke(resetStaffPassword, { uid: saved.uid, password: next, reason: 'Forgot password' });
  assert.deepEqual(result.warnings, []);
  assert.equal((await db.doc(`staff_sessions/credentials-${suffix}`).get()).data().status, 'Revoked');
  await assert.rejects(signInAdmin(username, password));
  await signInAdmin(username, next);
  await authSdk.signOut(auth);
});

test('suspension blocks login and existing email accounts still sign in', async () => {
  await invoke(setStaffStatus, { uid: saved.uid, status: 'Suspended', reason: 'Access suspended', expectedVersion: saved.accessVersion });
  await assert.rejects(signInAdmin(username, 'Replacement-Password-938!'));
  // A repeated create request must not re-enable a suspended staff account.
  await invoke(saveStaffProfile, input);
  assert.equal((await admin.auth().getUser(saved.uid)).disabled, true);
  const email = `legacy-${suffix}@example.test`;
  await admin.auth().createUser({ email, password });
  await signInAdmin(email, password);
  assert.equal(auth.currentUser.email, email);
});

test.after(async () => {
  await authSdk.signOut(auth);
  await appSdk.deleteApp(app);
  await db.terminate();
});
