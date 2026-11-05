// Terms, privacy and consent documents with versioned acceptance.
//   legal_documents/{type}_{role}            current published (or draft) text
//   legal_documents/{key}/versions/{n}       immutable copy of every published version
//   legal_acceptances/{uid}_{key}_v{n}       one record per user, document and version
// Acceptance records are written only here, with the user's own id and the
// connection details the server sees. A new published version asks everyone to
// accept again. Drafts are never enforced.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { audit, auditInTx } from './audit';
import { LEGAL_DEFAULTS, LEGAL_ROLES, LEGAL_TYPES, LegalRole, legalKey } from './domain/legalDefaults';
import { requirePermission, requireSuperAdmin, text, requireAction } from './shared';

export interface RequiredDoc {
  key: string;
  title: string;
  version: number;
  type: string;
  checkboxText: string;
}

const isRole = (v: unknown): v is LegalRole => (LEGAL_ROLES as readonly string[]).includes(String(v));

/** Published documents the role must accept, with the version currently in force. */
export async function requiredDocuments(role: LegalRole): Promise<RequiredDoc[]> {
  const snap = await db.collection('legal_documents').where('role', '==', role).get();
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Record<string, any>))
    .filter((d) => d.status === 'Published' && d.requiresAcceptance === true && typeof d.version === 'number' && d.version > 0)
    .map((d) => ({ key: d.id as string, title: String(d.title ?? ''), version: d.version as number, type: String(d.type ?? ''), checkboxText: String(d.checkboxText ?? '') }));
}

/** Documents of the role the user has not accepted at the current version. */
export async function missingAcceptances(uid: string, role: LegalRole): Promise<RequiredDoc[]> {
  const required = await requiredDocuments(role);
  if (!required.length) return [];
  const accepted = await Promise.all(required.map((d) => db.doc(`legal_acceptances/${uid}_${d.key}_v${d.version}`).get()));
  return required.filter((_, i) => !accepted[i].exists);
}

/** Blocks an action until the current policies are accepted. No published documents → no block. */
export async function assertLegalAccepted(uid: string, role: LegalRole): Promise<void> {
  const missing = await missingAcceptances(uid, role);
  if (missing.length) {
    throw new HttpsError('failed-precondition', 'Please review and accept the updated Terms & Conditions and Privacy Policy to continue.', { legalRequired: true, documents: missing });
  }
}

export const getLegalStatus = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (!isRole(request.data?.role)) throw new HttpsError('invalid-argument', 'Choose a role.');
  const role: LegalRole = request.data.role;
  return { role, missing: await missingAcceptances(uid, role), required: await requiredDocuments(role) };
});

export const acceptLegalDocuments = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const input = request.data ?? {};
  if (!isRole(input.role)) throw new HttpsError('invalid-argument', 'Choose a role.');
  const role: LegalRole = input.role;
  const accept = Array.isArray(input.accept) ? input.accept : [];
  if (!accept.length || accept.length > 12) throw new HttpsError('invalid-argument', 'Choose the documents you are accepting.');
  if (input.confirmed !== true) throw new HttpsError('failed-precondition', 'Tick the box to confirm you have read the documents.');

  // A role is checked against the person's profile once it exists. Registration
  // accepts before the profile does, so a missing profile is allowed.
  const profileColl = role === 'customer' ? 'customers' : role === 'driver' ? 'drivers' : role === 'vendor' ? 'vendors' : 'admins';
  const profile = await db.doc(`${profileColl}/${uid}`).get();
  const roleVerified = profile.exists;
  if (role === 'admin' && !roleVerified) throw new HttpsError('permission-denied', 'This account is not a staff account.');

  const ip = String(request.rawRequest?.headers?.['x-forwarded-for'] ?? request.rawRequest?.ip ?? '').split(',')[0].trim().slice(0, 64);
  const userAgent = String(request.rawRequest?.headers?.['user-agent'] ?? '').slice(0, 300);
  const device = input.device && typeof input.device === 'object' ? {
    platform: text((input.device as any).platform, 20), appVersion: text((input.device as any).appVersion, 20), model: text((input.device as any).model, 60),
  } : {};

  const written: string[] = [];
  for (const item of accept) {
    const key = text(item?.key, 80);
    const doc = await db.doc(`legal_documents/${key}`).get();
    const d = doc.data();
    if (!doc.exists || !d || d.status !== 'Published' || d.role !== role) throw new HttpsError('failed-precondition', 'One of the documents is no longer available. Reload and try again.');
    // The user must be accepting the version in force right now.
    if (item.version !== d.version) throw new HttpsError('failed-precondition', 'These documents were updated. Reload to read the latest version.');
    const ref = db.doc(`legal_acceptances/${uid}_${key}_v${d.version}`);
    try {
      await ref.create({
        userId: uid, role, roleVerified, key, type: d.type, version: d.version, title: d.title,
        checkboxText: text(input.checkboxText, 300) || d.checkboxText, acceptedAt: FieldValue.serverTimestamp(),
        ip, userAgent, device, source: text(input.source, 40) || 'app',
      });
      written.push(key);
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err; // already accepted: fine
    }
  }
  if (written.length) {
    await audit({ action: 'legal_accepted', entity: 'legal', entityId: uid, performedBy: uid, role: role === 'admin' ? 'admin' : role, meta: { documents: written } });
  }
  return { accepted: written.length };
});

