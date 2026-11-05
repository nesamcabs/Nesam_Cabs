import { callBackend, settleBooking, settlePayout } from './backend';
import { ActionError, callFunction } from './callables';
// Driver data layer. Copied from driver/web/src/services/driverFirestoreService.ts
// and adapted for the mobile app:
//   • the marketplace claim runs in a transaction that re-checks the offer is
//     still Open (on top of firestore.rules driverClaimOk), so two phones can
//     never both win a trip and the loser gets a clear "taken" error;
//   • the driver's live position is written to bookings/{id}.driverLocation
//     during a trip (driverProgressOk allows it) so the customer can track;
//   • the boarding OTP is only ever submitted as `otpAttempt` — the driver
//     never reads booking_secrets; a wrong code is rejected by the rules.

import {
  writeBatch,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import type {
  ApprovalStatus,
  BankDetails,
  BookingStatus,
  DocumentStatus,
  DriverAccount,
  DriverNotification,
  DriverPenalty,
  DriverProfile,
  DriverStatus,
  DriverWallet,
  DrivingLicense,
  IdentityDetails,
  LedgerEntry,
  MarketplaceOffer,
  PayoutRequest,
  PenaltyStatus,
  RegistrationData,
  TollReceipt,
  TripDetails,
  TripStage,
  VahanSnapshot,
  VehicleCategory,
  VehicleDetails,
} from '../types/driver';
import { withTimeout } from '../utils/retry';
import { normalizeAadhaar, normalizePan } from '../validation/kyc';
import { toDate as toDateTime } from '../utils/time';
import { tripSubStatusOf } from '../utils/tripFlow';
import { mapLedgerEntry, mapWallet } from '../utils/ledger';
import { categoryOf, ctaOf, severityOf, soundOf } from '../utils/notificationModel';

export const BOOKINGS_COLLECTION = 'bookings';
export const DRIVERS_COLLECTION = 'drivers';
export const MARKETPLACE_COLLECTION = 'marketplace_trips';
export const PAYOUT_REQUESTS_COLLECTION = 'payout_requests';
export const NOTIFICATIONS_COLLECTION = 'notifications';
export const DRIVER_INVITES_COLLECTION = 'driver_invites';

const WRITE_TIMEOUT_MS = 15000;
/** Share of the fare a driver earns when the booking carries no explicit payout. */
export const MIN_PAYOUT = 100;

export class DriverActionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── Small helpers ──────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function parseAmount(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(str(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'object' && typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateTime(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Formats an E.164 Indian number (+919876543210) as "+91 98765 43210". */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return e164;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

// ── Empty records ──────────────────────────────────────────────────────────

export const EMPTY_IDENTITY: IdentityDetails = { aadhaarNumber: '', aadhaarFrontUrl: '', aadhaarBackUrl: '', panNumber: '', panPhotoUrl: '' };
export const EMPTY_LICENSE: DrivingLicense = { number: '', expiryDate: '', frontPhotoUrl: '', backPhotoUrl: '' };
export const EMPTY_VEHICLE: VehicleDetails = {
  vehicleNumber: '',
  vehicleType: 'Sedan',
  make: '',
  model: '',
  year: '',
  color: '',
  capacity: 4,
  fuelType: 'Diesel',
  rcNumber: '',
  rcDocUrl: '',
  insuranceNumber: '',
  insuranceExpiry: '',
  insuranceDocUrl: '',
  fitnessExpiry: '',
  fitnessDocUrl: '',
  statePermitNumber: '',
  permitExpiry: '',
  statePermitDocUrl: '',
  frontPhotoUrl: '',
  rearPhotoUrl: '',
  sidePhotoUrl: '',
  interiorPhotoUrl: '',
};
export const EMPTY_BANK: BankDetails = { accountHolder: '', accountNumber: '', ifsc: '', bankName: '', upiId: '' };

export function emptyRegistration(phone: string): RegistrationData {
  return {
    profile: { name: '', phone, email: '', photoUrl: '', dob: '', gender: '', address: '', city: '', pincode: '', emergencyContactName: '', emergencyContact: '' },
    identity: { ...EMPTY_IDENTITY },
    license: { ...EMPTY_LICENSE },
    vehicle: { ...EMPTY_VEHICLE },
    bank: { ...EMPTY_BANK },
  };
}

// ── Driver account (drivers/{uid}) ─────────────────────────────────────────

const APPROVAL_VALUES: ApprovalStatus[] = ['Pending', 'Approved', 'Rejected', 'Suspended'];
const DOC_VALUES: DocumentStatus[] = ['Pending', 'Approved', 'Rejected'];

function pickStrings(src: DocumentData, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (src[k] != null) out[k] = str(src[k]);
  return out;
}

/** Shown until staff record the name from the driving licence: "Driver ••3210". */
export function fallbackName(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `Driver ••${digits.slice(-4)}` : 'NESAM Driver';
}

export function mapDriverDoc(uid: string, data: DocumentData): DriverAccount {
  const approval = APPROVAL_VALUES.includes(data.status) ? (data.status as ApprovalStatus) : 'Pending';
  const docStatus = DOC_VALUES.includes(data.docStatus) ? (data.docStatus as DocumentStatus) : 'Pending';
  const presence: DriverStatus = data.presenceStatus === 'Online' || data.presenceStatus === 'On Trip' ? data.presenceStatus : 'Offline';
  const created = toDate(data.createdAt);

  const driver: DriverProfile = {
    id: uid,
    // Onboarding no longer asks for a name; staff set it from the licence at review.
    name: str(data.name) || fallbackName(str(data.phone)),
    phone: str(data.phone),
    email: str(data.email),
    photoUrl: str(data.photoUrl),
    dob: str(data.dob),
    gender: str(data.gender),
    address: str(data.address),
    city: str(data.city),
    pincode: str(data.pincode),
    emergencyContactName: str(data.emergencyContactName),
    emergencyContact: str(data.emergencyContact),
    // Only a rating backed by real customer reviews is shown.
    rating: typeof data.rating === 'number' && typeof data.ratingCount === 'number' && data.ratingCount > 0 ? data.rating : null,
    joiningDate: created ? created.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : str(data.joiningDate) || 'New Partner',
    vendorId: data.vendorId || undefined,
    vendorName: data.vendorName || undefined,
    assignedVehicleId: str(data.assignedVehicleId) || undefined,
    approvalStatus: approval,
    docStatus,
    rejectionReason: data.rejectionReason || undefined,
    presenceStatus: presence,
  };

  const li = data.licenseInfo || {};
  const vi = data.vehicleInfo || {};
  const id = data.identity || {};
  const bank = data.bank || {};

  return {
    driver,
    profile: {
      name: driver.name,
      phone: driver.phone,
      email: driver.email,
      photoUrl: driver.photoUrl,
      dob: driver.dob,
      gender: driver.gender,
      address: driver.address,
      city: driver.city,
      pincode: driver.pincode,
      emergencyContactName: driver.emergencyContactName,
      emergencyContact: driver.emergencyContact,
    },
    identity: { ...EMPTY_IDENTITY, ...pickStrings(id, Object.keys(EMPTY_IDENTITY)) },
    license: {
      ...EMPTY_LICENSE,
      ...pickStrings(li, Object.keys(EMPTY_LICENSE)),
      number: str(li.number || data.licenseNumber),
      expiryDate: str(li.expiryDate || data.licenseExpiry),
    },
    vehicle: {
      ...EMPTY_VEHICLE,
      ...pickStrings(vi, Object.keys(EMPTY_VEHICLE).filter((k) => k !== 'capacity')),
      vehicleType: (vi.vehicleType || 'Sedan') as VehicleCategory,
      capacity: typeof vi.capacity === 'number' ? vi.capacity : 4,
      ...(vi.vahan && typeof vi.vahan === 'object' ? { vahan: vi.vahan as VahanSnapshot } : {}),
    },
    bank: { ...EMPTY_BANK, ...pickStrings(bank, Object.keys(EMPTY_BANK)) },
  };
}

export function subscribeToDriverAccount(uid: string, callback: (account: DriverAccount | null) => void, onError?: (error: unknown) => void) {
  let profile: Record<string, unknown> | null | undefined;
  let privateFields: Record<string, unknown> | undefined;
  const emit = () => {
    if (profile === undefined || privateFields === undefined) return;
    callback(profile ? mapDriverDoc(uid, { ...profile, ...privateFields }) : null);
  };
  const a = onSnapshot(doc(db, DRIVERS_COLLECTION, uid), snap => {
    if (!snap.exists() && snap.metadata.fromCache) return;
    profile = snap.exists() ? snap.data() : null; emit();
  }, err => onError?.(err));
  const b = onSnapshot(doc(db, 'driver_private', uid), snap => {
    if (!snap.exists() && snap.metadata.fromCache) return;
    privateFields = snap.data() ?? {}; emit();
  }, err => onError?.(err));
  return () => { a(); b(); };
}
export interface DriverInvite {
  name?: string;
  vendorId?: string;
  vendorName?: string;
  preApproved?: boolean;
}

/** An admin or vendor may pre-register a driver by phone number. */
export async function getDriverInvite(phoneE164: string): Promise<DriverInvite | null> {
  if (!phoneE164) return null;
  try {
    const snap = await getDoc(doc(db, DRIVER_INVITES_COLLECTION, phoneE164));
    return snap.exists() ? (snap.data() as DriverInvite) : null;
  } catch {
    return null;
  }
}

/** Write operational and private fields atomically; no bank/identity data leaks to vendor readers. */
async function writeDriverProfile(uid: string, payload: Record<string, unknown>, create = false): Promise<void> {
  const { bank, identity, ...publicFields } = payload;
  const batch = writeBatch(db);
  const ref = doc(db, DRIVERS_COLLECTION, uid);
  if (create) batch.set(ref, publicFields); else batch.update(ref, publicFields);
  if (bank || identity) batch.set(doc(db, 'driver_private', uid), {
    ...(bank ? { bank } : {}), ...(identity ? { identity } : {}), updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
}
/**
 * What onboarding writes (spec page 13): selfie, licence, and — for an owner
 * driver — the vehicle with its RC, insurance, FC, permit and front photo.
 * Nothing else is touched, so a resubmission never overwrites contact or payout
 * details the driver saved later in the profile.
 */
export function registrationFields(data: RegistrationData, opts: { fleetDriver?: boolean } = {}) {
  const v = data.vehicle;
  const plate = v.vehicleNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const licenceNo = data.license.number.trim().toUpperCase();
  const vehicle = opts.fleetDriver || !plate
    ? {}
    : {
        vehicleInfo: { ...v, vehicleNumber: plate, rcNumber: plate },
        vehicleNumber: plate,
        vehicleType: v.vehicleType,
        vehicle: [v.make, v.model].filter(Boolean).join(' ') ? `${[v.make, v.model].filter(Boolean).join(' ')} • ${plate}` : plate,
      };
  return {
    photoUrl: data.profile.photoUrl,
    licenseInfo: { ...data.license, number: licenceNo },
    licenseNumber: licenceNo,
    licenseExpiry: data.license.expiryDate,
    license: 'Submitted',
    ...vehicle,
    docStatus: 'Pending',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

/**
 * Aadhaar / PAN numbers and photos the driver entered, for driver_private (never the vendor-readable drivers doc).
 * Blank fields are left out and the write merges, so a partial update never clears a saved value. firestore.rules
 * accept an identity change only together with docStatus 'Pending', i.e. with a document resubmission for review.
 */
export function identityFields(data: RegistrationData, original?: Partial<IdentityDetails>): { identity?: Partial<IdentityDetails> } {
  const id = data.identity ?? EMPTY_IDENTITY;
  const cleaned: IdentityDetails = { ...EMPTY_IDENTITY, ...id, aadhaarNumber: normalizeAadhaar(id.aadhaarNumber), panNumber: normalizePan(id.panNumber) };
  const saved: IdentityDetails = { ...EMPTY_IDENTITY, ...(original ?? {}), aadhaarNumber: normalizeAadhaar(original?.aadhaarNumber), panNumber: normalizePan(original?.panNumber) };
  // Only what is entered and differs from what is already saved: unchanged values are not rewritten, blanks never erase.
  const entered = Object.fromEntries(
    (Object.keys(cleaned) as (keyof IdentityDetails)[])
      .map((k) => [k, (cleaned[k] ?? '').trim()] as const)
      .filter(([k, v]) => v !== '' && v !== (saved[k] ?? '').trim()),
  ) as Partial<IdentityDetails>;
  return Object.keys(entered).length ? { identity: entered } : {};
}

/** The drivers/{uid} document firestore.rules (driverSelfCreateOk) accepts. */
export function buildNewDriverDoc(uid: string, phoneE164: string, data: RegistrationData, invite: DriverInvite | null) {
  return {
    ...registrationFields(data, { fleetDriver: !!invite?.vendorId }),
    uid,
    id: uid,
    // An invitation may carry the name the vendor or NESAM entered; otherwise staff add it from the licence.
    name: data.profile.name.trim(),
    phone: phoneE164 ? formatPhone(phoneE164) : data.profile.phone,
    phoneE164,
    role: 'driver',
    status: invite?.preApproved ? 'Approved' : 'Pending',
    verified: false,
    vendorId: invite?.vendorId || '',
    vendorName: invite?.vendorName || '',
    presenceStatus: 'Offline',
    createdAt: serverTimestamp(),
  };
}

/** Creates drivers/{uid}; Pending until an admin approves (unless pre-approved by invite). */
export async function registerDriver(data: RegistrationData): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new DriverActionError('unauthenticated', 'Your session has expired. Please sign in again.');
  const phoneE164 = user.phoneNumber || '';
  const invite = await getDriverInvite(phoneE164);
  await withTimeout(writeDriverProfile(user.uid, { ...buildNewDriverDoc(user.uid, phoneE164, data, invite), ...identityFields(data) }, true), WRITE_TIMEOUT_MS);
}

/**
 * Updates KYC details. A rejected driver goes back to 'Pending' for another
 * review; an approved driver stays approved but docStatus drops to 'Pending'.
 */
export async function resubmitDriverDocuments(uid: string, data: RegistrationData, currentStatus: ApprovalStatus, opts: { fleetDriver?: boolean; originalIdentity?: Partial<IdentityDetails> } = {}): Promise<void> {
  await withTimeout(
    writeDriverProfile(uid, {
      ...registrationFields(data, opts),
      ...identityFields(data, opts.originalIdentity),
      ...(currentStatus === 'Rejected' ? { status: 'Pending', rejectionReason: '' } : {}),
    }),
    WRITE_TIMEOUT_MS,
  );
}

export type ContactFields = Pick<DriverProfile, 'email' | 'dob' | 'address' | 'city' | 'pincode' | 'emergencyContactName' | 'emergencyContact'> & {
  bank: BankDetails;
};

/** Contact / payout details that don't need re-verification. */
export async function updateDriverContactDetails(uid: string, fields: ContactFields): Promise<void> {
  await withTimeout(writeDriverProfile(uid, { ...fields, updatedAt: serverTimestamp() }), WRITE_TIMEOUT_MS);
}

/** Online/offline presence: `presenceStatus`, never `status` (admin approval). */
export async function setDriverPresence(uid: string, presence: DriverStatus): Promise<void> {
  await withTimeout(
    writeDriverProfile(uid, { presenceStatus: presence, lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    WRITE_TIMEOUT_MS,
  );
}

// ── Marketplace ────────────────────────────────────────────────────────────

export function mapOffer(id: string, data: DocumentData): MarketplaceOffer & { createdMs: number } {
  const pickup = typeof data.pickup === 'object' && data.pickup ? data.pickup : { address: str(data.pickup) };
  const drop = typeof data.drop === 'object' && data.drop ? data.drop : { address: str(data.drop) };
  return {
    id,
    bookingId: str(data.bookingId) || id,
    pickup: {
      address: str(pickup.address || pickup.city) || 'Pickup location',
      lat: typeof pickup.lat === 'number' ? pickup.lat : undefined,
      lng: typeof pickup.lng === 'number' ? pickup.lng : undefined,
    },
    drop: {
      address: str(drop.address || drop.city) || 'Drop location',
      lat: typeof drop.lat === 'number' ? drop.lat : undefined,
      lng: typeof drop.lng === 'number' ? drop.lng : undefined,
    },
    pickupTime: str(pickup.time),
    travelDate: str(data.travelDate),
    vehicleCategory: str(data.vehicleCategory || data.categoryName),
    distanceKm: parseAmount(data.distanceKm),
    offeredPayout: parseAmount(data.offeredPayout),
    mode: data.mode === 'bid_review' ? 'bid_review' : data.mode === 'accept_offer' ? 'accept_offer' : '',
    eligibleClasses: Array.isArray(data.eligibleVehicleClasses) ? data.eligibleVehicleClasses.filter((x: unknown): x is string => typeof x === 'string') : [],
    publishedMs: toDate(data.publishedAt)?.getTime() ?? 0,
    createdMs: toDate(data.createdAt)?.getTime() ?? 0,
  };
}

export function subscribeToOpenMarketplace(callback: (offers: MarketplaceOffer[]) => void, onError?: (e: unknown) => void) {
  return onSnapshot(
    query(collection(db, MARKETPLACE_COLLECTION), where('status', '==', 'Open')),
    (snap) => {
      const offers = snap.docs.map((d) => mapOffer(d.id, d.data()));
      offers.sort((a, b) => b.createdMs - a.createdMs);
      callback(offers.map(({ createdMs: _createdMs, ...o }) => o));
    },
    (err) => {
      callback([]);
      onError?.(err);
    },
  );
}

/**
 * Takes an open marketplace duty. The claim runs on the server (claimMarketplaceDuty), which applies
 * the same checks as every other assignment — account, approved vehicle class and seats, documents
 * valid through the trip, no schedule overlap — and picks exactly one winner. The app writes nothing.
 */
export async function acceptMarketplaceTrip(driver: DriverProfile, _registeredVehicleNumber: string, offer: MarketplaceOffer): Promise<void> {
  if (driver.vendorId) throw new DriverActionError('taken', 'Fleet drivers receive trips from their vendor, not the marketplace.');
  try {
    await callFunction('claimMarketplaceDuty', { bookingId: offer.id }, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new DriverActionError('taken', err.message);
    throw err;
  }
}

/** Sends an owner-driver's counter amount for a duty NESAM reviews bids on. */
export async function submitDutyBid(offer: MarketplaceOffer, rate: number, note: string): Promise<void> {
  try {
    await callFunction('submitMarketplaceBid', { tripId: offer.id, rate, note: note.trim().slice(0, 300) }, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new DriverActionError('closed', err.message);
    throw err;
  }
}

/** Withdraws this driver's pending bid on a duty (the bid document id is "driver_<uid>"; the server checks ownership and status). */
export async function withdrawDutyBid(offer: MarketplaceOffer): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new DriverActionError('closed', 'Sign in again to withdraw your bid.');
  try {
    await callFunction('withdrawMarketplaceBid', { tripId: offer.id, bidId: `driver_${uid}` }, 30000);
  } catch (err) {
    if (err instanceof ActionError) throw new DriverActionError('closed', err.message);
    throw err;
  }
}

/**
 * The operating limits the server applies to trip steps (settings/operations, readable by every signed-in user).
 * Same defaults and ranges as functions/src/trips.ts. A null result means the settings could not be read; the screen
 * then does not guess and the server's own message is shown instead.
 */
export interface TripRules {
  /** How long before the pickup time the first trip step (Reached Pickup) opens. */
  startWindowMs: number;
  pickupRadiusKm: number;
}

export function parseTripRules(d: Record<string, unknown> | undefined): TripRules {
  const n = (v: unknown, dflt: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
  return { startWindowMs: n(d?.tripStartWindowMinutes, 360, 15, 4320) * 60000, pickupRadiusKm: n(d?.pickupRadiusKm, 3, 0.1, 25) };
}

export function subscribeToTripRules(callback: (rules: TripRules | null) => void) {
  return onSnapshot(
    doc(db, 'settings', 'operations'),
    (snap) => callback(parseTripRules(snap.data())),
    () => callback(null),
  );
}

// ── Assigned bookings / trip execution ─────────────────────────────────────

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Bookings store a location as flat fields (pickup/pickupAddress/pickupLat…) or as an object. */
function readLocation(data: DocumentData, key: 'pickup' | 'drop', fallback: string) {
  const v = data[key];
  if (v && typeof v === 'object') {
    return {
      address: str(v.address || v.name || data[`${key}Address`]) || fallback,
      lat: num(v.lat) ?? num(data[`${key}Lat`]),
      lng: num(v.lng) ?? num(data[`${key}Lng`]),
    };
  }
  return { address: str(data[`${key}Address`] || v) || fallback, lat: num(data[`${key}Lat`]), lng: num(data[`${key}Lng`]) };
}

const STAGES: TripStage[] = ['Assigned', 'En Route Pickup', 'Reached Pickup', 'In Progress', 'Arrived Destination', 'Completed'];
const STATUSES: BookingStatus[] = ['Pending', 'Approved', 'Confirmed', 'Assigned', 'Ongoing', 'Completed', 'Cancelled', 'Rejected'];
const LEGACY_STAGE: Record<string, TripStage> = { 'Not Started': 'Assigned', 'Reached Pickup': 'Reached Pickup', 'Trip Started': 'In Progress', 'Trip Ended': 'Completed' };

export function mapBooking(id: string, data: DocumentData): TripDetails {
  const fare = parseAmount(data.fare);
  const raw = str(data.status);
  const status: BookingStatus = (STATUSES as string[]).includes(raw) ? (raw as BookingStatus) : raw === 'Trip Started' ? 'Ongoing' : 'Pending';
  const subStatus = tripSubStatusOf(data);
  // The server mirrors the sub-status into tripStage; trips from before it existed keep their own stage.
  let stage: TripStage = STAGES.includes(data.tripStage) ? data.tripStage : (LEGACY_STAGE[subStatus] ?? 'Assigned');
  if (status === 'Completed') stage = 'Completed';

  // The server records the payout; the app never estimates one. Once finance has
  // finalized the trip, its snapshot is the amount that counts.
  const fin = data.finance && typeof data.finance === 'object' && data.finance.schema === 1 ? data.finance : null;
  const finalized = !!fin && fin.partnerType === 'driver' && typeof fin.partnerPayout === 'number' && Number.isFinite(fin.partnerPayout);
  const payoutRecorded = finalized || (data.driverPayout != null && data.driverPayout !== '');
  const payout = finalized ? fin.partnerPayout : payoutRecorded ? parseAmount(data.driverPayout) : 0;
  const preTrip = data.preTrip && typeof data.preTrip === 'object' ? data.preTrip : undefined;

  return {
    id,
    bookingId: str(data.bookingId) || id,
    customerName: str(data.passengerName || data.customer || data.customerName) || 'Passenger',
    // The raw number is not on the booking; it is revealed on demand (T-8h) by getCustomerContact.
    customerPhone: '',
    customerPhoneMasked: str(data.phoneMasked),
    pickup: readLocation(data, 'pickup', 'Pickup location'),
    drop: readLocation(data, 'drop', 'Drop location'),
    distanceKm: parseAmount(data.distanceKm),
    vehicleType: str(data.categoryName || data.vehicleCategory || data.vehicle),
    serviceType: str(data.service),
    fareAmount: fare,
    driverEarnings: payout,
    payoutRecorded,
    payoutFinalized: finalized,
    fleetTrip: !!str(data.assignedVendorId) || fin?.partnerType === 'vendor',
    tollCharges: parseAmount(data.tollCharges),
    status,
    stage,
    subStatus: status === 'Completed' ? 'Trip Ended' : subStatus,
    verificationSubmitted: data.vehicleVerification?.status === 'Submitted',
    // Trips started under the earliest flow checked the OTP at start and kept no boarding stamp.
    boardingVerified: !!data.boardingVerifiedAt || (!!data.startedAt && !data.tripStartedAt),
    balanceDue: typeof data.paymentSummary?.balanceDue === "number" ? data.paymentSummary.balanceDue : undefined,
    totalPaid: typeof data.paymentSummary?.totalPaid === "number" ? data.paymentSummary.totalPaid : undefined,
    fareLines: Array.isArray(data.fareBreakup?.lines) ? data.fareBreakup.lines : undefined,
    reachedPickupAt: toDateTime(data.reachedPickupAt),
    acceptedAt: toDateTime(data.acceptedAt) ?? toDateTime(data.assignedAt),
    cancellationRequest: data.cancellationRequest && typeof data.cancellationRequest === 'object' && data.cancellationRequest.partyType === 'driver'
      ? { requestId: str(data.cancellationRequest.requestId), status: str(data.cancellationRequest.status), quotedPenalty: parseAmount(data.cancellationRequest.quotedPenalty) }
      : null,
    extraUsage: data.extraUsage && typeof data.extraUsage === 'object' && typeof data.extraUsage.revision === 'number'
      ? { revision: data.extraUsage.revision, status: data.extraUsage.status, reviewNote: str(data.extraUsage.reviewNote), usage: data.extraUsage.usage ?? { stops: null, hill: null, carrier: null } }
      : null,
    driverResponse: data.driverResponse && typeof data.driverResponse === 'object' && data.driverResponse.driverId === data.assignedDriverId
      ? { viewedAt: toDateTime(data.driverResponse.viewedAt), acknowledgedAt: toDateTime(data.driverResponse.acknowledgedAt) }
      : null,
    pickupAt: toDateTime(data.pickupAt) ?? toDateTime(data.scheduledAt),
    scheduledDate: str(data.date),
    scheduledTime: str(data.time),
    paymentMode: str(data.paymentMethod) || 'Cash',
    notes: str(data.notes),
    startOdometer: typeof data.startOdometer === 'number' ? data.startOdometer : undefined,
    endOdometer: typeof data.endOdometer === 'number' ? data.endOdometer : undefined,
    preTrip: preTrip
      ? {
          vehicleFront: str(preTrip.vehicleFront),
          vehicleRear: str(preTrip.vehicleRear),
          vehicleInterior: str(preTrip.vehicleInterior),
          odometerReading: parseAmount(preTrip.odometerReading),
          capturedAt: str(preTrip.capturedAt),
        }
      : undefined,
    tolls: Array.isArray(data.tolls)
      ? (data.tolls as unknown[]).filter((t): t is TollReceipt => !!t && typeof t === 'object' && typeof (t as TollReceipt).amount === 'number')
      : [],
    completedAt: toDate(data.completedAt),
    assignedAt: toDate(data.assignedAt),
  };
}

/** Every booking ever assigned to this driver (active + history). */
export function subscribeToDriverBookings(driverId: string, callback: (trips: TripDetails[]) => void, onError?: (e: unknown) => void) {
  return onSnapshot(
    query(collection(db, BOOKINGS_COLLECTION), where('assignedDriverId', '==', driverId)),
    (snap) => callback(snap.docs.map((d) => mapBooking(d.id, d.data()))),
    (err) => onError?.(err),
  );
}

export function tollTotal(tolls: TollReceipt[]): number {
  return Math.round(tolls.reduce((s, t) => s + (Number.isFinite(t.amount) ? t.amount : 0), 0) * 100) / 100;
}

/** Saves toll/parking receipts as they are added so an app restart doesn't lose them. */
export async function saveTripTolls(bookingId: string, tolls: TollReceipt[]): Promise<void> {
  await withTimeout(
    updateDoc(doc(db, BOOKINGS_COLLECTION, bookingId), { tolls, tollCharges: tollTotal(tolls), updatedAt: serverTimestamp() }),
    WRITE_TIMEOUT_MS,
  );
  settleBooking(bookingId);
}

/** Live position for the customer's tracking view (allowed while Assigned/Ongoing). */
export async function updateDriverLocation(bookingId: string, loc: { lat: number; lng: number; heading: number | null }): Promise<void> {
  await updateDoc(doc(db, BOOKINGS_COLLECTION, bookingId), {
    driverLocation: { lat: loc.lat, lng: loc.lng, heading: loc.heading, updatedAt: serverTimestamp() },
    updatedAt: serverTimestamp(),
  });
}

// ── Payouts ────────────────────────────────────────────────────────────────

export function validatePayoutAmount(amount: number, available: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount.';
  if (!Number.isInteger(amount)) return 'Enter a whole-rupee amount.';
  if (amount < MIN_PAYOUT) return `Minimum payout is ₹${MIN_PAYOUT}.`;
  if (amount > available) return 'Amount exceeds your available balance.';
  return '';
}

/** The server re-checks the ledger balance, reserves the amount and pays to the account saved in the profile. */
export async function requestPayout(amount: number, available: number, method: 'UPI' | 'Bank Transfer'): Promise<void> {
  const invalid = validatePayoutAmount(amount, available);
  if (invalid) throw new DriverActionError('invalid-amount', invalid);
  const payoutRef = doc(collection(db, PAYOUT_REQUESTS_COLLECTION));
  await callBackend('requestPartnerPayout', { requestId: payoutRef.id, role: 'driver', amount, method });
  settlePayout(payoutRef.id);
}
/** The server-computed wallet (wallets/driver_{uid}); a missing document is an empty wallet. */
export function subscribeToDriverWallet(driverId: string, callback: (wallet: DriverWallet) => void, onError?: (e: unknown) => void) {
  return onSnapshot(
    doc(db, 'wallets', `driver_${driverId}`),
    (snap) => callback(mapWallet(snap.exists() ? snap.data() : undefined)),
    (err) => onError?.(err),
  );
}

/** This driver's ledger entries (schema 2), newest first. */
export function subscribeToDriverLedger(driverId: string, callback: (entries: LedgerEntry[]) => void, onError?: (e: unknown) => void) {
  return onSnapshot(
    query(collection(db, 'wallet_ledger'), where('driverId', '==', driverId)),
    (snap) => {
      const rows = snap.docs.map((d) => mapLedgerEntry(d.id, d.data())).filter((e): e is LedgerEntry => e !== null);
      rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      callback(rows);
    },
    (err) => {
      callback([]);
      onError?.(err);
    },
  );
}

export function subscribeToPayoutRequests(driverId: string, callback: (requests: PayoutRequest[]) => void, onError?: (e: unknown) => void) {
  return onSnapshot(
    query(collection(db, PAYOUT_REQUESTS_COLLECTION), where('driverId', '==', driverId)),
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data();
        const created = toDate(data.createdAt);
        return {
          id: d.id,
          amount: parseAmount(data.amount),
          requestedAt: typeof data.requestedAt === 'string' ? data.requestedAt : formatDateTime(created),
          method: (data.method === 'Bank Transfer' ? 'Bank Transfer' : 'UPI') as PayoutRequest['method'],
          details: str(data.details),
          status: str(data.status) || 'Pending',
          utr: str(data.utr || data.transactionRef || data.referenceId),
          processedAt: str(data.processedAt),
          t: created?.getTime() ?? 0,
        };
      });
      rows.sort((a, b) => b.t - a.t);
      callback(rows.map(({ t: _t, ...r }) => r));
    },
    (err) => {
      callback([]);
      onError?.(err);
    },
  );
}

// ── Notifications ──────────────────────────────────────────────────────────

export function subscribeToDriverNotifications(recipientId: string, callback: (n: DriverNotification[]) => void) {
  return onSnapshot(
    query(collection(db, NOTIFICATIONS_COLLECTION), where('recipientId', '==', recipientId)),
    (snap) => {
      const rows = snap.docs.map((d): DriverNotification => {
        const data = d.data();
        const created = toDateTime(data.createdAt);
        const base = { type: str(data.type), category: str(data.category), severity: str(data.severity), priority: str(data.priority), sound: str(data.sound), cta: data.cta, bookingId: str(data.bookingId) };
        return {
          id: d.id,
          title: str(data.title) || 'Notification',
          message: str(data.message || data.desc || data.body),
          time: formatDateTime(created),
          read: Boolean(data.read),
          createdAtMs: created?.getTime() ?? 0,
          category: categoryOf(base),
          severity: severityOf(base),
          sound: soundOf(base),
          bookingId: str(data.bookingId),
          bookingCode: str(data.bookingCode),
          ...ctaOf(base),
          popup: data.push !== false,
        };
      });
      rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
      callback(rows);
    },
    () => callback([]),
  );
}

const PENALTY_STATUSES: PenaltyStatus[] = ['Pending', 'Acknowledged', 'Paid', 'Deducted', 'Waived', 'Disputed'];
const LEGACY_PENALTY: Record<string, PenaltyStatus> = { Applied: 'Pending', Recovered: 'Paid', Reversed: 'Waived' };

/** Penalties issued to this driver (read-only here; acknowledging and disputing are server functions). */
export function subscribeToDriverPenalties(driverId: string, callback: (p: DriverPenalty[]) => void, onError?: (e: unknown) => void) {
  return onSnapshot(
    query(collection(db, 'penalties'), where('driverId', '==', driverId)),
    (snap) => {
      const rows = snap.docs.map((d): DriverPenalty => {
        const data = d.data();
        const raw = str(data.status);
        return {
          id: d.id,
          amount: parseAmount(data.amount),
          category: str(data.category) || 'Other',
          reason: str(data.reason),
          description: str(data.description || data.notes),
          bookingCode: str(data.bookingCode),
          bookingId: str(data.bookingDocumentId),
          incidentDate: str(data.incidentDate),
          status: PENALTY_STATUSES.includes(raw as PenaltyStatus) ? (raw as PenaltyStatus) : (LEGACY_PENALTY[raw] ?? 'Pending'),
          acknowledged: data.acknowledged === true,
          acknowledgedAt: toDateTime(data.acknowledgedAt),
          disputeNote: str(data.disputeNote),
          issuedAt: toDateTime(data.issuedAt) ?? toDateTime(data.createdAt),
          issuedByName: str(data.issuedByName),
        };
      });
      rows.sort((a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0));
      callback(rows);
    },
    (err) => {
      callback([]);
      onError?.(err);
    },
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, id), { read: true, readAt: serverTimestamp() });
}
