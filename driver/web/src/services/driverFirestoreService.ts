import { callBackend, settleBooking, settlePayout } from './backend';
import { callFunction } from './callables';
import { formatDateTime12 } from '../utils/time';
import { categoryOf, severityOf, soundOf, ctaOf } from '../utils/notificationModel';
import { tripSubStatusOf } from '../utils/tripFlow';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import type {
  ApprovalStatus,
  BankDetails,
  BookingStatus,
  DocumentStatus,
  DriverAccount,
  DriverNotification,
  DriverPenalty,
  PenaltyStatus,
  DriverProfile,
  DriverWallet,
  DriverStatus,
  DrivingLicense,
  IdentityDetails,
  LedgerEntry,
  MarketplaceOffer,
  PayoutRequest,
  RegistrationData,
  TollReceipt,
  TripDetails,
  TripStage,
  VehicleCategory,
  VehicleDetails,
} from '../types';
import { mapLedgerEntry, mapWallet } from './driverEarnings';

export const BOOKINGS_COLLECTION = 'bookings';
export const DRIVERS_COLLECTION = 'drivers';
export const VEHICLES_COLLECTION = 'vehicles';
export const MARKETPLACE_COLLECTION = 'marketplace_trips';
export const PAYOUT_REQUESTS_COLLECTION = 'payout_requests';
export const NOTIFICATIONS_COLLECTION = 'notifications';
export const DRIVER_INVITES_COLLECTION = 'driver_invites';

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
  if (typeof v === 'object' && v && typeof (v as { toDate?: unknown }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** "07 Oct 2026, 06:30 PM" — 12-hour, India time. */
export function formatDateTime(d: Date | null): string {
  return d ? formatDateTime12(d) : '';
}

/** Human-readable message for a Firestore write failure. */
export function describeFirestoreError(error: unknown, fallback: string): string {
  const code = (error as { code?: string })?.code ?? '';
  console.error('[Firestore - Driver]', code, error);
  if (code === 'permission-denied') return fallback;
  if (code === 'unavailable') return 'You appear to be offline. Please check your internet connection.';
  if (code === 'not-found') return 'This record no longer exists.';
  return (error as Error)?.message || fallback;
}

// ── Empty records ──────────────────────────────────────────────────────────

export const EMPTY_IDENTITY: IdentityDetails = {
  aadhaarNumber: '', aadhaarFrontUrl: '', aadhaarBackUrl: '', panNumber: '', panPhotoUrl: '',
};

export const EMPTY_LICENSE: DrivingLicense = {
  number: '', expiryDate: '', frontPhotoUrl: '', backPhotoUrl: '',
};

export const EMPTY_VEHICLE: VehicleDetails = {
  vehicleNumber: '', vehicleType: 'Sedan', make: '', model: '', year: '', color: '',
  capacity: 4, fuelType: 'Diesel',
  rcNumber: '', rcDocUrl: '',
  insuranceNumber: '', insuranceExpiry: '', insuranceDocUrl: '',
  fitnessExpiry: '', fitnessDocUrl: '',
  statePermitNumber: '', permitExpiry: '', statePermitDocUrl: '',
  frontPhotoUrl: '', rearPhotoUrl: '', sidePhotoUrl: '', interiorPhotoUrl: '',
};

export const EMPTY_BANK: BankDetails = {
  accountHolder: '', accountNumber: '', ifsc: '', bankName: '', upiId: '',
};

export function emptyRegistration(phone: string): RegistrationData {
  return {
    profile: {
      name: '', phone, email: '', photoUrl: '', dob: '', gender: '', address: '',
      city: '', pincode: '', emergencyContactName: '', emergencyContact: '',
    },
    identity: { ...EMPTY_IDENTITY },
    license: { ...EMPTY_LICENSE },
    vehicle: { ...EMPTY_VEHICLE },
    bank: { ...EMPTY_BANK },
  };
}

/** Formats an E.164 Indian number (+919876543210) as "+91 98765 43210". */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) return e164;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

// ── Driver account (drivers/{uid}) ─────────────────────────────────────────

const APPROVAL_VALUES: ApprovalStatus[] = ['Pending', 'Approved', 'Rejected', 'Suspended'];
const DOC_VALUES: DocumentStatus[] = ['Pending', 'Approved', 'Rejected'];

/** Shown until staff record the name from the driving licence: "Driver ••3210". */
export function fallbackName(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `Driver ••${digits.slice(-4)}` : 'NESAM Driver';
}

function mapDriverDoc(uid: string, data: Record<string, any>): DriverAccount {
  const approval = APPROVAL_VALUES.includes(data.status) ? data.status as ApprovalStatus : 'Pending';
  const docStatus = DOC_VALUES.includes(data.docStatus) ? data.docStatus as DocumentStatus : 'Pending';
  const presence: DriverStatus =
    data.presenceStatus === 'Online' || data.presenceStatus === 'On Trip' ? data.presenceStatus : 'Offline';
  const created = toDate(data.createdAt);

  const driver: DriverProfile = {
    id: uid,
    // Onboarding no longer asks for a name; staff record it from the licence at review.
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
    // Signup used to store a placeholder 5; a rating is shown only once it is
    // backed by a count of customer ratings.
    rating: typeof data.rating === 'number' && typeof data.ratingCount === 'number' && data.ratingCount > 0 ? data.rating : null,
    joiningDate: created
      ? created.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
      : str(data.joiningDate),
    assignedVehicleId: str(data.assignedVehicleId),
    assignedVehicleNumber: str(data.assignedVehicleNumber),
    vendorId: data.vendorId || undefined,
    vendorName: data.vendorName || undefined,
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
      name: driver.name, phone: driver.phone, email: driver.email, photoUrl: driver.photoUrl,
      dob: driver.dob, gender: driver.gender, address: driver.address, city: driver.city,
      pincode: driver.pincode, emergencyContactName: driver.emergencyContactName,
      emergencyContact: driver.emergencyContact,
    },
    identity: { ...EMPTY_IDENTITY, ...pickStrings(id, Object.keys(EMPTY_IDENTITY)) } as IdentityDetails,
    license: {
      ...EMPTY_LICENSE,
      ...pickStrings(li, Object.keys(EMPTY_LICENSE)),
      number: str(li.number || data.licenseNumber),
      expiryDate: str(li.expiryDate || data.licenseExpiry),
    } as DrivingLicense,
    vehicle: {
      ...EMPTY_VEHICLE,
      ...pickStrings(vi, Object.keys(EMPTY_VEHICLE).filter((k) => k !== 'capacity')),
      vehicleType: (vi.vehicleType || 'Sedan') as VehicleCategory,
      capacity: typeof vi.capacity === 'number' ? vi.capacity : 4,
      ...(vi.vahan && typeof vi.vahan === 'object' ? { vahan: vi.vahan } : {}),
    } as VehicleDetails,
    bank: { ...EMPTY_BANK, ...pickStrings(bank, Object.keys(EMPTY_BANK)) } as BankDetails,
  };
}

