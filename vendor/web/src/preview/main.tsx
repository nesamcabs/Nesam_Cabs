// Development-only harness: the real Partner workspace with sample data, so every screen can be checked against the
// client reference without signing in. Open /preview.html. Not part of the production build (vite builds index.html only).
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import '../styles/fonts.css';
import '../styles/vx.css';
import '../styles/vendor_theme.css';
import '../styles/partner.css';
import { PartnerContextForPreview, type PartnerValue } from '../state/Partner';
import { PartnerWorkspace } from '../partner/Workspace';
import { mapOperations } from '../services/vendorMappers';
import type { FleetDriver, FleetVehicle, OpenTrip, VendorTrip } from '../types';

const H = 3600000;
const now = Date.now();
const at = (hours: number) => new Date(now + hours * H);
const noop = async () => undefined;

const open = (id: string, from: string, to: string, hours: number, km: number, payout: number, tripType: string, cat: string, mode: OpenTrip['mode'] = ''): OpenTrip => ({
  id, bookingId: id, route: `${from} → ${to}`, pickup: { address: from, city: from, time: '' }, drop: { address: to, city: to }, travelDate: '', vehicleCategory: cat,
  distanceKm: km, offeredPayout: payout, status: 'Open', mode, tripType, pickupAt: at(hours), cutoffAt: at(hours - 12), terms: null,
});

const trip = (id: string, from: string, to: string, hours: number, km: number, payout: number, extra: Partial<VendorTrip>): VendorTrip => ({
  id, bookingId: id, customerName: 'Arun Kumar', customerPhone: '+91 98•••••210', customerPhoneMasked: '+91 98•••••210', pickupAddress: from, dropAddress: to,
  scheduledTime: '', vehicleId: '', vehicleNumber: '', driverId: '', driverName: '', driverPhone: '', grossFare: payout * 1.2, vendorPayout: payout, status: 'Confirmed',
  tripStage: '', tripSubStatus: 'Not Started', verificationSubmitted: false, verificationRisk: '', paymentStatus: '', totalPaid: null, balanceDue: null, fareLines: [],
  pickupAt: at(hours), pickupLabel: from, dropLabel: to, tripType: 'One Way', vehicleCategory: 'SUV', includedKm: km, acceptedAt: at(-1), assignBy: at(1),
  driverResponse: null, cancellationRequest: null, completedAt: null, ...extra,
});

const vehicle = (id: string, number: string, make: string, model: string, cat: string, seats: number | null, expiry: string, extra: Partial<FleetVehicle> = {}): FleetVehicle => ({
  id, vehicleNumber: number, category: cat, categoryId: cat.toLowerCase(), make, model, year: '2023', seatingCapacity: seats, status: 'Active', assignedDriverId: '', assignedDriverName: '',
  docStatus: 'Approved', rejectionReason: '', expiries: { rc: expiry, insurance: expiry, fitness: expiry, permit: expiry, puc: '' }, availableFrom: null, availabilityLocation: '',
  vehicleClass: '', code: '', ...extra,
});

const driver = (id: string, name: string, phone: string, expiry: string, extra: Partial<FleetDriver> = {}): FleetDriver => ({
  id, name, phone, email: '', photoUrl: '', licenseNumber: `TN01202000${id.slice(-5)}`, licenseExpiry: expiry, accountStatus: 'Approved', suspended: false, online: true,
  assignedVehicleId: '', assignedVehicleNumber: '', rating: 4.7, code: '', docStatus: 'Approved', rejectionReason: '', ...extra,
});

const vehicles = [
  vehicle('car000089', 'TN60CD5678', 'Maruti Suzuki', 'Ertiga', 'SUV', 6, '2027-10-30'),
  vehicle('car000095', 'TN60PQ3456', 'Maruti Suzuki', 'Dzire', 'Sedan', null, '2027-10-30'),
  vehicle('car000097', 'TN60UV1234', 'Kia', 'Carens', 'SUV', 6, '2026-10-21'),
  vehicle('car000098', 'TN60WX5678', 'Toyota', 'Innova', 'Innova', 7, '2027-10-30'),
];
const drivers = [
  driver('drv000241', 'Javid', '9876543240', '2027-10-30'),
  driver('drv000245', 'Dinesh Kumar', '9000000245', '2027-10-30'),
  driver('drv000247', 'Karthik', '9000000247', '2026-10-21'),
  driver('drv000249', 'Suresh', '9000000249', '2027-10-30', { suspended: true }),
];

