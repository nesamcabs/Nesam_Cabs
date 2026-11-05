import * as service from '../src/services/vendorService';
import {
  buildDispatchRequest,
  buildNewVehicleDoc,
  canDispatch,
  defaultVehicleForDriver,
  dispatchBlocker,
  isEligibleVehicle,
  mapFleetDriver,
  mapMarketTrip,
  mapVehicle,
  mapVendorBooking,
  resolveAssignedVehicle,
  tripStageLabel,
  validateCounterRate,
  validateVendorPayout,
  VendorActionError,
} from '../src/services/vendorService';
import { buildOnboardingPath, validateUploadFile } from '../src/services/storageService';
import { daysUntil, mapLedgerEntry, mapWallet, monthEarnings, payoutText } from '../src/utils/wallet';
import {
  validateAadhaar,
  validateAccountNumber,
  validateAltPhone,
  validateFleetSize,
  validateGstin,
  validateIfsc,
  validatePan,
  validatePincode,
  validateUpi,
} from '../src/utils/validation';

const vendor = { id: 'v1', companyName: 'Sri Balaji Travels', phone: '+919800000001' };

describe('Indian validators (copied from Vendor Web)', () => {
  it('validates GSTIN, PAN and IFSC', () => {
    expect(validateGstin('33ABCDE1234F1Z5')).toBe('');
    expect(validateGstin('33ABCDE1234F1X5')).toBeTruthy();
    expect(validatePan('ABCDE1234F')).toBe('');
    expect(validatePan('ABCD1234F')).toBeTruthy();
    expect(validateIfsc('SBIN0001234')).toBe('');
    expect(validateIfsc('SBIN1001234')).toBeTruthy();
  });
  it('validates Aadhaar with Verhoeff checksum', () => {
    expect(validateAadhaar('2345 6789 0124')).toBe('');
    expect(validateAadhaar('234567890123')).toBeTruthy();
    expect(validateAadhaar('123456789012')).toBeTruthy();
  });
  it('validates UPI, account, pincode, fleet size and alternate phone', () => {
    expect(validateUpi('')).toBe('');
    expect(validateUpi('fleet@okhdfcbank')).toBe('');
    expect(validateUpi('fleet@@x')).toBeTruthy();
    expect(validateAccountNumber('000000000')).toBeTruthy();
    expect(validateAccountNumber('123456789012')).toBe('');
    expect(validatePincode('012345')).toBeTruthy();
    expect(validateFleetSize('0')).toBeTruthy();
    expect(validateFleetSize('12')).toBe('');
    expect(validateAltPhone('9800000001', '+919800000001')).toBeTruthy();
  });
});

describe('rules payloads', () => {
  it('a marketplace claim and a bid are server calls; the app has no client write that could assign a duty', () => {
    expect((service as Record<string, unknown>).buildVendorClaimUpdate).toBeUndefined();
    expect(typeof service.acceptOfferedRate).toBe('function');
    expect(typeof service.submitCounterBid).toBe('function');
    expect(typeof service.withdrawBid).toBe('function');
  });
  it('a vendor booking never carries the customer number', () => {
    const b = service.mapVendorBooking('b1', { phone: '+919876543210', phoneMasked: '+91 98••• ••210', customer: 'Priya', status: 'Confirmed' });
    expect(b.customerPhone).toBe('');
    expect(b.customerPhoneMasked).toBe('+91 98••• ••210');
  });
  it('dispatch request carries the booking, driver and stable vehicle id', () => {
    const driver = mapFleetDriver('d1', { name: 'Kumar', phone: '+91 98000 00002', status: 'Approved', vendorId: 'v1' });
    const u = buildDispatchRequest({ id: 'b1' }, driver, { id: 'veh1', vehicleNumber: 'TN 01 AB 1234' });
    expect(u).toEqual({ bookingId: 'b1', driverId: 'd1', vehicleId: 'veh1' });
  });
  it('changing vehicles changes the vehicle id sent', () => {
    const driver = mapFleetDriver('d1', { name: 'Kumar', phone: '+91 98000 00002', status: 'Approved', vendorId: 'v1' });
    const u1 = buildDispatchRequest({ id: 'b1' }, driver, { id: 'veh1', vehicleNumber: 'TN 01 AB 1234' });
    const u2 = buildDispatchRequest({ id: 'b1' }, driver, { id: 'veh2', vehicleNumber: 'TN 02 CD 5678' });
    expect(u1.vehicleId).toBe('veh1');
    expect(u2.vehicleId).toBe('veh2');
  });
  it('rejects a dispatch with a missing vehicle id or registration number', () => {
    const driver = mapFleetDriver('d1', { name: 'Kumar', status: 'Approved', vendorId: 'v1' });
    expect(() => buildDispatchRequest({ id: 'b1' }, driver, { id: '', vehicleNumber: 'TN 01 AB 1234' })).toThrow(/Vehicle ID/);
    expect(() => buildDispatchRequest({ id: 'b1' }, driver, { id: 'veh1', vehicleNumber: '' })).toThrow(/registration number/);
  });
  it('new vehicles always await NESAM review', () => {
    const d = buildNewVehicleDoc(vendor, 'veh1', {
      vehicleNumber: 'tn 01 ab 1234',
      category: 'Sedan',
      make: 'Toyota',
      model: 'Etios',
      year: '2022',
      seatingCapacity: 4,
      fuelType: 'Diesel',
      status: 'Active',
      rcNumber: 'rc1',
      rcDocUrl: 'u',
      insuranceExpiry: '2099-01-01',
      insuranceDocUrl: 'u',
      fitnessExpiry: '',
      fitnessDocUrl: '',
      permitExpiry: '2099-01-01',
      statePermitDocUrl: 'u',
    });
    expect(d).toMatchObject({ docStatus: 'Pending', vendorId: 'v1', vehicleNumber: 'TN 01 AB 1234', rcNumber: 'RC1' });
  });
});

