// Admin Driver Ratings: grouping per driver, standing, fleet totals, reasons, CSV safety, and that the page is wired
// into the sidebar and permissions. Run: node --test scripts/driver-ratings.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');

const root = path.resolve(__dirname, '../admin/src');
function load(relative) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, () => { throw Error('pure module expected'); });
  return module.exports;
}
const R = load('domain/driverRatings.ts');

const NOW = Date.parse('2026-11-20T10:00:00Z');
const day = 86400000;
let n = 0;
const rating = (driverId, stars, o = {}) => ({
  id: `r${++n}`, source: 'booking', bookingId: `b${n}`, rideId: '', tripCode: `NT-${n}`, driverId, driverName: o.driverName ?? driverId, vendorId: '', vehicleNumber: 'TN01', customerId: 'c', customerName: 'Asha', customerPhone: '', serviceName: 'One Way',
  stars, low: stars <= 2, tags: [], reason: stars <= 2 ? (o.reason ?? 'Late pickup or late arrival') : '', feedback: stars <= 2 ? 'x' : '', improvements: '', comment: '', followUp: stars <= 2 ? (o.followUp ?? 'New') : 'None', adminNote: '',
  createdAt: o.at ?? NOW - day,
});

test('the low-rating line matches the server (2 stars or fewer)', () => {
  assert.equal(R.LOW_RATING_MAX, 2);
  const policy = fs.readFileSync(path.resolve(__dirname, '../functions/src/domain/ratingPolicy.ts'), 'utf8');
  assert.match(policy, /export const LOW_RATING_MAX = 2;/);
});

test('standing: few ratings are judged gently, many ratings strictly', () => {
  assert.equal(R.standingOf(0, 0, 0), 'Not rated');
  assert.equal(R.standingOf(1, 1, 1), 'Watch');       // one terrible trip: visible, but not "at risk"
  assert.equal(R.standingOf(4.5, 3, 0), 'Good');
  assert.equal(R.standingOf(4.9, 40, 0.01), 'Excellent');
  assert.equal(R.standingOf(4.4, 40, 0.05), 'Good');
  assert.equal(R.standingOf(4.0, 40, 0.05), 'Watch');
  assert.equal(R.standingOf(4.6, 40, 0.2), 'Watch');   // good average but many low ratings
  assert.equal(R.standingOf(3.2, 40, 0.1), 'At risk');
  assert.equal(R.standingOf(4.6, 40, 0.35), 'At risk');
});

test('one summary per driver, including drivers with no ratings and drivers only seen in the records', () => {
  const rows = R.summariseDrivers(
    [rating('d1', 5), rating('d1', 1), rating('ghost', 4, { driverName: 'Old driver' })],
    [{ id: 'd1', name: 'Selvam' }, { id: 'd2', name: 'Raja' }],
    NOW,
  );
  assert.deepEqual(rows.map((r) => r.driverId).sort(), ['d1', 'd2', 'ghost']);
  const d1 = rows.find((r) => r.driverId === 'd1');
  assert.equal(d1.name, 'Selvam');
  assert.equal(d1.average, 3);
  assert.equal(d1.count, 2);
  assert.deepEqual(d1.breakdown, { 1: 1, 2: 0, 3: 0, 4: 0, 5: 1 });
  assert.equal(d1.low, 1);
  assert.equal(d1.open, 1);
  const d2 = rows.find((r) => r.driverId === 'd2');
  assert.equal(d2.standing, 'Not rated');
  assert.equal(d2.count, 0);
  assert.equal(rows.find((r) => r.driverId === 'ghost').name, 'Old driver');
});

test("the driver profile's own average wins when it covers more ratings than the records kept", () => {
  const [row] = R.summariseDrivers([rating('d1', 1), rating('d1', 1)], [{ id: 'd1', name: 'A', rating: 4.5, ratingCount: 40, lowRatingCount: 3 }], NOW);
  assert.equal(row.average, 4.5);
  assert.equal(row.count, 40);
  assert.equal(row.records, 2);
  assert.equal(row.low, 3);
  assert.equal(Math.round(row.lowShare * 1000), 75);
});

test('when the profile has fewer ratings than the records, the records are used', () => {
  const [row] = R.summariseDrivers([rating('d1', 4), rating('d1', 5), rating('d1', 3)], [{ id: 'd1', name: 'A', rating: 5, ratingCount: 1 }], NOW);
  assert.equal(row.average, 4);
  assert.equal(row.count, 3);
});

