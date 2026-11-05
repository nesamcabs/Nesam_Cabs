// Staff & Access (Master Admin): individual Staff IDs with their own module / action matrix,
// duty permissions, account controls and sensitive-data rights. The matrix is kept on
// admins/{uid}.staffAccess; the permission keys the rules and functions enforce are derived from
// it here, so a Staff ID can never hold more than its matrix grants. Only super admins call these,
// and never on their own account.
//
// Every access or status change runs in one transaction with its audit entry, bumps
// admins/{uid}.accessVersion (the editor sends the version it loaded, so two Masters cannot
// overwrite each other silently), ends the person's pending / approved customer-contact reveal
// grants and, when the account stops being Active, marks its open sessions Revoked.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { DocumentData, FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import {
  AdminAccess, DUTY_ACTIONS, DutyAction, STAFF_PRESETS, STAFF_ROLE, STAFF_STATUSES, StaffStatus,
  accessProblems, identityKindOf, normalizeMatrix, permissionsOf,
} from './permissions';
import { sendEmail } from './providers';
import { requireSuperAdmin, text } from './shared';

const UID = /^[A-Za-z0-9_-]{6,128}$/;

async function nextStaffCode(): Promise<string> {
  const ref = db.doc('counters/staff');
  const n = await db.runTransaction(async (tx) => {
    const v = ((await tx.get(ref)).data()?.value ?? 0) + 1;
    tx.set(ref, { value: v, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return v as number;
  });
  return `NSM-ST-${String(n).padStart(6, '0')}`;
}

/** Stored lifecycle status of a Staff ID (older records only had active / inactive). */
const statusOf = (d: DocumentData | undefined): StaffStatus =>
  (STAFF_STATUSES as readonly string[]).includes(String(d?.accountStatus)) ? d!.accountStatus as StaffStatus : d?.status === 'active' ? 'Active' : 'Inactive';

const versionOf = (d: DocumentData | undefined) => (typeof d?.accessVersion === 'number' ? d.accessVersion : 0);

function expectVersion(d: DocumentData | undefined, expected: unknown) {
  if (typeof expected !== 'number' || expected !== versionOf(d)) {
    throw new HttpsError('aborted', 'This staff profile was changed by someone else after you opened it. Reload it and make your change again.');
  }
}

function reasonOf(v: unknown, what: string): string {
  const reason = text(v, 300);
  if (reason.length < 5) throw new HttpsError('invalid-argument', `Record the reason for this ${what} (at least 5 characters).`);
  return reason;
}

/** Reads (before any write in the transaction) what an access / status change has to end. */
async function grantsAndSessions(tx: Transaction, uid: string, sessions: boolean) {
  const [grants, open] = await Promise.all([
    tx.get(db.collection('privacy_requests').where('staffUid', '==', uid).where('status', 'in', ['Pending', 'Approved'])),
    sessions ? tx.get(db.collection('staff_sessions').where('uid', '==', uid).where('status', '==', 'Online').limit(100)) : Promise.resolve(null),
  ]);
  return { grants, open };
}

function endGrantsAndSessions(tx: Transaction, actor: AdminAccess, reason: string, found: Awaited<ReturnType<typeof grantsAndSessions>>) {
  const stamp = FieldValue.serverTimestamp();
  for (const g of found.grants.docs) tx.update(g.ref, { status: 'Revoked', endReason: reason, decidedByName: actor.name, decidedAt: stamp });
  for (const s of found.open?.docs ?? []) tx.update(s.ref, { status: 'Revoked', endedAt: stamp, endedBy: actor.uid, endedByName: actor.name });
  return { grantsRevoked: found.grants.size, sessionsEnded: found.open?.size ?? 0 };
}

function auditTx(tx: Transaction, actor: AdminAccess, action: string, targetId: string, details: Record<string, unknown>) {
  tx.create(db.collection('admin_audit').doc(), { action, targetId, actorId: actor.uid, actorName: actor.name, at: FieldValue.serverTimestamp(), details });
}

/** Access summary safe for the audit trail (no contact details). */
const accessSummary = (d: DocumentData | undefined) => d ? ({
  preset: text(d.roleName, 40), status: statusOf(d), permissions: Array.isArray(d.permissions) ? d.permissions : [],
  duty: Array.isArray(d.dutyPermissions) ? d.dutyPermissions : [], access: d.staffAccess ?? null, branch: text(d.branch, 60),
}) : null;

/**
 * Creates a Staff ID (status Invited or Active) or edits an existing one's profile and access.
 * Status changes of an existing Staff ID go through setStaffStatus.
 */
export const saveStaffProfile = onCall({ timeoutSeconds: 60 }, async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const input = (request.data ?? {}) as Record<string, unknown>;
  const name = text(input.name, 80);
  const phone = text(input.phone, 20).replace(/\D/g, '').slice(-10);
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const directLogin = !input.uid && !!username;
  if (directLogin && !/^[a-z][a-z0-9._-]{2,31}$/.test(username)) throw new HttpsError('invalid-argument', 'Username must be 3–32 characters, start with a letter, and contain only letters, numbers, dots, underscores or hyphens.');
  if (directLogin && (password.length < 8 || password.length > 128)) throw new HttpsError('invalid-argument', 'Use a password between 8 and 128 characters.');
  if (input.uid && (input.username !== undefined || input.password !== undefined)) throw new HttpsError('invalid-argument', 'Login credentials cannot be changed through the access editor.');
  const email = directLogin ? `${username}@staff.nesam.invalid` : text(input.email, 120).toLowerCase();
  const branch = text(input.branch, 60);
  const preset = (STAFF_PRESETS as readonly string[]).includes(String(input.preset)) ? String(input.preset) : 'Custom';
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter the staff member’s full name.');
  if (!/^[6-9]\d{9}$/.test(phone)) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit mobile number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  const hasContactEmail = input.contactEmail !== undefined;
  if (hasContactEmail && typeof input.contactEmail !== 'string') throw new HttpsError('invalid-argument', 'Contact email must be text.');
  const contactEmail = typeof input.contactEmail === 'string' ? input.contactEmail.trim().toLowerCase() : '';
  if (contactEmail.length > 120) throw new HttpsError('invalid-argument', 'Contact email must be 120 characters or fewer.');
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new HttpsError('invalid-argument', 'Enter a valid contact email address.');

  const rawAccess = (input.access && typeof input.access === 'object' ? input.access : input) as Record<string, unknown>;
  const rawLimit = Number(rawAccess.bankLimit ?? 0);
  if (!Number.isFinite(rawLimit) || rawLimit < 0 || rawLimit > 100_000_000) throw new HttpsError('invalid-argument', 'Enter a valid settlement approval limit.');
  const matrix = normalizeMatrix(rawAccess);
  const duty: DutyAction[] = Array.isArray(input.duty) ? DUTY_ACTIONS.filter((a) => (input.duty as unknown[]).includes(a)) : [];
  const permissions = permissionsOf(matrix);

  let uid = text(input.uid, 128);
  const editing = !!uid;
  if (editing && !UID.test(uid)) throw new HttpsError('invalid-argument', 'Invalid staff account.');
  if (editing && uid === actor.uid) throw new HttpsError('failed-precondition', 'You cannot change your own access. Ask another super admin.');
  const createStatus: StaffStatus = directLogin || input.accountStatus === 'Active' ? 'Active' : 'Invited';
  const reason = editing ? reasonOf(input.reason ?? input.statusReason, 'access change') : text(input.reason ?? input.statusReason, 300);

  // Create requests carry a client id kept for the life of the form: a retry after a lost response
  // returns the profile the first attempt saved instead of creating a second one.
  const requestId = typeof input.requestId === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(input.requestId) ? input.requestId : '';
  if (!editing && !requestId) throw new HttpsError('invalid-argument', 'Reopen the Add staff form and try again.');

  const auth = getAuth();
  let created = false;
  let needsPassword = false;
  let previousEmail = '';
  const replay = async (d: FirebaseFirestore.DocumentData, id: string) => {
    const warnings = [d.username ? 'This Staff ID was already saved. Use the credentials from the original creation; this retry did not change its password.' : 'This Staff ID was already saved by an earlier attempt. If the person has no password link, use Resend invitation.'];
    // A lost response or an Auth failure after the Firestore commit must be recoverable.
    try {
      await auth.updateUser(id, { disabled: !['Active', 'Invited'].includes(statusOf(d)) });
    } catch {
      warnings.push('The profile exists, but sign-in could not be synchronised. Retry saving or contact support.');
    }
    return {
      uid: id, username: text(d.username, 32), staffCode: text(d.staffCode, 20), ...(d.contactEmail ? { contactEmail: text(d.contactEmail, 120) } : {}), permissions: Array.isArray(d.permissions) ? d.permissions : [], accessVersion: versionOf(d),
      invite: { sent: false }, warnings,
    };
  };
  if (editing) {
    const current = (await db.doc(`admins/${uid}`).get()).data();
    if (!current || current.role !== 'admin') throw new HttpsError('not-found', 'Staff ID not found.');
    if (identityKindOf(current) === 'master') throw new HttpsError('failed-precondition', 'Super Admin access is managed under Roles & sign-up requests.');
    expectVersion(current, input.expectedVersion);
    previousEmail = text(current.email, 120).toLowerCase();
    if (current.username && previousEmail !== email) throw new HttpsError('invalid-argument', 'The sign-in username is fixed. Update only the staff profile and access.');
    if (previousEmail !== email) {
      // Checked now, applied only after the profile is saved (see below).
      const other = await auth.getUserByEmail(email).catch((e) => (e?.code === 'auth/user-not-found' ? null : Promise.reject(e)));
      if (other && other.uid !== uid) throw new HttpsError('already-exists', 'That email cannot be used: it belongs to another sign-in account.');
    }
  } else {
    const existing = await auth.getUserByEmail(email).catch((e) => (e?.code === 'auth/user-not-found' ? null : Promise.reject(e)));
    if (existing) {
      const [admin, cust, drv, ven] = await Promise.all(['admins', 'customers', 'drivers', 'vendors'].map((c) => db.doc(`${c}/${existing.uid}`).get()));
      if (admin.exists && admin.data()!.createRequestId === requestId && admin.data()!.createdBy === actor.uid) return replay(admin.data()!, existing.uid);
      if (directLogin) throw new HttpsError('already-exists', 'This username is already in use. Choose another username.');
      if (admin.exists) throw new HttpsError('already-exists', 'This email already has a staff ID or sign-up request.');
      if (cust.exists || drv.exists || ven.exists) throw new HttpsError('failed-precondition', 'This email belongs to a customer, driver or vendor account. Use a separate staff email.');
      uid = existing.uid;
      // An existing sign-in account that has never been used may have no password yet.
      needsPassword = !existing.metadata.lastSignInTime;
    } else {
      // Created disabled; enabled below only once the profile is saved, deleted if the save fails.
      try {
        uid = (await auth.createUser({ email, ...(directLogin ? { password } : {}), displayName: name, emailVerified: false, disabled: true })).uid;
      } catch (error) {
        if ((error as { code?: string }).code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'This username or email is already in use.');
        if (['auth/invalid-password', 'auth/password-does-not-meet-requirements', 'auth/invalid-email'].includes((error as { code?: string }).code ?? '')) throw new HttpsError('invalid-argument', 'The username or password does not meet the authentication requirements. Choose a different username or stronger password.');
        throw new HttpsError('unavailable', 'The sign-in account could not be created. Retry after checking the authentication service configuration.');
      }
      created = true;
      needsPassword = !directLogin;
    }
  }

  const ref = db.doc(`admins/${uid}`);
  let result: { staffCode: string; status: StaffStatus; accessVersion: number; replayed?: FirebaseFirestore.DocumentData };
  try {
    const newCode = editing ? '' : await nextStaffCode();
    result = await db.runTransaction(async (tx) => {
      const [snap, samePhone] = await Promise.all([tx.get(ref), tx.get(db.collection('admins').where('phone', '==', phone).limit(5))]);
      const d = snap.data();
      if (!editing && snap.exists && d?.createRequestId === requestId) return { staffCode: text(d.staffCode, 20), status: statusOf(d), accessVersion: versionOf(d), replayed: d };
      if (samePhone.docs.some((x) => x.id !== uid)) throw new HttpsError('already-exists', 'This mobile number already has a Staff ID.');
      if (editing) {
        if (!snap.exists || d?.role !== 'admin') throw new HttpsError('not-found', 'Staff ID not found.');
        if (identityKindOf(d) === 'master') throw new HttpsError('failed-precondition', 'Super Admin access is managed under Roles & sign-up requests.');
        expectVersion(d, input.expectedVersion);
      } else if (snap.exists) {
        throw new HttpsError('already-exists', 'This email already has a staff ID or sign-up request.');
      }
      const status = editing ? statusOf(d) : createStatus;
      const problems = accessProblems(matrix, duty, status);
      if (problems.length) throw new HttpsError('invalid-argument', problems.slice(0, 4).join(' '));
      const found = await grantsAndSessions(tx, uid, false);

      const staffCode = text(d?.staffCode, 20) || newCode;
      const accessVersion = versionOf(d) + 1;
      const entry = { action: editing ? 'Profile & access saved' : 'Staff ID created', from: editing ? statusOf(d) : '', to: status, reason, byName: actor.name, at: Timestamp.now() };
      const stamp = FieldValue.serverTimestamp();
      tx.set(ref, {
        uid, role: 'admin', status: status === 'Active' ? 'active' : 'inactive', accountStatus: status, staffRole: STAFF_ROLE, roleName: preset,
        permissions, dutyPermissions: duty, staffAccess: matrix, accessVersion, name, email, phone, branch, staffCode,
        ...(hasContactEmail || !editing ? { contactEmail: contactEmail || '' } : {}),
        statusHistory: FieldValue.arrayUnion(entry), updatedBy: actor.uid, updatedAt: stamp,
        ...(editing ? {} : { createdAt: stamp, createdBy: actor.uid, createRequestId: requestId }),
        ...(directLogin ? { username } : {}),
      }, { merge: true });
      const ended = endGrantsAndSessions(tx, actor, 'Staff permissions changed', found);
      auditTx(tx, actor, editing ? 'staff_profile_updated' : 'staff_profile_created', uid, {
        staffCode, email, ...(contactEmail ? { contactEmail } : {}), name, reason, accessVersion, ...ended,
        before: accessSummary(d), after: { preset, status, permissions, duty, access: matrix, branch },
      });
      return { staffCode, status, accessVersion };
    });
  } catch (err) {
    // Nothing was saved: do not leave a sign-in account behind that only this attempt created.
    if (created) await auth.deleteUser(uid).catch(() => undefined);
    throw err;
  }
  if (result.replayed) return replay(result.replayed, uid);

  // ── After the profile is saved: every step below is reported, never turned into "not saved". ──
  const warnings: string[] = [];
  if (editing && previousEmail !== email) {
    try {
      await auth.updateUser(uid, { email });
    } catch {
      // Keep the profile matching the sign-in account.
      await ref.update({ email: previousEmail, updatedAt: FieldValue.serverTimestamp() }).catch(() => undefined);
      warnings.push(`Saved, but the sign-in email could not be changed. ${previousEmail} is still the sign-in email.`);
    }
  }
  // Invited Staff IDs can sign in to set their password; only Active ones pass the access checks.
  const live = result.status === 'Active' || result.status === 'Invited';
  try {
    await auth.updateUser(uid, { disabled: !live, displayName: name });
    if (!live) await auth.revokeRefreshTokens(uid);
  } catch {
    warnings.push(live
      ? 'Saved, but the sign-in account could not be enabled. Try saving again.'
      : 'Saved, but the sign-in account could not be disabled. Access is still refused because the profile is not Active.');
  }

  // Invitation: a password-set link by email. When email delivery is not configured the Master
  // gets the link to share privately — nothing is reported as sent unless the provider accepted it.
  let invite: { sent: boolean; link?: string; error?: string } = { sent: false };
  if (needsPassword || (result.status === 'Invited' && (!editing || input.resendInvite === true))) {
    try {
      const link = await auth.generatePasswordResetLink(email);
      const res = await sendEmail(email, { subject: 'Your NESAM staff login', text: `Hello ${name},\n\nA NESAM office Staff ID (${result.staffCode}) has been created for you. Set your password with this link, then sign in to the admin panel with ${email}.${result.status === 'Invited' ? ' Your access starts once the Master account activates it.' : ''}\n\n${link}\n\nNESAM Tours & Travels` }).catch(() => ({ ok: false }));
      invite = res.ok ? { sent: true } : { sent: false, link };
    } catch {
      invite = { sent: false, error: 'The password-set link could not be generated. Use Resend invitation from the profile.' };
    }
  }
  return { uid, ...(directLogin ? { username } : {}), staffCode: result.staffCode, ...(contactEmail ? { contactEmail } : {}), permissions, accessVersion: result.accessVersion, invite, warnings };
});

/** Master-only password reset for username accounts; passwords never enter Firestore or audit data. */
export const resetStaffPassword = onCall({ timeoutSeconds: 60 }, async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const uid = text(request.data?.uid, 128);
  if (!UID.test(uid) || uid === actor.uid) throw new HttpsError('invalid-argument', 'Choose another staff account.');
  const password = typeof request.data?.password === 'string' ? request.data.password : '';
  if (password.length < 8 || password.length > 128) throw new HttpsError('invalid-argument', 'Use a password between 8 and 128 characters.');
  const reason = reasonOf(request.data?.reason, 'password reset');
  const profile = (await db.doc(`admins/${uid}`).get()).data();
  if (!profile || profile.staffRole !== STAFF_ROLE || !profile.username) throw new HttpsError('failed-precondition', 'Choose a username-based Staff ID.');
  try {
    await getAuth().updateUser(uid, { password });
  } catch {
    throw new HttpsError('failed-precondition', 'The password was not changed. Check the authentication service and password requirements, then retry.');
  }
  const warnings: string[] = [];
  try {
    await getAuth().revokeRefreshTokens(uid);
    await db.runTransaction(async (tx) => {
      const found = await grantsAndSessions(tx, uid, true);
      const ended = endGrantsAndSessions(tx, actor, 'Staff password reset', found);
      auditTx(tx, actor, 'staff_password_reset', uid, { username: profile.username, staffCode: text(profile.staffCode, 20), reason, ...ended });
    });
  } catch {
    warnings.push('Password changed, but session cleanup or audit recording could not finish. Revoke all sessions from the staff profile.');
  }
  return { ok: true, warnings };
});