describe('dispatch rules & vehicle resolution', () => {
  const approved = mapFleetDriver('d1', { name: 'Kumar', status: 'Approved' });
  const booking = (id: string, over: Record<string, unknown>) => mapVendorBooking(id, { bookingId: id, fare: 1000, ...over });

  const activeVehicle = mapVehicle('veh1', {
    vehicleNumber: 'TN 01 AB 1234',
    category: 'Sedan',
    status: 'Active',
    docStatus: 'Approved',
  });
  const secondVehicle = mapVehicle('veh2', {
    vehicleNumber: 'TN 02 CD 5678',
    category: 'SUV',
    status: 'Active',
    docStatus: 'Approved',
  });
  const maintenanceVehicle = mapVehicle('veh3', {
    vehicleNumber: 'TN 03 EF 9999',
    category: 'Sedan',
    status: 'Maintenance',
    docStatus: 'Approved',
  });
  const unapprovedVehicle = mapVehicle('veh4', {
    vehicleNumber: 'TN 04 GH 0001',
    category: 'Sedan',
    status: 'Active',
    docStatus: 'Pending',
  });

  const fleet = [activeVehicle, secondVehicle, maintenanceVehicle, unapprovedVehicle];

  it('only approved, active, free drivers can be dispatched', () => {
    expect(dispatchBlocker(approved, [], 'b1')).toBe('');
    expect(dispatchBlocker(mapFleetDriver('d2', { name: 'X', status: 'Pending' }), [], 'b1')).toMatch(/not approved/);
    expect(dispatchBlocker(mapFleetDriver('d3', { name: 'Y', status: 'Approved', fleetStatus: 'Suspended' }), [], 'b1')).toMatch(/suspended/);
    const busy = [booking('b2', { status: 'Ongoing', assignedDriverId: 'd1' })];
    expect(dispatchBlocker(approved, busy, 'b1')).toMatch(/already on trip/);
    expect(dispatchBlocker(approved, [booking('b1', { status: 'Assigned', assignedDriverId: 'd1' })], 'b1')).toBe('');
  });

  it('allows (re)dispatch only before the trip starts', () => {
    expect(canDispatch(booking('b', { status: 'Confirmed' }))).toBe(true);
    expect(canDispatch(booking('b', { status: 'Assigned', tripStage: 'Assigned' }))).toBe(true);
    expect(canDispatch(booking('b', { status: 'Assigned', tripStage: 'En Route Pickup' }))).toBe(false);
    expect(canDispatch(booking('b', { status: 'Ongoing' }))).toBe(false);
  });

  it('isEligibleVehicle accepts only active and approved vehicles with valid IDs', () => {
    expect(isEligibleVehicle(activeVehicle)).toBe(true);
    expect(isEligibleVehicle(secondVehicle)).toBe(true);
    expect(isEligibleVehicle(maintenanceVehicle)).toBe(false);
    expect(isEligibleVehicle(unapprovedVehicle)).toBe(false);
    expect(isEligibleVehicle({ ...activeVehicle, id: '' })).toBe(false);
    expect(isEligibleVehicle({ ...activeVehicle, vehicleNumber: '' })).toBe(false);
  });

  it('resolveAssignedVehicle preselects existing valid assignment by ID', () => {
    const resolved = resolveAssignedVehicle({ vehicleId: 'veh1', vehicleNumber: 'TN 01 AB 1234' }, fleet);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('veh1');
    expect(resolved?.vehicleNumber).toBe('TN 01 AB 1234');
  });

  it('resolveAssignedVehicle resolves legacy booking with only plate number when exactly one matches', () => {
    // Normalization handles spaces, casing, hyphens
    const resolved = resolveAssignedVehicle({ vehicleNumber: 'tn-01 ab 1234' }, fleet);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('veh1');
    expect(resolved?.vehicleNumber).toBe('TN 01 AB 1234');
  });

  it('resolveAssignedVehicle returns null for fresh booking without existing vehicle', () => {
    expect(resolveAssignedVehicle(null, fleet)).toBeNull();
    expect(resolveAssignedVehicle({}, fleet)).toBeNull();
    expect(resolveAssignedVehicle({ vehicleId: '', vehicleNumber: '' }, fleet)).toBeNull();
  });

  it('resolveAssignedVehicle rejects stale, unapproved, maintenance or mismatched vehicle ID', () => {
    // Stale ID (not in fleet)
    expect(resolveAssignedVehicle({ vehicleId: 'deleted_veh', vehicleNumber: 'TN 01 AB 1234' }, fleet)).toBeNull();
    // Maintenance vehicle ID
    expect(resolveAssignedVehicle({ vehicleId: 'veh3', vehicleNumber: 'TN 03 EF 9999' }, fleet)).toBeNull();
    // Unapproved vehicle ID
    expect(resolveAssignedVehicle({ vehicleId: 'veh4', vehicleNumber: 'TN 04 GH 0001' }, fleet)).toBeNull();
    // Mismatched vehicle ID and plate
    expect(resolveAssignedVehicle({ vehicleId: 'veh1', vehicleNumber: 'TN 99 ZZ 9999' }, fleet)).toBeNull();
  });

  it('resolveAssignedVehicle returns null if multiple eligible vehicles share the same plate (ambiguous)', () => {
    const duplicatePlateVehicle = mapVehicle('veh5', {
      vehicleNumber: 'TN 01 AB 1234',
      category: 'Sedan',
      status: 'Active',
      docStatus: 'Approved',
    });
    const ambiguousFleet = [...fleet, duplicatePlateVehicle];
    // No vehicleId, plate matches both veh1 and veh5 -> ambiguous -> requires explicit selection
    expect(resolveAssignedVehicle({ vehicleNumber: 'TN 01 AB 1234' }, ambiguousFleet)).toBeNull();
    // But with explicit vehicleId, resolves unambiguously
    expect(resolveAssignedVehicle({ vehicleId: 'veh5', vehicleNumber: 'TN 01 AB 1234' }, ambiguousFleet)?.id).toBe('veh5');
  });

  it('defaultVehicleForDriver resolves driver assigned vehicle safely', () => {
    const driverWithId = mapFleetDriver('d1', {
      assignedVehicleId: 'veh2',
      assignedVehicleNumber: 'TN 02 CD 5678',
    });
    expect(defaultVehicleForDriver(driverWithId, fleet)?.id).toBe('veh2');

    const driverWithOnlyPlate = mapFleetDriver('d2', {
      assignedVehicleNumber: 'TN 01 AB 1234',
    });
    expect(defaultVehicleForDriver(driverWithOnlyPlate, fleet)?.id).toBe('veh1');

    const driverWithNoVehicle = mapFleetDriver('d3', {});
    expect(defaultVehicleForDriver(driverWithNoVehicle, fleet)).toBeNull();
  });
});

