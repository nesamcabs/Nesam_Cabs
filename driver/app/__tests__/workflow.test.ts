import { formatDateTime12, formatTime12, toDate } from '../src/utils/time';
import { nextStep, startBlockers, tripSubStatusOf, TRIP_STEPS } from '../src/utils/tripFlow';
import { shouldShareLocation } from '../src/hooks/useTripLocationSharing';
import { categoryOf, ctaOf, severityOf, soundOf, toneOf } from '../src/utils/notificationModel';

describe('12-hour times in India time', () => {
  it('formats AM and PM with a leading zero', () => {
    expect(formatTime12(new Date('2026-10-07T13:00:00Z'))).toBe('06:30 PM');
    expect(formatTime12(new Date('2026-10-07T00:35:00Z'))).toBe('06:05 AM');
    expect(formatTime12(new Date('2026-10-06T18:30:00Z'))).toBe('12:00 AM');
    expect(formatTime12(new Date('2026-10-07T06:30:00Z'))).toBe('12:00 PM');
  });
  it('shows date and time together and tolerates missing values', () => {
    expect(formatDateTime12(new Date('2026-10-07T13:00:00Z'))).toBe('07 Oct 2026, 06:30 PM');
    expect(formatTime12(null)).toBe('');
    expect(toDate({ seconds: 1790000000 })).toBeInstanceOf(Date);
  });
});

describe('trip steps', () => {
  it('has exactly three driver steps in order: Reached Pickup → Trip Started → Trip Ended', () => {
    expect(TRIP_STEPS).toEqual(['Reached Pickup', 'Trip Started', 'Trip Ended']);
    expect(nextStep('Not Started')).toBe('Reached Pickup');
    expect(nextStep('Reached Pickup')).toBe('Trip Started');
    expect(nextStep('Trip Started')).toBe('Trip Ended');
    expect(nextStep('Trip Ended')).toBeNull();
  });
  it('lists what still blocks Trip Started', () => {
    expect(startBlockers({ verificationSubmitted: false, boardingVerified: false })).toHaveLength(2);
    expect(startBlockers({ verificationSubmitted: true, boardingVerified: false })).toEqual(["Customer's boarding OTP"]);
    expect(startBlockers({ verificationSubmitted: true, boardingVerified: true })).toEqual([]);
  });
  it('reads the stored step and maps older stages', () => {
    expect(tripSubStatusOf({ tripSubStatus: 'Reached Pickup' })).toBe('Reached Pickup');
    // Earlier order: "Trip Started" meant driving to the pickup.
    expect(tripSubStatusOf({ tripSubStatus: 'Trip Started', tripStage: 'En Route Pickup' })).toBe('Not Started');
    expect(tripSubStatusOf({ tripSubStatus: 'Trip Started', tripStage: 'In Progress' })).toBe('Trip Started');
    expect(tripSubStatusOf({ tripStage: 'En Route Pickup' })).toBe('Not Started');
    expect(tripSubStatusOf({ tripStage: 'In Progress' })).toBe('Trip Started');
    expect(tripSubStatusOf({ status: 'Completed' })).toBe('Trip Ended');
    expect(tripSubStatusOf({})).toBe('Not Started');
  });
});

describe('location sharing', () => {
  const now = Date.UTC(2026, 9, 8, 6, 0);
  const t = (subStatus: 'Not Started' | 'Reached Pickup' | 'Trip Started', pickupAt: Date | null, status = 'Assigned') => ({ status: status as 'Assigned', subStatus, pickupAt });
  it('shares on the way to a near pickup, at the pickup and on the trip — not hours ahead', () => {
    expect(shouldShareLocation(t('Not Started', null), now)).toBe(true);
    expect(shouldShareLocation(t('Not Started', new Date(now + 90 * 60000)), now)).toBe(true);
    expect(shouldShareLocation(t('Not Started', new Date(now + 5 * 3600000)), now)).toBe(false);
    expect(shouldShareLocation(t('Reached Pickup', new Date(now + 5 * 3600000)), now)).toBe(true);
    expect(shouldShareLocation(t('Trip Started', null, 'Ongoing'), now)).toBe(true);
    expect(shouldShareLocation(t('Trip Started', null, 'Completed'), now)).toBe(false);
    expect(shouldShareLocation(null, now)).toBe(false);
  });
});

describe('notification model', () => {
  const raw = (o: Partial<Parameters<typeof categoryOf>[0]> = {}) => ({ type: '', category: '', severity: '', priority: '', sound: '', bookingId: '', ...o });
  it('classifies old records and keeps new ones', () => {
    expect(categoryOf(raw({ type: 'payout' }))).toBe('payments');
    expect(categoryOf(raw({ category: 'penalties' }))).toBe('penalties');
    expect(categoryOf(raw())).toBe('general');
  });
  it('chooses the tone from the stored sound, else from the category', () => {
    expect(soundOf(raw({ sound: 'new_booking' }))).toBe('new_booking');
    expect(soundOf(raw({ type: 'approval' }))).toBe('approval');
    expect(soundOf(raw())).toBe('general');
  });
  it('colours by severity first, then by category', () => {
    expect(toneOf({ category: 'bookings', severity: 'info' })).toBe('blue');
    expect(toneOf({ category: 'approvals', severity: 'success' })).toBe('green');
    expect(toneOf({ category: 'penalties', severity: 'critical' })).toBe('red');
    expect(toneOf({ category: 'trips', severity: 'warning' })).toBe('amber');
    expect(severityOf(raw({ priority: 'urgent' }))).toBe('critical');
  });
  it('gives every notification a call to action', () => {
    expect(ctaOf(raw({ category: 'trips' })).ctaPage).toBe('trip');
    expect(ctaOf(raw({ cta: { label: 'Assign', page: 'x' } }))).toEqual({ ctaLabel: 'Assign', ctaPage: 'x' });
  });
});
