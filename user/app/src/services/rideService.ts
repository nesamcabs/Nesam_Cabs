import { callBackend, settleBooking } from './backend';
// Ride lifecycle for the customer: request → dispatch → live tracking →
// completion, cancellation, rating and SOS.
//
// Booking creation uses the server callable for pricing and atomic dispatch.
// Customer updates remain constrained by firestore.rules. Live location comes
// from the assigned driver's driverLocation field on the booking.

import { collection, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import {
  FREE_CANCEL_AFTER_ASSIGN_MS,
  INSTANT_CANCELLATION_FEE,
  SCHEDULED_CANCELLATION_FEE,
  SCHEDULED_FREE_CANCEL_BEFORE_MS,
} from '../config/constants';
import type {
  BookingStatus,
  DriverCard,
  DriverLocation,
  FareBreakdown,
  FareLine,
  GeoPlace,
  LatLng,
  PaymentMethod,
  RideCategory,
  RidePhase,
  RouteInfo,
  TripRecord,
  TripStage,
  TripType,
  UserProfile,
} from '../types';
import { formatDate, formatTime, num, str, toDate } from '../utils/format';
import { isValidLatLng } from '../utils/geo';
import { withTimeout, errorCode } from '../utils/retry';

export const BOOKINGS = 'bookings';
const SECRETS = 'booking_secrets';
const MARKETPLACE = 'marketplace_trips';
const REVIEWS = 'reviews';
const SOS = 'sos_alerts';

// ── Mapping ─────────────────────────────────────────────────────────────────

const STATUSES: BookingStatus[] = ['Pending', 'Approved', 'Confirmed', 'Assigned', 'Ongoing', 'Completed', 'Cancelled', 'Rejected'];
const STAGES: TripStage[] = ['Assigned', 'En Route Pickup', 'Reached Pickup', 'In Progress', 'Arrived Destination', 'Completed'];

/** Also maps labels written by older builds of the panels. */
export function normalizeStatus(raw: string): BookingStatus {
  if ((STATUSES as string[]).includes(raw)) return raw as BookingStatus;
  if (raw === 'Trip Started' || raw === 'In Progress') return 'Ongoing';
  if (raw === 'Driver Assigned' || raw === 'Driver Near Pickup' || raw === 'Driver Arrived') return 'Assigned';
  return 'Pending';
}

/**
 * What the customer should be told. Every booking is an advance booking, so a booking that
 * NESAM has approved is "arranging" until a vendor or a driver is assigned — nothing here
 * promises a driver search or an arrival time before a driver exists.
 */
export function derivePhase(status: BookingStatus, stage: TripStage | null, hasDriver = true, boardingVerified = false): RidePhase {
  switch (status) {
    case 'Cancelled':
    case 'Rejected':
      return 'cancelled';
    case 'Completed':
      return 'completed';
    case 'Ongoing':
      // The driver starts the trip on the way to the pickup; the ride itself begins once the boarding OTP is verified.
      if (stage === 'En Route Pickup') return 'driver_en_route';
      if (stage === 'Reached Pickup') return boardingVerified ? 'in_trip' : 'driver_arrived';
      return 'in_trip';
    case 'Assigned':
      if (!hasDriver) return 'partner_confirmed';
      if (stage === 'En Route Pickup') return 'driver_en_route';
      if (stage === 'Reached Pickup') return 'driver_arrived';
      if (stage === 'In Progress' || stage === 'Arrived Destination') return 'in_trip';
      return 'driver_assigned';
    case 'Confirmed':
      return 'partner_confirmed';
    case 'Approved':
      return 'arranging';
    default:
      return 'awaiting_review';
  }
}

function place(prefix: 'pickup' | 'drop', d: Record<string, unknown>): GeoPlace {
  const name = str(d[prefix]) || (prefix === 'pickup' ? 'Pickup' : 'Destination');
  const lat = d[`${prefix}Lat`];
  const lng = d[`${prefix}Lng`];
  return {
    id: `${prefix}`,
    name,
    address: str(d[`${prefix}Address`]) || name,
    type: d[`${prefix}Type`] === 'airport' ? 'airport' : 'other',
    lat: typeof lat === 'number' ? lat : NaN,
    lng: typeof lng === 'number' ? lng : NaN,
  };
}

function mapFareBreakdown(v: unknown, adjustment?: unknown): FareBreakdown | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const keys: Exclude<keyof FareBreakdown, 'subtotalBeforeAdjustment' | 'globalAdjustment' | 'discountDetail'>[] = [
    'baseFare', 'distanceFare', 'timeFare', 'nightCharge', 'driverAllowance', 'minimumFareAdjustment', 'adminAdjustment',
    'subtotal', 'discount', 'taxableAmount', 'gstRate', 'gst', 'total', 'distanceKm', 'durationMin',
    'perKmRate', 'perMinuteRate',
  ];
  const out = {} as FareBreakdown;
  for (const k of keys) out[k] = num(f[k]);
  // Older bookings stored the applied % adjustment beside the breakdown only.
  const a = (f.globalAdjustment ?? adjustment) as Record<string, unknown> | null | undefined;
  if (a && typeof a === 'object' && typeof a.amount === 'number' && a.amount !== 0) {
    out.globalAdjustment = {
      id: str(a.id),
      name: str(a.name) || 'Fare adjustment',
      direction: a.direction === 'decrease' ? 'decrease' : 'increase',
      percent: num(a.percent),
      amount: a.amount,
    };
  }
  return out;
}

