// Admin fulfilment actions for an approved booking. Approval alone never reaches
// partners; an admin deliberately chooses ONE route:
//   postBookingToMarketplace  publish the approved booking to Open Duties
//   assignVendor              reserve it to an approved Vendor (driver/vehicle follow)
//   assignDriver              (bookingOps.ts) assign an approved Owner Driver + vehicle
// All three decide a partner's payout, so they run on the server (firestore.rules
// deny client writes to payouts, commission and offers).
//
// Plus: award a vendor's counter-bid and the marketplace "assign independent
// driver" shortcut.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp, Transaction } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { mapCategory } from './domain/pricing';
import { awaitingFulfilment } from './domain/advanceBooking';
import { COMMISSION_NOT_CONFIGURED, CommissionPolicy, partnerPayoutFor, resolveCommission } from './domain/finance';
import { formatDateTime12, pickupInstant } from './domain/time';
import { loadCommissionPolicy } from './commission';
import { assertDriverEligible, assertScheduleFree, assertVehicleEligible, bookingDutyClass, loadHeldDuties, loadScheduleConfig } from './eligibility';
import { CLASS_MATRIX, DutyClass, VEHICLE_CLASSES } from './domain/eligibility';
import { releaseConfigOf } from './release';
import { notify, notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { sendCustomerMessage } from './customerComms';
import { AdminAccess } from './permissions';
import { loadPrivatePricing, withPrivatePricing } from './pricingPrivate';
import { approved, requirePermission, text, requireDuty, requireAction } from './shared';

export const docId = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return v;
};
export const money = (v: unknown): number => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const code = (b: DocumentData, id: string) => text(b.bookingId) || id;

/** Marketplace record status for a booking that exists only as an internal draft. */
export const UNPUBLISHED = 'Unpublished';

// ── Payout ────────────────────────────────────────────────────────────────

export interface Payout {
  amount: number;
  source: 'offered' | 'manual' | 'tariff';
  commission: DocumentData | null;
}

/**
 * The partner payout an admin action will agree: the commission policy's offer
 * (the commission the booking was created under, else the current policy), or a
 * payout set by hand — which needs finance access and stays within the fare.
 */
export function resolvePayout(b: DocumentData, policy: CommissionPolicy | null, manual: unknown, admin: AdminAccess, purpose: 'direct' | 'offer' = 'direct'): Payout {
  const fareTotal = money(b.fare);
  if (manual != null) {
    if (!admin.permissions.includes('finance')) throw new HttpsError('permission-denied', 'Setting a payout by hand needs finance access. Leave it blank to use the commission policy.');
    if (typeof manual !== 'number' || !Number.isSafeInteger(manual) || manual <= 0) throw new HttpsError('invalid-argument', 'Enter the payout in whole rupees.');
    if (manual > fareTotal) throw new HttpsError('failed-precondition', 'The payout must be within the customer fare.');
    return { amount: manual, source: 'manual', commission: null };
  }
  // Confirmed-tariff duties carry a fixed normal partner rate on the booking; the percentage
  // commission is never applied on top of it. Published to the marketplace, the same amount is only
  // the START offer: whatever a partner then accepts (or an awarded bid) replaces it.
  const normal = b.pricing && typeof b.pricing === 'object' && b.pricing.partner && b.pricing.partner.mode === 'NORMAL_RATE' ? b.pricing.partner : null;
  if (normal && Number.isFinite(normal.basePaise) && normal.basePaise > 0) {
    return { amount: Math.round(normal.basePaise) / 100, source: purpose === 'offer' ? 'offered' : 'tariff', commission: null };
  }
  const fb = b.fareBreakdown && typeof b.fareBreakdown === 'object' ? b.fareBreakdown : null;
  const taxableAmount = fb && Number.isFinite(fb.taxableAmount) ? fb.taxableAmount : Math.round((fareTotal / 1.05) * 100) / 100;
  const stored = b.commission && typeof b.commission.rate === 'number' ? b.commission : null;
  const commission = stored ?? resolveCommission(policy, { serviceId: text(b.serviceId), categoryId: text(b.vehicleCategoryId) });
  if (!commission) throw new HttpsError('failed-precondition', COMMISSION_NOT_CONFIGURED);
  return { amount: partnerPayoutFor({ taxableAmount, total: fareTotal }, commission), source: 'offered', commission: stored ? null : commission };
}

