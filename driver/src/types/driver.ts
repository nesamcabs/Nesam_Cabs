// Copied from driver/web/src/types.d.ts (as a regular module) and extended
// with the fields the mobile app reads: trip notes, assignment time and the
// payout reference / processed date.
// Driver presence shown in the header / dashboard. Stored on drivers/{uid}
// as `presenceStatus` — never as `status`, which is the admin approval state.
export type DriverStatus = 'Offline' | 'Online' | 'On Trip';

// drivers/{uid}.status — set to 'Pending' at signup, changed only by an admin
// (except Rejected → Pending when the driver resubmits corrected documents).
export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected' | 'Suspended';

export type DocumentStatus = 'Pending' | 'Approved' | 'Rejected';

export type VehicleCategory = 'Hatchback' | 'Sedan' | 'SUV' | 'Premium SUV' | 'Tempo Traveller';

export interface DriverProfile {
  id: string;
  name: string;
  phone: string;
  email: string;
  photoUrl: string;
  dob: string;
  gender: string;
  address: string;
  city: string;
  pincode: string;
  emergencyContactName: string;
  emergencyContact: string;
  /** null until customers have rated this driver. */
  rating: number | null;
  joiningDate: string;
  vendorId?: string;
  vendorName?: string;
  /** Vehicle record paired with this driver by NESAM/vendor; a claim must name it. */
  assignedVehicleId?: string;
  approvalStatus: ApprovalStatus;
  docStatus: DocumentStatus;
  rejectionReason?: string;
  presenceStatus: DriverStatus;
  /** The fleet operator has put this driver on hold (vendor fleet panel); NESAM stops giving them duties. */
  fleetSuspended: boolean;
  /** Account hold set by NESAM staff: Suspended / Inactive / Dispute hold / Permanent block / Reactivation pending ('' when active). */
  holdLabel: string;
  holdReason: string;
  holdUntil?: Date;
}

export interface IdentityDetails {
  aadhaarNumber: string;
  aadhaarFrontUrl: string;
  aadhaarBackUrl: string;
  panNumber: string;
  panPhotoUrl: string;
}

export interface DrivingLicense {
  number: string;
  expiryDate: string;
  frontPhotoUrl: string;
  backPhotoUrl: string;
}

/** Spec page 14 classes a vehicle is eligible for (suggested from the register, confirmed by an admin). */
export type SpecVehicleClass = 'Sedan' | 'SUV' | 'Innova' | 'Crysta' | 'Tempo Traveller';

export interface VehicleValidity {
  fitnessUpto: string;
  insuranceUpto: string;
  permitUpto: string;
  taxUpto: string;
  pucUpto: string;
}

/** A vehicle as the national register (VAHAN) describes it — returned by the lookupVehicleByRegistration function. */
export interface DetectedVehicle {
  registrationNumber: string;
  make: string;
  model: string;
  variant: string;
  fuelType: string;
  /** RC seating capacity; includes the driver's seat. */
  seatingCapacity: number;
  passengerSeats: number;
  seatClass: string;
  manufactureYear: string;
  colour: string;
  vehicleClass: string;
  usage: 'commercial' | 'private' | 'unknown';
  registrationStatus: string;
  registrationActive: boolean | null;
  registeredAt: string;
  ownerNameMasked: string;
  category: VehicleCategory;
  specClass: SpecVehicleClass;
  validity: VehicleValidity;
}

export interface VehicleIssue {
  code: string;
  message: string;
}

export type VehicleLookupResult =
  | { status: 'found'; registrationNumber: string; vehicle: DetectedVehicle; issues: VehicleIssue[]; duplicate: boolean; fetchedAtMs: number; source: string }
  | { status: 'not_found' | 'not_configured' | 'unavailable'; registrationNumber: string };

/**
 * What the onboarding keeps about the automatic detection. The authoritative
 * record is the server-written vehicle_lookups/{plate}; this is the copy the
 * app needs to resume a draft and show the review screen.
 */
