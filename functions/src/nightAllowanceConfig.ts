// Night allowance settings: one common record for every vehicle, brand and service (see domain/nightAllowance.ts).
// business_config/night_allowance is the only record; saved here only, audited and versioned.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { parseNightAllowance, type NightAllowanceConfig } from './domain/nightAllowance';
import { requirePermission, requireAction } from './shared';
import { TARIFF_CLASSES } from './domain/tariff';

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
  // Per-vehicle amounts (Pricing → Fares): each class is checked here; a class left out keeps what it had, and 0 means "none for this vehicle".
  let sentClasses: Record<string, number> | null = null;
  if (input.classes !== undefined && input.classes !== null) {
    if (typeof input.classes !== 'object' || Array.isArray(input.classes)) throw new HttpsError('invalid-argument', 'Send the night allowance for each vehicle.');
    sentClasses = {};
    for (const [k, v] of Object.entries(input.classes as Record<string, unknown>)) {
      if (!(TARIFF_CLASSES as readonly string[]).includes(k)) throw new HttpsError('invalid-argument', 'Choose a supported vehicle category.');
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_RUPEES) throw new HttpsError('invalid-argument', `Enter the night allowance for each vehicle from 0 to ${MAX_RUPEES.toLocaleString('en-IN')} rupees.`);
      sentClasses[k] = Math.round(v * 100) / 100;
    }
  }
  // What the partner gets for a night pickup, per vehicle class: same checks, same "left out keeps what it had" rule.
  let sentPartner: Record<string, number> | null = null;
  if (input.partnerClasses !== undefined && input.partnerClasses !== null) {
    if (typeof input.partnerClasses !== 'object' || Array.isArray(input.partnerClasses)) throw new HttpsError('invalid-argument', 'Send what the partner gets for each vehicle.');
    sentPartner = {};
    for (const [k, v] of Object.entries(input.partnerClasses as Record<string, unknown>)) {
      if (!(TARIFF_CLASSES as readonly string[]).includes(k)) throw new HttpsError('invalid-argument', 'Choose a supported vehicle category.');
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_RUPEES) throw new HttpsError('invalid-argument', `Enter what the partner gets for each vehicle from 0 to ${MAX_RUPEES.toLocaleString('en-IN')} rupees.`);
      sentPartner[k] = Math.round(v * 100) / 100;
    }
  }
  if (enabled && !(amount > 0) && !Object.values(sentClasses ?? {}).some((v) => v > 0) && !Object.values(sentPartner ?? {}).some((v) => v > 0)) throw new HttpsError('invalid-argument', 'Enter an amount above zero, or switch the night allowance off.');

  const ref = db.doc(NIGHT_ALLOWANCE_DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const before = parseNightAllowance(current.exists ? current.data() : null);
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== before.version) {
      throw new HttpsError('failed-precondition', 'The night allowance was changed by someone else. Reload and review it before saving.');
    }
    const version = before.version + 1;
    const classes = { ...(before.classes ?? {}), ...(sentClasses ?? {}) };
    const partnerClasses = { ...(before.partnerClasses ?? {}), ...(sentPartner ?? {}) };
    const next = { enabled, amount: Math.round(amount * 100) / 100, ...(Object.keys(classes).length ? { classes } : {}), ...(Object.keys(partnerClasses).length ? { partnerClasses } : {}), version };
    tx.set(ref, { ...next, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'night_allowance_saved', entity: 'night_allowance', entityId: 'global', performedBy: actor.uid, performedByName: actor.name,
      role: 'admin', previous: before, next, reason: 'Night allowance changed',
    });
    return { version };
  });
});
