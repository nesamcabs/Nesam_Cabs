const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../../admin/src/services/rentalPackageRule.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const result = { exports: {} };
new Function('module', 'exports', compiled)(result, result.exports);
const { rentalRulePackages } = result.exports;
const rule = { firstHourFare: 500, additionalHourFare: 350, partnerPerHour: 250, includedKm: 20, kmMode: 'per_hour', extraKmRate: 25, extraHourRate: 350 };
test('the admin builder generates all fifteen fares, payouts and per-hour kilometre allowances', () => {
  const packages = rentalRulePackages(rule);
  assert.equal(Object.keys(packages).length, 15);
  assert.equal(packages['1'].customerFare, 500);
  assert.equal(packages['15'].customerFare, 5400);
  assert.equal(packages['15'].partnerPayout, 3750);
  assert.equal(packages['15'].includedKm, 300);
});
test('a fixed kilometre allowance stays fixed for all fifteen durations', () => {
  const packages = rentalRulePackages({ ...rule, kmMode: 'per_trip' });
  assert.ok(Object.values(packages).every(p => p.includedKm === 20));
});
