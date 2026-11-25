// Automatic GST documents against the Firestore emulator (npm run test:e2e:gst).
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, TS } = require('./helpers.e2e');
const { syncGstDocuments, sweepGstReview, generateGstDocuments } = require('../lib/gstDocuments');

const run = `g${Date.now().toString(36)}`;
const now = Date.now();
const booking = (over = {}) => ({
  bookingId: over.bookingId ?? `B-${Math.random().toString(36).slice(2, 8)}`, status: 'Completed', service: 'One Way', customer: 'Kumar', customerName: 'Kumar', customerId: `${run}_c`,
  pickup: 'Erode', pickupAddress: 'Erode, Tamil Nadu 638001, India', drop: 'Salem', fare: 1050, fareBreakdown: { baseFare: 1000, taxableAmount: 1000, gst: 50, gstRate: 0.05, total: 1050 },
  completedAt: TS.fromMillis(now - 3600000), ...over,
});
const make = async (id, over, payments = []) => {
  await db.doc(`bookings/${id}`).set(booking({ bookingId: id, ...over }));
  for (const p of payments) await db.doc(`bookings/${id}/payment_transactions/${p.id}`).set({ status: 'Success', method: 'Cash', paymentDate: TS.fromMillis(now - 7200000), ...p });
};
const invoicesOf = async (id) => (await db.collection('invoices').where('bookingDocumentId', '==', id).get()).docs.map((d) => d.data());
const receiptsOf = async (id) => (await db.collection('gst_receipts').where('bookingDocumentId', '==', id).get()).docs.map((d) => d.data());

test('a trip is held until company and tax approval exist, then billed once by the sweep', async () => {
  await make(`${run}_a`, {}, [{ id: 't1', amount: 500 }]);
  const held = await syncGstDocuments(`${run}_a`);
  assert.equal(held.invoices + held.receipts, 0);
  assert.match((await db.doc(`gst_review/${run}_a`).get()).data().reason, /Settings → Company/);

  await db.doc('settings/config').set({ companyName: 'Nesam Cabs', gst: '33ABCDE1234F1Z5', address: 'Erode, Tamil Nadu' });
  await db.doc('settings/tax_policy').set({ approved: true, reference: 'CA/26', services: { 'One Way': { classification: 'Passenger transportation', sac: '996412' }, 'Local Pickup & Drop': { classification: 'Passenger transportation', sac: '996412' } } });
  await sweepGstReview();
  const [inv] = await invoicesOf(`${run}_a`);
  assert.match(inv.invoiceNumber, /^NES\/\d\d-\d\d\/\d{6}$/);
  assert.equal(inv.grandTotal, 1050);
  assert.equal(inv.cgst + inv.sgst, 50);
  assert.equal(inv.paymentStatus, 'Partially Paid');
  assert.equal((await db.doc(`bookings/${run}_a`).get()).data().invoiceId, inv.id);
  const [voucher] = await receiptsOf(`${run}_a`);
  assert.equal(voucher.documentType, 'Receipt voucher');
  assert.equal(voucher.totalTax, 23.81);
  assert.equal((await db.doc(`gst_review/${run}_a`).get()).exists, false);

  await Promise.all([syncGstDocuments(`${run}_a`), syncGstDocuments(`${run}_a`), syncGstDocuments(`${run}_a`)]);
  assert.equal((await invoicesOf(`${run}_a`)).length, 1);
  assert.equal((await receiptsOf(`${run}_a`)).length, 1);
});

test('many trips settled together get consecutive numbers with no gaps or repeats', async () => {
  const ids = [1, 2, 3, 4, 5, 6].map((n) => `${run}_n${n}`);
  for (const id of ids) await make(id, {});
  await Promise.all(ids.map((id) => syncGstDocuments(id)));
  const numbers = (await Promise.all(ids.map(invoicesOf))).map((r) => Number(r[0].invoiceNumber.slice(-6))).sort((a, b) => a - b);
  assert.deepEqual(numbers, numbers.map((_, i) => numbers[0] + i));
});

