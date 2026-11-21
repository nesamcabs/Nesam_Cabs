const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../lib/customerDirectory');

test('phoneKey reads formatted, unformatted and +91 numbers the same way', () => {
  for (const v of ['+91 98765 43210', '9876543210', '+919876543210', '91-98765-43210', '098765 43210']) assert.equal(d.phoneKey(v), '9876543210', v);
  assert.equal(d.phoneKey('12345'), '');
  assert.equal(d.phoneKey(undefined), '');
});

test('the masked form matches the reference and never carries the last five digits', () => {
  assert.equal(d.maskCustomerPhone('+91 98765 43210'), '+91 98765 •••••');
  assert.ok(!d.maskCustomerPhone('9876543210').includes('43210'));
  assert.equal(d.maskCustomerPhone(''), '');
  assert.equal(d.formatCustomerPhone('9876543210'), '+91 98765 43210');
});

test('phoneVariants covers every spelling an older record may hold', () => {
  const v = d.phoneVariants('9876543210');
  for (const s of ['+91 98765 43210', '+919876543210', '9876543210', '919876543210']) assert.ok(v.includes(s), s);
  assert.ok(v.length <= 10, 'Firestore "in" allows at most 10 values');
});

test('brandOf recognises recorded brands and never guesses for older bookings', () => {
  assert.equal(d.brandOf('People Taxi'), 'people_taxi');
  assert.equal(d.brandOf('people_taxi'), 'people_taxi');
  assert.equal(d.brandOf('onewaycarrentals'), 'onewaycarrentals');
  assert.equal(d.brandOf('One Way Car Rentals'), 'onewaycarrentals');
  assert.equal(d.brandOf('nesam'), 'nesam');
  for (const v of ['', undefined, null, 'customer', 'admin', 'Phone']) assert.equal(d.brandOf(v), '', String(v));
});

test('the directory projection never contains a raw number and handles legacy fields', () => {
  const row = d.projectCustomer('abcdef123456', { name: 'Old Customer', phone: '+91 98765 43210', email: 'N/A', status: 'Approved', bookings: 99, spent: 1e6 });
  assert.equal(row.phone, '');
  assert.equal(row.phoneMasked, '+91 98765 •••••');
  assert.equal(row.hasPhone, true);
  assert.equal(row.email, '');
  assert.equal(row.customerCode, 'NSM-CU-ABCDEF');
  assert.deepEqual(row.brands, []);
  assert.ok(!JSON.stringify(row).includes('43210'));
  assert.ok(!('bookings' in row) && !('spent' in row), 'stale counters are not part of the projection');
  assert.equal(d.projectCustomer('x1', { customerCode: 'NSM-CU-CUSTOM', phone: '' }).hasPhone, false);
  assert.equal(d.projectCustomer('x1', { customerCode: 'NSM-CU-CUSTOM' }).customerCode, 'NSM-CU-CUSTOM');
});

test('a failed audit write withholds the value and a good one releases it', async () => {
  let logged = 0;
  assert.equal(await d.releaseAfterAudit(async () => { logged++; }, '+91 98765 43210'), '+91 98765 43210');
  assert.equal(logged, 1);
  await assert.rejects(d.releaseAfterAudit(async () => { throw new Error('firestore down'); }, '+91 98765 43210'), (e) => e.code === 'unavailable' && !String(e.message).includes('98765'));
});

test('viewer rights: Master all; a Staff ID only what its matrix grants; export is Master-only', () => {
  const matrix = (modules, privacy = {}) => ({ modules, accountControls: {}, bankLimit: 0, sensitive: {}, privacy, fleetSwap: {}, partnerRights: {} });
  const staff = (m) => ({ uid: 's', name: 'Staff', kind: 'staff', isSuper: false, permissions: [], duty: [], matrix: m });
  const master = d.viewerOf({ uid: 'm', name: 'M', kind: 'master', isSuper: true, permissions: [], duty: [], matrix: matrix({}) });
  assert.deepEqual([master.canView, master.canCreate, master.canEdit, master.canReveal, master.canExport], [true, true, true, true, true]);
  const viewOnly = d.viewerOf(staff(matrix({ Customers: ['view'] })));
  assert.deepEqual([viewOnly.canView, viewOnly.canCreate, viewOnly.canEdit, viewOnly.canReveal, viewOnly.canExport], [true, false, false, false, false]);
  const reveal = d.viewerOf(staff(matrix({ Customers: ['view', 'edit', 'export'] }, { temporaryReveal: true })));
  assert.deepEqual([reveal.canEdit, reveal.canReveal, reveal.canExport], [true, true, false], 'the Customers export right does not make a Staff ID an exporter');
  assert.equal(d.viewerOf(staff(matrix({}, { temporaryReveal: true }))).canReveal, false, 'the reveal right alone, without Customers view, grants nothing');
});
