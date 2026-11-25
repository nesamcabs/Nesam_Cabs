const test = require('node:test');
const assert = require('node:assert/strict');
const { dutyTermsOf } = require('../lib/marketplace');

const booking = { pricing: { extraKmRatePaise: 1809, partner: { ratePaise: 1250 } } };
const items = { driverBata: 'Included', toll: 'At actuals' };

test('Publish duty: the extra-km rates come from the booking tariff, not from the form', () => {
  const t = dutyTermsOf({ items, receiptRequired: true }, booking);
  assert.equal(t.customerExtraKm, 18.09);
  assert.equal(t.partnerExtraKm, 12.5);
  assert.equal(t.items.driverBata, 'Included');
  assert.equal(t.items.parking, 'At actuals');      // unspecified terms default to at actuals
  assert.equal(t.receiptRequired, true);
});

test('Publish duty: a rate sent by an older client is kept, but must be sane', () => {
  assert.equal(dutyTermsOf({ customerExtraKm: 20, partnerExtraKm: 15, items }, booking).customerExtraKm, 20);
  assert.throws(() => dutyTermsOf({ customerExtraKm: 5000, items }, booking), /too high/);
});

test('Publish duty: a booking with no saved rate publishes without one instead of failing', () => {
  const t = dutyTermsOf({ items }, { pricing: {} });
  assert.equal('customerExtraKm' in t, false);
  assert.equal('partnerExtraKm' in t, false);
  assert.equal(dutyTermsOf(null, booking), null);   // no terms at all: nothing stored
});
