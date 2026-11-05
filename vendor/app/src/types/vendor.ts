// Copied from vendor/web/src/types.d.ts (as a regular module). The onboarding
// types are used as-is; post-approval operational types live in ./operations.ts.
// VendorProfile gains commissionRate (admin-set, read by the wallet).
export type VerificationStatus = 'Pending' | 'Approved' | 'Rejected' | 'Needs Correction';

export interface VendorProfile {
  id: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  email: string;
  gstin: string;
  panNumber: string;
  address: string;
  city: string;
  totalFleetSize: number;
  totalDriversCount: number;
  verificationStatus: VerificationStatus;
  joinedDate: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifscCode: string;
  upiId: string;
  /** Platform commission on fares (admin-set; 0.15 when not configured). */
  commissionRate: number;
}

export interface FleetVehicle {
  id: string;
  vehicleNumber: string;
  category: 'Sedan' | 'SUV' | 'Mini' | 'Luxury' | 'Tempo Traveller';
  make: string;
  model: string;
  year: string;
  seatingCapacity: number;
  status: 'Active' | 'On Trip' | 'Maintenance' | 'Inactive';
  assignedDriverId?: string;
  assignedDriverName?: string;
  rcDocUrl?: string;
  insuranceDocUrl?: string;
  fitnessDocUrl?: string;
  statePermitDocUrl?: string;
  docStatus: VerificationStatus;
}

export interface FleetDriver {
  id: string;
  name: string;
  phone: string;
  email: string;
  photoUrl: string;
  licenseNumber: string;
  licenseExpiry: string;
  licenseFrontUrl?: string;
  licenseBackUrl?: string;
  status: 'Available' | 'On Trip' | 'Offline' | 'Suspended';
  assignedVehicleNumber?: string;
  rating: number;
  totalTrips: number;
  docStatus: VerificationStatus;
}

export interface OpenTrip {
  id: string;
  bookingId: string;
  route: string;
  pickup: {
    address: string;
    city: string;
    time: string;
  };
  drop: {
    address: string;
    city: string;
  };
  travelDate: string;
  vehicleCategory: 'Sedan' | 'SUV' | 'Mini' | 'Luxury' | 'Tempo Traveller';
  distanceKm: number;
  offeredPayout: number; // Customer/Platform offered payout
  status: 'Open' | 'Bidding' | 'Assigned' | 'Cancelled';
}

export interface BidProposal {
  id: string;
  tripId: string;
  bookingId: string;
  offeredPayout: number;
  vendorCounterRate: number; // Proposed payout
  biddingNote?: string;
  submittedAt: string;
  status: 'Pending Review' | 'Accepted' | 'Rejected' | 'Outbid';
}

export interface VendorTrip {
  id: string;
  bookingId: string;
  customerName: string;
  customerPhone: string;
  customerPhoneMasked?: string;
  pickupAddress: string;
  dropAddress: string;
  scheduledTime: string;
  vehicleNumber: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  grossFare: number;
  platformFee: number; // 10%
  vendorPayout: number;
  status: 'Assigned' | 'En Route Pickup' | 'Reached Pickup' | 'In Progress' | 'Completed' | 'Cancelled';
}

export interface WalletDetails {
  availableBalance: number;
  pendingBalance: number;
  lifetimeEarnings: number;
  upiId: string;
  bankAccountName: string;
  bankAccountNumber: string;
  ifscCode: string;
}

export interface PayoutRequest {
  id: string;
  amount: number;
  requestedAt: string;
  processedAt?: string;
  payoutMethod: 'UPI' | 'Bank Transfer';
  targetDetails: string;
  status: 'Pending' | 'Approved' | 'Completed' | 'Rejected';
}

export interface TransactionRecord {
  id: string;
  tripId?: string;
  type: 'Trip Revenue' | 'Platform Fee' | 'Payout Withdrawal';
  amount: number;
  isCredit: boolean;
  timestamp: string;
  description: string;
  status: 'Success' | 'Processing' | 'Failed';
}

// ─── Vendor onboarding / approval pipeline ──────────────────────────────────

