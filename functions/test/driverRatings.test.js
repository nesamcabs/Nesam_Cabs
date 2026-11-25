// Driver ratings at the end of a trip: what a valid rating is, and what a low rating must carry.
// Run: npm run build && node --test test/driverRatings.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/domain/ratingPolicy');

const problem = (raw) => { try { P.cleanRating(raw); return null; } catch (e) { return e instanceof P.RatingProblem ? e.message : `other: ${e}`; } };

test('the low-rating line is 2 stars or fewer', () => {
  assert.equal(P.LOW_RATING_MAX, 2);
  assert.deepEqual([1, 2, 3, 4, 5].map(P.isLowRating), [true, true, false, false, false]);
  assert.equal(P.isLowRating(0), false);
  assert.equal(P.isLowRating(1.5), false);
});

test('a good rating needs only the stars; tags and comment are optional and trimmed', () => {
  const c = P.cleanRating({ stars: 5 });
  assert.equal(c.stars, 5);
  assert.equal(c.low, false);
  assert.deepEqual(c.tags, []);
  const d = P.cleanRating({ rating: 4, tags: ['Clean car', 'Clean car', '  On time  ', ''], comment: '  Smooth ride  ' });
  assert.deepEqual(d.tags, ['Clean car', 'On time']);
  assert.equal(d.comment, 'Smooth ride');
});

test('stars must be a whole number from 1 to 5', () => {
  for (const bad of [0, 6, 4.5, -1, '5', null, undefined, NaN]) {
    assert.match(problem({ stars: bad }) ?? '', /1 and 5 stars/, `stars=${String(bad)}`);
  }
  assert.match(problem(undefined) ?? '', /1 and 5 stars/);
  assert.match(problem('nope') ?? '', /1 and 5 stars/);
});

test('a low rating must give a listed reason and feedback', () => {
  assert.match(problem({ stars: 1 }) ?? '', /choose a reason/);
  assert.match(problem({ stars: 2, reason: 'Because' , feedback: 'it was bad'}) ?? '', /choose a reason/);
  assert.match(problem({ stars: 1, reason: 'Rash or unsafe driving' }) ?? '', /describe what happened/);
  assert.match(problem({ stars: 1, reason: 'Rash or unsafe driving', feedback: '   ok ' }) ?? '', /describe what happened/);
  assert.equal(problem({ stars: 1, reason: 'Rash or unsafe driving', feedback: 'Overtook on a blind curve twice' }), null);
});

test('improvements are optional on a low rating, and everything is capped', () => {
  const c = P.cleanRating({ stars: 2, reason: 'Other', feedback: 'x'.repeat(2000), improvements: 'y'.repeat(2000), tags: Array.from({ length: 20 }, (_, i) => `tag${i}`) });
  assert.equal(c.low, true);
  assert.equal(c.feedback.length, 600);
  assert.equal(c.improvements.length, 600);
  assert.equal(c.tags.length, 8);
  assert.equal(P.cleanRating({ stars: 2, reason: 'Other', feedback: 'Not great at all' }).improvements, '');
});

test('a good rating drops any reason / feedback sent with it', () => {
  const c = P.cleanRating({ stars: 4, reason: 'Other', feedback: 'ignored', improvements: 'ignored' });
  assert.equal(c.reason, '');
  assert.equal(c.feedback, '');
  assert.equal(c.improvements, '');
});

test('control characters are stripped from text', () => {
  const c = P.cleanRating({ stars: 1, reason: 'Other', feedback: 'bad\u0000\u0007 ride' });
  assert.equal(c.feedback, 'bad ride');
});

test('the stored comment line reads well for both kinds of rating', () => {
  assert.equal(P.summaryText(P.cleanRating({ stars: 5, tags: ['On time'], comment: 'Great' })), 'On time — Great');
  assert.equal(
    P.summaryText(P.cleanRating({ stars: 1, reason: 'Late pickup or late arrival', feedback: 'Waited 40 minutes', improvements: 'Call before leaving' })),
    'Late pickup or late arrival — Waited 40 minutes — Improve: Call before leaving',
  );
});

test('the running average counts each rating once, rounded to two decimals', () => {
  assert.deepEqual(P.nextAverage(undefined, undefined, 5), { rating: 5, ratingCount: 1 });
  assert.deepEqual(P.nextAverage(4, 1, 2), { rating: 3, ratingCount: 2 });
  assert.deepEqual(P.nextAverage(4.5, 10, 1), { rating: 4.18, ratingCount: 11 });
  assert.deepEqual(P.nextAverage('x', 'y', 3), { rating: 3, ratingCount: 1 });
});

test('follow-up statuses are the four the office uses', () => {
  assert.deepEqual([...P.FOLLOW_UP_STATUSES], ['New', 'In review', 'Resolved', 'Dismissed']);
});

test('every reason is short enough to be a chip and the list ends with Other', () => {
  assert.ok(P.RATING_REASONS.length >= 6);
  assert.equal(P.RATING_REASONS[P.RATING_REASONS.length - 1], 'Other');
  for (const r of P.RATING_REASONS) assert.ok(r.length <= 60);
});

test('the server exposes rateDriver and reviewDriverRating to the HTTP API', () => {
  const { CALLABLES } = require('../lib/registry');
  assert.ok(CALLABLES.rateDriver, 'rateDriver');
  assert.ok(CALLABLES.reviewDriverRating, 'reviewDriverRating');
});
