// ─────────────────────────────────────────────────────────────────────────────
// Domain types for the customer (rider) panel.
//
// Bookings follow the platform-wide lifecycle enforced by firestore.rules:
//   status:    Pending → Confirmed (vendor accepted) → Assigned (driver set)
//              → Ongoing (boarding OTP verified) → Completed | Cancelled
//   tripStage: Assigned → Reached Pickup → In Progress (legacy: En Route Pickup)
//              → Arrived Destination → Completed   (driver-reported detail)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserProfile {
  uid: string;
  name: string;
  phone: string;
  email: string;
  photoUrl: string;
  walletBalance: number;
  emergencyContact: string;
  language: string;
  status: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export type PlaceType = 'home' | 'work' | 'favorite' | 'recent' | 'airport' | 'other' | 'current';

export interface LocationItem {
  id: string;
  name: string;
  address: string;
  type: PlaceType;
  lat?: number;
  lng?: number;
}

/** A place with confirmed coordinates — required for pickup/drop. */
export interface GeoPlace extends LocationItem {
  lat: number;
  lng: number;
}

export interface RouteInfo {
  distanceKm: number;
  durationMin: number;
  /** [lat, lng] pairs for drawing; empty when only an estimate is available. */
  path: [number, number][];
  /** true when OSRM was unreachable and distance is a straight-line estimate. */
  estimated: boolean;
}

export interface FareConfig {
  baseFare: number;
  baseKm: number;
  perKmRate: number;
  perMinuteRate: number;
  minimumFare: number;
  nightCharge: number;
  driverAllowance: number;
  /** Per-km rate for outstation trips, when the admin configured one. */
  outstationPerKmRate?: number;
  /** Charges that are quoted for information and paid separately unless marked included. */
  extras?: FareExtras;
}

/** Category-level configuration of the charges outside the package price. */
export interface FareExtras {
  /** Rate per hour of waiting beyond the free period (0 = not configured). */
  waitingPerHour: number;
  /** Rate for each km beyond the booked distance. */
  extraKmRate: number;
  tollIncluded: boolean;
  parkingIncluded: boolean;
  /** State tax / permit charge per trip (0 = billed at actuals). */
  permitCharge: number;
  /** Carrier / luggage charge per trip (0 = none). */
  carrierCharge: number;
}

export interface RideCategory {
  id: string;
  name: string;
  description: string;
  seats: number;
  imageUrl?: string;
  /** Driver `vehicleType` values that can serve this category. */
  matchVehicleTypes: string[];
  fare: FareConfig;
  displayOrder: number;
  /** CNG may be chosen for this category (set per category in admin; it also needs a CNG rate card for its class). */
  cngEnabled?: boolean;
}

export interface FareBreakdown {
  gstDetails?: import('./gst').GstSnapshot & { cgst: number; sgst: number; utgst: number; igst: number };
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  nightCharge: number;
  driverAllowance: number;
  minimumFareAdjustment: number;
  /** Pre-GST difference from an admin-authorised fare override (see bookings.fareOverride). */
  adminAdjustment?: number;
  /** Package total before the global percentage adjustment. Equals `subtotal` when none applied. */
  subtotalBeforeAdjustment?: number;
  /** Global percentage fare adjustment applied once to the package total (never compounded). */
  globalAdjustment?: FareAdjustmentApplied | null;
  /** How the discount was derived. Stored apart from the fare so the base is never rewritten. */
  discountDetail?: DiscountDetail | null;
  subtotal: number;
  discount: number;
  taxableAmount: number;
  gstRate: number;
  gst: number;
  total: number;
  distanceKm: number;
  durationMin: number;
  perKmRate: number;
  perMinuteRate: number;
}

export interface FareAdjustmentApplied {
  id: string;
  name: string;
  direction: 'increase' | 'decrease';
  percent: number;
  /** Signed rupees added to (or removed from) the package total. */
  amount: number;
}

