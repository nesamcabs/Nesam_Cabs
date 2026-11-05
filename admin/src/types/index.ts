export interface Booking {
  itinerary?: { id: string; name: string; address: string; lat: number; lng: number }[];
  id: string;
  /** Human-facing booking code; `id` is the Firestore document id. */
  bookingId?: string;
  customerId?: string;
  assignedVendorId?: string;
  assignedVendorName?: string;
  assignedDriverId?: string;
  assignedDriverName?: string;
  assignedVehicleNumber?: string;
  tripStage?: string;
  vehicleCategoryId?: string;
  driverPayout?: number;
  vendorPayout?: number;
  tollCharges?: number;
  /** Office-approved extra usage billed to the customer (waiting / hill / roof carrier). Customer amounts only, in paise. */
  extraCharges?: {
    revision: number; status: "approved"; taxTreatment: "no_gst" | "tariff_gst" | null; roundingScope: "per_stop" | "combined" | null; ratesVersion: number;
    usage: { stops: { stopId: string; waitedMinutes: number }[] | null; hill: boolean | null; carrier: boolean | null };
    waiting: { perStop: { stopId: string; waitedMinutes: number; chargeableMinutes: number }[]; chargeableMinutes: number; billedMinutes: number | null } | null;
    customer: { waitingPaise: number; hillPaise: number; carrierPaise: number; subtotalPaise: number; gstPaise: number; totalPaise: number };
    approvedByName?: string; approvedAt?: unknown;
  };
  /** The latest recorded usage and where it stands in review. */
  extraUsage?: {
    revision: number; status: "submitted" | "approved" | "rejected"; note?: string; reviewNote?: string;
    usage: { stops: { stopId: string; waitedMinutes: number }[] | null; hill: boolean | null; carrier: boolean | null };
    submittedByName?: string; submittedRole?: string; reviewedByName?: string;
  };
  tollsApproved?: boolean;
  fareVerified?: boolean;
  /** Locked quote snapshot (server-written): which tariff priced the booking and with what. */
  pricing?: {
    schema: number; source: string; model: string; tariffVersion: number; tariffClass: string | null; gstRate: number;
    quotedKm: number; includedKm: number; extraKmRatePaise: number; customerRatePaise: number; customerBataPaise: number;
    days: number; minKmPerDay: number; packagePaise: number; pickupDate: string; endDate: string | null; gates: string[];
    partner: { mode: string; ratePaise: number; bataPaise: number; minKm: number; days: number; basePaise: number } | null;
  };
  /** Written when the driver ends the trip: the invoice derived from the verified total kilometres. */
  finalFare?: { totalKm: number; quotedKm: number; includedKm: number; extraKm: number; days: number; extraDays: number; quotedFare: number; finalFare: number };
  totalKm?: number;
  distanceDiscrepancy?: { odometerKm: number; enteredKm: number };
  reachedPickupOverride?: { by: string; byName?: string; reason: string };
  tripEndAt?: any;
  billableDays?: number;
  dutyClass?: string;
  phoneMasked?: string;
  contactViews?: number;
  contactDenials?: number;
  couponCode?: string;
  discount?: number;
  /** Written only by the booking server (createBooking / createAdminBooking / overrideBookingFare). */
  fareBreakdown?: {
    baseFare?: number;
    distanceFare?: number;
    timeFare?: number;
    nightCharge?: number;
    driverAllowance?: number;
    minimumFareAdjustment?: number;
    /** Pre-GST difference from an admin-authorised override. */
    adminAdjustment?: number;
    subtotal?: number;
    discount?: number;
    taxableAmount?: number;
    gstRate?: number;
    gst?: number;
    total?: number;
    distanceKm?: number;
    durationMin?: number;
  };
  /** Audit of an admin-authorised fare (null when the calculated fare is charged). */
  fareOverride?: {
    calculatedFare: number | null;
    overriddenFare: number;
    previousFare?: number;
    reason: string;
    byUid: string;
    byName?: string;
    at?: any;
  } | null;
  /** Commission the booking was published under (server-written). */
  commission?: { rate: number; base: "taxable" | "total"; source: string; policyVersion?: number } | null;
  /** How the partner payout was set: offered (policy), bid or manual. */
  payoutSource?: string;
  /** Immutable financial snapshot written by the server when the trip is finalized. */
  finance?: {
    fareTotal: number;
    taxableAmount: number;
    gst: number;
    partnerType: "vendor" | "driver";
    partnerId: string;
    partnerPayout: number | null;
    payoutSource: string;
    commissionRate: number | null;
    commissionBase: "taxable" | "total" | null;
    commissionSource: string;
    platformRevenue: number | null;
    tollCharges: number;
    paymentMethod: string;
    warnings: string[];
    finalizedAt?: unknown;
  };
  /** Customer-readable breakup written by the server: each line is "included" in the fare or "extra" (payable separately). */
  fareBreakup?: {
    lines: { key: string; label: string; amount: number | null; treatment: "included" | "extra" | "not_applicable"; detail: string }[];
    packageTotal: number;
    knownExtras: number;
    hasActualsExtras: boolean;
  } | null;
  discountDetails?: { type: string; value: number; amount: number; source: string; reason: string; byName?: string } | null;
  globalAdjustmentApplied?: { id: string; name: string; direction: string; percent: number; amount: number } | null;
  customerWhatsapp?: { countryCode: string; number: string; e164: string; sameAsMobile: boolean } | null;
  customerEmail?: string;
  customerVerified?: boolean;
  driverPhone?: string;
  tolls?: { id: string; name: string; amount: number; receiptPhotoUrl?: string }[];
  pickupLat?: number;
  pickupLng?: number;
  dropLat?: number;
  dropLng?: number;
  pickupSource?: string;
  /** Pickup instant (UTC timestamp). The display strings `date` / `time` are copies for older screens. */
  pickupAt?: any;
  scheduledAt?: any;
  rideTiming?: string;
  approvedAt?: any;
  approvedByName?: string;
  rejectionReason?: string;
  cancelReason?: string;
  cancelledAt?: any;
  cancellation?: { cancelledBy?: { type?: string; id?: string; name?: string }; reason?: string; charge?: number; at?: any; amountPaid?: number; rejected?: boolean } | null;
  refund?: {
    status: string;
    eligible?: boolean;
    amount: number;
    method?: string;
    reference?: string;
    requestedAt?: any;
    processedAt?: any;
    processedByName?: string;
    history?: { status: string; amount: number; method?: string; reference?: string; note?: string; byName?: string; at?: any }[];
  } | null;
  /** Derived by the server from the payment transactions; never typed in. */
  paymentSummary?: {
    amountDue: number;
    totalPaid: number;
    balanceDue: number;
    partnerCashHeld: number;
    advancePaid: number;
    paidByMethod: Record<string, number>;
    refunded: number;
    status: string;
    overpaid: number;
    transactions: number;
  } | null;
  /** Trip steps: Not Started → Reached Pickup → Trip Started → Trip Ended. */
  tripSubStatus?: string;
  tripStartedAt?: any;
  reachedPickupAt?: any;
  tripEndedAt?: any;
  tripStartedLocation?: { lat: number; lng: number; accuracy?: number | null } | null;
  reachedPickupLocation?: { lat: number; lng: number; accuracy?: number | null } | null;
  tripEndedLocation?: { lat: number; lng: number; accuracy?: number | null } | null;
  boardingVerifiedAt?: any;
  vehicleFrontPhoto?: string;
  vehicleRearPhoto?: string;
  vehicleInteriorPhoto?: string;
  vehicleVerification?: { status: string; riskLevel: string; flagged: boolean; submittedAt?: any } | null;
  /** Which route an admin chose after approval; set by the server. */
  fulfilmentRoute?: "marketplace" | "vendor" | "driver";
  marketplacePublishedAt?: any;
  unassignedAlert?: { severity: string; since?: any; acknowledgedBy?: string; acknowledgedByName?: string; acknowledgedAt?: any; acknowledgedSeverity?: string } | null;
  lastAssignment?: { action: string; byName?: string; reason?: string } | null;
  /** Stable reference to vehicles/{id}; assignedVehicleNumber is a display copy. */
  assignedVehicleId?: string;
  serviceId?: string;
  tripType?: string;
  notes?: string;
  /** Set while an invoice is active for the trip (invoiceService). */
  invoiceId?: string;
  invoiceNumber?: string;
  source?: string;
  bookingSource?: string;
  brand?: string;
  website?: string;
  createdBy?: string;
  completedAt?: any;
  customer: string;
  customerName?: string;
  customerPhone?: string;
  phone?: string;
  vendor?: string;
  service: string;
  serviceType?: string;
  pickup: string;
  pickupAddress?: string;
  drop: string;
  dropAddress?: string;
  date: string;
  time: string;
  vehicle: string;
  vehicleCategory?: string;
  driver?: string;
  fare: string | number;
  payment: string;
  paymentStatus?: string;
  paymentMethod?: string;
  status: string;
  boardingOTP?: string;
  verified?: boolean;
  distanceKm?: number;
  createdAt?: any;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  vehicle?: string;
  assignedVehicleId?: string;
  assignedVehicleNumber?: string;
  vehicleNumber?: string;
  vehicleType?: string;
  presenceStatus?: string;
  docStatus?: string;
  /** Owning vendor (fleet driver); empty for independent drivers. */
  vendorId?: string;
  fleetStatus?: string;
  vendor?: string | null;
  license?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  status: string;
  trips?: number;
  totalTrips?: number;
  earnings?: string;
  rating?: number;
  verified?: boolean;
  wallet?: string;
  penalties?: number;
  tds?: string;
  docs?: {
    license?: string;
    photo?: string;
    rc?: string;
    insurance?: string;
    permit?: string;
  };
  preTrip?: {
    driverSelfie?: string;
    vehicleFront?: string;
    vehicleRear?: string;
    vehicleInterior?: string;
    odometerReading?: number;
  };
  createdAt?: any;
}

