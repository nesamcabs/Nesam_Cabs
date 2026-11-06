import { describe, expect, it, vi } from 'vitest';
vi.mock('@core/services/callables', () => ({ callFunction: vi.fn() }));
import { quoteKeyOf, type QuoteRequest } from '@core/services/quoteService';
const request: QuoteRequest = {
  pickup: { name: 'Chennai', address: 'Chennai', lat: 13, lng: 80 },
  drop: { name: 'Pondicherry', address: 'Pondicherry', lat: 12, lng: 79 },
  tripType: 'One Way', scheduledAt: '2026-11-08T10:00:00+05:30',
};
describe('paid add-on quote identity', () => {
  it('invalidates the fare independently for carrier and pets', () => {
    const none = quoteKeyOf(request);
    const carrier = quoteKeyOf({ ...request, addOns: { roofCarrier: true, pets: false } });
    const pets = quoteKeyOf({ ...request, addOns: { roofCarrier: false, pets: true } });
    const both = quoteKeyOf({ ...request, addOns: { roofCarrier: true, pets: true } });
    expect(new Set([none, carrier, pets, both]).size).toBe(4);
  });
});
