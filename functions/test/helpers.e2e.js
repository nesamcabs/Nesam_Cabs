// Shared helpers for the emulator suites (auth + firestore + functions, demo project).
// Nothing here can reach production: every call goes to 127.0.0.1 emulators.
const http = require('node:http');

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const admin = require('firebase-admin');

const PROJECT = 'demo-nesam';
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const TS = admin.firestore.Timestamp;

const FS = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;

const tokens = {};
async function tokenFor(uid) {
  if (tokens[uid]) return tokens[uid];
  try { await admin.auth().createUser({ uid }); } catch { /* exists */ }
  const custom = await admin.auth().createCustomToken(uid);
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  tokens[uid] = (await r.json()).idToken;
  return tokens[uid];
}

/** Calls a callable as `uid`. Resolves { ok, data } or { ok:false, status, message, details }. */
async function call(uid, name, data) {
  const r = await fetch(`${FN}/${name}`, {
    signal: AbortSignal.timeout(60000),
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` }, body: JSON.stringify({ data }),
  });
  const body = await r.json();
  if (body.error) return { ok: false, status: body.error.status, message: body.error.message, details: body.error.details };
  return { ok: true, data: body.result };
}

/** Reads a document through the security rules, as `uid`. */
async function rest(uid, path) {
  const r = await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${await tokenFor(uid)}` } });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

const val = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) });

/** A direct client write — through the rules, as a partner app would. */
async function clientPatch(uid, path, fields) {
  const r = await fetch(`${FS}/${path}?${Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&')}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)])) }),
  });
  return { ok: r.ok, status: r.status };
}

async function clientCreate(uid, collectionPath, id, fields) {
  const r = await fetch(`${FS}/${collectionPath}?documentId=${id}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenFor(uid)}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, val(v)])) }),
  });
  return { ok: r.ok, status: r.status };
}

const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();
const place = (name, lat, lng) => ({ name, address: `${name}, Tamil Nadu`, lat, lng, type: 'other' });

/** ISO instant for `days` ahead at HH:MM India time (unambiguous, with the +05:30 offset). */
function istInstant(days, hhmm) {
  const d = new Date(Date.now() + days * 86400000);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${date}T${hhmm}:00+05:30`;
}

let counter = 0;
const rid = (p) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}abcdefgh`;

/** Creates a booking as `customer`, retrying once with the server's own quote (the app does the same). */
async function bookAs(customer, over = {}) {
  const base = {
    requestId: rid('bk'), pickup: place('Theni', 10.0104, 77.4768), drop: place('Madurai', 9.9195, 78.1193), categoryId: 'sedan',
    tripType: 'One Way', paymentMethod: 'Cash', scheduledAt: inHours(5), termsAccepted: true, expectedFare: 0, notes: '', couponCode: '', ...over,
  };
  let r = await call(customer, 'createBooking', base);
  if (!r.ok && r.details?.fare?.total) r = await call(customer, 'createBooking', { ...base, expectedFare: r.details.fare.total });
  return { ...r, requestId: base.requestId };
}

/** A booking as staff see it: the public record joined with its private partner pricing (booking_pricing_private), as the server does. */
const booking = async (id) => {
  const b = (await db.doc(`bookings/${id}`).get()).data();
  if (!b) return b;
  const priv = (await db.doc(`booking_pricing_private/${id}`).get()).data() ?? null;
  return require('../lib/pricingPrivate').withPrivatePricing(b, priv);
};
const market = async (id) => (await db.doc(`marketplace_trips/${id}`).get()).data();

/** Polls until `fn` returns truthy (Firestore triggers settle asynchronously). */
async function until(fn, { timeout = 15000, every = 250, what = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/** A tiny routing stub (the functions read ROUTING_URL): every route is 80 km / 90 min. */
function startRoutingStub(port = 8765, km = 80, min = 90) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: km * 1000, duration: min * 60 }] }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { admin, db, TS, PROJECT, FS, FN, tokenFor, call, rest, clientPatch, clientCreate, inHours, istInstant, place, rid, bookAs, booking, market, until, startRoutingStub };
