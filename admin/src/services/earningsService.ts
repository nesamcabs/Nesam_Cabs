import { collection, doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { describeDataError } from "./adminFirestoreService";
import { toDate } from "./paymentService";
import type { Booking } from "../types";

/**
 * Partner money is decided by the server (functions/src/ledger.ts):
 *  • a completed, fare-verified trip gets an immutable `finance` snapshot and
 *    credits its partner — the vendor for fleet trips, otherwise the
 *    independent driver — in wallet_ledger;
 *  • wallets/{role}_{id} holds the balances derived from that ledger.
 * This module only reads and sums those records; it never computes a payout,
 * commission or balance itself.
 */
export type PartnerRole = "driver" | "vendor";

export class PayoutActionError extends Error {}

export interface PayoutRequest {
  id: string;
  driverId?: string;
  vendorId?: string;
  driverName?: string;
  vendorName?: string;
  amount: number | string;
  method?: string;
  details?: string;
  status?: string;
  requestedAt?: string;
  createdAt?: unknown;
  processedAt?: string;
  utr?: string;
  adminNote?: string;
}

export interface LedgerEntry {
  id: string;
  actorType: PartnerRole;
  actorId: string;
  walletId: string;
  type: "trip_earning" | "toll_reimbursement" | "cash_collected" | "payout" | string;
  direction: "credit" | "debit";
  netAmount: number;
  grossAmount: number;
  commissionAmount: number;
  status: "pending" | "available" | "reserved" | "completed" | "cancelled" | string;
  bookingId: string;
  bookingCode: string;
  payoutRequestId: string;
  createdAt: Date | null;
}

export interface Wallet {
  id: string;
  available: number;
  pending: number;
  reserved: number;
  paidOut: number;
  cashCollected: number;
  tripEarnings: number;
  tollReimbursements: number;
  updatedAt: Date | null;
}

export const RELEASED_PAYOUT_STATES = ["Rejected", "Cancelled"];
export const OPEN_PAYOUT_STATES = ["Pending", "Deferred"];

export const walletKey = (role: PartnerRole, id: string) => `${role}_${id}`;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

function mapEntry(id: string, d: Record<string, unknown>): LedgerEntry | null {
  // Only canonical (schema 2) entries count; older audit records are ignored.
  if (d.schema !== 2) return null;
  return {
    id,
    actorType: d.actorType === "vendor" ? "vendor" : "driver",
    actorId: str(d.actorId),
    walletId: str(d.walletId),
    type: str(d.type),
    direction: d.direction === "debit" ? "debit" : "credit",
    netAmount: num(d.netAmount),
    grossAmount: num(d.grossAmount),
    commissionAmount: num(d.commissionAmount),
    status: str(d.status),
    bookingId: str(d.bookingId),
    bookingCode: str(d.bookingCode),
    payoutRequestId: str(d.payoutRequestId),
    createdAt: toDate(d.createdAt),
  };
}

function mapWallet(id: string, d: Record<string, unknown>): Wallet {
  return {
    id,
    available: num(d.available),
    pending: num(d.pending),
    reserved: num(d.reserved),
    paidOut: num(d.paidOut),
    cashCollected: num(d.cashCollected),
    tripEarnings: num(d.tripEarnings),
    tollReimbursements: num(d.tollReimbursements),
    updatedAt: toDate(d.updatedAt),
  };
}

export function subscribeLedger(cb: (entries: LedgerEntry[]) => void, onError: (message: string) => void) {
  return onSnapshot(
    collection(db, "wallet_ledger"),
    (snap) => cb(snap.docs.map((d) => mapEntry(d.id, d.data())).filter((e): e is LedgerEntry => e !== null)),
    (err) => onError(describeDataError(err)),
  );
}

export function subscribeWallets(cb: (wallets: Map<string, Wallet>) => void, onError: (message: string) => void) {
  return onSnapshot(
    collection(db, "wallets"),
    (snap) => cb(new Map(snap.docs.map((d) => [d.id, mapWallet(d.id, d.data())]))),
    (err) => onError(describeDataError(err)),
  );
}

/** The partner a finalized trip pays, from its server snapshot (null = not finalized yet). */
export function tripPartner(b: Booking): { role: PartnerRole; id: string } | null {
  const f = b.finance;
  return f && (f.partnerType === "vendor" || f.partnerType === "driver") && f.partnerId ? { role: f.partnerType, id: f.partnerId } : null;
}

/** Agreed partner payout of a finalized trip (null when not finalized or not recorded). */
export const tripPayout = (b: Booking): number | null => (b.finance && typeof b.finance.partnerPayout === "number" ? b.finance.partnerPayout : null);

export const tripDate = (b: Booking): Date | null =>
  toDate(b.completedAt) ?? toDate(b.createdAt) ?? (b.date ? toDate(b.date) : null);

export interface DateRange {
  from: Date | null;
  to: Date | null;
}

export const inRange = (d: Date | null, r: DateRange) =>
  (!r.from && !r.to) || (d !== null && (!r.from || d >= r.from) && (!r.to || d <= r.to));

export interface PartnerSummary {
  /** Completed trips the partner drove or held in the period. */
  completedTrips: number;
  /** Trips credited to this partner in the period. */
  earningTrips: number;
  grossFares: number;
  earnings: number;
  tolls: number;
  /** Platform revenue excluding GST on this partner's credited trips. */
  platformShare: number;
  cashTrips: number;
  cashCollected: number;
  /** Completed trips whose finance is not finalized yet (fare not verified). */
  awaitingFinance: number;
  /** Balances (all time) from the server wallet. */
  available: number;
  pending: number;
  reserved: number;
  paidOut: number;
}

export function summarizePartner(
  role: PartnerRole,
  partnerId: string,
  bookings: Booking[],
  ledger: LedgerEntry[],
  wallet: Wallet | undefined,
  range: DateRange = { from: null, to: null },
): PartnerSummary {
  const key = walletKey(role, partnerId);
  const assignedKey = role === "driver" ? "assignedDriverId" : "assignedVendorId";
  const s: PartnerSummary = {
    completedTrips: 0,
    earningTrips: 0,
    grossFares: 0,
    earnings: 0,
    tolls: 0,
    platformShare: 0,
    cashTrips: 0,
    cashCollected: 0,
    awaitingFinance: 0,
    available: wallet?.available ?? 0,
    pending: wallet?.pending ?? 0,
    reserved: wallet?.reserved ?? 0,
    paidOut: wallet?.paidOut ?? 0,
  };
  for (const b of bookings) {
    if (b[assignedKey] !== partnerId || b.status !== "Completed" || !inRange(tripDate(b), range)) continue;
    s.completedTrips += 1;
    const partner = tripPartner(b);
    if (!partner && (role === "vendor" || !b.assignedVendorId)) s.awaitingFinance += 1;
  }
  for (const e of ledger) {
    if (e.walletId !== key || e.status === "cancelled" || !inRange(e.createdAt, range)) continue;
    if (e.type === "trip_earning") {
      s.earningTrips += 1;
      s.earnings += e.netAmount;
      s.grossFares += e.grossAmount;
      s.platformShare += e.commissionAmount;
    } else if (e.type === "toll_reimbursement") {
      s.tolls += e.netAmount;
    } else if (e.type === "cash_collected") {
      s.cashTrips += 1;
      s.cashCollected += e.netAmount;
    }
  }
  return s;
}

/** Ledger status of a trip's earning, e.g. "pending" until the customer's payment is verified. */
export function tripEarningStatus(ledger: LedgerEntry[], bookingId: string): string {
  return ledger.find((e) => e.type === "trip_earning" && e.bookingId === bookingId)?.status ?? "";
}

export interface MonthRow {
  label: string;
  sort: number;
  trips: number;
  gross: number;
  earnings: number;
  paid: number;
}

/** Credits by month (trip earnings incl. tolls) and payouts paid, for one partner role. */
export function monthlyFromLedger(role: PartnerRole, ledger: LedgerEntry[], payouts: PayoutRequest[]): MonthRow[] {
  const m = new Map<string, MonthRow>();
  const slot = (d: Date) => {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (!m.has(key)) m.set(key, { label: d.toLocaleString("en-IN", { month: "short", year: "numeric" }), sort: d.getFullYear() * 12 + d.getMonth(), trips: 0, gross: 0, earnings: 0, paid: 0 });
    return m.get(key)!;
  };
  for (const e of ledger) {
    if (e.actorType !== role || e.status === "cancelled" || !e.createdAt) continue;
    if (e.type === "trip_earning") {
      const row = slot(e.createdAt);
      row.trips += 1;
      row.gross += e.grossAmount;
      row.earnings += e.netAmount;
    } else if (e.type === "toll_reimbursement") {
      slot(e.createdAt).earnings += e.netAmount;
    }
  }
  const idKey = role === "driver" ? "driverId" : "vendorId";
  for (const p of payouts) {
    if (!p[idKey] || p.status !== "Paid") continue;
    const d = p.processedAt ? new Date(p.processedAt) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    slot(d).paid += Number(p.amount) || 0;
  }
  return [...m.values()].sort((a, b) => b.sort - a.sort);
}

export const payoutRole = (p: PayoutRequest): PartnerRole | null =>
  p.driverId ? "driver" : p.vendorId ? "vendor" : null;

export const payoutRequestedAt = (p: PayoutRequest) => toDate(p.createdAt) ?? toDate(p.requestedAt);

async function updatePayout(
  p: PayoutRequest,
  allowedFrom: string[],
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "payout_requests", p.id);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new PayoutActionError("This payout request no longer exists.");
      const status = String(snap.data().status || "Pending");
      if (!allowedFrom.includes(status)) throw new PayoutActionError(`This request is already ${status}.`);
      tx.update(ref, { ...data, updatedAt: serverTimestamp() });
    });
  } catch (err) {
    if (err instanceof PayoutActionError) throw err;
    throw new PayoutActionError(describeDataError(err));
  }
}

