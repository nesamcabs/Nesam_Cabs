// Staff access management. Admin identity lives in admins/{uid} (created by
// the sign-up screen as a pending request); roles live in staff_roles/{id}.
// Only these super-admin callables change either — firestore.rules deny all
// client writes — so an admin's denormalised permission list can never drift
// from its role. Every change is recorded in admin_audit.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { AdminAccess, PERMISSIONS, Permission, STAFF_ROLE, SUPER_ADMIN_ROLE, identityKindOf, isPermission } from './permissions';
import { requireSuperAdmin, text } from './shared';

const ROLE_ID = /^[A-Za-z0-9_-]{2,40}$/;

function accountId(v: unknown): string {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(v)) throw new HttpsError('invalid-argument', 'Invalid account.');
  return v;
}

interface Grant {
  staffRole: string;
  permissions: Permission[];
  roleName: string;
}

async function grantFor(tx: Transaction, staffRole: unknown): Promise<Grant> {
  if (staffRole === SUPER_ADMIN_ROLE) return { staffRole: SUPER_ADMIN_ROLE, permissions: [], roleName: 'Super Admin' };
  if (typeof staffRole !== 'string' || !ROLE_ID.test(staffRole)) throw new HttpsError('invalid-argument', 'Choose a role.');
  const role = await tx.get(db.doc(`staff_roles/${staffRole}`));
  if (!role.exists) throw new HttpsError('failed-precondition', 'That role no longer exists.');
  const d = role.data()!;
  return { staffRole, permissions: (Array.isArray(d.permissions) ? d.permissions : []).filter(isPermission), roleName: text(d.name, 40) };
}

function audit(tx: Transaction, actor: AdminAccess, action: string, targetId: string, details: Record<string, unknown>) {
  tx.create(db.collection('admin_audit').doc(), {
    action, targetId, details, actorId: actor.uid, actorName: actor.name, at: FieldValue.serverTimestamp(),
  });
}

const isActiveSuper = (d: FirebaseFirestore.DocumentData | undefined) =>
  d?.role === 'admin' && d?.status === 'active' && identityKindOf(d) === 'master';

export const approveAdminRequest = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const uid = accountId(request.data?.uid);
  const ref = db.doc(`admins/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!snap.exists || d?.role !== 'pending') throw new HttpsError('failed-precondition', 'This sign-up request is no longer pending.');
    const grant = await grantFor(tx, request.data?.staffRole);
    tx.update(ref, {
      role: 'admin', status: 'active', ...grant, rejectionReason: '',
      approvedBy: actor.uid, approvedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    audit(tx, actor, 'admin_approved', uid, { email: text(d.email), staffRole: grant.staffRole, roleName: grant.roleName });
  });
  return { ok: true };
});

export const rejectAdminRequest = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const uid = accountId(request.data?.uid);
  const reason = text(request.data?.reason, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Give a reason of at least 5 characters.');
  const ref = db.doc(`admins/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!snap.exists || d?.role !== 'pending' || d?.status === 'rejected') throw new HttpsError('failed-precondition', 'This sign-up request is no longer pending.');
    tx.update(ref, { status: 'rejected', rejectionReason: reason, reviewedBy: actor.uid, reviewedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    audit(tx, actor, 'admin_rejected', uid, { email: text(d.email), reason });
  });
  return { ok: true };
});

/** Changes an existing admin's role and/or active status. At least one active super admin always remains. */
export const updateAdminAccess = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const uid = accountId(request.data?.uid);
  if (uid === actor.uid) throw new HttpsError('failed-precondition', 'You cannot change your own access. Ask another super admin.');
  const status = request.data?.status;
  if (status !== undefined && status !== 'active' && status !== 'inactive') throw new HttpsError('invalid-argument', 'Invalid status.');
  const changeRole = request.data?.staffRole !== undefined;
  if (!changeRole && status === undefined) throw new HttpsError('invalid-argument', 'Nothing to change.');
  const ref = db.doc(`admins/${uid}`);
  await db.runTransaction(async (tx) => {
    const [snap, supers] = await Promise.all([
      tx.get(ref),
      tx.get(db.collection('admins').where('role', '==', 'admin').where('status', '==', 'active')),
    ]);
    // Re-check the caller inside the transaction: two super admins demoting
    // each other at the same moment must not leave the platform without one.
    if (!supers.docs.some((s) => s.id === actor.uid && isActiveSuper(s.data()))) {
      throw new HttpsError('permission-denied', 'Only a super admin can manage staff access.');
    }
    const d = snap.data();
    if (!snap.exists || d?.role !== 'admin') throw new HttpsError('failed-precondition', 'This account is not an admin.');
    if (d.staffRole === STAFF_ROLE) throw new HttpsError('failed-precondition', 'This Staff ID has its own access matrix. Change it from Staff IDs.');
    const grant = changeRole ? await grantFor(tx, request.data.staffRole) : null;
    const next = { ...d, ...(grant ?? {}), ...(status ? { status } : {}) };
    if (isActiveSuper(d) && !isActiveSuper(next) && supers.docs.filter((s) => isActiveSuper(s.data())).length <= 1) {
      throw new HttpsError('failed-precondition', 'At least one active super admin must remain.');
    }
    tx.update(ref, { ...(grant ?? {}), ...(status ? { status } : {}), accessVersion: FieldValue.increment(1), updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp() });
    audit(tx, actor, 'admin_access_changed', uid, {
      email: text(d.email), from: { staffRole: d.staffRole || SUPER_ADMIN_ROLE, status: d.status }, to: { staffRole: next.staffRole || SUPER_ADMIN_ROLE, status: next.status },
    });
  });
  return { ok: true };
});

