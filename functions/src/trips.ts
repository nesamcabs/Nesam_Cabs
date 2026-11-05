import { gstComponents } from './domain/gst';
// Driver trip workflow, validated on the server:
//   Reached Pickup Location  →  Trip Started  →  Trip Ended
// Only the next step is accepted, every step is stamped and (with permission)
// geo-tagged, a repeated tap is a no-op, and an attempt to skip a step is
// refused and logged as a security event. At the pickup the driver verifies
// the customer's boarding OTP (verifyBoarding); Trip Started also needs the
// trip's vehicle photo verification. Clients cannot write status or stage
// fields directly (firestore.rules).
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { timingSafeEqual } from 'crypto';
import { db } from './admin';
import { auditInTx } from './audit';
import { LEGACY_STAGE_FOR, TRIP_SUB_STATUSES, TripSubStatus, tripStageBlocker, tripSubStatusOf } from './domain/bookingFlow';
import { finalizeFare, finalizeLegacyFare, PricingSnapshot } from './domain/tariff';
import { assertDriverEligible, assertVehicleEligible, loadScheduleConfig } from './eligibility';
import { formatDateTime12, pickupInstant } from './domain/time';
import { notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { assertDeviceTrusted, logSecurityEvent, requestIp } from './security';
import { loadPrivatePricing, withPrivatePricing } from './pricingPrivate';
import { sendCustomerMessage } from './customerComms';
import { approved, inIndia, requirePermission, text, requireAction } from './shared';

// Operational limits. All are staff-configurable in settings/operations; these defaults are the
// working values in the Tariff & Operations spec (pickup radius 3 km, subject to confirmation).
const DEFAULT_PICKUP_RADIUS_KM = 3;
const DEFAULT_FIX_MAX_AGE_S = 120;
const DEFAULT_FIX_MAX_ACCURACY_M = 200;
const DEFAULT_START_WINDOW_MIN = 360;
const MAX_TOTAL_KM = 6000;

interface TripLimits { radiusKm: number; maxAgeMs: number; maxAccuracyM: number; startWindowMs: number }
function limitsOf(settings: Record<string, unknown> | undefined): TripLimits {
  const n = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
  return {
    radiusKm: n(settings?.pickupRadiusKm, DEFAULT_PICKUP_RADIUS_KM, 0.1, 25),
    maxAgeMs: n(settings?.locationMaxAgeSeconds, DEFAULT_FIX_MAX_AGE_S, 10, 900) * 1000,
    maxAccuracyM: n(settings?.locationMaxAccuracyMeters, DEFAULT_FIX_MAX_ACCURACY_M, 10, 2000),
    startWindowMs: n(settings?.tripStartWindowMinutes, DEFAULT_START_WINDOW_MIN, 15, 4320) * 60000,
  };
}
const MAX_TOLLS = 50000;
const BOARDING_MAX_ATTEMPTS = 5;
const BOARDING_LOCK_MS = 10 * 60000;

const docId = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return v;
};

interface Fix { lat: number; lng: number; accuracy: number | null; capturedAt: number | null }

function fixOf(v: unknown): Fix | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!inIndia(o.lat, o.lng)) return null;
  const at = typeof o.capturedAt === 'number' && Number.isFinite(o.capturedAt) ? o.capturedAt : null;
  return { lat: o.lat as number, lng: o.lng as number, accuracy: typeof o.accuracy === 'number' && Number.isFinite(o.accuracy) ? Math.round(o.accuracy) : null, capturedAt: at };
}

async function activeDriver(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const d = await db.doc(`drivers/${uid}`).get();
  const p = d.data();
  if (!d.exists || !p || !approved(p.status) || p.fleetStatus === 'Suspended') throw new HttpsError('permission-denied', 'Your driver account is not active.');
  return { uid, name: text(p.name) };
}

interface TollIn { id: string; name: string; amount: number; receiptPhotoUrl: string; uploadedAt: string }

