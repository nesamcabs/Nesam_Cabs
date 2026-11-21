// Customers Directory rules (admin/src/domain/customerDirectory.ts, services/customerStats.ts): run with `npm run test:customers` in admin/.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require(path.resolve(__dirname, '../functions/test/adminServiceLoader.cjs'))({});
const D = load('src/domain/customerDirectory.ts');
const S = load('src/services/customerStats.ts');
const X = load('src/utils/exportData.ts');

const cust = (id, over = {}) => ({ id, name: id, phone: '', phoneMasked: '+91 98765 •••••', email: '', status: 'Active', ...over });
const stats = (over = {}) => ({ total: 0, completed: 0, cancelled: 0, paid: 0, outstanding: 0, spend: 0, lastBookingAt: null, lastCompletedAt: null, ...over });
const row = (c, s = {}) => ({ c, s: stats(s) });
const done = (id, over = {}) => ({ id, status: 'Completed', fare: 1000, tollCharges: 0, pickup: 'A', drop: 'B', ...over });

test('status aliases: Approved/empty are active, Blocked is blocked, other states are shown as they are', () => {
  for (const s of ['Active', 'active', 'Approved', 'APPROVED', '', undefined]) assert.equal(D.isActiveStatus(s), true, String(s));
  assert.equal(D.isBlockedStatus('Blocked'), true);
  assert.equal(D.isBlockedStatus('Approved'), false);
  assert.equal(D.isActiveStatus('Pending'), false);
  assert.equal(D.isBlockedStatus('Pending'), false);
  assert.equal(D.statusLabel('Approved'), 'Active');
  assert.equal(D.statusLabel('Pending'), 'Pending');
  assert.equal(D.STATUS_ACTIVE, 'Active');
  assert.equal(D.STATUS_BLOCKED, 'Blocked');
});

test('derived groups: none = New, one or two = Returning, three or more = Regular', () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(D.groupOf), ['New', 'Returning', 'Returning', 'Regular', 'Regular']);
});

test('VIP, corporate, blocked and credit due are separate facts; each customer counts once per segment', () => {
  const corp = row(cust('corp', { isCorporate: true, gstin: '33AABCS8890K1Z2', company: 'Sri Tex' }), { completed: 5, outstanding: 11200 });
  const vip = row(cust('vip', { isVip: true }), { completed: 0 });
  const blocked = row(cust('blk', { status: 'Blocked' }), { completed: 1 });
  const fresh = row(cust('new'));
  const rows = [corp, vip, blocked, fresh];
  const c = D.countSegments(rows);
  assert.deepEqual(c, { All: 4, New: 2, Returning: 1, Regular: 2, Corporate: 1, Due: 1, Blocked: 1 });
  assert.ok(D.inSegment(corp, 'Regular') && D.inSegment(corp, 'Corporate') && D.inSegment(corp, 'Due'), 'a corporate regular rider with dues is in all three');
  assert.equal(D.primaryBadge(corp).label, 'Corporate');
  assert.equal(D.primaryBadge(vip).label, 'VIP');
  assert.equal(D.primaryBadge(row(cust('r'), { completed: 4 })).label, 'Regular');
  assert.equal(D.primaryBadge(blocked).label, 'Returning');
  assert.equal(D.segmentName(corp), 'Corporate');
});

test('KPI totals ignore the list filters and sum real dues', () => {
  const rows = [row(cust('a', { isCorporate: true }), { completed: 4, outstanding: 1200.5 }), row(cust('b'), { outstanding: 100 }), row(cust('c', { isVip: true }))];
  const k = D.computeKpis(rows);
  assert.deepEqual(k, { total: 3, vip: 2, corporate: 1, due: 1300.5, dueAccounts: 2 });
  const filtered = D.filterRows(rows, { q: 'zzz', segment: 'Blocked', brand: 'people_taxi', lookedUp: new Set() });
  assert.equal(filtered.length, 0);
  assert.deepEqual(D.computeKpis(rows), k);
});