const TREATMENTS: FareLine['treatment'][] = ['included', 'extra', 'not_applicable'];

/** The server's stored fare breakup (fareBreakup.lines), validated line by line. */
function mapFareLines(v: unknown): FareLine[] {
  const lines = v && typeof v === 'object' ? (v as { lines?: unknown }).lines : null;
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && TREATMENTS.includes((l as { treatment?: FareLine['treatment'] }).treatment!))
    .map((l) => ({
      key: str(l.key),
      label: str(l.label),
      amount: typeof l.amount === 'number' && Number.isFinite(l.amount) ? l.amount : null,
      treatment: l.treatment as FareLine['treatment'],
      detail: str(l.detail),
    }));
}

function mapDriverLocation(v: unknown): DriverLocation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const loc = { lat: num(o.lat, NaN), lng: num(o.lng, NaN) };
  if (!isValidLatLng(loc)) return null;
  return { ...loc, heading: typeof o.heading === 'number' ? o.heading : null, updatedAt: toDate(o.updatedAt ?? o.at) };
}

export function mapBooking(id: string, d: Record<string, unknown>): TripRecord {
  const status = normalizeStatus(str(d.status));
  const stage = (STAGES as string[]).includes(str(d.tripStage)) ? (d.tripStage as TripStage) : null;
  const scheduledAt = toDate(d.scheduledAt);
  const createdAt = toDate(d.createdAt);
  const when = scheduledAt ?? createdAt;
  const driverId = str(d.assignedDriverId);
  const extras = d.extraCharges && typeof d.extraCharges === 'object'
    ? d.extraCharges as { status?: unknown; customer?: unknown }
    : null;
  const extraCustomer = extras?.customer && typeof extras.customer === 'object'
    ? extras.customer as Record<string, unknown>
    : null;
  const driver: DriverCard | null = driverId
    ? {
        id: driverId,
        name: str(d.assignedDriverName || d.driver) || 'Your driver',
        phone: str(d.driverPhone),
        photoUrl: str(d.driverPhotoUrl),
        rating: typeof d.driverRating === 'number' ? d.driverRating : null,
        vehicleModel: str(d.assignedVehicleModel),
        vehicleNumber: str(d.assignedVehicleNumber),
      }
    : null;

  return {
    id,
    bookingId: str(d.bookingId) || id,
    customerId: str(d.customerId),
    pickup: place('pickup', d),
    drop: place('drop', d),
    service: str(d.service) || 'Local',
    ...(Array.isArray(d.itinerary) ? { itinerary: d.itinerary.filter((p: any) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)).map((p: any) => ({ id: str(p.id), name: str(p.name), address: str(p.address), lat: p.lat, lng: p.lng, type: 'other' as const })) } : {}),
    tripType: (d.tripType === 'Round Trip' || d.tripType === 'Local Rental' || d.tripType === 'Airport Taxi' ? d.tripType : 'One Way') as TripType,
    categoryId: str(d.vehicleCategoryId),
    categoryName: (str(d.vehicleCategory || d.vehicle) || 'Cab') + (d.fuelType === 'cng' ? ' (CNG)' : ''),
    status,
    tripStage: stage,
    phase: derivePhase(status, stage, !!driverId, !!d.boardingVerifiedAt),
    fare: num(d.fare),
    fareBreakdown: mapFareBreakdown(d.fareBreakdown, d.globalAdjustmentApplied),
    fareLines: mapFareLines(d.fareBreakup),
    paid:
      d.paymentSummary && typeof d.paymentSummary === 'object'
        ? (() => {
            const p = d.paymentSummary as Record<string, unknown>;
            return { totalPaid: num(p.totalPaid), balanceDue: num(p.balanceDue), status: str(p.status) };
          })()
        : null,
    refund:
      d.refund && typeof d.refund === 'object' && str((d.refund as Record<string, unknown>).status) && str((d.refund as Record<string, unknown>).status) !== 'Not Applicable'
        ? { status: str((d.refund as Record<string, unknown>).status), amount: num((d.refund as Record<string, unknown>).amount) }
        : null,
    tollCharges: num(d.tollCharges),
    extraCharges: extras?.status === 'approved' ? num(extraCustomer?.totalPaise) / 100 : 0,
    couponCode: str(d.couponCode),
    paymentMethod: str(d.paymentMethod) || 'Cash',
    paymentStatus: str(d.payment) || 'Pending',
    distanceKm: num(d.distanceKm),
    durationMin: num(d.durationMin),
    notes: str(d.notes),
    isScheduled: d.rideTiming === 'scheduled',
    scheduledAt,
    createdAt,
    approvedAt: toDate(d.approvedAt),
    assignedAt: toDate(d.assignedAt),
    startedAt: toDate(d.startedAt),
    completedAt: toDate(d.completedAt),
    cancelledAt: toDate(d.cancelledAt),
    cancelReason: str(d.cancelReason),
    cancelledBy: str(d.cancelledBy),
    cancellationFee: num(d.cancellationFee),
    driver,
    driverLocation: mapDriverLocation(d.driverLocation),
    assignedVendorName: str(d.assignedVendorName),
    source: str(d.source),
    bookingSource: str(d.bookingSource || d.source || d.brand),
    brand: str(d.brand || d.bookingSource || d.source),
    rating: typeof d.rating === 'number' ? d.rating : null,
    reviewComment: str(d.reviewComment),
    date: str(d.date) || (when ? formatDate(when) : ''),
    time: str(d.time) || (when ? formatTime(when) : ''),
  };
}

