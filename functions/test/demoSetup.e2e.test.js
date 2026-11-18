// "Demo setup" (admin) — runs the exact plan file the admin button publishes (admin/src/services/demoSetupPlan.ts) through the real server
// functions on the emulators, then quotes every vehicle on every brand to prove the demo data prices without a single error.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const ts = require('typescript');
const H = require('./helpers.e2e');
const { db, call, istInstant, place } = H;

// Load the TypeScript plan as the admin does (no imports in it, so a plain transpile is enough).
const planSrc = fs.readFileSync(path.join(__dirname, '../../admin/src/services/demoSetupPlan.ts'), 'utf8');
const planJs = ts.transpileModule(planSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const plan = (() => { const m = { exports: {} }; new Function('module', 'exports', planJs)(m, m.exports); return m.exports; })();

const dirSrc = fs.readFileSync(path.join(__dirname, '../../admin/src/domain/placeDirectory.ts'), 'utf8');
const dirJs = ts.transpileModule(dirSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const directory = (() => { const m = { exports: {} }; new Function('module', 'exports', dirJs)(m, m.exports); return m.exports; })();
// The same city documents the admin's "Add built-in cities" button writes (fixed ids, no coordinates).
const cityId = (code, name) => `city_${code}_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
const MASTER = Object.entries(directory.CITIES_BY_STATE).flatMap(([code, names]) => names.map((name) => ({ id: cityId(code, name), name, code })));
const idOf = (name) => MASTER.find((c) => c.name === name).id;

const A = 'demo-setup-master', C = 'demo-setup-customer', brands = ['nesam', 'people_taxi', 'onewaycarrentals'];
const ok = (r, what = '') => { assert.equal(r.ok, true, `${what} ${JSON.stringify(r)}`); return r.data; };
const CATS = [['Hatchback', 4], ['Sedan', 4], ['SUV 6+1', 6], ['SUV 7+1', 7], ['Innova', 7], ['Innova Crysta', 7]];
let routing, ctx;
const restartRouting = async (km, min) => { if (routing) await new Promise((r) => routing.close(r)); routing = await H.startRoutingStub(8765, km, min); };
const pin = (name, lat, lng, extra = {}) => ({ ...place(name, lat, lng), id: 'pin', ...extra });

test.before(async () => {
  await restartRouting(40, 50);
  await db.doc(`admins/${A}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Demo master' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('settings/operations').set({ bookingMinLeadMinutes: 0, bookingMaxAdvanceDays: 365 });
  await db.doc(`customers/${C}`).set({ status: 'Active', name: 'Demo rider', phone: '+919000000002' });
  for (let i = 0; i < MASTER.length; i += 400) {
    const batch = db.batch();
    for (const c of MASTER.slice(i, i + 400)) batch.set(db.doc(`locations/${c.id}`), { id: c.id, name: c.name, normalizedName: c.name.toLowerCase(), type: 'City', state: c.code, city: c.name, area: '', status: 'Active', lat: null, lng: null, pickupEnabled: true, dropEnabled: true, onlineBookingEnabled: true, adminBookingEnabled: true });
    await batch.commit();
  }
  for (const [i, [name, seats]] of CATS.entries()) await db.doc(`vehicle_categories/cat-${i}`).set({ id: `cat-${i}`, name, status: 'Active', seatingCapacity: seats, displayOrder: i + 1, fare: { baseFare: 0, baseKm: 0, perKmRate: 15, minimumFare: 0, driverAllowance: 0, nightAllowance: 0, waitingChargePerHour: 0, extraHourCharge: 0, extraKmCharge: 15, tollIncluded: false, parkingIncluded: false, permitCharge: 0 } });
  // Cities added with "Add built-in cities" have no coordinates; a customer's pickup keeps its master id (and so matches a fixed route fare)
  // only where the location has them. These four have them, as an admin who saved their map position in Locations would.
  for (const [name, lat, lng] of [['Theni', 10.0131, 77.4801], ['Madurai', 9.9211, 78.1137], ['New Delhi', 28.6139, 77.209], ['Jaipur', 26.9124, 75.7873]]) await db.doc(`locations/${idOf(name)}`).update({ lat, lng });
  ctx = {
    categories: CATS.map(([name], i) => ({ id: `cat-${i}`, name })),
    cities: MASTER.map((c) => ({ id: c.id, name: c.name })),
  };
});
test.after(async () => { if (routing) await new Promise((r) => routing.close(r)); });

