// Fleet money as the server records it (functions/src/ledger.ts): the wallet
// read model (wallets/vendor_{uid}) and the partner ledger (wallet_ledger,
// schema 2). Mirrors vendor/web/src/services/vendorMappers.ts. The app never
// computes a payout, commission or balance of its own.
import type { LedgerRecord, VendorBooking, WalletDetails } from '../types/operations';
import { formatINR } from './format';

type Data = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export const EMPTY_WALLET: WalletDetails = {
  available: 0,
  pending: 0,
  reserved: 0,
  paidOut: 0,
  cashCollected: 0,
  tripEarnings: 0,
  tollReimbursements: 0,
};

/** wallets/vendor_{uid}; a partner with no ledger activity yet has an empty wallet. */
export function mapWallet(d: Data | undefined): WalletDetails {
  if (!d) return EMPTY_WALLET;
  return {
    available: num(d.available) ?? 0,
    pending: num(d.pending) ?? 0,
    reserved: num(d.reserved) ?? 0,
    paidOut: num(d.paidOut) ?? 0,
    cashCollected: num(d.cashCollected) ?? 0,
    tripEarnings: num(d.tripEarnings) ?? 0,
    tollReimbursements: num(d.tollReimbursements) ?? 0,
  };
}

/** Canonical ledger entries only (schema 2); older audit records are not balances. */
export function mapLedgerEntry(id: string, d: Data): LedgerRecord | null {
  if (d.schema !== 2) return null;
  return {
    id,
    type: str(d.type),
    direction: d.direction === 'debit' ? 'debit' : 'credit',
    amount: num(d.netAmount) ?? 0,
    status: str(d.status),
    bookingCode: str(d.bookingCode),
    createdAt: toDate(d.createdAt),
  };
}

const EARNING_TYPES = ['trip_earning', 'toll_reimbursement'];
export const isEarning = (e: LedgerRecord) => EARNING_TYPES.includes(e.type) && e.direction === 'credit' && e.status !== 'cancelled';

/** Earnings the server credited since the start of this month. */
export function monthEarnings(ledger: LedgerRecord[], now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return ledger.filter((e) => isEarning(e) && (e.createdAt?.getTime() ?? 0) >= start).reduce((s, e) => s + e.amount, 0);
}

/** The payout as recorded by NESAM — the finalized amount once finance has closed the trip, else the agreed one. Never an estimate. */
export function payoutText(b: Pick<VendorBooking, 'vendorPayout' | 'payoutRecorded' | 'payoutFinalized'>): string {
  if (!b.payoutRecorded) return 'Not recorded';
  return b.payoutFinalized ? `${formatINR(b.vendorPayout)} · finalized` : formatINR(b.vendorPayout);
}

/** Days until an ISO date (negative when expired); null when unknown. */
export function daysUntil(iso: string, now = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime();
  return Math.floor((end - now.getTime()) / 86400000);
}
