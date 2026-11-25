// Local & Rental pricing on the admin side: the shared location selector rules (admin/src/domain/locationHierarchy.ts), the
// inheritance / Mixed display of location rates (domain/geoFareView.ts) and the peak-rule overlap check (domain/peakSchedule.ts).
// Run with `npm run test:local-rental` in admin/. The booking server's own rules are tested in functions/test/geoPricing*.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require(path.resolve(__dirname, '../functions/test/adminServiceLoader.cjs'))({});
const L = load('src/domain/locationHierarchy.ts');
const V = load('src/domain/geoFareView.ts');
const P = load('src/domain/peakSchedule.ts');

const loc = (o) => ({ status: 'Active', pickupEnabled: true, dropEnabled: true, city: '', ...o });
const LOCS = [
  loc({ id: 'theni-city', name: 'Theni', type: 'City', state: 'Tamil Nadu', district: 'Theni', city: 'Theni', pincode: '625531' }),
  loc({ id: 'zone-north', name: 'North Zone', type: 'Service Zone', state: 'Tamil Nadu', district: 'Theni', pincodes: ['625531', '625512'] }),
  loc({ id: 'zone-south', name: 'South Zone', type: 'Service Zone', state: 'Tamil Nadu', district: 'Theni', pincodes: ['625601'] }),
  // An older Pickup & Drop zone (Area / Locality listing its pincodes) is a zone too.
  loc({ id: 'old-zone', name: 'Cumbum Zone', type: 'Area / Locality', state: 'Tamil Nadu', district: 'Theni', pincodes: ['625516'] }),
  loc({ id: 'allinagaram', name: 'Allinagaram', type: 'Area / Locality', state: 'Tamil Nadu', district: 'Theni', pincode: '625531' }),
  loc({ id: 'periyakulam', name: 'Periyakulam', type: 'Area / Locality', state: 'Tamil Nadu', district: 'Theni', pincode: '625601' }),
  loc({ id: 'parented', name: 'Kodangipatti', type: 'Area / Locality', state: 'Tamil Nadu', district: 'Theni', parentLocationId: 'zone-south' }),
  loc({ id: 'dup-madurai', name: 'Periyakulam', type: 'Landmark', state: 'Tamil Nadu', district: 'Madurai', pincode: '625601' }),
  loc({ id: 'mdu', name: 'Madurai', type: 'City', state: 'Tamil Nadu', district: 'Madurai', city: 'Madurai' }),
];
const index = L.indexLocations(LOCS);
const sel = (o = {}) => ({ ...L.EMPTY_SEL, ...o });

test('districts are administrative (India Post list + saved), zones are business records, never mixed', () => {
  const districts = L.districtsOf('33', index);
  assert.ok(districts.includes('Theni') && districts.includes('Madurai') && districts.length >= 38);
  assert.ok(!districts.includes('North Zone'));
  assert.deepEqual(L.zonesOf(index, '33', 'Theni').map((z) => z.id), ['old-zone', 'zone-north', 'zone-south']);
  assert.ok(!L.areasOf(index, '33', 'Theni').some((a) => a.type === 'Service Zone'));
});

test('parent changes clear children; nothing is auto-selected', () => {
  let s = L.changeSel(sel(), { state: '33' }, index);
  assert.deepEqual(s, sel({ state: '33' }));
  s = L.changeSel(sel({ state: '33', district: 'Theni', zoneId: 'zone-north', locationId: 'allinagaram' }), { district: 'Madurai' }, index);
  assert.deepEqual(s, sel({ state: '33', district: 'Madurai' }));
  s = L.changeSel(sel({ state: '33', district: 'Theni', zoneId: 'zone-north', locationId: 'allinagaram' }), { state: '32' }, index);
  assert.deepEqual(s, sel({ state: '32' }));
  // A zone change keeps the area only when it belongs to the new zone.
  assert.equal(L.changeSel(sel({ state: '33', district: 'Theni', zoneId: 'zone-north', locationId: 'allinagaram' }), { zoneId: 'zone-south' }, index).locationId, '');
});

test('an area chosen under "All zones" selects its actual zone (by PIN or by parent), and a zone lists only its own areas', () => {
  const s = L.changeSel(sel({ state: '33', district: 'Theni' }), { locationId: 'periyakulam' }, index);
  assert.equal(s.zoneId, 'zone-south');
  assert.equal(s.locationId, 'periyakulam', 'the area stays selected (not forced back to All areas)');
  assert.equal(L.changeSel(sel({ state: '33', district: 'Theni' }), { locationId: 'parented' }, index).zoneId, 'zone-south');
  assert.deepEqual(L.areasOf(index, '33', 'Theni', 'zone-south').map((a) => a.id).sort(), ['parented', 'periyakulam']);
  assert.deepEqual(L.areasOf(index, '33', 'Theni', 'zone-north').map((a) => a.id).sort(), ['allinagaram', 'theni-city']);
});

test('PIN search returns every match with its hierarchy; repeated names stay distinguishable', () => {
  const hits = L.locationsWithPin('625601', index);
  assert.deepEqual(hits.map((h) => h.loc.id).sort(), ['dup-madurai', 'periyakulam', 'zone-south']);
  assert.deepEqual(hits.filter((h) => h.loc.name === 'Periyakulam').map((h) => h.district).sort(), ['Madurai', 'Theni']);
  assert.deepEqual(L.statesForPin('625601'), ['33', '34']);
  assert.deepEqual(L.selOfLocation('periyakulam', index), sel({ state: '33', district: 'Theni', zoneId: 'zone-south', locationId: 'periyakulam' }));
});

