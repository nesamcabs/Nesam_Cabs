// Pure rules behind the Master Admin command desk: the hourly offer schedule and the order bids are decided in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduledOffer, rankPendingBids } = require('../lib/domain/offerSchedule');

test('offer schedule: start at hour 0, +5% compounded per whole hour, rounded to the rupee, never above the cap', () => {
  // The reference sample: ₹1,750 start, ₹2,050 cap.
  assert.equal(scheduledOffer(1750, 5, 2050, 0), 1750);
  assert.equal(scheduledOffer(1750, 5, 2050, 1), 1838); // 1837.5 rounds up
  assert.equal(scheduledOffer(1750, 5, 2050, 2), 1929); // 1929.375
  assert.equal(scheduledOffer(1750, 5, 2050, 3), 2026); // 2025.84
  assert.equal(scheduledOffer(1750, 5, 2050, 4), 2050); // 2127.1 capped
  assert.equal(scheduledOffer(1750, 5, 2050, 40), 2050);
});

test('offer schedule: a start above the cap is never reduced by the schedule at hour 0, and no cap means uncapped', () => {
  assert.equal(scheduledOffer(2100, 5, 2050, 0), 2100);
  assert.equal(scheduledOffer(1000, 5, 0, 2), 1103);
});

test('bid ranking: lowest first, ties go to the earlier bid then the lower id, and only bids under review count', () => {
  const bids = [
    { id: 'vendor_b', status: 'Pending Review', amount: 1750, submittedAtMs: 2000 },
    { id: 'vendor_a', status: 'Pending Review', amount: 1750, submittedAtMs: 1000 },
    { id: 'vendor_c', status: 'Pending Review', amount: 1840, submittedAtMs: 500 },
    { id: 'vendor_d', status: 'Rejected', amount: 1000, submittedAtMs: 1 },
    { id: 'vendor_e', status: 'Withdrawn', amount: 900, submittedAtMs: 1 },
    { id: 'vendor_f', status: 'Pending Review', amount: 0, submittedAtMs: 1 },
    { id: 'vendor_g', status: 'Pending Review', amount: NaN, submittedAtMs: 1 },
  ];
  assert.deepEqual(rankPendingBids(bids).map((b) => b.id), ['vendor_a', 'vendor_b', 'vendor_c']);
  // Same amount and same time: the lower id wins, every time.
  const tie = [{ id: 'z', status: 'Pending Review', amount: 5, submittedAtMs: 1 }, { id: 'a', status: 'Pending Review', amount: 5, submittedAtMs: 1 }];
  assert.equal(rankPendingBids(tie)[0].id, 'a');
  assert.deepEqual(rankPendingBids([]), []);
});