export interface VehicleCategoryFare {
  baseFare: number;
  baseKm: number;
  perKmRate: number;
  minimumFare: number;
  driverAllowance: number;
  nightAllowance: number;
  waitingChargePerHour: number;
  extraHourCharge: number;
  extraKmCharge: number;
  tollIncluded: boolean;
  parkingIncluded: boolean;
  permitCharge: number;
  /** Carrier / luggage charge per trip, quoted as an extra. */
  carrierCharge?: number;
  outstationPerKmRate?: number;
  outstationDriverBattaPerDay?: number;
  outstationMinKmPerDay?: number;
}

export interface VehicleCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  imageUrl?: string;
  icon?: string;
  seatingCapacity: number;
  luggageCapacity?: string | number;
  acSupported?: "AC" | "Non-AC" | "Both" | boolean;
  recommendedPassengers?: number;
  displayOrder?: number;
  /** Customers can choose CNG for this category (needs its CNG rate card in Pricing → Base rates). */
  cngEnabled?: boolean;
  status: "Active" | "Inactive";
  fare: VehicleCategoryFare;
  vehicleCount?: number;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

/** Operational state set by the owner. "On Trip" is derived from bookings. */
export type VehicleStatus = "Active" | "Maintenance" | "Inactive";
/** NESAM document review, shared with the vendor app and firestore.rules. */
export type VehicleDocStatus = "Pending" | "Approved" | "Rejected";