/** Creates or edits a role and re-syncs the permission copy on every admin holding it. */
export const saveStaffRole = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const name = text(request.data?.name, 40);
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Give the role a name of at least 2 characters.');
  if (name.toLowerCase() === 'super admin') throw new HttpsError('invalid-argument', 'Super Admin is a built-in role.');
  const raw = request.data?.permissions;
  if (!Array.isArray(raw) || !raw.length || !raw.every(isPermission)) throw new HttpsError('invalid-argument', 'Choose at least one valid permission.');
  const permissions = PERMISSIONS.filter((p) => raw.includes(p));
  const existingId = request.data?.roleId;
  if (existingId !== undefined && (typeof existingId !== 'string' || !ROLE_ID.test(existingId) || existingId === SUPER_ADMIN_ROLE)) {
    throw new HttpsError('invalid-argument', 'Invalid role.');
  }
  const ref = existingId ? db.doc(`staff_roles/${existingId}`) : db.collection('staff_roles').doc();
  return db.runTransaction(async (tx) => {
    const [roles, holders] = await Promise.all([
      tx.get(db.collection('staff_roles')),
      tx.get(db.collection('admins').where('staffRole', '==', ref.id)),
    ]);
    const current = roles.docs.find((r) => r.id === ref.id);
    if (existingId && !current) throw new HttpsError('not-found', 'That role no longer exists.');
    if (roles.docs.some((r) => r.id !== ref.id && text(r.data().name).toLowerCase() === name.toLowerCase())) {
      throw new HttpsError('already-exists', 'Another role already has this name.');
    }
    const stamp = FieldValue.serverTimestamp();
    if (current) tx.update(ref, { name, permissions, updatedBy: actor.uid, updatedAt: stamp });
    else tx.create(ref, { name, permissions, createdBy: actor.uid, createdAt: stamp, updatedAt: stamp });
    for (const h of holders.docs) tx.update(h.ref, { permissions, roleName: name, updatedAt: stamp });
    audit(tx, actor, current ? 'role_updated' : 'role_created', ref.id, {
      name, permissions, ...(current ? { before: { name: current.data().name, permissions: current.data().permissions } } : {}), syncedAdmins: holders.size,
    });
    return { roleId: ref.id, syncedAdmins: holders.size };
  });
});

export const deleteStaffRole = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const roleId = request.data?.roleId;
  if (typeof roleId !== 'string' || !ROLE_ID.test(roleId) || roleId === SUPER_ADMIN_ROLE) throw new HttpsError('invalid-argument', 'Invalid role.');
  const ref = db.doc(`staff_roles/${roleId}`);
  await db.runTransaction(async (tx) => {
    const [role, holders] = await Promise.all([tx.get(ref), tx.get(db.collection('admins').where('staffRole', '==', roleId))]);
    if (!role.exists) throw new HttpsError('not-found', 'That role no longer exists.');
    if (!holders.empty) throw new HttpsError('failed-precondition', `This role is assigned to ${holders.size} account${holders.size === 1 ? '' : 's'}. Move them to another role first.`);
    tx.delete(ref);
    audit(tx, actor, 'role_deleted', roleId, { name: role.data()!.name, permissions: role.data()!.permissions });
  });
  return { ok: true };
});

/**
 * Makes the legacy Master rule explicit. A pre-roles admin record (no staffRole and no other access
 * data) is a Master by the compatibility rule in identityKindOf; this writes staffRole super_admin on
 * each such record so the implicit rule can later be removed. Records that have access data but no
 * staffRole are reported, never promoted. dryRun (default) only reports. Bounded (`limit`), idempotent
 * (converted records are explicit and are skipped), resumable (rerun until `remaining` is 0).
 */
export const migrateLegacyAdmins = onCall({ timeoutSeconds: 120 }, async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const dryRun = request.data?.dryRun !== false;
  const limit = typeof request.data?.limit === 'number' ? Math.max(1, Math.min(200, Math.floor(request.data.limit))) : 100;
  const snap = await db.collection('admins').where('role', '==', 'admin').get();
  const report = { dryRun, scanned: snap.size, explicitMaster: 0, legacyMaster: 0, converted: 0, remaining: 0, roleBased: 0, staffIds: 0, unrecognised: [] as string[] };
  const pending: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  for (const d of snap.docs) {
    const x = d.data();
    const kind = identityKindOf(x);
    if (kind === 'master' && x.staffRole === SUPER_ADMIN_ROLE) report.explicitMaster++;
    else if (kind === 'master') { report.legacyMaster++; pending.push(d); }
    else if (kind === 'legacy') report.roleBased++;
    else if (kind === 'staff') report.staffIds++;
    else report.unrecognised.push(d.id);
  }
  const batchDocs = pending.slice(0, limit);
  report.remaining = pending.length - (dryRun ? 0 : batchDocs.length);
  if (!dryRun && batchDocs.length) {
    await db.runTransaction(async (tx) => {
      report.converted = 0; // the callback can retry
      const fresh = await Promise.all(batchDocs.map((d) => tx.get(d.ref)));
      const stamp = FieldValue.serverTimestamp();
      for (const f of fresh) {
        const x = f.data();
        // Re-checked inside the transaction: only records still Master by the legacy rule are written.
        if (!x || x.staffRole !== undefined || identityKindOf(x) !== 'master') continue;
        tx.update(f.ref, { staffRole: SUPER_ADMIN_ROLE, roleName: 'Super Admin', accessVersion: FieldValue.increment(1), updatedBy: actor.uid, updatedAt: stamp });
        report.converted++;
      }
      audit(tx, actor, 'legacy_admins_migrated', 'admins', { converted: report.converted, remaining: report.remaining, unrecognised: report.unrecognised.length });
    });
  }
  return report;
});
