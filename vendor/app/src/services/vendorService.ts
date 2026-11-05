import { callBackend, settleBooking, settlePayout } from './backend';
import { ActionError, callFunction } from './callables';
// Vendor operations: marketplace, bidding, dispatch, fleet, drivers, invites
// and payouts.
//
// The Vendor Web dashboard service (vendor/web/src/services/vendorFirestoreService.ts)
// is NOT a usable reference here — it assigns a fabricated driver on accept,
// swallows rule rejections and fills gaps with mock values (audit VEN-W1).
// These functions are written against firestore.rules, the actual contract:
//   vendorClaimOk / marketplace "vendor accepts" (accept offered rate),
//   bids create + marketplace "Bidding" bookkeeping (counter-bid),
//   vendorAssignDriver callable (assign one of the vendor's own drivers and vehicles),
//   vehicles (docStatus stays Pending on vendor edits), drivers fleet fields,
//   driver_invites (never preApproved), payout_requests (status Pending).
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '../config/firebase';
import type {
  DriverInviteRecord,
  FleetDriver,
  FleetVehicle,
  LedgerRecord,
  MarketTrip,
  VendorBid,
  VendorBooking,
  VendorPayoutRequest,
  VehicleStatus,
  WalletDetails,
} from '../types/operations';
import { num, str, toDate } from '../utils/format';
import { normalizePlate } from '../utils/fleet';
import { withTimeout } from '../utils/retry';
import { mapLedgerEntry, mapWallet } from '../utils/wallet';

export const MIN_PAYOUT = 500;
export const DEFAULT_COMMISSION_RATE = 0.15;
/** A counter-bid may not exceed this multiple of the offered payout. */
export const MAX_COUNTER_MULTIPLE = 3;

export class VendorActionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface VendorIdentity {
  id: string;
  companyName: string;
  phone: string;
}

// ── Marketplace ────────────────────────────────────────────────────────────

export function mapMarketTrip(id: string, d: DocumentData): MarketTrip {
  const pickup = d.pickup && typeof d.pickup === 'object' ? d.pickup : { address: str(d.pickup) };
  const drop = d.drop && typeof d.drop === 'object' ? d.drop : { address: str(d.drop) };
  return {
    id,
    bookingId: str(d.bookingId) || id,
    route: str(d.route) || `${str(pickup.city || pickup.address)} ➔ ${str(drop.city || drop.address)}`,
    pickup: { address: str(pickup.address) || 'Pickup', city: str(pickup.city), time: str(pickup.time) },
    drop: { address: str(drop.address) || 'Drop', city: str(drop.city) },
    travelDate: str(d.travelDate),
    service: str(d.service),
    tripType: str(d.tripType),
    vehicleCategory: str(d.vehicleCategory || d.categoryName),
    distanceKm: num(d.distanceKm),
    offeredPayout: num(d.offeredPayout),
    status: str(d.status) || 'Open',
    bidCount: num(d.bidCount),
    mode: d.mode === 'bid_review' ? 'bid_review' : d.mode === 'accept_offer' ? 'accept_offer' : '',
    publishedMs: toDate(d.publishedAt)?.getTime() ?? 0,
    createdMs: toDate(d.createdAt)?.getTime() ?? 0,
    pickupMs: toDate(d.pickupAt)?.getTime() ?? 0,
    cutoffMs: toDate(d.cutoffAt)?.getTime() ?? 0,
  };
}