/**
 * vehicles/{id} — canonical fields are the ones the vendor app writes
 * (vendor/app/src/services/vendorService.ts). The legacy prototype fields at
 * the end are read for old documents only and never written.
 */
export interface Vehicle {
  id: string;
  vehicleNumber?: string;
  category?: string;
  categoryId?: string;
  make?: string;
  model?: string;
  year?: string;
  seatingCapacity?: number;
  fuelType?: string;
  status?: string;
  docStatus?: string;
  rejectionReason?: string;
  vendorId?: string;
  vendorName?: string;
  assignedDriverId?: string;
  assignedDriverName?: string;
  rcNumber?: string;
  rcDocUrl?: string;
  insuranceExpiry?: string;
  insuranceDocUrl?: string;
  fitnessExpiry?: string;
  fitnessDocUrl?: string;
  permitExpiry?: string;
  statePermitDocUrl?: string;
  createdAt?: any;
  updatedAt?: any;
  // Legacy prototype fields (read-only).
  name?: string;
  number?: string;
  seats?: number;
  fuel?: string;
  driver?: string;
}

export interface Vendor {
  id: string;
  name: string;
  companyName?: string;
  owner: string;
  phone: string;
  email: string;
  city: string;
  gst?: string;
  gstin?: string;
  panNumber?: string;
  status: string;
  verified: boolean;
  fleetSize?: number;
  activeDrivers?: number;
  commission?: string;
  wallet?: string;
  walletBalance?: number;
  lifetimeEarnings?: string;
  joined?: string;
  joinedDate?: string;
  docs?: Record<string, string>;
  createdAt?: any;
}

