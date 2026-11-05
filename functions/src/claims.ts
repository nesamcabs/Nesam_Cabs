// Marketplace participation, all server-side:
//   claimMarketplaceDuty    accept the current offer (posting mode "accept_offer")
//   submitMarketplaceBid    counter-offer for Admin review (posting mode "bid_review")
//   withdrawMarketplaceBid  withdraw a pending bid
//   runOfferEscalation      hourly offer step-ups, driven by the publication timestamp
//
// Firestore rules deny every client write that would assign a duty, so the same eligibility
// (account approval, vendor ownership, vehicle class and seats, documents valid through the
// trip, driver/vehicle schedule, single winner) is applied to every claimant.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DocumentData, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from './admin';
import { auditInTx } from './audit';
import { awaitingFulfilment } from './domain/advanceBooking';
import { classAllows, dutyClassOf, vehicleClassOf } from './domain/eligibility';
import { formatDateTime12, pickupInstant } from './domain/time';
import { sendCustomerMessage } from './customerComms';
import { assertDriverEligible, assertScheduleFree, bookingDutyClass, loadHeldDuties, loadScheduleConfig } from './eligibility';
import { assignableVehicle, docId, money } from './marketplace';
import { releaseBlocker, releaseConfigOf } from './release';
import { notify, notifyInTx, pushAfterCommit, NotifyInput } from './notify';
import { approved, text } from './shared';
import { assertPenaltiesAcknowledged, assignByFor } from './partnerOps';

export const POSTING_MODES = ['accept_offer', 'bid_review'] as const;
export type PostingMode = (typeof POSTING_MODES)[number];
const label = (b: DocumentData, id: string) => text(b.bookingId) || id;

type Caller = { kind: 'driver'; uid: string; data: DocumentData } | { kind: 'vendor'; uid: string; data: DocumentData };

async function partyOf(uid: string | undefined): Promise<Caller> {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const [d, v] = await Promise.all([db.doc(`drivers/${uid}`).get(), db.doc(`vendors/${uid}`).get()]);
  if (v.exists && approved(v.data()!.status)) return { kind: 'vendor', uid, data: v.data()! };
  if (d.exists) {
    const p = d.data()!;
    // Vendor employee drivers receive trips from their vendor; they never browse, claim or bid.
    if (p.vendorId) throw new HttpsError('permission-denied', 'Fleet drivers receive trips from their vendor, not the marketplace.', { code: 'employee-denied' });
    if (!approved(p.status)) throw new HttpsError('permission-denied', 'Your driver account is not approved yet.');
    if (p.fleetStatus === 'Suspended') throw new HttpsError('permission-denied', 'Your account is suspended.');
    return { kind: 'driver', uid, data: p };
  }
  throw new HttpsError('permission-denied', 'Only approved owner-drivers and vendors can take part in the marketplace.');
}

/** A driver's own attached, approved vehicle must be eligible for the duty (class + seats + documents). */
async function driverVehicle(tx: FirebaseFirestore.Transaction, uid: string, driver: DocumentData, booking: DocumentData) {
  const vehicleId = text(driver.assignedVehicleId);
  if (!vehicleId) throw new HttpsError('failed-precondition', 'Attach an approved vehicle to your profile before taking duties.', { code: 'no-vehicle' });
  return assignableVehicle(tx, vehicleId, '', uid, booking);
}

