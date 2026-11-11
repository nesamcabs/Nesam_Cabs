import { formatDateTime12, formatTime12 } from '../src/utils/time';
import { categoryOf, ctaOf, severityOf, soundOf, toneOf } from '../src/utils/notificationModel';

describe('12-hour times in India time', () => {
  it('formats AM and PM with a leading zero', () => {
    expect(formatTime12(new Date('2026-10-07T13:00:00Z'))).toBe('06:30 PM');
    expect(formatTime12(new Date('2026-10-06T18:30:00Z'))).toBe('12:00 AM');
    expect(formatDateTime12(new Date('2026-10-07T13:00:00Z'))).toBe('07 Oct 2026, 06:30 PM');
    expect(formatTime12(null)).toBe('');
  });
});

describe('notification model', () => {
  const raw = (o: Partial<Parameters<typeof categoryOf>[0]> = {}) => ({ type: '', category: '', severity: '', priority: '', sound: '', bookingId: '', ...o });
  it('classifies, picks a tone and a colour', () => {
    expect(categoryOf(raw({ type: 'booking' }))).toBe('bookings');
    expect(soundOf(raw({ sound: 'new_booking' }))).toBe('new_booking');
    expect(soundOf(raw({ type: 'approval' }))).toBe('approval');
    expect(toneOf({ category: 'penalties', severity: 'critical' })).toBe('red');
    expect(toneOf({ category: 'bookings', severity: 'info' })).toBe('blue');
    expect(severityOf(raw({ priority: 'high' }))).toBe('warning');
  });
  it('points vendors at their own screens', () => {
    expect(ctaOf(raw({ category: 'bookings' })).ctaPage).toBe('market');
    expect(ctaOf(raw({ category: 'penalties' })).ctaPage).toBe('penalties');
    expect(ctaOf(raw({ cta: { label: 'Assign driver', page: 'trips' } }))).toEqual({ ctaLabel: 'Assign driver', ctaPage: 'trips' });
  });
});