/** customers/{uid}. Booking counts and spend are derived from bookings (services/customerStats). */
export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  city?: string;
  gender?: string;
  notes?: string;
  source?: string;
  createdAt?: any;
}

export interface MarketplaceTrip {
  id: string;
  bookingId: string;
  pickup: any;
  drop: any;
  date?: string;
  time?: string;
  travelDate?: string;
  vehicleType?: string;
  vehicleCategory?: string;
  distance?: string;
  distanceKm?: number;
  offeredPayout: string | number;
  /** One explicit mode per post: accept the current offer, or bids reviewed by NESAM. */
  mode?: "accept_offer" | "bid_review";
  startOffer?: number;
  ceiling?: number;
  escalation?: { enabled?: boolean; step?: number; stepPercent?: number; intervalMinutes?: number; ceilingPaise?: number };
  cutoffAt?: any;
  status: string;
  postedAt?: string;
  lastCounterRate?: number;
  bids?: Array<{
    vendorId: string;
    vendorName: string;
    amount: string | number;
    status: string;
    time?: string;
  }>;
  createdAt?: any;
}

export interface PaymentTransaction {
  id: string;
  bookingId: string;
  customer: string;
  amount: string;
  method: string;
  gateway?: string;
  date: string;
  status: string;
  refund?: string;
  gst?: string;
  vendorShare?: string;
  commission?: string;
}

export interface PenaltyRecord {
  id: string;
  entityType?: string;
  entityName?: string;
  type: string;
  entity?: string;
  entityId?: string;
  reason: string;
  amount: string;
  walletDeducted?: boolean;
  custCompensation?: string;
  date: string;
  status: string;
  bookingId?: string;
}

export interface NotificationRecord {
  id: number | string;
  type: string;
  title: string;
  message: string;
  time?: string;
  read: boolean;
  createdAt?: any;
  recipientId?: string;
  recipientType?: "admin" | "driver" | "customer" | "vendor" | "all" | string;
  recipientName?: string;
  channel?: string;
  actionUrl?: string;
  priority?: "low" | "normal" | "high" | "urgent";
  isSystemAlert?: boolean;
  broadcast?: boolean;
  /** Tab the notification belongs to; older records are classified from their type. */
  category?: string;
  severity?: "info" | "success" | "warning" | "critical";
  /** Which of the three tones plays for it. */
  sound?: "new_booking" | "approval" | "general";
  bookingId?: string;
  bookingCode?: string;
  cta?: { label: string; page: string; bookingId?: string } | null;
  /** false = quiet inbox entry only (no popup or tone). */
  push?: boolean;
}

export interface InvoiceItem {
  description: string;
  amount: number;
  qty?: number;
  quantity?: number;
  rate?: number;
  sacCode?: string;
}

export interface CompanySnapshot {
  name: string;
  gstin: string;
  address: string;
  phone: string;
  email: string;
  sacCode?: string;
}

export interface CustomerSnapshot {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  gstin?: string;
}

