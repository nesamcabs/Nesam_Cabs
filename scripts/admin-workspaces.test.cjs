// Regression checks for consolidation boundaries, existing staff access and coupon persistence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('../admin/node_modules/typescript');
const root = path.resolve(__dirname, '../admin/src');
const writes = [];
const cache = new Map();
const sdk = {
  doc: (_db, kind, id) => ({ kind, id }), collection: (_db, kind) => ({ kind }),
  updateDoc: async (ref, data) => writes.push({ ref, data }),
  addDoc: async (ref, data) => writes.push({ ref, data }),
  serverTimestamp: () => 'server-time', Timestamp: { now: () => 'history-time' },
  arrayUnion: (...items) => ({ union: items }),
};
function load(relative) {
  const file = path.resolve(root, relative);
  if (file === path.join(root, 'services/firebase.ts')) return { db: {}, auth: { currentUser: { uid: 'regression-admin', displayName: 'Admin' } } };
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', code)((id) => {
    if (id === 'firebase/firestore') return sdk;
    if (!id.startsWith('.')) throw Error('Unexpected dependency: ' + id);
    const base = path.resolve(path.dirname(file), id);
    return load([base + '.ts', base + '.tsx'].find(fs.existsSync));
  }, module, module.exports);
  return module.exports;
}
const permissions = load('config/permissions.ts');
const navigation = load('config/adminNavigation.ts');
const coupons = load('services/couponService.ts');
const { isCampaignCoupon } = load('domain/couponWorkspace.ts');
const access = (permissionsList, module, flag = true, actions = ['view']) => ({
  ...permissions.NO_ACCESS, kind: 'staff', permissions: permissionsList,
  matrix: { ...permissions.emptyMatrix(), modules: { [module]: actions }, partnerRights: { viewCoupons: flag } },
});

test('both former coupon reader groups keep access without acquiring edit rights', () => {
  const pricing = access(['pricing'], 'Settings');
  const engagement = access(['engagement'], 'Communication');
  for (const a of [pricing, engagement]) {
    assert.equal(permissions.canAccessPage(a, 'offers'), true);
    assert.equal(permissions.canDo(a, 'Settings', 'edit'), false);
  }
  assert.equal(permissions.canAccessPage(access(['pricing'], 'Settings', false), 'offers'), false);
  assert.equal(permissions.canAccessPage(access(['engagement'], 'Settings'), 'offers'), false);
  assert.equal(permissions.canAccessPage(access(['finance'], 'Communication'), 'offers'), false);
  assert.equal(permissions.canAccessPage(permissions.NO_ACCESS, 'offers'), false);
  assert.equal(permissions.canDo(access(['pricing'], 'Settings', true, ['view', 'edit']), 'Settings', 'edit'), true);
});

test('saved coupon and partner-statement shortcuts resolve without changing unrelated destinations', () => {
  assert.deepEqual(navigation.resolveAdminDestination('notifications', 'Coupons'), { page: 'offers' });
  assert.deepEqual(navigation.resolveAdminDestination('accounts', 'Partner statements:vendor:vendor-123'), { page: 'accounts', tab: 'Statements:vendor:vendor-123' });
  for (const [page, tab] of [['notifications', 'Inbox'], ['accounts', 'Tax payments'], ['categories', undefined]]) {
    assert.deepEqual(navigation.resolveAdminDestination(page, tab), { page, tab });
  }
});