test('combined segment + brand + search; alphabetical; unrecorded brand is never guessed', () => {
  const rows = [
    row(cust('c3', { name: 'Zed', brands: ['people_taxi'], city: 'Madurai', leadSource: 'Justdial', customerCode: 'NSM-CU-ZZ1111' }), { completed: 1 }),
    row(cust('c1', { name: 'amy', brands: ['nesam', 'people_taxi'], city: 'Coimbatore', email: 'amy@example.com' }), { completed: 5 }),
    row(cust('c2', { name: 'Bob', brands: [], email: 'N/A' }), { completed: 1 }),
  ];
  const f = (o) => D.filterRows(rows, { q: '', segment: 'All', brand: 'all', lookedUp: new Set(), ...o }).map((r) => r.c.id);
  assert.deepEqual(f({}), ['c1', 'c2', 'c3'], 'sorted by name, case-insensitively');
  assert.deepEqual(f({ brand: 'people_taxi' }), ['c1', 'c3']);
  assert.deepEqual(f({ brand: 'onewaycarrentals' }), [], 'a customer with no recorded brand matches no specific brand');
  assert.deepEqual(f({ segment: 'Returning', brand: 'people_taxi' }), ['c3']);
  assert.deepEqual(f({ q: 'madurai' }), ['c3']);
  assert.deepEqual(f({ q: 'justdial' }), ['c3']);
  assert.deepEqual(f({ q: 'nsm-cu-zz11' }), ['c3']);
  assert.deepEqual(f({ q: 'C2' }), ['c2'], 'legacy document id');
  assert.deepEqual(f({ q: 'amy@' }), ['c1']);
  assert.deepEqual(f({ q: 'n/a' }), [], 'the legacy "N/A" email is not searchable');
  assert.deepEqual(f({ q: '98765' }).length, 3, 'the visible first five digits match');
  assert.deepEqual(f({ q: '9876543210', lookedUp: new Set(['c2']) }), ['c2'], 'a full number matches through the server lookup only');
  assert.deepEqual(f({ q: '12345' }), [], 'hidden digits are not searchable');
});