export interface VahanSnapshot {
  status: 'found' | 'not_found' | 'not_configured' | 'unavailable';
  /** vehicle_lookups document id (the normalised plate). */
  lookupId: string;
  fetchedAtMs: number;
  duplicate: boolean;
  issues: string[];
  seatClass: string;
  specClass: SpecVehicleClass | '';
  usage: string;
  /** The partner chose the vehicle type by hand because the register was unreachable. */
  manualType: boolean;
  validity: VehicleValidity;
}

export interface VehicleDetails {
  vehicleNumber: string;
  vehicleType: VehicleCategory;
  make: string;
  model: string;
  year: string;
  color: string;
  capacity: number;
  fuelType: string;
  rcNumber: string;
  rcDocUrl: string;
  insuranceNumber: string;
  insuranceExpiry: string;
  insuranceDocUrl: string;
  fitnessExpiry: string;
  fitnessDocUrl: string;
  statePermitNumber: string;
  permitExpiry: string;
  statePermitDocUrl: string;
  frontPhotoUrl: string;
  rearPhotoUrl: string;
  sidePhotoUrl: string;
  interiorPhotoUrl: string;
  /** Automatic detection result; absent until the vehicle was checked. */
  vahan?: VahanSnapshot;
}

export interface BankDetails {
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  upiId: string;
}

/** Everything the signup wizard collects. */
export interface RegistrationData {
  profile: Pick<DriverProfile,
    'name' | 'phone' | 'email' | 'photoUrl' | 'dob' | 'gender' | 'address' |
    'city' | 'pincode' | 'emergencyContactName' | 'emergencyContact'>;
  identity: IdentityDetails;
  license: DrivingLicense;
  vehicle: VehicleDetails;
  bank: BankDetails;
}

/** A complete driver record as read back from drivers/{uid}. */
export interface DriverAccount extends RegistrationData {
  driver: DriverProfile;
}

/** Vehicle verification recorded by the server: three camera photos (no driver selfie) and the starting odometer. */
export interface PreTripPhotos {
  vehicleFront: string;
  vehicleRear: string;
  vehicleInterior: string;
  odometerReading: number;
  capturedAt: string;
}

/** The driver's three trip steps — Reached Pickup → Trip Started → Trip Ended (stored as tripSubStatus; the server enforces the order). */
export type TripSubStatus = 'Not Started' | 'Reached Pickup' | 'Trip Started' | 'Trip Ended';

// Driver-reported progress, stored on the booking as `tripStage`.
export type TripStage =
  | 'Assigned'
  | 'En Route Pickup'
  | 'Reached Pickup'
  | 'In Progress'
  | 'Arrived Destination'
  | 'Completed';

// Booking lifecycle status (see firestore.rules).
export type BookingStatus = 'Pending' | 'Approved' | 'Confirmed' | 'Assigned' | 'Ongoing' | 'Completed' | 'Cancelled' | 'Rejected';

export interface TripLocation {
  address: string;
  lat?: number;
  lng?: number;
}

export interface TollReceipt {
  id: string;
  name: string;
  amount: number;
  receiptPhotoUrl: string;
  uploadedAt: string;
}