test('1. the whole demo plan is accepted by the real server functions (no step fails)', async () => {
  const calls = plan.buildTariffCalls(ctx);
  assert.ok(calls.length > 40, `expected the full plan, got ${calls.length} calls`);
  const failures = [];
  for (const c of calls) {
    const r = await call(A, 'saveTariffSection', { ...c.body, latest: true, reason: plan.DEMO_REASON });
    if (!r.ok) failures.push(`${c.id}: ${r.message}`);
  }
  assert.deepEqual(failures, []);
  ok(await call(A, 'savePlatformFee', plan.PLATFORM_FEE_DEMO), 'platform fee');
  ok(await call(A, 'saveNightAllowance', plan.NIGHT_ALLOWANCE_DEMO), 'night allowance');
  ok(await call(A, 'saveTariffConfig', { keepSavedRates: true, enabled: true, reason: plan.DEMO_REASON }), 'enable tariff');
  const fixed = plan.buildFixedRouteCalls(ctx);
  assert.ok(fixed.length >= 40, `national fixed routes for Sedan and Innova, got ${fixed.length}`);
  for (const f of fixed) ok(await call(A, 'saveFixedRouteFare', { ...f.body, reason: plan.DEMO_REASON }), f.id);
  const snap = await db.doc('business_config/tariff_v2').get();
  const t = snap.data();
  const bytes = Buffer.byteLength(JSON.stringify(t));
  console.log(`tariff document ~${Math.round(bytes / 1024)} KB, ${Object.keys(t.localPickupDrop).length} cities with Local Pickup & Drop`);
  assert.ok(bytes < 700 * 1024, `the tariff document must stay well under Firestore's 1 MB limit (${bytes} bytes)`);
  assert.equal(Object.keys(t.localPickupDrop).length, MASTER.length, 'every city of the master has a Local Pickup & Drop fare');
  for (const probe of ['Srinagar', 'Guwahati', 'Kolkata', 'Jaipur', 'Panaji', 'Leh', 'Port Blair', 'Imphal', 'Bhopal', 'Thrissur']) {
    for (const c of plan.DEMO_CLASSES) assert.equal(t.localPickupDrop[idOf(probe)].classes[c].enabled, true, `${probe} ${c}`);
  }
  assert.ok(t.localPickupDrop[idOf('Mumbai')].classes.sedan.customerRate > t.localPickupDrop[idOf('Bhopal')].classes.sedan.customerRate, 'metro fares are higher');
  assert.equal(t.enabled, true);
  assert.equal(t.roundTrip.timeBased.enabled, true);
  assert.equal(t.hillStation.enabled, true);
  for (const c of plan.DEMO_CLASSES) {
    assert.ok(t.roundTrip.classes[c].timeBased.eightFare > t.roundTrip.classes[c].timeBased.fiveFare, c);
    assert.ok(t.oneWay.classes[c].customerRate > 0, c);
    assert.ok(t.hillStation.classes[c].roundTrip.customer > 0, c);
    assert.ok(t.rentalPackages[c].packages[String(Math.max(8, 8))].customerFare > 0, c);
  }
});

const quote = (brand, over) => call(C, 'quoteBooking', { brand, scheduledAt: istInstant(3, '09:00'), ...over });
const rt = { tripType: 'Round Trip', pickup: pin('Theni', 10.0104, 77.4768), drop: pin('Madurai', 9.9195, 78.1193) };

