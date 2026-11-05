// Drives the REAL Driver website (not the preview harness) in headless Edge against the Firebase emulators (demo project,
// nothing can reach production): sign-in with an emulator custom token, live Firestore subscriptions, real callables and
// real security rules. It walks a trip from the photo-check state to the receipt, refused steps (no location, too far,
// offline, wrong OTP, too early) and a bid on a bid-only duty.
//
// From functions/ (the functions emulator reads functions/.env — see the note in the implementation report):
//   npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json --project demo-nesam --only auth,firestore,functions //     "node ../driver/web/e2e/driver-journey.e2e.cjs"
// Needs Microsoft Edge (set EDGE_PATH to override the default Windows location) and free ports 3012, 9337, 9338, 8765.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '../../..').split(path.sep).join('/');
const H = require(`${ROOT}/functions/test/helpers.e2e.js`);
const { db, TS, call, inHours, place, rid, bookAs, booking, admin } = H;
const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = process.env.E2E_SHOTS || `${ROOT}/output/driver-ui-screenshots/after/web-e2e`;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const U = { admin: 'e2eAdmin', cust: 'e2eCust', owner: 'e2eOwner', bidder: 'e2eBidder' };
const PICKUP = { lat: 10.0104, lng: 77.4768 };

async function seed() {
  const fare = { baseFare: 70, baseKm: 2, perKmRate: 16, perMinuteRate: 1.75, minimumFare: 100, nightAllowance: 50, outstationDriverBattaPerDay: 400, outstationPerKmRate: 13 };
  await db.doc('vehicle_categories/sedan').set({ name: 'Sedan', status: 'Active', code: 'sedan', seatingCapacity: 4, displayOrder: 1, fare });
  await db.doc(`admins/${U.admin}`).set({ role: 'admin', status: 'active', staffRole: 'super_admin', name: 'E2E Admin' });
  await db.doc(`customers/${U.cust}`).set({ status: 'Approved', name: 'Priya Raman', phone: '+919876543210', email: 'p@example.com', walletBalance: 0 });
  for (const [uid, veh, plate, name] of [[U.owner, 'vehE2eOwner', 'TN03EF9003', 'Selvam'], [U.bidder, 'vehE2eBidder', 'TN03EF9004', 'Babu']]) {
    await db.doc(`vehicles/${veh}`).set({ vendorId: '', docStatus: 'Approved', status: 'Active', vehicleNumber: plate, seatingCapacity: 4, make: 'Maruti', model: 'Dzire', assignedDriverId: uid });
    await db.doc(`drivers/${uid}`).set({ status: 'Approved', docStatus: 'Approved', name, phone: '+919791234569', presenceStatus: 'Online', fleetStatus: 'Active', assignedVehicleId: veh, assignedVehicleNumber: plate, rating: 4.5, ratingCount: 9 });
  }
  const r = await call(U.admin, 'saveTariffConfig', { useConfirmedDefaults: true, enabled: true, reason: 'Emulator setup' });
  if (!r.ok) throw new Error('tariff ' + JSON.stringify(r));
  await db.doc('settings/operations').set({ tripStartWindowMinutes: 120, pickupRadiusKm: 3 });
}

async function assignedBooking(hours, driver = U.owner) {
  const b = await bookAs(U.cust, { scheduledAt: inHours(hours), pickup: place('Theni', PICKUP.lat, PICKUP.lng) });
  if (!b.ok) throw new Error('book ' + JSON.stringify(b));
  const a = await call(U.admin, 'approveBooking', { bookingId: b.requestId });
  if (!a.ok) throw new Error('approve ' + JSON.stringify(a));
  const s = await call(U.admin, 'assignDriver', { bookingId: b.requestId, driverId: driver });
  if (!s.ok) throw new Error('assign ' + JSON.stringify(s));
  return b.requestId;
}