test('CSV: commas, quotes, line breaks and formula-like text are escaped; numbers stay numbers', () => {
  assert.equal(D.csvCell('plain'), 'plain');
  assert.equal(D.csvCell('a,b'), '"a,b"');
  assert.equal(D.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(D.csvCell('line1\nline2'), '"line1\nline2"');
  assert.equal(D.csvCell('line1\r\nline2'), '"line1\nline2"');
  for (const bad of ['=1+1', '+91 98765 •••••', '-2+3', '@SUM(A1)', '\tcmd']) assert.ok(D.csvCell(bad).replace(/^"/, '').startsWith("'"), bad);
  assert.equal(D.csvCell(12500), '12500');
  assert.equal(D.csvCell(null), '');
  const r = row(cust('c1', { name: '=HYPERLINK("http://x","y")', city: 'A, B', phoneMasked: '+91 98765 •••••' }), { completed: 2, spend: 4500 });
  const csv = D.customersCsv([r], (c) => c.phoneMasked, (c) => `NSM-CU-${c.id}`);
  const [head, line] = csv.split('\n');
  assert.equal(head, 'Customer ID,Name,Mobile,City,Segment,Trips,Total Spend');
  assert.ok(line.startsWith('NSM-CU-c1,"\'=HYPERLINK(""http://x"",""y"")",\'+91 98765 •••••,"A, B",Returning,2,4500'), line);
  // the download path shares the same neutralising
  assert.equal(X.safeCsvText('=1+1'), "'=1+1");
  assert.equal(X.safeCsvText(-5), '-5');
  assert.ok(X.csv(['H'], [['=cmd'], ['x"y']]).includes('"\'=cmd"') && X.csv(['H'], [['x"y']]).includes('"x""y"'));
});

test('loyalty rule: VIP or three completed trips = VIP500 / ₹500, otherwise NESAM250 / ₹250', () => {
  assert.deepEqual(D.offerFor(row(cust('a'), { completed: 3 })), { code: 'VIP500', amount: 500 });
  assert.deepEqual(D.offerFor(row(cust('a', { isVip: true }), { completed: 0 })), { code: 'VIP500', amount: 500 });
  assert.deepEqual(D.offerFor(row(cust('a'), { completed: 2 })), { code: 'NESAM250', amount: 250 });
  const msg = D.loyaltyMessage('Ravi', { code: 'VIP500', amount: 500 });
  assert.ok(msg.includes('*VIP500*') && msg.includes('₹500 OFF') && msg.includes('Hello Ravi'));
});

test('the offer is only presentable when the coupon exists, is active today and gives that amount', () => {
  const o = { code: 'VIP500', amount: 500 };
  const coupon = (over = {}) => ({ id: '1', code: 'vip500', name: 'VIP', status: 'Active', discountType: 'FIXED_AMOUNT', discountValue: 500, validFrom: '2026-01-01', validUntil: '2027-01-01', usedCount: 0, ...over });
  const now = new Date('2026-11-21T10:00:00Z');
  assert.equal(D.checkOfferCoupon(null, o, now).ok, false);
  assert.match(D.checkOfferCoupon([], o, now).message, /not set up/);
  assert.equal(D.checkOfferCoupon([coupon()], o, now).ok, true);
  assert.match(D.checkOfferCoupon([coupon({ status: 'Inactive' })], o, now).message, /inactive/);
  assert.match(D.checkOfferCoupon([coupon({ validUntil: '2026-06-01' })], o, now).message, /expired/);
  assert.match(D.checkOfferCoupon([coupon({ discountValue: 300 })], o, now).message, /₹300, not ₹500/);
  assert.match(D.checkOfferCoupon([coupon({ discountType: 'PERCENTAGE', discountValue: 10 })], o, now).message, /10%/);
});

test('reminder, statement and money use real values with Indian grouping', () => {
  assert.equal(D.inr(1234567.5), '₹12,34,567.5');
  assert.equal(D.inr(0), '₹0');
  assert.equal(D.inr(NaN), '₹0');
  const r = row(cust('c1', { name: 'Ravi' }), { completed: 4, spend: 86400 });
  assert.ok(D.reminderMessage('Ravi', 11200).includes('*₹11,200*'));
  assert.equal(D.statementText(r, 'NSM-CU-C1'), 'NESAM CABS — Customer Statement\nCustomer: Ravi (NSM-CU-C1)\nCompleted Trips: 4\nTotal Spend: ₹86,400');
});

test('company / GSTIN field splits and joins', () => {
  assert.deepEqual(D.splitCompanyGstin('33AABCN1234F1Z5 • Sri Tex Exports'), { gstin: '33AABCN1234F1Z5', company: 'Sri Tex Exports' });
  assert.deepEqual(D.splitCompanyGstin('Sri Tex Exports 33aabcn1234f1z5'), { gstin: '33AABCN1234F1Z5', company: 'Sri Tex Exports' });
  assert.deepEqual(D.splitCompanyGstin('Just A Company'), { gstin: '', company: 'Just A Company' });
  assert.deepEqual(D.splitCompanyGstin(''), { gstin: '', company: '' });
  assert.equal(D.joinCompanyGstin('Sri Tex', '33AABCN1234F1Z5'), '33AABCN1234F1Z5 • Sri Tex');
  assert.equal(D.joinCompanyGstin(undefined, undefined), '');
});

test('ledger: customerId first, then the server link, then an unambiguous mobile; payments come from recorded receipts', () => {
  const customers = [
    { id: 'a', phone: '+91 98765 43210' },
    { id: 'b', phone: '98765 11111', linkedBookingIds: ['lk1'] },
    { id: 'd1', phone: '+919000000000' }, { id: 'd2', phone: '9000000000' },
  ];
  const b = [
    done('1', { customerId: 'a', pickupAt: '2026-11-01T10:00:00Z' }),
    done('2', { customerId: 'a', pickupAt: '2026-11-10T10:00:00Z', paymentSummary: { amountDue: 1000, totalPaid: 400, balanceDue: 600, status: 'Partial' } }),
    done('3', { phone: '9876543210', status: 'Cancelled' }),                // unlinked: matches a by mobile
    done('lk1'),                                                              // unlinked: attributed to b by the server
    done('amb', { phone: '9000000000' }),                                     // two customers share it: nobody
    done('other', { customerId: 'ghost' }),
    done('paid', { customerId: 'b', payment: 'Paid', tollCharges: 50 }),
  ];
  const { stats: st, owned } = S.buildCustomerLedger(customers, b);
  assert.equal(st.get('a').total, 3);
  assert.equal(st.get('a').completed, 2);
  assert.equal(st.get('a').cancelled, 1);
  assert.equal(st.get('a').outstanding, 1000 + 600, 'balance from the recorded payment summary, not the whole fare');
  assert.equal(st.get('a').spend, 2000);
  assert.equal(st.get('a').lastCompletedAt.toISOString(), '2026-11-10T10:00:00.000Z');
  assert.equal(st.get('b').total, 2);
  assert.equal(st.get('b').paid, 1050);
  assert.equal(st.get('b').outstanding, 0 + 1000, 'lk1 has no payment recorded');
  assert.deepEqual(owned.get('a').map((x) => x.id), ['2', '1', '3'], 'newest pickup first');
  assert.equal(st.get('d1').total + st.get('d2').total, 0, 'an ambiguous number is never attributed');
  assert.equal(owned.get('a').filter((x) => x.id === '3').length, 1, 'the drawer history uses the same ownership rule');
});

test('legacy stale counters on the customer document are ignored', () => {
  const { stats: st } = S.buildCustomerLedger([{ id: 'a', phone: '', bookings: 40, spent: 900000 }], []);
  assert.equal(st.get('a').total, 0);
  assert.equal(st.get('a').spend, 0);
});
