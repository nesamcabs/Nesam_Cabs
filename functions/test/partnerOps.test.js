// Partner duty cancellation quote and assignment deadline (client reference: ₹0 within 4 h of accepting,
// ₹500 after that, ₹1,000 within 4 h of pickup — the last-minute rule takes priority).
// Run: npm run build && node --test test/partnerOps.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/partnerOps');

const H = 3600000;
const pickup = Date.parse('2026-10-25T10:00:00+05:30');

test('cancellation: free within the acceptance grace period', () => {
  const accepted = pickup - 48 * H;
  const q = P.cancellationQuote(pickup, accepted, accepted + 3 * H);
  assert.equal(q.amount, 0);
  assert.equal(q.rule, 'grace');
});

test('cancellation: ₹500 after the grace period when pickup is more than 4 hours away', () => {
  const accepted = pickup - 48 * H;
  const q = P.cancellationQuote(pickup, accepted, accepted + 5 * H);
  assert.equal(q.amount, 500);
  assert.equal(q.rule, 'after_grace');
});

test('cancellation: ₹1,000 within 4 hours of pickup, even inside the grace period', () => {
  const accepted = pickup - 5 * H;
  assert.equal(P.cancellationQuote(pickup, accepted, pickup - 3 * H).amount, 1000);
  assert.equal(P.cancellationQuote(pickup, accepted, pickup - 4 * H).rule, 'last_minute');
});

test('cancellation policy: office settings override, invalid values fall back to the published policy', () => {
  const p = P.cancellationPolicyOf({ partnerCancellation: { lastMinuteHours: 6, lastMinuteCharge: 1500, graceHours: -1, afterGraceCharge: 'x' } });
  assert.deepEqual(p, { lastMinuteHours: 6, lastMinuteCharge: 1500, graceHours: 4, afterGraceCharge: 500 });
  assert.deepEqual(P.cancellationPolicyOf(undefined), P.DEFAULT_CANCELLATION_POLICY);
});

test('assign-by: 2 hours after acceptance, but at least 1 hour before pickup', () => {
  const accepted = pickup - 48 * H;
  assert.equal(P.assignByFor(accepted, pickup, {}), accepted + 2 * H);
  const late = pickup - 2.5 * H;
  assert.equal(P.assignByFor(late, pickup, {}), pickup - 1 * H);
  // Urgent: accepted 30 minutes before pickup → must be assigned by pickup, never after it.
  const urgent = pickup - 0.5 * H;
  assert.equal(P.assignByFor(urgent, pickup, {}), pickup);
  assert.equal(P.assignByFor(accepted, null, { vendorAssignmentWindowHours: 3 }), accepted + 3 * H);
});
