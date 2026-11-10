import { earliestSlot, scheduleProblem } from '../src/utils/bookingRules';
import { CITY_LIMIT_KM, QUICK_CITIES, RENTAL_PACKAGE_HOURS, pinPlace } from '../src/data/localRentals';
import { haversineKm } from '../src/utils/geo';

describe('earliestSlot', () => {
  it('is at least the minimum lead time away, on a 5-minute mark', () => {
    const now = new Date('2026-11-10T12:57:20Z').getTime();
    const at = earliestSlot(now);
    expect(at.getTime() % 300000).toBe(0);
    expect(at.getTime() - now).toBeGreaterThanOrEqual(30 * 60000);
    expect(at.getTime() - now).toBeLessThan(35 * 60000 + 1);
    expect(scheduleProblem(at, now)).toBe('');
  });
});

describe('Local Rentals data', () => {
  it('offers 1 to 15 hour packages', () => {
    expect(RENTAL_PACKAGE_HOURS[0]).toBe(1);
    expect(RENTAL_PACKAGE_HOURS[RENTAL_PACKAGE_HOURS.length - 1]).toBe(15);
  });
  it('keeps quick cities valid and far apart from each other beyond the city limit', () => {
    for (const c of QUICK_CITIES) expect(Number.isFinite(c.lat) && Number.isFinite(c.lng)).toBe(true);
    const chennai = QUICK_CITIES.find((c) => c.name === 'Chennai')!;
    const madurai = QUICK_CITIES.find((c) => c.name === 'Madurai')!;
    expect(haversineKm(chennai, madurai)).toBeGreaterThan(CITY_LIMIT_KM);
  });
  it('describes a pinned point by its coordinates', () => {
    expect(pinPlace({ lat: 11.1, lng: 78.4 }).address).toBe('11.10000, 78.40000');
  });
});