/** Payout already agreed on a booking (a vendor's accepted bid, a manual payout …); 0 when none. */
export const agreedPayoutOf = (b: DocumentData) => money(b.driverPayout) || money(b.vendorPayout);

// ── Vehicle checks ────────────────────────────────────────────────────────

/**
 * A vehicle a trip may be assigned to: exists, owned by `ownerVendorId`
 * ('' for NESAM-owned / independent), documents approved and in service, with
 * enough passenger seats for the booked category and documents that stay valid
 * through the pickup. Schedule overlap is checked by the caller.
 */
export async function assignableVehicle(tx: Transaction, vehicleId: string, ownerVendorId: string, driverId?: string, booking?: DocumentData) {
  const snap = await tx.get(db.doc(`vehicles/${vehicleId}`));
  const v = snap.data();
  const label = text(v?.vehicleNumber) || 'The vehicle';
  if (!snap.exists || !v) throw new HttpsError('failed-precondition', 'The selected vehicle no longer exists.');
  if ((v.vendorId || '') !== ownerVendorId) throw new HttpsError('failed-precondition', 'The selected vehicle does not belong to this partner.');
  if (v.docStatus !== 'Approved') throw new HttpsError('failed-precondition', `${label} is not approved yet.`);
  if (['Inactive', 'Maintenance', 'Accident Hold'].includes(v.status)) throw new HttpsError('failed-precondition', `${label} is not in service.`);
  if (driverId && v.assignedDriverId && v.assignedDriverId !== driverId) throw new HttpsError('failed-precondition', `${label} is paired with another driver.`);
  if (booking) assertVehicleEligible(v, vehicleId, booking, await loadScheduleConfig(tx));
  return { id: snap.id, number: text(v.vehicleNumber, 20), seats: Math.round(money(v.seatingCapacity)), data: v };
}

/** Vehicle classes that may serve a duty class (the inverse of the matrix). Empty = unclassified → no class filter. */
export function eligibleClassesFor(duty: DutyClass | null): string[] {
  return duty ? VEHICLE_CLASSES.filter((v) => CLASS_MATRIX[v].includes(duty)) : [];
}

/** Offer escalation settings from an admin post: ceiling is required and must exceed the start offer. */
function escalationOf(v: any, start: number, fare: number) {
  if (!v || v.enabled !== true) return null;
  const ceiling = money(v.ceiling);
  if (!(ceiling > start)) throw new HttpsError('invalid-argument', 'Set an escalation ceiling above the starting offer.');
  if (ceiling > fare) throw new HttpsError('invalid-argument', 'The escalation ceiling cannot exceed the customer fare.');
  const stepPercent = typeof v.stepPercent === 'number' && v.stepPercent > 0 && v.stepPercent <= 50 ? v.stepPercent : 5;
  const intervalMinutes = typeof v.intervalMinutes === 'number' && v.intervalMinutes >= 5 && v.intervalMinutes <= 1440 ? Math.round(v.intervalMinutes) : 60;
  return { enabled: true, ceilingPaise: Math.round(ceiling * 100), stepPercent, intervalMinutes, step: 0 };
}

/**
 * Agreed expense & extra-km terms published with a duty (Master Admin "Publish duty"). Frozen on
 * the offer and the booking when published; a partner accepts the duty on these terms.
 */
const TERM_KEYS = ['driverBata', 'toll', 'parking', 'stateTax', 'nightAllowance'] as const;
const TERM_VALUES = ['Included', 'At actuals', 'Not applicable'];
export function dutyTermsOf(v: any): DocumentData | null {
  if (!v || typeof v !== 'object') return null;
  const customerExtraKm = money(v.customerExtraKm);
  const partnerExtraKm = money(v.partnerExtraKm);
  if (!(customerExtraKm > 0) || !(partnerExtraKm > 0)) throw new HttpsError('invalid-argument', 'Enter separate positive customer and partner extra-km rates.');
  if (customerExtraKm > 1000 || partnerExtraKm > 1000) throw new HttpsError('invalid-argument', 'Extra-km rates look too high. Check the ₹ / km values.');
  const items: Record<string, string> = {};
  for (const k of TERM_KEYS) items[k] = TERM_VALUES.includes(v.items?.[k]) ? v.items[k] : 'At actuals';
  return { customerExtraKm, partnerExtraKm, items, receiptRequired: v.receiptRequired !== false };
}