export interface TripSnapshot {
  service: string;
  pickup: string;
  drop: string;
  travelDate: string;
  travelTime?: string;
  vehicle: string;
  vehicleCategory?: string;
  vehicleNumber?: string;
  driverName?: string;
  distanceKm?: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  /** Booking code shown to customers. */
  bookingId: string;
  /** Firestore id of the booking. */
  bookingDocumentId?: string;
  voidReason?: string;
  customerId?: string;
  invoiceDate: string;
  dueDate?: string;
  companySnapshot: CompanySnapshot;
  customerSnapshot: CustomerSnapshot;
  tripSnapshot: TripSnapshot;
  items: InvoiceItem[];
  subtotal: number;
  discount: number;
  taxableAmount: number;
  gstRate: number; // e.g. 0.05 for 5%
  cgst: number;
  sgst: number;
  igst?: number;
  utgst?: number;
  taxSplit?: 'CGST + SGST' | 'CGST + UTGST' | 'IGST';
  totalTax: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: "Paid" | "Partially Paid" | "Pending";
  invoiceStatus: "Issued" | "Draft" | "Cancelled";
  terms?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export interface TravelService {
  id: string;
  name: string;
  code: string;
  slug: string;
  serviceType: string;
  shortDescription?: string;
  fullDescription?: string;
  icon?: string;
  imageUrl?: string;
  status: "Active" | "Inactive";
  displayOrder?: number;
  featured?: boolean;
  onlineBookingEnabled?: boolean;
  adminBookingEnabled?: boolean;
  allowedVehicleCategoryIds?: string[];
  allowedVehicleCategoryNames?: string[];
  airportOptions?: {
    airportPickup: boolean;
    airportDrop: boolean;
  };
  outstationOptions?: {
    oneWayAllowed: boolean;
    roundTripAllowed: boolean;
  };
  seoTitle?: string;
  seoDescription?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  description: string;
  activities?: string;
  meals?: string;
  stay?: string;
}

export interface PackageDeparture {
  id: string;
  date: string;
  time?: string;
  availableSeats?: number;
  status: "Available" | "Filling Fast" | "Sold Out" | "Cancelled";
}

export interface TourPackage {
  id: string;
  name: string;
  code: string;
  slug: string;
  shortDescription?: string;
  fullDescription?: string;
  startingLocation: string;
  endingLocation?: string;
  destinations: string[];
  durationDays: number;
  durationNights: number;
  itinerary: ItineraryDay[];
  pricingModel: "Per Package" | "Per Person" | "Vehicle Based";
  basePrice: number;
  offerPrice?: number;
  adultPrice?: number;
  childPrice?: number;
  allowedVehicleCategoryIds?: string[];
  allowedVehicleCategoryNames?: string[];
  preferredVendorId?: string;
  preferredVendorName?: string;
  departures?: PackageDeparture[];
  inclusions: string[];
  exclusions: string[];
  highlights?: string[];
  coverImageUrl?: string;
  galleryImages?: string[];
  status: "Draft" | "Active" | "Inactive" | "Archived";
  published: boolean;
  featured?: boolean;
  displayOrder?: number;
  seoTitle?: string;
  seoDescription?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export type LocationType =
  | "City"
  | "Area / Locality"
  | "Airport"
  | "Railway Station"
  | "Bus Stand"
  | "Landmark"
  | "Tourist Place"
  | "Other";

export interface MasterLocation {
  id: string;
  name: string;
  normalizedName?: string;
  code?: string;
  type: LocationType;
  state: string;
  district?: string;
  city: string;
  area?: string;
  pincode?: string;
  address?: string;
  parentLocationId?: string;
  parentLocationName?: string;
  lat?: number | null;
  lng?: number | null;
  placeId?: string;
  pickupEnabled: boolean;
  dropEnabled: boolean;
  onlineBookingEnabled?: boolean;
  adminBookingEnabled?: boolean;
  serviceIds?: string[];
  status: "Active" | "Inactive";
  displayOrder?: number;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export type PricingModel =
  | "PER_KM"
  | "BASE_PLUS_PER_KM"
  | "FIXED_ROUTE"
  | "HOURLY_RENTAL"
  | "PER_DAY";

export interface FareRule {
  brand?: string;
  fareService?: string;
  id: string;
  name: string;
  code?: string;
  serviceId?: string;
  serviceName?: string;
  vehicleCategoryId: string;
  vehicleCategoryName?: string;
  pricingType: PricingModel;

  // Location / Route specific
  originLocationId?: string;
  originLocationName?: string;
  destinationLocationId?: string;
  destinationLocationName?: string;

  // Base & Distance
  baseFare: number;
  baseKm: number;
  perKmRate: number;
  minimumKmPerDay?: number;
  minimumFare?: number;

  // Hourly / Rental Package
  includedHours?: number;
  extraKmRate?: number;
  extraHourRate?: number;

  // Allowances & Surcharges
  driverBatta: number;
  nightChargeEnabled?: boolean;
  nightStartTime?: string; // e.g. "22:00"
  nightEndTime?: string; // e.g. "05:00"
  nightChargeType?: "Fixed" | "Percentage";
  nightChargeValue?: number;

  // Waiting Charges
  freeWaitingMinutes?: number;
  waitingChargePerHour?: number;

  // Additional Charges & Modes
  tollMode?: "Included" | "Excluded" | "Fixed";
  fixedTollAmount?: number;
  parkingMode?: "Included" | "Excluded" | "Fixed";
  fixedParkingAmount?: number;
  permitCharge?: number;