/** Lifecycle of a Staff ID: activate an invitation, suspend, deactivate or reactivate. */
export const setStaffStatus = onCall({ timeoutSeconds: 60 }, async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const uid = text(request.data?.uid, 128);
  if (!UID.test(uid)) throw new HttpsError('invalid-argument', 'Choose the staff member.');
  if (uid === actor.uid) throw new HttpsError('failed-precondition', 'You cannot change your own access. Ask another super admin.');
  const next = request.data?.status as StaffStatus;
  if (!['Active', 'Inactive', 'Suspended'].includes(next)) throw new HttpsError('invalid-argument', 'Choose Active, Inactive or Suspended.');
  const reason = reasonOf(request.data?.reason, 'status change');
  const ref = db.doc(`admins/${uid}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data();
    if (!snap.exists || d?.role !== 'admin') throw new HttpsError('not-found', 'Staff ID not found.');
    if (d.staffRole !== STAFF_ROLE) throw new HttpsError('failed-precondition', 'This account is managed under Roles & sign-up requests.');
    expectVersion(d, request.data?.expectedVersion);
    const from = statusOf(d);
    if (from === next) throw new HttpsError('failed-precondition', `This Staff ID is already ${next}.`);
    if (next === 'Active') {
      const problems = accessProblems(normalizeMatrix(d.staffAccess), Array.isArray(d.dutyPermissions) ? d.dutyPermissions : [], 'Active');
      if (problems.length) throw new HttpsError('failed-precondition', `Fix this Staff ID's access before activating it: ${problems.slice(0, 3).join(' ')}`);
    }
    const found = await grantsAndSessions(tx, uid, next !== 'Active');
    const accessVersion = versionOf(d) + 1;
    tx.update(ref, {
      accountStatus: next, status: next === 'Active' ? 'active' : 'inactive', accessVersion,
      statusHistory: FieldValue.arrayUnion({ action: 'Status changed', from, to: next, reason, byName: actor.name, at: Timestamp.now() }),
      updatedBy: actor.uid, updatedAt: FieldValue.serverTimestamp(),
    });
    const ended = endGrantsAndSessions(tx, actor, `Staff status ${next}`, found);
    auditTx(tx, actor, 'staff_status_changed', uid, { staffCode: text(d.staffCode, 20), email: text(d.email, 120), name: text(d.name, 80), from, to: next, reason, accessVersion, ...ended });
    return { accessVersion, ...ended };
  });
  const auth = getAuth();
  await auth.updateUser(uid, { disabled: next !== 'Active' });
  if (next !== 'Active') await auth.revokeRefreshTokens(uid);
  return { ok: true, ...result };
});