export function subscribeToMarketplace(cb: (trips: MarketTrip[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'marketplace_trips'), where('status', 'in', ['Open', 'Bidding'])),
    (snap) => {
      const trips = snap.docs.map((d) => mapMarketTrip(d.id, d.data()));
      trips.sort((a, b) => b.createdMs - a.createdMs);
      cb(trips);
    },
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

/**
 * Accepts a marketplace trip at the offered rate. The claim runs on the server (claimMarketplaceDuty):
 * it picks exactly one winner among vendors, owner-drivers and NESAM's own assignment, and the app
 * writes nothing to the booking or the offer.
 */
export async function acceptOfferedRate(_vendor: VendorIdentity, trip: MarketTrip): Promise<void> {
  try {
    await callFunction('claimMarketplaceDuty', { bookingId: trip.id }, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new VendorActionError('taken', err.message);
    throw err;
  }
}

export function validateCounterRate(rate: number, offered: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return 'Enter your counter rate.';
  if (!Number.isInteger(rate)) return 'Enter a whole-rupee amount.';
  if (offered > 0 && rate === offered) return 'That is the offered rate — use “Accept offered rate” instead.';
  if (offered > 0 && rate > offered * MAX_COUNTER_MULTIPLE) return `Counter rate looks too high (max ₹${Math.round(offered * MAX_COUNTER_MULTIPLE)}).`;
  return '';
}

/** Submits a counter-bid for NESAM's review (submitMarketplaceBid). One bid per vendor per trip: a newer one replaces it. */
export async function submitCounterBid(_vendor: VendorIdentity, trip: MarketTrip, rate: number, note: string, autoAcceptConsent = true): Promise<void> {
  const invalid = validateCounterRate(rate, trip.offeredPayout);
  if (invalid) throw new VendorActionError('invalid-rate', invalid);
  try {
    await callFunction('submitMarketplaceBid', { tripId: trip.id, rate, note: note.trim().slice(0, 300), autoAcceptConsent }, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new VendorActionError('closed', err.message);
    throw err;
  }
}

export function mapBid(id: string, d: DocumentData): VendorBid {
  return {
    id,
    tripId: str(d.tripId),
    bookingId: str(d.bookingId) || str(d.tripId),
    offeredPayout: num(d.offeredPayout),
    vendorCounterRate: num(d.vendorCounterRate),
    biddingNote: str(d.biddingNote),
    status: str(d.status) || 'Pending Review',
    submittedAt: toDate(d.submittedAt),
    autoAcceptConsent: d.autoAcceptConsent === true,
  };
}

export function subscribeToMyBids(vendorId: string, cb: (bids: VendorBid[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collectionGroup(db, 'bids'), where('vendorId', '==', vendorId)),
    (snap) => {
      const bids = snap.docs.map((d) => mapBid(d.id, d.data()));
      bids.sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0));
      cb(bids);
    },
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

/** Withdraws a bid still under review (withdrawMarketplaceBid). */
export async function withdrawBid(bid: VendorBid): Promise<void> {
  if (bid.status !== 'Pending Review') throw new VendorActionError('locked', 'Only bids under review can be withdrawn.');
  try {
    await callFunction('withdrawMarketplaceBid', { tripId: bid.tripId, bidId: bid.id }, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new VendorActionError('locked', err.message);
    throw err;
  }
}

// ── Awarded trips & dispatch ───────────────────────────────────────────────

export function mapVendorBooking(id: string, d: DocumentData): VendorBooking {
  return {
    id,
    bookingId: str(d.bookingId) || id,
    customerName: str(d.customer || d.customerName) || 'Passenger',
    // Vendors never receive the customer's number: the booking carries a masked value only.
    customerPhone: '',
    customerPhoneMasked: str(d.phoneMasked),
    pickupAddress: str(d.pickupAddress || d.pickup) || 'Pickup',
    dropAddress: str(d.dropAddress || d.drop) || 'Destination',
    date: str(d.date),
    time: str(d.time),
    vehicleCategory: str(d.vehicleCategory || d.vehicle),
    status: str(d.status),
    tripStage: str(d.tripStage),
    driverId: str(d.assignedDriverId),
    driverName: str(d.assignedDriverName || d.driver),
    driverPhone: str(d.driverPhone),
    vehicleId: str(d.assignedVehicleId),
    vehicleNumber: str(d.assignedVehicleNumber),
    fare: num(d.fare),
    // The server records the payout; the app never estimates one. Once finance has
    // finalized the trip, its snapshot (bookings/{id}.finance) is the amount that counts.
    ...vendorPayoutOf(d),
    tollCharges: num(d.tollCharges),
    paymentMethod: str(d.paymentMethod),
    confirmedAt: toDate(d.confirmedAt),
    completedAt: toDate(d.completedAt),
    pickupAt: toDate(d.pickupAt) ?? toDate(d.scheduledAt),
    tripType: tripTypeOf(d),
    includedKm: Math.round(num(d.pricing?.includedKm) || num(d.pricing?.quotedKm) || num(d.distanceKm)),
    tripSubStatus: str(d.tripSubStatus),
    paymentStatus: str(d.paymentSummary?.status),
    acceptedAt: toDate(d.assignedVendorAt) ?? toDate(d.acceptedAt) ?? toDate(d.confirmedAt),
    assignBy: toDate(d.assignBy),
    driverResponse: d.driverResponse && d.driverResponse.driverId && d.driverResponse.driverId === d.assignedDriverId
      ? { viewedAt: toDate(d.driverResponse.viewedAt), acknowledgedAt: toDate(d.driverResponse.acknowledgedAt) }
      : null,
    cancellationRequest: d.cancellationRequest && d.cancellationRequest.partyType === 'vendor'
      ? { requestId: str(d.cancellationRequest.requestId), status: str(d.cancellationRequest.status), quotedPenalty: num(d.cancellationRequest.quotedPenalty) }
      : null,
  };
}

/** "One Way", "Round Trip", "Local Rental", "Multicity", "Airport" from what the booking stored. */
export function tripTypeOf(d: DocumentData): string {
  const raw = `${str(d.tripType)} ${str(d.service)} ${str(d.bookingType)}`.toLowerCase();
  if (/round/.test(raw)) return 'Round Trip';
  if (/rental|local|hour/.test(raw)) return 'Local Rental';
  if (/multi/.test(raw)) return 'Multicity';
  if (/airport/.test(raw)) return 'Airport';
  if (/one|drop|outstation/.test(raw)) return 'One Way';
  return str(d.tripType) || str(d.service);
}

export function subscribeToVendorBookings(vendorId: string, cb: (b: VendorBooking[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'bookings'), where('assignedVendorId', '==', vendorId)),
    (snap) => cb(snap.docs.map((d) => mapVendorBooking(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

export const isActiveBooking = (b: VendorBooking) => b.status === 'Confirmed' || b.status === 'Assigned' || b.status === 'Ongoing';
function vendorPayoutOf(d: DocumentData): { vendorPayout: number; payoutRecorded: boolean; payoutFinalized: boolean } {
  const fin = d.finance && typeof d.finance === 'object' && d.finance.schema === 1 ? d.finance : null;
  if (fin && fin.partnerType === 'vendor' && typeof fin.partnerPayout === 'number' && Number.isFinite(fin.partnerPayout)) {
    return { vendorPayout: fin.partnerPayout, payoutRecorded: true, payoutFinalized: true };
  }
  const recorded = typeof d.vendorPayout === 'number' && Number.isFinite(d.vendorPayout);
  return { vendorPayout: recorded ? d.vendorPayout : 0, payoutRecorded: recorded, payoutFinalized: false };
}

/** Driver progress in words (steps: Reached Pickup → Trip Started → Trip Ended; tripStage mirrors them). */
export function tripStageLabel(b: Pick<VendorBooking, 'status' | 'tripStage'>): string {
  if (b.status === 'Completed') return 'Completed';
  if (b.status === 'Ongoing' || b.tripStage === 'In Progress' || b.tripStage === 'Arrived Destination') return 'On trip';
  if (b.tripStage === 'Reached Pickup') return 'Driver at pickup';
  if (b.tripStage === 'En Route Pickup') return 'Driver on the way';
  return b.status === 'Assigned' ? 'Driver assigned' : b.status;
}

export const canDispatch = (b: VendorBooking) => b.status === 'Confirmed' || (b.status === 'Assigned' && (!b.tripStage || b.tripStage === 'Assigned'));

/** A fleet vehicle eligible for dispatch: approved by NESAM, in active service, with valid ID and number. */
export function isEligibleVehicle(v: FleetVehicle): boolean {
  return (
    v.docStatus === 'Approved' &&
    v.status === 'Active' &&
    Boolean(v.id && v.id.trim()) &&
    Boolean(v.vehicleNumber && v.vehicleNumber.trim())
  );
}

/**
 * Resolves an assigned vehicle reference against the loaded fleet.
 * Safe resolution rules:
 * 1. If an ID is provided, it must match an eligible fleet record.
 *    If a registration number is also provided, it must match that record's plate.
 * 2. If only a registration number is provided (legacy booking without ID),
 *    normalize and match against eligible records. Proceed only when exactly ONE record matches.
 * 3. Returns null if missing, ambiguous, stale or ineligible.
 */
export function resolveAssignedVehicle(
  ref: { vehicleId?: string; vehicleNumber?: string } | null | undefined,
  fleetVehicles: FleetVehicle[],
): FleetVehicle | null {
  if (!ref) return null;
  const eligible = fleetVehicles.filter(isEligibleVehicle);
  const vehicleId = (ref.vehicleId || '').trim();
  const rawNumber = (ref.vehicleNumber || '').trim();

  // 1. Resolve by vehicleId if present
  if (vehicleId) {
    const match = eligible.find((v) => v.id === vehicleId);
    if (match) {
      if (rawNumber && normalizePlate(rawNumber) !== normalizePlate(match.vehicleNumber)) {
        return null; // Mismatched ID and registration number
      }
      return match;
    }
    // Stale or ineligible vehicle ID: do NOT silently fall back to registration number
    return null;
  }

  // 2. Legacy fallback: when booking contains ONLY a registration number (no vehicleId)
  if (rawNumber) {
    const target = normalizePlate(rawNumber);
    if (!target) return null;
    const matches = eligible.filter((v) => normalizePlate(v.vehicleNumber) === target);
    if (matches.length === 1) {
      return matches[0]!;
    }
    // 0 or >1 matches: require explicit selection
    return null;
  }

  return null;
}

/** Resolves an eligible vehicle assigned to a driver. */
export function defaultVehicleForDriver(
  driver: FleetDriver | null,
  fleetVehicles: FleetVehicle[],
): FleetVehicle | null {
  if (!driver) return null;
  return resolveAssignedVehicle(
    { vehicleId: driver.assignedVehicleId, vehicleNumber: driver.assignedVehicleNumber || driver.ownVehicleNumber },
    fleetVehicles,
  );
}

export type DispatchVehicleRef = { id: string; vehicleNumber: string };

/**
 * Payload for the vendorAssignDriver callable. The server derives the registration number
 * from the vehicle record, so the stable vehicle ID is what identifies the vehicle; the
 * registration number is validated here so a record without one is never dispatched.
 */
export function buildDispatchRequest(booking: { id: string }, driver: FleetDriver, vehicle: DispatchVehicleRef) {
  const vehicleId = (vehicle?.id || '').trim();
  const vehicleNumber = (vehicle?.vehicleNumber || '').trim().toUpperCase();
  if (!vehicleId) throw new VendorActionError('invalid-vehicle', 'Vehicle ID is required for dispatch.');
  if (!vehicleNumber) throw new VendorActionError('invalid-vehicle', 'Vehicle registration number is required for dispatch.');
  return { bookingId: booking.id, driverId: driver.id, vehicleId };
}

/** Why a driver can't take this trip right now ('' when they can). */
export function dispatchBlocker(driver: FleetDriver, bookings: VendorBooking[], forBookingId: string): string {
  if (driver.approvalStatus !== 'Approved') return `${driver.name} is not approved by NESAM yet.`;
  if (driver.fleetStatus === 'Suspended') return `${driver.name} is suspended in your fleet.`;
  const busy = bookings.find((b) => b.id !== forBookingId && b.driverId === driver.id && (b.status === 'Assigned' || b.status === 'Ongoing'));
  if (busy) return `${driver.name} is already on trip ${busy.bookingId}.`;
  return '';
}

export async function dispatchDriver(
  booking: VendorBooking,
  driver: FleetDriver,
  vehicle: FleetVehicle | DispatchVehicleRef,
  allBookings: VendorBooking[],
): Promise<void> {
  if (!canDispatch(booking)) throw new VendorActionError('locked', 'This trip has already started — the driver can no longer be changed.');
  const blocker = dispatchBlocker(driver, allBookings, booking.id);
  if (blocker) throw new VendorActionError('driver-busy', blocker);
  if (!vehicle || !vehicle.id?.trim() || !vehicle.vehicleNumber?.trim()) {
    throw new VendorActionError('no-vehicle', 'Choose an eligible vehicle for this trip.');
  }
  if ('docStatus' in vehicle && 'status' in vehicle && !isEligibleVehicle(vehicle as FleetVehicle)) {
    throw new VendorActionError('ineligible-vehicle', 'The selected vehicle is not active and approved for dispatch.');
  }
  const request = buildDispatchRequest(booking, driver, vehicle);
  try {
    // Server-side: the booking must be this vendor's, the driver and vehicle its own and approved,
    // the vehicle large enough with valid documents, and neither already committed around the pickup.
    await callFunction('vendorAssignDriver', request, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new VendorActionError('dispatch-rejected', err.message);
    throw err;
  }
  settleBooking(booking.id);
}

// ── Fleet vehicles ─────────────────────────────────────────────────────────

const VEHICLE_STATUSES: VehicleStatus[] = ['Active', 'Maintenance', 'Inactive'];

export function mapVehicle(id: string, d: DocumentData): FleetVehicle {
  const docStatus = str(d.docStatus);
  return {
    id,
    vehicleNumber: str(d.vehicleNumber || d.number),
    category: str(d.category) || 'Sedan',
    make: str(d.make),
    model: str(d.model || d.name),
    year: str(d.year),
    color: str(d.color || d.colour),
    seatingCapacity: num(d.seatingCapacity || d.seats, 4),
    fuelType: str(d.fuelType || d.fuel),
    status: VEHICLE_STATUSES.includes(d.status) ? d.status : 'Active',
    docStatus: docStatus === 'Approved' || docStatus === 'Rejected' ? docStatus : 'Pending',
    rejectionReason: str(d.rejectionReason),
    assignedDriverId: str(d.assignedDriverId),
    assignedDriverName: str(d.assignedDriverName),
    rcNumber: str(d.rcNumber),
    rcDocUrl: str(d.rcDocUrl),
    insuranceExpiry: str(d.insuranceExpiry),
    insuranceDocUrl: str(d.insuranceDocUrl),
    fitnessExpiry: str(d.fitnessExpiry),
    fitnessDocUrl: str(d.fitnessDocUrl),
    permitExpiry: str(d.permitExpiry),
    statePermitDocUrl: str(d.statePermitDocUrl),
  };
}

export function subscribeToFleetVehicles(vendorId: string, cb: (v: FleetVehicle[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'vehicles'), where('vendorId', '==', vendorId)),
    (snap) => cb(snap.docs.map((d) => mapVehicle(d.id, d.data())).sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber))),
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

export type VehicleInput = Omit<FleetVehicle, 'id' | 'docStatus' | 'rejectionReason' | 'assignedDriverId' | 'assignedDriverName'>;

export function newVehicleId(): string {
  return doc(collection(db, 'vehicles')).id;
}

/** New vehicles always start docStatus 'Pending' for NESAM review (rules). */
export function buildNewVehicleDoc(vendor: VendorIdentity, id: string, v: VehicleInput) {
  return {
    id,
    ...v,
    vehicleNumber: v.vehicleNumber.trim().toUpperCase(),
    rcNumber: v.rcNumber.trim().toUpperCase(),
    vendorId: vendor.id,
    vendorName: vendor.companyName,
    docStatus: 'Pending',
    assignedDriverId: '',
    assignedDriverName: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function addVehicle(vendor: VendorIdentity, id: string, v: VehicleInput, existing: FleetVehicle[]): Promise<void> {
  const reg = v.vehicleNumber.trim().toUpperCase().replace(/[\s-]/g, '');
  if (existing.some((x) => x.vehicleNumber.toUpperCase().replace(/[\s-]/g, '') === reg)) {
    throw new VendorActionError('duplicate', 'This vehicle is already in your fleet.');
  }
  await withTimeout(setDoc(doc(db, 'vehicles', id), buildNewVehicleDoc(vendor, id, v)), 15000);
}

/** Document changes send the vehicle back to NESAM review. */
export async function updateVehicleDocuments(id: string, patch: Partial<VehicleInput>): Promise<void> {
  await withTimeout(updateDoc(doc(db, 'vehicles', id), { ...patch, docStatus: 'Pending', updatedAt: serverTimestamp() }), 15000);
}

export async function setVehicleStatus(id: string, status: VehicleStatus): Promise<void> {
  await withTimeout(updateDoc(doc(db, 'vehicles', id), { status, updatedAt: serverTimestamp() }), 15000);
}

export async function deleteVehicle(v: FleetVehicle): Promise<void> {
  if (v.assignedDriverId) throw new VendorActionError('assigned', `Unassign ${v.assignedDriverName || 'the driver'} before removing this vehicle.`);
  // firestore.rules: approved vehicles are kept for trip history; they can only be deactivated.
  if (v.docStatus === 'Approved') throw new VendorActionError('approved', 'Approved vehicles can’t be removed. Set the vehicle to Inactive instead.');
  await withTimeout(deleteDoc(doc(db, 'vehicles', v.id)), 15000);
}

// ── Fleet drivers ──────────────────────────────────────────────────────────

export function mapFleetDriver(id: string, d: DocumentData): FleetDriver {
  const li = d.licenseInfo || {};
  const vi = d.vehicleInfo || {};
  return {
    id,
    name: str(d.name) || 'Driver',
    phone: str(d.phone),
    photoUrl: str(d.photoUrl),
    approvalStatus: str(d.status) || 'Pending',
    presenceStatus: str(d.presenceStatus) || 'Offline',
    fleetStatus: d.fleetStatus === 'Suspended' ? 'Suspended' : 'Active',
    licenseNumber: str(li.number || d.licenseNumber),
    licenseExpiry: str(li.expiryDate || d.licenseExpiry),
    vehicleType: str(vi.vehicleType || d.vehicleType),
    ownVehicleNumber: str(vi.vehicleNumber || d.vehicleNumber),
    assignedVehicleId: str(d.assignedVehicleId),
    assignedVehicleNumber: str(d.assignedVehicleNumber),
    rating: num(d.rating, 5),
    docStatus: str(d.docStatus) || 'Pending',
  };
}

export function subscribeToFleetDrivers(vendorId: string, cb: (d: FleetDriver[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'drivers'), where('vendorId', '==', vendorId)),
    (snap) => cb(snap.docs.map((d) => mapFleetDriver(d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name))),
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

/**
 * Links a vehicle to a driver (or unlinks with vehicle = null). Writes only
 * the fleet fields the rules allow on drivers/{id} and keeps the vehicle's
 * assignedDriver fields in step, releasing any previous pairing.
 */
export async function assignVehicle(driver: FleetDriver, vehicle: FleetVehicle | null, vehicles: FleetVehicle[]): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'drivers', driver.id), {
    assignedVehicleId: vehicle?.id ?? '',
    assignedVehicleNumber: vehicle?.vehicleNumber ?? '',
    updatedAt: serverTimestamp(),
  });
  // Release whatever this driver or this vehicle was paired with before.
  for (const v of vehicles) {
    const wasDriversVehicle = v.assignedDriverId === driver.id && v.id !== vehicle?.id;
    if (wasDriversVehicle) batch.update(doc(db, 'vehicles', v.id), { assignedDriverId: '', assignedDriverName: '', updatedAt: serverTimestamp() });
  }
  if (vehicle) {
    batch.update(doc(db, 'vehicles', vehicle.id), { assignedDriverId: driver.id, assignedDriverName: driver.name, updatedAt: serverTimestamp() });
    if (vehicle.assignedDriverId && vehicle.assignedDriverId !== driver.id) {
      batch.update(doc(db, 'drivers', vehicle.assignedDriverId), { assignedVehicleId: '', assignedVehicleNumber: '', updatedAt: serverTimestamp() });
    }
  }
  await withTimeout(batch.commit(), 15000);
}

export async function setDriverFleetStatus(driverId: string, fleetStatus: 'Active' | 'Suspended'): Promise<void> {
  await withTimeout(updateDoc(doc(db, 'drivers', driverId), { fleetStatus, updatedAt: serverTimestamp() }), 15000);
}

// ── Driver invites ─────────────────────────────────────────────────────────

export function subscribeToInvites(vendorId: string, cb: (i: DriverInviteRecord[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'driver_invites'), where('vendorId', '==', vendorId)),
    (snap) =>
      cb(
        snap.docs
          .map((d) => {
            const x = d.data();
            return { phone: d.id, name: str(x.name), vehicleAssignment: str(x.vehicleAssignment), createdAt: toDate(x.createdAt) };
          })
          .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)),
      ),
    () => cb([]),
  );
}

/** Pre-registers a driver by phone (doc id = +91XXXXXXXXXX). Never pre-approved. */
export async function inviteDriver(vendor: VendorIdentity, mobile10: string, vehicleNumber: string): Promise<void> {
  if (!/^[6-9]\d{9}$/.test(mobile10)) throw new VendorActionError('invalid-phone', 'Enter a valid 10-digit mobile number.');
  const phone = `+91${mobile10}`;
  try {
    await withTimeout(
      setDoc(doc(db, 'driver_invites', phone), {
        phone,
        vendorId: vendor.id,
        vendorName: vendor.companyName,
        vehicleAssignment: vehicleNumber.trim().toUpperCase() || null,
        preApproved: false,
        createdAt: serverTimestamp(),
      }),
      15000,
    );
  } catch (err) {
    if ((err as { code?: string })?.code === 'permission-denied') {
      throw new VendorActionError('taken', 'This number has already been invited by another fleet or by NESAM.');
    }
    throw err;
  }
}

export async function revokeInvite(phone: string): Promise<void> {
  await withTimeout(deleteDoc(doc(db, 'driver_invites', phone)), 15000);
}

// ── Payouts ────────────────────────────────────────────────────────────────

/** The server-computed wallet (wallets/vendor_{uid}); a missing document is an empty wallet. */
export function subscribeToVendorWallet(vendorId: string, cb: (w: WalletDetails) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    doc(db, 'wallets', `vendor_${vendorId}`),
    (snap) => cb(mapWallet(snap.exists() ? snap.data() : undefined)),
    (err) => onError?.(err),
  );
}

/** This vendor's ledger entries (schema 2), newest first. */
export function subscribeToVendorLedger(vendorId: string, cb: (entries: LedgerRecord[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'wallet_ledger'), where('vendorId', '==', vendorId)),
    (snap) => {
      const rows = snap.docs.map((d) => mapLedgerEntry(d.id, d.data())).filter((e): e is LedgerRecord => e !== null);
      rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      cb(rows);
    },
    (err) => {
      cb([]);
      onError?.(err);
    },
  );
}

export function subscribeToVendorPayouts(vendorId: string, cb: (p: VendorPayoutRequest[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'payout_requests'), where('vendorId', '==', vendorId)),
    (snap) => {
      const rows = snap.docs.map((d) => {
        const x = d.data();
        const created = toDate(x.createdAt);
        return {
          id: d.id,
          amount: num(x.amount),
          method: (x.method === 'Bank Transfer' || x.payoutMethod === 'Bank Transfer' ? 'Bank Transfer' : 'UPI') as VendorPayoutRequest['method'],
          details: str(x.details || x.targetDetails),
          status: str(x.status) || 'Pending',
          requestedAt: str(x.requestedAt) || (created ? created.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''),
          utr: str(x.utr || x.transactionRef || x.referenceId),
          processedAt: str(x.processedAt),
          createdMs: created?.getTime() ?? 0,
        };
      });
      rows.sort((a, b) => b.createdMs - a.createdMs);
      cb(rows);
    },
    () => cb([]),
  );
}

export function validateVendorPayout(amount: number, available: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount.';
  if (!Number.isInteger(amount)) return 'Enter a whole-rupee amount.';
  if (amount < MIN_PAYOUT) return `Minimum payout is ₹${MIN_PAYOUT}.`;
  if (amount > available) return 'Amount exceeds your available balance.';
  return '';
}

/** The server re-checks the ledger balance, reserves the amount and pays to the account in the vendor's KYC. */
export async function requestVendorPayout(amount: number, available: number, method: 'UPI' | 'Bank Transfer'): Promise<void> {
  const invalid = validateVendorPayout(amount, available);
  if (invalid) throw new VendorActionError('invalid-amount', invalid);
  const ref = doc(collection(db, 'payout_requests'));
  await callBackend('requestPartnerPayout', { requestId: ref.id, role: 'vendor', amount, method });
  settlePayout(ref.id);
}
