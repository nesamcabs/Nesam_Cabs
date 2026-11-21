// Rules behind the Master Admin command desk (admin/src/domain/commandDesk.ts), checked against a small dataset with known totals.
//   node --test scripts/command-desk.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');
const root = path.resolve(__dirname, '../admin/src');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (!id.startsWith('.')) throw Error('Unexpected dependency: ' + id);
    const base = path.resolve(path.dirname(file), id);
    return load([base + '.ts', base + '.tsx'].find(fs.existsSync));
  }, module, module.exports);
  return module.exports;
}
const D = load(path.join(root, 'domain/commandDesk.ts'));
const serverRules = load(path.join(root, 'domain/commandDesk.ts'));
const server = require('../functions/lib/domain/offerSchedule');

// Saturday 21 Nov 2026, 10:00 IST.
const NOW = new Date('2026-11-21T10:00:00+05:30');
const at = (iso) => ({ pickupAt: new Date(`${iso}+05:30`) });
let n = 0;
const b = (over) => ({ id: `b${++n}`, bookingId: `NSM-${n}`, status: 'Approved', customer: `Cust ${n}`, phone: '', pickup: 'Coimbatore', drop: 'Madurai', fare: 1000, service: 'One Way', tripType: 'One Way', source: 'nesam', ...over });

test('stages: one mapping for every count, legacy statuses included', () => {
  const rows = D.buildRows([
    b({ status: 'Pending' }),
    b({ status: 'Approved' }),
    b({ status: 'Approved', fulfilmentRoute: 'marketplace' }),
    b({ status: 'Confirmed', assignedVendorId: 'v1' }),
    b({ status: 'Assigned', assignedVendorId: 'v1', assignedDriverId: 'd1' }),
    b({ status: 'Ongoing', assignedDriverId: 'd1' }),
    b({ status: 'Completed' }), b({ status: 'Cancelled' }), b({ status: 'Rejected' }),
  ], new Map());
  assert.deepEqual(rows.map((r) => r.stage), ['new', 'publish', 'published', 'assign', 'assigned', 'ontrip', 'completed', 'cancelled', 'cancelled']);
  const c = D.stageCounts(rows);
  assert.equal(c.new + c.publish + c.published + c.assign + c.assigned + c.ontrip + c.completed + c.cancelled, rows.length, 'every booking is in exactly one stage');
  // A card's count is the number of rows the explorer shows for that stage.
  for (const s of D.PIPELINE_STAGES) assert.equal(D.filterRows(rows, 'ALL', { ...D.NO_TRIP_FILTERS, stage: s }).length, c[s]);
  // The marketplace record, not just the booking, says a duty is published (older bookings carry no route).
  const m = new Map([['x', { id: 'x', status: 'Open' }]]);
  assert.equal(D.deskStageOf(b({ id: 'x', status: 'Approved' }), m.get('x')), 'published');
});

test('sources: brand scope keeps the three identities apart and never files an unknown source under a brand', () => {
  const rows = D.buildRows([
    b({ source: 'nesam' }), b({ brand: 'peopletaxi' }), b({ bookingSource: 'oneway_website' }), b({ website: 'onewaycarrentals.in' }), b({ source: 'b2b-partner' }),
  ], new Map());
  assert.equal(D.filterRows(rows, 'nesam', D.NO_TRIP_FILTERS).length, 1);
  assert.equal(D.filterRows(rows, 'people_taxi', D.NO_TRIP_FILTERS).length, 1);
  assert.equal(D.filterRows(rows, 'onewaycarrentals', D.NO_TRIP_FILTERS).length, 2);
  assert.equal(D.filterRows(rows, 'ALL', D.NO_TRIP_FILTERS).length, 5);
  assert.deepEqual(D.sourceCounts(rows.map((r) => r.b)), { nesam: 1, people_taxi: 1, onewaycarrentals: 2, unknown: 1 });
});