// ── Publish to the marketplace ────────────────────────────────────────────

/** Tell eligible approved partners a published trip is available. Best effort, de-duplicated. */
export type Audience = 'all' | 'topOwners' | 'otherOwners' | 'vendors';

export async function announceToPartners(bookingId: string, b: DocumentData, offer: DocumentData, audience: Audience = 'all', topRatedMin = 4.5): Promise<number> {
  const aliases: string[] = Array.isArray(offer.eligibleVehicleTypes) ? offer.eligibleVehicleTypes : [];
  const [drivers, vendors] = await Promise.all([
    db.collection('drivers').where('status', '==', 'Approved').where('presenceStatus', '==', 'Online').limit(300).get(),
    db.collection('vendors').where('status', 'in', ['APPROVED', 'Approved', 'Active']).limit(200).get(),
  ]);
  const when = pickupInstant(b);
  const base = {
    category: 'bookings' as const, severity: 'info' as const, sound: 'new_booking' as const, push: true,
    title: 'New trip available',
    message: `${text(b.pickup)} → ${text(b.drop)}${when ? ` · ${formatDateTime12(when)}` : ''} · ${text(b.vehicleCategory)}${b.fuelType === 'cng' ? ' (CNG)' : ''} · payout ₹${money(offer.offeredPayout).toLocaleString('en-IN')}`,
    bookingId, bookingCode: code(b, bookingId), cta: { label: 'View trip', page: 'marketplace', bookingId },
  };
  const targets: { id: string; type: 'driver' | 'vendor' }[] = [
    ...(audience === 'vendors' ? [] : drivers.docs
      .filter((d) => !d.data().vendorId && d.data().fleetStatus !== 'Suspended'
        && (!aliases.length || aliases.includes(String(d.data().vehicleType ?? '').trim().toLowerCase())))
      .filter((d) => {
        const top = typeof d.data().rating === 'number' && d.data().rating >= topRatedMin;
        return audience === 'all' || (audience === 'topOwners' ? top : !top);
      })
      .map((d) => ({ id: d.id, type: 'driver' as const }))),
    ...(audience === 'all' || audience === 'vendors' ? vendors.docs.map((v) => ({ id: v.id, type: 'vendor' as const })) : []),
  ];
  let sent = 0;
  for (let i = 0; i < targets.length; i += 25) {
    await Promise.all(targets.slice(i, i + 25).map(async (t) => {
      const id = await notify({ ...base, recipientId: t.id, recipientType: t.type, dedupeKey: `trip_available_${bookingId}_${t.id}` }).catch(() => null);
      if (id) sent++;
    }));
  }
  return sent;
}

/**
 * Explicitly publishes an approved, unassigned booking to Open Duties. This is
 * the only step that makes a booking visible to partners. Idempotent: posting a
 * booking that is already open just refreshes the offer. The offer comes from the
 * commission policy; a finance admin may set a specific payout instead.
 */
