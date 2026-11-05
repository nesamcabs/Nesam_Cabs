// Server-side eligibility checks used by EVERY path that gives a duty to a partner:
// marketplace claim, bid award, admin direct assignment, vendor dispatch, reassignment.
// One implementation means a client that skips its own validation, or a path added later,
// cannot reach an assignment the others would refuse.
import { HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import {
  DutyClass, ScheduleConfig, dutyClassOf, expiryMs, scheduleConfigOf, scheduleVerdict, tripWindowOf, vehicleServesDuty,
} from './domain/eligibility';
import { formatDateTime12, pickupInstant } from './domain/time';
import { text } from './shared';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);
const label = (b: DocumentData, id: string) => text(b.bookingId) || id;

export async function loadScheduleConfig(tx: Transaction): Promise<ScheduleConfig> {
  const s = await tx.get(db.doc('settings/operations'));
  return scheduleConfigOf(s.data());
}

/** Duty class stored on the booking, or derived from its category name and seats for older bookings. */
export function bookingDutyClass(b: DocumentData): DutyClass | null {
  return dutyClassOf({ dutyClass: b.dutyClass, name: b.vehicleCategory || b.vehicle, seats: b.passengerSeatsRequired });
}

/** Vehicle must match the booked duty class and seats and keep every required document valid through the trip. */
export function assertVehicleEligible(v: DocumentData, vehicleId: string, b: DocumentData, cfg: ScheduleConfig) {
  const name = text(v.vehicleNumber) || 'The vehicle';
  const verdict = vehicleServesDuty(
    { vehicleClass: v.vehicleClass, category: v.category, make: v.make, model: v.model, name: v.name, seatingCapacity: v.seatingCapacity ?? v.seats },
    { dutyClass: bookingDutyClass(b), passengerSeatsRequired: b.passengerSeatsRequired },
  );
  if (!verdict.ok) throw new HttpsError('failed-precondition', `${name}: ${verdict.reason}`, { code: 'vehicle-not-eligible', vehicleId });
  const window = tripWindowOf(b, pickupInstant(b)?.getTime() ?? null, cfg);
  if (window) {
    for (const [field, what] of [['insuranceExpiry', 'insurance'], ['fitnessExpiry', 'fitness certificate'], ['permitExpiry', 'permit'], ['pucExpiry', 'PUC certificate'], ['rcExpiry', 'registration']] as const) {
      const at = expiryMs(v[field]);
      if (at !== null && at < window.end) {
        throw new HttpsError('failed-precondition', `${name}: the ${what} expires before this trip ends (${formatDateTime12(new Date(window.end))}). Renew it first.`, { code: 'document-expires', vehicleId, field });
      }
    }
  }
  return verdict;
}

/** The driver's licence must stay valid through the trip; suspended or unapproved drivers never qualify. */
export function assertDriverEligible(d: DocumentData, b: DocumentData, cfg: ScheduleConfig) {
  const name = text(d.name) || 'This driver';
  if (d.fleetStatus === 'Suspended') throw new HttpsError('failed-precondition', `${name} is suspended.`, { code: 'driver-suspended' });
  const window = tripWindowOf(b, pickupInstant(b)?.getTime() ?? null, cfg);
  const licence = expiryMs(d.licenseExpiry);
  if (window && licence !== null && licence < window.end) {
    throw new HttpsError('failed-precondition', `${name}'s licence expires before this trip ends (${formatDateTime12(new Date(window.end))}).`, { code: 'licence-expires' });
  }
}

/** Open (assigned / running) duties of one driver or vehicle, read inside the caller's transaction. */
export async function loadHeldDuties(tx: Transaction, field: 'assignedDriverId' | 'assignedVehicleId', id: string) {
  if (!id) return [] as FirebaseFirestore.QueryDocumentSnapshot[];
  const snap = await tx.get(db.collection('bookings').where(field, '==', id).where('status', 'in', ['Assigned', 'Ongoing']));
  return snap.docs;
}

/**
 * Refuses an assignment that cannot be served in time. The resource may keep a running or
 * earlier trip as long as it is expected to finish, reposition and settle a buffer before
 * the candidate pickup; the reverse holds for a later duty. Applied separately to the driver
 * and to the vehicle, so a vendor reusing a busy car with a different driver is caught too.
 */
export function assertScheduleFree(
  held: FirebaseFirestore.QueryDocumentSnapshot[],
  who: string,
  candidate: DocumentData,
  candidateId: string,
  cfg: ScheduleConfig,
  allowOverride = false,
) {
  const at = pickupInstant(candidate);
  const mine = tripWindowOf(candidate, at?.getTime() ?? null, cfg);
  for (const other of held) {
    if (other.id === candidateId) continue;
    const o = other.data();
    const otherAt = pickupInstant(o);
    const theirs = tripWindowOf(o, otherAt?.getTime() ?? null, cfg);
    // Without a pickup time on either side, a trip that is already running still blocks.
    if (!mine || !theirs) {
      if (o.status === 'Ongoing' && !allowOverride) throw new HttpsError('failed-precondition', `${who} is already on trip ${label(o, other.id)}.`, { conflict: true, bookingId: other.id });
      continue;
    }
    const verdict = scheduleVerdict(mine, theirs, cfg);
    if (!verdict.ok && !allowOverride) {
      const when = otherAt ? ` at ${formatDateTime12(otherAt)}` : '';
      const ready = verdict.kind === 'before' && verdict.readyAt ? ` Earliest available: ${formatDateTime12(new Date(verdict.readyAt))}.` : '';
      throw new HttpsError('failed-precondition', `${who} already has trip ${label(o, other.id)}${when}.${ready}`, { conflict: true, bookingId: other.id, readyAt: verdict.readyAt });
    }
  }
}

export const seatsRequired = (b: DocumentData): number => Math.round(num(b.passengerSeatsRequired));
