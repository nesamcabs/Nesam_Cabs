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
    return (await httpsCallable<Req, Res>(functions, name, { timeout: timeoutMs })(data)).data;
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
    /* non-JSON gateway error page */
  }
  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? (response.status === 401 ? 'unauthenticated' : response.status === 504 ? 'deadline-exceeded' : 'internal');
    throw new BackendError(code, payload.error?.message ?? 'The server could not complete the request.', payload.error?.details);
  }
  return payload.data as Res;
}

/** Settles derived money state after a direct Firestore write (the API has no Firestore triggers). */
export function settleBooking(bookingId: string): void {
  if (!usesHttpApi || !bookingId) return;
  void callBackend('reconcile', { bookingId }, 30000).catch(() => undefined);
}
