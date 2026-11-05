// Firestore → screen models for the vendor portal. Pure functions with no
// display defaults: a value that was never recorded stays empty (or null) and
// the screen says so, instead of showing an invented vehicle, phone or price.
import { formatDate, formatTime12 } from '../utils/time';
import type {
  BidProposal,
  FleetDriver,
  FleetVehicle,
  OpenTrip,
  OperationsConfig,
  PartnerRequestRecord,
  PayoutRequest,
  SecurityDeposit,
  SettlementDue,
  TransactionRecord,
  VendorTrip,
  VerificationStatus,
  WalletDetails,
} from '../types';

type Data = Record<string, unknown>;

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
export const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function maskPhoneStr(phone: string): string {
  if (!phone) return '+91 ••••• •••••';
  if (phone.includes('•')) return phone;
  const d = phone.replace(/\D/g, '');
  if (d.length < 8) return '+91 ••••• •••••';
  const cc = d.length > 10 ? `+${d.slice(0, d.length - 10)} ` : '+91 ';
  const n = d.slice(-10);
  return `${cc}${n.slice(0, 2)}••• ••${n.slice(-3)}`;
}

/** Firestore Timestamp, Date, millis or ISO string → Date (null when absent or invalid). */
export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof (v as { toDate?: unknown }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  if (typeof v === 'number' || typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Amount stored as a number, or as text like "₹1,250" by older records. */
export function money(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const digits = typeof v === 'string' ? v.replace(/[^\d.]/g, '') : '';
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

const review = (v: unknown): VerificationStatus =>
  v === 'Approved' || v === 'Rejected' ? v : v === 'Needs Correction' ? 'Needs Correction' : 'Pending';

export function mapVehicle(id: string, d: Data): FleetVehicle {
  const seats = num(d.seatingCapacity) ?? num(d.seats);
  return {
    id,
    vehicleNumber: str(d.vehicleNumber) || str(d.number),
    category: str(d.category),
    categoryId: str(d.categoryId),
    make: str(d.make),
    model: str(d.model),
    year: str(d.year) || (num(d.year) !== null ? String(d.year) : ''),
    seatingCapacity: seats !== null && seats > 0 ? seats : null,
    // Same reading as firestore.rules: a missing status is in service.
    status: d.status === 'Maintenance' || d.status === 'Inactive' || d.status === 'Accident Hold' ? d.status : 'Active',
    assignedDriverId: str(d.assignedDriverId),
    assignedDriverName: str(d.assignedDriverName),
    // Only an explicit review decision counts; dispatch requires "Approved".
    docStatus: review(d.docStatus),
    rejectionReason: str(d.rejectionReason),
    expiries: {
      rc: str(d.rcExpiry), insurance: str(d.insuranceExpiry), fitness: str(d.fitnessExpiry), permit: str(d.permitExpiry), puc: str(d.pucExpiry),
    },
    availableFrom: toDate((d.availability as Data | undefined)?.availableFrom),
    availabilityLocation: str((d.availability as Data | undefined)?.location),
    vehicleClass: str(d.vehicleClass),
    code: str(d.vehicleCode) || str(d.carCode),
  };
}

export function mapDriver(id: string, d: Data): FleetDriver {
  // Driver signup used to store a placeholder 5; a rating counts only when
  // backed by a number of customer ratings.
  const count = num(d.ratingCount);
  const rating = count !== null && count > 0 ? num(d.rating) : null;
  return {
    id,
    name: str(d.name),
    phone: str(d.phone),
    email: str(d.email),
    photoUrl: str(d.photoUrl),
    licenseNumber: str(d.licenseNumber),
    licenseExpiry: str(d.licenseExpiry),
    accountStatus: review(d.status),
    suspended: d.fleetStatus === 'Suspended',
    online: d.presenceStatus === 'Online',
    assignedVehicleId: str(d.assignedVehicleId),
    assignedVehicleNumber: str(d.assignedVehicleNumber),
    rating: rating !== null && rating > 0 ? rating : null,
    code: str(d.driverCode),
    docStatus: review(d.docStatus),
    rejectionReason: str(d.rejectionReason),
  };
}

/** Drivers a vendor may dispatch: approved by NESAM and not suspended by the fleet. */
export const dispatchableDriver = (d: FleetDriver) => d.accountStatus === 'Approved' && !d.suspended;
/** Vehicles a vendor may dispatch: documents approved and in service. */
export const dispatchableVehicle = (v: FleetVehicle) => v.docStatus === 'Approved' && v.status === 'Active' && !!v.vehicleNumber;

function place(v: unknown): { address: string; city: string; time: string } {
  if (typeof v === 'string') return { address: v.trim(), city: '', time: '' };
  const p = (v && typeof v === 'object' ? v : {}) as Data;
  return { address: str(p.address), city: str(p.city), time: str(p.time) };
}

export function mapOpenTrip(id: string, d: Data): OpenTrip {
  const offer = num(d.offeredPayout);
  const pickup = place(d.pickup);
  // Show the time on a 12-hour clock, in India time, whenever the real pickup instant is stored.
  const at = toDate(d.pickupAt);
  if (at) {
    pickup.time = formatTime12(at);
  }
  const drop = place(d.drop);
  const distance = num(d.distanceKm);
  return {
    id,
    bookingId: str(d.bookingId) || id,
    route: str(d.route) || [pickup.city || pickup.address, drop.city || drop.address].filter(Boolean).join(' → '),
    pickup,
    drop: { address: drop.address, city: drop.city },
    travelDate: at ? formatDate(at) : str(d.travelDate),
    vehicleCategory: str(d.vehicleCategory),
    distanceKm: distance !== null && distance > 0 ? distance : null,
    offeredPayout: offer !== null && offer > 0 ? offer : null,
    status: d.status === 'Bidding' ? 'Bidding' : 'Open',
    mode: d.mode === 'bid_review' ? 'bid_review' : d.mode === 'accept_offer' ? 'accept_offer' : '',
    tripType: tripTypeOf(d),
    pickupAt: at,
    cutoffAt: toDate(d.cutoffAt),
    terms: termsOf(d.terms),
  };
}

/** "One Way", "Round Trip", "Local Rental", "Multicity", "Airport" from what the booking stored. */
export function tripTypeOf(d: Data): string {
  const raw = `${str(d.tripType)} ${str(d.service)} ${str(d.bookingType)}`.toLowerCase();
  if (/round/.test(raw)) return 'Round Trip';
  if (/rental|local|hour/.test(raw)) return 'Local Rental';
  if (/multi/.test(raw)) return 'Multicity';
  if (/airport/.test(raw)) return 'Airport';
  if (/one|drop|outstation/.test(raw)) return 'One Way';
  return str(d.tripType) || str(d.service);
}

function termsOf(v: unknown) {
  if (!v || typeof v !== 'object') return null;
  const t = v as Data;
  const items = (t.items && typeof t.items === 'object' ? t.items : {}) as Record<string, unknown>;
  return {
    customerExtraKm: num(t.customerExtraKm),
    partnerExtraKm: num(t.partnerExtraKm),
    items: Object.fromEntries(Object.entries(items).map(([k, x]) => [k, str(x)])),
  };
}

export function mapBid(id: string, d: Data): BidProposal {
  return {
    id,
    tripId: str(d.tripId),
    bookingId: str(d.bookingId),
    offeredPayout: num(d.offeredPayout),
    vendorCounterRate: num(d.vendorCounterRate) ?? 0,
    biddingNote: str(d.biddingNote),
    submittedAt: toDate(d.submittedAt),
    status: str(d.status) || 'Pending Review',
    autoAcceptConsent: d.autoAcceptConsent === true,
  };
}

export function mapVendorTrip(id: string, d: Data): VendorTrip {
  const payout = num(d.vendorPayout);
  const at = toDate(d.pickupAt) ?? toDate(d.scheduledAt);
  const schedule = at ? `${formatDate(at)}, ${formatTime12(at)}` : [str(d.date), str(d.time)].filter(Boolean).join(', ');
  const summary = d.paymentSummary && typeof d.paymentSummary === 'object' ? (d.paymentSummary as Data) : null;
  const verification = (d.vehicleVerification && typeof d.vehicleVerification === 'object' ? d.vehicleVerification : {}) as Data;
  const breakup = (d.fareBreakup && typeof d.fareBreakup === 'object' ? d.fareBreakup : {}) as { lines?: unknown };
  const response = d.driverResponse && typeof d.driverResponse === 'object' ? (d.driverResponse as Data) : null;
  const cancel = d.cancellationRequest && typeof d.cancellationRequest === 'object' ? (d.cancellationRequest as Data) : null;
  const pickupPoint = (d.pickupPoint && typeof d.pickupPoint === 'object' ? d.pickupPoint : d.pickup && typeof d.pickup === 'object' ? d.pickup : {}) as Data;
  const dropPoint = (d.dropPoint && typeof d.dropPoint === 'object' ? d.dropPoint : d.drop && typeof d.drop === 'object' ? d.drop : {}) as Data;
  return {
    id,
    bookingId: str(d.bookingId) || id,
    customerName: str(d.customer) || str(d.customerName),
    customerPhone: str(d.phoneMasked) || str(d.customerPhoneMasked) || maskPhoneStr(str(d.phone) || str(d.customerPhone)),
    customerPhoneMasked: str(d.phoneMasked) || str(d.customerPhoneMasked) || maskPhoneStr(str(d.phone) || str(d.customerPhone)),
    pickupAddress: str(d.pickupAddress) || str(d.pickup),
    dropAddress: str(d.dropAddress) || str(d.drop),
    pickupLat: num(pickupPoint.lat),
    pickupLng: num(pickupPoint.lng),
    dropLat: num(dropPoint.lat),
    dropLng: num(dropPoint.lng),
    scheduledTime: schedule,
    vehicleId: str(d.assignedVehicleId),
    vehicleNumber: str(d.assignedVehicleNumber),
    driverId: str(d.assignedDriverId),
    driverName: str(d.assignedDriverName) || str(d.driver),
    driverPhone: str(d.driverPhone),
    grossFare: money(d.fare),
    vendorPayout: payout !== null && payout > 0 ? payout : null,
    status: str(d.status),
    tripStage: str(d.tripStage),
    tripSubStatus: str(d.tripSubStatus),
    verificationSubmitted: verification.status === 'Submitted',
    verificationRisk: str(verification.riskLevel),
    paymentStatus: summary ? str(summary.status) : '',
    totalPaid: summary ? num(summary.totalPaid) : null,
    balanceDue: summary ? num(summary.balanceDue) : null,
    fareLines: Array.isArray(breakup.lines) ? (breakup.lines as { key: string; label: string; amount: number | null; treatment: string; detail: string }[]) : [],
    pickupAt: at,
    pickupLabel: str(d.pickupCity) || str(d.pickup) || str(d.pickupAddress),
    dropLabel: str(d.dropCity) || str(d.drop) || str(d.dropAddress),
    tripType: tripTypeOf(d),
    vehicleCategory: str(d.vehicleCategory) || str(d.vehicle),
    includedKm: includedKmOf(d),
    acceptedAt: toDate(d.assignedVendorAt) ?? toDate(d.acceptedAt) ?? toDate(d.confirmedAt),
    assignBy: toDate(d.assignBy),
    driverResponse: response && str(response.driverId) === str(d.assignedDriverId)
      ? { viewedAt: toDate(response.viewedAt), acknowledgedAt: toDate(response.acknowledgedAt) }
      : null,
    cancellationRequest: cancel
      ? { requestId: str(cancel.requestId), status: str(cancel.status), quotedPenalty: num(cancel.quotedPenalty) ?? 0, finalPenalty: num(cancel.finalPenalty) }
      : null,
    completedAt: toDate(d.tripEndAt) ?? toDate(d.completedAt),
  };
}

function includedKmOf(d: Data): number | null {
  const pricing = (d.pricing && typeof d.pricing === 'object' ? d.pricing : {}) as Data;
  const km = num(pricing.includedKm) ?? num(pricing.quotedKm) ?? num(d.distanceKm);
  return km !== null && km > 0 ? Math.round(km) : null;
}

export function mapPartnerRequest(id: string, d: Data): PartnerRequestRecord {
  const type = d.type === 'bank_change' ? 'bank_change' : d.type === 'document_renewal' ? 'document_renewal' : 'cancellation';
  const status = d.status === 'Approved' ? 'Approved' : d.status === 'Declined' ? 'Declined' : 'Pending';
  return {
    id, type, status, bookingId: str(d.bookingId), bookingCode: str(d.bookingCode), route: str(d.route), reasonLabel: str(d.reasonLabel), details: str(d.details),
    quotedPenalty: num(d.quotedPenalty) ?? 0, ruleLabel: str(d.ruleLabel), finalPenalty: num(d.finalPenalty), adminReason: str(d.adminReason),
    requestedAt: toDate(d.requestedAt) ?? toDate(d.createdAt), decidedAt: toDate(d.decidedAt), documentLabel: str(d.documentLabel), entityName: str(d.entityName),
    expiry: str(d.expiry), accountLast4: str(d.accountLast4), ifsc: str(d.ifsc),
  };
}

export function mapDeposit(d: Data | undefined): SecurityDeposit | null {
  if (!d) return null;
  return { amount: num(d.amount) ?? 0, status: str(d.status) || 'Not paid', reference: str(d.reference) };
}

export function mapSettlementDue(id: string, d: Data): SettlementDue {
  return {
    id, bookingCode: str(d.bookingCode) || id, amount: num(d.amount) ?? 0, entitlement: num(d.entitlement) ?? 0,
    collectedByPartner: num(d.collectedByPartner) ?? 0, status: str(d.status) || 'Due', dueAt: toDate(d.dueAt), completedAt: toDate(d.completedAt),
  };
}

const hoursIn = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 72 ? v : fallback);
const rupeesIn = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : fallback);

/** settings/operations — the same defaults the server applies (functions/src/partnerOps.ts). */
export function mapOperations(d: Data | undefined): OperationsConfig {
  const c = ((d?.partnerCancellation ?? {}) as Data);
  return {
    assignmentWindowHours: hoursIn(d?.vendorAssignmentWindowHours, 2),
    assignBeforePickupHours: hoursIn(d?.vendorAssignBeforePickupHours, 1),
    missedAssignmentPenalty: rupeesIn(d?.missedAssignmentPenalty, 500),
    cancellation: {
      lastMinuteHours: hoursIn(c.lastMinuteHours, 4), lastMinuteCharge: rupeesIn(c.lastMinuteCharge, 1000),
      graceHours: hoursIn(c.graceHours, 4), afterGraceCharge: rupeesIn(c.afterGraceCharge, 500),
    },
    supportPhone: str(d?.supportPhone) || '+919025099990',
  };
}

export const EMPTY_WALLET: WalletDetails = {
  available: 0,
  pending: 0,
  reserved: 0,
  paidOut: 0,
  cashCollected: 0,
  tripEarnings: 0,
  tollReimbursements: 0,
  updatedAt: null,
};

/** wallets/vendor_{uid}; a partner with no ledger activity yet has an empty wallet. */
export function mapWallet(d: Data | undefined): WalletDetails {
  if (!d) return EMPTY_WALLET;
  return {
    available: num(d.available) ?? 0,
    pending: num(d.pending) ?? 0,
    reserved: num(d.reserved) ?? 0,
    paidOut: num(d.paidOut) ?? 0,
    cashCollected: num(d.cashCollected) ?? 0,
    tripEarnings: num(d.tripEarnings) ?? 0,
    tollReimbursements: num(d.tollReimbursements) ?? 0,
    updatedAt: toDate(d.updatedAt),
  };
}

/** Canonical ledger entries only (schema 2); older audit records are not balances. */
export function mapLedgerEntry(id: string, d: Data): TransactionRecord | null {
  if (d.schema !== 2) return null;
  return {
    id,
    type: str(d.type),
    direction: d.direction === 'debit' ? 'debit' : 'credit',
    amount: num(d.netAmount) ?? 0,
    status: str(d.status),
    bookingCode: str(d.bookingCode),
    payoutRequestId: str(d.payoutRequestId),
    createdAt: toDate(d.createdAt),
    penaltyId: str(d.penaltyId),
    reference: str(d.reference) || str(d.rechargeOrderId),
  };
}

export function mapPayout(id: string, d: Data): PayoutRequest {
  return {
    id,
    amount: num(d.amount) ?? money(d.amount) ?? 0,
    requestedAt: toDate(d.createdAt) ?? toDate(d.requestedAt),
    processedAt: str(d.processedAt),
    payoutMethod: str(d.method) || str(d.payoutMethod),
    targetDetails: str(d.details) || str(d.targetDetails),
    status: str(d.status) || 'Pending',
    utr: str(d.utr),
    adminNote: str(d.adminNote),
  };
}
