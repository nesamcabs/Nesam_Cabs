// ─────────────────────────────────────────────────────────────────────────────
// Domain types for the customer (rider) panel.
//
// Bookings follow the platform-wide lifecycle enforced by firestore.rules:
//   status:    Pending → Confirmed (vendor accepted) → Assigned (driver set)
//              → Ongoing (boarding OTP verified) → Completed | Cancelled
//   tripStage: Assigned → En Route Pickup → Reached Pickup → In Progress
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
  /** Round Trip only: the whole running distance, out through every stop to the drop and back to the pickup. */
  totalDistanceKm?: number;
  totalDurationMin?: number;
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
  /** Charges the booking breakup lists separately (waiting, extra km, toll/parking/permit/carrier). */
  extras?: {
    waitingPerHour: number;
    extraKmRate: number;
    tollIncluded: boolean;
    parkingIncluded: boolean;
    permitCharge: number;
    carrierCharge: number;
  };
}

export interface RideCategory {
  id: string;
  name: string;
  description: string;
  seats: number;
  luggageCapacity?: number;
  imageUrl?: string;
  /** Driver `vehicleType` values that can serve this category. */
  matchVehicleTypes: string[];
  fare: FareConfig;
  displayOrder: number;
}

export interface DiscountDetail {
  type: 'percentage' | 'fixed' | 'coupon';
  value: number;
  amount: number;
  source: 'admin' | 'coupon';
  reason: string;
}

export interface FareBreakdown {
  /** Package total before the global % adjustment. */
  subtotalBeforeAdjustment?: number;
  globalAdjustment?: { id: string; name: string; direction: 'increase' | 'decrease'; percent: number; amount: number } | null;
  discountDetail?: DiscountDetail | null;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  nightCharge: number;
  driverAllowance: number;
  minimumFareAdjustment: number;
  /** Pre-GST difference when NESAM agreed a different fare (set only by the booking server). */
  adminAdjustment?: number;
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

export type PaymentMethod = 'Cash' | 'UPI' | 'Wallet' | 'Card';
export type TripType = 'One Way' | 'Round Trip' | 'Local Rental' | 'Airport Taxi';

export type BookingStatus = 'Pending' | 'Approved' | 'Confirmed' | 'Assigned' | 'Ongoing' | 'Completed' | 'Cancelled' | 'Rejected';

/** One line of the fare breakup the booking server stores (functions/src/domain/fareBreakup.ts). */
export interface FareLine {
  key: string;
  label: string;
  /** Rupees; negative for reductions; null = billed at actuals / rate only. */
  amount: number | null;
  treatment: 'included' | 'extra' | 'not_applicable';
  detail: string;
}
export type TripStage =
  | 'Assigned'
  | 'En Route Pickup'
  | 'Reached Pickup'
  | 'In Progress'
  | 'Arrived Destination'
  | 'Completed';

/** What the rider should be looking at right now, derived from status + stage. */
export type RidePhase =
  | 'awaiting_review'
  | 'arranging'
  | 'partner_confirmed'
  | 'driver_assigned'
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
  /** Complete ordered route for a travel-desk Multicity booking. */
  itinerary?: GeoPlace[];
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
  /** The server's breakup (included / extra lines); empty on bookings made before it existed. */
  fareLines: FareLine[];
  /** Server-derived payment picture; null on bookings from before payments were recorded one by one. */
  paid: { totalPaid: number; balanceDue: number; status: string } | null;
  /** Refund recorded on a cancelled booking (status Pending / Processing / Completed …). */
  refund: { status: string; amount: number } | null;
  tollCharges: number;
  /** Extra charges (waiting / hill / roof carrier) the office approved for this trip, incl. any GST, in rupees; 0 until then. */
  extraCharges?: number;
  couponCode: string;
  paymentMethod: PaymentMethod | string;
  paymentStatus: string;
  distanceKm: number;
  durationMin: number;
  notes: string;
  isScheduled: boolean;
  scheduledAt: Date | null;
  createdAt: Date | null;
  /** When NESAM approved the booking (it then becomes visible to partners). */
  approvedAt: Date | null;
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
  source?: string;
  bookingSource?: string;
  brand?: string;
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
}

export interface AppliedCoupon {
  code: string;
  discount: number;
  message: string;
}
