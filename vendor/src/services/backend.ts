// Transport to the NESAM server functions.
//
// Two interchangeable back ends run the *same* server code (functions/src):
//   • HTTP API (Vercel): used when EXPO_PUBLIC_API_URL is set at build time. Every call
//     carries the signed-in user's Firebase ID token as a Bearer token and the server
//     verifies it; the browser/app never holds any secret.
//   • Firebase callables: the original path, used when EXPO_PUBLIC_API_URL is not set.
// Callers use callBackend(name, data) and cannot tell the difference. Errors are thrown
// with a `functions/<code>` code so describeCallError keeps working unchanged.
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from '../config/firebase';

// The booking server. Builds always talk to it (the Firebase callables they fall back to are not deployed, so nothing that
// needs the server would work), whether or not the build's environment variable was set; an explicit value still wins, and
// EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true keeps the local emulators in use.
const DEFAULT_API_URL = 'https://nesam-travels-api.vercel.app';
const configuredApiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
const API_URL = (configuredApiUrl || (process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true' ? '' : DEFAULT_API_URL)).replace(/\/+$/, '');

/** True when server functions go through the HTTP API instead of Firebase callables. */
export const usesHttpApi = API_URL.length > 0;

class BackendError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = `functions/${code}`;
    this.details = details;
  }
}

interface ApiPayload<Res> {
  data?: Res;
  error?: { code?: string; message?: string; details?: unknown };
}

/** Reasons the server gives for a rejected sign-in that a fresh token cannot fix (a deployment setting, not a stale token). */
const FINAL_REASONS = new Set(['token-revoked', 'project-mismatch', 'no-credentials']);

async function post<Res>(name: string, data: unknown, token: string, timeoutMs: number): Promise<{ response: Response; payload: ApiPayload<Res> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/call/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw new BackendError('deadline-exceeded', 'The server took too long to respond.');
    throw new BackendError('unavailable', 'Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let payload: ApiPayload<Res> = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error page (gateway timeout etc.) */
  }
  return { response, payload };
}

export async function callBackend<Req, Res>(name: string, data: Req, timeoutMs = 60000): Promise<Res> {
  if (!usesHttpApi) {
    return (await httpsCallable<Req, Res>(getFunctions(app, 'asia-south1'), name, { timeout: timeoutMs })(data)).data;
  }

  const user = auth.currentUser;
  if (!user) throw new BackendError('unauthenticated', 'Your session has expired. Please sign in again.');

  let { response, payload } = await post<Res>(name, data, await user.getIdToken(), timeoutMs);
  // A rejected token is usually just stale (a long-open tab, a clock that drifted): ask Firebase for a fresh one and try once more.
  const rejected = response.status === 401 && payload.error?.code === 'unauthenticated';
  const reason = (payload.error?.details as { reason?: string } | undefined)?.reason ?? '';
  if (rejected && !FINAL_REASONS.has(reason)) {
    ({ response, payload } = await post<Res>(name, data, await user.getIdToken(true), timeoutMs));
  }

  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? (response.status === 401 ? 'unauthenticated' : response.status === 504 ? 'deadline-exceeded' : 'internal');
    if (code === 'unauthenticated') console.warn('[api] sign-in rejected by the server', { name, status: response.status, reason: (payload.error?.details as { reason?: string } | undefined)?.reason });
    throw new BackendError(code, payload.error?.message ?? 'The server could not complete the request.', payload.error?.details);
  }
  return payload.data as Res;
}

/**
 * Asks the server to settle derived money state (refund record, paid / balance, partner
 * ledger) after one of the few direct Firestore writes the security rules still allow.
 * Firebase deployments do this with Firestore triggers; the HTTP API has none, so the
 * app asks. Best effort — the server also sweeps recent bookings on a schedule.
 */
export function settleBooking(bookingId: string): void {
  if (!usesHttpApi || !bookingId) return;
  void callBackend('reconcile', { bookingId }, 30000).catch(() => undefined);
}

export function settlePayout(payoutRequestId: string): void {
  if (!usesHttpApi || !payoutRequestId) return;
  void callBackend('reconcile', { payoutRequestId }, 30000).catch(() => undefined);
}