/**
 * Canonical lifecycle of a vendors/{uid} document.
 *   INCOMPLETE        wizard started, not yet submitted
 *   PENDING_APPROVAL  submitted, awaiting admin review (vendor is read-only)
 *   CHANGES_REQUESTED admin asked for corrections (vendor may edit + resubmit)
 *   APPROVED          full operational access
 *   REJECTED          admin rejected (vendor may correct + reapply)
 *   SUSPENDED         admin disabled an approved account
 */
export type VendorStatus =
  | 'INCOMPLETE'
  | 'PENDING_APPROVAL'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED';

export type OnboardingSection = 'business' | 'documents' | 'fleet' | 'payout';

/** Metadata for a file in Firebase Storage. Only the path is stored — the
 *  download URL is resolved on demand so Storage rules stay authoritative. */
export interface StoredFile {
  path: string;
  name: string;
  contentType: string;
  size: number;
  uploadedAt: number;
}

export interface BusinessInfo {
  vendorName: string;
  businessName: string;
  email: string;
  altPhone: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    pincode: string;
  };
  operatingCity?: string;
  operatingAreas?: string[];
  estimatedFleetSize?: number;
}

export type BusinessRegType = 'GST' | 'BUSINESS_REGISTRATION' | 'TRADE_LICENSE';
export type IdentityProofType = 'AADHAAR' | 'PAN' | 'PASSPORT';

export interface VendorDocuments {
  businessRegistration: {
    type: BusinessRegType;
    number: string;
    files: StoredFile[];
  };
  identityProof: {
    type: IdentityProofType;
    /** Masked for display only; the full number lives in vendor_kyc. */
    maskedNumber: string;
    files: StoredFile[];
  };
}

/**
 * One vehicle in the application's fleet. Sign-up needs only the registration number; the make,
 * model, dates and the RC, insurance, FC, permit and front photo are optional extras that NESAM
 * can ask for during review. Older applications may carry details copied from the vehicle register
 * (source 'vahan'); nothing writes those any more.
 */
export interface FleetVehicleDoc {
  /** Normalised plate, e.g. TN01AB1234. */
  registrationNumber: string;
  /** Where the vehicle's identity came from. Sign-up records 'manual'; 'vahan' only appears on older applications. */
  source: 'vahan' | 'manual';
  /** Suggested NESAM category (Sedan, SUV, Premium SUV, …). */
  category: string;
  make: string;
  model: string;
  fuelType: string;
  /** Passenger seats, excluding the driver. */
  passengerSeats: number;
  seatClass: string;
  year: string;
  /** Register problems the server reported, as codes; shown to the reviewer. */
  issues: string[];
  /** Validity from the documents (ISO dates). */
  insuranceUpto: string;
  fitnessUpto: string;
  permitUpto: string;
  rcFiles: StoredFile[];
  insuranceFiles: StoredFile[];
  fitnessFiles: StoredFile[];
  permitFiles: StoredFile[];
  frontPhotoFiles: StoredFile[];
}

export interface FleetDetails {
  vehicleTypes: string[];
  fleetSize: number;
  /** Aggregates of the per-vehicle files, kept for the document viewers. */
  rcFiles: StoredFile[];
  vehiclePhotos: StoredFile[];
  insuranceFiles: StoredFile[];
  fcFiles?: StoredFile[];
  permitFiles?: StoredFile[];
  /** Normalised plates of `vehicles`, so another partner's duplicate check can query them. */
  plates?: string[];
  /** Per-vehicle documentation; absent on applications made before page-13 onboarding. */
  vehicles?: FleetVehicleDoc[];
}

/** Private payout details — vendor_kyc/{uid}, readable by owner + admin only. */
export interface PayoutDetails {
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
}

export interface PayoutSummary {
  accountHolderName: string;
  bankLast4: string;
  ifsc: string;
  upiId: string;
}

export interface AdminReview {
  note: string;
  flaggedSections: OnboardingSection[];
  reviewedAt?: number;
}

/** Normalised view of vendors/{uid} used by the gatekeeper + wizard. */
export interface VendorRecord {
  uid: string;
  phone: string;
  status: VendorStatus;
  onboardingStep: number;
  business: BusinessInfo | null;
  documents: VendorDocuments | null;
  fleet: FleetDetails | null;
  payoutSummary: PayoutSummary | null;
  review: AdminReview | null;
  submittedAt: number | null;
}
