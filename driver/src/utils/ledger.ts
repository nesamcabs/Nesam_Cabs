// Copied from driver/web/src/services/driverEarnings.ts.
// Driver money as the server records it (functions/src/ledger.ts): the wallet
// read model and the partner ledger. Pure functions — the app never computes a
// payout or balance of its own.
import type { DriverEarningsSummary, DriverWallet, LedgerEntry } from '../types/driver';

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

export const EMPTY_WALLET: DriverWallet = {
  available: 0,
  pending: 0,
  reserved: 0,
  paidOut: 0,
  cashCollected: 0,
  tripEarnings: 0,
  tollReimbursements: 0,
};

/** wallets/driver_{uid}; no document yet means no ledger activity. */
export function mapWallet(d: Data | undefined): DriverWallet {
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

/** Canonical entries only (schema 2); older audit records are not balances. */
export function mapLedgerEntry(id: string, d: Data): LedgerEntry | null {
  if (d.schema !== 2) return null;
  return {
    id,
    type: str(d.type),
    direction: d.direction === 'debit' ? 'debit' : 'credit',
    amount: num(d.netAmount) ?? 0,
    status: str(d.status),
    bookingId: str(d.bookingId),
    bookingCode: str(d.bookingCode),
    createdAt: toDate(d.createdAt),
  };
}

const EARNING_TYPES = ['trip_earning', 'toll_reimbursement', 'extra_charge'];
export const isEarning = (e: LedgerEntry) => EARNING_TYPES.includes(e.type) && e.direction === 'credit' && e.status !== 'cancelled';

/** Earnings credited by the server, by the day they were recorded. */
export function summarizeEarnings(ledger: LedgerEntry[], now = new Date()): DriverEarningsSummary {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = today - 6 * 86400000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const s: DriverEarningsSummary = { todayEarnings: 0, thisWeekEarnings: 0, thisMonthEarnings: 0, lifetimeEarnings: 0, totalTripsCompleted: 0, tollReimbursements: 0 };
  for (const e of ledger) {
    if (!isEarning(e)) continue;
    const at = e.createdAt?.getTime() ?? 0;
    s.lifetimeEarnings += e.amount;
    if (e.type === 'toll_reimbursement') s.tollReimbursements += e.amount;
    else if (e.type === 'trip_earning') s.totalTripsCompleted += 1;
    if (at >= today) s.todayEarnings += e.amount;
    if (at >= weekAgo) s.thisWeekEarnings += e.amount;
    if (at >= monthStart) s.thisMonthEarnings += e.amount;
  }
  return s;
}

/** Status of a trip's earning in the ledger ("" = not credited yet). */
export const tripEarningStatus = (ledger: LedgerEntry[], bookingId: string) =>
  ledger.find((e) => e.type === 'trip_earning' && e.bookingId === bookingId)?.status ?? '';

/** Last 7 days (oldest first) of server-credited earnings, for the chart. */
export function last7Days(ledger: LedgerEntry[], now = new Date()): { label: string; key: string; amount: number }[] {
  const days: { label: string; key: string; amount: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), key: d.toDateString(), amount: 0 });
  }
  for (const e of ledger) {
    if (!isEarning(e) || !e.createdAt) continue;
    const slot = days.find((d) => d.key === e.createdAt!.toDateString());
    if (slot) slot.amount += e.amount;
  }
  return days;
}
