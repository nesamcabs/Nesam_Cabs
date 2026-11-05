/**
 * Network resilience helpers shared by the onboarding services.
 */

const TRANSIENT_CODES = new Set([
  'unavailable',
  'deadline-exceeded',
  'resource-exhausted',
  'aborted',
  'internal',
  'auth/network-request-failed',
  'storage/retry-limit-exceeded',
  'storage/unknown',
  'timeout',
]);

export function errorCode(error: unknown): string {
  const raw = (error as { code?: string })?.code ?? '';
  return raw.replace(/^firestore\//, '');
}

export function isTransientError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return TRANSIENT_CODES.has(errorCode(error));
}

export class TimeoutError extends Error {
  code = 'timeout';
  constructor(message = 'The request timed out.') {
    super(message);
  }
}

/**
 * Firestore write promises only resolve once the server acknowledges them, so
 * offline they hang indefinitely. Race them against a timeout so the UI can
 * tell the vendor what is happening (the write stays queued in the SDK).
 */
export function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Retry an idempotent async operation with exponential backoff on transient errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 800 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientError(error) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastError;
}

/** Human-readable message for Firestore / Storage / network failures. */
export function describeDataError(error: unknown): string {
  const code = errorCode(error);
  console.error('[Vendor onboarding]', code, error);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'You appear to be offline. Reconnect to the internet and try again.';
  }
  switch (code) {
    case 'timeout':
    case 'unavailable':
    case 'deadline-exceeded':
      return 'The server is taking too long to respond. Check your connection and try again.';
    case 'permission-denied':
    case 'storage/unauthorized':
      return 'You are not allowed to make this change right now. If your application is under review, please wait for the outcome.';
    case 'unauthenticated':
    case 'storage/unauthenticated':
      return 'Your session has expired. Please sign in again.';
    case 'storage/canceled':
      return 'Upload cancelled.';
    case 'storage/quota-exceeded':
      return 'Storage quota exceeded. Please contact support.';
    case 'storage/retry-limit-exceeded':
      return 'Upload failed after several retries. Check your connection and try again.';
    default:
      return (error as { message?: string })?.message || 'Something went wrong. Please try again.';
  }
}