export const postBookingToMarketplace = onCall({ timeoutSeconds: 120 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireDuty(admin, 'publish');
  requireAction(admin, 'Bookings', 'approve');
  const value = text(request.data?.booking, 128);
  if (!value) throw new HttpsError('invalid-argument', 'Enter the booking code or ID.');
  const manual = request.data?.payout ?? null;
  // One explicit posting mode per duty: partners either ACCEPT the current offer, or submit bids
  // that Admin reviews. The two paths never compete on the same post.
  const mode = request.data?.mode === 'bid_review' ? 'bid_review' : 'accept_offer';
  const esc = request.data?.escalation && typeof request.data.escalation === 'object' ? request.data.escalation : null;
  const cutoffMinutes = typeof request.data?.cutoffMinutes === 'number' && request.data.cutoffMinutes >= 0 && request.data.cutoffMinutes <= 10080 ? Math.round(request.data.cutoffMinutes) : 0;
  const terms = dutyTermsOf(request.data?.terms);
  const note = text(request.data?.note, 300);
  const byCode = await db.collection('bookings').where('bookingId', '==', value).get();
  if (byCode.size > 1) throw new HttpsError('failed-precondition', 'Duplicate booking code. Use the document ID.');
  const bookingId = byCode.empty ? docId(value, 'booking') : byCode.docs[0].id;
  const ref = db.doc(`bookings/${bookingId}`);
  const market = db.doc(`marketplace_trips/${bookingId}`);
  const result = await db.runTransaction(async (tx) => {
    const [snap, prior, policy, privatePricing] = await Promise.all([tx.get(ref), tx.get(market), loadCommissionPolicy(tx), loadPrivatePricing(tx, bookingId)]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (b.status === 'Pending') throw new HttpsError('failed-precondition', 'Approve the booking before publishing it.');
    if (!awaitingFulfilment(b)) throw new HttpsError('failed-precondition', 'Only an approved booking that has no vendor or driver yet can be published.');
    const priorStatus = prior.exists ? String(prior.data()!.status) : '';
    if (prior.exists && priorStatus === 'Assigned') throw new HttpsError('failed-precondition', 'This marketplace trip is already in progress.');
    // Re-posting an open duty changes its payout or mode.
    if (priorStatus === 'Open' || priorStatus === 'Bidding') requireDuty(admin, 'payout');
    if (b.fareVerified !== true) throw new HttpsError('failed-precondition', 'Verify the fare first (Booking Details → Verify / set fare).');
    const categoryDoc = text(b.vehicleCategoryId) ? await tx.get(db.doc(`vehicle_categories/${text(b.vehicleCategoryId)}`)) : null;
    const category = categoryDoc?.exists ? mapCategory(categoryDoc.id, categoryDoc.data()!) : null;
    const payout = resolvePayout(withPrivatePricing(b, privatePricing), policy, manual, admin, 'offer');
    const stamp = FieldValue.serverTimestamp();
    const pickupAt = pickupInstant(b);
    const offer = {
      id: bookingId, bookingId: code(b, bookingId), route: `${text(b.pickup)} → ${text(b.drop)}`,
      // Area only, approximate coordinates: the exact address is shared once the trip is theirs.
      pickup: { address: text(b.pickup), city: text(b.pickup), time: text(b.time), ...(Number.isFinite(b.pickupLat) ? { lat: Math.round(b.pickupLat * 100) / 100, lng: Math.round(b.pickupLng * 100) / 100 } : {}) },
      drop: { address: text(b.drop), city: text(b.drop), ...(Number.isFinite(b.dropLat) ? { lat: Math.round(b.dropLat * 100) / 100, lng: Math.round(b.dropLng * 100) / 100 } : {}) },
      travelDate: text(b.date), service: text(b.service), tripType: text(b.tripType),
      vehicleCategory: text(b.vehicleCategory) || text(b.vehicle), vehicleCategoryId: text(b.vehicleCategoryId),
      // Lower-case aliases an older claim compared a vehicle type against; the vehicle classes are authoritative.
      eligibleVehicleTypes: category?.matchVehicleTypes ?? [],
      dutyClass: bookingDutyClass(b) ?? '', eligibleVehicleClasses: eligibleClassesFor(bookingDutyClass(b)),
      mode, ...(escalationOf(esc, payout.amount, money(b.fare)) ? { escalation: escalationOf(esc, payout.amount, money(b.fare)) } : {}),
      ...(esc && money(esc.ceiling) > 0 ? { ceiling: money(esc.ceiling) } : {}), startOffer: payout.amount,
      ...(cutoffMinutes && pickupAt ? { cutoffAt: Timestamp.fromMillis(pickupAt.getTime() - cutoffMinutes * 60000) } : {}),
      distanceKm: money(b.distanceKm), offeredPayout: payout.amount, ...(pickupAt ? { pickupAt: Timestamp.fromDate(pickupAt) } : {}),
      ...(terms ? { terms } : {}),
      status: 'Open', publishedAt: stamp, publishedBy: admin.uid, createdAt: prior.exists ? prior.data()!.createdAt ?? stamp : stamp, updatedAt: stamp,
    };
    tx.set(market, offer);
    tx.update(ref, {
      ...(payout.commission ? { commission: payout.commission } : {}), payoutSource: payout.source,
      fulfilmentRoute: 'marketplace', marketplacePublishedAt: stamp, marketplacePublishedBy: admin.uid, updatedAt: stamp,
      ...(terms ? { dutyTerms: terms } : {}), ...(note ? { publicationNote: note } : {}),
    });
    tx.create(ref.collection('events').doc(), { type: 'posted_to_marketplace', actorId: admin.uid, actorRole: 'admin', payout: payout.amount, payoutSource: payout.source, ...(note ? { note } : {}), at: stamp });
    auditInTx(tx, { action: 'booking_published', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, previous: { marketplace: priorStatus || 'none' }, next: { marketplace: 'Open', offeredPayout: payout.amount, payoutSource: payout.source } });
    return { bookingId, offeredPayout: payout.amount, booking: b, offer, republished: priorStatus === 'Open' || priorStatus === 'Bidding' };
  });
  let partnersNotified = 0;
  if (!result.republished) {
    const release = releaseConfigOf((await db.doc('settings/operations').get()).data());
    // With release waves enabled only the first wave is told now; the periodic job tells the rest on time.
    partnersNotified = await announceToPartners(bookingId, result.booking, result.offer, release.enabled ? 'topOwners' : 'all', release.topRatedMin)
      .catch((err) => { console.warn('announce failed', err); return 0; });
  }
  return { bookingId, offeredPayout: result.offeredPayout, partnersNotified };
});

// ── Direct Vendor assignment ──────────────────────────────────────────────

/**
 * Reserves an approved booking to a chosen approved Vendor, with the agreed payout
 * recorded. The vendor then assigns its own driver and vehicle. No marketplace
 * record is needed; if the booking had been published, its offer is closed in the
 * same transaction so no stale claim or bid can win.
 */
export const assignVendor = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireDuty(admin, 'assign');
  requireAction(admin, 'Bookings', 'edit');
  const bookingId = docId(request.data?.bookingId, 'booking');
  const vendorId = docId(request.data?.vendorId, 'vendor');
  const reason = text(request.data?.reason, 300);
  const manual = request.data?.payout ?? null;
  const ref = db.doc(`bookings/${bookingId}`);
  const market = db.doc(`marketplace_trips/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [snap, m, v, policy, bids, privatePricing] = await Promise.all([
      tx.get(ref), tx.get(market), tx.get(db.doc(`vendors/${vendorId}`)), loadCommissionPolicy(tx), tx.get(market.collection('bids')), loadPrivatePricing(tx, bookingId),
    ]);
    if (!snap.exists) throw new HttpsError('not-found', 'Booking not found.');
    const b = snap.data()!;
    if (b.status === 'Pending') throw new HttpsError('failed-precondition', 'Approve the booking before assigning a vendor.');
    if (!awaitingFulfilment(b)) throw new HttpsError('failed-precondition', 'This booking is no longer awaiting fulfilment. Remove the current assignment first.');
    if (b.fareVerified !== true) throw new HttpsError('failed-precondition', 'Verify the fare first (Booking Details → Verify / set fare).');
    const vendor = v.data();
    if (!v.exists || !vendor || !approved(vendor.status)) throw new HttpsError('failed-precondition', 'Choose an approved vendor.');
    const vendorName = text(vendor.companyName || vendor.name);
    const payout = resolvePayout(withPrivatePricing(b, privatePricing), policy, manual, admin);
    const stamp = FieldValue.serverTimestamp();
    tx.update(ref, {
      status: 'Confirmed', assignedVendorId: vendorId, assignedVendorName: vendorName, vendorPayout: payout.amount, payoutSource: payout.source,
      ...(payout.commission ? { commission: payout.commission } : {}),
      fulfilmentRoute: 'vendor', confirmedAt: stamp, assignedVendorAt: stamp,
      lastAssignment: { action: 'assign_vendor', by: admin.uid, byName: admin.name, reason, at: Timestamp.now() }, assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
    });
    // Close any published offer so partners cannot still claim or bid on it.
    if (m.exists && ['Open', 'Bidding'].includes(String(m.data()!.status))) {
      tx.update(market, { status: 'Assigned', assignedVendorId: vendorId, assignedVendorName: vendorName, updatedAt: stamp });
      for (const bid of bids.docs) if (bid.data().status === 'Pending Review') tx.update(bid.ref, { status: 'Rejected', reviewedAt: stamp });
    }
    tx.create(ref.collection('assignments').doc(), { action: 'assign_vendor', oldDriver: null, newDriver: null, vendor: { id: vendorId, name: vendorName }, payout: payout.amount, payoutSource: payout.source, changedBy: admin.uid, changedByName: admin.name, reason, at: stamp });
    tx.create(ref.collection('events').doc(), { type: 'vendor_assigned', actorId: admin.uid, actorRole: 'admin', vendorId, payout: payout.amount, payoutSource: payout.source, reason, at: stamp });
    auditInTx(tx, { action: 'vendor_assigned', entity: 'booking', entityId: bookingId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId, previous: { status: b.status }, next: { status: 'Confirmed', vendorId, payout: payout.amount }, reason });
    const label = code(b, bookingId);
    const when = pickupInstant(b);
    const toVendor: NotifyInput = {
      recipientType: 'vendor', recipientId: vendorId, category: 'bookings', severity: 'info', sound: 'new_booking',
      title: 'Trip assigned to your fleet', message: `${text(b.pickup)} → ${text(b.drop)}${when ? ` · ${formatDateTime12(when)}` : ''} · ${text(b.vehicleCategory)}${b.fuelType === 'cng' ? ' (CNG)' : ''} · payout ₹${payout.amount.toLocaleString('en-IN')}. Assign a driver and vehicle.`,
      bookingId, bookingCode: label, cta: { label: 'Open trip', page: 'trip', bookingId }, push: true, sentBy: admin.uid,
    };
    pushes.push({ id: notifyInTx(tx, toVendor), input: toVendor });
    // The customer is told what is true: a partner has the booking, driver details are still to come.
    if (text(b.customerId)) {
      const toCustomer: NotifyInput = {
        recipientType: 'customer', brand: b.brand, recipientId: text(b.customerId), category: 'trips', severity: 'info', sound: 'approval',
        title: 'Your booking is with a NESAM partner', message: `Booking ${label} is confirmed with a partner. Driver and vehicle details will follow before your pickup.`,
        bookingId, bookingCode: label, cta: { label: 'Open trip', page: 'trips', bookingId }, push: true, sentBy: admin.uid,
      };
      pushes.push({ id: notifyInTx(tx, toCustomer), input: toCustomer });
    }
    return { booking: { ...b, assignedVendorName: vendorName }, payout: payout.amount, vendorName };
  });
  await pushAfterCommit(pushes);
  await sendCustomerMessage(bookingId, out.booking, 'vendor_assigned').catch((err) => console.warn('customer message failed', err));
  return { ok: true, vendorName: out.vendorName, payout: out.payout };
});

// ── Bids and the marketplace shortcut ─────────────────────────────────────

// Only an approved booking can be awarded or assigned from the marketplace.
const unassigned = (b: DocumentData) => awaitingFulfilment(b);

export const awardMarketplaceBid = onCall({ timeoutSeconds: 60 }, async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireDuty(admin, 'payout');
  requireDuty(admin, 'assign');
  const tripId = docId(request.data?.tripId, 'trip');
  const bidId = docId(request.data?.bidId, 'bid');
  const market = db.doc(`marketplace_trips/${tripId}`);
  const booking = db.doc(`bookings/${tripId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];
  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [m, b, winner, bids] = await Promise.all([tx.get(market), tx.get(booking), tx.get(market.collection('bids').doc(bidId)), tx.get(market.collection('bids'))]);
    if (!m.exists || !b.exists || !['Open', 'Bidding'].includes(m.data()!.status) || !unassigned(b.data()!)) throw new HttpsError('failed-precondition', 'This trip has already been assigned or withdrawn.');
    if (m.data()!.mode === 'accept_offer') throw new HttpsError('failed-precondition', 'This trip is posted for acceptance of the current offer, not for reviewed bids.');
    if (!winner.exists || winner.data()!.status !== 'Pending Review') throw new HttpsError('failed-precondition', 'This bid is no longer pending.');
    const bid = winner.data()!;
    const bk = b.data()!;
    const payout = Number(bid.vendorCounterRate);
    if (!Number.isFinite(payout) || payout <= 0 || payout > money(bk.fare)) throw new HttpsError('failed-precondition', 'The counter payout must be positive and within the customer fare. Reprice the booking first if needed.');
    const stamp = FieldValue.serverTimestamp();
    const label2 = code(bk, tripId);
    if (bid.bidderType === 'driver') {
      // An owner-driver bid is awarded with the same eligibility as a direct claim.
      const d = await tx.get(db.doc(`drivers/${bid.driverId}`));
      const driver = d.data();
      if (!d.exists || !driver || !approved(driver.status) || driver.vendorId) throw new HttpsError('failed-precondition', 'The bidding driver is no longer an approved owner-driver.');
      const cfg = await loadScheduleConfig(tx);
      assertDriverEligible(driver, bk, cfg);
      if (!driver.assignedVehicleId) throw new HttpsError('failed-precondition', 'The driver has no approved vehicle attached.');
      const vehicle = await assignableVehicle(tx, driver.assignedVehicleId, '', bid.driverId, bk);
      const [driverHeld, vehicleHeld] = await Promise.all([loadHeldDuties(tx, 'assignedDriverId', bid.driverId), loadHeldDuties(tx, 'assignedVehicleId', vehicle.id)]);
      assertScheduleFree(driverHeld, text(driver.name) || 'The driver', bk, tripId, cfg);
      assertScheduleFree(vehicleHeld, `Vehicle ${vehicle.number}`, bk, tripId, cfg);
      tx.update(booking, {
        status: 'Assigned', tripStage: 'Assigned', tripSubStatus: 'Not Started', assignedDriverId: bid.driverId, assignedDriverName: text(driver.name), driver: text(driver.name), driverPhone: text(driver.phone),
        assignedVehicleId: vehicle.id, assignedVehicleNumber: vehicle.number, driverPayout: payout, payoutSource: 'bid', fulfilmentRoute: 'marketplace', assignedAt: stamp, updatedAt: stamp,
      });
      tx.update(market, { status: 'Assigned', assignedDriverId: bid.driverId, assignedDriverName: text(driver.name), acceptedBidId: bidId, updatedAt: stamp });
    } else {
      const vendor = await tx.get(db.doc(`vendors/${bid.vendorId}`));
      if (!vendor.exists || !approved(vendor.data()!.status)) throw new HttpsError('failed-precondition', 'Vendor is not approved.');
      tx.update(booking, { status: 'Confirmed', assignedVendorId: bid.vendorId, assignedVendorName: text(bid.vendorName), vendorPayout: payout, payoutSource: 'bid', fulfilmentRoute: 'marketplace', confirmedAt: stamp, updatedAt: stamp });
      tx.update(market, { status: 'Assigned', assignedVendorId: bid.vendorId, assignedVendorName: text(bid.vendorName), acceptedBidId: bidId, updatedAt: stamp });
    }
    for (const other of bids.docs) tx.update(other.ref, { status: other.id === bidId ? 'Accepted' : 'Rejected', reviewedAt: stamp });
    tx.create(booking.collection('events').doc(), { type: 'bid_awarded', actorId: admin.uid, actorRole: 'admin', bidId, bidderType: bid.bidderType ?? 'vendor', payout, at: stamp });
    auditInTx(tx, { action: 'bid_awarded', entity: 'booking', entityId: tripId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: tripId, next: { bidId, payout, bidder: bid.bidderId ?? bid.vendorId } });
    const to: NotifyInput = {
      recipientType: bid.bidderType === 'driver' ? 'driver' : 'vendor', recipientId: String(bid.bidderId ?? bid.vendorId), category: 'bookings', severity: 'success', sound: 'approval', push: true,
      title: 'Your bid was accepted', message: `${label2} · ₹${payout.toLocaleString('en-IN')}`, bookingId: tripId, bookingCode: label2, cta: { label: 'Open trip', page: 'trip', bookingId: tripId }, sentBy: admin.uid,
    };
    pushes.push({ id: notifyInTx(tx, to), input: to });
    return { booking: { ...bk }, kind: bid.bidderType === 'driver' ? 'driver_assigned' : 'vendor_assigned' };
  });
  await pushAfterCommit(pushes);
  await sendCustomerMessage(tripId, out.booking, out.kind as 'driver_assigned' | 'vendor_assigned').catch((err) => console.warn('customer message failed', err));
  return { ok: true };
});

