// Driver-side duty cancellation requests and assignment acknowledgement (functions/src/partnerOps.ts).
// The server quotes and records the charge; the duty stays assigned until the NESAM office decides.
import { collection, doc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { callFunction } from './callables';
import { settleBooking } from './backend';

export interface CancellationPolicy { lastMinuteHours: number; lastMinuteCharge: number; graceHours: number; afterGraceCharge: number }
export const DEFAULT_POLICY: CancellationPolicy = { lastMinuteHours: 4, lastMinuteCharge: 1000, graceHours: 4, afterGraceCharge: 500 };

export interface DriverCancellation {
  id: string;
  bookingId: string;
  bookingCode: string;
  route: string;
  status: 'Pending' | 'Approved' | 'Declined';
  reason: string;
  reasonLabel: string;
  details: string;
  quotedPenalty: number;
  finalPenalty: number | null;
  ruleLabel: string;
  adminReason: string;
  requestedAt: Date | null;
  decidedAt: Date | null;
  pickupAt: Date | null;
}

export const REASONS: [string, string][] = [['vehicle', 'Vehicle breakdown'], ['health', 'Health issue'], ['emergency', 'Personal emergency'], ['other', 'Other reason']];

const date = (v: unknown): Date | null => (v && typeof (v as Timestamp).toDate === 'function' ? (v as Timestamp).toDate() : null);
const s = (v: unknown) => (typeof v === 'string' ? v : '');
const hours = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 72 ? v : d);
const rupees = (v: unknown, d: number) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : d);

export function subscribeToCancellationPolicy(cb: (p: CancellationPolicy) => void) {
  return onSnapshot(doc(db, 'settings', 'operations'), (snap) => {
    const c = (snap.data()?.partnerCancellation ?? {}) as Record<string, unknown>;
    cb({ lastMinuteHours: hours(c.lastMinuteHours, 4), lastMinuteCharge: rupees(c.lastMinuteCharge, 1000), graceHours: hours(c.graceHours, 4), afterGraceCharge: rupees(c.afterGraceCharge, 500) });
  }, () => cb(DEFAULT_POLICY));
}

export function subscribeToDriverCancellations(driverId: string, cb: (r: DriverCancellation[]) => void) {
  return onSnapshot(query(collection(db, 'partner_requests'), where('driverId', '==', driverId)), (snap) => cb(snap.docs
    .map((d) => d.data())
    .filter((x) => x.type === 'cancellation')
    .map((x) => ({
      id: s(x.id), bookingId: s(x.bookingId), bookingCode: s(x.bookingCode), route: s(x.route),
      status: (x.status === 'Approved' || x.status === 'Declined' ? x.status : 'Pending') as DriverCancellation['status'],
      reason: s(x.reason), reasonLabel: s(x.reasonLabel), details: s(x.details), quotedPenalty: typeof x.quotedPenalty === 'number' ? x.quotedPenalty : 0,
      finalPenalty: typeof x.finalPenalty === 'number' ? x.finalPenalty : null, ruleLabel: s(x.ruleLabel), adminReason: s(x.adminReason),
      requestedAt: date(x.requestedAt), decidedAt: date(x.decidedAt), pickupAt: date(x.pickupAt),
    }))
    .sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0))), () => cb([]));
}

/** Same rule as the server: the last-minute charge takes priority over the acceptance grace period. */
export function quote(pickupAt: Date | null, acceptedAt: Date | null, p: CancellationPolicy, now = Date.now()): { amount: number; rule: string } | null {
  if (!pickupAt) return null;
  const h = 3600000;
  const accepted = Math.min(acceptedAt?.getTime() ?? now, now);
  if (now >= pickupAt.getTime() - p.lastMinuteHours * h) return { amount: p.lastMinuteCharge, rule: `Within ${p.lastMinuteHours} hours of pickup` };
  if (now <= accepted + p.graceHours * h) return { amount: 0, rule: `Within ${p.graceHours} hours of accepting` };
  return { amount: p.afterGraceCharge, rule: `More than ${p.graceHours} hours after accepting` };
}

export async function requestDutyCancellation(bookingId: string, reason: string, details: string, quotedPenalty: number) {
  await callFunction('requestDutyCancellation', { bookingId, reason, details: details.trim(), quotedPenalty }, 30000);
  settleBooking(bookingId);
}

/** Fire-and-forget: the vendor sees "Viewed" / "Acknowledged" on the duty. */
export function acknowledgeAssignment(bookingId: string, step: 'viewed' | 'acknowledged') {
  void callFunction('acknowledgeAssignment', { bookingId, step }, 15000).catch(() => undefined);
}