describe('bids & payouts', () => {
  it('validates counter rates', () => {
    expect(validateCounterRate(0, 1000)).toBeTruthy();
    expect(validateCounterRate(1000, 1000)).toMatch(/offered rate/);
    expect(validateCounterRate(5000, 1000)).toMatch(/too high/);
    expect(validateCounterRate(1100.5, 1000)).toMatch(/whole/);
    expect(validateCounterRate(1200, 1000)).toBe('');
  });
  it('validates payout amounts', () => {
    expect(validateVendorPayout(100, 10000)).toMatch(/Minimum/);
    expect(validateVendorPayout(20000, 10000)).toMatch(/exceeds/);
    expect(validateVendorPayout(5000, 10000)).toBe('');
  });
});

describe('wallet (server ledger)', () => {
  const now = new Date(2026, 8, 28, 12);
  const e = (id: string, type: string, amount: number, at: Date, over: Record<string, unknown> = {}) =>
    mapLedgerEntry(id, { schema: 2, type, direction: 'credit', netAmount: amount, status: 'available', createdAt: at, ...over })!;

  it('shows the recorded payout and never estimates one', () => {
    const b = (over: Record<string, unknown>) => mapVendorBooking('a', { bookingId: 'a', status: 'Completed', fare: 1000, ...over });
    expect(payoutText(b({ vendorPayout: 850 }))).toMatch(/850/);
    expect(b({}).payoutRecorded).toBe(false);
    expect(payoutText(b({}))).toBe('Not recorded');
    const fin = b({ vendorPayout: 850, finance: { schema: 1, partnerType: 'vendor', partnerPayout: 820 } });
    expect(fin).toMatchObject({ vendorPayout: 820, payoutFinalized: true });
    expect(payoutText(fin)).toMatch(/820.*finalized/);
    expect(tripStageLabel(b({ status: 'Assigned', tripStage: 'Reached Pickup' }))).toBe('Driver at pickup');
    expect(tripStageLabel(b({ status: 'Ongoing', tripStage: 'In Progress' }))).toBe('On trip');
  });
  it('reads the wallet as the server wrote it, including a negative balance', () => {
    expect(mapWallet(undefined).available).toBe(0);
    expect(mapWallet({ available: -400, reserved: 300, paidOut: 500, pending: '12' })).toMatchObject({ available: -400, reserved: 300, paidOut: 500, pending: 0 });
  });
  it('sums only credited earnings for the month', () => {
    const ledger = [
      e('a', 'trip_earning', 850, new Date(2026, 8, 28, 9)),
      e('t', 'toll_reimbursement', 100, new Date(2026, 8, 20)),
      e('old', 'trip_earning', 1700, new Date(2026, 7, 10)),
      e('cash', 'cash_collected', 1000, new Date(2026, 8, 27), { direction: 'debit' }),
      e('x', 'trip_earning', 999, new Date(2026, 8, 27), { status: 'cancelled' }),
    ];
    expect(monthEarnings(ledger, now)).toBe(950);
    expect(mapLedgerEntry('legacy', { type: 'trip_earning', netAmount: 5 })).toBeNull();
  });
  it('computes days until expiry', () => {
    expect(daysUntil('2026-09-30', now)).toBe(2);
    expect(daysUntil('2026-09-27', now)).toBeLessThan(0);
    expect(daysUntil('garbage', now)).toBeNull();
  });
});