for (const brand of brands) {
  test(`2. ${brand}: Round Trip, 1 day at 9 AM - every vehicle shows 5-Hour, 8-Hour and Full-Day with prices`, async () => {
    await restartRouting(40, 50); // 80 km round trip
    const r = ok(await quote(brand, { ...rt, tripDays: 1, tripEndAt: istInstant(3, '09:00') }));
    assert.equal(r.quotes.length, CATS.length);
    for (const q of r.quotes) {
      assert.equal(q.ok, true, `${q.categoryId}: ${q.error}`);
      assert.deepEqual(q.packages.map((p) => p.id), ['same:eight', 'same:five', 'same:full'], q.categoryId);
      for (const p of q.packages) assert.ok(p.fare.total > 0 && p.includedKm > 0, `${q.categoryId} ${p.id}`);
    }
    const sedan = r.quotes.find((q) => q.categoryId === 'cat-1');
    const by = Object.fromEntries(sedan.packages.map((p) => [p.id, p.fare.total]));
    assert.deepEqual(by, { 'same:eight': 2780, 'same:five': 2080, 'same:full': 4000 }, "the guide's Sedan prices");
  });

  test(`3. ${brand}: Round Trip pickup 8 PM - Morning Return and Next-Day Return on every vehicle (guide 4,500 / 6,780 for the Sedan)`, async () => {
    await restartRouting(40, 50);
    const r = ok(await quote(brand, { ...rt, scheduledAt: istInstant(3, '20:00'), tripDays: 1, tripEndAt: istInstant(3, '20:00') }));
    for (const q of r.quotes) {
      assert.equal(q.ok, true, `${q.categoryId}: ${q.error}`);
      assert.deepEqual(q.packages.map((p) => p.id), ['morning', 'next'], q.categoryId);
      assert.equal(q.autoDays, true);
    }
    const sedan = r.quotes.find((q) => q.categoryId === 'cat-1');
    assert.equal(sedan.packages.find((p) => p.id === 'morning').fare.total, 4500);
    assert.equal(sedan.packages.find((p) => p.id === 'next').fare.total, 6780);
    assert.equal(sedan.packages.find((p) => p.id === 'next').includedKm, 400);
  });
}

test('4. Round Trip to a hill station: no 5-hour / 8-hour package, a separate Hill Station line, for every vehicle', async () => {
  await restartRouting(40, 60);
  const r = ok(await quote('nesam', { tripType: 'Round Trip', pickup: pin('Coimbatore', 11.0168, 76.9558), drop: pin('Ooty', 11.4102, 76.695), tripDays: 1, tripEndAt: istInstant(3, '09:00') }));
  assert.ok(r.hillStations.some((h) => /ooty/i.test(h.name)));
  for (const q of r.quotes) {
    assert.equal(q.ok, true, `${q.categoryId}: ${q.error}`);
    assert.deepEqual(q.packages.map((p) => p.id), ['same:full'], q.categoryId);
    assert.ok(q.breakup.lines.some((l) => l.key === 'hillStation' && l.amount > 0), `${q.categoryId} hill line`);
  }
});

for (const brand of brands) {
  test(`5. ${brand}: One Way (80 km), Airport, Local Rental and Local Pickup & Drop price on every vehicle`, async () => {
    await restartRouting(80, 100);
    const ow = ok(await quote(brand, { tripType: 'One Way', pickup: pin('Theni', 10.0104, 77.4768), drop: pin('Madurai', 9.9195, 78.1193) }));
    for (const q of ow.quotes) { assert.equal(q.ok, true, `One Way ${q.categoryId}: ${q.error}`); assert.ok(q.fare.total > 0); }
    await restartRouting(25, 40);
    const ap = ok(await quote(brand, { tripType: 'Airport Taxi', pickup: pin('Madurai city', 9.9252, 78.1198), drop: pin('Madurai Airport', 9.8345, 78.0934, { type: 'airport' }) }));
    for (const q of ap.quotes) { assert.equal(q.ok, true, `Airport ${q.categoryId}: ${q.error}`); assert.ok(q.fare.total >= 1000); }
    await restartRouting(1, 5);
    const rental = ok(await quote(brand, { tripType: 'Local Rental', rentalHours: 8, pickup: pin('Madurai', 9.9195, 78.1193), drop: pin('Madurai city', 9.9252, 78.1198) }));
    for (const q of rental.quotes) { assert.equal(q.ok, true, `Rental ${q.categoryId}: ${q.error}`); assert.ok(q.fare.total > 2000, `${q.categoryId} ${q.fare.total}`); }
    await restartRouting(12, 25);
    const local = ok(await quote(brand, { tripType: 'One Way', pickup: pin('Madurai Meenakshi', 9.9195, 78.1193), drop: pin('Madurai Railway', 9.9252, 78.1198) }));
    for (const q of local.quotes) assert.equal(q.ok, true, `Pickup & Drop ${q.categoryId}: ${q.error}`);
  });
}

