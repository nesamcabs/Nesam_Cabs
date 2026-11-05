// Where to send the rider once sign-in finishes. Kept in sessionStorage (like the booking draft)
// because sign-in remounts the app tree (account loading, profile setup, terms), and consumed
// exactly once. Only the vehicle-selection step can be resumed: a booking is never created for them.
const KEY = 'nesam.signin.return.v1';
const MAX_AGE_MS = 15 * 60 * 1000;
const RESUMABLE = ['/book/ride'] as const;

/** Returns `path` only when it is a known in-app booking destination (never an external or protocol-relative URL). */
export function safeReturnPath(path: unknown): string | null {
  return typeof path === 'string' && (RESUMABLE as readonly string[]).includes(path) ? path : null;
}

export function setPendingReturn(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: safe, at: Date.now() }));
  } catch {
    /* storage unavailable: the rider just stays on the screen they are on */
  }
}

export function clearPendingReturn(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Reads and removes the pending destination; a stale or tampered record yields null. */
export function takePendingReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.at !== 'number' || Date.now() - v.at > MAX_AGE_MS) return null;
    return safeReturnPath(v.path);
  } catch {
    return null;
  }
}
