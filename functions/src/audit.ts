// One append-only audit trail for everything operational: bookings, fares,
// payments, refunds, assignments, penalties, trips, legal acceptance and
// security failures. Written only by the server (firestore.rules: no client
// writes); readable by staff with reports access.
import { FieldValue, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';

export type AuditRole = 'admin' | 'driver' | 'vendor' | 'customer' | 'system';

export interface AuditEntry {
  /** Verb in snake_case, e.g. booking_approved, driver_reassigned. */
  action: string;
  /** Collection-like noun: booking, payment, penalty, … */
  entity: string;
  entityId: string;
  performedBy: string;
  performedByName?: string;
  role: AuditRole;
  previous?: unknown;
  next?: unknown;
  reason?: string;
  /** Booking the entry belongs to, for the per-booking timeline. */
  bookingId?: string;
  meta?: Record<string, unknown>;
}

/** Firestore rejects `undefined`; drop it and cap very long strings. */
function clean(v: unknown, depth = 0): unknown {
  if (v === undefined) return null;
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.slice(0, 1000);
  if (depth > 4) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    if (typeof (v as { toDate?: unknown }).toDate === 'function' || (v as { _methodName?: unknown })._methodName) return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x, depth + 1)]));
  }
  return null;
}

function payload(e: AuditEntry) {
  return {
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    performedBy: e.performedBy,
    performedByName: e.performedByName ?? '',
    role: e.role,
    previous: clean(e.previous ?? null),
    next: clean(e.next ?? null),
    reason: (e.reason ?? '').slice(0, 500),
    bookingId: e.bookingId ?? (e.entity === 'booking' ? e.entityId : ''),
    meta: clean(e.meta ?? {}),
    at: FieldValue.serverTimestamp(),
  };
}

/** Inside a transaction, so the entry exists if and only if the change does. */
export function auditInTx(tx: Transaction, e: AuditEntry): void {
  tx.create(db.collection('audit_logs').doc(), payload(e));
}

/** Outside a transaction (security events, failures, scheduled jobs). */
export async function audit(e: AuditEntry): Promise<void> {
  await db.collection('audit_logs').add(payload(e));
}