test('filters combine: source, stage, service and search all apply together', () => {
  const rows = D.buildRows([
    b({ id: 'a', status: 'Pending', source: 'nesam', phone: '9842144510', customer: 'Karthik', pickup: 'Coimbatore', drop: 'Madurai' }),
    b({ id: 'c', status: 'Pending', brand: 'peopletaxi', service: 'Airport Taxi', tripType: 'Airport', phone: '9894011223', customer: 'Priya', pickup: 'Chennai Airport', drop: 'Vellore' }),
    b({ id: 'd', status: 'Approved', source: 'nesam', service: 'Round Trip', tripType: 'Round Trip', phone: '+91 98421 44510', customer: 'Karthik' }),
  ], new Map());
  const f = (over, scope = 'ALL') => D.filterRows(rows, scope, { ...D.NO_TRIP_FILTERS, ...over }).map((r) => r.b.id);
  assert.deepEqual(f({ stage: 'new' }), ['a', 'c']);
  assert.deepEqual(f({ stage: 'new' }, 'people_taxi'), ['c']);
  assert.deepEqual(f({ service: 'Airport' }), ['c']);
  assert.deepEqual(f({ search: 'vellore' }), ['c']);
  assert.deepEqual(f({ search: 'karthik', stage: 'publish' }), ['d']);
  assert.deepEqual(f({ search: '98421 44510' }).sort(), ['a', 'd'], 'a phone number matches on its digits');
  assert.deepEqual(f({ search: 'karthik', service: 'Round Trip', stage: 'publish' }, 'nesam'), ['d']);
  assert.deepEqual(f({ search: 'karthik', service: 'Airport' }), []);
});

test('today / tomorrow follow the India calendar across midnight', () => {
  const rows = D.buildRows([
    b({ id: 'late', ...at('2026-11-21T23:59:00') }),
    b({ id: 'early', ...at('2026-11-22T00:01:00') }),
    b({ id: 'night', ...at('2026-11-23T00:00:00') }),
    b({ id: 'done', status: 'Completed', ...at('2026-11-21T08:00:00') }),
    b({ id: 'old', ...at('2026-11-20T23:59:00') }),
  ], new Map());
  let s = D.scheduleSplit(rows, NOW);
  assert.deepEqual(s.today.map((r) => r.b.id), ['late']);
  assert.deepEqual(s.tomorrow.map((r) => r.b.id), ['early']);
  // Just after midnight the same trips move up a day.
  s = D.scheduleSplit(rows, new Date('2026-11-22T00:00:30+05:30'));
  assert.deepEqual(s.today.map((r) => r.b.id), ['early']);
  assert.deepEqual(s.tomorrow.map((r) => r.b.id), ['night']);
  // 18:29 UTC on the 21st is 23:59 IST on the 21st, while 18:31 UTC is already the 22nd in India.
  s = D.scheduleSplit(D.buildRows([b({ id: 'u1', pickupAt: new Date('2026-11-21T18:29:00Z') }), b({ id: 'u2', pickupAt: new Date('2026-11-21T18:31:00Z') })], new Map()), NOW);
  assert.deepEqual([s.today.map((r) => r.b.id), s.tomorrow.map((r) => r.b.id)], [['u1'], ['u2']]);
});

test('revenue: booked, collected and outstanding are different numbers; cancelled trips are worth nothing; an unpaid completed trip is owed', () => {
  const bookings = [
    b({ id: 'p1', ...at('2026-11-21T09:00:00'), fare: 1000, status: 'Assigned', paymentSummary: { totalPaid: 250, status: 'Partially Paid', balanceDue: 750, amountDue: 1000 }, vendorPayout: 800, fareBreakdown: { gst: 47.62, taxableAmount: 952.38 } }),
    b({ id: 'p2', ...at('2026-11-21T15:00:00'), fare: 2000, status: 'Completed', tollCharges: 100, paymentSummary: { totalPaid: 0, status: 'Unpaid', balanceDue: 2100, amountDue: 2100 } }),
    b({ id: 'p3', ...at('2026-11-21T18:00:00'), fare: 5000, status: 'Cancelled' }),
    b({ id: 'p4', ...at('2026-11-21T20:00:00'), fare: 3000, status: 'Rejected' }),
    b({ id: 'p5', ...at('2026-11-20T10:00:00'), fare: 4000, status: 'Completed', paymentSummary: { totalPaid: 4000, status: 'Paid', balanceDue: 0, amountDue: 4000 } }),
    b({ id: 'p6', fare: 777, status: 'Approved' }),
  ];
  delete bookings[5].pickupAt; bookings[5].date = ''; bookings[5].time = '';
  const w = D.periodWindow('Today', NOW);
  const today = D.revenueSummary(bookings, w.start, w.end, w.buckets);
  assert.equal(today.count, 2);
  assert.equal(today.booked, 3100, '1000 + (2000 fare + 100 tolls); cancelled and rejected add nothing');
  assert.equal(today.collected, 250);
  assert.equal(today.outstanding, 2850);
  assert.equal(today.marginTrips, 1);
  assert.equal(today.margin, 152.38, 'taxable 952.38 less the ₹800 payout');
  assert.deepEqual(today.buckets, [0, 0, 1000, 0, 2100, 0].map((v, i) => (i === 2 ? 1000 : i === 3 ? 0 : v)).map((v, i) => [0, 0, 1000, 2100, 0, 0][i]));
  assert.equal(today.byService.ONEWAY, 3100);
  assert.equal(today.bySource.nesam.booked, 3100);
  // The previous day is compared like for like.
  const prev = D.revenueSummary(bookings, w.prevStart, w.prevEnd);
  assert.equal(prev.booked, 4000);
  const c = D.changeOf(today.booked, prev.booked);
  assert.deepEqual(c, { kind: 'down', pct: -22.5 });
  // No earlier revenue: no growth rate is invented.
  assert.deepEqual(D.changeOf(500, 0), { kind: 'none', pct: null });
  assert.equal(D.changeLabel(D.changeOf(500, 0)), 'No prior period');
  // Zero revenue period.
  const zero = D.revenueSummary([], w.start, w.end, w.buckets);
  assert.equal(zero.booked, 0);
  assert.deepEqual(zero.buckets, [0, 0, 0, 0, 0, 0]);
  // Pipeline: open work whatever its date, and nothing for finished or cancelled trips.
  const rows = D.buildRows(bookings, new Map());
  assert.equal(D.pipelineValue(rows), 1000 + 777);
});