const value: PartnerValue = {
  profile: { id: 'vendor000042', companyName: 'Raja Travels', contactPerson: 'Raja S', phone: '9876543220', email: 'raja@example.com', gstin: '', panNumber: '', address: '', city: 'Theni', totalFleetSize: 5, totalDriversCount: 7, verificationStatus: 'Approved', joinedDate: '', bankAccountName: 'Raja Travels', bankAccountNumber: '', ifscCode: 'HDFC0000001', upiId: '' },
  record: { uid: 'vendor000042', phone: '+919876543220', status: 'APPROVED', onboardingStep: 4, business: null, documents: null, fleet: null, payoutSummary: { accountHolderName: 'Raja Travels', bankLast4: '2048', ifsc: 'HDFC0000001', upiId: '' }, review: null, submittedAt: null },
  vehicles, drivers, categories: [{ id: 'sedan', name: 'Sedan', seatingCapacity: 4 }, { id: 'suv', name: 'SUV', seatingCapacity: 6 }],
  openTrips: [
    open('NSM-261023-0060', 'Chennai, Porur', 'Trichy, Central Bus Stand', 20, 330, 4200, 'One Way', 'Sedan', 'accept_offer'),
    open('NSM-261023-0048', 'Theni', 'Trichy Airport', 22, 200, 3000, 'One Way', 'SUV', 'accept_offer'),
    open('NSM-261024-0064', 'Chennai', 'Coimbatore → Chennai', 44, 1020, 11000, 'Round Trip', 'Innova', 'bid_review'),
    open('NSM-261024-0069', 'Chennai, T Nagar', '8 hours · 80 km', 44, 80, 2400, 'Local Rental', 'SUV'),
  ],
  bids: [{ id: 'vendor_vendor000042', tripId: 'NSM-261024-0064', bookingId: 'NSM-261024-0064', offeredPayout: 11000, vendorCounterRate: 12500, biddingNote: '', submittedAt: at(-2), status: 'Pending Review', autoAcceptConsent: false }],
  trips: [
    trip('NSM-261023-0057', 'Chennai, Adyar', 'Puducherry', 30, 170, 2600, {}),
    trip('NSM-261024-0058', 'Theni', 'Madurai', 54, 180, 2800, { status: 'Assigned', driverId: 'drv000241', driverName: 'Javid', vehicleId: 'car000089', vehicleNumber: 'TN60CD5678', driverResponse: { viewedAt: at(-1), acknowledgedAt: null } }),
    trip('NSM-261022-0042', 'Chennai, Porur', 'Trichy', -2, 330, 4100, { status: 'Ongoing', tripSubStatus: 'Trip Started', driverId: 'drv000245', driverName: 'Dinesh Kumar', vehicleId: 'car000095', vehicleNumber: 'TN60PQ3456', vehicleCategory: 'Sedan' }),
    trip('NSM-261021-0039', 'Chennai', 'Madurai', -30, 470, 4800, { status: 'Completed', tripSubStatus: 'Trip Ended', driverId: 'drv000245', driverName: 'Dinesh Kumar', vehicleId: 'car000095', vehicleNumber: 'TN60PQ3456', vehicleCategory: 'Sedan', paymentStatus: 'Paid', totalPaid: 6000, balanceDue: 0 }),
  ],
  wallet: { available: 5600, pending: 0, reserved: 0, paidOut: 0, cashCollected: 1200, tripEarnings: 4800, tollReimbursements: 0, updatedAt: at(0) },
  payouts: [],
  ledger: [
    { id: 'penalty_NSM-PN-00012', type: 'penalty_deduction', direction: 'debit', amount: 500, status: 'completed', bookingCode: 'NSM-261021-0039', payoutRequestId: '', createdAt: at(-6), penaltyId: 'NSM-PN-00012', reference: '' },
    { id: 'trip_NSM-261021-0039', type: 'trip_earning', direction: 'credit', amount: 3600, status: 'available', bookingCode: 'NSM-261021-0039', payoutRequestId: '', createdAt: at(-7), penaltyId: '', reference: '' },
    { id: 'recharge_pay_1', type: 'wallet_recharge', direction: 'credit', amount: 2500, status: 'available', bookingCode: '', payoutRequestId: '', createdAt: at(-30), penaltyId: '', reference: 'pay_1' },
  ],
  notifications: [{ id: 'n1', title: 'Wallet updated for NSM-261021-0039', message: '', time: '', read: false, createdAtMs: now - 6 * H, category: 'payments', severity: 'info', sound: 'general', bookingId: 'NSM-261021-0039', bookingCode: 'NSM-261021-0039', ctaLabel: 'Open booking', ctaPage: 'booking-detail', popup: false }],
  penalties: [{ id: 'NSM-PN-00012', amount: 500, category: 'Late Arrival', reason: 'Late pickup reported for this duty.', description: 'Arrival record checked by the office. Please acknowledge this notice.', bookingCode: 'NSM-261021-0039', bookingId: 'NSM-261021-0039', incidentDate: new Date(now - 30 * H).toISOString().slice(0, 10), status: 'Pending', acknowledged: false, acknowledgedAt: null, disputeNote: '', issuedAt: at(-20), issuedByName: 'Office' }],
  penaltiesError: '', links: [], invites: [], requests: [], deposit: { amount: 1000, status: 'Active', reference: '' },
  dues: [{ id: 'NSM-261021-0039', bookingCode: 'NSM-261021-0039', amount: 3600, entitlement: 4800, collectedByPartner: 1200, status: 'Wallet', dueAt: at(-2), completedAt: at(-20) }],
  ops: mapOperations(undefined), loadError: '', retry: () => undefined, unread: 1, openLinks: [], page: 'duties', go: () => undefined, intent: '', clearIntent: () => undefined,
  actions: { addVehicle: noop, setVehicleStatus: noop, pairDriver: noop, inviteDriver: noop, setSuspended: noop, acceptOffer: noop, submitBid: noop, withdrawBid: noop, assign: noop, requestPayout: noop, markRead: () => undefined },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <PartnerContextForPreview.Provider value={value}>
    <PartnerWorkspace />
  </PartnerContextForPreview.Provider>,
);