test('booking-rule places keep their existing meaning (city-wide, district, PINs, zone)', () => {
  assert.deepEqual(L.rulePlacesOf(sel({ state: '33', district: 'Theni' }), index), [{ state: '33', city: 'Theni', area: '' }]);
  assert.deepEqual(L.rulePlacesOf(sel({ state: '33', district: 'Madurai', locationId: 'mdu' }), index), [{ state: '33', city: 'Madurai', area: '' }]);
  assert.deepEqual(L.rulePlacesOf(sel({ state: '33', district: 'Theni', pins: ['625531', '625601'] }), index).map((p) => p.area), ['625531', '625601']);
  assert.deepEqual(L.rulePlacesOf(sel({ state: '33', district: 'Theni', zoneId: 'zone-north' }), index), [{ state: '33', city: 'Theni', area: '', zoneId: 'zone-north', zoneName: 'North Zone' }]);
  assert.deepEqual(L.rulePlacesOf(sel(), index), [{ state: '', city: '', area: '' }]);
  // Editing: a saved PIN rule opens on its PIN; a saved town that is not a district opens on its City record.
  assert.deepEqual(L.selOfRulePlace({ state: '33', city: 'Theni', area: '625531' }, index).pins, ['625531']);
  assert.equal(L.rulePlaceLabel({ state: '33', city: 'Theni', area: '625601' }), 'PIN 625601 · Theni · Tamil Nadu');
});

test('fare keys: area → zone → district, matching the server', () => {
  assert.deepEqual(L.fareChainOf(sel({ state: '33', district: 'Theni', zoneId: 'zone-south', locationId: 'periyakulam' })), ['a_periyakulam', 'z_zone-south', 'd_33_theni']);
  assert.equal(L.scopeKeyOf({ level: 'district', state: '33', district: 'Kanniyakumari' }), 'd_33_kanniyakumari');
});

const doc = (id, sedan) => [id, { id, brand: id.split('__')[0], service: 'local', scopeKey: id.split('__')[2], classes: { sedan } }];
test('inheritance display: own value, inherited with source, configured zero, Mixed in bulk, never zero for missing', () => {
  const docs = new Map([
    doc('common__local__d_33_theni', { customer: { baseFare: 150, minimumFare: 0 } }),
    doc('nesam__local__z_zone-south', { customer: { baseFare: 180 } }),
    doc('nesam__local__a_periyakulam', { customer: { extraKmRate: 18 } }),
    doc('nesam__local__a_parented', { customer: { extraKmRate: 20 } }),
  ]);
  const keys = V.keysFrom('area', { area: 'a_periyakulam', zone: 'z_zone-south', district: 'd_33_theni' });
  const chain = V.inheritChain('nesam', 'local', keys, 'nesam__local__a_periyakulam');
  assert.deepEqual(chain, ['nesam__local__z_zone-south', 'nesam__local__d_33_theni', 'common__local__a_periyakulam', 'common__local__z_zone-south', 'common__local__d_33_theni']);
  const read = (f) => (d) => d?.classes?.sedan?.customer?.[f];
  const base = V.cellView(docs, ['nesam__local__a_periyakulam'], chain, read('baseFare'));
  assert.deepEqual(base, { own: undefined, mixed: false, inherited: { value: 180, docId: 'nesam__local__z_zone-south' } });
  assert.equal(V.cellView(docs, ['nesam__local__a_periyakulam'], chain, read('minimumFare')).inherited.value, 0, 'a configured zero is a value');
  assert.equal(V.cellView(docs, ['nesam__local__a_periyakulam'], chain, read('includedKm')).inherited, undefined, 'missing stays missing');
  const bulk = V.cellView(docs, ['nesam__local__a_periyakulam', 'nesam__local__a_parented'], chain, read('extraKmRate'));
  assert.equal(bulk.mixed, true);
  assert.equal(bulk.own, undefined);
  assert.equal(V.sourceLabel('common__local__d_33_theni', 'nesam'), 'District default · shared');
  assert.deepEqual(V.parseCell(''), { remove: true });
  assert.deepEqual(V.parseCell('0'), { value: 0 });
  assert.equal(V.parseCell('-2'), null);
  assert.deepEqual(V.rowStatus([{ mixed: false }, { own: 1, mixed: false }], 'area'), { tone: 'warn', text: 'Incomplete' });
});

test('peak overlap check: same place and priority only; overnight windows wrap into the next day; dates matter', () => {
  const r = (o) => ({ id: 'a', brand: '', service: 'local', scopeKey: 'd_33_theni', enabled: true, days: [5], slots: [{ start: '22:00', end: '02:00' }], priority: 1, name: 'Fri late', ...o });
  assert.equal(P.overlapsWith(r({ id: 'b', days: [6], slots: [{ start: '01:00', end: '03:00' }] }), [r()]).length, 1);
  assert.equal(P.overlapsWith(r({ id: 'b', days: [6], slots: [{ start: '02:00', end: '03:00' }] }), [r()]).length, 0, 'the end minute is not included');
  assert.equal(P.overlapsWith(r({ id: 'b', priority: 2 }), [r()]).length, 0);
  assert.equal(P.overlapsWith(r({ id: 'b', scopeKey: 'z_zone-north' }), [r()]).length, 0);
  assert.equal(P.overlapsWith(r({ id: 'b', from: '2027-01-01' }), [r({ until: '2026-12-31' })]).length, 0);
  assert.equal(P.overlapsWith(r({ id: 'b', enabled: false }), [r()]).length, 0, 'a switched-off draft never clashes');
  assert.equal(P.slotsText([{ start: '22:00', end: '02:00' }]), '10:00 PM–2:00 AM (overnight)');
  assert.equal(P.daysText([1, 2, 3, 4, 5]), 'Mon–Fri');
});
