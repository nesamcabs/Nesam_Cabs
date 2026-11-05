// Public booking number: NTT-<year>-<6-digit sequence> (Tariff & Operations v2 p.20).
// One server-generated sequence per Indian calendar year, shared by app, web and call-centre
// bookings (the source is stored separately). The counter is read and advanced inside the
// booking's own transaction, so concurrent creates can never receive the same number and a
// cancelled or rejected booking's number is never reused. The booking's document id stays the
// immutable internal identifier.
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';

const yearInIndia = (d: Date): number => Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(d));

export const formatBookingCode = (year: number, n: number): string => `NTT-${year}-${String(n).padStart(6, '0')}`;

/** Must be called before the transaction's first write (Firestore requires reads first). */
export async function nextBookingCode(tx: Transaction, now: Date): Promise<string> {
  const year = yearInIndia(now);
  const ref = db.doc(`counters/bookings_${year}`);
  const snap = await tx.get(ref);
  const last = snap.exists && typeof snap.data()!.last === 'number' ? (snap.data()!.last as number) : 0;
  const next = last + 1;
  tx.set(ref, { year, last: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return formatBookingCode(year, next);
}
