// Partner money: one ledger, one wallet read model, one payout check.
//
// • When a trip is completed with a verified fare, the server writes an
//   immutable finance snapshot on the booking and credits the partner
//   (vendor for fleet trips, otherwise the independent driver).
// • Ledger ids are deterministic per event (trip_/toll_/cash_/payout_), so a
//   trigger delivered twice — or a backfill run twice — never double-credits.
// • wallets/{type}_{id} is recomputed from the ledger after every change;
//   every app reads it and never calculates a balance of its own.
// Clients can't write any of this (firestore.rules).
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { DocumentData, FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { FinanceSnapshot, PartnerType, buildFinanceSnapshot, payoutLedgerStatus, walletTotals } from './domain/finance';
import { approvedPartnerExtraPaise, loadPrivatePricing } from './pricingPrivate';
import { approved, requestIdOf, requireSuperAdmin, text } from './shared';

const ledgerRef = (id: string) => db.doc(`wallet_ledger/${id}`);
export const walletId = (type: PartnerType, id: string) => `${type}_${id}`;
const money = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const isSnapshot = (v: unknown): v is FinanceSnapshot => !!v && typeof v === 'object' && (v as { schema?: unknown }).schema === 1;
const isPaid = (b: DocumentData) => b.payment === 'Paid' || b.paymentStatus === 'Paid';

function ownerFields(type: PartnerType, id: string) {
  return { actorType: type, actorId: id, walletId: walletId(type, id), [type === 'vendor' ? 'vendorId' : 'driverId']: id };
}

/** Recomputes wallets/{type}_{id} from the partner's ledger entries. */
export async function recomputeWallet(type: PartnerType, id: string): Promise<void> {
  const key = walletId(type, id);
  const entries = await db.collection('wallet_ledger').where('walletId', '==', key).get();
  const totals = walletTotals(entries.docs.map((d) => d.data()));
  await db.doc(`wallets/${key}`).set({ ...ownerFields(type, id), ...totals, updatedAt: FieldValue.serverTimestamp() });
}

/**
 * Brings one booking's finance snapshot and ledger entries up to date.
 * Safe to call any number of times: amounts are fixed when first written.
 */
export async function syncBookingFinance(bookingId: string): Promise<{ type: PartnerType; id: string } | null> {
  const ref = db.doc(`bookings/${bookingId}`);
  const actor = await db.runTransaction(async (tx) => {
    const [snap, tripE, tollE, cashE, extraE, privatePricing] = await Promise.all([
      tx.get(ref), tx.get(ledgerRef(`trip_${bookingId}`)), tx.get(ledgerRef(`toll_${bookingId}`)), tx.get(ledgerRef(`cash_${bookingId}`)),
      tx.get(ledgerRef(`extra_${bookingId}`)), loadPrivatePricing(tx, bookingId),
    ]);
    if (!snap.exists) return null;
    const b = snap.data()!;
    const stamp = FieldValue.serverTimestamp();
    let finance: FinanceSnapshot | null = isSnapshot(b.finance) ? b.finance : null;
    if (!finance) {
      if (b.status !== 'Completed' || b.fareVerified !== true) return null;
      finance = buildFinanceSnapshot(b);
      if (!finance) return null;
      tx.update(ref, { finance: { ...finance, finalizedAt: stamp } });
    }
    const paid = isPaid(b);
    const owner = ownerFields(finance.partnerType, finance.partnerId);
    const common = { schema: 2, ...owner, bookingId, bookingCode: text(b.bookingId) || bookingId, payoutRequestId: '' };

    if (finance.partnerPayout !== null) {
      const existing = tripE.data();
      if (!tripE.exists || existing?.schema !== 2) {
        tx.set(ledgerRef(`trip_${bookingId}`), {
          ...common, type: 'trip_earning', direction: 'credit', netAmount: finance.partnerPayout, grossAmount: finance.fareTotal,
          commissionAmount: finance.platformRevenue ?? 0, status: paid ? 'available' : 'pending', source: 'trip_completion',
          createdAt: stamp, ...(paid ? { finalizedAt: stamp } : {}), ...(tripE.exists ? { legacyEntry: existing } : {}),
        });
      } else if (existing.status === 'pending' && paid) {
        tx.update(ledgerRef(`trip_${bookingId}`), { status: 'available', finalizedAt: stamp });
      }
    }

    // Tolls the company collected with an online payment are passed on to
    // the partner once approved; in a cash trip the partner already has them.
    const tolls = finance.paymentMethod !== 'Cash' && b.tollsApproved === true ? Math.max(0, money(b.tollCharges)) : 0;
    if (tolls > 0) {
      if (!tollE.exists) {
        tx.set(ledgerRef(`toll_${bookingId}`), {
          ...common, type: 'toll_reimbursement', direction: 'credit', netAmount: tolls, grossAmount: tolls, commissionAmount: 0,
          status: paid ? 'available' : 'pending', source: 'toll_approval', createdAt: stamp, ...(paid ? { finalizedAt: stamp } : {}),
        });
      } else if (tollE.data()!.status === 'pending' && paid) {
        tx.update(ledgerRef(`toll_${bookingId}`), { status: 'available', finalizedAt: stamp });
      }
    }

    // Extra usage the office approved (waiting / hill / roof carrier): the partner's private amount is credited once, under a
    // deterministic id, and becomes available when the customer's payment — which includes the extras — is verified.
    const extraPaise = approvedPartnerExtraPaise(b, privatePricing);
    if (extraPaise > 0) {
      if (!extraE.exists) {
        tx.set(ledgerRef(`extra_${bookingId}`), {
          ...common, type: 'extra_charge', direction: 'credit', netAmount: extraPaise / 100, grossAmount: extraPaise / 100, commissionAmount: 0,
          status: paid ? 'available' : 'pending', source: 'extra_usage_approval', extraRevision: b.extraCharges?.revision ?? 0, createdAt: stamp, ...(paid ? { finalizedAt: stamp } : {}),
        });
      } else if (extraE.data()!.status === 'pending' && paid) {
        tx.update(ledgerRef(`extra_${bookingId}`), { status: 'available', finalizedAt: stamp });
      }
    }

    // Cash a partner collected stays with them, so they owe the platform that
    // amount. With payment transactions it is exactly the cash recorded against
    // the partner (an advance paid by UPI to the office is not theirs); older
    // bookings fall back to the whole fare when it was a cash booking.
    const txnBased = b.paymentSummary && typeof b.paymentSummary.transactions === 'number' && b.paymentSummary.transactions > 0;
    const cashHeld = txnBased ? money(b.paymentSummary.partnerCashHeld) : finance.paymentMethod === 'Cash' ? finance.fareTotal : 0;
    if (cashHeld > 0 && paid && !cashE.exists) {
      tx.set(ledgerRef(`cash_${bookingId}`), {
        ...common, type: 'cash_collected', direction: 'debit', netAmount: cashHeld, grossAmount: cashHeld,
        commissionAmount: 0, status: 'completed', source: 'payment_confirmation', createdAt: stamp, finalizedAt: stamp,
      });
    }
    return { type: finance.partnerType, id: finance.partnerId };
  });
  if (actor) await recomputeWallet(actor.type, actor.id);
  return actor;
}

/** Keeps the ledger debit of a payout request in step with its status. */
export async function syncPayoutLedger(requestId: string): Promise<void> {
  const entryRef = ledgerRef(`payout_${requestId}`);
  const actor = await db.runTransaction(async (tx) => {
    const [req, entry] = await Promise.all([tx.get(db.doc(`payout_requests/${requestId}`)), tx.get(entryRef)]);
    const stamp = FieldValue.serverTimestamp();
    if (!req.exists) {
      const e = entry.data();
      if (entry.exists && e?.status !== 'cancelled') tx.update(entryRef, { status: 'cancelled', finalizedAt: stamp });
      return e?.actorType && e?.actorId ? { type: e.actorType as PartnerType, id: e.actorId as string } : null;
    }
    const p = req.data()!;
    const type: PartnerType | null = p.driverId ? 'driver' : p.vendorId ? 'vendor' : null;
    if (!type) return null;
    const id = type === 'driver' ? p.driverId : p.vendorId;
    const status = payoutLedgerStatus(p.status);
    const final = status === 'completed' || status === 'cancelled' ? { finalizedAt: stamp } : {};
    if (!entry.exists) {
      const amount = money(p.amount);
      tx.set(entryRef, {
        schema: 2, ...ownerFields(type, id), type: 'payout', direction: 'debit', netAmount: amount, grossAmount: amount, commissionAmount: 0,
        status, bookingId: '', bookingCode: '', payoutRequestId: requestId, source: 'payout_request', createdAt: stamp, ...final,
      });
    } else if (entry.data()!.status !== status) {
      tx.update(entryRef, { status, ...final });
    }
    return { type, id };
  });
  if (actor) await recomputeWallet(actor.type, actor.id);
}

// ── Triggers ──────────────────────────────────────────────────────────────

const FINANCE_KEYS = ['status', 'payment', 'paymentStatus', 'paymentMethod', 'fareVerified', 'tollsApproved', 'tollCharges',
  'vendorPayout', 'driverPayout', 'assignedVendorId', 'assignedDriverId', 'finance', 'paymentSummary', 'extraCharges'];

export const onBookingFinanceChange = onDocumentUpdated('bookings/{bookingId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after) return;
  if (before && FINANCE_KEYS.every((k) => JSON.stringify(before[k] ?? null) === JSON.stringify(after[k] ?? null))) return;
  await syncBookingFinance(event.params.bookingId);
});

