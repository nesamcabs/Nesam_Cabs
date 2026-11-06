const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Run the actual admin invoice builder and its pure tax helpers, without a browser or database writes.
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  cache.set(file, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = name => {
    if (name === 'firebase/firestore' || name === './firebase') return {};
    if (name === './adminFirestoreService') return { COLLECTIONS: {}, describeDataError: String };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name + '.ts'));
    return require(name);
  };
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: file })(localRequire, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}
const { buildInvoiceLines } = load(path.resolve(__dirname, '../../admin/src/services/invoiceService.ts'));

test('admin invoice itemizes carrier and pets and reconciles to the charged total', () => {
  const result = buildInvoiceLines({ fare: 1575, pickup: 'Chennai', drop: 'Pondicherry', service: 'One Way',
    fareBreakdown: { baseFare: 1000, taxableAmount: 1500, subtotal: 1500, gst: 75, total: 1575,
      addOns: { roofCarrier: true, pets: true, carrierCharge: 300, petCharge: 200 } },
  });
  assert.equal(result.items.filter(i => i.description.includes('Roof carrier')).length, 1);
  assert.equal(result.items.filter(i => i.description.includes('Pet travel')).length, 1);
  assert.equal(result.items.reduce((sum, i) => sum + i.amount, 0), 1500);
  assert.equal(result.grandTotal, 1575);
  assert.equal(result.totalTax, 75);
});

test('no add-ons leaves the existing invoice unchanged', () => {
  const result = buildInvoiceLines({ fare: 1050, pickup: 'Chennai', drop: 'Pondicherry', service: 'One Way', fareBreakdown: { baseFare: 1000, taxableAmount: 1000, subtotal: 1000, gst: 50, total: 1050 } });
  assert.equal(result.items.length, 1);
  assert.equal(result.grandTotal, 1050);
});
