// Local Taxi admin functions: service zones, versioned fares, the fare simulator and driver eligibility.
// Every change is validated here, written in a transaction with its audit entry (who, when, old and new values), and
// takes effect only for NEW quotes. Rides already booked keep the zone and fare snapshot they were booked with.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../admin';
import { auditInTx } from '../audit';
import { requirePermission } from '../shared';
import { FareConfigError, calculateFare, validateFareConfig } from './fare';
import { GeometryError, bboxOf, geometriesOverlap, validateGeometry } from './geo';
import { COL, actorName, boundaryOfDoc, cleanId, dispatchOf, fareId, headId, str, validTimeZone, zoneOf } from './model';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function assertNoOverlap(zoneId: string, boundary: ReturnType<typeof validateGeometry>) {
  const others = await db.collection(COL.zones).where('status', 'in', ['draft', 'active']).get();
  for (const d of others.docs) {
    const other = boundaryOfDoc(d.data());
    if (d.id === zoneId || !other) continue;
    if (geometriesOverlap(boundary, other)) throw new HttpsError('failed-precondition', `This boundary overlaps the zone “${str(d.data().name)}”. Zones may not overlap or touch.`);
  }
}

async function assertCategories(ids: string[]) {
  if (ids.length > 20) throw new HttpsError('invalid-argument', 'Too many vehicle categories.');
  const docs = await Promise.all(ids.map((id) => db.doc(`vehicle_categories/${id}`).get()));
  const missing = ids.filter((_, i) => !docs[i]!.exists);
  if (missing.length) throw new HttpsError('invalid-argument', `Unknown vehicle category: ${missing.join(', ')}.`);
}

