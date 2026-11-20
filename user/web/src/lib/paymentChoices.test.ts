import { describe, expect, it, vi } from 'vitest';

// The real service, with the network layer replaced so nothing native or Firebase is loaded.
vi.mock('@core/services/callables', () => ({ ActionError: class extends Error {}, callFunction: vi.fn() }));

import { advanceOf, checkoutChoices, choiceText } from '@core/services/paymentService';

describe('payment choices at checkout', () => {
  it('the advance is rounded up to the rupee, as the server does', () => {
    expect(advanceOf(6082, 25)).toBe(1521);
    expect(advanceOf(6082, 100)).toBe(6082);
    expect(advanceOf(1000, 25)).toBe(250);
  });
  it('cards read like the design: pay later is ₹0, 25% shows the advance, 100% the total', () => {
    expect(choiceText({ id: 'later', percent: 0, recommended: false }, 6082)).toMatchObject({ title: 'Book Now, Pay Later', amount: 0 });
    expect(choiceText({ id: 'part', percent: 25, recommended: true }, 6082)).toMatchObject({ title: 'Pay 25% Now', subtitle: 'Pay the remaining 75% after your trip', amount: 1521, label: 'Pay Now (25%)' });
    expect(choiceText({ id: 'full', percent: 100, recommended: false }, 6082)).toMatchObject({ title: 'Pay 100% Now', amount: 6082, label: 'Total Payable' });
  });
  it('an older server (no list) still gets pay later, plus pay in full when online is on', () => {
    expect(checkoutChoices({ online: false, methods: [] }).map((c) => c.id)).toEqual(['later']);
    expect(checkoutChoices({ online: true, methods: [] }).map((c) => c.id)).toEqual(['later', 'full']);
    expect(checkoutChoices({ online: true, methods: [], choices: [{ id: 'part', percent: 30, recommended: true }] }).map((c) => c.id)).toEqual(['part']);
  });
});