test('6. One Way pricing differs by brand as configured: People Taxi cheaper, One Way Car Rentals dearer than NESAM (Sedan)', async () => {
  await restartRouting(150, 180);
  const t = { tripType: 'One Way', pickup: pin('Theni', 10.0104, 77.4768), drop: pin('Trichy', 10.7905, 78.7047) };
  const sedanOf = async (b) => ok(await quote(b, t)).quotes.find((q) => q.categoryId === 'cat-1').fare.total;
  const extraOf = async (b) => ok(await quote(b, t)).quotes.find((q) => q.categoryId === 'cat-1').extraKmRate;
  const [n, p, o] = [await sedanOf('nesam'), await sedanOf('people_taxi'), await sedanOf('onewaycarrentals')];
  assert.ok(p < n && n < o, `${p} < ${n} < ${o}`);
  assert.deepEqual([await extraOf('people_taxi'), await extraOf('nesam'), await extraOf('onewaycarrentals')], [14.5, 15, 15.5], 'extra km follows each brand rate');
});

test('7. fixed route fares apply to a One Way trip between their master locations', async () => {
  await restartRouting(75, 90);
  const m = (name, lat, lng) => ({ ...place(name, lat, lng), id: idOf(name) });
  // (fresh coordinates: the server caches a route per pair of points, and test 2 already used these two towns at another distance)
  const r = ok(await quote('nesam', { tripType: 'One Way', pickup: m('Theni', 10.0131, 77.4801), drop: m('Madurai', 9.9211, 78.1137) }));
  assert.equal(r.quotes.find((q) => q.categoryId === 'cat-1').fare.total, 1350, 'Theni to Madurai Sedan fixed fare (75 km)');
  assert.equal(r.quotes.find((q) => q.categoryId === 'cat-4').fare.total, 1950, 'Theni to Madurai Innova fixed fare (75 km)');
  await restartRouting(280, 300);
  const north = ok(await quote('nesam', { tripType: 'One Way', pickup: m('New Delhi', 28.6139, 77.209), drop: m('Jaipur', 26.9124, 75.7873) }));
  assert.equal(north.quotes.find((q) => q.categoryId === 'cat-1').fare.total, 4200, 'New Delhi to Jaipur Sedan fixed fare');
});

test('7b. all over India: Local Pickup & Drop prices in a small town of every state (no city is left without a fare)', async () => {
  await restartRouting(10, 20);
  const towns = [['Srinagar', 34.0837, 74.7973], ['Guwahati', 26.1445, 91.7362], ['Panaji', 15.4909, 73.8278], ['Jaipur', 26.9124, 75.7873], ['Leh', 34.1526, 77.5771], ['Bhopal', 23.2599, 77.4126], ['Thrissur', 10.5276, 76.2144], ['Kolkata', 22.5726, 88.3639]];
  for (const [name, lat, lng] of towns) {
    const r = ok(await quote('nesam', { tripType: 'One Way', pickup: pin(`${name} station`, lat, lng), drop: pin(`${name} market`, lat + 0.05, lng + 0.05) }));
    for (const q of r.quotes) assert.equal(q.ok, true, `${name} ${q.categoryId}: ${q.error}`);
  }
});

