// Local duty ("continuous moving") for fleet drivers.
//
// A fleet partner (vendor) puts one of its approved drivers, in one of its approved vehicles, on local duty for a city and a
// time window, for Hourly Rental, Pickup & Drop or both. While the duty is on, the driver:
//   • does the selfie + vehicle photo check ONCE for the duty (vehicleVerification.ts, shift sessions), not once per order;
//   • sees the local orders around them (localShiftBoard): the fleet's own unassigned local orders and the open NESAM
//     marketplace duties of the same kind, inside the duty area, with distance from where they are;
//   • takes them one after another (takeLocalOrder): a current order plus one next order, never two rentals at once;
//   • runs each order through the ordinary server trip workflow (trips.ts) — boarding OTP, start, end, kilometres, payments.
// The duty's totals are always worked out from its own bookings (shiftTotals), so they can never drift from what was billed
// and collected. Clients can read their own duties (firestore.rules) and never write them.
//
//   localDutyOptions   vendor     cities to choose from
//   createLocalShift   vendor     plan a duty (driver, vehicle, city, services, window, area)
//   updateLocalShift   vendor     change the end time, services or area
//   endLocalShift      vendor / driver   end now, or after the orders in hand are finished
//   localShiftAction   driver     start (after the photo check), take a break, resume
//   localShiftBoard    driver     nearby orders for the duty (also records the driver's position)
//   takeLocalOrder     driver     take one order onto the duty
//   releaseLocalOrder  driver     hand an order back to the fleet before reaching the pickup
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { awaitingFulfilment } from './domain/advanceBooking';
import { tripSubStatusOf } from './domain/bookingFlow';
import { expiryMs, vehicleClassOf } from './domain/eligibility';
import {
  BOARD_LIMIT, LOCAL_MODE_LABEL, LocalMode, MAX_RELEASES_PER_SHIFT, OPEN_SHIFT_STATUSES, OVERDUE_GRACE_MS, RADIUS_DEFAULT_KM, RADIUS_MAX_KM, RADIUS_MIN_KM,
  SHIFT_EARLY_START_MS, SHIFT_MAX_MS, isPoint, kmBetween, localModeOf, overlaps, queueProblem, radiusOf, servicesOf, shiftTotals, shiftWindowProblem,
} from './domain/localShift';
import { formatDateTime12, formatTime12, isoDateIST, pickupInstant } from './domain/time';
import { sendCustomerMessage } from './customerComms';
import { assertDriverEligible, assertScheduleFree, bookingDutyClass, loadHeldDuties, loadScheduleConfig } from './eligibility';
import { assignableVehicle, docId, eligibleClassesFor, money } from './marketplace';
import { POSTING_MODES, vendorDocsComplete } from './claims';
import { releaseBlocker, releaseConfigOf } from './release';
import { assertPenaltiesAcknowledged } from './partnerOps';
import { notify, notifyInTx, pushAfterCommit, NotifyInput, inr } from './notify';
import { approved, inIndia, text } from './shared';

const SHIFTS = 'local_shifts';
/** A marketplace pickup is published rounded to two decimals (~1 km); allow for that when checking the duty area. */
const APPROX_TOLERANCE_KM = 2;
const VEHICLE_DOCS = [['insuranceExpiry', 'insurance'], ['fitnessExpiry', 'fitness certificate'], ['permitExpiry', 'permit'], ['pucExpiry', 'PUC certificate'], ['rcExpiry', 'registration']] as const;

const bad = (message: string, details?: unknown) => new HttpsError('invalid-argument', message, details);
const refused = (message: string, details?: unknown) => new HttpsError('failed-precondition', message, details);
const tsMs = (v: unknown): number | null => (v && typeof (v as Timestamp).toMillis === 'function' ? (v as Timestamp).toMillis() : null);
const code = (b: DocumentData, id: string) => text(b.bookingId) || id;
const servicesText = (list: LocalMode[]) => list.map((m) => LOCAL_MODE_LABEL[m]).join(' + ');
const windowText = (start: number, end: number) => `${formatDateTime12(new Date(start))} – ${formatTime12(new Date(end))}`;

/** An instant from the client: epoch milliseconds, or an ISO-8601 string with a zone. */
function instantOf(v: unknown, what: string): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  if (typeof v === 'string' && /T.*(Z|[+-]\d\d:?\d\d)$/.test(v)) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  throw bad(`Choose the ${what}.`);
}

interface Fix { lat: number; lng: number; accuracy: number | null }
function fixOf(v: unknown): Fix | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!inIndia(o.lat, o.lng)) return null;
  return { lat: o.lat as number, lng: o.lng as number, accuracy: typeof o.accuracy === 'number' && Number.isFinite(o.accuracy) ? Math.round(o.accuracy) : null };
}

async function approvedVendor(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`vendors/${uid}`).get();
  const v = snap.data();
  if (!snap.exists || !v || !approved(v.status)) throw new HttpsError('permission-denied', 'Only an approved fleet partner can plan local duty.');
  return { uid, data: v, name: text(v.companyName || v.name) || 'Your fleet partner' };
}

async function activeDriver(uid: string | undefined) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`drivers/${uid}`).get();
  const d = snap.data();
  if (!snap.exists || !d || !approved(d.status) || d.fleetStatus === 'Suspended') throw new HttpsError('permission-denied', 'Your driver account is not active.');
  return { uid, data: d, name: text(d.name) || 'Driver' };
}

/** Break time so far, closing an open break at `now`. */
const breakSoFar = (s: DocumentData, now: number) => Math.max(0, Number(s.breakMs) || 0) + (s.paused && tsMs(s.pausedAt) ? Math.max(0, now - (tsMs(s.pausedAt) as number)) : 0);

function dutyNotice(s: DocumentData, shiftId: string, to: 'driver' | 'vendor', title: string, message: string, severity: NotifyInput['severity'] = 'info', push = true): NotifyInput {
  return {
    recipientType: to, recipientId: String(to === 'driver' ? s.driverId : s.vendorId), category: 'trips', severity, sound: 'general', title, message,
    cta: { label: to === 'driver' ? 'Open Local Taxi' : 'Open local duty', page: to === 'driver' ? 'local' : 'local-duty' }, push, meta: { shiftId },
  };
}

// ── Vendor: plan and manage ─────────────────────────────────────────────────