class Browser {
  async start(port) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-e2e-'));
    this.edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
    let t;
    for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (t.some((x) => x.type === 'page')) break; } catch { /* starting */ } await sleep(250); }
    this.ws = new WebSocket(t.find((x) => x.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => (this.ws.onopen = r));
    this.id = 0; this.pend = new Map(); this.console = [];
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pend.has(d.id)) { this.pend.get(d.id)(d); this.pend.delete(d.id); }
      else if (d.method === 'Runtime.exceptionThrown') this.console.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 200));
    };
    await this.send('Page.enable'); await this.send('Runtime.enable'); await this.send('Network.enable');
  }
  send(method, params = {}) { return new Promise((res) => { const i = ++this.id; this.pend.set(i, res); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async ev(expr) { const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception?.description || '').slice(0, 200)); return r.result.result.value; }
  async waitFor(expr, what, ms = 25000) { const t0 = Date.now(); for (;;) { try { if (await this.ev(expr)) return true; } catch { /* page navigating */ } if (Date.now() - t0 > ms) { console.log('   timeout waiting for', what); return false; } await sleep(300); } }
  text() { return this.ev('document.body.innerText'); }
  async has(s, ms = 25000) { return this.waitFor(`document.body.innerText.includes(${JSON.stringify(s)})`, s, ms); }
  async click(label, scope = 'button,a') { return this.ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.textContent.trim().includes(${JSON.stringify(label)})&&!b.disabled);if(!e)return false;e.click();return true})()`); }
  async swipe() {
    // wait until the slider exists and is enabled (it is disabled while an action runs or a precondition is missing)
    const ready = await this.waitFor(`(()=>{const i=document.querySelector('.nx-swipe input[type=range]');return !!i&&!i.disabled&&!document.querySelector('.nx-swipe.is-complete')})()`, 'enabled slider', 8000);
    if (!ready) { console.log('   (slider not enabled)'); return false; }
    return this.ev(`(()=>{const i=document.querySelector('.nx-swipe input[type=range]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:10}));set.call(i,100);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return true})()`);
  }
  async fill(sel, val) { return this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return false;const set=Object.getOwnPropertyDescriptor(e.constructor.prototype,'value').set;set.call(e,${JSON.stringify(val)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); }
  async shot(name, width = 390, height = 844) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    await sleep(500);
    const m = await this.send('Page.getLayoutMetrics');
    const h = Math.min(5000, Math.ceil(m.result.cssContentSize?.height || height));
    await this.send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile: width < 700 });
    await sleep(300);
    const s = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}-${width}.png`), Buffer.from(s.result.data, 'base64'));
  }
  async geo(lat, lng) { await this.send('Emulation.setGeolocationOverride', { latitude: lat, longitude: lng, accuracy: 20 }); }
  async stop() { try { this.ws.close(); } catch { /* closed */ } this.edge.kill(); }
}

async function signIn(b, uid, port) {
  const token = await admin.auth().createCustomToken(uid);
  await b.send('Page.navigate', { url: `http://localhost:${port}/` });
  await b.waitFor(`typeof window.__nesamTestSignIn === 'function'`, 'test sign-in hook');
  await b.ev(`window.__nesamTestSignIn(${JSON.stringify(token)}).then(()=>true)`);
}

