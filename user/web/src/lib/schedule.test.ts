import { describe, expect, it } from 'vitest';
import { scheduleProblem } from '@core/utils/bookingRules';
import { combineDateTime, earliestPickup, earliestSlot, latestPickup, pickupTimeOptions, toDateInput, toTimeInput } from './schedule';

describe('pickup scheduling', () => {
  it('round-trips the date and time inputs', () => {
    const d = combineDateTime('2026-10-20', '06:35')!;
    expect(toDateInput(d)).toBe('2026-10-20');
    expect(toTimeInput(d)).toBe('06:35');
    expect(combineDateTime('', '06:35')).toBeNull();
    expect(combineDateTime('2026-10-20', '')).toBeNull();
  });

  it('offers a default pickup the booking server accepts', () => {
    const now = Date.UTC(2026, 9, 14, 10, 7, 31);
    const at = earliestPickup(now);
    expect(scheduleProblem(at, now)).toBe('');
    expect(at.getMinutes() % 5).toBe(0);
    expect(scheduleProblem(latestPickup(now), now)).toBe('');
    expect(scheduleProblem(new Date(now + 31 * 86400000), now)).toMatch(/30 days/);
  });
});

describe('pickup time options', () => {
  const SLOTS = ['05:00', '05:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '23:30'];
  const at = (y: number, mo: number, d: number, h: number, mi: number, sec = 0) => new Date(y, mo - 1, d, h, mi, sec).getTime();

  it('starts 30 minutes after now, rounded up to the next 5 minutes', () => {
    expect(toTimeInput(earliestSlot(at(2026, 11, 10, 18, 5)))).toBe('18:35');
    expect(toTimeInput(earliestSlot(at(2026, 11, 10, 18, 6)))).toBe('18:40');
    expect(toTimeInput(earliestSlot(at(2026, 11, 10, 18, 5, 30)))).toBe('18:40');
    expect(scheduleProblem(earliestSlot(at(2026, 11, 10, 18, 6)), at(2026, 11, 10, 18, 6))).toBe('');
  });

  it('offers only times from the earliest slot onward for today', () => {
    const now = at(2026, 11, 10, 18, 5);
    expect(pickupTimeOptions('2026-11-10', SLOTS, now)).toEqual(['18:35', '19:00', '19:30', '23:30']);
  });

  it('offers every slot on a later day', () => {
    const now = at(2026, 11, 10, 18, 5);
    expect(pickupTimeOptions('2026-11-11', SLOTS, now)).toEqual(SLOTS);
  });

  it('has nothing left today late at night, and the earliest slot falls on the next day', () => {
    const now = at(2026, 11, 10, 23, 50);
    expect(pickupTimeOptions('2026-11-10', SLOTS, now)).toEqual([]);
    expect(toDateInput(earliestSlot(now))).toBe('2026-11-11');
    expect(pickupTimeOptions('2026-11-11', SLOTS, now)[0]).toBe('00:20');
  });
});
