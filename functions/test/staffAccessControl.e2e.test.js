// Staff & Access Control server rules: strict mobile, custom-role link, admin notes, long hub/shift, and
// role-deletion protection. Run with the demo-nesam Auth + Firestore emulators.
const test = require('node:test');
const assert = require('node:assert/strict');
if (process.env.GCLOUD_PROJECT !== 'demo-nesam' || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Run only with demo-nesam Auth and Firestore emulators.');
}
const { db } = require('../lib/admin');
const { saveStaffProfile } = require('../lib/staffProfiles');
const { saveStaffRole, deleteStaffRole } = require('../lib/staff');
const { presetAccess } = require('../lib/permissions');

const master = 'access-control-master';
const suffix = Date.now().toString().slice(-8);
const invoke = (fn, data) => fn.run({ auth: { uid: master, token: {} }, data });
const preset = presetAccess('Booking & Enquiry Executive');
const base = (over = {}) => ({
  name: 'Access Control Staff', phone: `98${suffix}`, username: `desk.ac${suffix}`, password: 'Staff-Example-927!', email: '',
  branch: 'Chennai Airport Desk · Night Shift / After-Hours (10:00 PM – 06:00 AM)', preset: 'Custom', accountStatus: 'Active',
  access: preset.matrix, duty: preset.duty, requestId: `access_control_${suffix}`, reason: '', ...over,
});

test.before(async () => {
  await db.doc(`admins/${master}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Master' });
});

test('a mistyped longer mobile is rejected instead of being cut to its last ten digits', async () => {
  await assert.rejects(invoke(saveStaffProfile, base({ phone: `1234${'98'}${suffix}`, requestId: `access_bad_${suffix}`, username: `desk.bad${suffix}` })), /valid 10-digit mobile/);
});

test('custom role template, custom-role link, admin notes and a long hub/shift are saved; an assigned role cannot be deleted', async () => {
  const { roleId } = await invoke(saveStaffRole, { name: `Temple Desk ${suffix}`, permissions: ['operations', 'people'], basePreset: 'Night Shift / After-Hours Desk' });
  assert.equal((await db.doc(`staff_roles/${roleId}`).get()).data().basePreset, 'Night Shift / After-Hours Desk');
  await assert.rejects(invoke(saveStaffRole, { name: `Bad ${suffix}`, permissions: ['operations'], basePreset: 'Not a preset' }), /valid base preset/);

  const saved = await invoke(saveStaffProfile, base({ phone: `+91 98${suffix.slice(0, 3)}-${suffix.slice(3)}`, customRoleId: roleId, adminNotes: 'Weekend temple tours' }));
  const doc = (await db.doc(`admins/${saved.uid}`).get()).data();
  assert.equal(doc.phone, `98${suffix}`, '+91 and separators are normalised');
  assert.equal(doc.customRoleId, roleId);
  assert.equal(doc.customRoleName, `Temple Desk ${suffix}`);
  assert.equal(doc.adminNotes, 'Weekend temple tours');
  assert.equal(doc.branch, 'Chennai Airport Desk · Night Shift / After-Hours (10:00 PM – 06:00 AM)', 'not truncated at 60 characters');

  await assert.rejects(invoke(deleteStaffRole, { roleId }), /assigned to 1 account/);

  // An edit that does not send the role or notes keeps them.
  await invoke(saveStaffProfile, { ...base(), username: undefined, password: undefined, requestId: undefined, email: doc.email, uid: saved.uid, expectedVersion: doc.accessVersion, reason: 'Shift check' });
  const after = (await db.doc(`admins/${saved.uid}`).get()).data();
  assert.equal(after.customRoleId, roleId);
  assert.equal(after.adminNotes, 'Weekend temple tours');

  // A missing role is refused, never silently replaced.
  await assert.rejects(invoke(saveStaffProfile, { ...base(), username: undefined, password: undefined, requestId: undefined, email: doc.email, uid: saved.uid, expectedVersion: after.accessVersion, reason: 'Role change', customRoleId: 'missing-role' }), /no longer exists/);

  // Moving the Staff ID off the role lets it be deleted.
  await invoke(saveStaffProfile, { ...base(), username: undefined, password: undefined, requestId: undefined, email: doc.email, uid: saved.uid, expectedVersion: after.accessVersion, reason: 'Back to preset', preset: 'Booking & Enquiry Executive', customRoleId: '' });
  assert.deepEqual(await invoke(deleteStaffRole, { roleId }), { ok: true });
});
