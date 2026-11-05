// HTTP API checks that need no Firebase project: routing, auth gate, CORS, error mapping,
// cron secret and webhook signature. Run: npm run test:http (after npm run build).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { Readable } = require('node:stream');

process.env.ALLOWED_ORIGINS = 'https://customer.example.com,https://*.preview.example.com';
process.env.CRON_SECRET = 'cron-secret-0123456789abcdef';
process.env.WHATSAPP_APP_SECRET = 'wa-secret';
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';

// Stand-in for token verification: "good:<uid>" is valid, anything else is rejected.
const adminAuth = require('firebase-admin/auth');
adminAuth.getAuth = () => ({
  verifyIdToken: async (t) => {
    const m = /^good:(.+)$/.exec(t);
    if (!m) throw new Error('invalid token');
    return { uid: m[1], phone_number: '+910000000000' };
  },
});

const { handler: call } = require('../lib/http/call');
const { health, whatsappWebhook, razorpayWebhook, cronAlerts, cronReconcile } = require('../lib/http/other');
const { CALLABLES } = require('../lib/registry');
const firebaseExports = require('../lib/index');

test('every HTTP callable is also exported for Firebase deployment', () => {
  for (const [name, fn] of Object.entries(CALLABLES)) {
    assert.equal(firebaseExports[name], fn, `${name} is missing from the Firebase entry point`);
  }
});

/** Minimal request / response doubles with the surface the handlers use. */
function run(fn, { method = 'POST', headers = {}, query = {}, body, raw, rawBody } = {}) {
  const req = raw !== undefined ? Readable.from([Buffer.from(raw)]) : Readable.from([]);
  Object.assign(req, { method, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), query, body, rawBody });
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(chunk) { resolve({ status: this.statusCode, headers: this.headers, body: chunk ? String(chunk) : '' }); },
    };
    Promise.resolve(fn(req, res)).catch(reject);
  });
}
const json = (r) => JSON.parse(r.body);