export const localDutyOptions = onCall(async (request) => {
  const uid = request.auth?.uid;
  const v = uid ? await db.doc(`vendors/${uid}`).get() : null;
  if (!(v?.exists && approved(v.data()!.status))) await activeDriver(uid);
  const snap = await db.collection('locations').where('type', '==', 'City').where('status', '==', 'Active').get();
  const cities = snap.docs
    .map((d) => {
      const l = d.data();
      return { id: d.id, name: text(l.name || l.city, 80), state: text(l.state, 60), hasCentre: inIndia(l.lat, l.lng) };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { cities, radius: { default: RADIUS_DEFAULT_KM, min: RADIUS_MIN_KM, max: RADIUS_MAX_KM } };
});

export const createLocalShift = onCall({ timeoutSeconds: 60 }, async (request) => {
  const input = request.data ?? {};
  const uid = request.auth?.uid;
  // The fleet partner plans a duty for one of its drivers, or a fleet driver starts one for themselves in their paired vehicle.
  const vendorSnap = uid ? await db.doc(`vendors/${uid}`).get() : null;
  let vendor: { uid: string; data: DocumentData; name: string };
  let driverId: string;
  let vehicleId: string;
  let byDriver = false;
  if (vendorSnap?.exists && approved(vendorSnap.data()!.status)) {
    const v = vendorSnap.data()!;
    vendor = { uid: vendorSnap.id, data: v, name: text(v.companyName || v.name) || 'Your fleet partner' };
    driverId = docId(input.driverId, 'driver');
    vehicleId = docId(input.vehicleId, 'vehicle');
  } else {
    const me = await activeDriver(uid);
    const vendorId = text(me.data.vendorId);
    if (vendorId) {
      const vs = await db.doc(`vendors/${vendorId}`).get();
      if (!vs.exists || !approved(vs.data()!.status)) throw refused('Your fleet partner account is not active.');
      vendor = { uid: vs.id, data: vs.data()!, name: text(vs.data()!.companyName || vs.data()!.name) || 'Your fleet partner' };
    } else {
      // An owner-driver runs the duty on their own account, in their own attached vehicle.
      vendor = { uid: '', data: {}, name: '' };
    }
    driverId = me.uid;
    const paired = text(input.vehicleId) || text(me.data.assignedVehicleId);
    if (!paired) throw refused(vendorId ? 'Ask your fleet partner to pair a vehicle with you first.' : 'Attach an approved vehicle to your profile first.');
    vehicleId = docId(paired, 'vehicle');
    byDriver = true;
  }
  const services = servicesOf(input.services);
  if (!services.length) throw bad('Choose Hourly Rental, Pickup & Drop or both.');
  const now = Date.now();
  const startMs = input.startsAt == null || input.startsAt === 'now' ? now : instantOf(input.startsAt, 'start time');
  const endMs = instantOf(input.endsAt, 'end time');
  const problem = shiftWindowProblem(startMs, endMs, now, true);
  if (problem) throw bad(problem);
  const radiusKm = radiusOf(input.radiusKm);
  const note = text(input.note, 200);

  // The city: a master City (its centre, when saved, is the duty centre), or a name typed by the partner — then the duty
  // centre is where the driver starts the duty.
  let city: { id: string; name: string; state: string; centre: { lat: number; lng: number } | null };
  const cityId = typeof input.cityId === 'string' && input.cityId ? docId(input.cityId, 'city') : '';
  if (cityId) {
    const c = await db.doc(`locations/${cityId}`).get();
    const l = c.data();
    if (!c.exists || !l || l.type !== 'City' || l.status !== 'Active') throw bad('Choose an active city.');
    city = { id: c.id, name: text(l.name || l.city, 80), state: text(l.state, 60), centre: inIndia(l.lat, l.lng) ? { lat: l.lat as number, lng: l.lng as number } : null };
  } else {
    const name = text(input.cityName, 80);
    if (name.length < 2) throw bad('Choose the city for this local duty.');
    city = { id: '', name, state: '', centre: null };
  }

  const ref = db.collection(SHIFTS).doc();
  const pushes: { id: string; input: NotifyInput }[] = [];
  await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [driverSnap, driverShifts, vehicleShifts] = await Promise.all([
      tx.get(db.doc(`drivers/${driverId}`)),
      tx.get(db.collection(SHIFTS).where('driverId', '==', driverId).where('status', 'in', [...OPEN_SHIFT_STATUSES])),
      tx.get(db.collection(SHIFTS).where('vehicleId', '==', vehicleId).where('status', 'in', [...OPEN_SHIFT_STATUSES])),
    ]);
    const d = driverSnap.data();
    if (!driverSnap.exists || !d || (d.vendorId || '') !== vendor.uid) throw refused('Choose a driver from your own fleet.');
    const name = text(d.name) || 'This driver';
    if (!approved(d.status)) throw refused(`${name} is not approved by NESAM yet.`);
    if (d.fleetStatus === 'Suspended') throw refused(`${name} is suspended in your fleet.`);
    const licence = expiryMs(d.licenseExpiry);
    if (licence !== null && licence < endMs) throw refused(`${name}'s driving licence expires before this duty ends.`);
    const vehicle = await assignableVehicle(tx, vehicleId, vendor.uid, driverId);
    for (const [field, what] of VEHICLE_DOCS) {
      const at = expiryMs(vehicle.data[field]);
      if (at !== null && at < endMs) throw refused(`${vehicle.number}: the ${what} expires before this duty ends. Renew it first.`);
    }
    const mine = { start: startMs, end: endMs };
    const clash = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => docs.find((x) => overlaps(mine, { start: tsMs(x.data().startsAt) ?? 0, end: tsMs(x.data().endsAt) ?? 0 }));
    const dc = clash(driverShifts.docs);
    if (dc) throw refused(`${name} already has local duty ${windowText(tsMs(dc.data().startsAt) ?? 0, tsMs(dc.data().endsAt) ?? 0)}. Change or end it first.`, { shiftId: dc.id });
    const vc = clash(vehicleShifts.docs);
    if (vc) throw refused(`${vehicle.number} is already on local duty ${windowText(tsMs(vc.data().startsAt) ?? 0, tsMs(vc.data().endsAt) ?? 0)}.`, { shiftId: vc.id });

    const stamp = FieldValue.serverTimestamp();
    const vClass = vehicleClassOf({ vehicleClass: vehicle.data.vehicleClass, category: vehicle.data.category, make: vehicle.data.make, model: vehicle.data.model, name: vehicle.data.name, seatingCapacity: vehicle.data.seatingCapacity });
    const record = {
      id: ref.id, vendorId: vendor.uid, vendorName: vendor.name,
      driverId, driverName: name, driverPhone: text(d.phone, 20),
      vehicleId: vehicle.id, vehicleNumber: vehicle.number, vehicleCategory: text(vehicle.data.category || vehicle.data.vehicleClass, 40), vehicleClass: vClass ?? '',
      cityId: city.id, cityName: city.name, cityState: city.state, centre: city.centre, centreSource: city.centre ? 'city' : 'pending', radiusKm, services,
      date: isoDateIST(new Date(startMs)), startsAt: Timestamp.fromMillis(startMs), endsAt: Timestamp.fromMillis(endMs),
      status: 'Scheduled', paused: false, pausedAt: null, breakMs: 0, verification: null, releases: 0, orderIds: [],
      stats: shiftTotals([]), note, createdBy: byDriver ? driverId : vendor.uid, createdByRole: byDriver ? 'driver' : 'vendor', createdAt: stamp, updatedAt: stamp,
    };
    tx.create(ref, record);
    auditInTx(tx, {
      action: 'local_duty_planned', entity: 'local_shift', entityId: ref.id, performedBy: byDriver ? driverId : vendor.uid, performedByName: byDriver ? name : vendor.name, role: byDriver ? 'driver' : 'vendor',
      next: { driverId, vehicleId: vehicle.id, city: city.name, services, startsAt: startMs, endsAt: endMs, radiusKm },
    });
    const n = byDriver && !vendor.uid
      ? null
      : byDriver
      ? dutyNotice(record, ref.id, 'vendor', 'Driver started local duty', `${name} went on local duty in ${city.name} · ${servicesText(services)} · ${windowText(startMs, endMs)} · ${vehicle.number}.`)
      : dutyNotice(record, ref.id, 'driver', 'Local duty assigned',
        `${vendor.name} put you on local duty in ${city.name} · ${servicesText(services)} · ${windowText(startMs, endMs)} · ${vehicle.number}. Open Local Taxi to start.`);
    if (n) if (n.recipientId) pushes.push({ id: notifyInTx(tx, n), input: n });
  });
  await pushAfterCommit(pushes);
  return { ok: true, shiftId: ref.id };
});

