// Captured wallet payments must settle even when the checkout callback never returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('./helpers.e2e');
const { handleRazorpayEvent } = require('../lib/payments');

test('wallet webhook recovers capture, rejects wrong money, and credits an order once', async () => {
  const orderId = `order_wallet_${Date.now()}`;
  const partyId = `webhook_vendor_${Date.now()}`;
  await db.doc(`vendors/${partyId}`).set({ status: 'APPROVED', companyName: 'Webhook test' });
  await db.doc(`wallet_recharges/${orderId}`).set({ orderId, partyType: 'vendor', partyId, amount: 500, amountPaise: 50000, currency: 'INR', status: 'created' });
  const event = (id, patch = {}) => ({ event: 'payment.captured', payload: { payment: { entity: { id, order_id: orderId, status: 'captured', currency: 'INR', amount: 50000, ...patch } } } });
  for (const patch of [{ amount: 1 }, { currency: 'USD' }, { status: 'authorized' }]) {
    assert.equal((await handleRazorpayEvent(event('pay_invalid', patch))).handled, false);
  }
  assert.equal((await db.doc(`wallet_recharges/${orderId}`).get()).data().status, 'created');
  assert.equal((await handleRazorpayEvent(event(`pay_${orderId}`))).handled, true);
  // A redelivery and even a different captured payment must not credit one order twice.
  await handleRazorpayEvent(event(`pay_${orderId}`));
  await handleRazorpayEvent(event(`pay_other_${orderId}`));
  const ledger = await db.collection('wallet_ledger').where('rechargeOrderId', '==', orderId).get();
  assert.equal(ledger.size, 1);
  assert.equal(ledger.docs[0].data().netAmount, 500);
  assert.equal((await db.doc(`wallets/vendor_${partyId}`).get()).data().available, 500);
  assert.equal((await db.doc(`wallet_recharges/${orderId}`).get()).data().status, 'credited');
});

test.after(async () => { await db.terminate(); });