describe('mapping & storage', () => {
  it('maps marketplace offers defensively', () => {
    const t = mapMarketTrip('m1', { pickup: { address: 'A', city: 'Theni', time: '10:00 AM' }, drop: { address: 'B', city: 'Madurai' }, offeredPayout: '₹1,200', status: 'Bidding', bidCount: 2 });
    expect(t).toMatchObject({ route: 'Theni ➔ Madurai', offeredPayout: 1200, status: 'Bidding', bidCount: 2 });
  });
  it('builds safe onboarding storage paths', () => {
    expect(buildOnboardingPath('u1', 'vehicle_rc', 'My RC (front).PDF', 1700000000000, 'abc123')).toBe('vendors/u1/onboarding/vehicle_rc/1700000000000_abc123_my-rc-front.pdf');
  });
  it('mirrors storage.rules upload limits', () => {
    expect(validateUploadFile({ name: 'a.pdf', mimeType: 'application/pdf', size: 1000 })).toBe('');
    expect(validateUploadFile({ name: 'a.exe', mimeType: 'application/x-msdownload', size: 1000 })).toBeTruthy();
    expect(validateUploadFile({ name: 'big.jpg', mimeType: 'image/jpeg', size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(validateUploadFile({ name: 'empty.png', mimeType: 'image/png', size: 0 })).toMatch(/empty/);
  });
});

