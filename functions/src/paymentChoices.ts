// Admin controls for the customer's payment choices (Service & Fare Settings › Payment options), and the loader the booking server uses.
//   getPaymentChoiceSettings   pricing staff: the saved choices
//   savePaymentChoiceSettings  pricing staff (Settings › edit): saves them, versioned and audited
// The rules themselves are in domain/paymentChoices.ts. Customers never read this document: they get the evaluated list from getPaymentOptions.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { requireAction, requirePermission } from './shared';
import { parseChoices, validateChoices, type PaymentChoices } from './domain/paymentChoices';

export const PAYMENT_CHOICES_DOC = 'settings/payment_choices';

export async function loadPaymentChoices(tx?: Transaction): Promise<PaymentChoices> {
  const ref = db.doc(PAYMENT_CHOICES_DOC);
  const snap = tx ? await tx.get(ref) : await ref.get();
  return parseChoices(snap.exists ? snap.data() : null);
}

const shape = (c: PaymentChoices, extra: Record<string, unknown> = {}) => ({ ...c, ...extra });

export const getPaymentChoiceSettings = onCall(async (request) => {
  await requirePermission(request.auth, 'pricing');
  const snap = await db.doc(PAYMENT_CHOICES_DOC).get();
  const d = snap.data() ?? {};
  return shape(parseChoices(snap.exists ? d : null), {
    updatedByName: typeof d.updatedByName === 'string' ? d.updatedByName : '',
    updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate().toISOString() : null,
  });
});

export const savePaymentChoiceSettings = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  let next: Omit<PaymentChoices, 'version'>;
  try {
    next = validateChoices(input);
  } catch (e) {
    throw new HttpsError('invalid-argument', (e as Error).message);
  }
  const ref = db.doc(PAYMENT_CHOICES_DOC);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const before = parseChoices(cur.exists ? cur.data() : null);
    if (typeof input.expectedVersion === 'number' && input.expectedVersion !== before.version) {
      throw new HttpsError('failed-precondition', 'The payment options were changed by someone else. Reload and review them before saving.');
    }
    const version = before.version + 1;
    tx.set(ref, { ...next, version, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, {
      action: 'payment_choices_saved', entity: 'payment_choices', entityId: 'global', performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: before, next: { ...next, version }, reason: 'Customer payment options changed',
    });
    return { version };
  });
});