test('editing an office campaign retains its private scope, terms and redemption history', async () => {
  writes.length = 0;
  const original = {
    id: 'existing-office', code: 'OFFICE100', name: 'Office offer', description: 'Internal offer',
    termsAndConditions: 'Approved office bookings only', adminBookingOnly: true, audience: 'Returning',
    discountType: 'FIXED_AMOUNT', discountValue: 100, status: 'Active', usedCount: 8, version: 4,
    totalUsageLimit: 50, perCustomerLimit: 2,
  };
  const draft = coupons.draftOf(original, ['sedan']);
  assert.equal(draft.adminBookingOnly, true);
  assert.equal(draft.description, original.description);
  assert.equal(draft.termsAndConditions, original.termsAndConditions);
  draft.reason = 'Update offer after review';
  await coupons.saveCoupon(draft, original, [{ id: 'sedan', name: 'Sedan' }]);
  assert.equal(writes.length, 1);
  const saved = writes[0];
  assert.deepEqual(saved.ref, { kind: 'coupons', id: original.id });
  assert.equal(saved.data.adminBookingOnly, true);
  assert.equal(saved.data.description, original.description);
  assert.equal(saved.data.termsAndConditions, original.termsAndConditions);
  assert.equal(saved.data.audience, original.audience);
  assert.equal(saved.data.version, 5);
  assert.equal(Object.hasOwn(saved.data, 'usedCount'), false);
  assert.equal(Object.hasOwn(saved.data, 'createdAt'), false);
  assert.equal(saved.data.history.union.length, 1);
});

test('new customer campaigns remain public-eligible while office-only is an explicit choice', async () => {
  const draft = coupons.emptyCouponDraft(['sedan']);
  assert.equal(draft.adminBookingOnly, false);
  Object.assign(draft, { code: 'NEW100', name: 'New offer', reason: 'Create offer after review' });
  assert.equal(coupons.validateDraft(draft, [], null, []), null);
  writes.length = 0;
  await coupons.saveCoupon(draft, null, [{ id: 'sedan', name: 'Sedan' }]);
  assert.equal(writes[0].data.usedCount, 0);
  assert.equal(writes[0].data.adminBookingOnly, false);
});

test('legacy, campaign, office-only and archived records each keep exactly one editor', () => {
  const stored = [
    { id: 'legacy-public', status: 'Active' },
    { id: 'legacy-office', status: 'Inactive', adminBookingOnly: true },
    { id: 'legacy-archived', status: 'Archived' },
    { id: 'campaign-public', audience: 'All', status: 'Active' },
    { id: 'campaign-office', audience: 'Returning', adminBookingOnly: true, status: 'Active' },
    { id: 'campaign-archived', audience: 'New', status: 'Archived' },
  ];
  const before = JSON.stringify(stored);
  const modern = stored.filter(isCampaignCoupon);
  const legacy = stored.filter(c => !isCampaignCoupon(c));
  assert.equal(modern.length, 3);
  assert.equal(legacy.length, 3);
  assert.deepEqual([...modern, ...legacy].map(c => c.id).sort(), stored.map(c => c.id).sort());
  assert.equal(new Set([...modern, ...legacy].map(c => c.id)).size, stored.length);
  assert.equal(JSON.stringify(stored), before);
});

test('pricing editors and the coupon workspace each have one owner; sidebar entries stay unique', () => {
  const counts = {};
  for (const file of fs.readdirSync(path.join(root, 'pages')).filter(f => f.endsWith('.tsx'))) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, 'pages', file), 'utf8'), 99, true, ts.ScriptKind.TSX);
    function walk(n) {
      if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
        const name = n.tagName.getText(source);
        if (['FareAdjustmentCard', 'TariffConfigCard', 'TaxPolicyDialog', 'CouponsPanel', 'StatementPicker'].includes(name)) (counts[name] ??= []).push(file);
      }
      ts.forEachChild(n, walk);
    }
    walk(source);
  }
  assert.deepEqual(counts.FareAdjustmentCard, ['Pricing.tsx']);
  // Base rates are edited only in BrandServiceFareWorkspace (inside Pricing.tsx); the older TariffConfigCard rate editor must not be mounted
  // a second time. (Its city-zone and documented-defaults tools currently have no screen - tracked in docs/PRODUCTION_READINESS.)
  assert.equal(counts.TariffConfigCard, undefined);
  assert.deepEqual(counts.TaxPolicyDialog, ['Invoices.tsx']);
  assert.deepEqual(counts.CouponsPanel, ['Offers.tsx']);
  assert.deepEqual(counts.StatementPicker, ['Accounts.tsx']);
  const ids = load('components/shell/navConfig.ts').NAV_GROUPS.flatMap(g => g.items.map(i => i.id));
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(ids.includes('categories'), false);
  assert.equal(permissions.canAccessPage(access(['pricing'], 'Settings'), 'categories'), true);
});
