// Development-only sample data for the interface preview harness (preview.html). It is not part of the production
// build: vite builds index.html only, and nothing under src/ imports this file.
import type { DriverAccount, DriverNotification, DriverPenalty, DriverWallet, LedgerEntry, MarketplaceOffer, PayoutRequest, TripDetails } from '../types';

const HOUR = 3600000;
export const NOW = Date.now();
const at = (hours: number) => new Date(NOW + hours * HOUR);

export const account: DriverAccount = {
  driver: {
    id: 'preview', name: 'Sample Driver', phone: '9876500000', email: 'driver@example.com', photoUrl: '', dob: '1988-04-12', gender: 'Male',
    address: '12 Sample Street', city: 'Chennai', pincode: '600001', emergencyContactName: 'Sample Contact', emergencyContact: '9876500001',
    rating: 4.8, joiningDate: 'Jan 2026', assignedVehicleId: 'v1', assignedVehicleNumber: 'TN00AB0000', approvalStatus: 'Approved',
    docStatus: 'Approved', presenceStatus: 'Online',
  },
  profile: { name: 'Sample Driver', phone: '9876500000', email: 'driver@example.com', photoUrl: '', dob: '1988-04-12', gender: 'Male', address: '12 Sample Street', city: 'Chennai', pincode: '600001', emergencyContactName: 'Sample Contact', emergencyContact: '9876500001' },
  identity: { aadhaarNumber: '123412341234', aadhaarFrontUrl: 'x', aadhaarBackUrl: '', panNumber: 'ABCDE1234F', panPhotoUrl: 'x' },
  license: { number: 'TN0020260000001', expiryDate: '2031-04-12', frontPhotoUrl: 'x', backPhotoUrl: 'x' },
  vehicle: {
    vehicleNumber: 'TN00AB0000', vehicleType: 'Sedan', make: 'Hyundai', model: 'Aura', year: '2023', color: 'White', capacity: 4, fuelType: 'Petrol', rcNumber: 'TN00AB0000',
    rcDocUrl: 'x', insuranceNumber: 'INS1', insuranceExpiry: new Date(NOW + 20 * 86400000).toISOString().slice(0, 10), insuranceDocUrl: 'x', fitnessExpiry: '2030-01-01', fitnessDocUrl: 'x',
    statePermitNumber: 'P1', permitExpiry: '2030-01-01', statePermitDocUrl: 'x', frontPhotoUrl: 'x', rearPhotoUrl: 'x', sidePhotoUrl: '', interiorPhotoUrl: 'x',
  },
  bank: { accountHolder: 'Sample Driver', accountNumber: '123456789012', ifsc: 'HDFC0000001', bankName: 'Sample Bank', upiId: 'sample@upi' },
};

const base: TripDetails = {
  id: 't1', bookingId: 'NT-1001', customerName: 'Sample Customer', customerPhone: '', customerPhoneMasked: '98•••••210',
  pickup: { address: 'Koyambedu Bus Terminus, Chennai, Tamil Nadu' }, drop: { address: 'Madurai Periyar Bus Stand, Madurai, Tamil Nadu' },
  distanceKm: 462, vehicleType: 'Sedan', serviceType: 'One way', fareAmount: 6200, driverEarnings: 4900, payoutFinalized: false, fleetTrip: false,
  tollCharges: 0, tollsApproved: false, status: 'Assigned', stage: 'Assigned', scheduledDate: '', scheduledTime: '', paymentMode: 'Cash',
  tolls: [], subStatus: 'Not Started', pickupAt: at(20), verificationSubmitted: false, boardingVerified: false, legacyFlow: false,
  fareBreakup: [
    { key: 'base', label: 'Base fare', amount: 5400, treatment: 'included', detail: '462 km at the booked rate' },
    { key: 'toll', label: 'Toll & parking', amount: null, treatment: 'extra', detail: 'Paid by the customer at actual cost' },
  ],
  paymentSummary: { amountDue: 6200, totalPaid: 1000, balanceDue: 5200, partnerCashHeld: 0, status: 'Partly paid' },
  tripStartedAt: null, reachedPickupAt: null, tripEndedAt: null, acceptedAt: null, cancellationRequest: null, driverResponse: null,
};
const t = (over: Partial<TripDetails>): TripDetails => ({ ...base, ...over });

export const trips = {
  confirmed: t({}),
  soon: t({ id: 't2', bookingId: 'NT-1002', pickupAt: at(1.5) }),
  photos: t({ verificationSubmitted: true, pickupAt: at(1) }),
  photosEarly: t({ verificationSubmitted: true, pickupAt: at(20) }),
  otp: t({ verificationSubmitted: true, subStatus: 'Reached Pickup', reachedPickupAt: at(-0.2), pickupAt: at(-0.3) }),
  ready: t({ verificationSubmitted: true, boardingVerified: true, subStatus: 'Reached Pickup', reachedPickupAt: at(-0.4), pickupAt: at(-0.5) }),
  started: t({ verificationSubmitted: true, boardingVerified: true, subStatus: 'Trip Started', status: 'Ongoing', tripStartedAt: at(-2), pickupAt: at(-2.5) }),
  completed: t({ id: 't3', bookingId: 'NT-0990', status: 'Completed', subStatus: 'Trip Ended', verificationSubmitted: true, boardingVerified: true, completedAt: at(-30), pickupAt: at(-40), tripEndedAt: at(-30), paymentSummary: { amountDue: 6200, totalPaid: 6200, balanceDue: 0, partnerCashHeld: 0, status: 'Paid' } }),
  completed2: t({ id: 't5', bookingId: 'NT-0981', status: 'Completed', subStatus: 'Trip Ended', completedAt: at(-80), pickupAt: at(-90), pickup: { address: 'Salem Old Bus Stand, Salem' }, drop: { address: 'Coimbatore Gandhipuram, Coimbatore' }, driverEarnings: 2100 }),
  cancelled: t({ id: 't4', bookingId: 'NT-0975', status: 'Cancelled', pickupAt: at(-50) }),
  fleet: t({ fleetTrip: true, driverEarnings: null }),
};