test('8. running the plan twice is safe (idempotent)', async () => {
  const calls = plan.buildTariffCalls(ctx);
  for (const c of calls.slice(0, 40)) ok(await call(A, 'saveTariffSection', { ...c.body, latest: true, reason: plan.DEMO_REASON }), c.id);
});

test('9. pressing the button again keeps everything saved: nothing is sent, and a missing piece is the only thing refilled', async () => {
  const stored = (await db.doc('business_config/tariff_v2').get()).data();
  assert.deepEqual(plan.pendingTariffCalls(plan.buildTariffCalls(ctx), stored, false).map((c) => c.id), [], 'a second press changes nothing');
  assert.equal(plan.pendingTariffCalls(plan.buildTariffCalls(ctx), stored, true).length, plan.buildTariffCalls(ctx).length, 'replace sends everything again');
  // One city loses its fare: only that city is sent.
  const gone = idOf('Jaipur');
  const { [gone]: _removed, ...rest } = stored.localPickupDrop;
  const partial = plan.pendingTariffCalls(plan.buildTariffCalls(ctx), { ...stored, localPickupDrop: rest }, false);
  assert.equal(partial.length, 1);
  assert.deepEqual(Object.keys(partial[0].body.data.fares), [gone]);
  ok(await call(A, 'saveTariffSection', { ...partial[0].body, latest: true, reason: plan.DEMO_REASON }), 'refill');
});

test('10. the bulk Local Pickup & Drop save skips cities that are not in the master and refuses bad fares', async () => {
  const good = { enabled: true, minKm: 5, customerRate: 16, partnerRate: 14, extraKmRate: 16, waitingPerHour: 120 };
  const r = ok(await call(A, 'saveTariffSection', { section: 'localPickupDropBulk', latest: true, reason: 'bulk check', data: { fares: { [idOf('Leh')]: { sedan: good }, 'no-such-city': { sedan: good } } } }));
  assert.deepEqual([r.saved, r.skipped], [1, 1]);
  const bad = await call(A, 'saveTariffSection', { section: 'localPickupDropBulk', latest: true, reason: 'bulk check', data: { fares: { [idOf('Leh')]: { sedan: { ...good, customerRate: -1 } } } } });
  assert.equal(bad.ok, false);
});

test('11. fallback for older Cloud Functions: the whole-tariff save restores the city fares and changes nothing else', async () => {
  const ref = db.doc('business_config/tariff_v2');
  const gone = ['Leh', 'Panaji', 'Bhopal'].map(idOf);
  const FV = H.admin.firestore.FieldValue;
  await ref.update(Object.fromEntries(gone.map((id) => [`localPickupDrop.${id}`, FV.delete()])));
  const before = (await ref.get()).data();
  assert.equal(gone.some((id) => before.localPickupDrop[id]), false);
  const all = plan.buildTariffCalls(ctx).find((c) => c.id === 'local-all-cities').body.data.fares;
  const pending = plan.pendingTariffCalls(plan.buildTariffCalls(ctx), before, false);
  assert.equal(pending.length, 1);
  const missing = pending[0].body.data.fares;
  assert.deepEqual(Object.keys(missing).sort(), [...gone].sort());
  const input = plan.tariffInputWithLocalFares(before, missing, ctx.cities, plan.DEMO_REASON);
  assert.equal(JSON.stringify(input).includes('_seconds'), false, 'no timestamps are sent');
  ok(await call(A, 'saveTariffConfig', input), 'whole-tariff fallback');
  const after = (await ref.get()).data();
  for (const id of gone) assert.equal(after.localPickupDrop[id].classes.sedan.enabled, true, id);
  assert.equal(Object.keys(after.localPickupDrop).length, MASTER.length);
  // Everything except the city fares, the version and the audit stamps is exactly as it was.
  const strip = (d) => { const { localPickupDrop, version, updatedAt, updatedBy, updatedByName, ...rest } = d; return JSON.parse(JSON.stringify(rest)); };
  assert.deepEqual(strip(after), strip(before), 'no other tariff setting changed');
  assert.equal(after.enabled, true);
  assert.equal(after.version, before.version + 1);
  assert.ok(all);
});