(async () => {
  const stub = await H.startRoutingStub();
  await seed();
  const bookingA = await assignedBooking(1.5); // inside the 2 h window
  const bookingB = await assignedBooking(20);  // outside it
  console.log('seeded', bookingA, bookingB);

  const PORT = 3012;
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: `${ROOT}/driver/web`, shell: true, stdio: 'ignore',
    env: { ...process.env, VITE_USE_FIREBASE_EMULATORS: 'true', VITE_FIREBASE_PROJECT_ID: 'demo-nesam' },
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/`)).ok) break; } catch { /* starting */ } await sleep(500); }

  const b = new Browser();
  await b.start(9337);
  try {
    await b.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: `http://localhost:${PORT}` }).catch(() => null);
    await b.geo(PICKUP.lat, PICKUP.lng);
    await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await signIn(b, U.owner, PORT);

    // ── Home with real data
    check('signed-in driver reaches the workspace with live data', await b.has('Your next trip'));
    check('Poppins is the loaded face', await b.ev(`[...document.fonts].some(f=>f.family.includes('Poppins')&&f.status==='loaded')`));
    check('Home shows the credited-earnings and wallet figures from the real ledger/wallet', (await b.text()).includes('Wallet balance'));
    await b.shot('01-home');

    // ── Booking B (outside the window): the screen explains why arrival is not open yet
    await b.click('My Trips');
    await b.has('Upcoming (2)');
    check('My Trips lists both assigned duties', (await b.text()).includes('Upcoming (2)'));
    await b.ev(`(()=>{const cards=[...document.querySelectorAll('.next-card')];cards[cards.length-1].querySelector('button').click()})()`);
    check('trip opens with the photo checklist (preparation)', await b.has('Before you start'));
    check('preparation text names the real window, not an invented one', (await b.text()).includes('Marking arrival opens'));
    await b.shot('02-trip-prepare');
    // photos done for B (the camera flow itself needs a device; its server session is covered in the emulator suite)
    await db.doc(`bookings/${bookingB}`).update({ vehicleVerification: { status: 'Submitted' } });
    check('arrival slider is disabled outside the window and says why', await b.waitFor(`!!document.querySelector('.nx-swipe.is-disabled, .nx-swipe input:disabled')`, 'disabled swipe') && (await b.text()).includes('6 hours') === false && (await b.text()).includes('2 hours before the pickup time'));
    await b.shot('03-trip-arrival-closed');
    await b.click('My Trips', 'button.trip-back');

    // ── Booking A (inside the window): the real flow
    await b.has('Upcoming (2)');
    await b.ev(`(()=>{const cards=[...document.querySelectorAll('.next-card')];cards[0].querySelector('button').click()})()`);
    await b.has('Before you start');
    await db.doc(`bookings/${bookingA}`).update({ vehicleVerification: { status: 'Submitted' } });
    await db.doc(`vehicle_verifications/${bookingA}`).set({ driverId: U.owner, status: 'Submitted', odometerReading: 1000, riskLevel: 'low', submittedAt: TS.now() });
    check('inside the window the arrival slider is available', await b.has('Reached the location?') && !(await b.text()).includes('Marking arrival opens'));

    // permission denied → clear message, nothing recorded, slider recovers
    await b.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: `http://localhost:${PORT}` }).catch(() => null);
    await b.swipe();
    const noLoc = await b.has('location', 8000);
    await sleep(1500);
    check('location permission denied → server message shown, trip not advanced', (await booking(bookingA)).tripSubStatus !== 'Reached Pickup');
    await b.shot('04-error-location-denied');
    await b.send('Browser.resetPermissions').catch(() => null);
    await b.send('Browser.grantPermissions', { permissions: ['geolocation'], origin: `http://localhost:${PORT}` });
    console.log('   geolocation permission now:', await b.ev(`navigator.permissions.query({name:'geolocation'}).then(r=>r.state)`));

    // too far from the pickup → server distance message
    await b.geo(PICKUP.lat + 0.5, PICKUP.lng + 0.5);
    await sleep(16000); // the browser may reuse a position up to 15 s old (maximumAge), so let the previous reading expire
    await b.swipe();
    check('far from the pickup → "km from the pickup point" message', await b.has('km from the pickup point', 12000));
    check('a refused step records nothing', (await booking(bookingA)).tripSubStatus !== 'Reached Pickup');
    await b.shot('05-error-too-far');

    // network failure → message, retry succeeds, one transition
    await b.geo(PICKUP.lat, PICKUP.lng);
    await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await b.swipe();
    await sleep(2500);
    await b.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(1000);
    check('offline attempt does not advance the trip', (await booking(bookingA)).tripSubStatus !== 'Reached Pickup');
    await b.swipe();
    const reached = await b.has('Boarding OTP', 20000);
    check('Reached Pickup succeeds with a real position, then Boarding OTP appears', reached);
    check('exactly one server transition recorded', (await booking(bookingA)).tripSubStatus === 'Reached Pickup');
    await b.shot('06-boarding-otp');

    // boarding OTP: wrong then right
    await b.fill('.nx-otp-input', '0000');
    await b.click('Verify & Continue');
    check('wrong OTP → server message with attempts left', await b.has('attempt', 12000));
    const otp = (await db.doc(`booking_secrets/${bookingA}`).get()).data().otp;
    await b.fill('.nx-otp-input', otp);
    await b.click('Verify & Continue');
    check('correct OTP verified', await b.has('OTP verified', 15000));

    // start the passenger journey
    await b.swipe();
    check('Trip Started (server) → "Trip in progress"', await b.has('Trip in progress', 20000));
    check('booking is Ongoing on the server', (await booking(bookingA)).status === 'Ongoing');
    await b.shot('07-trip-in-progress');

    // end: kilometres, toll receipt dialog opens, payment record, review, close
    await b.swipe();
    check('slide to end opens the closing form', await b.has('Enter trip distance'));
    await b.fill('.nx-km-control input', '88');
    await b.fill('#collect-amount', '500');
    await b.click('Record payment');
    check('driver-collected payment recorded through the server', await b.has('recorded as collected by you', 15000));
    check('payment exists on the booking ledger', (await db.collection(`bookings/${bookingA}/payment_transactions`).get()).docs.some((d) => d.data().amount === 500 && d.data().collectorType === 'driver'));
    await b.shot('08-closing-form');
    await b.click('Review & Close');
    check('review shows the distance and balance', await b.has('Close this trip?'));
    await b.click('Confirm & Close');
    check('Trip End recorded → receipt', await b.has('Trip completed', 25000));
    const done = await booking(bookingA);
    check('booking Completed with the km the driver entered', done.status === 'Completed' && done.totalKm === 88, `status=${done.status} km=${done.totalKm}`);
    await b.shot('09-receipt');
    await b.shot('09-receipt', 1440, 900);

    // desktop sanity on real data
    await b.click('My Trips', 'button.trip-back');
    await b.has('Completed (1)');
    await b.shot('10-my-trips', 1440, 900);

    // ── marketplace: a bid-only duty offers a bid, not "Accept"
    const b2 = await bookAs(U.cust, { scheduledAt: inHours(90), pickup: place('Madurai', 9.9195, 78.1193) });
    await call(U.admin, 'approveBooking', { bookingId: b2.requestId });
    await call(U.admin, 'postBookingToMarketplace', { booking: b2.requestId, mode: 'bid_review' });
    await b.stop();
    const c = new Browser();
    await c.start(9338);
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await signIn(c, U.bidder, PORT);
    check('a driver with no trip sees the open duty', await c.has('Available duties') && await c.has('Bid', 15000));
    await c.shot('11-home-with-bid-duty');
    await c.click('View details');
    check('bid-only duty offers a counter-amount form, not Accept', await c.has('Send bid for review') && !(await c.text()).includes('Accept duty'));
    await c.fill('#bid-rate', '1700');
    await c.click('Send bid for review');
    await c.waitFor(`!!(document.querySelector('.toast.show')&&document.querySelector('.toast.show').textContent.trim())`, 'a toast', 40000);
    check('a counter above the customer fare is refused and the server message is shown', ((await c.ev(`document.querySelector('.toast.show')?.textContent||''`)).includes('cannot exceed the customer fare')));
    await c.shot('11b-bid-refused');
    await c.fill('#bid-rate', '90');
    await c.click('Send bid for review');
    check('a valid counter is accepted and confirmed on screen', await c.has('Bid sent', 40000));
    await sleep(500);
    check('the dialog closes after a sent bid', await c.ev(`!document.querySelector('dialog[open]')`));
    const bid = (await db.doc(`marketplace_trips/${b2.requestId}/bids/driver_${U.bidder}`).get()).data();
    check('bid stored for admin review through the real callable', bid && bid.status === 'Pending Review' && bid.vendorCounterRate === 90, JSON.stringify(bid && { s: bid.status, r: bid.vendorCounterRate }));
    await c.stop();
  } catch (e) {
    console.log('E2E ERROR', e.stack || e);
    results.push({ name: 'harness', ok: false });
  } finally {
    console.log('browser exceptions:', b.console.length ? b.console.join(' | ') : 'none');
    try { await b.stop(); } catch { /* stopped */ }
    vite.kill();
    spawn('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
    await new Promise((r) => stub.close(r));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\nUI E2E: ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