test('periods: equivalent windows in India time', () => {
  const t = D.periodWindow('Today', NOW);
  assert.equal(new Date(t.start).toISOString(), '2026-11-20T18:30:00.000Z');
  assert.equal(t.end - t.start, 86400000);
  assert.equal(t.prevEnd, t.start);
  assert.equal(t.buckets.length, 6);
  const w = D.periodWindow('Week', NOW);
  assert.equal(w.end - w.start, 7 * 86400000);
  assert.equal(w.prevEnd - w.prevStart, 7 * 86400000);
  assert.equal(w.buckets.length, 7);
  const m = D.periodWindow('Month', NOW);
  assert.equal(m.end - m.start, 30 * 86400000);
  assert.equal(m.buckets.length, 6);
  const y = D.periodWindow('Year', NOW);
  assert.equal(new Date(y.start).toISOString(), '2026-01-01'.replace('2026-01-01', '2025-12-31T18:30:00.000Z'));
  assert.deepEqual(y.buckets.map((x) => x.label), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.equal(y.buckets[3].end, y.end);
  // A buckets partition the window: every booked rupee lands in exactly one bar.
  const all = [b({ id: 'q', ...at('2026-12-31T23:59:00'), fare: 900 }), b({ id: 'r', ...at('2026-01-01T00:00:00'), fare: 100 })];
  const s = D.revenueSummary(all, y.start, y.end, y.buckets);
  assert.equal(s.booked, 1000);
  assert.equal(s.buckets.reduce((a, c) => a + c, 0), 1000);
});

test('hourly offer schedule: the dashboard and the server agree at every hour and at the cap', () => {
  assert.deepEqual([0, 1, 2, 3].map((h) => D.scheduledOffer(1750, 5, 2050, h)), [1750, 1838, 1929, 2026]);
  assert.equal(D.scheduledOffer(1750, 5, 2050, 4), 2050);
  for (const [start, cap] of [[1750, 2050], [2055, 2300], [999, 1200], [12000, 12500]]) {
    for (let h = 0; h <= 12; h++) assert.equal(D.scheduledOffer(start, 5, cap, h), server.scheduledOffer(start, 5, cap, h), `${start}→${cap} at ${h}h`);
  }
  assert.equal(D.elapsedWholeHours(NOW.getTime() - 59 * 60000, NOW.getTime()), 0);
  assert.equal(D.elapsedWholeHours(NOW.getTime() - 60 * 60000, NOW.getTime()), 1);
  assert.equal(D.elapsedWholeHours(NOW.getTime() - 185 * 60000, NOW.getTime()), 3);
  assert.equal(D.elapsedWholeHours(null, NOW.getTime()), 0, 'no publication time → no steps');
});

test('bids: lowest first, deterministic tie-break, same order as the server', () => {
  const bids = [
    { id: 'vendor_b', status: 'Pending Review', amount: 1750, submittedAtMs: 20 },
    { id: 'vendor_a', status: 'Pending Review', amount: 1750, submittedAtMs: 10 },
    { id: 'vendor_c', status: 'Pending Review', amount: 1720, submittedAtMs: 99 },
    { id: 'vendor_d', status: 'Accepted', amount: 1000, submittedAtMs: 1 },
  ];
  assert.deepEqual(D.rankPendingBids(bids).map((x) => x.id), ['vendor_c', 'vendor_a', 'vendor_b']);
  assert.deepEqual(D.rankPendingBids(bids).map((x) => x.id), server.rankPendingBids(bids).map((x) => x.id));
  assert.deepEqual(D.rankPendingBids([]), [], 'no bids → nothing to assign');
});

test('payout and bidding validation', () => {
  assert.equal(D.fixedPayoutError(2000, 1750), null);
  assert.match(D.fixedPayoutError(2000, 0), /whole rupees/);
  assert.match(D.fixedPayoutError(2000, 17.5), /whole rupees/);
  assert.match(D.fixedPayoutError(2000, 2500), /within the customer fare/);
  assert.equal(D.biddingError(2170, 1750, 2050), null);
  assert.match(D.biddingError(2170, 1750, 1750), /above the starting bid/);
  assert.match(D.biddingError(2170, 1750, 2500), /cannot exceed the customer fare/);
  assert.match(D.biddingError(2170, 0, 2050), /starting bid/);
});

test('duty slip: branded, contact only when the booking carries it, vendor amount on the vendor slip', () => {
  const driver = b({ id: 's1', brand: 'peopletaxi', phone: '9842144510', customer: 'Priya', assignedDriverId: 'd1', assignedDriverName: 'Murugan', assignedVehicleNumber: 'TN-38-BQ-4512', status: 'Assigned', ...at('2026-11-21T16:15:00'),
    paymentSummary: { totalPaid: 500, status: 'Partially Paid', balanceDue: 1500, amountDue: 2000 }, fare: 2000 });
  const slip = D.buildDutySlip(driver, { pickupText: '21 Nov 2026 · 4:15 pm' });
  assert.match(slip, /^\*PEOPLETAXI\.IN — DRIVER DUTY SLIP\*/);
  assert.match(slip, /Booking ID: \*NSM-\d+\*/);
  assert.match(slip, /Priya \(\+91 9842144510\)/);
  assert.match(slip, /Driver: \*Murugan\*/);
  assert.match(slip, /Cab: \*TN-38-BQ-4512\*/);
  assert.match(slip, /Collect from customer \*₹1,500\*/);
  // No number on the booking (restricted staff): none in the slip.
  const redacted = D.buildDutySlip({ ...driver, phone: '' }, { pickupText: 'x' });
  assert.ok(!/\+91/.test(redacted));
  const vendor = D.buildDutySlip(b({ id: 's2', source: 'oneway', assignedVendorName: 'Sri Murugan Travels', status: 'Confirmed', fare: 9200 }), { pickupText: 'x', payout: 8100 });
  assert.match(vendor, /^\*ONE WAY CAR RENTALS — VENDOR DUTY SLIP\*/);
  assert.match(vendor, /Driver: \*To be updated by vendor\*/);
  assert.match(vendor, /Vendor agreed amount: \*₹8,100\*/);
});

test('final bill: written from the saved figures; payment stays outstanding when nothing was paid', () => {
  const summary = { quotedFare: 5660, fare: 6000, gst: 285.71, taxable: 5714.29, totalKm: 300, quotedKm: 270, includedKm: 270, extraKm: 30, extraKmRate: 12, extraKmAmount: 360, tollCharges: 150, tolls: [{ name: 'Toll', amount: 120 }, { name: 'Parking / entry', amount: 30 }], amountDue: 6150, fareReview: false };
  const bill = D.buildFinalBill(b({ id: 'f1', customer: 'Arun', pickup: 'Madurai', drop: 'Trichy', assignedDriverName: 'Murugan', status: 'Ongoing' }), summary);
  assert.match(bill, /Extra km: 30 km × ₹12 = ₹360/);
  assert.match(bill, /Toll: ₹120/);
  assert.match(bill, /Parking \/ entry: ₹30/);
  assert.match(bill, /Total payable: \*₹6,150\*/);
  assert.match(bill, /Paid: ₹0 · Balance: \*₹6,150\*/);
});
