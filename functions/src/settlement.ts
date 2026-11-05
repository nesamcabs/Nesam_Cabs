// Partner settlement due-tracking (Tariff & Operations v2 p.10-12).
//
//   net settlement = approved partner entitlement − amounts the partner actually collected
//   positive → NESAM owes a payout, due at completed_at + 4 hours (state Due → Processing → Paid)
//   negative → the partner owes NESAM; the wallet ledger already carries that debit
//
// The wallet ledger (ledger.ts) remains the one record of balances. This module only tracks WHEN a
// payout is due and what happened to it: Due, Processing, Paid (with a transfer reference), Failed
// and On Hold (reason, owner, resolution deadline). A hold never resets the original due time.
// A paid settlement writes an ordinary payout request in status Paid, so the ledger debits the
// wallet through the same trigger every other payout uses and nothing is paid twice.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { FinanceSnapshot } from './domain/finance';
import { walletTotals } from './domain/finance';
import { notify } from './notify';
import { recomputeWallet, walletId } from './ledger';
import { docId } from './marketplace';
import { approvedPartnerExtraPaise, loadPrivatePricing } from './pricingPrivate';
import { requirePermission, text, requireAction, requireWithinBankLimit } from './shared';

export const SETTLEMENT_PAYOUT_HOURS = 4;
export const SETTLEMENT_STATES = ['Due', 'Processing', 'Paid', 'Failed', 'On Hold', 'Wallet'] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** settings/operations.settlement — the below-threshold relationship (D14). */
export interface SettlementPolicy {
  /** Amounts below this follow `belowThreshold`. 0 disables the special case. */
  smallAmount: number;
  /** 'payout' → same 4-hour payout as any amount; 'wallet' → stays in the wallet, partner withdraws it. */
  belowThreshold: 'payout' | 'wallet';
  payoutHours: number;
}
export function settlementPolicyOf(settings: DocumentData | undefined): SettlementPolicy {
  const s = (settings?.settlement && typeof settings.settlement === 'object' ? settings.settlement : {}) as Record<string, unknown>;
  return {
    smallAmount: typeof s.smallAmount === 'number' && s.smallAmount >= 0 && s.smallAmount <= 100000 ? s.smallAmount : 300,
    belowThreshold: s.belowThreshold === 'wallet' ? 'wallet' : 'payout',
    payoutHours: typeof s.payoutHours === 'number' && s.payoutHours >= 0 && s.payoutHours <= 168 ? s.payoutHours : SETTLEMENT_PAYOUT_HOURS,
  };
}

/** Net amount NESAM owes the partner for one completed, verified, fully-paid trip. Negative = partner owes NESAM. */
export function netSettlement(b: DocumentData, extraPartnerPaise = 0): { entitlement: number; collectedByPartner: number; net: number; ready: boolean } {
  const f = b.finance as FinanceSnapshot | undefined;
  const ps = (b.paymentSummary ?? {}) as { partnerCashHeld?: number; balanceDue?: number; status?: string };
  // Approved extra usage is credited to the partner whatever the payment method: the customer's payment (and so any cash the
  // partner holds) already includes it.
  const entitlement = r2(money(f?.partnerPayout) + (f && f.paymentMethod !== 'Cash' && b.tollsApproved === true ? money(b.tollCharges) : 0) + extraPartnerPaise / 100);
  const collectedByPartner = r2(money(ps.partnerCashHeld));
  // The payout is released only against receipts NESAM has confirmed: the customer's balance must be settled.
  const ready = b.status === 'Completed' && !!f && f.schema === 1 && f.partnerPayout !== null && ps.status === 'Paid';
  return { entitlement, collectedByPartner, net: r2(entitlement - collectedByPartner), ready };
}

