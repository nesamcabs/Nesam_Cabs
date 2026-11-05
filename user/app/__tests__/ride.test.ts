import {
  buildCancelUpdate,
  cancellationQuote,
  derivePhase,
  isLiveRide,
  mapBooking,
  normalizeStatus,
} from '../src/services/rideService';
import { INSTANT_CANCELLATION_FEE, SCHEDULED_CANCELLATION_FEE } from '../src/config/constants';
import type { TripRecord } from '../src/types';

function trip(over: Partial<TripRecord>): TripRecord {
  return { ...mapBooking('b1', { customerId: 'cust1', status: 'Pending' }), ...over };
}

describe('status mapping', () => {
  it('normalises legacy labels', () => {
    expect(normalizeStatus('Trip Started')).toBe('Ongoing');
    expect(normalizeStatus('Driver Assigned')).toBe('Assigned');
    expect(normalizeStatus('weird')).toBe('Pending');
  });
  it('derives the rider phase', () => {
    expect(derivePhase('Pending', null)).toBe('awaiting_review');
    expect(derivePhase('Confirmed', null)).toBe('partner_confirmed');
    expect(derivePhase('Assigned', 'En Route Pickup')).toBe('driver_en_route');
    expect(derivePhase('Assigned', 'Reached Pickup')).toBe('driver_arrived');
    expect(derivePhase('Ongoing', 'In Progress')).toBe('in_trip');
    expect(derivePhase('Completed', 'Completed')).toBe('completed');
    expect(derivePhase('Cancelled', null)).toBe('cancelled');
    expect(derivePhase('Approved', null)).toBe('arranging');
    expect(derivePhase('Assigned', null, true)).toBe('driver_assigned');
    expect(derivePhase('Assigned', 'Assigned', true)).toBe('driver_assigned');
    expect(derivePhase('Rejected', null)).toBe('cancelled');
    // Driver has started towards the pickup; the ride begins once boarding is verified.
    expect(derivePhase('Ongoing', 'En Route Pickup')).toBe('driver_en_route');
    expect(derivePhase('Ongoing', 'Reached Pickup', true, false)).toBe('driver_arrived');
    expect(derivePhase('Ongoing', 'Reached Pickup', true, true)).toBe('in_trip');
  });
  it('treats "Assigned" without a driver (vendor awarded) as partner-confirmed', () => {
    expect(derivePhase('Assigned', null, false)).toBe('partner_confirmed');
    expect(mapBooking('x', { status: 'Assigned', assignedVendorId: 'v1' }).phase).toBe('partner_confirmed');
  });
  it('maps driverLocation only when valid', () => {
    expect(mapBooking('x', { driverLocation: { lat: 10, lng: 77 } }).driverLocation?.lat).toBe(10);
    expect(mapBooking('x', { driverLocation: { lat: 0, lng: 0 } }).driverLocation).toBeNull();
  });
});

describe('cancellation policy', () => {
  const now = Date.UTC(2026, 8, 28, 12, 0);
  it('is free before assignment', () => {
    expect(cancellationQuote(trip({ status: 'Pending' }), now)).toMatchObject({ allowed: true, fee: 0 });
    expect(cancellationQuote(trip({ status: 'Approved' }), now)).toMatchObject({ allowed: true, fee: 0 });
    expect(cancellationQuote(trip({ status: 'Rejected' }), now).allowed).toBe(false);
  });
  it('is free within 3 minutes of assignment, then charged', () => {
    expect(cancellationQuote(trip({ status: 'Assigned', assignedAt: new Date(now - 60000) }), now).fee).toBe(0);
    expect(cancellationQuote(trip({ status: 'Assigned', assignedAt: new Date(now - 10 * 60000) }), now).fee).toBe(INSTANT_CANCELLATION_FEE);
  });
  it('charges late cancellation of a committed scheduled ride', () => {
    const t = trip({ status: 'Confirmed', isScheduled: true, scheduledAt: new Date(now + 30 * 60000) });
    expect(cancellationQuote(t, now).fee).toBe(SCHEDULED_CANCELLATION_FEE);
  });
  it('forbids cancelling a started or finished trip', () => {
    expect(cancellationQuote(trip({ status: 'Ongoing' }), now).allowed).toBe(false);
    expect(cancellationQuote(trip({ status: 'Completed' }), now).allowed).toBe(false);
  });
  it('writes only the fields the customer cancel rule allows', () => {
    expect(Object.keys(buildCancelUpdate('Changed my plans')).sort()).toEqual(['cancelReason', 'cancellationFee', 'cancelledAt', 'cancelledBy', 'status', 'updatedAt']);
    expect(buildCancelUpdate('x'.repeat(500)).cancelReason).toHaveLength(200);
  });
});

describe('live ride detection', () => {
  const now = Date.UTC(2026, 8, 28, 12, 0);
  it('treats scheduled rides as live only within an hour of pickup', () => {
    expect(isLiveRide(trip({ status: 'Confirmed', isScheduled: true, scheduledAt: new Date(now + 3 * 3600000) }), now)).toBe(false);
    expect(isLiveRide(trip({ status: 'Confirmed', isScheduled: true, scheduledAt: new Date(now + 30 * 60000) }), now)).toBe(true);
    expect(isLiveRide(trip({ status: 'Ongoing' }), now)).toBe(true);
    expect(isLiveRide(trip({ status: 'Completed' }), now)).toBe(false);
  });
});

