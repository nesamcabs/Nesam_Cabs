import { describe, expect, it } from 'vitest';
import { scheduleProblem } from '@core/utils/bookingRules';
import { combineDateTime, earliestPickup, latestPickup, toDateInput, toTimeInput } from './schedule';

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
