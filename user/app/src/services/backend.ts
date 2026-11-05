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

/**
 * Local development only: the dev server forwards this path to the deployed functions, so the browser sees a same-origin
 * call and the functions' allowed-website list (CORS) never applies. Unset in production builds and in the app.
 */
const FN_PROXY = (process.env.EXPO_PUBLIC_FUNCTIONS_PROXY ?? '').trim();
const callableFunctions = () => (FN_PROXY && typeof window !== 'undefined' ? getFunctions(app, `${window.location.origin}${FN_PROXY}`) : getFunctions(app));

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
  const requestId = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!usesHttpApi) {
    console.info('[NESAM API]', { requestId, name, transport: 'firebase-callable' });
    try {
      const result = (await httpsCallable<Req, Res>(callableFunctions(), name, { timeout: timeoutMs })(data)).data;
      console.info('[NESAM API success]', { requestId, name, transport: 'firebase-callable' });
      return result;
    } catch (error) {
      console.error('[NESAM API error]', { requestId, name, transport: 'firebase-callable', code: (error as { code?: string })?.code, message: (error as Error)?.message });
      throw error;
    }
  }

  // Signed out: sent without a token; the server only answers its public (read-only) functions.
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : '';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  const endpoint = `${API_URL}/api/call/${encodeURIComponent(name)}`;
  console.info('[NESAM API]', { requestId, name, transport: 'vercel-http', endpoint, signedIn: Boolean(user) });
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('[NESAM API network error]', { requestId, name, endpoint, error: (err as Error)?.message });
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
    console.error('[NESAM API response error]', { requestId, name, endpoint, status: response.status, code, message: payload.error?.message });
    throw new BackendError(code, payload.error?.message ?? 'The server could not complete the request.', payload.error?.details);
  }
  console.info('[NESAM API success]', { requestId, name, endpoint, status: response.status });
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