/** Admin declines a bid. Server-side so every bid decision is audited. */
export const rejectMarketplaceBid = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireDuty(admin, 'payout');
  const tripId = docId(request.data?.tripId, 'trip');
  const bidId = docId(request.data?.bidId, 'bid');
  const market = db.doc(`marketplace_trips/${tripId}`);
  const ref = market.collection('bids').doc(bidId);
  await db.runTransaction(async (tx) => {
    const [bid, m, bids] = await Promise.all([tx.get(ref), tx.get(market), tx.get(market.collection('bids'))]);
    if (!bid.exists || bid.data()!.status !== 'Pending Review') throw new HttpsError('failed-precondition', 'This bid has already been reviewed.');
    const stamp = FieldValue.serverTimestamp();
    tx.update(ref, { status: 'Rejected', reviewedAt: stamp, reviewedBy: admin.uid });
    const remaining = bids.docs.filter((x) => x.id !== bidId && x.data().status === 'Pending Review').length;
    if (m.exists && m.data()!.status === 'Bidding' && remaining === 0) tx.update(market, { status: 'Open', updatedAt: stamp });
    auditInTx(tx, { action: 'bid_rejected', entity: 'booking', entityId: tripId, performedBy: admin.uid, performedByName: admin.name, role: 'admin', bookingId: tripId, next: { bidId } });
  });
  return { ok: true };
});

