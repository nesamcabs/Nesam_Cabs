// The app never calculates a fare: the booking server's quote is the only price, so there is nothing to keep in step here.
// What stays tested is how the app reads a stored booking.
import { mapBooking } from '../src/services/rideService';

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
