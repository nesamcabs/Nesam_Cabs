// Night allowance settings: one common record for every vehicle, brand and service (see domain/nightAllowance.ts).
// business_config/night_allowance is the only record; saved here only, audited and versioned.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { parseNightAllowance, type NightAllowanceConfig } from './domain/nightAllowance';
import { requirePermission, requireAction } from './shared';

export const NIGHT_ALLOWANCE_DOC = 'business_config/night_allowance';

export async function loadNightAllowance(tx?: Transaction): Promise<NightAllowanceConfig> {
  const ref = db.doc(NIGHT_ALLOWANCE_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return parseNightAllowance(snap.exists ? snap.data() : null);
}

const MAX_RUPEES = 100000;

export const saveNightAllowance = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const enabled = input.enabled === true;
  const amount = input.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > MAX_RUPEES) {
    throw new HttpsError('invalid-argument', `Enter the night allowance in rupees, from 0 to ${MAX_RUPEES.toLocaleString('en-IN')}.`);
  }
  if (enabled && !(amount > 0)) throw new HttpsError('invalid-argument', 'Enter an amount above zero, or switch the night allowance off.');

  const ref = db.doc(NIGHT_ALLOWANCE_DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const before = parseNightAllowance(current.exists ? current.data() : null);
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== before.version) {
      throw new HttpsError('failed-precondition', 'The night allowance was changed by someone else. Reload and review it before saving.');
    }
    const version = before.version + 1;
    const next = { enabled, amount: Math.round(amount * 100) / 100, version };
    tx.set(ref, { ...next, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'night_allowance_saved', entity: 'night_allowance', entityId: 'global', performedBy: actor.uid, performedByName: actor.name,
      role: 'admin', previous: before, next, reason: 'Night allowance changed',
    });
    return { version };
  });
});
