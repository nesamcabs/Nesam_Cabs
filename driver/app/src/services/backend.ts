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

const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');

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

export async function callBackend<Req, Res>(name: string, data: Req, timeoutMs = 60000): Promise<Res> {
  if (!usesHttpApi) {
    return (await httpsCallable<Req, Res>(getFunctions(app), name, { timeout: timeoutMs })(data)).data;
  }

  const user = auth.currentUser;
  if (!user) throw new BackendError('unauthenticated', 'Sign in required.');
  const token = await user.getIdToken();

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

  let payload: { data?: Res; error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error page (gateway timeout etc.) */
  }
  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? (response.status === 401 ? 'unauthenticated' : response.status === 504 ? 'deadline-exceeded' : 'internal');
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
