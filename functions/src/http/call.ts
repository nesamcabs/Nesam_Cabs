// POST /api/call/:name — the HTTP twin of a Firebase callable.
//
// The browser / app sends `{ data }` with `Authorization: Bearer <Firebase ID token>`.
// The token is verified with the Admin SDK, and the *same* server function the callable
// would run is invoked with `{ data, auth }`, so every authorisation, validation and
// idempotency check (requireAdmin, ownership, state machine…) is exactly the one that
// ships in functions/src. Nothing is decided by the client.
import { getAuth } from 'firebase-admin/auth';
import { HttpsError } from 'firebase-functions/v2/https';
import { CALLABLES, PUBLIC_CALLABLES, RECONCILES_BOOKING, RECONCILES_PAYOUT } from '../registry';
import { reconcileBooking, reconcilePayout } from '../reconcile';
import { ApiRequest, ApiResponse, apiHeaders, applyCors, header, rateLimited, sendError, sendJson } from './util';

const MAX_BODY_BYTES = 1_000_000;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const ID_FIELDS = ['bookingId', 'requestId', 'tripId', 'id'];

/** HttpsError codes → HTTP status (same table the Firebase callable protocol uses). */
function statusOf(code: string): number {
  switch (code) {
    case 'invalid-argument': case 'failed-precondition': case 'out-of-range': return 400;
    case 'unauthenticated': return 401;
    case 'permission-denied': return 403;
    case 'not-found': return 404;
    case 'already-exists': case 'aborted': return 409;
    case 'resource-exhausted': return 429;
    case 'unimplemented': return 501;
    case 'unavailable': return 503;
    case 'deadline-exceeded': return 504;
    default: return 500;
  }
}

function collectIds(...sources: unknown[]): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s || typeof s !== 'object') continue;
    for (const f of ID_FIELDS) {
      const v = (s as Record<string, unknown>)[f];
      if (typeof v === 'string' && ID.test(v)) out.add(v);
    }
  }
  return [...out].slice(0, 3);
}

export async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  const incomingRequestId = header(req, 'x-client-request-id');
  const requestId = /^[A-Za-z0-9_-]{1,128}$/.test(incomingRequestId) ? incomingRequestId : `server-${Date.now().toString(36)}`;
  const startedAt = Date.now();
  apiHeaders(res);
  res.setHeader('X-Request-Id', requestId);
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') return sendError(res, 405, 'method-not-allowed', 'Use POST.');

  const name = String(Array.isArray(req.query.name) ? req.query.name[0] : req.query.name ?? '');
  if (name === 'chatWithBot') console.info('[api/chat] request', { requestId, origin: header(req, 'origin') || 'none' });
  const fn = Object.prototype.hasOwnProperty.call(CALLABLES, name) ? CALLABLES[name] : undefined;
  if (!fn) return sendError(res, 404, 'not-found', 'Unknown function.');

  const length = Number(header(req, 'content-length') || 0);
  if (length > MAX_BODY_BYTES) return sendError(res, 413, 'invalid-argument', 'Request is too large.');

  // Authentication: a valid Firebase ID token is mandatory for every function except the
  // read-only public ones, which a signed-out visitor may call (they rate-limit by IP themselves).
  const bearer = /^Bearer (.+)$/.exec(header(req, 'authorization'))?.[1];
  let decoded;
  if (bearer) {
    try {
      decoded = await getAuth().verifyIdToken(bearer);
    } catch {
      return sendError(res, 401, 'unauthenticated', 'Your session has expired. Please sign in again.');
    }
    if (rateLimited(decoded.uid)) return sendError(res, 429, 'resource-exhausted', 'Too many requests. Please wait a moment.');
  } else if (!PUBLIC_CALLABLES.has(name)) {
    return sendError(res, 401, 'unauthenticated', 'Sign in required.');
  }

  const body = req.body;
  if (body !== undefined && body !== null && (typeof body !== 'object' || Array.isArray(body))) {
    return sendError(res, 400, 'invalid-argument', 'Body must be a JSON object.');
  }
  const data = (body as { data?: unknown } | undefined)?.data;

  try {
    const result = await fn.run({
      data,
      auth: decoded ? { uid: decoded.uid, token: decoded as unknown as Record<string, unknown> } : undefined,
      rawRequest: req,
      acceptsStreaming: false,
    });

    if (name === 'chatWithBot') {
      const diagnostic = (result ?? {}) as { provider?: string; model?: string; reason?: string; language?: string };
      console.info('[api/chat] success', { requestId, durationMs: Date.now() - startedAt, provider: diagnostic.provider, model: diagnostic.model, reason: diagnostic.reason, language: diagnostic.language });
    }

    // Firestore triggers do not exist off Firebase: settle derived money state right away.
    // (Best effort: the callable already succeeded, and the cron sweep repeats this.)
    try {
      if (RECONCILES_BOOKING.has(name)) for (const id of collectIds(data, result)) await reconcileBooking(id);
      if (RECONCILES_PAYOUT.has(name)) for (const id of collectIds(data)) await reconcilePayout(id);
    } catch (err) {
      console.warn(`[api] reconcile after ${name} failed`, err);
    }

    sendJson(res, 200, { data: result ?? null });
  } catch (err) {
    if (err instanceof HttpsError) {
      if (name === 'chatWithBot') console.warn('[api/chat] callable error', { requestId, durationMs: Date.now() - startedAt, code: err.code, message: err.message });
      sendError(res, statusOf(err.code), err.code, err.message, err.details);
      return;
    }
    // Never leak internals; the stack goes to the server log only.
    console.error(`[api] ${name} failed`, { requestId, durationMs: Date.now() - startedAt, error: err });
    sendError(res, 500, 'internal', 'The server could not complete the request.');
  }
}