export const updateLocalShift = onCall(async (request) => {
  const vendor = await approvedVendor(request.auth?.uid);
  const input = request.data ?? {};
  const shiftId = docId(input.shiftId, 'duty');
  const ref = db.doc(`${SHIFTS}/${shiftId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const snap = await tx.get(ref);
    const s = snap.data();
    if (!snap.exists || !s || s.vendorId !== vendor.uid) throw new HttpsError('not-found', 'This local duty was not found in your fleet.');
    if (!OPEN_SHIFT_STATUSES.includes(s.status)) throw refused(`This local duty has ${String(s.status).toLowerCase() === 'ended' ? 'ended' : 'closed'}.`);
    const now = Date.now();
    const startMs = tsMs(s.startsAt) ?? now;
    const changes: Record<string, unknown> = {};
    const said: string[] = [];
    if (input.endsAt != null) {
      const endMs = instantOf(input.endsAt, 'end time');
      if (endMs <= now + 5 * 60000) throw bad('Choose an end time at least 5 minutes from now, or end the duty.');
      if (endMs - startMs > SHIFT_MAX_MS) throw bad('A local duty can be at most 16 hours long.');
      if (endMs <= startMs) throw bad('The duty must end after it starts.');
      const others = await tx.get(db.collection(SHIFTS).where('driverId', '==', s.driverId).where('status', 'in', [...OPEN_SHIFT_STATUSES]));
      const clash = others.docs.find((x) => x.id !== shiftId && overlaps({ start: startMs, end: endMs }, { start: tsMs(x.data().startsAt) ?? 0, end: tsMs(x.data().endsAt) ?? 0 }));
      if (clash) throw refused(`The driver has another local duty from ${formatDateTime12(new Date(tsMs(clash.data().startsAt) ?? 0))}.`);
      changes.endsAt = Timestamp.fromMillis(endMs);
      said.push(`now ends ${formatDateTime12(new Date(endMs))}`);
    }
    if (input.services != null) {
      const services = servicesOf(input.services);
      if (!services.length) throw bad('Choose Hourly Rental, Pickup & Drop or both.');
      changes.services = services;
      said.push(servicesText(services));
    }
    if (input.radiusKm != null) {
      changes.radiusKm = radiusOf(input.radiusKm);
      said.push(`area ${changes.radiusKm} km`);
    }
    if (!Object.keys(changes).length) return { ok: true, changed: false };
    tx.update(ref, { ...changes, updatedAt: FieldValue.serverTimestamp() });
    auditInTx(tx, { action: 'local_duty_changed', entity: 'local_shift', entityId: shiftId, performedBy: vendor.uid, performedByName: vendor.name, role: 'vendor', next: { ...changes, endsAt: tsMs(changes.endsAt) ?? undefined } });
    const n = dutyNotice(s, shiftId, 'driver', 'Local duty updated', `${vendor.name} changed your local duty in ${text(s.cityName)}: ${said.join(' · ')}.`, 'info');
    if (n.recipientId) pushes.push({ id: notifyInTx(tx, n), input: n });
    return { ok: true, changed: true };
  });
  await pushAfterCommit(pushes);
  return out;
});

/** Vendor or driver. With no order in hand the duty ends now; otherwise no new order can be taken and it ends after them. */
export const endLocalShift = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const shiftId = docId(request.data?.shiftId, 'duty');
  const reason = text(request.data?.reason, 200);
  const ref = db.doc(`${SHIFTS}/${shiftId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [snap, held] = await Promise.all([tx.get(ref), tx.get(db.collection('bookings').where('localShiftId', '==', shiftId).where('status', 'in', ['Assigned', 'Ongoing']))]);
    const s = snap.data();
    if (!snap.exists || !s) throw new HttpsError('not-found', 'This local duty no longer exists.');
    const by = s.vendorId === uid ? 'vendor' : s.driverId === uid ? 'driver' : null;
    if (!by) throw new HttpsError('permission-denied', 'This local duty is not yours.');
    if (!OPEN_SHIFT_STATUSES.includes(s.status)) return { status: String(s.status), already: true };
    const now = Date.now();
    const stamp = FieldValue.serverTimestamp();
    const other = by === 'vendor' ? 'driver' : 'vendor';
    const who = by === 'vendor' ? text(s.vendorName) || 'Your fleet partner' : text(s.driverName) || 'The driver';
    let status: string;
    if (s.status === 'Scheduled') {
      tx.update(ref, { status: 'Cancelled', endedAt: stamp, endedBy: by, endReason: reason, updatedAt: stamp });
      status = 'Cancelled';
    } else if (held.empty) {
      tx.update(ref, { status: 'Ended', endedAt: stamp, endedBy: by, endReason: reason, paused: false, pausedAt: null, breakMs: breakSoFar(s, now), updatedAt: stamp });
      status = 'Ended';
    } else {
      if (s.endRequestedAt) return { status: 'Ending', already: true, open: held.size };
      tx.update(ref, { endRequestedAt: stamp, endRequestedBy: by, endReason: reason, updatedAt: stamp });
      status = 'Ending';
    }
    auditInTx(tx, { action: status === 'Ending' ? 'local_duty_end_requested' : 'local_duty_ended', entity: 'local_shift', entityId: shiftId, performedBy: uid, performedByName: who, role: by, previous: { status: s.status }, next: { status }, reason });
    const message = status === 'Cancelled'
      ? `${who} cancelled the local duty in ${text(s.cityName)} planned for ${formatDateTime12(new Date(tsMs(s.startsAt) ?? now))}.`
      : status === 'Ended'
        ? `${who} ended the local duty in ${text(s.cityName)}.`
        : `${who} is ending the local duty in ${text(s.cityName)}. No new orders; it closes when the ${held.size === 1 ? 'order' : `${held.size} orders`} in hand ${held.size === 1 ? 'is' : 'are'} finished.`;
    const n = dutyNotice(s, shiftId, other, status === 'Ending' ? 'Local duty ending' : status === 'Cancelled' ? 'Local duty cancelled' : 'Local duty ended', message, status === 'Cancelled' ? 'warning' : 'info');
    if (n.recipientId) pushes.push({ id: notifyInTx(tx, n), input: n });
    return { status, open: held.size };
  });
  await pushAfterCommit(pushes);
  if (out.status === 'Ended') await refreshShiftSummary(shiftId).catch((err) => console.warn('local duty summary failed', err));
  return out;
});