/**
 * Records that the money was transferred outside the platform (bank/UPI).
 * The transfer reference is shown to the partner in their app; the server
 * completes the matching ledger debit.
 */
export function markPayoutPaid(p: PayoutRequest, utr: string, actorId: string) {
  const ref = utr.trim();
  if (ref.length < 4) return Promise.reject(new PayoutActionError("Enter the bank / UPI transfer reference (UTR)."));
  return updatePayout(p, OPEN_PAYOUT_STATES, {
    status: "Paid",
    utr: ref.slice(0, 60),
    processedAt: new Date().toISOString(),
    processedBy: actorId,
  });
}

/** Rejecting releases the reserved amount back to the partner's balance (server-side). */
export function rejectPayout(p: PayoutRequest, reason: string, actorId: string) {
  if (!reason.trim()) return Promise.reject(new PayoutActionError("Enter the reason so the partner knows why."));
  return updatePayout(p, OPEN_PAYOUT_STATES, {
    status: "Rejected",
    adminNote: reason.trim().slice(0, 300),
    processedAt: new Date().toISOString(),
    processedBy: actorId,
  });
}

export function deferPayout(p: PayoutRequest, note: string, actorId: string) {
  if (!note.trim()) return Promise.reject(new PayoutActionError("Enter a note explaining the delay."));
  return updatePayout(p, ["Pending"], {
    status: "Deferred",
    adminNote: note.trim().slice(0, 300),
    processedBy: actorId,
  });
}