/** Create or edit a zone. A boundary change on a live zone bumps boundaryVersion and keeps the old one in /versions. */
export const ltSaveZone = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'pricing');
  const d = (request.data ?? {}) as Record<string, any>;
  const name = str(d.name, 80);
  if (name.length < 2) throw new HttpsError('invalid-argument', 'Enter the zone name.');
  const timezone = str(d.timezone, 60) || 'Asia/Kolkata';
  if (!validTimeZone(timezone)) throw new HttpsError('invalid-argument', 'Time zone is not recognised.');
  const categoryIds: string[] = Array.isArray(d.categoryIds) ? [...new Set<string>(d.categoryIds.map((x: unknown) => cleanId(x, 'vehicle category')))] : [];
  await assertCategories(categoryIds);
  const dispatch = dispatchOf(d.dispatch);
  let boundary: ReturnType<typeof validateGeometry> | null = null;
  if (d.boundary !== undefined && d.boundary !== null) {
    try { boundary = validateGeometry(d.boundary); } catch (e) { throw new HttpsError('invalid-argument', e instanceof GeometryError ? e.message : 'The boundary is not valid.'); }
  }
  const zoneId = d.zoneId ? cleanId(d.zoneId, 'zone') : slug(name) || `zone-${Date.now().toString(36)}`;
  if (boundary) await assertNoOverlap(zoneId, boundary);
  const ref = db.doc(`${COL.zones}/${zoneId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.exists ? snap.data()! : null;
    // A zone id that does not exist yet creates the zone with that id (always as a draft, possibly without a boundary).
    const keepBoundary = boundary ?? (d.boundary === null ? null : boundaryOfDoc(before ?? undefined));
    const boundaryChanged = JSON.stringify(keepBoundary) !== JSON.stringify(boundaryOfDoc(before ?? undefined));
    const status = before?.status ?? 'draft';
    if (status === 'active' && !keepBoundary) throw new HttpsError('failed-precondition', 'An active zone must keep a boundary. Deactivate it first.');
    const boundaryVersion = Number(before?.boundaryVersion ?? 0) + (boundaryChanged && keepBoundary ? 1 : 0);
    const policy = { categoryIds, cashEnabled: d.cashEnabled === true, dispatch, timezone };
    const policyChanged = JSON.stringify(policy) !== JSON.stringify({ categoryIds: before?.categoryIds ?? [], cashEnabled: before?.cashEnabled === true, dispatch: before?.dispatch ?? dispatch, timezone: before?.timezone ?? timezone });
    const policyVersion = Number(before?.policyVersion ?? 0) + (policyChanged || !before ? 1 : 0);
    const next = {
      name, timezone, categoryIds, cashEnabled: policy.cashEnabled, dispatch, boundaryJson: keepBoundary ? JSON.stringify(keepBoundary) : '', boundaryVersion, policyVersion,
      bbox: keepBoundary ? bboxOf(keepBoundary) : null, status, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid,
      ...(before ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: admin.uid }),
    };
    tx.set(ref, next, { merge: true });
    if (boundaryChanged && keepBoundary) tx.set(ref.collection('versions').doc(String(boundaryVersion)), { boundaryJson: JSON.stringify(keepBoundary), boundaryVersion, at: FieldValue.serverTimestamp(), by: admin.uid, byName: actorName(admin) });
    auditInTx(tx, {
      action: before ? 'lt_zone_updated' : 'lt_zone_created', entity: 'lt_zone', entityId: zoneId, performedBy: admin.uid, performedByName: actorName(admin), role: 'admin',
      previous: before ? { name: before.name, status: before.status, boundaryVersion: before.boundaryVersion, policyVersion: before.policyVersion, categoryIds: before.categoryIds, cashEnabled: before.cashEnabled, dispatch: before.dispatch } : null,
      next: { name, status, boundaryVersion, policyVersion, categoryIds, cashEnabled: policy.cashEnabled, dispatch, boundaryChanged }, reason: str(d.reason, 300),
    });
    return { zoneId, status, boundaryVersion, policyVersion };
  });
});

/** draft/inactive → active needs a valid, non-overlapping boundary and at least one category with an active fare. */
export const ltSetZoneStatus = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'pricing');
  const zoneId = cleanId(request.data?.zoneId, 'zone');
  const to = request.data?.status;
  if (to !== 'active' && to !== 'inactive') throw new HttpsError('invalid-argument', 'Status must be active or inactive.');
  const ref = db.doc(`${COL.zones}/${zoneId}`);
  const pre = await ref.get();
  if (!pre.exists) throw new HttpsError('not-found', 'That zone does not exist.');
  const z = zoneOf(zoneId, pre.data()!);
  if (to === 'active') {
    if (!z.boundary) throw new HttpsError('failed-precondition', 'Draw the zone boundary before activating it.');
    try { validateGeometry(z.boundary); } catch (e) { throw new HttpsError('failed-precondition', e instanceof GeometryError ? e.message : 'The boundary is not valid.'); }
    await assertNoOverlap(zoneId, z.boundary);
    if (!z.categoryIds.length) throw new HttpsError('failed-precondition', 'Choose at least one vehicle category for this zone.');
    const heads = await Promise.all(z.categoryIds.map((c) => db.doc(`${COL.fareHeads}/${headId(zoneId, c)}`).get()));
    if (!heads.some((h) => h.exists && h.data()!.activeFareId)) throw new HttpsError('failed-precondition', 'Activate a fare for at least one vehicle category first.');
  }
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const before = snap.data()!;
    if (before.status === to) return { zoneId, status: to };
    tx.update(ref, { status: to, updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid, ...(to === 'active' ? { activatedAt: FieldValue.serverTimestamp() } : {}) });
    auditInTx(tx, { action: to === 'active' ? 'lt_zone_activated' : 'lt_zone_deactivated', entity: 'lt_zone', entityId: zoneId, performedBy: admin.uid, performedByName: actorName(admin), role: 'admin', previous: { status: before.status }, next: { status: to }, reason: str(request.data?.reason, 300) });
    return { zoneId, status: to };
  });
});

const fareProblem = (e: unknown): never => {
  if (e instanceof FareConfigError) throw new HttpsError('invalid-argument', e.problems.join(' '), { problems: e.problems });
  throw e;
};

/** Saves a DRAFT fare version for a zone + category (nothing is live until ltActivateFare). Editing a draft keeps its version. */
export const ltSaveFare = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'pricing');
  const d = (request.data ?? {}) as Record<string, any>;
  const zoneId = cleanId(d.zoneId, 'zone');
  const categoryId = cleanId(d.categoryId, 'vehicle category');
  let config;
  try { config = validateFareConfig(d.config); } catch (e) { return fareProblem(e); }
  const zone = await db.doc(`${COL.zones}/${zoneId}`).get();
  if (!zone.exists) throw new HttpsError('not-found', 'That zone does not exist.');
  if (!(zone.data()!.categoryIds ?? []).includes(categoryId)) throw new HttpsError('failed-precondition', 'This vehicle category is not enabled for the zone.');
  const headRef = db.doc(`${COL.fareHeads}/${headId(zoneId, categoryId)}`);
  const sample = d.sample === true;
  return db.runTransaction(async (tx) => {
    const head = await tx.get(headRef);
    const h = head.data() ?? {};
    let version: number;
    let previous: unknown = null;
    if (typeof d.fareId === 'string' && d.fareId) {
      const existing = await tx.get(db.doc(`${COL.fares}/${cleanId(d.fareId, 'fare')}`));
      if (!existing.exists || existing.data()!.zoneId !== zoneId || existing.data()!.categoryId !== categoryId) throw new HttpsError('not-found', 'That fare version does not exist.');
      if (existing.data()!.status !== 'draft') throw new HttpsError('failed-precondition', 'Only a draft can be edited. Save a new version instead.');
      version = Number(existing.data()!.version);
      previous = existing.data()!.config;
    } else version = Number(h.latestVersion ?? 0) + 1;
    const id = fareId(zoneId, categoryId, version);
    tx.set(db.doc(`${COL.fares}/${id}`), {
      zoneId, categoryId, version, status: 'draft', config, sample, note: str(d.note, 300), updatedAt: FieldValue.serverTimestamp(), updatedBy: admin.uid,
      ...(previous ? {} : { createdAt: FieldValue.serverTimestamp(), createdBy: admin.uid }),
    }, { merge: true });
    tx.set(headRef, { zoneId, categoryId, latestVersion: Math.max(version, Number(h.latestVersion ?? 0)) }, { merge: true });
    auditInTx(tx, { action: 'lt_fare_saved', entity: 'lt_fare', entityId: id, performedBy: admin.uid, performedByName: actorName(admin), role: 'admin', previous, next: { ...config, sample }, reason: str(d.note, 300) });
    return { fareId: id, version, status: 'draft' };
  });
});

const SAMPLE_BLOCKED = 'This is a development sample, not an approved business rate. It can only be activated in the emulator or when LT_ALLOW_SAMPLE_FARES is set.';

/** Makes a draft the live fare (now) or schedules it. The previous active version is retired in the same transaction. */
export const ltActivateFare = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'pricing');
  const id = cleanId(request.data?.fareId, 'fare');
  const now = Date.now();
  const when = typeof request.data?.effectiveFromMs === 'number' ? Math.round(request.data.effectiveFromMs) : now;
  if (when > now + 90 * 86400000) throw new HttpsError('invalid-argument', 'A fare can be scheduled at most 90 days ahead.');
  if (when < now - 60000) throw new HttpsError('invalid-argument', 'The effective time cannot be in the past.');
  const immediate = when <= now + 1000;
  return db.runTransaction(async (tx) => {
    const ref = db.doc(`${COL.fares}/${id}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'That fare version does not exist.');
    const f = snap.data()!;
    if (!['draft', 'scheduled'].includes(f.status)) throw new HttpsError('failed-precondition', 'Only a draft or scheduled fare can be activated.');
    if (f.sample === true && process.env.FUNCTIONS_EMULATOR !== 'true' && process.env.LT_ALLOW_SAMPLE_FARES !== 'true') throw new HttpsError('failed-precondition', SAMPLE_BLOCKED);
    try { validateFareConfig(f.config); } catch (e) { return fareProblem(e); }
    const headRef = db.doc(`${COL.fareHeads}/${headId(f.zoneId, f.categoryId)}`);
    const head = await tx.get(headRef);
    const h = head.data() ?? {};
    const oldActive = typeof h.activeFareId === 'string' && h.activeFareId && h.activeFareId !== id ? h.activeFareId : '';
    const oldScheduled = typeof h.scheduledFareId === 'string' && h.scheduledFareId && h.scheduledFareId !== id ? h.scheduledFareId : '';
    const [a, s] = await Promise.all([oldActive ? tx.get(db.doc(`${COL.fares}/${oldActive}`)) : null, oldScheduled ? tx.get(db.doc(`${COL.fares}/${oldScheduled}`)) : null]);
    if (immediate) {
      if (a?.exists) tx.update(a.ref, { status: 'retired', retiredAt: FieldValue.serverTimestamp() });
      if (s?.exists) tx.update(s.ref, { status: 'draft' });
      tx.update(ref, { status: 'active', effectiveFromMs: now, activatedAt: FieldValue.serverTimestamp(), activatedBy: admin.uid });
      tx.set(headRef, { activeFareId: id, scheduledFareId: '', activeVersion: f.version }, { merge: true });
    } else {
      if (s?.exists) tx.update(s.ref, { status: 'draft' });
      tx.update(ref, { status: 'scheduled', effectiveFromMs: when, activatedAt: FieldValue.serverTimestamp(), activatedBy: admin.uid });
      tx.set(headRef, { scheduledFareId: id }, { merge: true });
    }
    auditInTx(tx, { action: immediate ? 'lt_fare_activated' : 'lt_fare_scheduled', entity: 'lt_fare', entityId: id, performedBy: admin.uid, performedByName: actorName(admin), role: 'admin', previous: { activeFareId: oldActive || null }, next: { fareId: id, version: f.version, effectiveFromMs: immediate ? now : when } });
    return { fareId: id, status: immediate ? 'active' : 'scheduled', effectiveFromMs: immediate ? now : when };
  });
});

