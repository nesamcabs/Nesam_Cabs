const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/domain/paymentChoices');

const ctx = (patch = {}) => ({ now: new Date('2026-11-20T10:00:00Z'), pickup: { name: 'Erode', address: 'Erode, Tamil Nadu' }, onlineOn: true, ...patch });
const cfgWith = (id, patch) => { const c = C.defaultChoices(); c.options[id] = { ...c.options[id], ...patch }; return c; };
const ids = (cfg, c) => C.resolveChoices(cfg, c).choices.map((x) => x.id);

test('every option is offered by default, part is recommended', () => {
  const r = C.resolveChoices(C.defaultChoices(), ctx());
  assert.deepEqual(r.choices.map((c) => [c.id, c.percent, c.recommended]), [['later', 0, false], ['part', 25, true], ['full', 100, false]]);
});

test('the advance rounds up to the rupee and never passes the total', () => {
  assert.equal(C.advanceAmount(6082, 25), 1521);
  assert.equal(C.advanceAmount(1000, 25), 250);
  assert.equal(C.advanceAmount(1, 99), 1);
  assert.equal(C.advanceAmount(500, 100), 500);
});

test('online options disappear when online payment is off, pay later stays', () => {
  assert.deepEqual(ids(C.defaultChoices(), ctx({ onlineOn: false })), ['later']);
});

test('a hidden option is not offered', () => {
  assert.deepEqual(ids(cfgWith('part', { visible: false }), ctx()), ['later', 'full']);
});

test('date window uses India days and includes both ends', () => {
  const win = { mode: 'Range', from: '2026-11-20', to: '2026-11-25' };
  const cfg = cfgWith('full', { schedule: win });
  assert.ok(ids(cfg, ctx()).includes('full'));
  assert.ok(ids(cfg, ctx({ now: new Date('2026-11-25T18:00:00Z') })).includes('full')); // 25th 23:30 IST
  assert.ok(!ids(cfg, ctx({ now: new Date('2026-11-25T18:31:00Z') })).includes('full')); // 26th 00:01 IST
  assert.ok(!ids(cfg, ctx({ now: new Date('2026-11-19T10:00:00Z') })).includes('full'));
});

test('the date can follow the pickup day instead of the booking day', () => {
  const cfg = cfgWith('part', { basis: 'pickup', schedule: { mode: 'Range', from: '2026-12-01', to: '' } });
  assert.ok(!ids(cfg, ctx({ pickupAt: new Date('2026-11-28T05:00:00Z') })).includes('part'));
  assert.ok(ids(cfg, ctx({ pickupAt: new Date('2026-12-02T05:00:00Z') })).includes('part'));
});

test('district Only / Except, including towns inside a district', () => {
  const only = cfgWith('full', { districts: { mode: 'Only', list: ['Erode'] } });
  assert.ok(ids(only, ctx()).includes('full'));
  assert.ok(ids(only, ctx({ pickup: { name: 'Gobichettipalayam', address: 'Gobichettipalayam' } })).includes('full')); // a town inside Erode
  assert.ok(!ids(only, ctx({ pickup: { name: 'Madurai', address: 'Madurai, Tamil Nadu' } })).includes('full'));
  const except = cfgWith('full', { districts: { mode: 'Except', list: ['Erode'] } });
  assert.ok(!ids(except, ctx()).includes('full'));
  assert.ok(ids(except, ctx({ pickup: { name: 'Salem', address: 'Salem' } })).includes('full'));
});

test('without a pickup place a district limit is not applied (older apps)', () => {
  const only = cfgWith('full', { districts: { mode: 'Only', list: ['Madurai'] } });
  assert.ok(ids(only, ctx({ pickup: null })).includes('full'));
});

test('when everything is hidden pay later is still offered', () => {
  const cfg = C.defaultChoices();
  for (const id of C.PAY_OPTION_IDS) cfg.options[id].visible = false;
  const r = C.resolveChoices(cfg, ctx());
  assert.deepEqual(r.choices.map((c) => c.id), ['later']);
  assert.equal(r.fallback, true);
});

test('the booking server check agrees with the screen', () => {
  const cfg = cfgWith('part', { visible: false });
  assert.equal(C.isChoiceOffered(cfg, 'part', ctx()), false);
  assert.equal(C.isChoiceOffered(cfg, 'full', ctx()), true);
  assert.deepEqual(C.planFor(C.defaultChoices(), 'part', 6082), { option: 'part', percent: 25, advanceAmount: 1521 });
  assert.deepEqual(C.planFor(C.defaultChoices(), 'full', 6082), { option: 'full', percent: 100, advanceAmount: 6082 });
  assert.equal(C.planFor(C.defaultChoices(), 'later', 6082), null);
});

test('saving is validated', () => {
  const ok = () => ({ options: { later: C.defaultRule(), part: C.defaultRule(), full: C.defaultRule() }, partPercent: 30, recommended: 'part' });
  assert.equal(C.validateChoices(ok()).partPercent, 30);
  const noneVisible = ok(); for (const id of C.PAY_OPTION_IDS) noneVisible.options[id].visible = false;
  assert.throws(() => C.validateChoices(noneVisible), /At least one/);
  const badPct = ok(); badPct.partPercent = 0;
  assert.throws(() => C.validateChoices(badPct), /whole number/);
  const backwards = ok(); backwards.options.part.schedule = { mode: 'Range', from: '2026-12-02', to: '2026-12-01' };
  assert.throws(() => C.validateChoices(backwards), /end date is before/);
  const emptyOnly = ok(); emptyOnly.options.full.districts = { mode: 'Only', list: [] };
  assert.throws(() => C.validateChoices(emptyOnly), /at least one district/);
  const dedupe = ok(); dedupe.options.full.districts = { mode: 'Only', list: ['Erode', ' erode ', 'Salem'] };
  assert.deepEqual(C.validateChoices(dedupe).options.full.districts.list, ['Erode', 'Salem']);
});
