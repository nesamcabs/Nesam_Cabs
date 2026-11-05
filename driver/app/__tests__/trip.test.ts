import * as service from '../src/services/driverService';
import {
  buildNewDriverDoc,
  emptyRegistration,
  mapBooking,
  mapDriverDoc,
  tollTotal,
  validatePayoutAmount,
} from '../src/services/driverService';
import { categoryMatches, payoutText } from '../src/utils/earnings';
import { last7Days, mapLedgerEntry, mapWallet, summarizeEarnings } from '../src/utils/ledger';
import type { DriverProfile, LedgerEntry } from '../src/types/driver';

const driver = mapDriverDoc('drv1', { name: 'Murugan', phone: '+91 98765 43210', status: 'Approved' }).driver as DriverProfile;

describe('rules payloads', () => {
  it('a marketplace claim is a server call: the app has no client write that could assign a duty', () => {
    expect((service as Record<string, unknown>).buildClaimUpdate).toBeUndefined();
    expect(typeof service.acceptMarketplaceTrip).toBe('function');
    expect(typeof service.submitDutyBid).toBe('function');
  });

  it('a booking carries no raw customer number; only the masked one is mapped', () => {
    const t = service.mapBooking('b1', { status: 'Assigned', phone: '+919876543210', phoneMasked: '+91 98••• ••210', customer: 'Priya' });
    expect(t.customerPhone).toBe('');
    expect(t.customerPhoneMasked).toBe('+91 98••• ••210');
  });

  it('a self-registered driver can never grant itself approval', () => {
    const d = buildNewDriverDoc('drv1', '+919876543210', emptyRegistration('+91 98765 43210'), null);
    expect(d).toMatchObject({ role: 'driver', status: 'Pending', verified: false, vendorId: '' });
    const invited = buildNewDriverDoc('drv1', '+919876543210', emptyRegistration(''), { vendorId: 'v1', vendorName: 'Fleet', preApproved: false });
    expect(invited).toMatchObject({ status: 'Pending', vendorId: 'v1' });
  });
});

describe('booking mapping', () => {
  it('reads flat and nested locations and the trip step', () => {
    const t = mapBooking('b1', { status: 'Ongoing', tripSubStatus: 'Reached Pickup', tripStage: 'Reached Pickup', boardingVerifiedAt: new Date(), fare: 1000, pickup: 'A', pickupLat: 10, pickupLng: 77, drop: { address: 'B', lat: 9, lng: 78 } });
    expect(t.subStatus).toBe('Reached Pickup');
    expect(t.boardingVerified).toBe(true);
    expect(t.stage).toBe('Reached Pickup');
    expect(t.pickup).toMatchObject({ address: 'A', lat: 10 });
    expect(t.drop).toMatchObject({ address: 'B', lng: 78 });
    // No driverPayout on the booking: nothing is estimated from the fare.
    expect(t.payoutRecorded).toBe(false);
    expect(t.driverEarnings).toBe(0);
  });
  it('prefers the explicit driver payout and ignores malformed tolls', () => {
    const t = mapBooking('b1', { status: 'Completed', fare: 1000, driverPayout: 700, tolls: [{ id: 'a', amount: 50 }, 'junk', null] });
    expect(t.driverEarnings).toBe(700);
    expect(t.tolls).toHaveLength(1);
    expect(t.stage).toBe('Completed');
  });
  it('uses the finalized payout once finance closes the trip', () => {
    const agreed = mapBooking('p', { status: 'Completed', driverPayout: 850 });
    expect(agreed).toMatchObject({ driverEarnings: 850, payoutRecorded: true, payoutFinalized: false });
    const fin = mapBooking('p', { status: 'Completed', driverPayout: 850, finance: { schema: 1, partnerType: 'driver', partnerPayout: 820 } });
    expect(fin).toMatchObject({ driverEarnings: 820, payoutRecorded: true, payoutFinalized: true });
    expect(mapBooking('p', { status: 'Completed', finance: { schema: 1, partnerType: 'vendor', partnerPayout: 900 } }).fleetTrip).toBe(true);
  });
  it('maps the three trip steps and the legacy stages of older bookings', () => {
    expect(mapBooking('n', { status: 'Assigned' }).subStatus).toBe('Not Started');
    const started = mapBooking('s', { status: 'Ongoing', tripSubStatus: 'Trip Started', tripStage: 'In Progress' });
    expect(started.subStatus).toBe('Trip Started');
    // Earlier order: "Trip Started" while driving to the pickup → not at the pickup yet.
    expect(mapBooking('r', { status: 'Ongoing', tripSubStatus: 'Trip Started', tripStage: 'En Route Pickup' }).subStatus).toBe('Not Started');
    // Older flow: OTP was checked at the start, so boarding counts as verified.
    const old = mapBooking('o', { status: 'Ongoing', tripStage: 'In Progress', startedAt: new Date() });
    expect(old.subStatus).toBe('Trip Started');
    expect(old.boardingVerified).toBe(true);
    expect(mapBooking('e', { status: 'Completed' }).subStatus).toBe('Trip Ended');
  });
  it('knows whether the vehicle photos were submitted and the balance due', () => {
    const t = mapBooking('v', { status: 'Assigned', vehicleVerification: { status: 'Submitted' }, paymentSummary: { balanceDue: 250 }, preTrip: { vehicleFront: 'f', vehicleRear: 'r', vehicleInterior: 'i', odometerReading: 100 } });
    expect(t.verificationSubmitted).toBe(true);
    expect(t.balanceDue).toBe(250);
    expect(t.preTrip).toMatchObject({ vehicleFront: 'f', vehicleRear: 'r', vehicleInterior: 'i' });
    expect(JSON.stringify(t.preTrip)).not.toMatch(/selfie/i);
    expect(mapBooking('x', { status: 'Assigned' }).verificationSubmitted).toBe(false);
  });
  it('maps legacy "Trip Started" to Ongoing', () => {
    expect(mapBooking('b', { status: 'Trip Started' }).status).toBe('Ongoing');
  });
});

