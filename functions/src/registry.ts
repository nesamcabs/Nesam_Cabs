// The server functions a client may call by name through the HTTP API (api/call/[name]).
//
// This is an explicit allow-list: Firestore triggers, the scheduler and webhooks are
// exported from index.ts too, but must never be reachable as client-callable endpoints.
import * as fns from './index';
import { createRazorpayOrder, verifyRazorpayPayment } from './payments';
import { reconcile } from './reconcile';

export interface CallableLike {
  run(request: {
    data: unknown;
    auth?: { uid: string; token: Record<string, unknown> };
    rawRequest?: unknown;
    acceptsStreaming?: boolean;
  }): unknown;
}

export const CALLABLES: Readonly<Record<string, CallableLike>> = Object.freeze({
  // bookings
  createBooking: fns.createBooking,
  refreshPublicContent: fns.refreshPublicContent,
  createAdminBooking: fns.createAdminBooking,
  overrideBookingFare: fns.overrideBookingFare,
  approveBooking: fns.approveBooking,
  rejectBooking: fns.rejectBooking,
  cancelBooking: fns.cancelBooking,
  updateRefund: fns.updateRefund,
  assignDriver: fns.assignDriver,
  acknowledgeUnassignedAlert: fns.acknowledgeUnassignedAlert,
  migrateMarketplaceVisibility: fns.migrateMarketplaceVisibility,
  backfillFulfilmentRoute: fns.backfillFulfilmentRoute,
  // money
  recordPayment: fns.recordPayment,
  voidPayment: fns.voidPayment,
  saveFareAdjustment: fns.saveFareAdjustment,
  savePlatformFee: fns.savePlatformFee,
  saveNightAllowance: fns.saveNightAllowance,
  saveTariffConfig: fns.saveTariffConfig,
  saveTariffSection: fns.saveTariffSection,
  saveFixedRouteFare: fns.saveFixedRouteFare,
  saveServiceRule: fns.saveServiceRule,
  setServiceRuleStatus: fns.setServiceRuleStatus,
  quoteBooking: fns.quoteBooking,
  requestPartnerPayout: fns.requestPartnerPayout,
  rebuildPartnerLedger: fns.rebuildPartnerLedger,
  updateSettlement: fns.updateSettlement,
  createRazorpayOrder,
  verifyRazorpayPayment,
  reconcile,
  // trips
  getCustomerContact: fns.getCustomerContact,
  updateBookingContact: fns.updateBookingContact,
  migrateBookingContacts: fns.migrateBookingContacts,
  advanceTrip: fns.advanceTrip,
  overrideReachedPickup: fns.overrideReachedPickup,
  verifyBoarding: fns.verifyBoarding,
  createCaptureSession: fns.createCaptureSession,
  getSlotChallenge: fns.getSlotChallenge,
  submitCapturePhoto: fns.submitCapturePhoto,
  finalizeVehicleVerification: fns.finalizeVehicleVerification,
  // marketplace
  awardMarketplaceBid: fns.awardMarketplaceBid,
  rejectMarketplaceBid: fns.rejectMarketplaceBid,
  postBookingToMarketplace: fns.postBookingToMarketplace,
  assignIndependentDriver: fns.assignIndependentDriver,
  assignVendor: fns.assignVendor,
  vendorAssignDriver: fns.vendorAssignDriver,
  findPartnerDriver: fns.findPartnerDriver,
  findPartnerVehicle: fns.findPartnerVehicle,
  requestDriverLink: fns.requestDriverLink,
  requestVehicleLink: fns.requestVehicleLink,
  adminCreatePartnerLink: fns.adminCreatePartnerLink,
  verifyPartnerLinkOtp: fns.verifyPartnerLinkOtp,
  resendPartnerLinkOtp: fns.resendPartnerLinkOtp,
  requestPartnerLinkHelp: fns.requestPartnerLinkHelp,
  cancelPartnerLink: fns.cancelPartnerLink,
  decidePartnerLink: fns.decidePartnerLink,
  claimMarketplaceDuty: fns.claimMarketplaceDuty,
  submitMarketplaceBid: fns.submitMarketplaceBid,
  withdrawMarketplaceBid: fns.withdrawMarketplaceBid,
  // penalties
  issuePenalty: fns.issuePenalty,
  transitionPenalty: fns.transitionPenalty,
  acknowledgePenalty: fns.acknowledgePenalty,
  disputePenalty: fns.disputePenalty,
  // partner requests & partner operations
  requestDutyCancellation: fns.requestDutyCancellation,
  submitPartnerRequest: fns.submitPartnerRequest,
  decidePartnerRequest: fns.decidePartnerRequest,
  acknowledgeAssignment: fns.acknowledgeAssignment,
  setVehicleAvailability: fns.setVehicleAvailability,
  createWalletRecharge: fns.createWalletRecharge,
  verifyWalletRecharge: fns.verifyWalletRecharge,
  getDuesSummary: fns.getDuesSummary,
  recordExtraUsage: fns.recordExtraUsage,
  reviewExtraUsage: fns.reviewExtraUsage,
  createDuesPayment: fns.createDuesPayment,
  verifyDuesPayment: fns.verifyDuesPayment,
  setSecurityDeposit: fns.setSecurityDeposit,
  requestDepositRefund: fns.requestDepositRefund,
  // identity, legal, security
  reportSecurityEvent: fns.reportSecurityEvent,
  getIntegrityNonce: fns.getIntegrityNonce,
  verifyDeviceIntegrity: fns.verifyDeviceIntegrity,
  sendVerificationCode: fns.sendVerificationCode,
  verifyCustomerCode: fns.verifyCustomerCode,
  getLegalStatus: fns.getLegalStatus,
  acceptLegalDocuments: fns.acceptLegalDocuments,
  publishLegalDocument: fns.publishLegalDocument,
  saveLegalDraft: fns.saveLegalDraft,
  seedLegalDocuments: fns.seedLegalDocuments,
  // staff & partners
  approveAdminRequest: fns.approveAdminRequest,
  rejectAdminRequest: fns.rejectAdminRequest,
  updateAdminAccess: fns.updateAdminAccess,
  saveStaffRole: fns.saveStaffRole,
  deleteStaffRole: fns.deleteStaffRole,
  migrateLegacyAdmins: fns.migrateLegacyAdmins,
  saveStaffProfile: fns.saveStaffProfile,
  resetStaffPassword: fns.resetStaffPassword,
  setStaffStatus: fns.setStaffStatus,
  getStaffBookings: fns.getStaffBookings,
  revokeStaffSessions: fns.revokeStaffSessions,
  requestVendorRegistration: fns.requestVendorRegistration,
  issueVendorInvitation: fns.issueVendorInvitation,
  revokeVendorInvitation: fns.revokeVendorInvitation,
  redeemVendorInvitation: fns.redeemVendorInvitation,
  lookupVehicleByRegistration: fns.lookupVehicleByRegistration,
  // notifications
  sendNotification: fns.sendNotification,
  sendNoticeCampaign: fns.sendNoticeCampaign,
  retryFailedDeliveries: fns.retryFailedDeliveries,
  // enquiries & multicity quotes
  submitMulticityEnquiry: fns.submitMulticityEnquiry,
  acceptEnquiryQuote: fns.acceptEnquiryQuote,
  getCustomerEnquiries: fns.getCustomerEnquiries,
  priceMulticityEnquiry: fns.priceMulticityEnquiry,
  convertMulticityEnquiry: fns.convertMulticityEnquiry,
  // support & AI chatbot
  submitSupportRequest: fns.submitSupportRequest,
  updateSupportRequest: fns.updateSupportRequest,
  requestAccountDeletion: fns.requestAccountDeletion,
  chatWithBot: fns.chatWithBot,
  searchGooglePlaces: fns.searchGooglePlaces,
  reverseGoogleGeocode: fns.reverseGoogleGeocode,
  getGoogleRoute: fns.getGoogleRoute,
  // local taxi
  ltSaveZone: fns.ltSaveZone, ltSetZoneStatus: fns.ltSetZoneStatus, ltSaveFare: fns.ltSaveFare, ltActivateFare: fns.ltActivateFare, ltSimulateFare: fns.ltSimulateFare,
  ltSetDriverEligibility: fns.ltSetDriverEligibility, ltCheckServiceability: fns.ltCheckServiceability, ltGetQuotes: fns.ltGetQuotes, ltCreateRide: fns.ltCreateRide,
  ltCancellationQuote: fns.ltCancellationQuote, ltCancelRide: fns.ltCancelRide, ltAdminCancelRide: fns.ltAdminCancelRide, ltAssignRide: fns.ltAssignRide,
  ltGetRide: fns.ltGetRide, ltRateRide: fns.ltRateRide, ltSetAvailability: fns.ltSetAvailability, ltUpdateLocation: fns.ltUpdateLocation, ltRespondOffer: fns.ltRespondOffer,
  ltDriverAdvance: fns.ltDriverAdvance, ltCreatePaymentOrder: fns.ltCreatePaymentOrder, ltVerifyPayment: fns.ltVerifyPayment,
});