// ── Driver: run the duty ────────────────────────────────────────────────────

export const localShiftAction = onCall(async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const input = request.data ?? {};
  const shiftId = docId(input.shiftId, 'duty');
  const action = input.action === 'pause' || input.action === 'resume' ? input.action : input.action === 'start' ? 'start' : null;
  if (!action) throw bad('Choose start, pause or resume.');
  const fix = fixOf(input.location);
  const ref = db.doc(`${SHIFTS}/${shiftId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const snap = await tx.get(ref);
    const s = snap.data();
    if (!snap.exists || !s || s.driverId !== driver.uid) throw new HttpsError('not-found', 'This local duty is not assigned to you.');
    const now = Date.now();
    const stamp = FieldValue.serverTimestamp();
    const startMs = tsMs(s.startsAt) ?? now;
    const endMs = tsMs(s.endsAt) ?? now;
    if (action === 'start') {
      if (s.status === 'Active') return { ok: true, status: 'Active', already: true };
      if (s.status !== 'Scheduled') throw refused('This local duty is closed.');
      if (now >= endMs) throw refused('This local duty’s time is over. Ask your fleet partner to plan a new one.');
      if (now < startMs - SHIFT_EARLY_START_MS) throw refused(`You can start this duty from ${formatTime12(new Date(startMs - SHIFT_EARLY_START_MS))}.`, { code: 'too-early' });
      if (s.verification?.status !== 'Submitted') throw refused('Complete the selfie and vehicle photo check for today’s duty first.', { code: 'verification-required' });
      const centre = isPoint(s.centre) ? s.centre : fix ? { lat: fix.lat, lng: fix.lng } : null;
      if (!centre) throw refused('Turn on location so the duty area can be set around you.', { code: 'location-required' });
      // The vehicle must still be in service and approved now.
      await assignableVehicle(tx, String(s.vehicleId), String(s.vendorId), driver.uid);
      tx.update(ref, {
        status: 'Active', startedAt: stamp, centre, ...(isPoint(s.centre) ? {} : { centreSource: 'driver' }),
        ...(fix ? { lastLocation: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: Timestamp.now() } } : {}), paused: false, pausedAt: null, updatedAt: stamp,
      });
      tx.update(db.doc(`drivers/${driver.uid}`), { presenceStatus: 'Online', presenceUpdatedAt: stamp });
      const n = dutyNotice(s, shiftId, 'vendor', 'Local duty started', `${driver.name} started local duty in ${text(s.cityName)} with ${text(s.vehicleNumber)}.`, 'success', false);
      if (n.recipientId) pushes.push({ id: notifyInTx(tx, n), input: n });
      return { ok: true, status: 'Active' };
    }
    if (s.status !== 'Active') throw refused('Start the duty first.');
    if (action === 'pause') {
      if (s.paused) return { ok: true, paused: true, already: true };
      tx.update(ref, { paused: true, pausedAt: stamp, updatedAt: stamp });
      return { ok: true, paused: true };
    }
    if (!s.paused) return { ok: true, paused: false, already: true };
    tx.update(ref, { paused: false, pausedAt: null, breakMs: breakSoFar(s, now), updatedAt: stamp });
    return { ok: true, paused: false };
  });
  await pushAfterCommit(pushes);
  return out;
});

export interface BoardOrder {
  id: string;
  code: string;
  source: 'fleet' | 'marketplace';
  mode: LocalMode;
  pickup: { name: string; address: string; lat: number; lng: number; approx: boolean };
  drop: { name: string; lat: number | null; lng: number | null } | null;
  pickupAtMs: number | null;
  overdue: boolean;
  tripKm: number;
  awayKm: number;
  rentalHours: number | null;
  includedKm: number | null;
  fare: number;
  paymentMethod: string;
  vehicleCategory: string;
}

/** Nearby local orders the driver can take now, closest first. Also records where the driver is. */
export const localShiftBoard = onCall({ timeoutSeconds: 30 }, async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const shiftId = docId(request.data?.shiftId, 'duty');
  const fix = fixOf(request.data?.location);
  const ref = db.doc(`${SHIFTS}/${shiftId}`);
  const snap = await ref.get();
  const s = snap.data();
  if (!snap.exists || !s || s.driverId !== driver.uid) throw new HttpsError('not-found', 'This local duty is not assigned to you.');
  const now = Date.now();
  if (fix && s.status === 'Active') {
    await ref.update({ lastLocation: { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: Timestamp.now() } }).catch(() => null);
  }
  const closed = (reason: string) => ({ open: false, reason, orders: [] as BoardOrder[], serverTime: now, radiusKm: radiusOf(s.radiusKm), centre: isPoint(s.centre) ? s.centre : null });
  if (s.status !== 'Active') return closed(s.status === 'Scheduled' ? 'Start the duty to see orders.' : 'This duty is closed.');
  if (s.endRequestedAt) return closed('The duty is ending. Finish the orders in hand.');
  if (s.paused) return closed('You are on a break. Resume to see orders.');
  const endMs = tsMs(s.endsAt) ?? now;
  if (now >= endMs) return closed('The duty time is over. Finish the orders in hand.');
  const centre = isPoint(s.centre) ? s.centre : fix;
  if (!centre) return closed('Turn on location to see nearby orders.');
  const here = fix ?? centre;
  const radiusKm = radiusOf(s.radiusKm);
  const services = servicesOf(s.services);
  const vClass = text(s.vehicleClass);

  const [fleet, market, settings, vendorSnap] = await Promise.all([
    s.vendorId ? db.collection('bookings').where('assignedVendorId', '==', s.vendorId).where('status', '==', 'Confirmed').limit(200).get() : Promise.resolve(null),
    db.collection('marketplace_trips').where('status', 'in', ['Open', 'Bidding']).limit(300).get(),
    db.doc('settings/operations').get(),
    s.vendorId ? db.doc(`vendors/${s.vendorId}`).get() : Promise.resolve(null),
  ]);
  const orders: BoardOrder[] = [];
  const seen = new Set<string>();
  const classOk = (b: DocumentData) => {
    const classes = eligibleClassesFor(bookingDutyClass(b));
    return !classes.length || !vClass || classes.includes(vClass);
  };

  for (const d of fleet?.docs ?? []) {
    const b = d.data();
    if (b.assignedDriverId || tripSubStatusOf(b) !== 'Not Started') continue;
    const mode = localModeOf(b);
    if (!mode || !services.includes(mode) || !classOk(b)) continue;
    const pick = { lat: Number(b.pickupLat), lng: Number(b.pickupLng) };
    if (!isPoint(pick) || kmBetween(pick, centre) > radiusKm) continue;
    const at = pickupInstant(b)?.getTime() ?? null;
    if (at !== null && (at < now - OVERDUE_GRACE_MS || at > endMs)) continue;
    seen.add(d.id);
    orders.push(orderOf(d.id, b, 'fleet', mode, { ...pick, approx: false }, here, at, now));
  }

  // Open NESAM duties of the same kind: the partner may take them through its driver, on the published terms.
  // A fleet driver takes them for the fleet partner; an owner-driver for themselves.
  const owner = !s.vendorId;
  const vendor = vendorSnap?.data();
  const marketOpen = owner ? true : !!vendor && approved(vendor.status) && vendorDocsComplete(vendor);
  if (marketOpen) {
    const release = releaseConfigOf(settings.data());
    const party = owner ? driver.data : vendor!;
    const rating = typeof party.rating === 'number' ? party.rating : null;
    const candidates: { id: string; o: DocumentData; mode: LocalMode; pick: { lat: number; lng: number }; at: number }[] = [];
    for (const d of market.docs) {
      if (seen.has(d.id)) continue;
      const o = d.data();
      const mode = localModeOf({ tripType: o.tripType, service: o.service, distanceKm: o.distanceKm });
      if (!mode || !services.includes(mode)) continue;
      if (o.mode && !POSTING_MODES.includes(o.mode)) continue;
      const pick = { lat: Number(o.pickup?.lat), lng: Number(o.pickup?.lng) };
      if (!isPoint(pick) || kmBetween(pick, centre) > radiusKm + APPROX_TOLERANCE_KM) continue;
      const at = tsMs(o.pickupAt);
      if (!at || at <= now || at > endMs) continue;
      const cutoff = tsMs(o.cutoffAt);
      if (cutoff && now > cutoff) continue;
      const classes: string[] = Array.isArray(o.eligibleVehicleClasses) ? o.eligibleVehicleClasses : [];
      if (classes.length && vClass && !classes.includes(vClass)) continue;
      if (!(money(o.offeredPayout) > 0)) continue;
      if (releaseBlocker(release, owner ? 'driver' : 'vendor', rating, tsMs(o.publishedAt) ?? 0, now)) continue;
      candidates.push({ id: d.id, o, mode, pick, at });
    }
    candidates.sort((a, b) => kmBetween(here, a.pick) - kmBetween(here, b.pick));
    const top = candidates.slice(0, BOARD_LIMIT);
    const bookings = top.length ? await db.getAll(...top.map((c) => db.doc(`bookings/${c.id}`))) : [];
    top.forEach((c, i) => {
      const b = bookings[i]?.data();
      if (!b || !awaitingFulfilment(b) || b.fareVerified !== true) return;
      orders.push(orderOf(c.id, b, 'marketplace', c.mode, { ...c.pick, approx: true }, here, c.at, now, c.o));
    });
  }

  orders.sort((a, b) => a.awayKm - b.awayKm || (a.pickupAtMs ?? Infinity) - (b.pickupAtMs ?? Infinity));
  return { open: true, reason: '', orders: orders.slice(0, BOARD_LIMIT), serverTime: now, radiusKm, centre, marketplace: marketOpen };
});

function orderOf(id: string, b: DocumentData, source: BoardOrder['source'], mode: LocalMode, pick: { lat: number; lng: number; approx: boolean }, here: { lat: number; lng: number }, at: number | null, now: number, offer?: DocumentData): BoardOrder {
  const p = b.pricing && typeof b.pricing === 'object' ? b.pricing : {};
  const dropPoint = { lat: Number(offer ? offer.drop?.lat : b.dropLat), lng: Number(offer ? offer.drop?.lng : b.dropLng) };
  return {
    id, code: code(b, id), source, mode,
    // A published duty shows the area only until it is taken (as on the marketplace); a fleet order is already the partner's.
    pickup: { name: text(b.pickup, 120) || 'Pickup', address: source === 'fleet' ? text(b.pickupAddress, 240) : '', lat: pick.lat, lng: pick.lng, approx: pick.approx },
    drop: mode === 'rental' ? null : { name: text(b.drop, 120) || 'Drop', lat: isPoint(dropPoint) ? dropPoint.lat : null, lng: isPoint(dropPoint) ? dropPoint.lng : null },
    pickupAtMs: at, overdue: at !== null && at < now,
    tripKm: Math.round(money(b.distanceKm) * 10) / 10,
    awayKm: Math.round(kmBetween(here, pick) * 10) / 10,
    rentalHours: mode === 'rental' && Number(p.rentalHours) > 0 ? Number(p.rentalHours) : null,
    includedKm: Number(p.includedKm) > 0 ? Number(p.includedKm) : null,
    fare: money(b.fare), paymentMethod: text(b.paymentMethod, 20) || 'Cash', vehicleCategory: text(b.vehicleCategory || b.vehicle, 40),
  };
}

/** The pre-trip evidence of the duty, copied onto an order so the order needs no photo check of its own. */
function inheritedVerification(s: DocumentData, shiftId: string, bookingId: string, driverId: string) {
  const v = s.verification ?? {};
  return {
    bookingId, tripId: bookingId, driverId, vehicleId: text(s.vehicleId), vehicleNumber: text(s.vehicleNumber), sessionId: text(v.sessionId), status: 'Submitted',
    inheritedFromShift: shiftId, riskLevel: text(v.riskLevel) || 'low', riskScore: typeof v.riskScore === 'number' ? v.riskScore : 0, flagged: v.flagged === true,
    driverSelfiePhoto: text(v.photos?.selfie, 600), vehicleFrontPhoto: text(v.photos?.front, 600), vehicleRearPhoto: text(v.photos?.rear, 600), vehicleInteriorPhoto: text(v.photos?.interior, 600),
    submittedAt: v.submittedAt ?? Timestamp.now(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
}

/** Booking fields that put an order on a duty. */
function dutyFields(s: DocumentData, shiftId: string, mode: LocalMode, source: string) {
  const v = s.verification ?? {};
  return {
    localShiftId: shiftId,
    localShift: { id: shiftId, mode, source, city: text(s.cityName), takenAt: Timestamp.now() },
    vehicleVerification: { status: 'Submitted', riskLevel: text(v.riskLevel) || 'low', flagged: v.flagged === true, submittedAt: v.submittedAt ?? Timestamp.now(), source: 'local_duty', shiftId },
    preTrip: { driverSelfie: text(v.photos?.selfie, 600), vehicleFront: text(v.photos?.front, 600), vehicleRear: text(v.photos?.rear, 600), vehicleInterior: text(v.photos?.interior, 600), odometerReading: null, capturedAt: v.submittedAt?.toDate?.()?.toISOString?.() ?? '', sessionId: text(v.sessionId), shiftId },
  };
}

interface HeldRow { id: string; code: string; mode: LocalMode | null; status: string; subStatus: string }
const heldRows = (docs: FirebaseFirestore.QueryDocumentSnapshot[]): HeldRow[] =>
  docs.map((d) => ({ id: d.id, code: code(d.data(), d.id), mode: localModeOf(d.data()), status: String(d.data().status), subStatus: tripSubStatusOf(d.data()) }));

export const takeLocalOrder = onCall({ timeoutSeconds: 60 }, async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const shiftId = docId(request.data?.shiftId, 'duty');
  const bookingId = docId(request.data?.bookingId, 'order');
  const shiftRef = db.doc(`${SHIFTS}/${shiftId}`);
  const ref = db.doc(`bookings/${bookingId}`);
  const market = db.doc(`marketplace_trips/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];

  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [shiftSnap, snap, m, inShift, bids, cfg] = await Promise.all([
      tx.get(shiftRef), tx.get(ref), tx.get(market),
      tx.get(db.collection('bookings').where('localShiftId', '==', shiftId).where('status', 'in', ['Assigned', 'Ongoing'])),
      tx.get(market.collection('bids')), loadScheduleConfig(tx),
    ]);
    const s = shiftSnap.data();
    if (!shiftSnap.exists || !s || s.driverId !== driver.uid) throw new HttpsError('not-found', 'This local duty is not assigned to you.');
    const now = Date.now();
    if (s.status !== 'Active') throw refused(s.status === 'Scheduled' ? 'Start your duty first.' : 'This duty is closed.');
    if (s.endRequestedAt) throw refused('Your duty is ending. No new orders can be taken.');
    if (s.paused) throw refused('You are on a break. Resume the duty to take orders.');
    if (now >= (tsMs(s.endsAt) ?? now)) throw refused('Your duty time is over. Finish the orders in hand.');
    if (s.verification?.status !== 'Submitted') throw refused('Complete the selfie and vehicle photo check for the duty first.', { code: 'verification-required' });
    if (!snap.exists) throw refused('This order is no longer available.', { code: 'taken' });
    const b = snap.data()!;
    const mode = localModeOf(b);
    const services = servicesOf(s.services);
    if (!mode || !services.includes(mode)) throw refused(`This order is not part of today’s duty (${servicesText(services)}).`);
    const centre = isPoint(s.centre) ? s.centre : null;
    const pick = { lat: Number(b.pickupLat), lng: Number(b.pickupLng) };
    if (centre && isPoint(pick) && kmBetween(pick, centre) > radiusOf(s.radiusKm) + APPROX_TOLERANCE_KM) throw refused('This pickup is outside your duty area.');

    const vendorId = String(s.vendorId);
    const owner = !vendorId;
    const fleetOrder = !owner && b.assignedVendorId === vendorId && b.status === 'Confirmed' && !b.assignedDriverId && tripSubStatusOf(b) === 'Not Started';
    const offer = m.exists ? m.data()! : null;
    const marketOrder = !fleetOrder && !!offer && ['Open', 'Bidding'].includes(String(offer.status)) && awaitingFulfilment(b);
    if (!fleetOrder && !marketOrder) throw refused('Another driver or partner has taken this order.', { code: 'taken' });

    const problem = queueProblem(heldRows(inShift.docs), mode);
    if (problem) throw refused(problem, { code: 'queue-full' });

    let payout = 0;
    let vendor: DocumentData | null = null;
    if (marketOrder) {
      const vs = owner ? null : await tx.get(db.doc(`vendors/${vendorId}`));
      vendor = owner ? driver.data : vs?.data() ?? null;
      if (!vendor || !approved(vendor.status)) throw refused('Your fleet partner account is not active.');
      if (!owner && !vendorDocsComplete(vendor)) throw refused('Your fleet partner’s documents are not verified yet, so NESAM duties cannot be taken.', { code: 'documents-required' });
      if (b.fareVerified !== true) throw refused('This order is not ready to be taken yet.');
      const at = pickupInstant(b);
      if (at && at.getTime() <= now) throw refused('The pickup time of this order has passed.', { code: 'expired' });
      const cutoff = tsMs(offer!.cutoffAt);
      if (cutoff && now > cutoff) throw refused('This order has closed.', { code: 'expired' });
      const settings = await tx.get(db.doc('settings/operations'));
      const wave = releaseBlocker(releaseConfigOf(settings.data()), owner ? 'driver' : 'vendor', typeof vendor.rating === 'number' ? vendor.rating : null, tsMs(offer!.publishedAt) ?? 0, now);
      if (wave) throw refused(wave, { code: 'not-released' });
      payout = money(offer!.offeredPayout);
      if (!(payout > 0)) throw refused('This order has no valid offer.');
      await assertPenaltiesAcknowledged(tx, owner ? 'driver' : 'vendor', owner ? driver.uid : vendorId);
    }

    // Orders outside this duty still keep the driver's and the vehicle's ordinary schedule.
    const [driverHeld, vehicleHeld] = await Promise.all([loadHeldDuties(tx, 'assignedDriverId', driver.uid), loadHeldDuties(tx, 'assignedVehicleId', String(s.vehicleId))]);
    const outside = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => docs.filter((d) => d.data().localShiftId !== shiftId);
    assertDriverEligible(driver.data, b, cfg);
    const vehicle = await assignableVehicle(tx, String(s.vehicleId), vendorId, driver.uid, b);
    assertScheduleFree(outside(driverHeld), 'You', b, bookingId, cfg);
    assertScheduleFree(outside(vehicleHeld), `Vehicle ${vehicle.number}`, b, bookingId, cfg);

    // ── writes ──
    const stamp = FieldValue.serverTimestamp();
    const label = code(b, bookingId);
    const vendorName = owner ? '' : text(s.vendorName) || text(vendor?.companyName || vendor?.name);
    const verificationRef = db.doc(`vehicle_verifications/${bookingId}`);
    tx.update(ref, {
      status: 'Assigned', tripStage: 'Assigned', tripSubStatus: 'Not Started',
      assignedDriverId: driver.uid, assignedDriverName: driver.name, driver: driver.name, driverPhone: text(driver.data.phone),
      assignedVehicleId: vehicle.id, assignedVehicleNumber: vehicle.number, assignedAt: stamp,
      ...dutyFields(s, shiftId, mode, fleetOrder ? 'fleet' : 'marketplace'),
      // The driver chose the order themselves: it is seen and acknowledged.
      driverResponse: { driverId: driver.uid, viewedAt: stamp, acknowledgedAt: stamp },
      lastAssignment: { action: 'assign', by: driver.uid, byName: driver.name, reason: 'Taken on local duty', at: Timestamp.now() },
      assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
      ...(marketOrder && owner ? { driverPayout: payout, payoutSource: 'offered', fulfilmentRoute: 'marketplace', acceptedAt: stamp } : {}),
      ...(marketOrder && !owner ? {
        assignedVendorId: vendorId, assignedVendorName: vendorName, vendorPayout: payout, payoutSource: 'offered', fulfilmentRoute: 'marketplace',
        confirmedAt: stamp, acceptedAt: stamp, assignedVendorAt: stamp,
      } : {}),
    });
    tx.set(verificationRef, inheritedVerification(s, shiftId, bookingId, driver.uid));
    if (marketOrder) {
      tx.update(market, { status: 'Assigned', ...(owner ? {} : { assignedVendorId: vendorId, assignedVendorName: vendorName }), assignedDriverId: driver.uid, assignedDriverName: driver.name, acceptedAt: stamp, updatedAt: stamp });
      for (const bid of bids.docs) if (bid.data().status === 'Pending Review') tx.update(bid.ref, { status: 'Rejected', reviewedAt: stamp });
    }
    tx.update(shiftRef, { lastOrderAt: stamp, orderIds: FieldValue.arrayUnion(bookingId), updatedAt: stamp });
    const newDriver = { id: driver.uid, name: driver.name, vehicleId: vehicle.id, vehicleNumber: vehicle.number, vendorId };
    tx.create(ref.collection('assignments').doc(), { action: 'assign', oldDriver: null, newDriver, changedBy: driver.uid, changedByName: driver.name, reason: 'Taken on local duty', shiftId, at: stamp });
    tx.create(ref.collection('events').doc(), { type: 'local_duty_taken', actorId: driver.uid, actorRole: 'driver', shiftId, source: fleetOrder ? 'fleet' : 'marketplace', ...(marketOrder ? { payout } : {}), at: stamp });
    auditInTx(tx, {
      action: 'local_order_taken', entity: 'booking', entityId: bookingId, performedBy: driver.uid, performedByName: driver.name, role: 'driver', bookingId,
      next: { shiftId, mode, source: fleetOrder ? 'fleet' : 'marketplace', vendorId, vehicleId: vehicle.id, ...(marketOrder ? { payout } : {}) },
    });
    const toVendor = dutyNotice(s, shiftId, 'vendor', 'Local order taken',
      `${driver.name} took ${label} (${LOCAL_MODE_LABEL[mode]}) on local duty · ${text(b.pickup)}${mode === 'rental' ? '' : ` → ${text(b.drop)}`}${marketOrder ? ` · payout ₹${payout.toLocaleString('en-IN')}` : ''}.`, 'info', false);
    toVendor.bookingId = bookingId;
    toVendor.bookingCode = label;
    if (toVendor.recipientId) pushes.push({ id: notifyInTx(tx, toVendor), input: toVendor });
    if (marketOrder) {
      const admin: NotifyInput = {
        recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'info', sound: 'general', title: 'Marketplace duty taken on local duty',
        message: `${label} taken by ${driver.name} for ${vendorName} (local duty, ${text(s.cityName)}) at ${inr(payout)}.`, bookingId, bookingCode: label,
        cta: { label: 'Open booking', page: 'booking-detail', bookingId }, push: false,
      };
      if (admin.recipientId) pushes.push({ id: notifyInTx(tx, admin), input: admin });
    }
    return { booking: { ...b, assignedDriverName: driver.name, driver: driver.name, assignedVehicleNumber: vehicle.number, assignedVendorName: vendorName }, mode };
  });
  await pushAfterCommit(pushes);
  await sendCustomerMessage(bookingId, out.booking, 'driver_assigned').catch((err) => console.warn('customer message failed', err));
  await refreshShiftSummary(shiftId).catch((err) => console.warn('local duty summary failed', err));
  return { ok: true, bookingId, mode: out.mode };
});

