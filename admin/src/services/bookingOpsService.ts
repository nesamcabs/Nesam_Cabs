/**
 * Admin booking operations. Every one is a server function that validates the
 * booking state machine, checks the caller's permission and writes an audit
 * entry; the screens only collect input and show the result.
 */
import { callFunction, newId } from "./callables";

export interface ChannelResult {
  channel: string;
  status: string;
  error?: string;
}

/** Approval is a review decision only: it does not publish the booking or notify partners. */
export const approveBooking = (bookingId: string, note = "") =>
  callFunction<unknown, { ok: boolean; published: boolean; customerChannels: ChannelResult[] }>("approveBooking", { bookingId, note }, 120000);

/** Fulfilment route 1: publish an approved booking to Open Duties. `payout` (whole rupees) needs finance access; omit it to use the commission policy. */
export const publishToMarketplace = (bookingId: string, payout?: number, options: Record<string, unknown> = {}) =>
  callFunction<unknown, { bookingId: string; offeredPayout: number; partnersNotified: number }>("postBookingToMarketplace", { booking: bookingId, ...(payout != null ? { payout } : {}), ...options }, 120000);

/** Audited exception to the pickup GPS gate: staff mark a trip as reached with a written reason. */
export const overrideReachedPickup = (bookingId: string, reason: string) =>
  callFunction<unknown, { ok: boolean }>("overrideReachedPickup", { bookingId, reason });

/** Finance moves a partner settlement through Processing / Paid / Failed / On Hold. */
export const updateSettlement = (i: { bookingId: string; action: "processing" | "paid" | "failed" | "hold" | "release"; reference?: string; method?: "UPI" | "Bank Transfer"; reason?: string; holdOwner?: string; holdDeadline?: string }) =>
  callFunction<typeof i, { ok: boolean }>("updateSettlement", i);

/** Saves the confirmed customer / partner tariff (business_config/tariff_v2). */
export const saveTariffConfig = (i: { useConfirmedDefaults?: boolean; keepSavedRates?: boolean; enabled: boolean; reason: string; expectedVersion?: number; cityDrop?: { zones: { id: string; name: string; lat: number; lng: number; radiusKm: number }[] } }) =>
  callFunction<typeof i, { version: number; enabled: boolean }>("saveTariffConfig", i);

/** Saves one section of the tariff (base rates, a city's local fare, a rental minimum or a rental package) against the version the editor loaded. */
export const saveTariffSection = (i: { section: "baseRates" | "localPickupDrop" | "rentalMinimum" | "rentalPackage" | "extraCharges" | "brandOverride" | "fareGst" | "displayMarkup"; expectedVersion: number; reason: string; class?: string; cityId?: string; hours?: number; minHours?: number; brand?: string; service?: string; clearOverride?: boolean; data?: unknown }) =>
  callFunction<typeof i, { version: number; extraChargesVersion?: number }>("saveTariffSection", i);

export interface ExtraUsageInput {
  stops: { stopId: string; waitedMinutes: number }[] | null; hill: boolean | null; carrier: boolean | null;
}
/** Records what happened on a trip (per stop; null = not recorded). No amount is sent: the server prices it on approval. */
export const recordExtraUsage = (i: { bookingId: string; expectedRevision: number; usage: ExtraUsageInput; note?: string }) =>
  callFunction<typeof i, { revision: number }>("recordExtraUsage", i);
/** Finance approves or rejects one specific revision; approval posts the server-computed customer charge and partner credit. */
export const reviewExtraUsage = (i: { bookingId: string; revision: number; decision: "approve" | "reject"; note?: string }) =>
  callFunction<typeof i, { status: "approved" | "rejected"; revision: number; customerTotalPaise?: number }>("reviewExtraUsage", i);

export interface FixedRouteFareData {
  brand?: string; fareService?: string;
  originLocationId: string; destinationLocationId: string; vehicleCategoryId: string; serviceId: string;
  customerFare: number; partnerPayout: number; gstMode: "included" | "excluded"; peakAdjustment: "apply" | "exclude"; reverseDirection: boolean;
  status: "Active" | "Inactive"; priority: number; effectiveFrom: string; effectiveUntil: string;
}
/** Creates (no ruleId), edits (ruleId + the version the editor loaded) or enables / disables a fixed route fare. */
export const saveFixedRouteFare = (i: { ruleId?: string; expectedVersion?: number; reason: string; action?: "status"; status?: "Active" | "Inactive"; data?: FixedRouteFareData }) =>
  callFunction<typeof i, { id: string; version: number }>("saveFixedRouteFare", i);

/** Fulfilment route 2: reserve an approved booking to a Vendor, which then assigns its own driver and vehicle. */
export const assignVendor = (i: { bookingId: string; vendorId: string; payout?: number; reason?: string }) =>
  callFunction<typeof i, { ok: boolean; vendorName: string; payout: number }>("assignVendor", i);

export const rejectBooking = (bookingId: string, reason: string) => callFunction<unknown, { ok: boolean }>("rejectBooking", { bookingId, reason });