  // Status & Priority
  priority?: number;
  status: "Active" | "Inactive";
  effectiveFrom?: string;
  effectiveUntil?: string;

  // Fixed route fares saved with the Fixed route fares tool (absent on older route rules; `baseFare` is the customer fare)
  managed?: boolean;
  partnerPayout?: number;
  gstMode?: "included" | "excluded";
  peakAdjustment?: "apply" | "exclude";
  reverseDirection?: boolean;
  version?: number;
  lastReason?: string;

  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export interface FareCalculationInput {
  serviceName?: string;
  serviceId?: string;
  vehicleCategoryId?: string;
  vehicleCategoryName?: string;
  originLocationId?: string;
  originLocationName?: string;
  destinationLocationId?: string;
  destinationLocationName?: string;
  distanceKm: number;
  tripDays?: number;
  tripHours?: number;
  pickupTime?: string;
  waitingMinutes?: number;
  tollAmount?: number;
  parkingAmount?: number;
  permitAmount?: number;
  discountAmount?: number;
}

export interface FareBreakdownItem {
  label: string;
  amount: number;
  details?: string;
}

export interface FareCalculationResult {
  matchedRule: FareRule | null;
  baseFare: number;
  distanceFare: number;
  driverBatta: number;
  nightCharge: number;
  waitingCharge: number;
  extraKmCharge: number;
  extraHourCharge: number;
  tollAmount: number;
  parkingAmount: number;
  permitAmount: number;
  discountAmount: number;
  subtotal: number;
  gstAmount: number;
  grandTotal: number;
  billableDistanceKm: number;
  breakdown: FareBreakdownItem[];
  fallbackUsed?: boolean;
}

export type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT";
export type CouponStatus =
  | "Draft"
  | "Active"
  | "Scheduled"
  | "Expired"
  | "Inactive"
  | "Archived";

export interface MasterCoupon {
  id: string;
  name: string;
  code: string;
  description?: string;
  termsAndConditions?: string;

  // Discount configuration
  discountType: DiscountType;
  discountValue: number;
  maximumDiscount?: number;
  minimumBookingAmount?: number;

  // Validity
  validFrom: string;
  validUntil: string;

  // Usage limits
  totalUsageLimit?: number;
  usedCount: number;
  perCustomerLimit?: number;

  // Restrictions
  firstBookingOnly?: boolean;
  serviceIds?: string[];
  serviceNames?: string[];
  vehicleCategoryIds?: string[];
  vehicleCategoryNames?: string[];
  locationIds?: string[];
  tourPackageIds?: string[];
  adminBookingOnly?: boolean;

  status: CouponStatus;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: string;
}

export interface CouponValidationContext {
  customerPhone?: string;
  customerId?: string;
  serviceName?: string;
  serviceId?: string;
  vehicleCategoryId?: string;
  vehicleCategoryName?: string;
  eligibleSubtotal: number;
  pickupLocationId?: string;
  dropLocationId?: string;
  tourPackageId?: string;
  isFirstBooking?: boolean;
  currentDate?: Date;
}

export interface CouponValidationResult {
  valid: boolean;
  reasonCode?: string;
  message: string;
  coupon: MasterCoupon | null;
  discountAmount: number;
  finalPayableAmount: number;
}

export type ModerationStatus =
  | "Pending"
  | "Published"
  | "Hidden"
  | "Flagged"
  | "Archived";
export type FlagReason =
  | "Spam"
  | "Abusive Content"
  | "Irrelevant"
  | "Duplicate"
  | "Privacy Concern"
  | "Other";

export interface AdminResponse {
  text: string;
  respondedBy: string;
  respondedAt: string;
  updatedAt?: string;
}

export interface ModerationMeta {
  flagged?: boolean;
  reason?: FlagReason | string;
  moderatedBy?: string;
  moderatedAt?: string;
  internalNotes?: string;
}

export interface CustomerReview {
  id: string;
  bookingId: string;
  customerId: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;

  driverId?: string;
  driverName?: string;
  vehicleNumber?: string;
  serviceId?: string;
  serviceName?: string;
  tourPackageId?: string;

  overallRating: number; // 1 to 5
  driverRating?: number;
  serviceRating?: number;

  reviewText?: string;

  status: ModerationStatus;
  adminResponse?: AdminResponse;
  moderation?: ModerationMeta;

  createdAt: any;
  updatedAt?: any;
}