export interface DiscountDetail {
  type: 'percentage' | 'fixed' | 'coupon';
  /** Percent for percentage, rupees for fixed. */
  value: number;
  /** Rupees actually taken off (capped so the payable amount is never negative). */
  amount: number;
  source: 'admin' | 'coupon';
  reason: string;
}

export type PaymentMethod = 'Cash' | 'UPI' | 'Wallet' | 'Card';
export type TripType = 'One Way' | 'Round Trip' | 'Local Rental' | 'Airport Taxi';

export type BookingStatus = 'Pending' | 'Confirmed' | 'Assigned' | 'Ongoing' | 'Completed' | 'Cancelled';
export type TripStage =
  | 'Assigned'
  | 'En Route Pickup'
  | 'Reached Pickup'
  | 'In Progress'
  | 'Arrived Destination'
  | 'Completed';

/** What the rider should be looking at right now, derived from status + stage. */
export type RidePhase =
  | 'searching'
  | 'partner_confirmed'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'in_trip'
  | 'completed'
  | 'cancelled';

export interface DriverCard {
  id: string;
  name: string;
  phone: string;
  photoUrl: string;
  rating: number | null;
  vehicleModel: string;
  vehicleNumber: string;
}

export interface DriverPresence {
  id: string;
  online: boolean;
  onTrip: boolean;
  lat: number;
  lng: number;
  heading: number | null;
  vehicleCategory: string;
  updatedAt: Date | null;
}

export interface NearbyDriver extends DriverPresence {
  distanceKm: number;
}

export interface DriverLocation extends LatLng {
  heading: number | null;
  updatedAt: Date | null;
}

export interface TripRecord {
  id: string;
  bookingId: string;
  customerId: string;
  pickup: GeoPlace;
  drop: GeoPlace;
  service: string;
  tripType: TripType;
  categoryId: string;
  categoryName: string;
  status: BookingStatus;
  tripStage: TripStage | null;
  phase: RidePhase;
  fare: number;
  fareBreakdown: FareBreakdown | null;
  tollCharges: number;
  couponCode: string;
  paymentMethod: PaymentMethod | string;
  paymentStatus: string;
  distanceKm: number;
  durationMin: number;
  notes: string;
  isScheduled: boolean;
  scheduledAt: Date | null;
  createdAt: Date | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string;
  cancelledBy: string;
  cancellationFee: number;
  driver: DriverCard | null;
  /** Live position the assigned driver's app writes to the booking (rules: driverProgressOk). */
  driverLocation: DriverLocation | null;
  assignedVendorName: string;
  rating: number | null;
  reviewComment: string;
  /** Display strings kept for admin/driver compatibility. */
  date: string;
  time: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  time: string;
  category: 'Bookings' | 'Driver' | 'Payments' | 'Offers' | 'Support' | 'System';
  read: boolean;
}

export interface SupportTicket {
  id: string;
  category: string;
  bookingId?: string;
  description: string;
  status: 'Open' | 'In Progress' | 'Resolved' | 'Closed';
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  name: string;
  description: string;
  discountType: 'FIXED_AMOUNT' | 'PERCENTAGE';
  discountValue: number;
  maximumDiscount: number;
  minimumBookingAmount: number;
  validFrom: string;
  validUntil: string;
  firstBookingOnly: boolean;
  vehicleCategoryIds: string[];
  serviceNames: string[];
  totalUsageLimit: number;
  usedCount: number;
  perCustomerLimit: number;
  status: string;
  adminBookingOnly: boolean;
  /** Master Admin coupon form (Communication › Offers & Coupons); absent on older coupons. */
  audience?: 'All' | 'New' | 'Returning' | 'Regular';
  bookFrom?: string;
  bookUntil?: string;
  pickupFrom?: string;
  pickupUntil?: string;
  scope?: 'Any' | 'Pickup city' | 'Exact route';
  city?: string;
  dropCity?: string;
  allowFixed?: boolean;
  allowBusiness?: boolean;
  allowPeak?: boolean;
}

export interface AppliedCoupon {
  code: string;
  discount: number;
  message: string;
}
