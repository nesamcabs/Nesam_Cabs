// Server access to booking_pricing_private/{bookingId}: the partner side of a booking's pricing snapshot (and, once the
// office approves extra usage, the partner's extra-charge amounts). Clients never read or write it: firestore.rules allow
// only staff holding the vendor-payout right to read it, and nothing to write it. See domain/pricingPrivacy.ts.
import { DocumentData, FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { PrivatePricing, joinPricing, splitPricing } from './domain/pricingPrivacy';
import type { PricingSnapshot } from './domain/tariff';

export const PRICING_PRIVATE = 'booking_pricing_private';
export const privatePricingRef = (bookingId: string) => db.doc(`${PRICING_PRIVATE}/${bookingId}`);

/**
 * For a booking being created: returns the snapshot the booking stores and, in the same transaction, creates the private
 * record that holds the rest — so the two can never exist apart.
 */
export function storePricingInTx(tx: Transaction, bookingId: string, customerId: string, full: PricingSnapshot): PricingSnapshot {
  const { pub, priv } = splitPricing(full);
  if (priv) tx.create(privatePricingRef(bookingId), { ...priv, bookingId, customerId, createdAt: FieldValue.serverTimestamp() });
  return pub;
}

/** Reads the private record inside a transaction (all reads must come before the transaction's first write). */
export async function loadPrivatePricing(tx: Transaction, bookingId: string): Promise<DocumentData | null> {
  const snap = await tx.get(privatePricingRef(bookingId));
  return snap.exists ? snap.data()! : null;
}

/**
 * The partner's approved extra-charge credit in paise (0 until the office approves usage). It counts only while the private
 * amounts belong to the same approved revision the booking shows, so a stale or half-written record is never posted.
 */
export function approvedPartnerExtraPaise(b: DocumentData, priv: DocumentData | null): number {
  const x = b.extraCharges as { status?: unknown; revision?: unknown } | undefined;
  const a = priv?.extraApproved as { revision?: unknown; partner?: { subtotalPaise?: unknown } } | undefined;
  if (!x || x.status !== 'approved' || !a || a.revision !== x.revision) return 0;
  const p = a.partner?.subtotalPaise;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? Math.round(p) : 0;
}

/** The booking with its whole pricing snapshot, for server calculations only — never written back or sent to a client. */
export function withPrivatePricing<T extends DocumentData>(b: T, priv: DocumentData | null): T {
  if (!priv || !b.pricing || typeof b.pricing !== 'object') return b;
  return { ...b, pricing: joinPricing(b.pricing as PricingSnapshot, { partner: priv.partner ?? null, extraPartner: priv.extraPartner ?? null }) };
}