/** Publishes a new version of one document; everyone who accepted an older version is asked again. */
function checkLegalRevision(input: any, current: FirebaseFirestore.DocumentSnapshot) {
  const data = current.data();
  const status = current.exists ? data?.status : 'Missing';
  const version = current.exists ? data?.version ?? 0 : 0;
  const revision = current.exists ? data?.draftRevision ?? 0 : 0;
  if (!Number.isInteger(input.expectedVersion) || !Number.isInteger(input.expectedRevision)
    || !['Missing', 'Draft', 'Published'].includes(input.expectedStatus)) {
    throw new HttpsError('invalid-argument', 'Reload the document editor before saving.');
  }
  if (input.expectedStatus !== status || input.expectedVersion !== version || input.expectedRevision !== revision) {
    throw new HttpsError('failed-precondition', 'This document changed while you were editing. Close and reopen it to review the latest version.');
  }
}

/** Save unpublished work only: never replaces the text currently published to users. */
export const saveLegalDraft = onCall(async request => {
  const actor = await requirePermission(request.auth, 'system');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  if (!LEGAL_TYPES.includes(input.type) || !isRole(input.role)) throw new HttpsError('invalid-argument', 'Choose the document type and role.');
  const title = text(input.title, 140);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const checkboxText = typeof input.checkboxText === 'string' ? input.checkboxText.trim() : '';
  if (title.length < 3 || body.length < 1 || body.length > 60000 || checkboxText.length > 300 || typeof input.requiresAcceptance !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Enter a title and draft text (up to 60,000 characters), with valid acceptance settings.');
  }
  const key = legalKey(input.type, input.role);
  const ref = db.doc(`legal_documents/${key}`);
  return db.runTransaction(async tx => {
    const current = await tx.get(ref);
    checkLegalRevision(input, current);
    if (current.data()?.status === 'Published') throw new HttpsError('failed-precondition', 'Published text cannot be replaced by a draft. Use Publish new version after review.');
    const revision = (current.data()?.draftRevision ?? 0) + 1;
    tx.set(ref, {
      key, type: input.type, role: input.role, title, body, checkboxText,
      requiresAcceptance: input.requiresAcceptance, version: 0, status: 'Draft', draftRevision: revision,
      ...(!current.exists ? { createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid } : {}),
      updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid, updatedByName: actor.name,
    }, { merge: true });
    auditInTx(tx, { action: 'legal_draft_saved', entity: 'legal_document', entityId: key, performedBy: actor.uid, performedByName: actor.name, role: 'admin', next: { draftRevision: revision, status: 'Draft' } });
    return { key, draftRevision: revision };
  });
});

export const publishLegalDocument = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'system');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  if (!LEGAL_TYPES.includes(input.type) || !isRole(input.role)) throw new HttpsError('invalid-argument', 'Choose the document type and role.');
  const title = text(input.title, 140);
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (title.length < 3) throw new HttpsError('invalid-argument', 'Enter a title.');
  if (body.length < 40 || body.length > 60000) throw new HttpsError('invalid-argument', 'The text must be between 40 and 60,000 characters.');
  if (typeof input.requiresAcceptance !== 'boolean' || input.reviewed !== true) throw new HttpsError('failed-precondition', 'Confirm you reviewed the document and its acceptance settings before publishing.');
  const key = legalKey(input.type, input.role);
  const checkboxText = text(input.checkboxText, 300) || 'I agree to the Terms & Conditions and Privacy Policy.';
  const requiresAcceptance = input.requiresAcceptance !== false;
  if (requiresAcceptance && (typeof input.checkboxText !== 'string' || input.checkboxText.trim().length < 10)) throw new HttpsError('invalid-argument', 'Enter the acceptance checkbox text.');
  const ref = db.doc(`legal_documents/${key}`);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    checkLegalRevision(input, cur);
    if (cur.data()?.status === 'Published' && text(input.changeSummary, 300).length < 5) throw new HttpsError('invalid-argument', 'Briefly describe what changed before publishing a new version.');
    const version = (cur.exists && typeof cur.data()!.version === 'number' && cur.data()!.status === 'Published' ? cur.data()!.version : (cur.data()?.lastPublishedVersion ?? 0)) + 1;
    const doc = {
      key, type: input.type, role: input.role, title, body, checkboxText, requiresAcceptance, version, status: 'Published',
      changeSummary: text(input.changeSummary, 300), publishedAt: FieldValue.serverTimestamp(), publishedBy: actor.uid, publishedByName: actor.name,
      lastPublishedVersion: version,
      draftRevision: cur.data()?.draftRevision ?? 0,
    };
    tx.set(ref, doc);
    tx.set(ref.collection('versions').doc(String(version)), doc);
    auditInTx(tx, { action: 'legal_published', entity: 'legal_document', entityId: key, performedBy: actor.uid, performedByName: actor.name, role: 'admin', previous: cur.exists ? { version: cur.data()!.version, status: cur.data()!.status } : null, next: { version }, reason: text(input.changeSummary, 300) });
    return { key, version };
  });
});

/** Creates the starter templates as DRAFTS (never overwrites an existing document). */
export const seedLegalDocuments = onCall(async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  let created = 0;
  for (const d of LEGAL_DEFAULTS) {
    const ref = db.doc(`legal_documents/${d.key}`);
    try {
      await ref.create({
        key: d.key, type: d.type, role: d.role, title: d.title, body: d.body, checkboxText: d.checkboxText, requiresAcceptance: d.requiresAcceptance,
        version: 0, status: 'Draft', draftRevision: 0, changeSummary: 'Starter template — review with your legal adviser, then publish.',
        createdAt: FieldValue.serverTimestamp(), createdBy: actor.uid,
      });
      created++;
    } catch (err) {
      if ((err as { code?: number }).code !== 6) throw err;
    }
  }
  return { created, total: LEGAL_DEFAULTS.length };
});