export const claimMarketplaceDuty = onCall({ timeoutSeconds: 60 }, async (request) => {
  const party = await partyOf(request.auth?.uid);
  const bookingId = docId(request.data?.bookingId, 'booking');
  const ref = db.doc(`bookings/${bookingId}`);
  const market = db.doc(`marketplace_trips/${bookingId}`);
  const pushes: { id: string; input: NotifyInput }[] = [];

  const out = await db.runTransaction(async (tx) => {
    pushes.length = 0;
    const [snap, m, settings, bids] = await Promise.all([tx.get(ref), tx.get(market), tx.get(db.doc('settings/operations')), tx.get(market.collection('bids'))]);
    if (!snap.exists || !m.exists) throw new HttpsError('failed-precondition', 'This trip is no longer available.', { code: 'taken' });
    const b = snap.data()!, offer = m.data()!;
    if (!['Open', 'Bidding'].includes(String(offer.status)) || !awaitingFulfilment(b)) throw new HttpsError('failed-precondition', 'This trip is no longer available. Another partner has taken it or it was withdrawn.', { code: 'taken' });
    if (b.fareVerified !== true) throw new HttpsError('failed-precondition', 'This trip is not ready to be taken yet.');
    await assertPenaltiesAcknowledged(tx, party.kind, party.uid);
    const mode = POSTING_MODES.includes(offer.mode) ? (offer.mode as PostingMode) : null;
    if (mode === 'bid_review') throw new HttpsError('failed-precondition', 'This trip is open for bids reviewed by NESAM. Submit a bid instead of accepting.', { code: 'bid-only' });
    // Legacy posts carried both paths; an owner-driver could only ever accept an Open offer.
    if (!mode && party.kind === 'driver' && offer.status !== 'Open') throw new HttpsError('failed-precondition', 'This trip is no longer available.', { code: 'taken' });
    const at = pickupInstant(b);
    if (at && at.getTime() <= Date.now()) throw new HttpsError('failed-precondition', 'The pickup time has passed.', { code: 'expired' });
    const cutoff = (offer.cutoffAt as Timestamp | undefined)?.toMillis?.();
    if (cutoff && Date.now() > cutoff) throw new HttpsError('failed-precondition', 'This offer has closed.', { code: 'expired' });
    const publishedMs = (offer.publishedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    const rating = typeof party.data.rating === 'number' ? party.data.rating : null;
    const wave = releaseBlocker(releaseConfigOf(settings.data()), party.kind, rating, publishedMs, Date.now());
    if (wave) throw new HttpsError('failed-precondition', wave, { code: 'not-released' });
    const payout = money(offer.offeredPayout);
    if (!(payout > 0)) throw new HttpsError('failed-precondition', 'This trip has no valid offer.');
    const stamp = FieldValue.serverTimestamp();
    const cfg = await loadScheduleConfig(tx);
    const partnerName = text(party.data.companyName || party.data.name);
    const mine = label(b, bookingId);

    if (party.kind === 'driver') {
      const classes: string[] = Array.isArray(offer.eligibleVehicleClasses) ? offer.eligibleVehicleClasses : [];
      assertDriverEligible(party.data, b, cfg);
      const vehicle = await driverVehicle(tx, party.uid, party.data, b);
      const vClass = vehicleClassOf({ vehicleClass: vehicle.data.vehicleClass, category: vehicle.data.category, make: vehicle.data.make, model: vehicle.data.model, name: vehicle.data.name, seatingCapacity: vehicle.data.seatingCapacity });
      if (classes.length && vClass && !classes.includes(vClass)) throw new HttpsError('failed-precondition', 'Your vehicle category cannot serve this duty.', { code: 'vehicle-not-eligible' });
      const [driverHeld, vehicleHeld] = await Promise.all([loadHeldDuties(tx, 'assignedDriverId', party.uid), loadHeldDuties(tx, 'assignedVehicleId', vehicle.id)]);
      assertScheduleFree(driverHeld, 'You', b, bookingId, cfg);
      assertScheduleFree(vehicleHeld, `Vehicle ${vehicle.number}`, b, bookingId, cfg);
      tx.update(ref, {
        status: 'Assigned', tripStage: 'Assigned', tripSubStatus: 'Not Started',
        assignedDriverId: party.uid, assignedDriverName: text(party.data.name), driver: text(party.data.name), driverPhone: text(party.data.phone),
        assignedVehicleId: vehicle.id, assignedVehicleNumber: vehicle.number, driverPayout: payout, payoutSource: 'offered', fulfilmentRoute: 'marketplace',
        acceptedAt: stamp, assignedAt: stamp, assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
      });
      tx.update(market, { status: 'Assigned', assignedDriverId: party.uid, assignedDriverName: text(party.data.name), acceptedAt: stamp, updatedAt: stamp });
    } else {
      tx.update(ref, {
        status: 'Confirmed', assignedVendorId: party.uid, assignedVendorName: partnerName, vendorPayout: payout, payoutSource: 'offered', fulfilmentRoute: 'marketplace',
        confirmedAt: stamp, acceptedAt: stamp, assignedVendorAt: stamp, assignmentChanges: FieldValue.increment(1), updatedAt: stamp,
        // Driver + vehicle must be confirmed by this time (Partner app "Assign by"); missing it can lead to an office penalty.
        assignBy: Timestamp.fromMillis(assignByFor(Date.now(), at ? at.getTime() : null, settings.data())),
      });
      tx.update(market, { status: 'Assigned', assignedVendorId: party.uid, assignedVendorName: partnerName, acceptedAt: stamp, updatedAt: stamp });
    }
    // Bids on a duty that has just been taken can never win.
    for (const bid of bids.docs) if (bid.data().status === 'Pending Review') tx.update(bid.ref, { status: 'Rejected', reviewedAt: stamp });
    tx.create(ref.collection('events').doc(), { type: 'marketplace_accepted', actorId: party.uid, actorRole: party.kind, payout, at: stamp });
    auditInTx(tx, { action: 'marketplace_claimed', entity: 'booking', entityId: bookingId, performedBy: party.uid, performedByName: partnerName || text(party.data.name), role: party.kind, bookingId, next: { payout, partner: party.kind } });
    const admin: NotifyInput = {
      recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'info', sound: 'general', title: 'Marketplace duty taken',
      message: `${mine} accepted by ${partnerName || text(party.data.name)} (${party.kind}) at ₹${payout.toLocaleString('en-IN')}.`, bookingId, bookingCode: mine,
      cta: { label: 'Open booking', page: 'booking-detail', bookingId }, push: false,
    };
    pushes.push({ id: notifyInTx(tx, admin), input: admin });
    return { booking: { ...b, ...(party.kind === 'driver' ? { assignedDriverName: text(party.data.name) } : { assignedVendorName: partnerName }) }, payout, kind: party.kind, when: at };
  });
  await pushAfterCommit(pushes);
  await sendCustomerMessage(bookingId, out.booking, out.kind === 'driver' ? 'driver_assigned' : 'vendor_assigned').catch((err) => console.warn('customer message failed', err));
  return { ok: true, payout: out.payout, kind: out.kind };
});

// ── Bids (Admin-reviewed) ───────────────────────────────────────────────────

export const submitMarketplaceBid = onCall({ timeoutSeconds: 60 }, async (request) => {
  const party = await partyOf(request.auth?.uid);
  const tripId = docId(request.data?.tripId, 'trip');
  const rate = request.data?.rate;
  const note = text(request.data?.note, 300);
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0 || rate > 1000000 || Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) {
    throw new HttpsError('invalid-argument', 'Enter your counter amount in rupees.');
  }
  const market = db.doc(`marketplace_trips/${tripId}`);
  const bookingRef = db.doc(`bookings/${tripId}`);
  const bidRef = market.collection('bids').doc(`${party.kind}_${party.uid}`);
  return db.runTransaction(async (tx) => {
    const [m, bs, existing, settings] = await Promise.all([tx.get(market), tx.get(bookingRef), tx.get(bidRef), tx.get(db.doc('settings/operations'))]);
    if (!m.exists || !bs.exists || !['Open', 'Bidding'].includes(String(m.data()!.status)) || !awaitingFulfilment(bs.data()!)) {
      throw new HttpsError('failed-precondition', 'Bidding has closed on this trip.', { code: 'closed' });
    }
    const offer = m.data()!, b = bs.data()!;
    const mode = POSTING_MODES.includes(offer.mode) ? (offer.mode as PostingMode) : null;
    if (mode === 'accept_offer') throw new HttpsError('failed-precondition', 'This trip is taken by accepting the current offer, not by bidding.', { code: 'accept-only' });
    const cutoff = (offer.cutoffAt as Timestamp | undefined)?.toMillis?.();
    if (cutoff && Date.now() > cutoff) throw new HttpsError('failed-precondition', 'Bidding has closed on this trip.', { code: 'closed' });
    const publishedMs = (offer.publishedAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    const wave = releaseBlocker(releaseConfigOf(settings.data()), party.kind, typeof party.data.rating === 'number' ? party.data.rating : null, publishedMs, Date.now());
    if (wave) throw new HttpsError('failed-precondition', wave, { code: 'not-released' });
    const fare = money(b.fare);
    if (rate > fare) throw new HttpsError('failed-precondition', `A counter amount cannot exceed the customer fare (₹${fare.toLocaleString('en-IN')}).`);
    if (money(offer.ceiling) > 0 && rate > money(offer.ceiling)) throw new HttpsError('failed-precondition', `A counter amount cannot exceed the ceiling (₹${money(offer.ceiling).toLocaleString('en-IN')}).`);
    if (existing.exists && existing.data()!.status !== 'Pending Review') throw new HttpsError('failed-precondition', 'Your bid on this trip has already been decided.');
    await assertPenaltiesAcknowledged(tx, party.kind, party.uid);
    // Consent to accept automatically when the approved payout reaches this bid, and to assign within the window.
    const autoAcceptConsent = request.data?.autoAcceptConsent === true;
    if (party.kind === 'vendor' && !autoAcceptConsent) throw new HttpsError('invalid-argument', 'Confirm the automatic acceptance and assignment terms to place a bid.', { code: 'consent-required' });
    const stamp = FieldValue.serverTimestamp();
    const name = text(party.data.companyName || party.data.name);
    tx.set(bidRef, {
      tripId, bookingId: label(b, tripId), bidderType: party.kind, bidderId: party.uid, vendorId: party.kind === 'vendor' ? party.uid : '', driverId: party.kind === 'driver' ? party.uid : '',
      vendorName: name, vendorPhone: text(party.data.phone), offeredPayout: money(offer.offeredPayout), vendorCounterRate: rate, biddingNote: note,
      autoAcceptConsent, consentAt: autoAcceptConsent ? stamp : null,
      status: 'Pending Review', source: `${party.kind}-app`, submittedAt: existing.exists ? existing.data()!.submittedAt ?? stamp : stamp, updatedAt: stamp,
    });
    tx.update(market, { status: 'Bidding', ...(existing.exists ? {} : { bidCount: FieldValue.increment(1) }), lastCounterRate: rate, lastBidAt: stamp, updatedAt: stamp });
    return { ok: true, bidId: bidRef.id };
  });
});

export const withdrawMarketplaceBid = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const tripId = docId(request.data?.tripId, 'trip');
  const bidId = docId(request.data?.bidId, 'bid');
  const market = db.doc(`marketplace_trips/${tripId}`);
  const ref = market.collection('bids').doc(bidId);
  await db.runTransaction(async (tx) => {
    const [bid, m, bids] = await Promise.all([tx.get(ref), tx.get(market), tx.get(market.collection('bids'))]);
    if (!bid.exists) throw new HttpsError('not-found', 'Bid not found.');
    const d = bid.data()!;
    if (d.bidderId !== uid && d.vendorId !== uid) throw new HttpsError('permission-denied', 'This is not your bid.');
    if (d.status !== 'Pending Review') throw new HttpsError('failed-precondition', 'Only bids under review can be withdrawn.');
    tx.update(ref, { status: 'Withdrawn', withdrawnAt: FieldValue.serverTimestamp() });
    const remaining = bids.docs.filter((x) => x.id !== bidId && x.data().status === 'Pending Review').length;
    if (m.exists && m.data()!.status === 'Bidding') tx.update(market, { bidCount: remaining, ...(remaining === 0 ? { status: 'Open' } : {}), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

// ── Offer escalation ────────────────────────────────────────────────────────

export interface EscalationState {
  enabled: boolean;
  ceilingPaise: number;
  stepPercent: number;
  intervalMinutes: number;
  /** Steps already applied. The next one is due at publishedAt + (step + 1) × interval. */
  step: number;
}

/** next = min(ceiling, round(current × (1 + step%), 2)) — in paise, half-up. */
export function nextOfferPaise(currentPaise: number, stepPercent: number, ceilingPaise: number): number {
  return Math.min(ceilingPaise, Math.floor((currentPaise * (100 + stepPercent)) / 100 + 0.5));
}

/**
 * Applies every escalation step that is due. Each step is computed from the PUBLICATION time,
 * so a retried or overlapping run cannot compound the same hour twice: the step counter moves
 * inside the transaction and a second run finds nothing due. Stops on assignment, withdrawal,
 * cut-off and at the ceiling (admin alerted once; the customer fare never changes).
 */
export async function runOfferEscalation(now = Date.now()): Promise<{ checked: number; stepped: number; atCeiling: number }> {
  const open = await db.collection('marketplace_trips').where('status', 'in', ['Open', 'Bidding']).get();
  let stepped = 0, atCeiling = 0;
  for (const d of open.docs) {
    const e = d.data().escalation as EscalationState | undefined;
    if (!e || e.enabled !== true) continue;
    const res = await db.runTransaction(async (tx) => {
      const snap = await tx.get(d.ref);
      const m = snap.data();
      const st = m?.escalation as EscalationState | undefined;
      if (!snap.exists || !m || !st || st.enabled !== true || !['Open', 'Bidding'].includes(String(m.status))) return null;
      const published = (m.publishedAt as Timestamp | undefined)?.toMillis?.();
      if (!published) return null;
      const cutoff = (m.cutoffAt as Timestamp | undefined)?.toMillis?.();
      let current = Math.round(money(m.offeredPayout) * 100);
      let step = st.step || 0;
      let moved = 0;
      while (current < st.ceilingPaise && published + (step + 1) * st.intervalMinutes * 60000 <= now) {
        const due = published + (step + 1) * st.intervalMinutes * 60000;
        if (cutoff && due > cutoff) break;
        current = nextOfferPaise(current, st.stepPercent, st.ceilingPaise);
        step++;
        moved++;
        if (step > 200) break;
      }
      if (moved) tx.update(d.ref, { offeredPayout: current / 100, 'escalation.step': step, escalatedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
      return { moved, current, ceiling: st.ceilingPaise, bookingId: m.bookingId ?? d.id };
    });
    if (!res) continue;
    if (res.moved) stepped++;
    if (res.current >= res.ceiling) {
      atCeiling++;
      await notify({
        recipientType: 'admin', recipientId: 'admin', category: 'bookings', severity: 'warning', sound: 'general', push: true,
        title: 'Marketplace offer is at its ceiling', message: `${res.bookingId} still has no partner at ₹${(res.ceiling / 100).toLocaleString('en-IN')}. The customer fare is unchanged — assign directly or review.`,
        bookingId: d.id, bookingCode: String(res.bookingId), cta: { label: 'Open booking', page: 'booking-detail', bookingId: d.id }, dedupeKey: `offer_ceiling_${d.id}`,
      }).catch(() => null);
    }
  }
  return { checked: open.size, stepped, atCeiling };
}

// Silence unused import warnings for helpers kept for future wave logic.
void classAllows; void dutyClassOf; void bookingDutyClass; void formatDateTime12;