export const assignIndependentDriver = onCall(async (request) => {
  const admin = await requirePermission(request.auth, 'operations');
  requireDuty(admin, 'assign');
  requireAction(admin, 'Bookings', 'edit');
  const tripId = docId(request.data?.tripId, 'trip');
  const driverId = docId(request.data?.driverId, 'driver');
  const booking = db.doc(`bookings/${tripId}`);
  const market = db.doc(`marketplace_trips/${tripId}`);
  await db.runTransaction(async (tx) => {
    const [b, m, d] = await Promise.all([tx.get(booking), tx.get(market), tx.get(db.doc(`drivers/${driverId}`))]);
    if (!b.exists || !m.exists || !unassigned(b.data()!) || !['Open', 'Bidding'].includes(m.data()!.status)) throw new HttpsError('failed-precondition', 'Trip no longer available.');
    const driver = d.data();
    if (!d.exists || !driver || driver.status !== 'Approved' || driver.vendorId || driver.presenceStatus !== 'Online' || driver.fleetStatus === 'Suspended') {
      throw new HttpsError('failed-precondition', 'Choose an available approved independent driver.');
    }
    const payout = Number(m.data()!.offeredPayout);
    if (!Number.isFinite(payout) || payout <= 0) throw new HttpsError('failed-precondition', 'This trip has no valid offer. Re-post it first.');
    // The driver's registered vehicle record, when there is one.
    const cfg = await loadScheduleConfig(tx);
    assertDriverEligible(driver, b.data()!, cfg);
    const vehicle = driver.assignedVehicleId ? await assignableVehicle(tx, driver.assignedVehicleId, '', driverId, b.data()) : null;
    const [driverHeld, vehicleHeld] = await Promise.all([loadHeldDuties(tx, 'assignedDriverId', driverId), vehicle ? loadHeldDuties(tx, 'assignedVehicleId', vehicle.id) : Promise.resolve([])]);
    assertScheduleFree(driverHeld, text(driver.name) || 'The driver', b.data()!, tripId, cfg);
    if (vehicle) assertScheduleFree(vehicleHeld, `Vehicle ${vehicle.number}`, b.data()!, tripId, cfg);
    const stamp = FieldValue.serverTimestamp();
    tx.update(booking, {
      status: 'Assigned', tripStage: 'Assigned', assignedDriverId: driverId, assignedDriverName: text(driver.name), driver: text(driver.name),
      driverPhone: text(driver.phone), assignedVehicleId: vehicle?.id ?? '', assignedVehicleNumber: vehicle?.number ?? text(driver.assignedVehicleNumber || driver.vehicleNumber, 20),
      driverPayout: payout, payoutSource: 'offered', fulfilmentRoute: 'marketplace', assignedAt: stamp, updatedAt: stamp,
    });
    tx.update(market, { status: 'Assigned', assignedDriverId: driverId, assignedDriverName: text(driver.name), updatedAt: stamp });
    tx.create(booking.collection('events').doc(), { type: 'driver_assigned', actorId: admin.uid, actorRole: 'admin', driverId, at: stamp });
  });
  return { ok: true };
});
