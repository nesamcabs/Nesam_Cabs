import { mapBooking } from '../src/services/rideService';
import { BOOKING_TABS, bookingTabOf, milestones } from '../src/utils/tripView';

const trip = (d: Record<string, unknown>) => mapBooking('b1', { pickup: 'A', drop: 'B', fare: 1000, ...d });
const states = (d: Record<string, unknown>) => milestones(trip(d)).map((m) => m.state).join(',');

describe('booking tabs', () => {
  it('splits a live trip out of Upcoming and keeps the existing grouping otherwise', () => {
    expect(BOOKING_TABS).toEqual(['Upcoming', 'Ongoing', 'Completed', 'Cancelled']);
    expect(bookingTabOf(trip({ status: 'Ongoing' }))).toBe('Ongoing');
    for (const s of ['Pending', 'Approved', 'Confirmed', 'Assigned']) expect(bookingTabOf(trip({ status: s }))).toBe('Upcoming');
    expect(bookingTabOf(trip({ status: 'Completed' }))).toBe('Completed');
    expect(bookingTabOf(trip({ status: 'Rejected' }))).toBe('Cancelled');
  });
});

describe('five customer milestones from real status', () => {
  it('is in review, not confirmed, while NESAM has not approved', () => {
    expect(states({ status: 'Pending' })).toBe('current,todo,todo,todo,todo');
    expect(milestones(trip({ status: 'Pending' }))[0]!.detail).toBe('Awaiting NESAM review');
  });
  it('is confirmed but arranging a vehicle once approved, and says when only a vendor is set', () => {
    expect(states({ status: 'Approved' })).toBe('done,current,todo,todo,todo');
    expect(milestones(trip({ status: 'Approved' }))[1]!.detail).toBe('NESAM is arranging your vehicle');
    expect(milestones(trip({ status: 'Confirmed' }))[1]!.detail).toBe('Vendor assigned — driver details pending');
  });
  it('walks through assignment, arrival, boarding and completion', () => {
    expect(states({ status: 'Assigned', assignedDriverId: 'd1' })).toBe('done,done,current,todo,todo');
    expect(states({ status: 'Assigned', assignedDriverId: 'd1', tripStage: 'En Route Pickup' })).toBe('done,done,current,todo,todo');
    expect(milestones(trip({ status: 'Assigned', assignedDriverId: 'd1', tripStage: 'En Route Pickup' }))[2]!.detail).toBe('Your driver is on the way');
    expect(states({ status: 'Ongoing', assignedDriverId: 'd1', tripStage: 'Reached Pickup' })).toBe('done,done,done,current,todo');
    expect(states({ status: 'Ongoing', assignedDriverId: 'd1', tripStage: 'In Progress' })).toBe('done,done,done,done,current');
    expect(states({ status: 'Completed', assignedDriverId: 'd1' })).toBe('done,done,done,done,done');
  });
});