/** Promotes scheduled fares that have come due. Called by the sweep; safe to run repeatedly. */
export async function promoteDueFares(nowMs: number): Promise<number> {
  const heads = await db.collection(COL.fareHeads).where('scheduledFareId', '!=', '').limit(50).get();
  let promoted = 0;
  for (const h of heads.docs) {
    const sid = String(h.data().scheduledFareId ?? '');
    if (!sid) continue;
    await db.runTransaction(async (tx) => {
      const [hs, fs] = await Promise.all([tx.get(h.ref), tx.get(db.doc(`${COL.fares}/${sid}`))]);
      const head = hs.data() ?? {};
      if (head.scheduledFareId !== sid || !fs.exists || fs.data()!.status !== 'scheduled' || Number(fs.data()!.effectiveFromMs) > nowMs) return;
      const old = typeof head.activeFareId === 'string' && head.activeFareId ? await tx.get(db.doc(`${COL.fares}/${head.activeFareId}`)) : null;
      if (old?.exists) tx.update(old.ref, { status: 'retired', retiredAt: FieldValue.serverTimestamp() });
      tx.update(fs.ref, { status: 'active' });
      tx.set(h.ref, { activeFareId: sid, scheduledFareId: '', activeVersion: fs.data()!.version }, { merge: true });
      promoted++;
    });
  }
  return promoted;
}