function pickStrings(src: Record<string, any>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (src[k] != null) out[k] = str(src[k]);
  return out;
}

export async function getDriverAccount(uid: string): Promise<DriverAccount | null> {
  const snap = await getDoc(doc(db, DRIVERS_COLLECTION, uid));
  const privateSnap = await getDoc(doc(db, 'driver_private', uid));
  return snap.exists() ? mapDriverDoc(uid, { ...snap.data(), ...privateSnap.data() }) : null;
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

/**
 * An admin or vendor may pre-register a driver by phone number. The invite
 * pre-fills the name, links the vendor and (admin only) pre-approves.
 */
export async function getDriverInvite(phoneE164: string): Promise<DriverInvite | null> {
  if (!phoneE164) return null;
  try {
    const snap = await getDoc(doc(db, DRIVER_INVITES_COLLECTION, phoneE164));
    return snap.exists() ? (snap.data() as DriverInvite) : null;
  } catch (err) {
    console.warn('Driver invite lookup failed:', err);
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
  const label = [v.make, v.model].filter(Boolean).join(' ');
  const vehicle = opts.fleetDriver || !plate
    ? {}
    : {
        vehicleInfo: { ...v, vehicleNumber: plate, rcNumber: plate },
        vehicleNumber: plate,
        vehicleType: v.vehicleType,
        vehicle: label ? `${label} • ${plate}` : plate,
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
 * Creates drivers/{uid} for a brand-new driver. The account starts in
 * 'Pending' until an admin approves it — unless an admin invite for this
 * phone number pre-approved it (firestore.rules checks the invite).
 */
export async function registerDriver(data: RegistrationData): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Your session has expired. Please sign in again.');
  const phoneE164 = user.phoneNumber || '';
  const invite = await getDriverInvite(phoneE164);

  await writeDriverProfile(user.uid, {
    ...registrationFields(data, { fleetDriver: !!invite?.vendorId }),
    uid: user.uid,
    id: user.uid,
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
  }, true);
}

/**
 * Updates KYC details on an existing account. A rejected driver's status goes
 * back to 'Pending' for another admin review; an approved driver stays
 * approved but docStatus drops to 'Pending' so the admin re-audits.
 */
export async function resubmitDriverDocuments(
  uid: string,
  data: RegistrationData,
  currentStatus: ApprovalStatus,
  opts: { fleetDriver?: boolean } = {},
): Promise<void> {
  await writeDriverProfile(uid, {
    ...registrationFields(data, opts),
    ...(currentStatus === 'Rejected' ? { status: 'Pending', rejectionReason: '' } : {}),
  });
}

/** Contact / payout details that don't need re-verification. */
export async function updateDriverContactDetails(
  uid: string,
  fields: Partial<Pick<DriverProfile, 'email' | 'address' | 'city' | 'pincode' | 'emergencyContactName' | 'emergencyContact'>> & { bank?: BankDetails },
): Promise<void> {
  await writeDriverProfile(uid, { ...fields, updatedAt: serverTimestamp() });
}

/**
 * Online/offline presence. Written to `presenceStatus`, never `status` —
 * `status` is the admin approval state and the rules block drivers from it.
 */
export async function setDriverPresence(uid: string, presence: DriverStatus): Promise<void> {
  await writeDriverProfile(uid, {
    presenceStatus: presence,
    lastSeenAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ── Marketplace ────────────────────────────────────────────────────────────

export function subscribeToOpenMarketplace(callback: (offers: MarketplaceOffer[]) => void) {
  const q = query(collection(db, MARKETPLACE_COLLECTION), where('status', '==', 'Open'));
  return onSnapshot(
    q,
    (snap) => {
      const offers = snap.docs.map((d) => {
        const data = d.data();
        const pickup = typeof data.pickup === 'object' && data.pickup ? data.pickup : { address: str(data.pickup) };
        const drop = typeof data.drop === 'object' && data.drop ? data.drop : { address: str(data.drop) };
        return {
          id: d.id,
          bookingId: str(data.bookingId) || d.id,
          pickup: {
            address: str(pickup.address || pickup.city),
            lat: typeof pickup.lat === 'number' ? pickup.lat : undefined,
            lng: typeof pickup.lng === 'number' ? pickup.lng : undefined,
          },
          drop: {
            address: str(drop.address || drop.city),
            lat: typeof drop.lat === 'number' ? drop.lat : undefined,
            lng: typeof drop.lng === 'number' ? drop.lng : undefined,
          },
          pickupTime: str(pickup.time),
          travelDate: str(data.travelDate),
          pickupAt: toDate(data.pickupAt),
          vehicleCategory: str(data.vehicleCategory || data.categoryName),
          distanceKm: parseAmount(data.distanceKm),
          offeredPayout: typeof data.offeredPayout === 'number' && data.offeredPayout > 0 ? data.offeredPayout : null,
          mode: (data.mode === 'bid_review' ? 'bid_review' : data.mode === 'accept_offer' ? 'accept_offer' : '') as MarketplaceOffer['mode'],
          eligibleClasses: Array.isArray(data.eligibleVehicleClasses) ? data.eligibleVehicleClasses.filter((x: unknown): x is string => typeof x === 'string') : [],
          publishedMs: toDate(data.publishedAt)?.getTime() ?? 0,
          _created: toDate(data.createdAt)?.getTime() ?? 0,
        };
      });
      offers.sort((a, b) => b._created - a._created);
      callback(offers.map(({ _created, ...o }) => o));
    },
    (err) => {
      console.warn('Marketplace subscription error:', err);
      callback([]);
    },
  );
}

/**
 * Takes an open marketplace duty. The claim runs on the server (claimMarketplaceDuty), which applies
 * the same checks as every other assignment — account, approved vehicle class and seats, documents
 * valid through the trip, no schedule overlap — and picks exactly one winner. The app writes nothing.
 */
export async function acceptMarketplaceTrip(
  driver: DriverProfile,
  _registeredVehicleNumber: string,
  offer: MarketplaceOffer,
): Promise<void> {
  if (driver.vendorId) throw new Error('Fleet drivers receive trips from their vendor, not the marketplace.');
  await callFunction('claimMarketplaceDuty', { bookingId: offer.id }, 30000);
}

/** Sends an owner-driver's counter amount for a duty NESAM reviews bids on. */
export async function submitDutyBid(offer: MarketplaceOffer, rate: number, note: string): Promise<void> {
  await callFunction('submitMarketplaceBid', { tripId: offer.id, rate, note: note.trim().slice(0, 300) }, 30000);
}

/** Withdraws this driver's pending bid on a duty (the bid document id is "driver_<uid>"; the server checks ownership and status). */
export async function withdrawDutyBid(offer: MarketplaceOffer): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Sign in again to withdraw your bid.');
  await callFunction('withdrawMarketplaceBid', { tripId: offer.id, bidId: `driver_${uid}` }, 30000);
}

/**
 * The operating limits the server applies to trip steps (settings/operations, readable by every signed-in user).
 * Same defaults and ranges as functions/src/trips.ts. A null result means the settings could not be read, in which
 * case the screen does not guess — the server's own message is shown instead.
 */
export interface TripRules {
  /** How long before the pickup time the first trip step (Reached Pickup) opens. */
  startWindowMs: number;
  pickupRadiusKm: number;
  locationMaxAccuracyMeters: number;
}

export function parseTripRules(d: Record<string, unknown> | undefined): TripRules {
  const n = (v: unknown, dflt: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : dflt);
  return { startWindowMs: n(d?.tripStartWindowMinutes, 360, 15, 4320) * 60000, pickupRadiusKm: n(d?.pickupRadiusKm, 3, 0.1, 25), locationMaxAccuracyMeters: n(d?.locationMaxAccuracyMeters, 200, 10, 2000) };
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

/**
 * Bookings store a location either as flat fields (pickup / pickupAddress /
 * pickupLat / pickupLng) or as an object ({ name, address, lat, lng }).
 */
function readLocation(data: Record<string, any>, key: 'pickup' | 'drop') {
  const v = data[key];
  if (v && typeof v === 'object') {
    return {
      address: str(v.address || v.name || data[`${key}Address`]),
      lat: num(v.lat) ?? num(data[`${key}Lat`]),
      lng: num(v.lng) ?? num(data[`${key}Lng`]),
    };
  }
  return {
    address: str(data[`${key}Address`] || v),
    lat: num(data[`${key}Lat`]),
    lng: num(data[`${key}Lng`]),
  };
}

const STAGES: TripStage[] = ['Assigned', 'En Route Pickup', 'Reached Pickup', 'In Progress', 'Arrived Destination', 'Completed'];

function mapBooking(id: string, data: Record<string, any>): TripDetails {
  const fare = parseAmount(data.fare);
  const status = str(data.status) as BookingStatus;
  const stage: TripStage = status === 'Completed' ? 'Completed' : STAGES.includes(data.tripStage) ? data.tripStage : 'Assigned';
  const subStatus = tripSubStatusOf({ tripSubStatus: data.tripSubStatus, tripStage: data.tripStage, status });

  // The agreed payout is recorded when the trip is claimed or assigned; a fleet
  // trip is paid by the vendor, so the driver has no NESAM payout on it.
  // Once finance finalizes the trip, its snapshot (bookings/{id}.finance) is the amount that counts.
  const fin = data.finance && typeof data.finance === 'object' && data.finance.schema === 1 ? data.finance : null;
  const fleetTrip = Boolean(data.assignedVendorId) || fin?.partnerType === 'vendor';
  const finalized = !fleetTrip && fin?.partnerType === 'driver' && typeof fin.partnerPayout === 'number' && Number.isFinite(fin.partnerPayout);
  const payout = finalized ? (fin.partnerPayout as number) : !fleetTrip && typeof data.driverPayout === 'number' && data.driverPayout > 0 ? data.driverPayout : null;
  const preTrip = data.preTrip && typeof data.preTrip === 'object' ? data.preTrip : undefined;
  const summary = data.paymentSummary && typeof data.paymentSummary === 'object' ? data.paymentSummary : null;

  return {
    id,
    bookingId: str(data.bookingId) || id,
    customerName: str(data.passengerName || data.customer || data.customerName),
    customerPhone: '',
    customerPhoneMasked: str(data.phoneMasked),
    pickup: readLocation(data, 'pickup'),
    drop: readLocation(data, 'drop'),
    distanceKm: parseAmount(data.distanceKm),
    vehicleType: str(data.categoryName || data.vehicleCategory || data.vehicle),
    serviceType: str(data.service),
    fareAmount: fare,
    driverEarnings: payout,
    payoutFinalized: finalized,
    fleetTrip,
    tollCharges: parseAmount(data.tollCharges),
    tollsApproved: data.tollsApproved === true,
    status,
    stage,
    scheduledDate: str(data.date),
    scheduledTime: str(data.time),
    paymentMode: str(data.paymentMethod),
    startOdometer: typeof data.startOdometer === 'number' ? data.startOdometer : undefined,
    endOdometer: typeof data.endOdometer === 'number' ? data.endOdometer : undefined,
    preTrip: preTrip ? { odometerReading: parseAmount(preTrip.odometerReading), capturedAt: str(preTrip.capturedAt) } : undefined,
    tolls: Array.isArray(data.tolls) ? data.tolls as TollReceipt[] : [],
    completedAt: toDate(data.completedAt),
    subStatus,
    pickupAt: toDate(data.pickupAt) ?? toDate(data.scheduledAt),
    verificationSubmitted: data.vehicleVerification?.status === 'Submitted' || Boolean(data.vehicleFrontPhoto) || (preTrip && parseAmount(preTrip.odometerReading) > 0 && Boolean(preTrip.vehicleFront)),
    boardingVerified: Boolean(data.boardingVerifiedAt),
    legacyFlow: Boolean(data.startedAt) && !data.tripStartedAt,
    fareBreakup: Array.isArray(data.fareBreakup?.lines) ? data.fareBreakup.lines : null,
    paymentSummary: summary
      ? { amountDue: parseAmount(summary.amountDue), totalPaid: parseAmount(summary.totalPaid), balanceDue: parseAmount(summary.balanceDue), partnerCashHeld: parseAmount(summary.partnerCashHeld), status: str(summary.status) }
      : null,
    tripStartedAt: toDate(data.tripStartedAt),
    reachedPickupAt: toDate(data.reachedPickupAt),
    tripEndedAt: toDate(data.tripEndedAt),
    acceptedAt: toDate(data.acceptedAt) ?? toDate(data.assignedAt),
    cancellationRequest: data.cancellationRequest && typeof data.cancellationRequest === 'object' && data.cancellationRequest.partyType === 'driver'
      ? { requestId: str(data.cancellationRequest.requestId), status: str(data.cancellationRequest.status), quotedPenalty: parseAmount(data.cancellationRequest.quotedPenalty) }
      : null,
    driverResponse: data.driverResponse && typeof data.driverResponse === 'object' && data.driverResponse.driverId === data.assignedDriverId
      ? { viewedAt: toDate(data.driverResponse.viewedAt), acknowledgedAt: toDate(data.driverResponse.acknowledgedAt) }
      : null,
  };
}

/** Every booking ever assigned to this driver (active + history). */
export function subscribeToDriverBookings(driverId: string, callback: (trips: TripDetails[]) => void) {
  const q = query(collection(db, BOOKINGS_COLLECTION), where('assignedDriverId', '==', driverId));
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => mapBooking(d.id, d.data()))),
    (err) => {
      console.warn('Driver bookings subscription error:', err);
      callback([]);
    },
  );
}

// Trip steps (vehicle verification, Trip Started, Reached Pickup, boarding OTP, Trip End)
// are server functions: see services/tripService.ts and services/verificationService.ts.

/** Saves toll receipts as they are added so a page reload doesn't lose them. */
export async function saveTripTolls(bookingId: string, tolls: TollReceipt[]): Promise<void> {
  await updateDoc(doc(db, BOOKINGS_COLLECTION, bookingId), {
    tolls,
    tollCharges: tolls.reduce((s, t) => s + t.amount, 0),
    updatedAt: serverTimestamp(),
  });
  settleBooking(bookingId);
}

// ── Payouts ────────────────────────────────────────────────────────────────

/** The server checks the ledger balance and pays to the bank / UPI saved in the driver's profile. */
export async function requestPayout(amount: number, method: 'UPI' | 'Bank Transfer'): Promise<void> {
  const payoutRef = doc(collection(db, PAYOUT_REQUESTS_COLLECTION));
  await callBackend('requestPartnerPayout', { requestId: payoutRef.id, role: 'driver', amount, method });
  settlePayout(payoutRef.id);
}

/** The server-computed wallet (wallets/driver_{uid}). */
export function subscribeToDriverWallet(driverId: string, callback: (wallet: DriverWallet) => void, onError: (message: string) => void) {
  return onSnapshot(
    doc(db, 'wallets', `driver_${driverId}`),
    (snap) => callback(mapWallet(snap.exists() ? snap.data() : undefined)),
    (err) => onError(describeFirestoreError(err, 'Could not load your wallet.')),
  );
}

export function subscribeToDriverLedger(driverId: string, callback: (entries: LedgerEntry[]) => void, onError: (message: string) => void) {
  return onSnapshot(
    query(collection(db, 'wallet_ledger'), where('driverId', '==', driverId)),
    (snap) => {
      const rows = snap.docs.map((d) => mapLedgerEntry(d.id, d.data())).filter((e): e is LedgerEntry => e !== null);
      rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
      callback(rows);
    },
    (err) => onError(describeFirestoreError(err, 'Could not load your earnings.')),
  );
}
export function subscribeToPayoutRequests(driverId: string, callback: (requests: PayoutRequest[]) => void) {
  const q = query(collection(db, PAYOUT_REQUESTS_COLLECTION), where('driverId', '==', driverId));
  return onSnapshot(
    q,
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
          _t: created?.getTime() ?? 0,
        };
      });
      rows.sort((a, b) => b._t - a._t);
      callback(rows.map(({ _t, ...r }) => r));
    },
    (err) => {
      console.warn('Payout subscription error:', err);
      callback([]);
    },
  );
}

