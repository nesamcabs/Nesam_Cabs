import { parseFareScope } from './fareScope';
// Admin edits to fixed route fares (`fare_rules` records with pricingType FIXED_ROUTE). Every save is validated
// here (the editor's checks are only a convenience), refuses a stale edit, bumps the record's version and writes
// the audit entry in the same transaction. Only a fare saved here (`managed`), enabled and valid in every field is
// ever used to price a booking (see parseFixedRouteFare); a new fare changes NEW quotes only — a booking keeps the
// pricing snapshot it was quoted with.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { requirePermission, text, requireAction } from './shared';

const MAX_AMOUNT = 1_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (m: string) => new HttpsError('invalid-argument', m);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A finite, positive rupee amount at paise precision. */
function amount(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw bad(`${label} must be a number.`);
  if (v <= 0) throw bad(`${label} must be greater than zero.`);
  if (v > MAX_AMOUNT) throw bad(`${label} is too large.`);
  return Math.round(v * 100) / 100;
}

interface Values {
  brand: string; fareService: string;
  originId: string; destinationId: string; categoryId: string; serviceId: string;
  customerFare: number; partnerPayout: number; gstMode: 'included' | 'excluded'; peakAdjustment: 'apply' | 'exclude'; reverseDirection: boolean;
  status: 'Active' | 'Inactive'; priority: number; effectiveFrom: string; effectiveUntil: string; name: string;
}

/** The submitted form, checked field by field. */
function valuesOf(d: Record<string, unknown>): Values {
  const originId = str(d.originLocationId), destinationId = str(d.destinationLocationId), categoryId = str(d.vehicleCategoryId);
  if (!originId || !destinationId) throw bad('Choose both the pickup and the drop location.');
  if (originId === destinationId) throw bad('Pickup and drop must be different locations.');
  if (!categoryId) throw bad('Choose a vehicle category.');
  if (d.gstMode !== 'included' && d.gstMode !== 'excluded') throw bad('Choose whether the fare includes GST or GST is added.');
  if (d.peakAdjustment !== 'apply' && d.peakAdjustment !== 'exclude') throw bad('Choose whether peak adjustments apply to this fare.');
  if (typeof d.reverseDirection !== 'boolean') throw bad('Choose whether the fare applies to this direction only or both directions.');
  if (d.status !== 'Active' && d.status !== 'Inactive') throw bad('Choose whether the fare is enabled.');
  if (typeof d.priority !== 'number' || !Number.isInteger(d.priority) || d.priority < 1 || d.priority > 99) throw bad('Priority must be a whole number from 1 (highest) to 99.');
  const effectiveFrom = str(d.effectiveFrom), effectiveUntil = str(d.effectiveUntil);
  if ((effectiveFrom && !DATE_RE.test(effectiveFrom)) || (effectiveUntil && !DATE_RE.test(effectiveUntil))) throw bad('Enter valid dates.');
  if (effectiveFrom && effectiveUntil && effectiveUntil < effectiveFrom) throw bad('The end date is before the start date.');
  return {
    ...parseFareScope(d), originId, destinationId, categoryId, serviceId: str(d.serviceId), customerFare: amount(d.customerFare, 'Customer fare'), partnerPayout: amount(d.partnerPayout, 'Partner payout'),
    gstMode: d.gstMode, peakAdjustment: d.peakAdjustment, reverseDirection: d.reverseDirection, status: d.status, priority: d.priority, effectiveFrom, effectiveUntil, name: text(d.name, 80),
  };
}

/** The same values read back from a stored record; null when it was not saved with every field (an older route rule). */
function storedValues(d: Record<string, any>): Values | null {
  try {
    return valuesOf({
      brand: d.brand, fareService: d.fareService, originLocationId: d.originLocationId, destinationLocationId: d.destinationLocationId, vehicleCategoryId: d.vehicleCategoryId, serviceId: d.serviceId,
      customerFare: d.baseFare, partnerPayout: d.partnerPayout, gstMode: d.gstMode, peakAdjustment: d.peakAdjustment, reverseDirection: d.reverseDirection,
      status: d.status, priority: d.priority, effectiveFrom: d.effectiveFrom, effectiveUntil: d.effectiveUntil, name: d.name,
    });
  } catch {
    return null;
  }
}

