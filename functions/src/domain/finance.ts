// Platform finance: the commission policy, the partner payout it implies, the
// per-trip financial snapshot and the partner ledger / wallet arithmetic.
// Pure functions only — the single source of truth for every web app, which
// read the results the server stores (never recompute them).
import { FareBreakdown } from './types';

// ── Commission policy ─────────────────────────────────────────────────────

/** Whether the commission is taken from the fare excluding GST or the GST-inclusive total. */
export type CommissionBase = 'taxable' | 'total';

export interface CommissionRule {
  /** Platform commission, percent of the base (0–100). */
  rate: number;
}

/** business_config/commission — written only by saveCommissionPolicy. */
export interface CommissionPolicy {
  base: CommissionBase;
  global: CommissionRule | null;
  /** By service record id (admin services master). */
  services: Record<string, CommissionRule>;
  /** By vehicle category id. */
  categories: Record<string, CommissionRule>;
  version: number;
}

export interface ResolvedCommission {
  rate: number;
  base: CommissionBase;
  /** 'service:{id}' | 'category:{id}' | 'global' */
  source: string;
  policyVersion: number;
}

export const COMMISSION_NOT_CONFIGURED =
  'Booking is unavailable: the platform commission policy is not configured. A finance admin must set it first.';

const validRate = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

function ruleOf(v: unknown): CommissionRule | null {
  return v && typeof v === 'object' && validRate((v as { rate?: unknown }).rate) ? { rate: (v as { rate: number }).rate } : null;
}

function rulesOf(v: unknown): Record<string, CommissionRule> {
  const out: Record<string, CommissionRule> = {};
  if (v && typeof v === 'object') {
    for (const [k, r] of Object.entries(v as Record<string, unknown>)) {
      const rule = ruleOf(r);
      if (k && rule) out[k] = rule;
    }
  }
  return out;
}

/** A stored policy, or null when none exists / it is malformed (treated as not configured). */
export function parseCommissionPolicy(d: Record<string, unknown> | undefined | null): CommissionPolicy | null {
  if (!d || (d.base !== 'taxable' && d.base !== 'total')) return null;
  return {
    base: d.base,
    global: ruleOf(d.global),
    services: rulesOf(d.services),
    categories: rulesOf(d.categories),
    version: typeof d.version === 'number' ? d.version : 0,
  };
}

/** Most specific configured rule: service → vehicle category → global. null = not configured. */
export function resolveCommission(
  policy: CommissionPolicy | null,
  scope: { serviceId?: string; categoryId?: string },
): ResolvedCommission | null {
  if (!policy) return null;
  const pick = (rule: CommissionRule | null | undefined, source: string) =>
    rule ? { rate: rule.rate, base: policy.base, source, policyVersion: policy.version } : null;
  return (
    (scope.serviceId ? pick(policy.services[scope.serviceId], `service:${scope.serviceId}`) : null) ??
    (scope.categoryId ? pick(policy.categories[scope.categoryId], `category:${scope.categoryId}`) : null) ??
    pick(policy.global, 'global')
  );
}

/** The partner payout offered for a fare under a resolved commission. */
export function partnerPayoutFor(fare: Pick<FareBreakdown, 'taxableAmount' | 'total'>, c: Pick<ResolvedCommission, 'rate' | 'base'>): number {
  const base = c.base === 'taxable' ? fare.taxableAmount : fare.total;
  return Math.max(0, Math.round((base * (100 - c.rate)) / 100));
}

/** Validates an admin-submitted policy. Returns field errors (empty = valid). */
export function validateCommissionPolicy(input: {
  base?: unknown;
  global?: unknown;
  services?: unknown;
  categories?: unknown;
}): string[] {
  const errors: string[] = [];
  if (input.base !== 'taxable' && input.base !== 'total') errors.push('Choose whether commission is taken on the fare excluding GST or including GST.');
  if (input.global != null && !ruleOf(input.global)) errors.push('The global rate must be a percentage from 0 to 100.');
  for (const [label, map] of [['service', input.services], ['category', input.categories]] as const) {
    if (map == null) continue;
    if (typeof map !== 'object' || Array.isArray(map)) {
      errors.push(`Invalid ${label} rules.`);
      continue;
    }
    for (const [k, r] of Object.entries(map as Record<string, unknown>)) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(k)) errors.push(`Invalid ${label} id "${k}".`);
      else if (!ruleOf(r)) errors.push(`The ${label} rate for "${k}" must be a percentage from 0 to 100.`);
    }
  }
  return errors;
}

// ── Per-trip financial snapshot ───────────────────────────────────────────

export type PartnerType = 'vendor' | 'driver';

/**
 * bookings/{id}.finance — written once by the server when a completed,
 * fare-verified trip is finalized. Never recalculated from today's policy.
 */
export interface FinanceSnapshot {
  schema: 1;
  fareTotal: number;
  taxableAmount: number;
  gst: number;
  discount: number;
  partnerType: PartnerType;
  partnerId: string;
  /** Agreed entitlement (excludes toll reimbursements); null when no payout was recorded. */
  partnerPayout: number | null;
  /** 'offered' (policy), 'bid' (awarded counter-bid) or 'manual' (finance-set). */
  payoutSource: string;
  commissionRate: number | null;
  commissionBase: CommissionBase | null;
  /** Where the rate came from, or 'legacy' for trips published before the policy existed. */
  commissionSource: string;
  /** Platform revenue excluding GST: fare excluding GST minus the partner payout. */
  platformRevenue: number | null;
  tollCharges: number;
  tollTreatment: 'reimbursed_on_approval';
  paymentMethod: string;
  /** Problems finance must resolve (e.g. missing payout, negative revenue). */
  warnings: string[];
}

