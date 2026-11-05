// Isolated demo-nesam audit of the controls exposed by Service & Fare Settings.
const test = require('node:test'), assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const H = require('./helpers.e2e');
const { db, call, TS, rid, place, istInstant, rest } = H;
const A = 'fare-matrix-master', V = 'fare-matrix-vendor';
const brands = ['nesam', 'people_taxi', 'onewaycarrentals'];
const scopes = ['common', ...brands], services = ['One Way', 'Round Trip', 'Airport Taxi', 'Local Rental', 'Multicity'];
const classes = ['sedan', 'suv', 'innova', 'crysta'], names = ['Sedan', 'SUV 7+1', 'Innova', 'Innova Crysta'];
const hours = [4, 6, 8, 10, 12];
const report = { project: 'demo-nesam', productionModified: false, scopeCells: [], otherChecks: [], writes: 0, quotes: 0, bookings: 0, dispatches: 0 };
let routing, ordinal = 0;
const fixture = (brand, service, cls, n = 0) => {
  const k = classes.indexOf(cls), b = scopes.indexOf(brand), price = 20 + b * 5 + k;
  const data = { customerRate: price, partnerRate: price - 8, customerBata: 400 + b * 10 + k, partnerBata: 250 + b * 10 + k,
    minKm: service === 'Airport Taxi' ? 10 : 130, minKmPerDay: 250, customerBase: 1000 + b * 100 + k, partnerBase: 600 + b * 100 + k,
    extraKmRate: price + 3, waitingPerHour: 180 + b + k, hillCharge: 300 + b + k, carrierCharge: 200 + b + k,
    partnerWaitingPerHour: 100 + b + k, partnerHillCharge: 150 + b + k, partnerCarrierCharge: 90 + b + k,
    freeWaitingMinutes: 10, waitingRoundingMinutes: 5, waitingRoundingScope: 'per_stop', taxTreatment: 'tariff_gst', minRentalHours: cls === 'crysta' ? 10 : 4,
    rentalPackages: Object.fromEntries(hours.map(h => [h, { customerFare: 100 * h + b * 10 + k, partnerPayout: 70 * h + b * 10 + k, includedKm: h * 10, extraKmRate: price + 2, extraHourRate: 100 + b + k }])) };
  const keys = service === 'One Way' ? ['customerRate','partnerRate','customerBata','partnerBata','minKm','extraKmRate']
    : ['Round Trip','Multicity'].includes(service) ? ['customerRate','partnerRate','customerBata','partnerBata','minKmPerDay','extraKmRate']
    : service === 'Airport Taxi' ? ['customerBase','partnerBase','minKm','extraKmRate','partnerRate'] : ['minRentalHours','rentalPackages'];
  return Object.fromEntries([...keys, 'waitingPerHour','hillCharge','carrierCharge','partnerWaitingPerHour','partnerHillCharge','partnerCarrierCharge','freeWaitingMinutes','waitingRoundingMinutes','waitingRoundingScope','taxTreatment'].map(key => [key, data[key]]));
};
const ok = (r, label = '') => { assert.equal(r.ok, true, label + ': ' + JSON.stringify(r)); return r.data; };
async function save(brand, service, cls, data, extra = {}) {
  const version = (await db.doc('business_config/tariff_v2').get()).data().version;
  const result = ok(await call(A, 'saveTariffSection', { section: 'brandOverride', expectedVersion: version, brand, service, class: cls, data, reason: 'Isolated wiring matrix change', ...extra }), brand + '/' + service + '/' + cls);
  report.writes++; return result;
}
const customer = brand => 'fare-customer-' + brand;
function trip(service, index) {
  const pickup = { ...place('Matrix Theni', 10.0104, 77.4768), id: 'fare-origin' };
  const drop = { ...place(service === 'Airport Taxi' ? 'Matrix Airport' : 'Matrix Madurai', 9.9252, 78.1198), id: service === 'Airport Taxi' ? 'fare-airport' : 'fare-destination', type: service === 'Airport Taxi' ? 'airport' : 'other' };
  return { pickup, drop, scheduledAt: istInstant(2 + index * 2, '08:00'), tripEndAt: istInstant(2 + index * 2, '18:00'), rentalHours: 12, tripType: service };
}
async function staffQuote(brand, service, cls, index, saveTour = false) {
  report.quotes++;
  const actual = brand === 'common' ? 'nesam' : brand, t = trip(service, index);
  if (service === 'Multicity') {
    const id = `NSM-QT-${String(910000 + index)}`;
    const ref = db.doc(`enquiries/${id}`);
    if (!(await ref.get()).exists) {
      const stops = [{ ...place('Matrix Trichy', 10.7905, 78.7047), id: 'ordered-stop' }];
      await ref.set({ code: id, status: 'New', brand: actual, customerId: customer(actual), customerName: 'Matrix Rider', phone: '+919000000001', createdBy: customer(actual), serviceId: 'multicity', tripType: 'Multicity', service: 'Multicity', pickup: t.pickup.name, drop: t.drop.name, pickupPoint: t.pickup, dropPoint: t.drop, stops, itinerary: [t.pickup, ...stops, t.drop], pickupAt: TS.fromDate(new Date(t.scheduledAt)), tripEndAt: TS.fromDate(new Date(t.tripEndAt)) });
    }
    const q = ok(await call(A, 'priceMulticityEnquiry', { enquiryId: id, categoryId: 'fare-' + cls, save: true }), 'Multicity quote');
    const e = (await ref.get()).data(), frozen = (await db.doc(`multicity_quote_snapshots/${e.quoteRevision}`).get()).data();
    return { fare: frozen.fare, pricing: frozen.pricing, enquiryId: id, revision: e.quoteRevision, trip: t };
  }
  const q = ok(await call(A, 'createAdminBooking', { requestId: rid('fare_preview'), brand: actual, channel: actual, categoryId: 'fare-' + cls, quoteOnly: true,
    ...t, pickupPoint: t.pickup, dropPoint: t.drop, pickupLocationId: t.pickup.id }), 'Staff quote');
  return { fare: q.quote, pricing: q.pricing, trip: t };
}
function amounts(service, data, q) {
  if (service === 'One Way') return [Math.max(80, data.minKm) * data.customerRate + data.customerBata, Math.max(80, data.minKm) * data.partnerRate + data.partnerBata];
  if (service === 'Round Trip' || service === 'Multicity') return [Math.max(q.fare.distanceKm, data.minKmPerDay) * data.customerRate + data.customerBata, Math.max(q.fare.distanceKm, data.minKmPerDay) * data.partnerRate + data.partnerBata];
  if (service === 'Airport Taxi') return [data.customerBase + Math.max(0, 80 - data.minKm) * data.extraKmRate, data.partnerBase + Math.max(0, 80 - data.minKm) * data.partnerRate];
  return [data.rentalPackages[12].customerFare, data.rentalPackages[12].partnerPayout];
}
function check(service, data, q) {
  const [pre, payout] = amounts(service, data, q);
  // With no GST rule saved, the tariff's 5% GST is INCLUDED in the fare: the amount worked out from the edited rates is the total payable.
  assert.equal(q.pricing.gstInFare, true, 'default GST treatment is included');
  assert.equal(Math.round(q.fare.total * 100), Math.round(pre * 100), 'customer fare follows edited rates');
  assert.equal(q.pricing.partner.basePaise, Math.round(payout * 100), 'partner entitlement follows edited rates');
  assert.equal(q.pricing.extraKmRatePaise, (service === 'Local Rental' ? data.rentalPackages[12].extraKmRate : data.extraKmRate) * 100, 'extra KM price is snapshotted');
  const extras = q.pricing.extraCharges;
  assert.ok(extras, 'scoped extra charges must reach this service');
  for (const [key, expected] of Object.entries({ waitingPerHourPaise: data.waitingPerHour, hillPaise: data.hillCharge, carrierPaise: data.carrierCharge })) assert.equal(extras.customer[key], expected * 100, 'customer extra ' + key);
  for (const [key, expected] of Object.entries({ waitingPerHourPaise: data.partnerWaitingPerHour, hillPaise: data.partnerHillCharge, carrierPaise: data.partnerCarrierCharge })) assert.equal(extras.partner[key], expected * 100, 'partner extra ' + key);
  assert.equal(extras.freeWaitingMinutes, data.freeWaitingMinutes); assert.equal(extras.waitingRoundingMinutes, data.waitingRoundingMinutes);
  assert.equal(extras.roundingScope, data.waitingRoundingScope); assert.equal(extras.taxTreatment, data.taxTreatment);
}
async function publicQuote(brand, service, cls, t) {
  report.quotes++;
  const q = ok(await call(customer(brand), 'quoteBooking', { ...t, brand }), 'Customer quote ' + brand + '/' + service);
  const row = q.quotes.find(r => r.categoryId === 'fare-' + cls); assert.ok(row, 'configured category returned'); return row;
}
test.before(async () => {
  routing = await H.startRoutingStub();
  await db.doc(`admins/${A}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'Fare matrix master' });
  await db.doc('settings/config').set({ smsEnabled: false, emailEnabled: false, whatsappEnabled: false, pushEnabled: false });
  await db.doc('settings/operations').set({ bookingMinLeadMinutes: 0, bookingMaxAdvanceDays: 365 });
  await db.doc('business_config/commission').set({ base: 'taxable', global: { rate: 10 }, version: 1 });
  for (const brand of brands) await db.doc(`customers/${customer(brand)}`).set({ status: 'Approved', name: 'Matrix Rider', phone: '+919000000001' });
  await db.doc('locations/fare-origin').set({ name: 'Matrix Theni', type: 'City', city: 'Matrix Theni', state: '33', area: 'Matrix zone', status: 'Active', lat: 10.0104, lng: 77.4768 });
  await db.doc('locations/fare-destination').set({ name: 'Matrix Madurai', type: 'City', city: 'Matrix Madurai', state: '33', status: 'Active', lat: 9.9252, lng: 78.1198 });
  await db.doc('locations/fare-airport').set({ name: 'Matrix Airport', type: 'Airport', city: 'Matrix Madurai', state: '33', status: 'Active', lat: 9.9252, lng: 78.1198 });
  await db.doc(`vendors/${V}`).set({ status: 'APPROVED', companyName: 'Matrix Fleet', name: 'Matrix Fleet' });
  for (let k = 0; k < classes.length; k++) {
    const cls = classes[k], vehicleClass = ['sedan','suv7','innova7','crysta7'][k], dutyClass = ['sedan','suv7','innova','crysta'][k];
    await db.doc(`vehicle_categories/fare-${cls}`).set({ name: names[k], status: 'Active', tariffClass: cls, dutyClass, seatingCapacity: k ? 7 : 4, fare: { baseFare: 70, baseKm: 2, perKmRate: 16, minimumFare: 100 }, displayOrder: k });
    await db.doc(`vehicles/fare-vehicle-${cls}`).set({ vendorId: V, docStatus: 'Approved', status: 'Active', vehicleNumber: `TN01AA100${k}`, seatingCapacity: k ? 7 : 4, category: names[k], vehicleClass });
    await db.doc(`drivers/fare-driver-${cls}`).set({ status: 'Approved', vendorId: V, name: 'Matrix Driver', phone: '+919000000002', presenceStatus: 'Online', fleetStatus: 'Active', vehicleType: cls });
  }
  ok(await call(A, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Isolated fare matrix setup' }));
});
test.after(async () => {
  if (routing) await new Promise(resolve => routing.close(resolve));
  const folder = path.resolve(__dirname, '../../docs'); fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, 'service-fare-wiring-results.json');
  if (process.env.AUDIT_MERGE_REPORT === '1' && fs.existsSync(target)) {
    const previous = JSON.parse(fs.readFileSync(target,'utf8'));
    const key = x => `${x.brand}/${x.service}/${x.class}`, updated = new Set(report.scopeCells.map(key));
    report.scopeCells = [...previous.scopeCells.filter(x=>!updated.has(key(x))), ...report.scopeCells];
    for(const count of ['writes','quotes','bookings','dispatches']) report[count] += previous[count] || 0;
  }
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + '\n');
});

for (const brand of scopes) for (const service of services) for (const cls of classes) {
  const index = ordinal++;
  test(`scope ${brand} / ${service} / ${cls}: edit each control -> customer quote -> frozen booking -> vendor/driver`, { timeout: 240000 }, async () => {
    const entry = { brand, service, class: cls, fieldChanges: [], passed: false }; report.scopeCells.push(entry);
    try {
      const data = fixture(brand, service, cls);
      await save(brand, service, cls, data);
      let q = await staffQuote(brand, service, cls, index); check(service, data, q);
      // Every scalar field is edited and repriced separately; package cells are edited individually below.
      for (const key of Object.keys(data).filter(key => key !== 'rentalPackages')) {
        data[key] = typeof data[key] === 'number' ? data[key] + 1 : key === 'waitingRoundingScope' ? 'combined' : 'no_gst';
        await save(brand, service, cls, { [key]: data[key] });
        q = await staffQuote(brand, service, cls, index); check(service, data, q); entry.fieldChanges.push(key);
      }
      if (service === 'Local Rental') for (const h of hours) {
        for (const key of Object.keys(data.rentalPackages[h])) {
          data.rentalPackages[h][key] += 1;
          await save(brand, service, cls, { rentalPackages: data.rentalPackages }); entry.fieldChanges.push(`rentalPackages.${h}.${key}`);
        }
        q = await staffQuote(brand, service, cls, index); check(service, data, q);
        const specificResult = await call(A, 'createAdminBooking', { requestId: rid('rental_cell'), brand: brand === 'common' ? 'nesam' : brand, categoryId: 'fare-' + cls, quoteOnly: true, ...q.trip, rentalHours: h, pickupPoint: q.trip.pickup, dropPoint: q.trip.drop });
        if (h < data.minRentalHours) { assert.equal(specificResult.ok, false, 'below minimum package rejected'); continue; }
        const specific = ok(specificResult, 'Rental package cell');
        if (h >= data.minRentalHours) assert.equal(specific.quote.total, Math.round(data.rentalPackages[h].customerFare * 105) / 100);
      }
      const actual = brand === 'common' ? 'nesam' : brand;
      if (service !== 'Multicity') for (const webBrand of brand === 'common' ? brands : [actual]) {
        const row = await publicQuote(webBrand, service, cls, q.trip); assert.equal(row.ok, true, JSON.stringify(row)); assert.equal(row.fare.total, q.fare.total);
      }
      let id;
      if (service === 'Multicity') id = ok(await call(A, 'convertMulticityEnquiry', { enquiryId: q.enquiryId, expectedRevision: q.revision, customerName: 'Matrix Rider', phone: '+919000000001', paymentMethod: 'UPI', customerAccepted: true, acceptanceReference: 'Synthetic matrix customer agreement' })).id;
      else {
        const requestId = rid('matrix_booking');
        ok(await call(customer(actual), 'createBooking', { ...q.trip, requestId, categoryId: 'fare-' + cls, brand: actual, paymentMethod: 'UPI', expectedFare: q.fare.total, termsAccepted: true })); id = requestId;
      }
      report.bookings++;
      const before = (await db.doc(`bookings/${id}`).get()).data(), privateBefore = (await db.doc(`booking_pricing_private/${id}`).get()).data();
      assert.equal(before.fare, q.fare.total); assert.equal(before.pricing.partner, null); assert.equal(privateBefore.partner.basePaise, q.pricing.partner.basePaise);
      ok(await call(A, 'approveBooking', { bookingId: id }));
      ok(await call(A, 'assignVendor', { bookingId: id, vendorId: V, reason: 'Synthetic scope matrix dispatch' }));
      const assigned = (await db.doc(`bookings/${id}`).get()).data(); assert.equal(Math.round(assigned.vendorPayout * 100), privateBefore.partner.basePaise);
      ok(await call(V, 'vendorAssignDriver', { bookingId: id, driverId: 'fare-driver-' + cls, vehicleId: 'fare-vehicle-' + cls })); report.dispatches++;
      for (const uid of [customer(actual), V, 'fare-driver-' + cls]) {
        const visible = await rest(uid, `bookings/${id}`); assert.equal(visible.status, 200, uid + ' booking read');
        assert.equal(visible.body.fields.fare.doubleValue ?? Number(visible.body.fields.fare.integerValue), q.fare.total);
        assert.equal((await rest(uid, `booking_pricing_private/${id}`)).status, 403, 'private rates protected');
      }
      const changedKey = service === 'Airport Taxi' ? 'customerBase' : service === 'Local Rental' ? 'rentalPackages' : 'customerRate';
      if (changedKey === 'rentalPackages') data.rentalPackages[12].customerFare += 100; else data[changedKey] += 10;
      await save(brand, service, cls, { [changedKey]: data[changedKey] });
      const newer = await staffQuote(brand, service, cls, service === 'Multicity' ? index + 100 : index); assert.notEqual(newer.fare.total, before.fare, 'new quote changes');
      assert.equal((await db.doc(`bookings/${id}`).get()).data().fare, before.fare, 'existing fare stays locked');
      assert.equal((await db.doc(`booking_pricing_private/${id}`).get()).data().partner.basePaise, privateBefore.partner.basePaise, 'existing payout stays locked');
      entry.passed = true;
    } catch (error) { entry.error = error.message; console.error(JSON.stringify({ brand, service, cls, error: error.message })); throw error; }
  });
}