export const onPayoutRequestWritten = onDocumentWritten('payout_requests/{requestId}', async (event) => {
  await syncPayoutLedger(event.params.requestId);
});

// ── Payout requests ───────────────────────────────────────────────────────

export const requestPartnerPayout = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const input = request.data ?? {};
  if (!['driver', 'vendor'].includes(input.role)) throw new HttpsError('invalid-argument', 'Choose a partner role.');
  if (!Number.isSafeInteger(input.amount) || input.amount < 100 || input.amount > 10000000) throw new HttpsError('invalid-argument', 'Enter a valid payout amount of at least ₹100.');
  if (input.role === 'vendor' && input.amount < 500) throw new HttpsError('invalid-argument', 'Minimum fleet payout is ₹500.');
  if (!['UPI', 'Bank Transfer'].includes(input.method)) throw new HttpsError('invalid-argument', 'Invalid payout method.');
  const role: PartnerType = input.role;
  const key = `${role}Id`;
  const ref = db.doc(`payout_requests/${requestIdOf(input.requestId)}`);
  const lock = db.doc(`payout_locks/${role}_${uid}`);
  const result = await db.runTransaction(async (tx) => {
    const [profile, existing, , entries, privateDoc] = await Promise.all([
      tx.get(db.doc(`${role}s/${uid}`)), tx.get(ref), tx.get(lock),
      tx.get(db.collection('wallet_ledger').where('walletId', '==', walletId(role, uid))),
      tx.get(db.doc(`${role === 'driver' ? 'driver_private' : 'vendor_kyc'}/${uid}`)),
    ]);
    if (!profile.exists || !approved(profile.data()!.status)) throw new HttpsError('permission-denied', 'Partner account is not approved.');
    // A vendor's employee driver has no wallet or payout rights: the trip settles to the vendor only.
    if (role === 'driver' && profile.data()!.vendorId) throw new HttpsError('permission-denied', 'Fleet drivers do not manage wallet payouts. Your vendor receives the settlement.', { code: 'employee-denied' });
    if (existing.exists) {
      if (existing.data()![key] !== uid) throw new HttpsError('permission-denied', 'Request already used.');
      return { id: ref.id };
    }
    // The ledger is the only source of the withdrawable balance.
    const balance = walletTotals(entries.docs.map((d) => d.data())).available;
    const available = Math.max(0, Math.floor(balance));
    if (input.amount > available) {
      throw new HttpsError('failed-precondition', balance < 0
        ? `Cash fares you collected exceed your earnings by ₹${Math.ceil(-balance)}. Nothing is available to withdraw.`
        : `Available balance is ₹${available}. Earnings become available once the customer's payment is verified.`);
    }
    const destination = privateDoc.data();
    const bank = role === 'driver' ? destination?.bank : destination?.payout;
    if (!bank || (input.method === 'UPI' ? !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/.test(String(bank.upiId || '')) : !/^\d{8,20}$/.test(String(bank.accountNumber || '')) || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bank.ifsc || '')))) throw new HttpsError('failed-precondition', 'Save valid payout details in your profile first.');
    const details = input.method === 'UPI' ? text(bank.upiId) : `Account ending ${String(bank.accountNumber).slice(-4)} · ${text(bank.ifsc)}`;
    const stamp = FieldValue.serverTimestamp();
    tx.create(ref, { id: ref.id, [key]: uid, [`${role}Name`]: text(profile.data()!.companyName || profile.data()!.name), amount: input.amount,
      method: input.method, details, status: 'Pending', createdAt: stamp, requestedAt: new Date().toISOString() });
    // Reserve the amount in the same transaction as the request.
    tx.create(ledgerRef(`payout_${ref.id}`), {
      schema: 2, ...ownerFields(role, uid), type: 'payout', direction: 'debit', netAmount: input.amount, grossAmount: input.amount,
      commissionAmount: 0, status: 'reserved', bookingId: '', bookingCode: '', payoutRequestId: ref.id, source: 'payout_request', createdAt: stamp,
    });
    tx.set(lock, { updatedAt: stamp });
    return { id: ref.id };
  });
  await recomputeWallet(role, uid);
  return result;
});

