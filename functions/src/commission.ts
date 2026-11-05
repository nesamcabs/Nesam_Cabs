// The platform commission policy (business_config/commission). Written only
// here, by staff with finance permission; every change is versioned and
// audited. Bookings store the rate they were published under, so later
// changes never alter existing trips.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { CommissionPolicy, parseCommissionPolicy, validateCommissionPolicy } from './domain/finance';
import { requirePermission, requireAction } from './shared';

export const COMMISSION_DOC = 'business_config/commission';

export async function loadCommissionPolicy(tx?: Transaction): Promise<CommissionPolicy | null> {
  const ref = db.doc(COMMISSION_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? parseCommissionPolicy(snap.data()) : null;
}

export const saveCommissionPolicy = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'finance');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const errors = validateCommissionPolicy(input);
  if (errors.length) throw new HttpsError('invalid-argument', errors.join(' '));
  const clean = (m: unknown) =>
    Object.fromEntries(Object.entries((m as Record<string, { rate: number }>) || {}).map(([k, r]) => [k, { rate: r.rate }]));
  const ref = db.doc(COMMISSION_DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const before = current.exists ? current.data()! : null;
    const expected = input.expectedVersion;
    const version = typeof before?.version === 'number' ? before.version : 0;
    if (typeof expected === 'number' && expected !== version) {
      throw new HttpsError('failed-precondition', 'The commission policy was changed by someone else. Reload and review it before saving.');
    }
    const next = {
      base: input.base,
      global: input.global == null ? null : { rate: input.global.rate },
      services: clean(input.services),
      categories: clean(input.categories),
      version: version + 1,
      updatedBy: actor.uid,
      updatedByName: actor.name,
      updatedAt: FieldValue.serverTimestamp(),
    };
    tx.set(ref, next);
    tx.create(db.collection('admin_audit').doc(), {
      action: 'commission_policy_saved', targetId: 'commission', actorId: actor.uid, actorName: actor.name,
      details: { before: before ? { base: before.base, global: before.global, services: before.services, categories: before.categories, version } : null,
        after: { base: next.base, global: next.global, services: next.services, categories: next.categories, version: next.version } },
      at: FieldValue.serverTimestamp(),
    });
    return { version: next.version };
  });
});
