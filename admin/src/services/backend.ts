// Transport to the NESAM server functions (admin panel).
//
// With VITE_API_URL set (the Vercel API), every call carries the signed-in staff member's
// Firebase ID token as a Bearer token; the server verifies it and applies the same
// permission checks (requireAdmin / requirePermission) as before. Without it the original
// Firebase callables are used. Errors carry a `functions/<code>` code either way.
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');

export const usesHttpApi = API_URL.length > 0;

// Diagnostics: one line per server call in the browser console (prefix [NESAM API]).
// Never logs the token or the request data (which can hold customer details).
const LOG = '[NESAM API]';
console.info(LOG, 'transport', {
  mode: usesHttpApi ? 'http' : 'firebase-callable',
  apiUrl: usesHttpApi ? API_URL : '(VITE_API_URL not set)',
  page: typeof window !== 'undefined' ? window.location.origin : '',
});

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
  const started = performance.now();
  const took = () => `${Math.round(performance.now() - started)} ms`;
  console.info(LOG, '→', name, usesHttpApi ? `POST ${API_URL}/api/call/${name}` : 'firebase callable');

  if (!usesHttpApi) {
    try {
      const res = (await httpsCallable<Req, Res>(functions, name, { timeout: timeoutMs })(data)).data;
      console.info(LOG, '✓', name, took());
      return res;
    } catch (err) {
      console.error(LOG, '✗', name, took(), err);
      throw err;
    }
  }

  const user = auth.currentUser;
  if (!user) {
    console.error(LOG, '✗', name, 'no signed-in user (auth.currentUser is null)');
    throw new BackendError('unauthenticated', 'Sign in required.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const send = (token: string) =>
    fetch(`${API_URL}/api/call/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
  let response: Response;
  try {
    response = await send(await user.getIdToken());
    // A stale token is refreshed once and the call is retried; nothing else is retried.
    if (response.status === 401) {
      console.info(LOG, '↻', name, 'token rejected, refreshing and retrying once');
      response = await send(await user.getIdToken(true));
    }
  } catch (err) {
    // A browser "Failed to fetch" here usually means the request never got a reply: wrong API URL, server down, or CORS blocked.
    console.error(LOG, '✗', name, 'no response after', took(), err);
    if ((err as { name?: string }).name === 'AbortError') throw new BackendError('deadline-exceeded', 'The server took too long to respond.');
    throw new BackendError('unavailable', 'Could not reach the server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  let payload: { data?: Res; error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON gateway error page */
  }
  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? (response.status === 401 ? 'unauthenticated' : response.status === 504 ? 'deadline-exceeded' : 'internal');
    console.error(LOG, '✗', name, `HTTP ${response.status}`, took(), { code, message: payload.error?.message, details: payload.error?.details });
    throw new BackendError(code, payload.error?.message ?? 'The server could not complete the request.', payload.error?.details);
  }
  console.info(LOG, '✓', name, `HTTP ${response.status}`, took());
  return payload.data as Res;
}

/** Settles derived money state after a direct Firestore write (the API has no Firestore triggers). */
export function settleBooking(bookingId: string): void {
  if (!usesHttpApi || !bookingId) return;
  void callBackend('reconcile', { bookingId }, 30000).catch(() => undefined);
}
