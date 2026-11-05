// Small, dependency-free helpers shared by the HTTP (Vercel) entry points.
import type { IncomingMessage, ServerResponse } from 'http';
import { timingSafeEqual } from 'crypto';
import { PUBLIC_CALLABLE_ORIGINS } from '../corsOrigins';

/** The parts of Vercel's Node request helpers these handlers use. */
export interface ApiRequest extends IncomingMessage {
  body?: unknown;
  /** Firebase preserves these exact bytes before parsing JSON. */
  rawBody?: Buffer;
  query: Record<string, string | string[] | undefined>;
}
export type ApiResponse = ServerResponse;

export function sendJson(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

/** Always `{ error: { code, message } }` — the clients map `code` to a friendly message. */
export function sendError(res: ApiResponse, status: number, code: string, message: string, details?: unknown): void {
  sendJson(res, status, { error: { code, message, ...(details === undefined ? {} : { details }) } });
}

const header = (req: IncomingMessage, name: string): string => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] ?? '' : v ?? '';
};
export { header };

// ── CORS ──────────────────────────────────────────────────────────────────

function originAllowed(origin: string, list: string[]): boolean {
  return list.some((rule) => {
    if (rule === origin) return true;
    // "https://*.example.com" matches any single-level subdomain.
    const m = /^(https?:\/\/)\*\.(.+)$/.exec(rule);
    return !!m && origin.startsWith(m[1]!) && origin.endsWith(`.${m[2]}`) && !origin.slice(m[1]!.length, -m[2]!.length - 1).includes('.');
  });
}

/**
 * Adds CORS headers for the origins listed in ALLOWED_ORIGINS (comma separated, exact
 * origins or `https://*.example.com`). No list → no CORS headers (same-origin only).
 * Requests authenticate with a Bearer token, never cookies, so CORS here is hygiene,
 * not the access control.
 */
export function applyCors(req: IncomingMessage, res: ApiResponse): void {
  const origin = header(req, 'origin');
  // The public customer domains are always allowed, so a site added there never depends on the env var being updated.
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const list = [...PUBLIC_CALLABLE_ORIGINS, ...fromEnv];
  res.setHeader('Vary', 'Origin');
  if (origin && originAllowed(origin, list)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    // Include both casing variants — browsers normalise to lowercase but some CDN/proxy
    // layers do a case-sensitive header comparison during preflight.
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Client-Request-Id, x-client-request-id');
    res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

/** Security headers that make sense on a JSON API. */
export function apiHeaders(res: ApiResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

// ── Secrets ───────────────────────────────────────────────────────────────

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Bearer-secret check for cron endpoints (Vercel sends `Authorization: Bearer $CRON_SECRET`). Fails closed. */
export function cronAuthorized(req: IncomingMessage): boolean {
  const secret = (process.env.CRON_SECRET ?? '').trim();
  if (secret.length < 16) return false;
  const given = /^Bearer (.+)$/.exec(header(req, 'authorization'))?.[1] ?? '';
  return safeEqual(given, secret);
}

// ── Best-effort per-user rate limit (per warm instance) ────────────────────

const buckets = new Map<string, { n: number; reset: number }>();
export function rateLimited(key: string, max = 240, windowMs = 60000): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    if (buckets.size > 5000) buckets.clear();
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  b.n += 1;
  return b.n > max;
}