export const offers: MarketplaceOffer[] = [
  { id: 'o1', bookingId: 'NT-1101', pickup: { address: 'Theni Bus Stand, Theni, Tamil Nadu' }, drop: { address: 'Chennai Airport, Chennai, Tamil Nadu' }, pickupTime: '', travelDate: '', pickupAt: at(26), vehicleCategory: 'Sedan', distanceKm: 540, offeredPayout: 5600 },
  { id: 'o2', bookingId: 'NT-1102', pickup: { address: 'Madurai Junction, Madurai, Tamil Nadu' }, drop: { address: 'Rameswaram, Tamil Nadu' }, pickupTime: '', travelDate: '', pickupAt: at(50), vehicleCategory: 'Sedan', distanceKm: 175, offeredPayout: 2400 },
  { id: 'o4', bookingId: 'NT-1104', pickup: { address: 'Salem Old Bus Stand, Salem, Tamil Nadu' }, drop: { address: 'Coimbatore Gandhipuram, Coimbatore' }, pickupTime: '', travelDate: '', pickupAt: at(30), vehicleCategory: 'Sedan', distanceKm: 165, offeredPayout: 2100, mode: 'bid_review' },
  { id: 'o3', bookingId: 'NT-1103', pickup: { address: 'Trichy Central, Tiruchirappalli' }, drop: { address: 'Bengaluru Majestic, Bengaluru' }, pickupTime: '', travelDate: '', pickupAt: at(52), vehicleCategory: 'Premium SUV', distanceKm: 330, offeredPayout: null },
];

export const wallet: DriverWallet = { available: 8450, pending: 4900, reserved: 2000, paidOut: 15000, cashCollected: 3000, tripEarnings: 31000, tollReimbursements: 600 };

const entry = (id: string, type: string, direction: 'credit' | 'debit', amount: number, status: string, code: string, h: number): LedgerEntry => ({
  id, type, direction, amount, status, bookingId: id === 'l1' || id === 'l2' ? 't3' : id === 'l3' ? 't5' : id, bookingCode: code, createdAt: at(h),
});
export const ledger: LedgerEntry[] = [
  entry('l1', 'trip_earning', 'credit', 4900, 'available', 'NT-0990', -3),
  entry('l2', 'toll_reimbursement', 'credit', 420, 'available', 'NT-0990', -3),
  entry('l3', 'trip_earning', 'credit', 3250, 'available', 'NT-0981', -26),
  entry('l4', 'trip_earning', 'credit', 2100, 'pending', 'NT-0972', -50),
  entry('l5', 'payout', 'debit', 5000, 'completed', '', -120),
  entry('l6', 'cash_collected', 'debit', 1500, 'completed', 'NT-0965', -150),
];

export const payouts: PayoutRequest[] = [
  { id: 'p1', amount: 2000, requestedAt: '17 Oct 2026', method: 'UPI', details: 'sample@upi', status: 'Pending' },
  { id: 'p2', amount: 5000, requestedAt: '08 Oct 2026', method: 'Bank Transfer', details: 'HDFC ••••9012', status: 'Paid' },
];

const note = (id: string, category: DriverNotification['category'], title: string, message: string, read: boolean, time: string): DriverNotification => ({
  id, title, message, time, read, createdAtMs: NOW, category, severity: 'info', sound: 'general', bookingId: '', bookingCode: 'NT-1001', ctaLabel: 'Open', ctaPage: 'notifications', popup: false,
});
export const notifications: DriverNotification[] = [
  note('n1', 'bookings', 'New duty available', 'Theni → Chennai Airport · Sedan · pickup tomorrow 06:00 AM', false, '2 min ago'),
  { ...note('n2', 'trips', 'Trip reminder', 'Your pickup at Koyambedu is in 3 hours.', false, '1 hour ago'), severity: 'warning' },
  note('n3', 'payments', 'Payout processed', '₹5,000 was paid to your bank account.', true, 'Yesterday'),
  note('n4', 'approvals', 'Documents approved', 'Your vehicle insurance was verified.', true, '3 days ago'),
];

export const penalties: DriverPenalty[] = [
  { id: 'pen1', amount: 300, category: 'Late arrival', reason: 'Arrived 25 minutes after the scheduled pickup.', description: 'Customer reported the delay.', bookingCode: 'NT-0975', bookingId: 't4', incidentDate: '2026-10-12', status: 'Pending', acknowledged: false, acknowledgedAt: null, disputeNote: '', issuedAt: at(-60), issuedByName: 'NESAM Control' },
  { id: 'pen2', amount: 150, category: 'Dress code', reason: 'Uniform not worn.', description: '', bookingCode: 'NT-0940', bookingId: 't9', incidentDate: '2026-09-30', status: 'Waived', acknowledged: true, acknowledgedAt: at(-400), disputeNote: '', issuedAt: at(-420), issuedByName: 'NESAM Control' },
];