// ── Controlled migration ──────────────────────────────────────────────────

/**
 * One-off, idempotent: builds finance snapshots and ledger entries for trips
 * completed before the ledger existed, using the payouts those trips actually
 * recorded (never today's commission), plus the debits of existing payout
 * requests. dryRun reports what would change without writing.
 */
export const rebuildPartnerLedger = onCall({ timeoutSeconds: 540 }, async (request) => {
  const actor = await requireSuperAdmin(request.auth);
  const dryRun = request.data?.dryRun !== false;
  const [completed, payouts, ledger] = await Promise.all([
    db.collection('bookings').where('status', '==', 'Completed').get(),
    db.collection('payout_requests').get(),
    db.collection('wallet_ledger').get(),
  ]);
  const canonical = new Set(ledger.docs.filter((d) => d.data().schema === 2).map((d) => d.id));
  const report = { dryRun, tripsToFinalize: 0, tripEntriesToCreate: 0, payoutEntriesToCreate: 0, skippedUnverified: [] as string[], missingPayout: [] as string[] };
  const bookingIds: string[] = [];
  for (const d of completed.docs) {
    const b = d.data();
    if (b.fareVerified !== true) {
      report.skippedUnverified.push(text(b.bookingId) || d.id);
      continue;
    }
    const snapshot = isSnapshot(b.finance) ? b.finance : buildFinanceSnapshot(b);
    if (!snapshot) continue;
    if (!isSnapshot(b.finance)) report.tripsToFinalize += 1;
    if (snapshot.partnerPayout === null) report.missingPayout.push(text(b.bookingId) || d.id);
    else if (!canonical.has(`trip_${d.id}`)) report.tripEntriesToCreate += 1;
    bookingIds.push(d.id);
  }
  const payoutIds = payouts.docs.filter((d) => !canonical.has(`payout_${d.id}`)).map((d) => d.id);
  report.payoutEntriesToCreate = payoutIds.length;
  if (!dryRun) {
    for (const id of bookingIds) await syncBookingFinance(id);
    for (const id of payoutIds) await syncPayoutLedger(id);
    await db.collection('admin_audit').add({
      action: 'ledger_rebuilt', targetId: 'wallet_ledger', actorId: actor.uid, actorName: actor.name,
      details: { ...report, skippedUnverified: report.skippedUnverified.length, missingPayout: report.missingPayout.length },
      at: FieldValue.serverTimestamp(),
    });
  }
  return report;
});