test('the last 30 days only counts recent ratings, and the newest rating is found', () => {
  const [row] = R.summariseDrivers([rating('d1', 5, { at: NOW - 2 * day }), rating('d1', 1, { at: NOW - 40 * day }), rating('d1', 3, { at: NOW - 10 * day })], [{ id: 'd1', name: 'A' }], NOW);
  assert.equal(row.last30Count, 2);
  assert.equal(row.last30Average, 4);
  assert.equal(row.lastRatedAt, NOW - 2 * day);
});

test('open follow-ups only count low ratings that are New or In review', () => {
  const rs = [rating('d1', 1, { followUp: 'New' }), rating('d1', 2, { followUp: 'In review' }), rating('d1', 1, { followUp: 'Resolved' }), rating('d1', 2, { followUp: 'Dismissed' }), rating('d1', 5)];
  const [row] = R.summariseDrivers(rs, [{ id: 'd1', name: 'A' }], NOW);
  assert.equal(row.open, 2);
  const fleet = R.summariseFleet([row], rs);
  assert.equal(fleet.openFollowUps, 2);
  assert.equal(fleet.lowRatings, 4);
});

test('fleet average is weighted by how many ratings each driver has', () => {
  const rows = R.summariseDrivers([], [{ id: 'a', name: 'A', rating: 5, ratingCount: 1 }, { id: 'b', name: 'B', rating: 3, ratingCount: 3 }, { id: 'c', name: 'C' }], NOW);
  const fleet = R.summariseFleet(rows, []);
  assert.equal(fleet.average, 3.5);
  assert.equal(fleet.ratings, 4);
  assert.equal(fleet.ratedDrivers, 2);
  assert.equal(fleet.drivers, 3);
  assert.equal(R.summariseFleet([], []).average, 0);
});

test('top reasons are ranked, only low ratings count', () => {
  const rs = [rating('d1', 1, { reason: 'Rash or unsafe driving' }), rating('d1', 2, { reason: 'Rash or unsafe driving' }), rating('d1', 1, { reason: 'Other' }), rating('d1', 5)];
  assert.deepEqual(R.reasonCounts(rs), [{ reason: 'Rash or unsafe driving', count: 2 }, { reason: 'Other', count: 1 }]);
  const [row] = R.summariseDrivers(rs, [{ id: 'd1', name: 'A' }], NOW);
  assert.equal(row.topReasons[0].reason, 'Rash or unsafe driving');
});

test('timestamps from Firestore, Date, numbers and strings all read', () => {
  assert.equal(R.toMillis({ toMillis: () => 5 }), 5);
  assert.equal(R.toMillis({ toDate: () => new Date(7) }), 7);
  assert.equal(R.toMillis({ seconds: 2 }), 2000);
  assert.equal(R.toMillis(new Date(9)), 9);
  assert.equal(R.toMillis(11), 11);
  assert.equal(R.toMillis(null), null);
  assert.equal(R.toMillis('nonsense'), null);
});

test('CSV export quotes cells and neutralises spreadsheet formulas typed by customers', () => {
  const r = { ...rating('d1', 1, { at: NOW }), feedback: '=HYPERLINK("http://evil")', improvements: 'a, "b"\nc', customerName: '+91 hacker' };
  const lines = R.ratingsCsv([r]).split('\r\n');
  assert.equal(lines[0].split(',')[0], 'Date');
  const body = lines.slice(1).join('\r\n');
  assert.ok(body.includes(`"'=HYPERLINK(""http://evil"")"`), body);
  assert.ok(body.includes(`"a, ""b""\nc"`), body);
  assert.ok(body.includes(`'+91 hacker`), body);
});

test('the page is in the sidebar, the router, and the permission and module maps', () => {
  const nav = fs.readFileSync(path.join(root, 'components/shell/navConfig.ts'), 'utf8');
  const perms = fs.readFileSync(path.join(root, 'config/permissions.ts'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  assert.match(nav, /id: "driver-ratings", label: "Driver Ratings"/);
  assert.match(perms, /"driver-ratings": "engagement"/);
  assert.match(perms, /"driver-ratings": "Support"/);
  assert.match(app, /case "driver-ratings":/);
  assert.match(app, /"driver-ratings": \{ title: "Driver Ratings"/);
});

test('the Firestore rules let only staff with engagement read ratings, and nobody write them', () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8');
  const start = rules.indexOf('match /driverRatings/{ratingId}');
  assert.ok(start > 0, 'driverRatings rules block exists');
  const body = rules.slice(start, rules.indexOf('\n    }\n', start));
  assert.match(body, /allow read: if can\('engagement'\);/);
  assert.match(body, /allow write: if false;/);
});