/** Creates (never overwrites a decided) settlement record for a trip. Idempotent. */
export async function syncSettlementDue(bookingId: string): Promise<'created' | 'exists' | 'none'> {
  const ref = db.doc(`bookings/${bookingId}`);
  const dueRef = db.doc(`settlement_dues/${bookingId}`);
  const policy = settlementPolicyOf((await db.doc('settings/operations').get()).data());
  return db.runTransaction(async (tx) => {
    const [snap, due, privatePricing] = await Promise.all([tx.get(ref), tx.get(dueRef), loadPrivatePricing(tx, bookingId)]);
    if (!snap.exists) return 'none';
    const b = snap.data()!;
    const n = netSettlement(b, approvedPartnerExtraPaise(b, privatePricing));
    const f = b.finance as FinanceSnapshot | undefined;
    if (!n.ready || !f || n.net <= 0) return 'none';
    if (due.exists) {
      // The amount may be corrected while still undecided (fare or collection changed); a decided one is never touched.
      const d = due.data()!;
      if (['Due', 'On Hold', 'Failed'].includes(d.status) && r2(money(d.amount)) !== n.net && !d.payoutRequestId) {
        tx.update(dueRef, { amount: n.net, entitlement: n.entitlement, collectedByPartner: n.collectedByPartner, updatedAt: FieldValue.serverTimestamp() });
      }
      return 'exists';
    }
    const completed = (b.completedAt as Timestamp | undefined)?.toMillis?.() ?? Date.now();
    const small = policy.smallAmount > 0 && n.net < policy.smallAmount && policy.belowThreshold === 'wallet';
    tx.create(dueRef, {
      bookingId, bookingCode: text(b.bookingId) || bookingId, partnerType: f.partnerType, partnerId: f.partnerId,
      partnerName: text(f.partnerType === 'vendor' ? b.assignedVendorName : b.assignedDriverName),
      amount: n.net, entitlement: n.entitlement, collectedByPartner: n.collectedByPartner,
      status: small ? 'Wallet' : 'Due', channel: small ? 'wallet' : 'payout',
      dueAt: Timestamp.fromMillis(completed + policy.payoutHours * 3600000), completedAt: Timestamp.fromMillis(completed),
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return 'created';
  });
}

type Action = 'processing' | 'paid' | 'failed' | 'hold' | 'release';

/**
 * Finance moves a settlement through its states. "Paid" needs the transfer reference and a
 * beneficiary on file; it records a Paid payout request so the wallet is debited exactly once.
 */
export const updateSettlement = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = await requirePermission(request.auth, 'finance');
  requireAction(admin, 'Accounts', 'approve');
  const bookingId = docId(request.data?.bookingId, 'booking');
  const action = request.data?.action as Action;
  if (!['processing', 'paid', 'failed', 'hold', 'release'].includes(action)) throw new HttpsError('invalid-argument', 'Choose a settlement action.');
  const reference = text(request.data?.reference, 120);
  const reason = text(request.data?.reason, 300);
  const method = request.data?.method === 'Bank Transfer' ? 'Bank Transfer' : 'UPI';
  const dueRef = db.doc(`settlement_dues/${bookingId}`);
  const out = await db.runTransaction(async (tx) => {
    const due = await tx.get(dueRef);
    if (!due.exists) throw new HttpsError('not-found', 'No settlement is due for this booking.');
    const d = due.data()!;
    const stamp = FieldValue.serverTimestamp();
    const from = String(d.status);
    if (from === 'Paid') throw new HttpsError('failed-precondition', 'This settlement is already paid.');
    // Releasing money is limited by the Staff ID's settlement approval limit (server-side, per settlement).
    if (action === 'processing' || action === 'paid') requireWithinBankLimit(admin, money(d.amount));
    if (action === 'processing') {
      if (!['Due', 'Failed', 'On Hold'].includes(from) && from !== 'Wallet') throw new HttpsError('failed-precondition', `A ${from.toLowerCase()} settlement cannot move to processing.`);
      tx.update(dueRef, { status: 'Processing', initiatedAt: stamp, initiatedBy: admin.uid, updatedAt: stamp });
    } else if (action === 'failed') {
      if (reason.length < 5) throw new HttpsError('invalid-argument', 'Give the failure reason.');
      tx.update(dueRef, { status: 'Failed', failure: { reason, at: Timestamp.now(), by: admin.uid }, updatedAt: stamp });
    } else if (action === 'hold') {
      const owner = text(request.data?.holdOwner, 80);
      const deadline = text(request.data?.holdDeadline, 30);
      if (reason.length < 5 || !owner || !deadline || !Number.isFinite(Date.parse(deadline))) throw new HttpsError('invalid-argument', 'A hold needs a reason, an owner and a resolution deadline.');
      tx.update(dueRef, { status: 'On Hold', hold: { reason, owner, deadline: Timestamp.fromMillis(Date.parse(deadline)), at: Timestamp.now(), by: admin.uid }, updatedAt: stamp });
    } else if (action === 'release') {
      if (from !== 'On Hold') throw new HttpsError('failed-precondition', 'Only a held settlement can be released.');
      tx.update(dueRef, { status: 'Due', hold: FieldValue.delete(), holdReleasedAt: stamp, updatedAt: stamp });
    } else {
      if (!['Due', 'Processing', 'Failed', 'Wallet'].includes(from)) throw new HttpsError('failed-precondition', 'Release the settlement hold before paying it.');
      if (reference.length < 6) throw new HttpsError('invalid-argument', 'Enter the bank / UPI transfer reference. A payout is not Paid without one.');
      const type = d.partnerType === 'vendor' ? 'vendor' : 'driver';
      const [booking, entries, lock, privatePricing] = await Promise.all([
        tx.get(db.doc(`bookings/${bookingId}`)),
        tx.get(db.collection('wallet_ledger').where('walletId', '==', walletId(type, d.partnerId))),
        tx.get(db.doc(`payout_locks/${type}_${d.partnerId}`)),
        loadPrivatePricing(tx, bookingId),
      ]);
      const current = booking.exists ? netSettlement(booking.data()!, approvedPartnerExtraPaise(booking.data()!, privatePricing)) : null;
      if (!current?.ready || current.net <= 0 || current.net !== r2(money(d.amount))) throw new HttpsError('failed-precondition', 'The booking payment or settlement amount changed. Review it before paying.');
      if (walletTotals(entries.docs.map((entry) => entry.data())).available < money(d.amount)) throw new HttpsError('failed-precondition', 'The available wallet balance is insufficient or already reserved for another payout. Review existing payout requests first.');
      void lock;
      const privateDoc = await tx.get(db.doc(`${type === 'driver' ? 'driver_private' : 'vendor_kyc'}/${d.partnerId}`));
      const bank = type === 'driver' ? privateDoc.data()?.bank : privateDoc.data()?.payout;
      const upiOk = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(String(bank?.upiId || ''));
      const bankOk = /^\d{8,20}$/.test(String(bank?.accountNumber || '')) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bank?.ifsc || ''));
      if (!(method === 'UPI' ? upiOk : bankOk)) throw new HttpsError('failed-precondition', 'The partner has no valid payout details for that method. Ask them to update their profile first.');
      const reqRef = db.collection('payout_requests').doc(`settle_${bookingId}`);
      tx.create(reqRef, {
        id: reqRef.id, [`${type}Id`]: d.partnerId, [`${type}Name`]: text(d.partnerName), amount: d.amount, method, details: method === 'UPI' ? text(bank.upiId) : `Account ending ${String(bank.accountNumber).slice(-4)}`,
        status: 'Paid', reference, source: 'settlement_due', bookingId, createdAt: stamp, paidAt: stamp, processedBy: admin.uid, requestedAt: new Date().toISOString(),
      });
      // Debit in the same transaction, sharing the withdrawal lock: the trigger is only a reconciliation.
      tx.create(db.doc(`wallet_ledger/payout_${reqRef.id}`), {
        schema: 2, actorType: type, actorId: d.partnerId, walletId: walletId(type, d.partnerId), [`${type}Id`]: d.partnerId,
        type: 'payout', direction: 'debit', netAmount: d.amount, grossAmount: d.amount, commissionAmount: 0,
        status: 'completed', bookingId, bookingCode: text(d.bookingCode), payoutRequestId: reqRef.id, source: 'payout_request', createdAt: stamp, finalizedAt: stamp,
      });
      tx.set(db.doc(`payout_locks/${type}_${d.partnerId}`), { updatedAt: stamp });
      tx.update(dueRef, { status: 'Paid', reference, method, paidAt: stamp, paidBy: admin.uid, payoutRequestId: reqRef.id, updatedAt: stamp });
    }
    auditInTx(tx, {
      action: `settlement_${action}`, entity: 'settlement', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId,
      previous: { status: from }, next: { status: action === 'paid' ? 'Paid' : action }, reason: reason || reference,
    });
    return { type: d.partnerType === 'vendor' ? 'vendor' : 'driver', id: String(d.partnerId) };
  });
  if (action === 'paid') await recomputeWallet(out.type as 'vendor' | 'driver', out.id);
  return { ok: true };
});