export function isActiveStatus(s: BookingStatus): boolean {
  return s === 'Pending' || s === 'Approved' || s === 'Confirmed' || s === 'Assigned' || s === 'Ongoing';
}

/**
 * A booking that should take over the home screen: anything underway, or a booking whose
 * pickup is within the hour. Bookings further ahead stay in Trips, so a customer can make
 * several future bookings without being held on one.
 */
export function isLiveRide(t: TripRecord, now = Date.now()): boolean {
  if (t.status === 'Ongoing') return true;
  if (!isActiveStatus(t.status)) return false;
  if (!t.isScheduled || !t.scheduledAt) return true;
  return t.scheduledAt.getTime() - now <= 60 * 60 * 1000;
}

// ── Subscriptions ───────────────────────────────────────────────────────────

export function subscribeToUserBookings(
  customerId: string,
  cb: (trips: TripRecord[]) => void,
  onError?: (e: unknown) => void,
): () => void {
  return onSnapshot(
    query(collection(db, BOOKINGS), where('customerId', '==', customerId)),
    (snap) => {
      const trips = snap.docs.map((d) => mapBooking(d.id, d.data()));
      trips.sort((a, b) => (b.createdAt?.getTime() ?? Infinity) - (a.createdAt?.getTime() ?? Infinity));
      cb(trips);
    },
    (err) => onError?.(err),
  );
}

export interface BookingSnapshot {
  trip: TripRecord | null;
  /** Written locally but not yet acknowledged by the server. */
  pending: boolean;
  /** Served from the local cache. */
  fromCache: boolean;
}

export function subscribeToBooking(id: string, cb: (s: BookingSnapshot) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    doc(db, BOOKINGS, id),
    { includeMetadataChanges: true },
    (snap) =>
      cb({
        trip: snap.exists() ? mapBooking(snap.id, snap.data()) : null,
        pending: snap.metadata.hasPendingWrites,
        fromCache: snap.metadata.fromCache,
      }),
    (err) => onError?.(err),
  );
}

