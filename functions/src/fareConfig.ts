// Global fare adjustment (festival pricing, promotional reduction…).
// business_config/fare_adjustment is the authoritative record; a trimmed copy
// is mirrored to public_config/fare_adjustment so the customer apps can show
// the same price the server will charge. Saved only here, audited, versioned.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { FareAdjustmentInput } from './domain/pricing';
import { isoDateIST } from './domain/time';
import { requirePermission, text, requireAction } from './shared';

export const FARE_ADJUSTMENT_DOC = 'business_config/fare_adjustment';
export const FARE_ADJUSTMENT_PUBLIC = 'public_config/fare_adjustment';

export interface StoredAdjustment {
  enabled: boolean;
  name: string;
  direction: 'increase' | 'decrease';
  percent: number;
  startDate: string;
  endDate: string;
  reason: string;
  version: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAdjustment(d: Record<string, unknown> | undefined | null): StoredAdjustment | null {
  if (!d) return null;
  const percent = typeof d.percent === 'number' && Number.isFinite(d.percent) ? d.percent : 0;
  if (d.direction !== 'increase' && d.direction !== 'decrease') return null;
  return {
    enabled: d.enabled === true,
    name: typeof d.name === 'string' ? d.name : '',
    direction: d.direction,
    percent,
    startDate: typeof d.startDate === 'string' && DATE.test(d.startDate) ? d.startDate : '',
    endDate: typeof d.endDate === 'string' && DATE.test(d.endDate) ? d.endDate : '',
    reason: typeof d.reason === 'string' ? d.reason : '',
    version: typeof d.version === 'number' ? d.version : 0,
  };
}

/** The adjustment that applies at `now` (India calendar dates), or null. */
export function effectiveAdjustment(a: StoredAdjustment | null, now = new Date()): FareAdjustmentInput | null {
  if (!a || !a.enabled || !(a.percent > 0)) return null;
  const today = isoDateIST(now);
  if (a.startDate && today < a.startDate) return null;
  if (a.endDate && today > a.endDate) return null;
  return { id: `global_v${a.version}`, name: a.name || 'Fare adjustment', direction: a.direction, percent: a.percent };
}

export async function loadFareAdjustment(tx?: Transaction): Promise<StoredAdjustment | null> {
  const ref = db.doc(FARE_ADJUSTMENT_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return snap.exists ? parseAdjustment(snap.data()) : null;
}

export const saveFareAdjustment = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  if (input.direction !== 'increase' && input.direction !== 'decrease') throw new HttpsError('invalid-argument', 'Choose Increase or Decrease.');
  const percent = input.percent;
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) throw new HttpsError('invalid-argument', 'Enter a percentage from 0 to 100.');
  if (input.direction === 'decrease' && percent >= 100) throw new HttpsError('invalid-argument', 'A decrease must be below 100%.');
  const name = text(input.name, 80);
  if (input.enabled === true && !name) throw new HttpsError('invalid-argument', 'Give the adjustment a name, for example "Festival pricing".');
  const startDate = typeof input.startDate === 'string' ? input.startDate : '';
  const endDate = typeof input.endDate === 'string' ? input.endDate : '';
  if ((startDate && !DATE.test(startDate)) || (endDate && !DATE.test(endDate))) throw new HttpsError('invalid-argument', 'Dates must be in YYYY-MM-DD format.');
  if (startDate && endDate && endDate < startDate) throw new HttpsError('invalid-argument', 'The end date is before the start date.');
  const reason = text(input.reason, 300);
  if (input.enabled === true && reason.length < 5) throw new HttpsError('invalid-argument', 'Give a short reason for the adjustment.');

  const ref = db.doc(FARE_ADJUSTMENT_DOC);
  return db.runTransaction(async (tx) => {
    const current = await tx.get(ref);
    const before = current.exists ? parseAdjustment(current.data()) : null;
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== (before?.version ?? 0)) {
      throw new HttpsError('failed-precondition', 'The fare adjustment was changed by someone else. Reload and review it before saving.');
    }
    const version = (before?.version ?? 0) + 1;
    const next = { enabled: input.enabled === true, name, direction: input.direction, percent, startDate, endDate, reason, version };
    tx.set(ref, { ...next, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    const { reason: _internalReason, ...publicFields } = next;
    tx.set(db.doc(FARE_ADJUSTMENT_PUBLIC), { ...publicFields, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'fare_adjustment_saved', entity: 'fare_adjustment', entityId: 'global', performedBy: actor.uid, performedByName: actor.name,
      role: 'admin', previous: before, next, reason,
    });
    return { version };
  });
});