/** Overdue settlements: alerts staff (once a day per settlement) and marks escalation after a day. */
export async function runSettlementOverdue(now = Date.now()): Promise<{ checked: number; overdue: number }> {
  const snap = await db.collection('settlement_dues').where('status', 'in', ['Due', 'Failed', 'Processing', 'On Hold']).get();
  let overdue = 0;
  for (const d of snap.docs) {
    const x = d.data();
    const dueAt = (x.dueAt as Timestamp | undefined)?.toMillis?.();
    if (!dueAt || dueAt > now) continue;
    overdue++;
    const hours = Math.floor((now - dueAt) / 3600000);
    const day = Math.floor((now - dueAt) / 86400000);
    if (x.status !== 'Processing' && !x.overdueAt) await d.ref.update({ overdueAt: Timestamp.fromMillis(now) }).catch(() => null);
    await notify({
      recipientType: 'admin', recipientId: 'admin', category: 'payments', severity: day >= 1 ? 'critical' : 'warning', sound: 'general', push: true,
      title: day >= 1 ? 'Partner payout seriously overdue' : 'Partner payout overdue',
      message: `${x.bookingCode} · ${text(x.partnerName) || x.partnerType} · ₹${money(x.amount).toLocaleString('en-IN')} was due ${hours} h ago (${x.status}).`,
      bookingId: d.id, bookingCode: String(x.bookingCode), cta: { label: 'Open settlement', page: 'driver-earnings', bookingId: d.id }, dedupeKey: `settlement_overdue_${d.id}_${day}`,
    }).catch(() => null);
  }
  return { checked: snap.size, overdue };
}

void walletId;

/** Keeps the due record in step on Firebase hosting; other hosts reach syncSettlementDue through reconcileBooking. */
export const onBookingSettlementChange = onDocumentUpdated('bookings/{bookingId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || after.status !== 'Completed') return;
  const keys = ['status', 'payment', 'paymentStatus', 'paymentSummary', 'finance', 'vendorPayout', 'driverPayout', 'tollsApproved', 'tollCharges', 'extraCharges'];
  if (before && keys.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null))) return;
  await syncSettlementDue(event.params.bookingId);
});