export interface CancelInput {
  bookingId: string;
  reason: string;
  cancellationCharge?: number;
  refundEligible?: boolean;
  refundAmount?: number;
  refundMethod?: string;
}
export const cancelBooking = (i: CancelInput) => callFunction<CancelInput, { ok: boolean; refundAmount: number; amountPaid: number }>("cancelBooking", i);

export interface RefundUpdate {
  bookingId: string;
  status: "Processing" | "Completed" | "Failed" | "Rejected";
  method?: string;
  reference?: string;
  note?: string;
  amount?: number;
}
export const updateRefund = (i: RefundUpdate) => callFunction<RefundUpdate, { ok: boolean }>("updateRefund", i);

export interface AssignInput {
  bookingId: string;
  /** Empty / omitted removes the current assignment. */
  driverId?: string;
  vehicleId?: string;
  reason: string;
  force?: boolean;
}
export const assignDriver = (i: AssignInput) => callFunction<AssignInput, { ok: boolean; action: "assign" | "reassign" | "remove" }>("assignDriver", i);

export const acknowledgeUnassignedAlert = (bookingId: string) => callFunction<unknown, { ok: boolean }>("acknowledgeUnassignedAlert", { bookingId });

export type PaymentMethodName = "Cash" | "UPI" | "Bank Transfer";
export type CollectorType = "admin" | "driver" | "vendor" | "staff" | "system";

export interface PaymentInput {
  bookingId: string;
  amount: number;
  method: string;
  kind?: "advance" | "partial" | "final";
  collectorType: CollectorType;
  reference?: string;
  notes?: string;
  paymentDate?: string;
  /** Idempotency key: a retried request never records the payment twice. */
  requestId?: string;
}
export const recordPayment = (i: PaymentInput) =>
  callFunction<PaymentInput, { id: string; duplicate: boolean }>("recordPayment", { ...i, requestId: i.requestId ?? newId("pay") });

export const voidPayment = (bookingId: string, paymentId: string, reason: string) =>
  callFunction<unknown, unknown>("voidPayment", { bookingId, paymentId, reason });

export interface FareAdjustmentInput {
  enabled: boolean;
  name: string;
  direction: "increase" | "decrease";
  percent: number;
  startDate: string;
  endDate: string;
  reason: string;
  expectedVersion?: number;
}
export const saveFareAdjustment = (i: FareAdjustmentInput) => callFunction<FareAdjustmentInput, { version: number }>("saveFareAdjustment", i);

export interface IssuePenaltyInput {
  party: "Driver" | "Vendor";
  partyId: string;
  category: string;
  reason: string;
  description: string;
  amount: number;
  customerCompensation?: number;
  bookingId?: string;
  incidentDate: string;
  requestId?: string;
}
export const issuePenalty = (i: IssuePenaltyInput) =>
  callFunction<IssuePenaltyInput, { id: string; duplicate: boolean }>("issuePenalty", { ...i, requestId: i.requestId ?? newId("pen") });

export const transitionPenalty = (penaltyId: string, status: "Pending" | "Paid" | "Deducted" | "Waived", note = "", reference = "") =>
  callFunction<unknown, { status: string }>("transitionPenalty", { penaltyId, status, note, reference });

export const sendVerificationCode = (bookingId: string, channels: ("whatsapp" | "sms" | "email")[]) =>
  callFunction<unknown, { sent: ChannelResult[]; expiresInMinutes: number }>("sendVerificationCode", { bookingId, channels });

export const verifyCustomerCode = (bookingId: string, code: string) => callFunction<unknown, { verified: boolean }>("verifyCustomerCode", { bookingId, code });

export interface LegalPublishInput {
  type: string;
  role: string;
  title: string;
  body: string;
  checkboxText: string;
  requiresAcceptance: boolean;
  changeSummary: string;
  expectedVersion: number;
  expectedRevision: number;
  expectedStatus: 'Missing' | 'Draft' | 'Published';
  reviewed: boolean;
}
export const publishLegalDocument = (i: LegalPublishInput) => callFunction<LegalPublishInput, { key: string; version: number }>("publishLegalDocument", i);
export const saveLegalDraft = (i: Omit<LegalPublishInput, 'reviewed'>) => callFunction<unknown, { key: string; draftRevision: number }>('saveLegalDraft', i);
export const seedLegalDocuments = () => callFunction<unknown, { created: number; total: number }>("seedLegalDocuments", {});

export interface RequiredLegalDoc { key: string; title: string; version: number; type: string; checkboxText: string }
export const getLegalStatus = (role: string) => callFunction<unknown, { missing: RequiredLegalDoc[]; required: RequiredLegalDoc[] }>("getLegalStatus", { role });
export const acceptLegalDocuments = (role: string, docs: RequiredLegalDoc[], checkboxText: string) =>
  callFunction<unknown, { accepted: number }>("acceptLegalDocuments", {
    role, confirmed: true, accept: docs.map((d) => ({ key: d.key, version: d.version })), checkboxText, source: "admin_web",
    device: { platform: "web", appVersion: "admin" },
  });
