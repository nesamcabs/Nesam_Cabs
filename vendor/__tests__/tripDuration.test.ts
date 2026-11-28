// How long a duty was booked for, shown beside the distance on its card.
import { tripDurationOf } from '../src/utils/tripDuration';

describe('the duration on a duty card', () => {
  it.each([
    ['a 5 hour rental', { rentalHours: 5 }, '5 Hrs'],
    ['a 1 hour rental', { rentalHours: 1 }, '1 Hr'],
    ['a 2 day round trip', { tripDays: 2 }, '2 Days'],
    ['a 1 day round trip', { tripDays: 1 }, '1 Day'],
    ['a same-day package of hours', { timePackage: { kind: 'same_day', label: '8 Hours', hours: 8 } }, '8 Hrs'],
    ['a one way trip', { tripDays: 0 }, ''],
  ])('%s reads "%s"', (_what, duty, text) => {
    expect(tripDurationOf(duty)).toBe(text);
  });
});
