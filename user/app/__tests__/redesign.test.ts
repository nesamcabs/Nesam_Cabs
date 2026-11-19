// Rules behind the redesigned Booking, Choose your ride, My Trips and Account screens.
import { quotedInclusionLine, scheduleProblem, whatsappProblem } from '../src/utils/bookingRules';
import { paymentLabel, paymentRows, tabOfTrip, tripStatusChip } from '../src/utils/tripView';
import { mapBooking } from '../src/services/rideService';
import type { TripRecord } from '../src/types';

const trip = (d: Record<string, unknown>): TripRecord => mapBooking('b1', { customerId: 'c1', bookingId: 'NT1', ...d });

describe('booking step 1: schedule', () => {
  const now = Date.UTC(2026, 9, 8, 6, 0);
  it('is required, needs 30 minutes notice and at most 30 days ahead', () => {
    expect(scheduleProblem(null, now)).toMatch(/pickup date and time/);
    expect(scheduleProblem(new Date(now + 10 * 60000), now)).toMatch(/30 minutes/);
    expect(scheduleProblem(new Date(now + 2 * 3600000), now)).toBe('');
    expect(scheduleProblem(new Date(now + 31 * 86400000), now)).toMatch(/30 days/);
  });
});

describe('booking step 3: WhatsApp contact (same rules as the server)', () => {
  it('accepts same-as-mobile and valid numbers, rejects the rest', () => {
    expect(whatsappProblem(true, '', '')).toBe('');
    expect(whatsappProblem(false, '+91', '98765 43210')).toBe('');
    expect(whatsappProblem(false, '+91', '12345')).toMatch(/10-digit/);
    expect(whatsappProblem(false, '91', '9876543210')).toMatch(/country code/);
    expect(whatsappProblem(false, '+971', '501234567')).toBe('');
    expect(whatsappProblem(false, '+91', 'abc')).toMatch(/digits only/);
  });
});

describe('booking step 2: what the package includes', () => {
  it('shows what the server quote says: included km and extra-km rate, and nothing before it answers', () => {
    expect(quotedInclusionLine({ ok: true, includedKm: 200, extraKmRate: 15 })).toBe('200 km included · ₹15/km extra');
    expect(quotedInclusionLine({ ok: true, extraKmRate: 14 })).toBe('₹14/km extra');
    expect(quotedInclusionLine({ ok: true, rentalHours: 4, includedKm: 40, extraKmRate: 12 })).toBe('4 hours · 40 km included · ₹12/km extra');
    expect(quotedInclusionLine(undefined)).toBe('');
    expect(quotedInclusionLine({ ok: false })).toBe('');
  });
});

describe('My Trips', () => {
  it('sorts bookings into Upcoming / Completed / Cancelled', () => {
    for (const s of ['Pending', 'Approved', 'Confirmed', 'Assigned', 'Ongoing']) expect(tabOfTrip(trip({ status: s }))).toBe('Upcoming');
    expect(tabOfTrip(trip({ status: 'Completed' }))).toBe('Completed');
    expect(tabOfTrip(trip({ status: 'Cancelled' }))).toBe('Cancelled');
    expect(tabOfTrip(trip({ status: 'Rejected' }))).toBe('Cancelled');
  });
  it('labels the status in words for every stage', () => {
    expect(tripStatusChip(trip({ status: 'Pending' })).label).toBe('Awaiting review');
    expect(tripStatusChip(trip({ status: 'Approved' })).label).toBe('Approved — arranging your vehicle');
    expect(tripStatusChip(trip({ status: 'Confirmed', assignedVendorId: 'v1' })).label).toBe('Vendor assigned — driver details pending');
    expect(tripStatusChip(trip({ status: 'Assigned', assignedDriverId: 'd1', scheduledAt: new Date(Date.now() + 5 * 86400000) })).label).toBe('Driver and vehicle assigned');
    expect(tripStatusChip(trip({ status: 'Assigned', assignedDriverId: 'd1', scheduledAt: new Date(Date.now() + 3 * 3600000) })).label).toBe('Upcoming trip');
    expect(tripStatusChip(trip({ status: 'Assigned', assignedDriverId: 'd1', tripStage: 'Reached Pickup' })).label).toBe('Driver at pickup');
    expect(tripStatusChip(trip({ status: 'Ongoing', tripStage: 'In Progress' })).label).toBe('Trip in progress');
    expect(tripStatusChip(trip({ status: 'Completed' })).label).toBe('Completed');
  });
  it('says what is owed: pay at drop, UPI, paid, balance, refund or fee', () => {
    expect(paymentLabel(trip({ status: 'Confirmed', paymentMethod: 'Cash' })).text).toBe('Pay at drop');
    expect(paymentLabel(trip({ status: 'Confirmed', paymentMethod: 'UPI' })).text).toBe('Pay by UPI');
    expect(paymentLabel(trip({ status: 'Completed', payment: 'Paid' }))).toEqual({ text: 'Paid', tone: 'success' });
    expect(paymentLabel(trip({ status: 'Completed', paymentSummary: { totalPaid: 1000, balanceDue: 500 } })).text).toBe('Balance ₹500');
    expect(paymentLabel(trip({ status: 'Cancelled', refund: { status: 'Pending', amount: 800 } })).text).toBe('Refund pending: ₹800');
    expect(paymentLabel(trip({ status: 'Cancelled', cancellationFee: 100 })).text).toBe('Cancellation fee ₹100');
    expect(paymentLabel(trip({ status: 'Cancelled', refund: { status: 'Not Applicable', amount: 0 } })).text).toBe('No charge');
  });
});

describe('Account › Payment history', () => {
  it('lists completed trips and charged or refunded cancellations, newest first', () => {
    const rows = paymentRows([
      trip({ status: 'Cancelled', cancelledAt: new Date(2026, 9, 1) }),
      trip({ status: 'Completed', completedAt: new Date(2026, 9, 2) }),
      { ...trip({ status: 'Cancelled', cancelledAt: new Date(2026, 9, 5), refund: { status: 'Completed', amount: 300 } }), id: 'r' },
    ]);
    expect(rows.map((r) => r.status)).toEqual(['Cancelled', 'Completed']);
    expect(rows[0]!.refund).toEqual({ status: 'Completed', amount: 300 });
  });
});

describe('Airport tile: what counts as an airport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isAirportPlace } = require('../src/services/geoService') as typeof import('../src/services/geoService');
  it('accepts real airports and refuses roads named after one', () => {
    expect(isAirportPlace('Madurai Airport', 'aeroway', 'aerodrome')).toBe(true);
    expect(isAirportPlace('Tiruchirappalli International Airport')).toBe(true);
    expect(isAirportPlace('Airport Road', 'highway', 'primary')).toBe(false);
    expect(isAirportPlace('Airport Road')).toBe(false);
    expect(isAirportPlace('Airport Nagar')).toBe(false);
    expect(isAirportPlace('Airportview Hotel')).toBe(false);
  });
});
