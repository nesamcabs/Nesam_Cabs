// The booking server rejects a request whose expectedFare differs from its own
// price, so the app's quote must match the server engine exactly — including
// the global % adjustment — and the estimate breakup must match what it stores.
import { calculateFare, isOutstation, mapCategory } from '../src/services/pricingService';
import { buildFareBreakup } from '../src/utils/fareBreakup';
import { calculateFare as serverFare, mapCategory as serverCategory } from '../../../functions/src/domain/pricing';
import { buildFareBreakup as serverBreakup } from '../../../functions/src/domain/fareBreakup';
import { mapBooking } from '../src/services/rideService';
import type { RideCategory, RouteInfo, TripType } from '../src/types';

const categoryDoc = {
  name: 'Sedan',
  status: 'Active',
  displayOrder: 2,
  fare: {
    baseFare: 300, baseKm: 10, perKmRate: 14, perMinuteRate: 1.5, minimumFare: 350, nightAllowance: 150,
    outstationDriverBattaPerDay: 400, outstationPerKmRate: 13, waitingChargePerHour: 120, extraKmCharge: 15,
    tollIncluded: false, parkingIncluded: true, permitCharge: 250, carrierCharge: 100,
  },
};
const server = serverCategory('sedan', categoryDoc)!;
// The app reads the same document through its own mapper.
const app: RideCategory = mapCategory('sedan', categoryDoc)!;
const route = (distanceKm: number, durationMin: number): RouteInfo => ({ distanceKm, durationMin, path: [], estimated: false });
const increase = { id: 'global_v3', name: 'Festival pricing', direction: 'increase' as const, percent: 12 };
const decrease = { id: 'global_v4', name: 'Monsoon offer', direction: 'decrease' as const, percent: 7.5 };

const cases: { name: string; km: number; min: number; trip: TripType; at: Date; discount?: number; adjustment?: typeof increase | typeof decrease | null }[] = [
  { name: 'local day', km: 18, min: 42, trip: 'One Way', at: new Date('2026-10-08T06:30:00Z') },
  { name: 'local night (IST)', km: 6, min: 15, trip: 'One Way', at: new Date('2026-10-08T17:00:00Z') },
  { name: 'outstation round trip + increase', km: 210, min: 300, trip: 'Round Trip', at: new Date('2026-10-08T03:00:00Z'), adjustment: increase },
  { name: 'decrease + coupon', km: 25, min: 50, trip: 'One Way', at: new Date('2026-10-08T09:00:00Z'), adjustment: decrease, discount: 60 },
  { name: 'minimum fare + increase', km: 1, min: 4, trip: 'One Way', at: new Date('2026-10-08T09:00:00Z'), adjustment: increase },
];

describe('app quote = booking server price', () => {
  it.each(cases)('$name', ({ km, min, trip, at, discount = 0, adjustment = null }) => {
    const input = { route: route(km, min), tripType: trip, pickupTime: at, discount, adjustment };
    const mine = calculateFare({ ...input, category: app });
    const theirs = serverFare({ ...input, category: server });
    expect(mine).toEqual(theirs);

    const outstation = isOutstation(km);
    const lines = buildFareBreakup(app, mine, outstation).lines;
    expect(lines).toEqual(serverBreakup(server, theirs, outstation).lines);
    // Included lines always add up to the payable total — no contradictory figures.
    const included = lines.filter((l) => l.treatment === 'included').reduce((s, l) => s + (l.amount ?? 0), 0);
    expect(included).toBe(mine.total);
  });
});

describe('booking mapping', () => {
  it('reads the stored breakup, payments and approval time', () => {
    const t = mapBooking('b1', {
      customerId: 'c1',
      status: 'Approved',
      approvedAt: new Date('2026-10-08T05:00:00Z'),
      fare: 1000,
      fareBreakdown: { total: 1000, subtotal: 952, gst: 48, gstRate: 0.05 },
      globalAdjustmentApplied: { id: 'global_v3', name: 'Festival pricing', direction: 'increase', percent: 12, amount: 102 },
      fareBreakup: {
        lines: [
          { key: 'base', label: 'Base package', amount: 952, treatment: 'included', detail: '' },
          { key: 'toll', label: 'Toll', amount: null, treatment: 'extra', detail: 'Payable separately at actuals' },
          { key: 'bogus', label: 'Ignored', amount: 5, treatment: 'surprise', detail: '' },
        ],
      },
      paymentSummary: { totalPaid: 300, balanceDue: 700, status: 'Partially Paid' },
    });
    expect(t.status).toBe('Approved');
    expect(t.approvedAt?.toISOString()).toBe('2026-10-08T05:00:00.000Z');
    expect(t.fareLines.map((l) => l.key)).toEqual(['base', 'toll']);
    expect(t.fareBreakdown?.globalAdjustment?.amount).toBe(102);
    expect(t.paid).toEqual({ totalPaid: 300, balanceDue: 700, status: 'Partially Paid' });
  });
});