/** The admin fare simulator: prices a trip with a fare configuration (typed in, or a saved version) and writes nothing. */
export const ltSimulateFare = onCall(async (request) => {
  await requirePermission(request.auth, 'pricing');
  const d = (request.data ?? {}) as Record<string, any>;
  let raw = d.config;
  let timeZone = str(d.timezone, 60) || 'Asia/Kolkata';
  if (!raw && typeof d.fareId === 'string') {
    const f = await db.doc(`${COL.fares}/${cleanId(d.fareId, 'fare')}`).get();
    if (!f.exists) throw new HttpsError('not-found', 'That fare version does not exist.');
    raw = f.data()!.config;
    const z = await db.doc(`${COL.zones}/${f.data()!.zoneId}`).get();
    if (z.exists) timeZone = str(z.data()!.timezone, 60) || timeZone;
  }
  let config;
  try { config = validateFareConfig(raw); } catch (e) { return fareProblem(e); }
  if (!validTimeZone(timeZone)) throw new HttpsError('invalid-argument', 'Time zone is not recognised.');
  const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : 0);
  const atMs = typeof d.atMs === 'number' && Number.isFinite(d.atMs) ? Math.round(d.atMs) : Date.now();
  return calculateFare(config, { distanceMeters: num(d.distanceMeters, 200000), rideSeconds: num(d.rideSeconds, 86400), waitingSeconds: num(d.waitingSeconds, 7200), includePickup: d.includePickup !== false }, atMs, timeZone);
});

/**
 * Sets which zones and vehicle categories a driver may serve in Local Taxi. A driver can only go online for a
 * zone + category an admin has enabled here, and only while approved.
 */
export const ltSetDriverEligibility = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'people');
  const d = (request.data ?? {}) as Record<string, any>;
  const driverId = cleanId(d.driverId, 'driver');
  const zoneIds: string[] = [...new Set<string>((Array.isArray(d.zoneIds) ? d.zoneIds : []).map((x: unknown) => cleanId(x, 'zone')))].slice(0, 10);
  const categoryIds: string[] = [...new Set<string>((Array.isArray(d.categoryIds) ? d.categoryIds : []).map((x: unknown) => cleanId(x, 'vehicle category')))].slice(0, 10);
  const [driver, zones] = await Promise.all([db.doc(`drivers/${driverId}`).get(), Promise.all(zoneIds.map((z) => db.doc(`${COL.zones}/${z}`).get()))]);
  if (!driver.exists) throw new HttpsError('not-found', 'That driver does not exist.');
  if (zones.some((z) => !z.exists)) throw new HttpsError('invalid-argument', 'One of the zones does not exist.');
  const ref = db.doc(`${COL.driverState}/${driverId}`);
  return db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const before = cur.data() ?? {};
    const lose = !zoneIds.length || !categoryIds.length;
    tx.set(ref, { zoneIds, categoryIds, driverName: str(driver.data()!.name, 80), ...(lose ? { online: false, available: false } : {}), updatedAt: FieldValue.serverTimestamp(), eligibilityBy: admin.uid, ...(cur.exists ? {} : { online: false, available: false, activeRideId: null, location: null }) }, { merge: true });
    auditInTx(tx, { action: 'lt_driver_eligibility_set', entity: 'lt_driver', entityId: driverId, performedBy: admin.uid, performedByName: actorName(admin), role: 'admin', previous: { zoneIds: before.zoneIds ?? [], categoryIds: before.categoryIds ?? [] }, next: { zoneIds, categoryIds } });
    return { driverId, zoneIds, categoryIds };
  });
});
