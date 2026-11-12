// Platform fee settings: one common record for every brand, with a rule (on/off, percentage, minimum, cap) for each service.
// business_config/platform_fee is the only record; saved here only, audited and versioned. The price engine reads it for every
// quote and booking (see domain/platformFee.ts).
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { PLATFORM_FEE_SERVICES, PLATFORM_FEE_SERVICE_LABELS, parsePlatformFee, type PlatformFeeConfig } from './domain/platformFee';
import { requirePermission, requireAction } from './shared';

export const PLATFORM_FEE_DOC = 'business_config/platform_fee';

export async function loadPlatformFee(tx?: Transaction): Promise<PlatformFeeConfig> {
  const ref = db.doc(PLATFORM_FEE_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return parsePlatformFee(snap.exists ? snap.data() : null);
}

const MAX_RUPEES = 100000;
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_RUPEES;

export const savePlatformFee = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const given = input.services && typeof input.services === 'object' && !Array.isArray(input.services) ? (input.services as Record<string, any>) : null;
  if (!given) throw new HttpsError('invalid-argument', 'Send the platform fee for each service.');

  const services: Record<string, { enabled: boolean; percent: number; min: number; cap: number }> = {};
  for (const service of PLATFORM_FEE_SERVICES) {
    const label = PLATFORM_FEE_SERVICE_LABELS[service];
    const r = given[service];
    if (!r || typeof r !== 'object') throw new HttpsError('invalid-argument', `${label}: settings are missing.`);
    const enabled = r.enabled === true;
    const { percent, min, cap } = r;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new HttpsError('invalid-argument', `${label}: enter a percentage from 0 to 100.`);
    if (!isMoney(min)) throw new HttpsError('invalid-argument', `${label}: the minimum fee must be from 0 to ${MAX_RUPEES.toLocaleString('en-IN')} rupees.`);
    if (!isMoney(cap)) throw new HttpsError('invalid-argument', `${label}: the maximum fee must be from 0 to ${MAX_RUPEES.toLocaleString('en-IN')} rupees (0 = no maximum).`);
    if (enabled && percent <= 0 && min <= 0) throw new HttpsError('invalid-argument', `${label}: set a percentage or a minimum fee above zero, or switch it off.`);
    if (cap > 0 && cap < min) throw new HttpsError('invalid-argument', `${label}: the maximum fee cannot be lower than the minimum fee.`);
    services[service] = { enabled, percent: Math.round(percent * 100) / 100, min: Math.round(min * 100) / 100, cap: Math.round(cap * 100) / 100 };
  }

  const ref = db.doc(PLATFORM_FEE_DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const before = parsePlatformFee(current.exists ? current.data() : null);
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== before.version) {
      throw new HttpsError('failed-precondition', 'The platform fee was changed by someone else. Reload and review it before saving.');
    }
    const version = before.version + 1;
    const next = { services, version };
    tx.set(ref, { ...next, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'platform_fee_saved', entity: 'platform_fee', entityId: 'global', performedBy: actor.uid, performedByName: actor.name,
      role: 'admin', previous: before, next, reason: 'Platform fee settings changed',
    });
    return { version };
  });
});