/** The directed pairs a fare covers: its own direction, plus the reverse when it allows both. */
const pairs = (o: string, d: string, both: boolean): string[] => (both ? [`${o}>${d}`, `${d}>${o}`] : [`${o}>${d}`]);
const overlap = (a: { from: string; to: string }, b: { from: string; to: string }): boolean => (a.from || '0000-00-00') <= (b.to || '9999-12-31') && (b.from || '0000-00-00') <= (a.to || '9999-12-31');

/**
 * Creates (no `ruleId`) or updates a fixed route fare, or — with `action: 'status'` — enables / disables one.
 * Editing and status changes need `expectedVersion` (the version the editor loaded); a newer record is refused
 * rather than overwritten. A record saved before this tool existed has version 0.
 */
export const saveFixedRouteFare = onCall(async (request) => {
  const actor = await requirePermission(request.auth, 'pricing');
  requireAction(actor, 'Settings', 'edit');
  const input = request.data ?? {};
  const reason = text(input.reason, 300);
  if (reason.length < 5) throw bad('Give a short reason for the change.');
  const ruleId = str(input.ruleId) || null;
  const statusOnly = input.action === 'status';
  if (statusOnly && !ruleId) throw bad('Choose the fare to change.');
  if (ruleId && (typeof input.expectedVersion !== 'number' || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)) throw bad('Reload the fare before saving.');
  if (statusOnly && input.status !== 'Active' && input.status !== 'Inactive') throw bad('Choose whether the fare is enabled.');
  if (!statusOnly && (!input.data || typeof input.data !== 'object' || Array.isArray(input.data))) throw bad('The fare is missing.');
  const submitted = statusOnly ? null : valuesOf(input.data as Record<string, unknown>);

  return db.runTransaction(async (tx) => {
    const ref = ruleId ? db.doc(`fare_rules/${ruleId}`) : db.collection('fare_rules').doc();
    const cur = ruleId ? await tx.get(ref) : null;
    const before = cur?.exists ? (cur.data() as Record<string, any>) : null;
    if (ruleId && !before) throw new HttpsError('not-found', 'This fare no longer exists.');
    if (before && before.pricingType !== 'FIXED_ROUTE') throw bad('This record is not a fixed route fare.');
    const version = typeof before?.version === 'number' ? before.version : 0;
    if (ruleId && input.expectedVersion !== version) throw new HttpsError('failed-precondition', 'This fare was changed by someone else. Reload it and review it before saving.');

    // Disabling needs nothing but the record. Everything else is checked in full.
    const v: Values | null = statusOnly ? (before ? storedValues(before) : null) : submitted;
    if (statusOnly && input.status === 'Inactive') {
      tx.set(ref, { status: 'Inactive', version: version + 1, lastReason: reason, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      auditInTx(tx, {
        action: 'fixed_route_fare_status', entity: 'fixed_route_fare', entityId: ref.id, performedBy: actor.uid, performedByName: actor.name, role: 'admin',
        previous: { version, status: before!.status ?? null }, next: { version: version + 1, status: 'Inactive' }, reason,
      });
      return { id: ref.id, version: version + 1 };
    }
    if (!v) throw new HttpsError('failed-precondition', 'This route fare is missing its partner payout, GST or peak-adjustment setting. Open it with Edit and complete it first.');
    const status = statusOnly ? 'Active' : v.status;

    const [origin, dest, category, service, actives] = await Promise.all([
      tx.get(db.doc(`locations/${v.originId}`)),
      tx.get(db.doc(`locations/${v.destinationId}`)),
      tx.get(db.doc(`vehicle_categories/${v.categoryId}`)),
      v.serviceId ? tx.get(db.doc(`services/${v.serviceId}`)) : Promise.resolve(null),
      status === 'Active' ? tx.get(db.collection('fare_rules').where('pricingType', '==', 'FIXED_ROUTE').where('status', '==', 'Active')) : Promise.resolve(null),
    ]);
    if (!origin.exists) throw bad('The pickup location no longer exists.');
    if (!dest.exists) throw bad('The drop location no longer exists.');
    if (!category.exists) throw bad('The vehicle category no longer exists.');
    if (service && !service.exists) throw bad('The service no longer exists.');
    if (status === 'Active') {
      if (origin.data()!.status !== 'Active' || dest.data()!.status !== 'Active') throw bad('Both locations must be active to enable this fare.');
      if (category.data()!.status !== 'Active') throw bad('The vehicle category must be active to enable this fare.');
      if (service && service.data()!.status !== 'Active') throw bad('The service must be active to enable this fare.');
      const mine = pairs(v.originId, v.destinationId, v.reverseDirection);
      const clash = actives?.docs.find((r) => {
        const o = r.data();
        return r.id !== ref.id && (o.brand ?? '') === v.brand && (o.fareService ?? '') === v.fareService && o.vehicleCategoryId === v.categoryId && str(o.serviceId) === v.serviceId && (o.priority ?? 1) === v.priority
          && pairs(str(o.originLocationId), str(o.destinationLocationId), o.reverseDirection === true).some((p) => mine.includes(p))
          && overlap({ from: v.effectiveFrom, to: v.effectiveUntil }, { from: str(o.effectiveFrom), to: str(o.effectiveUntil) });
      });
      if (clash) throw bad(`An enabled fare ("${text(clash.data().name, 80)}") already covers this route, category, dates and priority. Change the priority or dates, or disable one.`);
    }

    const originName = text(origin.data()!.name, 120), destName = text(dest.data()!.name, 120), categoryName = text(category.data()!.name, 120);
    const sameScope = !!before && before.originLocationId === v.originId && before.destinationLocationId === v.destinationId && before.vehicleCategoryId === v.categoryId;
    const name = v.name || (sameScope && str(before!.name)) || `${originName} → ${destName} · ${categoryName}`;
    const next = {
      brand: v.brand, fareService: v.fareService, name, serviceId: service ? service.id : '', serviceName: service ? text(service.data()!.name, 120) : '',
      vehicleCategoryId: v.categoryId, vehicleCategoryName: categoryName, pricingType: 'FIXED_ROUTE',
      originLocationId: v.originId, originLocationName: originName, destinationLocationId: v.destinationId, destinationLocationName: destName,
      baseFare: v.customerFare, partnerPayout: v.partnerPayout, gstMode: v.gstMode, peakAdjustment: v.peakAdjustment, reverseDirection: v.reverseDirection,
      priority: v.priority, status, effectiveFrom: v.effectiveFrom, effectiveUntil: v.effectiveUntil,
      managed: true, version: version + 1, lastReason: reason, updatedBy: actor.uid, updatedByName: actor.name, updatedAt: FieldValue.serverTimestamp(),
    };
    if (before) {
      // Only the fields this tool owns change; whatever else the record holds is left as it is.
      tx.set(ref, next, { merge: true });
    } else {
      // A new record also carries the fields the older fare-rule screens read, set to "none" rather than invented.
      tx.set(ref, {
        ...next, id: ref.id, code: '', baseKm: 0, perKmRate: 0, minimumKmPerDay: 0, minimumFare: 0, includedHours: 0, extraKmRate: 0, extraHourRate: 0, driverBatta: 0,
        nightChargeEnabled: false, nightStartTime: '', nightEndTime: '', nightChargeType: 'Percentage', nightChargeValue: 0, freeWaitingMinutes: 0, waitingChargePerHour: 0,
        tollMode: 'Excluded', fixedTollAmount: 0, parkingMode: 'Excluded', fixedParkingAmount: 0, permitCharge: 0, createdBy: actor.uid, createdAt: FieldValue.serverTimestamp(),
      });
    }
    auditInTx(tx, {
      action: before ? (statusOnly ? 'fixed_route_fare_status' : 'fixed_route_fare_updated') : 'fixed_route_fare_created', entity: 'fixed_route_fare', entityId: ref.id,
      performedBy: actor.uid, performedByName: actor.name, role: 'admin',
      previous: before ? { version, status: before.status ?? null, customerFare: before.baseFare ?? null, partnerPayout: before.partnerPayout ?? null } : null,
      next: { version: version + 1, status, customerFare: v.customerFare, partnerPayout: v.partnerPayout, gstMode: v.gstMode, peakAdjustment: v.peakAdjustment, reverseDirection: v.reverseDirection, route: `${originName} → ${destName}`, category: categoryName },
      reason,
    });
    return { id: ref.id, version: version + 1 };
  });
});
