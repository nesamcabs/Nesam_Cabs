import { describe, expect, it } from 'vitest';
import type { TripRecord } from '@core/types';
import { amountDue, isPaid, payableAmount } from './tripMoney';

const trip = (over: Partial<TripRecord>): TripRecord =>
  ({ fare: 1000, fareBreakdown: null, tollCharges: 0, paid: null, paymentStatus: 'Pending', ...over }) as TripRecord;

describe('what a rider owes for a trip', () => {
  it('uses the stored fare plus tolls the driver paid', () => {
    expect(payableAmount(trip({ fare: 1000, tollCharges: 85 }))).toBe(1085);
    expect(payableAmount(trip({ fare: 1000, fareBreakdown: { total: 1050 } as TripRecord['fareBreakdown'], tollCharges: 0 }))).toBe(1050);
  });

  it('trusts the server balance once payments are recorded', () => {
    expect(amountDue(trip({ fare: 1000 }))).toBe(1000);
    expect(amountDue(trip({ paid: { totalPaid: 400, balanceDue: 600, status: 'Partial' } }))).toBe(600);
    expect(isPaid(trip({ paid: { totalPaid: 1000, balanceDue: 0, status: 'Paid' } }))).toBe(true);
    expect(isPaid(trip({ paid: { totalPaid: 400, balanceDue: 600, status: 'Partial' } }))).toBe(false);
    expect(isPaid(trip({ paymentStatus: 'Paid' }))).toBe(true);
  });
});
