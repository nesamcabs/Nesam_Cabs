const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { summarizePayments, legacyPaymentField } = require('../lib/domain/bookingFlow');
const { partnerOf, walletTotals, payoutLedgerStatus } = require('../lib/domain/finance');
const { netSettlement } = require('../lib/settlement');
const { handleRazorpayEvent, razorpayWebhookValid } = require('../lib/payments');
const { db } = require('../lib/admin');

const receipt = (amount, collectorType, extra = {}) => ({ amount, collectorType, method: 'UPI', kind: 'partial', status: 'Success', ...extra });
const booking = (summary, partnerType = 'driver') => ({ status: 'Completed', finance: { schema: 1, partnerType, partnerId: 'partner', partnerPayout: 800, paymentMethod: 'UPI' }, paymentSummary: summary });
const entry = (type, direction, netAmount, status) => ({ schema: 2, type, direction, netAmount, status });

test('company advance plus driver UPI correctly reduces the settlement', () => {
  const summary = summarizePayments(1000, [receipt(400, 'admin'), receipt(600, 'driver')]);
  assert.equal(summary.totalPaid, 1000);
  assert.equal(summary.companyCollected, 400);
  assert.equal(summary.partnerCashHeld, 600);
  assert.equal(netSettlement(booking(summary)).net, 200);
  assert.equal(netSettlement(booking(summary)).ready, true);
});

test('fleet trip belongs to vendor, independent trip belongs to driver', () => {
  assert.deepEqual(partnerOf({ assignedVendorId: 'fleet', assignedDriverId: 'employee' }), { type: 'vendor', id: 'fleet' });
  assert.deepEqual(partnerOf({ assignedDriverId: 'owner' }), { type: 'driver', id: 'owner' });
});

test('failed and voided receipts do not settle or release earnings', () => {
  const summary = summarizePayments(1000, [receipt(1000, 'system', { status: 'Failed' }), receipt(1000, 'admin', { status: 'Voided' })]);
  assert.equal(summary.totalPaid, 0);
  assert.equal(legacyPaymentField(summary), 'Pending');
  assert.equal(netSettlement(booking(summary)).ready, false);
});

test('partner-held overcollection creates debt, not a second payout', () => {
  const n = netSettlement(booking(summarizePayments(1000, [receipt(1000, 'vendor')]), 'vendor'));
  assert.equal(n.net, -200);
});

test('reserved withdrawal consumes available funds; cancellation releases them', () => {
  const earnings = entry('trip_earning', 'credit', 800, 'available');
  const payout = entry('payout', 'debit', 800, 'reserved');
  assert.equal(walletTotals([earnings, payout]).available, 0);
  assert.equal(walletTotals([earnings, { ...payout, status: payoutLedgerStatus('Paid') }]).available, 0);
  assert.equal(walletTotals([earnings, { ...payout, status: payoutLedgerStatus('Rejected') }]).available, 800);
});

test('refund pending blocks release; completed full refund has no payable balance', () => {
  const receipts = [receipt(1000, 'system')];
  assert.equal(netSettlement(booking(summarizePayments(1000, receipts, { status: 'Processing', amount: 1000 }))).ready, false);
  assert.equal(summarizePayments(0, receipts, { status: 'Completed', amount: 1000 }).status, 'Refunded');
});

test('webhook signatures reject tampering', () => {
  const body = '{"event":"payment.captured"}';
  const secret = 'test-webhook-secret';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(razorpayWebhookValid(body, signature, secret), true);
  assert.equal(razorpayWebhookValid(body + ' ', signature, secret), false);
});

test('captured webhook rejects wrong currency, noncaptured status and invalid amounts before recording', async () => {
  const original = db.collectionGroup;
  db.collectionGroup = () => ({ where: () => ({ limit: () => ({ get: async () => ({ empty: false, docs: [{ data: () => ({ bookingId: 'booking', amountPaise: 10000 }) }] }) }) }) });
  try {
    for (const patch of [{ currency: 'USD' }, { status: 'authorized' }, { amount: -1 }, { amount: 1.5 }]) {
      const result = await handleRazorpayEvent({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', status: 'captured', currency: 'INR', amount: 10000, ...patch } } } });
      assert.equal(result.handled, false);
      assert.equal(result.detail, 'invalid captured payment');
    }
  } finally { db.collectionGroup = original; }
});
