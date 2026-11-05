import { describe, expect, it } from 'vitest';
import type { TripRecord } from '@core/types';
import { milestones } from './milestones';

const trip = (phase: TripRecord['phase'], status: TripRecord['status'] = 'Confirmed') =>
  ({ phase, status, approvedAt: null, assignedAt: null, startedAt: null, completedAt: null, driver: null }) as unknown as TripRecord;
const states = (t: TripRecord) => milestones(t).map((m) => m.state[0]).join('');

describe('milestones', () => {
  it('never calls a pending request confirmed', () => {
    const m = milestones(trip('awaiting_review', 'Pending'));
    expect(m[0]).toMatchObject({ label: 'Booking Confirmed', state: 'current', detail: 'Awaiting NESAM review' });
    expect(states(trip('awaiting_review', 'Pending'))).toBe('cttt' + 't');
  });
  it('follows the real phases', () => {
    expect(states(trip('arranging'))).toBe('dcttt');
    expect(states(trip('driver_en_route'))).toBe('ddctt');
    expect(milestones(trip('driver_en_route'))[2]!.detail).toBe('Your driver is on the way');
    expect(states(trip('driver_arrived'))).toBe('dddct');
    expect(states(trip('in_trip'))).toBe('ddddc');
    expect(states(trip('completed', 'Completed'))).toBe('ddddd');
  });
  it('has five steps only', () => {
    expect(milestones(trip('arranging')).map((m) => m.label)).toEqual(['Booking Confirmed', 'Driver Assigned', 'Driver Arrived', 'Trip Started', 'Trip Completed']);
  });
});