test('health', async () => {
  const r = await run(health, { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(json(r).ok, true);
});

test('Razorpay webhook accepts signed raw bytes on both hosting transports', async () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = 'test-webhook-secret';
  const raw = JSON.stringify({ event: 'unhandled.event', payload: {} });
  const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  const headers = { 'x-razorpay-signature': signature };
  assert.equal(typeof firebaseExports.razorpayWebhook, 'function');
  assert.equal(Object.hasOwn(CALLABLES, 'razorpayWebhook'), false);
  assert.equal((await run(razorpayWebhook, { raw, headers })).status, 200);
  assert.equal((await run(razorpayWebhook, { rawBody: Buffer.from(raw), body: JSON.parse(raw), headers })).status, 200);
  assert.equal((await run(razorpayWebhook, { rawBody: Buffer.from(raw + ' '), headers })).status, 403);
  assert.equal((await run(razorpayWebhook, { rawBody: Buffer.alloc(1_000_001), headers })).status, 413);
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

test('CORS: allowed origins only, preflight answered', async () => {
  const ok = await run(call, { method: 'OPTIONS', headers: { origin: 'https://customer.example.com' }, query: { name: 'createBooking' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['access-control-allow-origin'], 'https://customer.example.com');
  const wild = await run(call, { method: 'OPTIONS', headers: { origin: 'https://pr-12.preview.example.com' }, query: { name: 'x' } });
  assert.equal(wild.headers['access-control-allow-origin'], 'https://pr-12.preview.example.com');
  const deep = await run(call, { method: 'OPTIONS', headers: { origin: 'https://a.b.preview.example.com' }, query: { name: 'x' } });
  assert.equal(deep.headers['access-control-allow-origin'], undefined);
  const evil = await run(call, { method: 'OPTIONS', headers: { origin: 'https://evil.example.net' }, query: { name: 'x' } });
  assert.equal(evil.headers['access-control-allow-origin'], undefined);
});

test('CORS: admin/customer preflight for getLegalStatus / quoteBooking / approveBooking, errors stay readable', async () => {
  const origin = 'https://customer.example.com'; // stands in for the exact Admin origin in ALLOWED_ORIGINS
  const preflight = { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type,x-client-request-id' } };
  for (const name of ['getLegalStatus', 'quoteBooking', 'approveBooking']) {
    // Preflight never needs a token.
    const p = await run(call, { ...preflight, query: { name } });
    assert.equal(p.status, 204, name);
    assert.equal(p.headers['access-control-allow-origin'], origin, name);
    assert.match(p.headers['access-control-allow-headers'], /X-Client-Request-Id/i, name);
    assert.equal(p.headers['vary'], 'Origin', name);
    assert.match(p.headers['access-control-allow-methods'], /POST/, name);
    assert.match(p.headers['access-control-allow-headers'], /Authorization/i, name);
    assert.match(p.headers['access-control-allow-headers'], /Content-Type/i, name);
    // Public fare previews reach input validation; account and booking actions still require sign-in.
    const noToken = await run(call, { headers: { origin }, query: { name } });
    assert.equal(noToken.status, name === 'quoteBooking' ? 400 : 401, name);
    assert.equal(json(noToken).error.code, name === 'quoteBooking' ? 'invalid-argument' : 'unauthenticated', name);
    assert.equal(noToken.headers['access-control-allow-origin'], origin, name);
    const fake = await run(call, { headers: { origin, authorization: 'Bearer fake' }, query: { name } });
    assert.equal(fake.status, 401, name);
    assert.equal(json(fake).error.code, 'unauthenticated', name);
    assert.equal(fake.headers['access-control-allow-origin'], origin, name);
    // An origin outside the allow-list gets no permission-granting header on either leg.
    const evil = await run(call, { ...preflight, headers: { ...preflight.headers, origin: 'https://evil.vercel.app' }, query: { name } });
    assert.equal(evil.headers['access-control-allow-origin'], undefined, name);
  }
});

test('only POST; unknown and prototype names are 404', async () => {
  assert.equal((await run(call, { method: 'GET', query: { name: 'createBooking' } })).status, 405);
  for (const name of ['nope', '__proto__', 'constructor', 'toString', 'onBookingCancelled', 'unassignedBookingAlerts', 'whatsappWebhook']) {
    const r = await run(call, { query: { name }, headers: { authorization: 'Bearer good:u1' } });
    assert.equal(r.status, 404, name);
  }
});

test('registry exposes callables only (no triggers / scheduler / webhook)', () => {
  for (const banned of ['onBookingCancelled', 'onBookingMoneyChange', 'onBookingFinanceChange', 'onPayoutRequestWritten', 'unassignedBookingAlerts', 'whatsappWebhook']) {
    assert.equal(Object.prototype.hasOwnProperty.call(CALLABLES, banned), false, banned);
  }
  for (const [name, fn] of Object.entries(CALLABLES)) assert.equal(typeof fn.run, 'function', name);
});

test('authentication is mandatory', async () => {
  const none = await run(call, { query: { name: 'createBooking' }, body: { data: {} } });
  assert.equal(none.status, 401);
  assert.equal(json(none).error.code, 'unauthenticated');
  const bad = await run(call, { query: { name: 'createBooking' }, headers: { authorization: 'Bearer nonsense' }, body: { data: {} } });
  assert.equal(bad.status, 401);
  const wrongScheme = await run(call, { query: { name: 'createBooking' }, headers: { authorization: 'Basic abc' }, body: { data: {} } });
  assert.equal(wrongScheme.status, 401);
});

test('server validation errors map to HTTP status (HttpsError → 400)', async () => {
  const r = await run(call, { query: { name: 'createBooking' }, headers: { authorization: 'Bearer good:cust1' }, body: { data: { requestId: '!' } } });
  assert.equal(r.status, 400);
  assert.equal(json(r).error.code, 'invalid-argument');
});

test('body must be an object', async () => {
  const r = await run(call, { query: { name: 'createBooking' }, headers: { authorization: 'Bearer good:u' }, body: [1, 2] });
  assert.equal(r.status, 400);
});

test('cron endpoints fail closed without the secret', async () => {
  for (const fn of [cronAlerts, cronReconcile]) {
    assert.equal((await run(fn, { method: 'GET' })).status, 401);
    assert.equal((await run(fn, { method: 'GET', headers: { authorization: 'Bearer wrong' } })).status, 401);
  }
});

test('WhatsApp webhook: verify handshake and signature', async () => {
  const hs = await run(whatsappWebhook, { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' } });
  assert.equal(hs.status, 200);
  assert.equal(hs.body, '12345');
  assert.equal((await run(whatsappWebhook, { method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '1' } })).status, 403);

  const payload = JSON.stringify({ entry: [] });
  const sig = `sha256=${createHmac('sha256', 'wa-secret').update(payload).digest('hex')}`;
  assert.equal((await run(whatsappWebhook, { raw: payload, headers: { 'x-hub-signature-256': sig } })).status, 200);
  assert.equal((await run(whatsappWebhook, { raw: payload, headers: { 'x-hub-signature-256': 'sha256=deadbeef' } })).status, 403);
  assert.equal((await run(whatsappWebhook, { raw: payload })).status, 403);
});
