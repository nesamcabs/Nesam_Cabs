import { callBackend } from './backend';

/** Error whose message is safe to show to the driver. */
export class ActionError extends Error {
  details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

export function describeCallError(err: unknown): string {
  const code = (err as { code?: string }).code || '';
  const message = (err as { message?: string }).message || '';
  if (/^functions\/(invalid-argument|failed-precondition|permission-denied|not-found|unavailable|unauthenticated|already-exists|resource-exhausted)$/.test(code) && message) return message;
  // A timeout from our own client carries advice about writes that may have gone through: keep it.
  if (code === 'functions/deadline-exceeded') return (err as { details?: { reason?: string } }).details?.reason === 'timeout' && message ? message : 'The server took too long to respond. Please try again.';
  return 'The server could not complete the request. Check your connection and try again.';
}

/** Calls a booking-server function; a failure becomes an ActionError with a readable message. */
export async function callFunction<Req, Res>(name: string, data: Req, timeout = 60000): Promise<Res> {
  try {
    return await callBackend<Req, Res>(name, data, timeout);
  } catch (err) {
    const message = describeCallError(err);
    // The browser console only shows "400 (Bad Request)": in development the server's reason is printed beside it.
    if (__DEV__) console.warn(`[server] ${name} refused: ${message}`, (err as { code?: string }).code ?? '', (err as { details?: unknown }).details ?? '');
    throw new ActionError(message, (err as { details?: unknown }).details);
  }
}

/** One id per user action, so a retry or double tap is recognised by the server. */
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 8)}`;
