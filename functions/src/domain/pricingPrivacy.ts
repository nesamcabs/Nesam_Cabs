// A booking's pricing snapshot is readable by its customer (Firestore rules cannot hide single fields of a readable
// document), so the PARTNER side of it — the normal partner rate block and the partner extra-charge rates — is never stored
// on the booking. It lives in booking_pricing_private/{bookingId}, written in the same transaction as the booking, linked to
// it by id and to the immutable pricing version by `tariffVersion`. Server code that needs the whole snapshot (payout at
// assignment or publish, final fare at Trip End, settlement) puts the two halves back together in memory with joinPricing.
import type { PartnerNormalRate, PricingSnapshot } from './tariff';
import type { ExtraChargeSidePaise } from './extraCharges';

export interface PrivatePricing {
  schema: 1;
  /** The tariff version the booking was quoted under (the partner rates are the ones in force then, never today's). */
  tariffVersion: number;
  partner: PartnerNormalRate | null;
  /** The partner side of the category's extra-charge rates when quoted. */
  extraPartner: ExtraChargeSidePaise | null;
}

/** Splits a full in-memory snapshot into what the booking stores (`pub`) and what goes to private storage (`priv`). */
export function splitPricing(p: PricingSnapshot): { pub: PricingSnapshot; priv: PrivatePricing | null } {
  const { extraCharges, partner, ...rest } = p;
  const extraPartner = extraCharges?.partner ?? null;
  let pubExtra: PricingSnapshot['extraCharges'];
  if (extraCharges) {
    const { partner: _partner, ...customerOnly } = extraCharges;
    pubExtra = customerOnly;
  }
  const pub = { ...rest, partner: null, ...(pubExtra ? { extraCharges: pubExtra } : {}) } as PricingSnapshot;
  const priv: PrivatePricing | null = partner || extraPartner
    ? { schema: 1, tariffVersion: p.tariffVersion, partner: partner ?? null, extraPartner }
    : null;
  return { pub, priv };
}

/**
 * The full snapshot again, in memory only. A booking written before the split still carries its partner block inline and
 * has no private record: it is returned as it is.
 */
export function joinPricing(pub: PricingSnapshot, priv: Pick<PrivatePricing, 'partner' | 'extraPartner'> | null | undefined): PricingSnapshot {
  if (!priv) return pub;
  return {
    ...pub,
    partner: priv.partner ?? pub.partner ?? null,
    ...(pub.extraCharges && priv.extraPartner ? { extraCharges: { ...pub.extraCharges, partner: priv.extraPartner } } : {}),
  };
}
