import { packageRuleText } from '../src/utils/timePackages';
import { SERVICE_COPY } from '../src/data/serviceCopy';
import type { ServerTimePackage } from '../src/services/quoteService';

const pkg = (p: Partial<ServerTimePackage>): ServerTimePackage => ({ id: 'x', kind: 'same_day', label: 'X', hours: null, includedKm: 0, days: 1, endAt: '2026-11-16T18:15:00.000Z', extraKmRate: 14, fare: {} as never, breakup: {} as never, ...p });
const five = pkg({ id: 'same:five', label: '5-Hour Return', hours: 5, includedKm: 100 });
const eight = pkg({ id: 'same:eight', label: '8-Hour Return', hours: 8, includedKm: 150 });
const full = pkg({ id: 'same:full', label: 'Full-Day Return', includedKm: 250 });
const next = pkg({ id: 'next', kind: 'next_day', label: 'Next-Day Return', days: 2, includedKm: 400 });
const morning = pkg({ id: 'morning', kind: 'morning', label: 'Morning Return', days: 2, includedKm: 250, morningCutoffAt: '2026-11-17T03:30:00.000Z' });
const clock = (d: Date) => `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

describe('packageRuleText', () => {
  it('names the slab each longer trip moves to, from the packages the server returned', () => {
    expect(packageRuleText([eight, five, full], clock)).toBe('Over 5 hours → 8-Hour Return. Over 8 hours or 150 km → Full-Day Return. Return by 18:15.');
    expect(packageRuleText([five, full], clock)).toBe('5-Hour Return or Full-Day Return fits this pickup. Over 5 hours → Full-Day Return. Return by 18:15.');
    expect(packageRuleText([full], clock)).toContain('Full-Day Return ends at 18:15 on your pickup date');
  });
  it('explains the fixed Morning Return cutoff and the two-day package', () => {
    expect(packageRuleText([morning, next], clock)).toBe('Choose Morning Return or Next-Day Return. The 3:30 Morning Return cutoff is fixed.');
    expect(packageRuleText([next], clock)).toContain('Next-Day Return is valid until');
  });
  it('says nothing when there are no packages', () => {
    expect(packageRuleText([], clock)).toBe('');
  });
});

describe('SERVICE_COPY', () => {
  it('has a note and Details rows for every service, and never states a price', () => {
    for (const [kind, c] of Object.entries(SERVICE_COPY)) {
      expect(c.title).toBeTruthy();
      expect(c.items.length).toBeGreaterThan(1);
      expect(JSON.stringify(c)).not.toMatch(/₹|\bRs\b/);
      expect(kind).toBeTruthy();
    }
  });
});