function tollsOf(v: unknown): TollIn[] {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 20) throw new HttpsError('invalid-argument', 'Too many toll receipts.');
  const out = v.map((t: any) => {
    const amount = t?.amount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_TOLLS) throw new HttpsError('invalid-argument', 'Each toll amount must be greater than zero.');
    return { id: text(t.id, 60) || `TOLL-${Date.now()}`, name: text(t.name, 80), amount, receiptPhotoUrl: text(t.receiptPhotoUrl, 600), uploadedAt: text(t.uploadedAt, 40) };
  });
  if (out.reduce((s, t) => s + t.amount, 0) > MAX_TOLLS) throw new HttpsError('invalid-argument', `Toll charges cannot exceed ₹${MAX_TOLLS.toLocaleString('en-IN')}.`);
  return out;
}

export const advanceTrip = onCall({ timeoutSeconds: 60 }, async (request) => {
  const input = request.data ?? {};
  const driver = await activeDriver(request.auth?.uid);
  const bookingId = docId(input.bookingId, 'booking');
  const to = input.to as TripSubStatus;
  if (!(TRIP_SUB_STATUSES as readonly string[]).includes(to) || to === 'Not Started') throw new HttpsError('invalid-argument', 'Choose Reached Pickup, Trip Started or Trip Ended.');
  const platform = text(input.platform, 12) || 'android';
  const requestId = text(input.requestId, 100);
  const fix = fixOf(input.location);
  await assertDeviceTrusted(driver.uid, platform);

  const ref = db.doc(`bookings/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  let violation = '';
  const result = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    violation = '';
    const [snap, verification, settingsSnap, myOngoing, driverDoc, privatePricing] = await Promise.all([
      tx.get(ref), to === 'Reached Pickup' || to === 'Trip Started' ? tx.get(db.doc(`vehicle_verifications/${bookingId}`)) : Promise.resolve(null),
      tx.get(db.doc('settings/operations')),
      to === 'Reached Pickup' || to === 'Trip Started' ? tx.get(db.collection('bookings').where('assignedDriverId', '==', driver.uid).where('status', '==', 'Ongoing')) : Promise.resolve(null),
      to === 'Reached Pickup' ? tx.get(db.doc(`drivers/${driver.uid}`)) : Promise.resolve(null),
      // The partner side of the pricing snapshot is private: it is read here only to work out the partner's final payout.
      to === 'Trip Ended' ? loadPrivatePricing(tx, bookingId) : Promise.resolve(null),
    ]);
    const limits = limitsOf(settingsSnap.data());
    if (!snap.exists) throw new HttpsError('not-found', 'This trip no longer exists.');
    const b = snap.data()!;
    if (b.assignedDriverId !== driver.uid) throw new HttpsError('permission-denied', 'This trip is not assigned to you.');
    if (['Cancelled', 'Rejected', 'Completed'].includes(b.status)) throw new HttpsError('failed-precondition', `This trip is ${String(b.status).toLowerCase()}.`);
    const current = tripSubStatusOf(b);
    // A repeated tap or retry of the same request changes nothing.
    if (current === to && requestId && b.lastTripRequestId === requestId) return { ok: true, duplicate: true, stage: to };
    const blocker = tripStageBlocker(current, to);
    if (blocker) { violation = blocker; throw new HttpsError('failed-precondition', blocker); }

    const stamp = FieldValue.serverTimestamp();
    const geo = fix ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: Timestamp.now() } : null;
    const base = { tripSubStatus: to, tripStage: LEGACY_STAGE_FOR[to], lastTripRequestId: requestId, updatedAt: stamp };
    let update: Record<string, unknown>;
    let adminMsg = '';
    const label = text(b.bookingId) || bookingId;

    if (to === 'Reached Pickup') {
      // 'Ongoing' only for a trip begun under the earlier order (driver still on the way).
      if (!['Assigned', 'Confirmed', 'Ongoing'].includes(b.status)) throw new HttpsError('failed-precondition', 'This trip cannot be updated in its current state.');
      // The upcoming duty cannot start while the same driver is still executing another trip.
      const other = myOngoing?.docs.find((d) => d.id !== bookingId);
      if (other) throw new HttpsError('failed-precondition', `Finish your current trip ${text(other.data().bookingId) || other.id} before starting this one.`, { code: 'trip-in-progress', bookingId: other.id });
      // The same car cannot be on two trips: another driver's running trip in this vehicle blocks the start.
      if (b.assignedVehicleId) {
        const sameVehicle = await tx.get(db.collection('bookings').where('assignedVehicleId', '==', b.assignedVehicleId).where('status', '==', 'Ongoing'));
        const busy = sameVehicle.docs.find((d) => d.id !== bookingId);
        if (busy) throw new HttpsError('failed-precondition', `This vehicle is still on trip ${text(busy.data().bookingId) || busy.id}. It must finish before this one can start.`, { code: 'vehicle-in-use', bookingId: busy.id });
      }
      // Start check: it is this driver's trip, the licence and vehicle are valid, and it is not too early.
      const at = pickupInstant(b);
      if (at && at.getTime() - Date.now() > limits.startWindowMs) {
        throw new HttpsError('failed-precondition', `This trip can be started from ${formatDateTime12(new Date(at.getTime() - limits.startWindowMs))}.`, { code: 'too-early' });
      }
      const scheduleCfg = await loadScheduleConfig(tx);
      if (driverDoc?.data()) assertDriverEligible(driverDoc.data()!, b, scheduleCfg);
      if (b.assignedVehicleId) {
        const vs = await tx.get(db.doc(`vehicles/${b.assignedVehicleId}`));
        const v = vs.data();
        if (!vs.exists || !v || v.docStatus !== 'Approved' || ['Inactive', 'Maintenance', 'Accident Hold'].includes(v.status)) {
          throw new HttpsError('failed-precondition', 'The assigned vehicle is not approved or not in service. Contact NESAM support.', { code: 'vehicle-blocked' });
        }
        assertVehicleEligible(v, vs.id, b, scheduleCfg);
      }
      // Pickup is driver-confirmed; GPS verification is disabled.
      update = { ...base, reachedPickupAt: stamp, reachedPickupLocation: null, reachedPickupDistanceKm: FieldValue.delete(), reachedPickupVerification: 'driver-confirmed' };
      adminMsg = `${driver.name} reached the pickup for ${label}.`;
    } else if (to === 'Trip Started') {
      if (!['Assigned', 'Confirmed', 'Ongoing'].includes(b.status)) throw new HttpsError('failed-precondition', 'This trip cannot be started in its current state.');
      if (myOngoing?.docs.some((d) => d.id !== bookingId)) throw new HttpsError('failed-precondition', 'Finish your current trip before starting this one.', { code: 'trip-in-progress' });
      if (b.assignedVehicleId) {
        const sameVehicle = await tx.get(db.collection('bookings').where('assignedVehicleId', '==', b.assignedVehicleId).where('status', '==', 'Ongoing'));
        if (sameVehicle.docs.some((d) => d.id !== bookingId)) throw new HttpsError('failed-precondition', 'This vehicle is still on another trip. It must finish before this one can start.', { code: 'vehicle-in-use' });
      }
      if (!b.boardingVerifiedAt) throw new HttpsError('failed-precondition', "Verify the customer's boarding OTP before starting the trip.", { boardingRequired: true });
      const v = verification!.data();
      if (!verification!.exists || !v || v.driverId !== driver.uid || v.status !== 'Submitted') {
        throw new HttpsError('failed-precondition', 'Complete the vehicle photo verification before starting the trip.', { verificationRequired: true });
      }
      update = {
        ...base, status: 'Ongoing', tripStartedAt: stamp, startedAt: stamp, tripStartedLocation: geo,
        startOdometer: v.odometerReading ?? FieldValue.delete(),
        vehicleVerification: { status: 'Submitted', riskLevel: v.riskLevel ?? 'low', flagged: v.flagged === true, submittedAt: v.submittedAt ?? null },
      };
      adminMsg = `Trip ${label} started by ${driver.name}.`;
    } else {
      if (b.status !== 'Ongoing') throw new HttpsError('failed-precondition', 'This trip is not in progress.');
      // The driver's input at Trip End is the total trip kilometres. A closing odometer reading is
      // optional and is used only to flag an unusual entry for review.
      const end = input.endOdometer;
      const start = typeof b.startOdometer === 'number' ? b.startOdometer : 0;
      const hasEnd = Number.isFinite(end) && end > 0;
      if (hasEnd && end < start) throw new HttpsError('invalid-argument', `The ending reading must be at least the starting reading (${start} km).`);
      const totalKm = input.totalKm;
      if (!hasEnd && !(typeof totalKm === 'number' && Number.isFinite(totalKm) && totalKm > 0)) {
        throw new HttpsError('invalid-argument', 'Enter the total kilometres driven for the whole trip.', { code: 'total-km-required' });
      }
      const whole = withPrivatePricing(b, privatePricing);
      const pricing = whole.pricing && typeof whole.pricing === 'object' && whole.pricing.schema === 2 ? (whole.pricing as PricingSnapshot) : null;
      // The driver states the total kilometres; the server derives the fare. A rate or amount from the driver is ignored.
      if (pricing && (typeof totalKm !== 'number' || !Number.isFinite(totalKm) || totalKm <= 0 || totalKm > MAX_TOTAL_KM)) {
        throw new HttpsError('invalid-argument', 'Enter the total kilometres driven for the whole trip.', { code: 'total-km-required' });
      }
      const tolls = input.tolls != null ? tollsOf(input.tolls) : (Array.isArray(b.tolls) ? (b.tolls as TollIn[]) : []);
      const driven = start > 0 && hasEnd ? end - start : null;
      const discrepancy = typeof totalKm === 'number' && driven !== null && Math.abs(driven - totalKm) > Math.max(5, totalKm * 0.1);
      let money: Record<string, unknown> = {};
      if (pricing && typeof totalKm === 'number') {
        const endMs = Date.now();
        if (pricing.source === 'tariff_v2' || pricing.gstInclusiveBase) {
          const f = finalizeFare({ pricing, totalKm, endMs });
          money = {
            fare: f.fare.total, fareBreakdown: f.fare,
            finalFare: { schema: 1, totalKm, quotedKm: pricing.quotedKm, includedKm: pricing.includedKm, extraKm: f.extraKm, days: f.days, extraDays: f.extraDays, quotedFare: b.fare, finalFare: f.fare.total, at: Timestamp.now() },
            ...(b.payoutSource === 'tariff' && f.partnerPaise !== null
              ? { [b.assignedVendorId ? 'vendorPayout' : 'driverPayout']: Math.round(f.partnerPaise) / 100 }
              : {}),
          };
        } else {
          const fb = b.fareBreakdown ?? {};
          const f = finalizeLegacyFare({
            total: Number(b.fare) || 0, taxable: Number(fb.taxableAmount) || 0, gstRate: typeof fb.gstRate === 'number' ? fb.gstRate : 0.05, discount: Number(fb.discount) || 0,
            quotedKm: pricing.quotedKm, extraKmRate: pricing.extraKmRatePaise / 100, totalKm,
          });
          const record = { schema: 1, totalKm, quotedKm: pricing.quotedKm, includedKm: pricing.includedKm, extraKm: f.extraKm, days: 1, extraDays: 0, quotedFare: b.fare, at: Timestamp.now() };
          if (f.extra > 0) {
            const next = { ...fb, ...(pricing.gst ? { gstDetails: { ...pricing.gst, ...gstComponents(f.gst, pricing.gst.split) } } : {}), taxableAmount: f.taxable, gst: f.gst, total: f.total, subtotal: (Number(fb.subtotal) || 0) + f.extra, distanceFare: (Number(fb.distanceFare) || 0) + f.extra, distanceKm: f.distanceKm };
            money = { fare: f.total, fareBreakdown: next, finalFare: { ...record, finalFare: f.total } };
          } else {
            money = { finalFare: { ...record, finalFare: b.fare } };
          }
        }
      }
      update = {
        ...base, status: 'Completed', tripEndedAt: stamp, completedAt: stamp, tripEndedLocation: geo, ...(hasEnd ? { endOdometer: end } : {}),
        ...(typeof totalKm === 'number' ? { totalKm, ...(discrepancy ? { distanceDiscrepancy: { odometerKm: driven, enteredKm: totalKm, flaggedAt: Timestamp.now() } } : {}) } : {}),
        ...money, tolls, tollCharges: tolls.reduce((s, t) => s + t.amount, 0),
      };
      adminMsg = `Trip ${label} completed by ${driver.name}.`;
    }
    tx.update(ref, update);
    tx.create(ref.collection('events').doc(), { type: `trip_${to.toLowerCase().replace(/\s+/g, '_')}`, actorId: driver.uid, actorRole: 'driver', location: geo, at: stamp });
    auditInTx(tx, {
      action: 'trip_status_changed', entity: 'booking', entityId: bookingId, performedBy: driver.uid, performedByName: driver.name, role: 'driver', bookingId,
      previous: { tripSubStatus: current, status: b.status }, next: { tripSubStatus: to, status: (update.status as string) ?? b.status }, meta: { located: !!geo, platform },
    });
    const admin: NotifyInput = {
      recipientType: 'admin', recipientId: 'admin', category: 'trips', severity: to === 'Trip Ended' ? 'success' : 'info', sound: 'general',
      title: to === 'Reached Pickup' ? 'Driver at pickup' : to === 'Trip Started' ? 'Trip started' : 'Trip completed', message: `${adminMsg} ${formatDateTime12(new Date())}`,
      bookingId, bookingCode: label, cta: { label: 'Open trip', page: 'booking-detail', bookingId }, push: to === 'Trip Ended', sentBy: driver.uid,
    };
    pushes.push({ id: notifyInTx(tx, admin), input: admin });
    if (b.customerId) {
      const c: NotifyInput = {
        recipientType: 'customer', brand: b.brand, recipientId: b.customerId, category: 'trips', severity: 'info', sound: 'general', push: true, sentBy: driver.uid,
        title: to === 'Reached Pickup' ? 'Your driver has arrived' : to === 'Trip Started' ? 'Your trip has started' : 'Trip completed',
        message: to === 'Reached Pickup'
          ? `${driver.name} is at your pickup point. Share the 4-digit boarding OTP from your NESAM app to start the trip.`
          : to === 'Trip Started'
            ? `Your trip ${label} has started. Have a safe journey.`
            : `Thank you for travelling with NESAM (${label}).`,
        bookingId, bookingCode: label,
      };
      pushes.push({ id: notifyInTx(tx, c), input: c });
    }
    return { ok: true, duplicate: false, stage: to };
  }).catch(async (err) => {
    if (violation) {
      await logSecurityEvent({ type: 'trip_state_violation', severity: 'medium', userId: driver.uid, role: 'driver', bookingId, platform, source: 'server', details: { attempted: to, reason: violation }, ip: requestIp(request) }).catch(() => null);
    }
    throw err;
  });
  await pushAfterCommit(pushes);
  // The trip just ended (not a repeated tap): send the customer their trip summary — every channel, as before.
  if (to === 'Trip Ended' && result && (result as { duplicate?: boolean }).duplicate === false) {
    try {
      const snap = await db.doc(`bookings/${bookingId}`).get();
      if (snap.exists) await sendCustomerMessage(bookingId, snap.data()!, 'trip_completed');
    } catch (err) {
      console.warn('trip completed message failed', err);
    }
  }
  return result;
});

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The customer reads a 4-digit code to the driver at pickup. Five wrong tries lock the check for ten minutes. */
export const verifyBoarding = onCall(async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const bookingId = docId(request.data?.bookingId, 'booking');
  const otp = text(request.data?.otp, 8);
  if (!/^\d{4}$/.test(otp)) throw new HttpsError('invalid-argument', "Enter the 4-digit OTP from the customer's app or message.");
  const ref = db.doc(`bookings/${bookingId}`);
  let locked = false;
  const out = await db.runTransaction(async (tx) => {
    locked = false;
    const [snap, secret] = await Promise.all([tx.get(ref), tx.get(db.doc(`booking_secrets/${bookingId}`))]);
    if (!snap.exists) throw new HttpsError('not-found', 'This trip no longer exists.');
    const b = snap.data()!;
    if (b.assignedDriverId !== driver.uid) throw new HttpsError('permission-denied', 'This trip is not assigned to you.');
    if (!['Assigned', 'Confirmed', 'Ongoing'].includes(b.status) || tripSubStatusOf(b) !== 'Reached Pickup') throw new HttpsError('failed-precondition', 'Mark that you have reached the pickup first.');
    if (b.boardingVerifiedAt) return { ok: true, already: true };
    const attempts = b.boardingAttempts ?? { count: 0 };
    const lockedUntil = (attempts.lockedUntil as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (lockedUntil > Date.now()) throw new HttpsError('resource-exhausted', `Too many wrong codes. Try again in ${Math.ceil((lockedUntil - Date.now()) / 60000)} minutes, or ask the customer to check the code.`);
    const expected = String(secret.data()?.otp ?? '');
    if (!expected) throw new HttpsError('failed-precondition', 'This booking has no boarding OTP. Contact NESAM support.');
    if (safeEqual(otp, expected)) {
      tx.update(ref, { boardingVerifiedAt: FieldValue.serverTimestamp(), boardingAttempts: { count: 0 }, updatedAt: FieldValue.serverTimestamp() });
      tx.create(ref.collection('events').doc(), { type: 'boarding_verified', actorId: driver.uid, actorRole: 'driver', at: FieldValue.serverTimestamp() });
      return { ok: true, already: false };
    }
    const count = (attempts.count ?? 0) + 1;
    locked = count >= BOARDING_MAX_ATTEMPTS;
    tx.update(ref, { boardingAttempts: { count: locked ? 0 : count, ...(locked ? { lockedUntil: Timestamp.fromMillis(Date.now() + BOARDING_LOCK_MS) } : {}) } });
    return { ok: false, remaining: Math.max(0, BOARDING_MAX_ATTEMPTS - count), locked };
  });
  if (locked) {
    await logSecurityEvent({ type: 'otp_attempts_exceeded', severity: 'medium', userId: driver.uid, role: 'driver', bookingId, source: 'server', details: { purpose: 'boarding' }, ip: requestIp(request) }).catch(() => null);
  }
  if (!out.ok) {
    throw new HttpsError('failed-precondition', locked ? 'Too many wrong codes. The check is locked for 10 minutes.' : `That code is not correct. ${out.remaining} attempt${out.remaining === 1 ? '' : 's'} left.`);
  }
  return out;
});

/**
 * Staff can also mark a trip "Reached Pickup" on the driver's behalf.
 * This distinct path requires a reason and keeps an audit record.
 */
export const overrideReachedPickup = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireAction(admin, 'Bookings', 'edit');
  const bookingId = docId(request.data?.bookingId, 'booking');
  const reason = text(request.data?.reason, 300);
  if (reason.length < 10) throw new HttpsError('invalid-argument', 'Give the reason (at least 10 characters). It is kept on the trip record.');
  const ref = db.doc(`bookings/${bookingId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (!['Assigned', 'Ongoing'].includes(b.status) || !b.assignedDriverId) throw new HttpsError('failed-precondition', 'Only an assigned trip can be marked as reached.');
    if (tripSubStatusOf(b) !== 'Not Started') throw new HttpsError('failed-precondition', 'This trip has already moved past the pickup stage.');
    const stamp = FieldValue.serverTimestamp();
    tx.update(ref, {
      tripSubStatus: 'Reached Pickup', tripStage: LEGACY_STAGE_FOR['Reached Pickup'], reachedPickupAt: stamp, updatedAt: stamp,
      reachedPickupOverride: { by: admin.uid, byName: admin.name, reason, at: Timestamp.now() },
    });
    tx.create(ref.collection('events').doc(), { type: 'trip_reached_pickup_override', actorId: admin.uid, actorRole: 'admin', reason, at: stamp });
    auditInTx(tx, {
      action: 'reached_pickup_override', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId,
      previous: { tripSubStatus: 'Not Started' }, next: { tripSubStatus: 'Reached Pickup' }, reason,
    });
  });
  return { ok: true };
});
