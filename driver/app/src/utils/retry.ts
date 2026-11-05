// Retry + error helpers shared by every Firestore / network call.
import { isOnline } from './network';

const TRANSIENT_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
  'aborted',
  'internal',
  'cancelled',
  'auth/network-request-failed',
  'storage/retry-limit-exceeded',
  'network',
  'timeout',
]);

export class TimeoutError extends Error {
  code = 'timeout';
  constructor(message = 'The request timed out.') {
    super(message);
  }
}

export function errorCode(error: unknown): string {
  const raw = (error as { code?: string })?.code ?? '';
  // Firestore codes arrive as 'unavailable' or 'firestore/unavailable'.
  return raw.replace(/^(?:firestore|functions)\//, '');
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch() network failure
  return TRANSIENT_CODES.has(errorCode(error));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Called before each retry — e.g. to verify a write didn't land already. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/** Retries `fn` on transient failures with exponential backoff + jitter. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseDelayMs = 600, onRetry } = opts;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries || !isTransientError(error)) throw error;
      attempt += 1;
      onRetry?.(attempt, error);
      await sleep(baseDelayMs * 2 ** (attempt - 1) + Math.random() * 250);
    }
  }
}

/** Rejects with TimeoutError if `promise` hasn't settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    }),
  ]);
}

/** Human-readable message for Firestore / Storage / network errors. */
export function describeError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code = errorCode(error);
  if (__DEV__) console.warn('[nesam]', code || 'error', error);
  if (!isOnline()) {
    return 'You are offline. Check your internet connection and try again.';
  }
  switch (code) {
    case 'failed-precondition':
    case 'invalid-argument':
      return (error as { message?: string })?.message || fallback;
    case 'permission-denied':
      return 'This action is not allowed for your account. If this keeps happening, contact support.';
    case 'unauthenticated':
      return 'Your session has expired. Please sign in again.';
    case 'unavailable':
    case 'deadline-exceeded':
    case 'timeout':
      return 'Our servers are taking too long to respond. Please try again.';
    case 'not-found':
      return 'We could not find that record. It may have been removed.';
    case 'resource-exhausted':
      return 'Too many requests right now. Please wait a moment and try again.';
    case 'storage/unauthorized':
      return 'Upload not permitted. Please sign in again and retry.';
    case 'storage/canceled':
      return 'Upload cancelled.';
    default:
      return fallback;
  }
}