// ── Notifications ──────────────────────────────────────────────────────────

export function subscribeToDriverNotifications(recipientId: string, callback: (n: DriverNotification[]) => void) {
  const q = query(collection(db, NOTIFICATIONS_COLLECTION), where('recipientId', '==', recipientId));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data();
        const created = toDate(data.createdAt);
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
        } satisfies DriverNotification;
      });
      rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
      callback(rows);
    },
    (err) => {
      console.warn('Notifications subscription error:', err);
      callback([]);
    },
  );
}

const PENALTY_STATUSES: PenaltyStatus[] = ['Pending', 'Acknowledged', 'Paid', 'Deducted', 'Waived', 'Disputed'];
const LEGACY_PENALTY: Record<string, PenaltyStatus> = { Applied: 'Pending', Recovered: 'Paid', Reversed: 'Waived' };

/** Penalties issued to this driver (read-only here; acknowledging and disputing are server functions). */
export function subscribeToDriverPenalties(driverId: string, callback: (p: DriverPenalty[]) => void, onError: (message: string) => void) {
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
          status: PENALTY_STATUSES.includes(raw as PenaltyStatus) ? (raw as PenaltyStatus) : LEGACY_PENALTY[raw] ?? 'Pending',
          acknowledged: data.acknowledged === true,
          acknowledgedAt: toDate(data.acknowledgedAt),
          disputeNote: str(data.disputeNote),
          issuedAt: toDate(data.issuedAt) ?? toDate(data.createdAt),
          issuedByName: str(data.issuedByName),
        };
      });
      rows.sort((a, b) => (b.issuedAt?.getTime() ?? 0) - (a.issuedAt?.getTime() ?? 0));
      callback(rows);
    },
    (err) => onError(describeFirestoreError(err, 'Could not load your penalties.')),
  );
}

export async function markNotificationRead(id: string): Promise<void> {
  await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, id), { read: true, readAt: serverTimestamp() });
}
