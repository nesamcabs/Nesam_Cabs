const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const G = require('../lib/domain/gstInvoice');

const company = G.companyFromSettings({ companyName: 'Nesam', gst: '33abcde1234f1z5', address: 'Erode' });
const policy = { approved: true, reference: 'CA/1', services: { 'One Way': { classification: 'Passenger transportation', sac: '996412' } } };
const nobody = { name: 'Customer', phone: '', email: '', address: '', gstin: '', state: '' };

test('document numbers fit 16 characters and restart with the financial year', () => {
  for (const series of ['invoice', 'debit', 'receipt', 'payment', 'refund']) assert.ok(G.documentNumber(series, '26-27', 999999).length <= 16);
  assert.equal(G.documentNumber('invoice', '26-27', 1), 'NES/26-27/000001');
  assert.throws(() => G.documentNumber('invoice', '26-27', 1000000));
  assert.equal(G.financialYear('2027-03-31'), '26-27');
  assert.equal(G.financialYear('2027-04-01'), '27-28');
  // 31 Mar 20:00 UTC is already 1 April in India.
  assert.equal(G.istIsoDate(Date.parse('2027-03-31T20:00:00Z')), '2027-04-01');
});

test('the state is read from the end of an address, never from a street name', () => {
  assert.equal(G.stateFromAddress('12 Perundurai Road, Erode, Tamil Nadu 638001, India'), '33');
  assert.equal(G.stateFromAddress('Beach Road, Pondicherry 605001'), '34');
  assert.equal(G.stateFromAddress('Kerala Street, Pollachi, Tamilnadu'), '33');
  assert.equal(G.stateFromAddress('Delhi Road, Gurugram, Haryana'), '06');
  assert.equal(G.stateFromAddress('Goa Road, Hubli'), '');
  assert.equal(G.stateFromAddress('Erode Bus Stand'), '');
});

test('tax is determined from the boarding state, or the GSTIN of a registered customer', () => {
  const base = { company, policy, service: 'One Way', recipient: nobody, boardingState: '33' };
  assert.equal(G.determineTax(base).tax.split, 'CGST + SGST');
  assert.equal(G.determineTax({ ...base, boardingState: '29' }).tax.split, 'IGST');
  const registered = G.determineTax({ ...base, recipient: { ...nobody, gstin: '29ABCDE1234F1Z5' } });
  assert.equal(registered.tax.placeOfSupply, '29');
});

test('nothing is issued on a guess', () => {
  const base = { company, policy, service: 'One Way', recipient: nobody, boardingState: '33' };
  assert.match(G.determineTax({ ...base, boardingState: '' }).reason, /place of supply/);
  assert.match(G.determineTax({ ...base, policy: undefined }).reason, /Tax automation/);
  assert.match(G.determineTax({ ...base, company: { ...company, gstin: '' } }).reason, /GSTIN/);
  assert.match(G.determineTax({ ...base, service: 'Cargo' }).reason, /no tax classification/);
  assert.match(G.determineTax({ ...base, saved: { split: 'IGST' } }).reason, /differs/);
});

test('an automatic invoice has the same lines as one issued by hand in the admin', () => {
  const load = require('./adminServiceLoader.cjs')({});
  const admin = load('src/services/invoiceService.ts');
  const booking = {
    fare: 1990, pickup: 'Chennai', drop: 'Pondicherry', service: 'One Way', tollCharges: 120,
    fareBreakdown: { baseFare: 1400, driverAllowance: 100, taxableAmount: 1500, gst: 75, gstRate: 0.05, addOns: {} },
    extraCharges: { status: 'approved', taxTreatment: 'tariff_gst', customer: { waitingPaise: 20000, hillPaise: 0, carrierPaise: 0, subtotalPaise: 20000, gstPaise: 1000 } },
  };
  booking.fare = 1575;
  const server = G.buildInvoiceLines(booking, '9964', 'CGST + SGST');
  const client = admin.buildInvoiceLines(booking);
  for (const key of ['items', 'subtotal', 'discount', 'taxableAmount', 'cgst', 'sgst', 'igst', 'utgst', 'totalTax', 'tolls', 'grandTotal']) assert.deepEqual(server[key], client[key], key);
  assert.equal(server.grandTotal, Math.round((server.taxableAmount + server.totalTax + server.tolls) * 100) / 100);
});

test('an advance shows the tax inside the amount', () => {
  const r = G.splitInclusive(500, 0.05, 'IGST');
  assert.equal(r.taxableAmount, 476.19);
  assert.equal(r.igst, 23.81);
  assert.equal(r.grandTotal, 500);
});