export interface TripDetails {
  id: string;
  bookingId: string;
  customerName: string;
  /** Empty: the number is revealed on demand by the server (T-8h, assigned driver only). */
  customerPhone: string;
  customerPhoneMasked: string;
  pickup: TripLocation;
  drop: TripLocation;
  /** A Multicity tour's places between pickup and drop, in order. */
  via?: string[];
  /** The same places with their coordinates (from the booking's `stops`), so navigation can route through them. */
  viaPlaces?: TripLocation[];
  distanceKm: number;
  vehicleType: string;
  serviceType: string;
  fareAmount: number;
  /** The agreed payout recorded on the booking; 0 when none is recorded (see payoutRecorded). */
  driverEarnings: number;
  /** false = no driverPayout on the booking: shown as "Not recorded", never estimated. */
  payoutRecorded: boolean;
  /** true once finance finalized the trip (bookings/{id}.finance); driverEarnings is then the finalized amount. */
  payoutFinalized: boolean;
  /** Assigned through a vendor: the vendor is paid and settles with the driver. */
  fleetTrip: boolean;
  tollCharges: number;
  status: BookingStatus;
  /** Legacy stage the older screens read; the server mirrors the sub-status into it. */
  stage: TripStage;
  subStatus: TripSubStatus;
  /** The three vehicle photos and odometer were submitted and accepted for review. */
  verificationSubmitted: boolean;
  /** The customer's boarding OTP was verified at pickup. */
  boardingVerified: boolean;
  /** What the customer still owes on this booking, from the recorded payments. */
  balanceDue?: number;
  /** Confirmed receipts so far (server paymentSummary). */
  totalPaid?: number;
  /** The customer fare as the booking stored it: what is included and what is payable separately. */
  fareLines?: { key: string; label: string; detail?: string; amount: number | null; treatment: 'included' | 'extra' | 'not_applicable' }[];
  reachedPickupAt?: Date | null;
  /** When this driver accepted / was given the duty (cancellation grace period starts here). */
  acceptedAt?: Date | null;
  /** Owner-driver cancellation request on this duty (server-written; the duty stays assigned until approved). */
  cancellationRequest?: { requestId: string; status: string; quotedPenalty: number } | null;
  /** Waiting / hill / roof carrier recorded for this trip and where it stands in office review. */
  extraUsage?: { revision: number; status: 'submitted' | 'approved' | 'rejected'; reviewNote: string; usage: { stops: { stopId: string; waitedMinutes: number }[] | null; hill: boolean | null; carrier: boolean | null } } | null;
  /** This driver's response to the dispatched duty, shown to the vendor. */
  driverResponse?: { viewedAt: Date | null; acknowledgedAt: Date | null } | null;
  /** Booked pickup time (pickupAt / scheduledAt); null when the booking does not say. */
  pickupAt: Date | null;
  scheduledDate: string;
  scheduledTime: string;
  paymentMode: string;
  /** Rider's note for the driver (gate number, landmark, luggage). */
  notes: string;
  startOdometer?: number;
  endOdometer?: number;
  preTrip?: PreTripPhotos;
  tolls: TollReceipt[];
  completedAt?: Date | null;
  assignedAt?: Date | null;
  /** The booked trip type ('One Way', 'Local Rental', …). */
  tripType?: string;
  /** Hourly Rental or Pickup & Drop when the booking is a local order; null otherwise. */
  localMode?: LocalMode | null;
  /** The local duty this order was taken on (functions/src/localShifts.ts). */
  localShiftId?: string;
  /** Hourly Rental: the booked package hours, the KM it includes and the rate for each extra hour. */
  rentalHours?: number | null;
  includedKm?: number | null;
  extraHourRate?: number | null;
  /** When the customer's journey started (server stamp): the rental clock runs from here. */
  tripStartedAt?: Date | null;
  /** Server record of the time an Hourly Rental used against its package. */
  rentalUsage?: { packageHours: number; usedMinutes: number; overtimeMinutes: number; extraHours: number; extraHourRate: number; indicativeExtra: number } | null;
  /** Received by the driver / fleet directly (cash, UPI to the driver): held by the fleet and settled with NESAM. */
  cashHeld?: number;
  /** The kilometres the driver entered at Trip End. */
  totalKm?: number | null;
}

/** An open marketplace offer a driver may accept. */
export interface MarketplaceOffer {
  addOns?: { roofCarrier: boolean; pets: boolean };
  id: string;
  bookingId: string;
  pickup: TripLocation;
  drop: TripLocation;
  /** A Multicity tour's places between pickup and drop, in order. */
  via?: string[];
  pickupTime: string;
  travelDate: string;
  vehicleCategory: string;
  distanceKm: number;
  offeredPayout: number;
  /** 'accept_offer' = take the current offer; 'bid_review' = send a counter amount NESAM reviews. */
  mode: 'accept_offer' | 'bid_review' | '';
  eligibleClasses: string[];
  publishedMs: number;
}

export interface DriverEarningsSummary {
  todayEarnings: number;
  thisWeekEarnings: number;
  thisMonthEarnings: number;
  lifetimeEarnings: number;
  totalTripsCompleted: number;
  tollReimbursements: number;
}