test('payment after the trip, a voided payment, and approved extras added later', async () => {
  const id = `${run}_b`;
  await make(id, {});
  await syncGstDocuments(id);
  await db.doc(`bookings/${id}/payment_transactions/t2`).set({ status: 'Success', method: 'UPI', amount: 1050, paymentDate: TS.fromMillis(Date.now()) });
  await db.doc(`bookings/${id}`).update({ extraCharges: { status: 'approved', revision: 1, gstRate: 0.05, taxTreatment: 'tariff_gst', customer: { waitingPaise: 10000, hillPaise: 0, carrierPaise: 0, subtotalPaise: 10000, gstPaise: 500 } } });
  await syncGstDocuments(id);
  await syncGstDocuments(id);
  const docs = await invoicesOf(id);
  assert.equal(docs.length, 2);
  const debit = docs.find((d) => d.documentType === 'Debit note');
  assert.equal(debit.grandTotal, 105);
  assert.equal(debit.originalInvoiceNumber, docs.find((d) => d !== debit).invoiceNumber);
  const [receipt] = await receiptsOf(id);
  assert.equal(receipt.documentType, 'Payment receipt');
  assert.equal(receipt.totalTax, 0);
  await db.doc(`bookings/${id}/payment_transactions/t2`).update({ status: 'Voided', voidReason: 'Entered twice by mistake' });
  await syncGstDocuments(id);
  assert.equal((await receiptsOf(id))[0].invoiceStatus, 'Cancelled');
});

test('a voided invoice is not silently reissued; old trips wait for the office', async () => {
  const id = `${run}_c1`;
  await make(id, {});
  await syncGstDocuments(id);
  const [inv] = await invoicesOf(id);
  await db.doc(`invoices/${inv.id}`).update({ invoiceStatus: 'Cancelled' });
  await db.doc(`bookings/${id}`).update({ invoiceId: '' });
  assert.match((await syncGstDocuments(id, { manual: true })).review, /voided/);
  assert.equal((await invoicesOf(id)).length, 1);

  const old = `${run}_old`;
  await make(old, { completedAt: TS.fromMillis(now - 45 * 86400000) });
  assert.match((await syncGstDocuments(old)).review, /30 days/);
  assert.equal((await syncGstDocuments(old, { manual: true })).invoices, 1);
});

test('cancellation: charge billed, refund voucher issued; pending extras and unknown state are held', async () => {
  const id = `${run}_x`;
  await make(id, { status: 'Cancelled', completedAt: null, cancellation: { charge: 200, at: TS.fromMillis(now - 1000) }, refund: { status: 'Completed', amount: 300, method: 'UPI', reference: 'R1' } }, [{ id: 't1', amount: 500 }]);
  const r = await syncGstDocuments(id);
  assert.equal(r.invoices, 1);
  assert.equal(r.receipts, 2);
  assert.equal((await invoicesOf(id))[0].grandTotal, 200);
  assert.deepEqual((await receiptsOf(id)).map((x) => x.documentType).sort(), ['Receipt voucher', 'Refund voucher']);

  await make(`${run}_p`, { extraUsage: { status: 'submitted' } });
  assert.match((await syncGstDocuments(`${run}_p`)).review, /waiting for approval/);
  await make(`${run}_u`, { pickup: 'Bus stand', pickupAddress: 'Bus stand' });
  assert.match((await syncGstDocuments(`${run}_u`)).review, /place of supply/);
});

test('the office button needs finance access and walks everything', async () => {
  await db.doc(`admins/${run}_boss`).set({ role: 'admin', staffRole: 'super_admin', status: 'active' });
  await make(`${run}_late`, { completedAt: TS.fromMillis(now - 90 * 86400000) });
  await assert.rejects(() => generateGstDocuments.run({ data: {}, auth: { uid: `${run}_nobody`, token: {} } }));
  let cursor = {}, out;
  do { out = await generateGstDocuments.run({ data: cursor, auth: { uid: `${run}_boss`, token: {} } }); cursor = { phase: out.phase, after: out.after }; } while (!out.done);
  assert.equal((await invoicesOf(`${run}_late`)).length, 1);
});