function entry(id: string, type: string, amount: number, at: Date, over: Record<string, unknown> = {}): LedgerEntry {
  return mapLedgerEntry(id, { schema: 2, type, direction: 'credit', netAmount: amount, status: 'available', createdAt: at, ...over })!;
}

describe('earnings & wallet (server ledger)', () => {
  const now = new Date(2026, 8, 28, 15, 0);
  const ledger = [
    entry('a', 'trip_earning', 500, new Date(2026, 8, 28, 9)),
    entry('a-toll', 'toll_reimbursement', 50, new Date(2026, 8, 28, 9)),
    entry('b', 'trip_earning', 300, new Date(2026, 8, 25, 9)),
    entry('c', 'trip_earning', 1000, new Date(2026, 7, 1, 9)),
    entry('cash', 'cash_collected', 1200, new Date(2026, 8, 28, 10), { direction: 'debit' }),
    entry('gone', 'trip_earning', 999, new Date(2026, 8, 28, 11), { status: 'cancelled' }),
  ];

  it('summarises only credited earnings, by period', () => {
    const s = summarizeEarnings(ledger, now);
    expect(s.todayEarnings).toBe(550);
    expect(s.thisWeekEarnings).toBe(850);
    expect(s.thisMonthEarnings).toBe(850);
    expect(s.lifetimeEarnings).toBe(1850);
    expect(s.tollReimbursements).toBe(50);
    expect(s.totalTripsCompleted).toBe(3);
  });

  it('ignores records that are not schema-2 ledger entries', () => {
    expect(mapLedgerEntry('old', { type: 'trip_earning', netAmount: 10 })).toBeNull();
  });

  it('reads the wallet as the server wrote it, including a negative balance', () => {
    expect(mapWallet(undefined).available).toBe(0);
    expect(mapWallet({ available: -700, reserved: 100, paidOut: 500, pending: 'x' })).toMatchObject({ available: -700, reserved: 100, paidOut: 500, pending: 0 });
  });

  it('builds the 7-day chart from credited earnings', () => {
    const days = last7Days(ledger, now);
    expect(days).toHaveLength(7);
    expect(days[6]!.amount).toBe(550);
    expect(days[3]!.amount).toBe(300);
  });

  it('never estimates a payout', () => {
    expect(payoutText(mapBooking('p', { status: 'Completed', fare: 1000 }))).toBe('Not recorded');
    expect(payoutText(mapBooking('p', { status: 'Completed', fare: 1000, driverPayout: 850 }))).toMatch(/850/);
    expect(payoutText(mapBooking('p', { status: 'Completed', fare: 1000, driverPayout: 850, assignedVendorId: 'v1' }))).toBe('Paid by your fleet');
  });
});

describe('payout requests', () => {
  it('validates payout amounts', () => {
    expect(validatePayoutAmount(99, 1000)).toMatch(/Minimum/);
    expect(validatePayoutAmount(1001, 1000)).toMatch(/exceeds/);
    expect(validatePayoutAmount(150.5, 1000)).toMatch(/whole/);
    expect(validatePayoutAmount(-5, 1000)).toBeTruthy();
    expect(validatePayoutAmount(500, 1000)).toBe('');
  });

  it('adds tolls precisely', () => {
    expect(tollTotal([{ id: 'a', name: '', amount: 10.1, receiptPhotoUrl: '', uploadedAt: '' }, { id: 'b', name: '', amount: 20.2, receiptPhotoUrl: '', uploadedAt: '' }])).toBe(30.3);
  });
});

describe('category matching', () => {
  it('matches loosely but keeps premium separate', () => {
    expect(categoryMatches('Sedan (AC)', 'Sedan')).toBe(true);
    expect(categoryMatches('SUV', 'SUV')).toBe(true);
    expect(categoryMatches('Premium SUV', 'SUV')).toBe(false);
    expect(categoryMatches('SUV', 'Premium SUV')).toBe(false);
    expect(categoryMatches('Mini', 'Hatchback')).toBe(true);
    expect(categoryMatches('', 'Sedan')).toBe(true);
    expect(categoryMatches('Tempo Traveller', 'Sedan')).toBe(false);
  });
});