/** Names whose result changes a booking, so the booking is reconciled right after the call. */
export const BOOKING_ID_FIELDS = ['bookingId', 'requestId', 'tripId', 'id'] as const;

/** Callables that create / change bookings or payout requests (reconciled after success). */
export const RECONCILES_BOOKING = new Set([
  'createBooking', 'createAdminBooking', 'overrideBookingFare', 'approveBooking', 'rejectBooking', 'cancelBooking', 'updateRefund',
  'assignDriver', 'recordPayment', 'voidPayment', 'advanceTrip', 'overrideReachedPickup', 'verifyBoarding', 'awardMarketplaceBid', 'rejectMarketplaceBid', 'postBookingToMarketplace',
  'assignIndependentDriver', 'assignVendor', 'vendorAssignDriver', 'claimMarketplaceDuty', 'submitMarketplaceBid', 'withdrawMarketplaceBid', 'finalizeVehicleVerification',
  'requestDutyCancellation', 'acknowledgeAssignment', 'reviewExtraUsage',
]);
export const RECONCILES_PAYOUT = new Set(['requestPartnerPayout']);

/** Callables a signed-out visitor may use: read-only fare quotes, support requests, and AI chatbot. */
export const PUBLIC_CALLABLES: ReadonlySet<string> = new Set(['quoteBooking', 'ltCheckServiceability', 'chatWithBot', 'submitSupportRequest', 'searchGooglePlaces', 'reverseGoogleGeocode', 'getGoogleRoute']);