const money = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Partner a completed trip pays: the vendor for fleet trips, otherwise the independent driver. */
export function partnerOf(b: Record<string, any>): { type: PartnerType; id: string } | null {
  if (typeof b.assignedVendorId === 'string' && b.assignedVendorId) return { type: 'vendor', id: b.assignedVendorId };
  if (typeof b.assignedDriverId === 'string' && b.assignedDriverId) return { type: 'driver', id: b.assignedDriverId };
  return null;
}

export function buildFinanceSnapshot(b: Record<string, any>): FinanceSnapshot | null {
  const partner = partnerOf(b);
  if (!partner) return null;
  const fb = b.fareBreakdown && typeof b.fareBreakdown === 'object' ? b.fareBreakdown : null;
  const fareTotal = money(b.fare);
  const gst = fb && Number.isFinite(fb.gst) ? fb.gst : Math.round((fareTotal - fareTotal / 1.05) * 100) / 100;
  const taxableAmount = Math.round((fareTotal - gst) * 100) / 100;
  const rawPayout = partner.type === 'vendor' ? b.vendorPayout : b.driverPayout;
  const partnerPayout = typeof rawPayout === 'number' && Number.isFinite(rawPayout) && rawPayout >= 0 ? rawPayout : null;
  const c = b.commission && typeof b.commission === 'object' ? b.commission : null;
  const warnings: string[] = [];
  if (partnerPayout === null) warnings.push('No partner payout was recorded for this trip.');
  const platformRevenue = partnerPayout === null ? null : Math.round((taxableAmount - partnerPayout) * 100) / 100;
  if (platformRevenue !== null && platformRevenue < 0) warnings.push('The partner payout exceeds the fare excluding GST.');
  return {
    schema: 1,
    fareTotal,
    taxableAmount,
    gst,
    discount: fb && Number.isFinite(fb.discount) ? fb.discount : money(b.discount),
    partnerType: partner.type,
    partnerId: partner.id,
    partnerPayout,
    payoutSource: typeof b.payoutSource === 'string' && b.payoutSource ? b.payoutSource : 'offered',
    commissionRate: c && validRate(c.rate) ? c.rate : null,
    commissionBase: c && (c.base === 'taxable' || c.base === 'total') ? c.base : null,
    commissionSource: c && typeof c.source === 'string' ? c.source : 'legacy',
    platformRevenue,
    tollCharges: Math.max(0, money(b.tollCharges)),
    tollTreatment: 'reimbursed_on_approval',
    paymentMethod: typeof b.paymentMethod === 'string' ? b.paymentMethod : '',
    warnings,
  };
}

// ── Ledger and wallet ─────────────────────────────────────────────────────

export type LedgerType = 'trip_earning' | 'toll_reimbursement' | 'cash_collected' | 'payout' | 'penalty_deduction' | 'wallet_recharge' | 'due_payment' | 'due_payment_held' | 'extra_charge';
/** `held`: money received and kept for finance review — counted in no balance (see due_payment_held). */
export type LedgerStatus = 'pending' | 'available' | 'reserved' | 'completed' | 'cancelled' | 'held';

/** wallet_ledger/{id} — server-written only; ids are deterministic per event. */
export interface LedgerEntry {
  schema: 2;
  actorType: PartnerType;
  actorId: string;
  type: LedgerType;
  direction: 'credit' | 'debit';
  /** Positive amount; direction gives the sign. */
  netAmount: number;
  grossAmount: number;
  commissionAmount: number;
  status: LedgerStatus;
  bookingId: string;
  payoutRequestId: string;
  source: string;
}

export interface WalletTotals {
  /** Withdrawable now: available credits minus reserved and completed debits. */
  available: number;
  /** Earned, waiting for the customer's payment to be verified. */
  pending: number;
  /** Payout requests not yet paid or rejected. */
  reserved: number;
  paidOut: number;
  /** Fares collected in cash by the partner (owed to the platform, net of payouts). */
  cashCollected: number;
  tripEarnings: number;
  tollReimbursements: number;
  entries: number;
}

const isCanonical = (e: Partial<LedgerEntry>) => e.schema === 2 && typeof e.netAmount === 'number' && Number.isFinite(e.netAmount);

export function walletTotals(entries: Partial<LedgerEntry>[]): WalletTotals {
  const t: WalletTotals = { available: 0, pending: 0, reserved: 0, paidOut: 0, cashCollected: 0, tripEarnings: 0, tollReimbursements: 0, entries: 0 };
  for (const e of entries) {
    if (!isCanonical(e) || e.status === 'cancelled') continue;
    const amount = e.netAmount!;
    t.entries += 1;
    if (e.direction === 'credit') {
      if (e.status === 'available') t.available += amount;
      else if (e.status === 'pending') t.pending += amount;
      if (e.type === 'trip_earning') t.tripEarnings += amount;
      if (e.type === 'toll_reimbursement') t.tollReimbursements += amount;
    } else if (e.direction === 'debit' && (e.status === 'reserved' || e.status === 'completed')) {
      t.available -= amount;
      if (e.type === 'payout') {
        if (e.status === 'reserved') t.reserved += amount;
        else t.paidOut += amount;
      }
      if (e.type === 'cash_collected') t.cashCollected += amount;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { ...t, available: r(t.available), pending: r(t.pending), reserved: r(t.reserved), paidOut: r(t.paidOut), cashCollected: r(t.cashCollected), tripEarnings: r(t.tripEarnings), tollReimbursements: r(t.tollReimbursements) };
}

/** Ledger status for a payout debit, from the payout request's status. */
export function payoutLedgerStatus(requestStatus: unknown): LedgerStatus {
  if (requestStatus === 'Paid') return 'completed';
  if (requestStatus === 'Rejected' || requestStatus === 'Cancelled') return 'cancelled';
  return 'reserved';
}