/** wallets/driver_{uid}, written only by the server (functions/src/ledger.ts). */
export interface DriverWallet {
  /** Withdrawable now; negative when cash fares collected exceed earnings. */
  available: number;
  /** Earnings on trips whose customer payment is not verified yet. */
  pending: number;
  reserved: number;
  paidOut: number;
  cashCollected: number;
  tripEarnings: number;
  tollReimbursements: number;
}

/** wallet_ledger entry (schema 2) for this driver. */
export interface LedgerEntry {
  id: string;
  type: string;
  direction: 'credit' | 'debit';
  amount: number;
  status: string;
  bookingId: string;
  bookingCode: string;
  createdAt: Date | null;
}

export interface PayoutRequest {
  id: string;
  amount: number;
  requestedAt: string;
  method: 'UPI' | 'Bank Transfer';
  details: string;
  status: string; // Pending | Paid | Deferred | Rejected
  /** Bank / UPI reference once paid (when the finance team records one). */
  utr: string;
  processedAt: string;
}

export type NotificationCategory = 'bookings' | 'approvals' | 'trips' | 'payments' | 'penalties' | 'general';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';
export type NotificationSound = 'new_booking' | 'approval' | 'general';

export interface DriverNotification {
  id: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
  createdAtMs: number;
  category: NotificationCategory;
  severity: NotificationSeverity;
  sound: NotificationSound;
  bookingId: string;
  bookingCode: string;
  ctaLabel: string;
  ctaPage: string;
  /** false = quiet inbox entry (no popup or tone). */
  popup: boolean;
}

export type PenaltyStatus = 'Pending' | 'Acknowledged' | 'Paid' | 'Deducted' | 'Waived' | 'Disputed';

export interface DriverPenalty {
  id: string;
  amount: number;
  category: string;
  reason: string;
  description: string;
  bookingCode: string;
  bookingId: string;
  incidentDate: string;
  status: PenaltyStatus;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  disputeNote: string;
  issuedAt: Date | null;
  issuedByName: string;
}

// ── Local duty ("continuous moving") ────────────────────────────────────────

/** The two kinds of local order a duty can serve. */
export type LocalMode = 'rental' | 'pickup_drop';

export type LocalShiftStatus = 'Scheduled' | 'Active' | 'Ended' | 'Cancelled' | 'Missed';

/** Totals the server works out from the duty's own bookings (functions/src/domain/localShift.ts shiftTotals). */
export interface LocalShiftStats {
  orders: number;
  completed: number;
  active: number;
  cancelled: number;
  rental: number;
  pickupDrop: number;
  km: number;
  fare: number;
  payout: number;
  tolls: number;
  collected: number;
  cashInHand: number;
  paidOnline: number;
  balanceDue: number;
  rentalMinutes: number;
  overtimeMinutes: number;
}

/** A local duty the driver's fleet partner planned (local_shifts/{id}); written only by the server. */
export interface LocalShift {
  id: string;
  vendorName: string;
  vehicleId: string;
  vehicleNumber: string;
  vehicleCategory: string;
  cityName: string;
  centre: { lat: number; lng: number } | null;
  radiusKm: number;
  services: LocalMode[];
  startsAt: Date | null;
  endsAt: Date | null;
  status: LocalShiftStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  paused: boolean;
  pausedAt: Date | null;
  breakMs: number;
  /** The driver or the partner asked to end it: no new orders, it closes after the orders in hand. */
  endRequested: boolean;
  endReason: string;
  verified: boolean;
  verificationFlagged: boolean;
  releases: number;
  stats: LocalShiftStats;
  note: string;
}

/** A nearby order the driver may take on the duty (localShiftBoard). */
export interface BoardOrder {
  id: string;
  code: string;
  source: 'fleet' | 'marketplace';
  mode: LocalMode;
  pickup: { name: string; address: string; lat: number; lng: number; approx: boolean };
  drop: { name: string; lat: number | null; lng: number | null } | null;
  pickupAtMs: number | null;
  overdue: boolean;
  tripKm: number;
  awayKm: number;
  rentalHours: number | null;
  includedKm: number | null;
  fare: number;
  paymentMethod: string;
  vehicleCategory: string;
}