/** Boarding OTP lives in booking_secrets so drivers can never read it. */
export function subscribeToBoardingOtp(id: string, cb: (otp: string | null) => void): () => void {
  return onSnapshot(
    doc(db, SECRETS, id),
    (snap) => cb(snap.exists() ? str(snap.data().otp) || null : null),
    () => cb(null),
  );
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface RideRequestInput {
  profile: UserProfile;
  pickup: GeoPlace;
  drop: GeoPlace;
  /** Ordered intermediate places for a round trip. */
  stops?: GeoPlace[];
  category: RideCategory;
  route: RouteInfo;
  fare: FareBreakdown;
  tripType: TripType;
  /** A Multicity tour: booked as a Round Trip through its cities and priced from the Multicity rates. */
  multicity?: boolean;
  paymentMethod: PaymentMethod;
  couponCode: string;
  notes: string;
  /** Required: every booking is an advance booking. */
  scheduledAt: Date | null;
  /** Round trips: when the trip ends. Billing counts Indian calendar dates from pickup to this instant. */
  tripEndAt?: Date | null;
  /** The customer ticked the booking terms. The server rejects a request without it. */
  termsAccepted: boolean;
  /** WhatsApp number for booking updates: same as the mobile number, or a country code and number. */
  whatsapp?: { sameAsMobile: boolean; countryCode?: string; number?: string };
  /** Optional email for the confirmation and receipt (the profile email is used when blank). */
  email?: string;
  source?: string;
  bookingSource?: string;
  rentalHours?: number | null;
  /** 'cng' books the trip on the vehicle's CNG rate card (One Way and Round Trip). */
  fuelType?: 'cng';
  brand?: string;
}

export interface RideRequestResult {
  id: string;
  /** true when the server hadn't acknowledged within the wait window. */
  unconfirmed: boolean;
}

// Reuse a request ID after an uncertain transport failure; the server deduplicates it.
const pendingBookingIds = new Map<string, string>();
export async function createRideRequest(input: RideRequestInput): Promise<RideRequestResult> {
  if (!input.scheduledAt || !Number.isFinite(input.scheduledAt.getTime())) throw new Error('Choose your pickup date and time.');
  if (input.tripType === 'Round Trip' && (!input.tripEndAt || !Number.isFinite(input.tripEndAt.getTime()))) throw new Error('Choose when your round trip ends.');
  const bSource = input.bookingSource || input.source || input.brand || '';
  const key = JSON.stringify([input.profile.uid, input.pickup.lat, input.pickup.lng, ...(input.stops ?? []).flatMap((p) => [p.lat, p.lng]), input.drop.lat, input.drop.lng, input.category.id, input.tripType, input.multicity === true, input.scheduledAt?.toISOString(), input.tripEndAt?.toISOString(), input.couponCode, bSource, input.rentalHours ?? null]);
  const requestId = pendingBookingIds.get(key) ?? doc(collection(db, BOOKINGS)).id;
  pendingBookingIds.set(key, requestId);
  // An advance booking request: it waits for NESAM's review and is not offered to any partner until then.
  await callBackend('createBooking', { requestId, pickup: input.pickup, drop: input.drop, stops: input.tripType === 'Round Trip' ? input.stops ?? [] : [], termsAccepted: input.termsAccepted === true,
    categoryId: input.category.id, tripType: input.multicity && input.tripType === 'Round Trip' ? 'Multicity' : input.tripType, expectedFare: input.fare.total,
    paymentMethod: input.paymentMethod, couponCode: input.couponCode, notes: input.notes, fuelType: input.fuelType === 'cng' ? 'cng' : undefined,
    whatsapp: input.whatsapp, email: input.email || undefined,
    scheduledAt: input.scheduledAt.toISOString(), tripEndAt: input.tripType === 'Round Trip' ? input.tripEndAt?.toISOString() : undefined,
    rentalHours: input.tripType === 'Local Rental' && input.rentalHours ? input.rentalHours : undefined,
    source: bSource || undefined,
    bookingSource: bSource || undefined,
    brand: bSource || undefined }, 60000);
  pendingBookingIds.delete(key);
  return { id: requestId, unconfirmed: false };
}
// ── Cancel ──────────────────────────────────────────────────────────────────

export interface CancellationQuote {
  allowed: boolean;
  fee: number;
  explanation: string;
}

export function cancellationQuote(t: TripRecord, now = Date.now()): CancellationQuote {
  if (t.status === 'Ongoing') {
    return { allowed: false, fee: 0, explanation: 'The trip has started and can no longer be cancelled. Use SOS or call support if you need help.' };
  }
  if (!['Pending', 'Approved', 'Confirmed', 'Assigned'].includes(t.status)) {
    return { allowed: false, fee: 0, explanation: 'This ride can no longer be cancelled.' };
  }
  if (t.isScheduled && t.scheduledAt) {
    const until = t.scheduledAt.getTime() - now;
    if (until > SCHEDULED_FREE_CANCEL_BEFORE_MS || t.status === 'Pending') {
      return { allowed: true, fee: 0, explanation: 'Free cancellation — no charge applies.' };
    }
    return {
      allowed: true,
      fee: SCHEDULED_CANCELLATION_FEE,
      explanation: `Pickup is less than an hour away and a partner is committed, so a ₹${SCHEDULED_CANCELLATION_FEE} cancellation fee applies.`,
    };
  }
  if (t.status !== 'Assigned' || !t.assignedAt) {
    return { allowed: true, fee: 0, explanation: 'No driver has been assigned yet — cancellation is free.' };
  }
  const since = now - t.assignedAt.getTime();
  if (since <= FREE_CANCEL_AFTER_ASSIGN_MS) {
    const left = Math.ceil((FREE_CANCEL_AFTER_ASSIGN_MS - since) / 60000);
    return { allowed: true, fee: 0, explanation: `Free cancellation for about ${left} more min after driver assignment.` };
  }
  return {
    allowed: true,
    fee: INSTANT_CANCELLATION_FEE,
    explanation: `Your driver is already on the way, so a ₹${INSTANT_CANCELLATION_FEE} cancellation fee applies.`,
  };
}

/** Booking fields a customer cancellation writes (customerUpdateOk allow-list). */
export function buildCancelUpdate(reason: string, cancellationFee = 0) {
  return {
    status: 'Cancelled',
    cancelReason: reason.slice(0, 200),
    cancellationFee,
    cancelledBy: 'customer',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function cancelRide(trip: TripRecord, reason: string): Promise<void> {
  const quote = cancellationQuote(trip);
  if (!quote.allowed) throw new Error(quote.explanation);
  const bookingRef = doc(db, BOOKINGS, trip.id);

  const build = (withMarketplace: boolean) => {
    const batch = writeBatch(db);
    batch.update(bookingRef, buildCancelUpdate(reason, quote.fee));
    // Withdraw the open marketplace offer so no partner can still claim it.
    if (withMarketplace) batch.update(doc(db, MARKETPLACE, trip.id), { status: 'Closed', updatedAt: serverTimestamp() });
    return batch;
  };

  try {
    await withTimeout(build(true).commit(), 15000);
    settleBooking(trip.id);
  } catch (err) {
    // Admin-created bookings have no marketplace doc, and the rules reject an
    // update to a missing doc — retry without it. If the booking update itself
    // was the problem, the retry fails the same way and surfaces.
    const code = errorCode(err);
    if (code === 'not-found' || code === 'permission-denied') {
      await withTimeout(build(false).commit(), 15000);
      settleBooking(trip.id);
      return;
    }
    throw err;
  }
}

// ── Rate ────────────────────────────────────────────────────────────────────

export async function rateTrip(trip: TripRecord, profile: UserProfile, rating: number, comment: string): Promise<void> {
  const stars = Math.round(rating);
  if (stars < 1 || stars > 5) throw new Error('Choose between 1 and 5 stars.');
  const text = comment.trim().slice(0, 500);
  const batch = writeBatch(db);
  batch.update(doc(db, BOOKINGS, trip.id), {
    rating: stars,
    reviewComment: text,
    ratedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // Review doc id must equal the booking doc id (firestore.rules).
  batch.set(doc(db, REVIEWS, trip.id), {
    bookingId: trip.id,
    bookingCode: trip.bookingId,
    customerId: profile.uid,
    customerName: profile.name,
    customerPhone: profile.phone,
    driverId: trip.driver?.id ?? '',
    driverName: trip.driver?.name ?? '',
    vehicleNumber: trip.driver?.vehicleNumber ?? '',
    serviceName: trip.service,
    overallRating: stars,
    driverRating: stars,
    reviewText: text,
    status: 'Pending',
    createdAt: serverTimestamp(),
  });
  await withTimeout(batch.commit(), 15000);
}

// ── SOS ─────────────────────────────────────────────────────────────────────

export async function raiseSos(trip: TripRecord, profile: UserProfile, location: LatLng | null): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, SOS)), {
    bookingId: trip.id,
    bookingCode: trip.bookingId,
    customerId: profile.uid,
    customerName: profile.name,
    customerPhone: profile.phone,
    emergencyContact: profile.emergencyContact,
    driverId: trip.driver?.id ?? '',
    driverName: trip.driver?.name ?? '',
    driverPhone: trip.driver?.phone ?? '',
    vehicleNumber: trip.driver?.vehicleNumber ?? '',
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
    tripStatus: trip.status,
    status: 'Open',
    source: 'customer-app',
    createdAt: serverTimestamp(),
  });
  await withTimeout(batch.commit(), 10000);
}
