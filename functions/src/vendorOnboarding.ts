// Vendor registration: request → one-time invitation link → onboarding.
//
//   1. requestVendorRegistration  – a verified mobile asks NESAM to open an account
//   2. issueVendorInvitation      – staff (people permission) issue a link
//   3. redeemVendorInvitation     – the invited mobile uses it once; vendors/{uid} is
//                                   created here, never by the client
//
// Only the SHA-256 of the token is stored, so a database reader cannot use an
// invitation. A token works for one phone number, once, before it expires.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'crypto';
import { db } from './admin';
import { audit } from './audit';
import { notify } from './notify';
import { mailOfficeVendorRequest } from './officeMail';
import { requirePermission, text, requireAction } from './shared';

const DEFAULT_VALID_HOURS = 72;
const MAX_VALID_HOURS = 168;

export const hashInvitationToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Accepts a bare code or a pasted link ("…/?invite=CODE"). */
export function tokenFromInput(input: unknown): string {
  if (typeof input !== 'string') return '';
  const s = input.trim();
  const m = /[?&#]invite=([A-Za-z0-9_-]+)/.exec(s);
  const t = m ? m[1] : s;
  return /^[A-Za-z0-9_-]{20,64}$/.test(t) ? t : '';
}

const e164 = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\+91[6-9]\d{9}$/.test(s) ? s : '';
};

function phoneOf(auth: { token?: Record<string, unknown> } | undefined): string {
  const p = auth?.token?.phone_number;
  if (typeof p !== 'string' || !p) throw new HttpsError('failed-precondition', 'Verify your mobile number first.');
  return p;
}

export const requestVendorRegistration = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const phone = phoneOf(request.auth as { token?: Record<string, unknown> });

  const [vendor, existing] = await Promise.all([db.doc(`vendors/${uid}`).get(), db.doc(`vendor_requests/${uid}`).get()]);
  if (vendor.exists) return { status: 'registered' as const };
  if (existing.exists) return { status: String(existing.data()!.status ?? 'Requested') === 'Invited' ? 'invited' as const : 'requested' as const };

  await db.doc(`vendor_requests/${uid}`).create({ uid, phone, status: 'Requested', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  await notify({
    recipientType: 'admin', recipientId: 'admin', category: 'approvals', severity: 'info', sound: 'general',
    title: 'Vendor registration requested', message: `${phone} asked to register as a vendor. Issue an invitation link to let them continue.`,
    cta: { label: 'Open vendors', page: 'vendors' }, dedupeKey: `vendor_request_${uid}`, push: true,
  }).catch(() => null);
  await mailOfficeVendorRequest([['Vendor Phone', phone], ['UID', uid]]).catch(() => null);
  return { status: 'requested' as const };
});

export const issueVendorInvitation = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'people');
  requireAction(admin, 'Vendors', 'create');
  const requestId = text(request.data?.requestId, 128);
  let phone = e164(request.data?.phone);
  if (!phone && requestId) {
    const r = await db.doc(`vendor_requests/${requestId}`).get();
    phone = e164(r.data()?.phone);
  }
  if (!phone) throw new HttpsError('invalid-argument', 'Enter the vendor\'s mobile number as +91 followed by 10 digits.');
  const hours = Math.min(MAX_VALID_HOURS, Math.max(1, Math.round(Number(request.data?.validHours) || DEFAULT_VALID_HOURS)));

  const already = await db.collection('vendors').where('phone', '==', phone).limit(1).get();
  if (!already.empty) throw new HttpsError('already-exists', 'A vendor account already exists for this mobile number.');

  const token = randomBytes(24).toString('base64url');
  const id = hashInvitationToken(token);
  const expiresAt = Timestamp.fromMillis(Date.now() + hours * 3600_000);
  const open = await db.collection('vendor_invitations').where('phone', '==', phone).where('status', '==', 'Issued').get();

  const batch = db.batch();
  // One live invitation per number: issuing a new one retires the old link.
  for (const d of open.docs) batch.update(d.ref, { status: 'Revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: admin.uid });
  batch.create(db.doc(`vendor_invitations/${id}`), {
    id, phone, status: 'Issued', expiresAt, requestId: requestId || '', issuedBy: admin.uid, issuedByName: admin.name, createdAt: FieldValue.serverTimestamp(),
  });
  if (requestId) batch.set(db.doc(`vendor_requests/${requestId}`), { status: 'Invited', invitedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
  await audit({ action: 'vendor_invitation_issued', entity: 'vendor_invitation', entityId: id, performedBy: admin.uid, performedByName: admin.name, role: 'admin', next: { phone, expiresAtMs: expiresAt.toMillis() } });

  const base = (process.env.VENDOR_PORTAL_URL ?? '').trim().replace(/\/$/, '');
  return { token, invitationId: id, phone, expiresAtMs: expiresAt.toMillis(), link: base ? `${base}/?invite=${token}` : '' };
});

export const revokeVendorInvitation = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'people');
  requireAction(admin, 'Vendors', 'edit');
  const id = text(request.data?.invitationId, 80);
  if (!/^[a-f0-9]{64}$/.test(id)) throw new HttpsError('invalid-argument', 'Invalid invitation.');
  const ref = db.doc(`vendor_invitations/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Invitation not found.');
  if (snap.data()!.status !== 'Issued') throw new HttpsError('failed-precondition', 'Only an unused invitation can be revoked.');
  await ref.update({ status: 'Revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: admin.uid });
  await audit({ action: 'vendor_invitation_revoked', entity: 'vendor_invitation', entityId: id, performedBy: admin.uid, performedByName: admin.name, role: 'admin' });
  return { ok: true };
});

export const redeemVendorInvitation = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const phone = phoneOf(request.auth as { token?: Record<string, unknown> });
  const token = tokenFromInput(request.data?.token);
  if (!token) throw new HttpsError('invalid-argument', 'This invitation link is not valid.');
  const id = hashInvitationToken(token);

  return db.runTransaction(async (tx) => {
    const [inv, vendor] = await Promise.all([tx.get(db.doc(`vendor_invitations/${id}`)), tx.get(db.doc(`vendors/${uid}`))]);
    const i = inv.data();
    if (!inv.exists || !i) throw new HttpsError('not-found', 'This invitation link is not valid.');
    // Retrying a redemption that already succeeded is not an error.
    if (i.status === 'Redeemed' && i.redeemedBy === uid && vendor.exists) return { ok: true as const };
    if (i.status !== 'Issued') throw new HttpsError('failed-precondition', 'This invitation was already used or withdrawn. Ask NESAM for a new one.');
    if ((i.expiresAt as Timestamp).toMillis() < Date.now()) throw new HttpsError('failed-precondition', 'This invitation has expired. Ask NESAM for a new one.');
    if (i.phone !== phone) throw new HttpsError('permission-denied', 'This invitation was issued to a different mobile number.');
    if (vendor.exists) throw new HttpsError('already-exists', 'A vendor account already exists for this number.');

    tx.update(inv.ref, { status: 'Redeemed', redeemedBy: uid, redeemedAt: FieldValue.serverTimestamp() });
    tx.create(db.doc(`vendors/${uid}`), {
      uid, role: 'vendor', phone, status: 'INCOMPLETE', onboardingStep: 0, invitationId: id,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(db.doc(`vendor_requests/${uid}`), { uid, phone, status: 'Registered', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true as const };
  });
});