/** Hands an order back to the fleet partner before the pickup is reached (the partner reassigns it). */
export const releaseLocalOrder = onCall(async (request) => {
  const driver = await activeDriver(request.auth?.uid);
  const shiftId = docId(request.data?.shiftId, 'duty');
  const bookingId = docId(request.data?.bookingId, 'order');
  const reason = text(request.data?.reason, 200);
  if (reason.length < 3) throw bad('Say why you are handing this order back.');
  const shiftRef = db.doc(`${SHIFTS}/${shiftId}`);
  const ref = db.doc(`bookings/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [shiftSnap, snap, ver, market] = await Promise.all([tx.get(shiftRef), tx.get(ref), tx.get(db.doc(`vehicle_verifications/${bookingId}`)), tx.get(db.doc(`marketplace_trips/${bookingId}`))]);
    const s = shiftSnap.data();
    if (!shiftSnap.exists || !s || s.driverId !== driver.uid) throw new HttpsError('not-found', 'This local duty is not assigned to you.');
    const b = snap.data();
    if (!snap.exists || !b || b.localShiftId !== shiftId || b.assignedDriverId !== driver.uid) throw refused('This order is no longer yours.');
    if (b.status !== 'Assigned' || tripSubStatusOf(b) !== 'Not Started') throw refused('After reaching the pickup an order can no longer be handed back. Call the office for help.');
    if ((Number(s.releases) || 0) >= MAX_RELEASES_PER_SHIFT) throw refused(`You have already handed back ${MAX_RELEASES_PER_SHIFT} orders on this duty. Call your fleet partner.`);
    const stamp = FieldValue.serverTimestamp();
    const del = FieldValue.delete();
    const owner = !s.vendorId;
    if (owner && market.exists) tx.update(market.ref, { status: 'Open', assignedDriverId: del, assignedDriverName: del, acceptedAt: del, updatedAt: stamp });
    tx.update(ref, {
      // A fleet order goes back to the fleet partner; an owner-driver's order goes back to Open Duties.
      status: owner ? 'Approved' : 'Confirmed', tripStage: 'Assigned', tripSubStatus: 'Not Started',
      ...(owner ? { driverPayout: del, payoutSource: del, acceptedAt: del } : {}),
      assignedDriverId: del, assignedDriverName: del, driver: del, driverPhone: del, assignedVehicleId: del, assignedVehicleNumber: del,
      localShiftId: del, localShift: del, vehicleVerification: del, preTrip: del, driverResponse: del,
      lastAssignment: { action: 'release', by: driver.uid, byName: driver.name, reason, at: Timestamp.now() },
      assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
    });
    if (ver.exists && ver.data()!.inheritedFromShift === shiftId) tx.update(ver.ref, { status: 'Superseded', supersededAt: stamp });
    tx.update(shiftRef, { releases: FieldValue.increment(1), updatedAt: stamp });
    tx.create(ref.collection('assignments').doc(), {
      action: 'remove', oldDriver: { id: driver.uid, name: driver.name, vehicleId: text(b.assignedVehicleId), vehicleNumber: text(b.assignedVehicleNumber), vendorId: text(s.vendorId) },
      newDriver: null, changedBy: driver.uid, changedByName: driver.name, reason: `Handed back on local duty: ${reason}`, shiftId, at: stamp,
    });
    tx.create(ref.collection('events').doc(), { type: 'local_duty_released', actorId: driver.uid, actorRole: 'driver', shiftId, reason, at: stamp });
    auditInTx(tx, { action: 'local_order_released', entity: 'booking', entityId: bookingId, performedBy: driver.uid, performedByName: driver.name, role: 'driver', bookingId, previous: { driverId: driver.uid, shiftId }, next: { status: 'Confirmed' }, reason });
    const label = code(b, bookingId);
    const n = dutyNotice(s, shiftId, 'vendor', 'Order handed back', `${driver.name} handed back ${label} (${text(b.pickup)}): ${reason}. Assign another driver.`, 'warning');
    n.bookingId = bookingId;
    n.bookingCode = label;
    n.cta = { label: 'Assign driver', page: 'trips', bookingId };
    if (n.recipientId) pushes.push({ id: notifyInTx(tx, n), input: n });
  });
  await pushAfterCommit(pushes);
  await refreshShiftSummary(shiftId).catch((err) => console.warn('local duty summary failed', err));
  return { ok: true };
});

// ── Totals, closing and the vendor assignment hook ──────────────────────────

/**
 * Re-works the duty's totals from its bookings, and closes a duty whose end was asked for once no order is left in hand.
 * Idempotent: any number of calls give the same result.
 */
export async function refreshShiftSummary(shiftId: string): Promise<void> {
  const ref = db.doc(`${SHIFTS}/${shiftId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [snap, trips] = await Promise.all([tx.get(ref), tx.get(db.collection('bookings').where('localShiftId', '==', shiftId))]);
    const s = snap.data();
    if (!snap.exists || !s) return;
    const stats = shiftTotals(trips.docs.map((d) => d.data()));
    const now = Date.now();
    const closing = s.status === 'Active' && !!s.endRequestedAt && stats.active === 0;
    tx.update(ref, {
      stats, statsUpdatedAt: FieldValue.serverTimestamp(),
      ...(closing ? { status: 'Ended', endedAt: FieldValue.serverTimestamp(), endedBy: text(s.endRequestedBy) || 'system', paused: false, pausedAt: null, breakMs: breakSoFar(s, now) } : {}),
    });
    if (closing) {
      const summary = `${stats.completed} order${stats.completed === 1 ? '' : 's'} · ${stats.km} km · fare ₹${stats.fare.toLocaleString('en-IN')} · cash with driver ₹${stats.cashInHand.toLocaleString('en-IN')}`;
      for (const to of ['driver', 'vendor'] as const) {
        const n = dutyNotice(s, shiftId, to, 'Local duty closed', `Local duty in ${text(s.cityName)} closed: ${summary}.`, 'success', false);
        if (n.recipientId) pushes.push({ id: notifyInTx(tx, n), input: n });
      }
    }
  });
  await pushAfterCommit(pushes);
}

/**
 * Vendor assignment hook (vendorDispatch.ts): when the chosen driver is on an active local duty in the same vehicle and the
 * order is the kind the duty serves, the order joins the duty and uses its photo check. Reads only — call it before the
 * transaction's first write. Returns the booking fields to write and the verification record to store (or null).
 */
export async function dutyAttachment(tx: Transaction, driverId: string, vehicleId: string, b: DocumentData, bookingId: string) {
  const active = await tx.get(db.collection(SHIFTS).where('driverId', '==', driverId).where('status', '==', 'Active').limit(1));
  const doc = active.docs[0];
  const s = doc?.data();
  const mode = localModeOf(b);
  if (!doc || !s || s.vehicleId !== vehicleId || s.endRequestedAt || s.verification?.status !== 'Submitted' || !mode || !servicesOf(s.services).includes(mode)) {
    // A reassignment away from a duty takes the order off it.
    return b.localShiftId ? { fields: { localShiftId: FieldValue.delete(), localShift: FieldValue.delete() } as Record<string, unknown>, verification: null, shiftId: null } : null;
  }
  return { fields: dutyFields(s, doc.id, mode, 'vendor') as Record<string, unknown>, verification: inheritedVerification(s, doc.id, bookingId, driverId), shiftId: doc.id };
}

/**
 * Periodic sweep (jobs.ts): a duty whose time is over stops taking orders and closes once its orders are finished; a duty
 * that never started is marked missed; the totals of every running duty are refreshed.
 */
export async function runLocalShiftSweep(budgetMs = 30000): Promise<{ ending: number; missed: number; refreshed: number }> {
  const started = Date.now();
  const now = Timestamp.now();
  let ending = 0, missed = 0, refreshed = 0;
  const overdue = await db.collection(SHIFTS).where('status', 'in', [...OPEN_SHIFT_STATUSES]).where('endsAt', '<=', now).limit(100).get();
  for (const d of overdue.docs) {
    if (Date.now() - started > budgetMs) break;
    const s = d.data();
    if (s.status === 'Scheduled') {
      await d.ref.update({ status: 'Missed', endedAt: FieldValue.serverTimestamp(), endedBy: 'system', updatedAt: FieldValue.serverTimestamp() });
      if (s.vendorId) await notify(dutyNotice(s, d.id, 'vendor', 'Local duty not started', `${text(s.driverName)} did not start the local duty in ${text(s.cityName)}.`, 'warning', false)).catch(() => null);
      missed++;
    } else if (!s.endRequestedAt) {
      await d.ref.update({ endRequestedAt: FieldValue.serverTimestamp(), endRequestedBy: 'system', endReason: 'Duty time over', updatedAt: FieldValue.serverTimestamp() });
      ending++;
    }
  }
  const running = await db.collection(SHIFTS).where('status', '==', 'Active').limit(200).get();
  for (const d of running.docs) {
    if (Date.now() - started > budgetMs) break;
    await refreshShiftSummary(d.id).catch((err) => console.warn('local duty refresh failed', d.id, err));
    refreshed++;
  }
  return { ending, missed, refreshed };
}
