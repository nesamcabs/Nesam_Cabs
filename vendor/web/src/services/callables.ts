import { callBackend } from './backend';

/** Error whose message is safe to show to the driver. */
export class ActionError extends Error {
  details?: unknown;
  /** The original error code (e.g. functions/not-found) and the classified cause, for support and logs. */
  code?: string;
  diagnostic?: string;
  constructor(message: string, details?: unknown, code?: string, diagnostic?: string) {
    super(message);
    this.details = details;
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

/**
 * Why a call failed, in words a partner can act on, plus a diagnostic that tells support WHICH not-found it was:
 *   record-not-found     the server ran the function and a booking / vehicle / order was not there (its own message is shown)
 *   callable-unavailable Firebase answered NOT_FOUND: that callable is not deployed in the Firebase project this build talks to
 *   unknown-operation    the HTTP API answered "Unknown function.": that API deployment does not register this operation
 * Anything else keeps its own code; the original `code` is always kept on the ActionError.
 */
export function classifyCallError(err: unknown): { message: string; diagnostic: string } {
  const code = (err as { code?: string }).code || '';
  // The Firebase SDK appends the HTTP status (" [400]") to server messages; people should not see it.
  const message = ((err as { message?: string }).message || '').replace(/\s*\[\d{3}\]$/, '');
  if (code === 'functions/not-found') {
    if (!message || /^not[ _]found$/i.test(message)) {
      return { diagnostic: 'callable-unavailable', message: 'This service is not available on the server yet. Please try again later or contact the NESAM office. (Reference: callable-unavailable)' };
    }
    if (/^unknown function\.?$/i.test(message)) {
      return { diagnostic: 'unknown-operation', message: 'The server does not offer this feature yet. Please try again later or contact the NESAM office. (Reference: unknown-operation)' };
    }
    return { diagnostic: 'record-not-found', message };
  }
  if (/^functions\/(invalid-argument|failed-precondition|permission-denied|unavailable|unauthenticated|already-exists|resource-exhausted)$/.test(code) && message) return { diagnostic: code.replace('functions/', ''), message };
  if (code === 'functions/deadline-exceeded') return { diagnostic: 'deadline-exceeded', message: 'The server took too long to respond. Please try again.' };
  return { diagnostic: code.replace('functions/', '') || 'unknown', message: 'The server could not complete the request. Check your connection and try again.' };
}

/** Calls a booking-server function; a failure becomes an ActionError with a readable message. */
export async function callFunction<Req, Res>(name: string, data: Req, timeout = 60000): Promise<Res> {
  try {
    return await callBackend<Req, Res>(name, data, timeout);
  } catch (err) {
    const c = classifyCallError(err);
    throw new ActionError(c.message, (err as { details?: unknown }).details, (err as { code?: string }).code, c.diagnostic);
  }
}

export const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