/** Ends one session, or every session of a Staff ID (refresh tokens revoked: logout on all devices). */
export const revokeStaffSessions = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const uid = text(request.data?.uid, 128);
  const sessionId = text(request.data?.sessionId, 128);
  if (!UID.test(uid)) throw new HttpsError('invalid-argument', 'Choose the staff member.');
  const stamp = FieldValue.serverTimestamp();
  const end = { status: 'Revoked', endedAt: stamp, endedBy: actor.uid, endedByName: actor.name };
  let ended = 0;
  if (sessionId) {
    const ref = db.doc(`staff_sessions/${sessionId}`);
    const s = await ref.get();
    if (!s.exists || s.data()!.uid !== uid) throw new HttpsError('not-found', 'Session not found.');
    await ref.update(end);
    ended = 1;
  } else {
    await getAuth().revokeRefreshTokens(uid);
    const open = await db.collection('staff_sessions').where('uid', '==', uid).where('status', '==', 'Online').limit(100).get();
    await Promise.all(open.docs.map((d) => d.ref.update(end)));
    ended = open.size;
  }
  await db.collection('admin_audit').add({ action: sessionId ? 'staff_session_ended' : 'staff_sessions_revoked', targetId: uid, actorId: actor.uid, actorName: actor.name, at: stamp, details: { sessionId, ended } });
  return { ended };
});
