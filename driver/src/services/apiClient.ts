// A hardened transport for the NESAM HTTP API, shared by the Admin, Driver, Vendor and customer apps (one file, copied
// byte-for-byte into each; the tests live next to the customer app's copy).
//
// "Could not reach the server" used to be the answer to every failed fetch, whatever the cause. A browser reports a blocked
// address (CORS), a dropped connection, a dead host and an offline phone all the same way. This client tells them apart and
// recovers where it is SAFE to:
//
//   offline          the device has no network            → say so at once; nothing is sent
//   origin-blocked   the server is up but refuses this website's address (CORS); the browser never sent the request
//   unreachable      the host cannot be reached at all (down, DNS, wrong address, deployment removed)
//   dropped          the host is reachable and CORS is fine, yet this call got no reply: it MAY have been executed
//   timeout          no reply within the allowed time: it MAY have been executed
//
// Rules that keep money and bookings safe:
//   • Reads (get…, quote…, search…, reconcile …) are repeated with a short back-off on dropped connections and 502/503/504.
//   • Writes are never repeated when it is unknown whether the first try ran (dropped, timeout, 5xx). They fail over to the next
//     address only when it is PROVEN they were never delivered: the address is blocked (the browser stops the request at the
//     preflight) or unreachable (no connection could be made), or the server answered 429 (it refuses before running anything).
//   • A stale sign-in token is refreshed once and the call is repeated: the server rejects before running anything.
//   • The address that last worked is remembered for ten minutes, so a dead primary costs one failed try, not one per call.
//
// Addresses are tried in order. '' stands for "this page's own address" (a same-origin /api forwarder, which never needs CORS).
export class BackendError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = `functions/${code}`;
    this.details = details;
  }
}

export type FailureKind = 'offline' | 'origin-blocked' | 'unreachable' | 'dropped' | 'timeout';

export interface ApiClientConfig {
  /** Ordered API addresses without a trailing slash; '' = this page's own address. The first is preferred. */
  bases: string[];
  /** The signed-in user's Firebase ID token ('' = signed out). `force` asks for a fresh one. May throw a BackendError. */
  getToken: (force?: boolean) => Promise<string>;
  /** The page's own address in a browser (shown when it is blocked); '' in a native app, where CORS does not exist. */
  pageOrigin?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** True when the device is offline (navigator.onLine === false). */
  isOffline?: () => boolean;
  /** Where the address that last worked is remembered (sessionStorage in a browser). */
  memory?: { get(): string | null; set(value: string | null): void };
  log?: (event: string, info: Record<string, unknown>) => void;
  /** Extra tries for a read after a transient failure (default 2). */
  retries?: number;
  /** First back-off in ms; doubles each time, with jitter (default 400). */
  backoffMs?: number;
}

/** Functions that only read (or are harmless to repeat): safe to try again when the first try may have run. */
const READ_ONLY = /^(get|quote|search|reverse|lookup|find|list|check|preview|estimate|reconcile|refreshPublicContent|localDutyOptions|localShiftBoard|ltGet|ltCheck|ltCancellationQuote)/;
export const isReadOnlyCall = (name: string): boolean => READ_ONLY.test(name);

const REMEMBER_MS = 10 * 60 * 1000;
const PROBE_MS = 6000;
const MAX_RETRY_AFTER_MS = 5000;

const sleepReal = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Sent =
  | { kind: 'response'; response: Response; payload: { data?: unknown; error?: { code?: string; message?: string; details?: unknown } }; isApi: boolean }
  | { kind: 'network'; message: string }
  | { kind: 'timeout' };

const jsonHeaders = { 'Content-Type': 'application/json' };

export function createApiClient(cfg: ApiClientConfig) {
  const doFetch: typeof fetch = cfg.fetchImpl ?? ((...a) => fetch(...a));
  const sleep = cfg.sleep ?? sleepReal;
  const now = cfg.now ?? (() => Date.now());
  const offline = cfg.isOffline ?? (() => (typeof navigator !== 'undefined' && navigator.onLine === false));
  const retries = cfg.retries ?? 2;
  const backoff = cfg.backoffMs ?? 400;
  const pageOrigin = cfg.pageOrigin ?? '';
  // An address equal to the page's own is the same-origin forwarder: CORS can never apply to it.
  const bases = Array.from(new Set(cfg.bases.map((b) => (b && b === pageOrigin ? '' : b))));
  const log = cfg.log ?? (() => undefined);
  let memoryValue: string | null = null;
  const memory = cfg.memory ?? { get: () => memoryValue, set: (v: string | null) => { memoryValue = v; } };

  const label = (base: string) => base || pageOrigin || 'this site';

  /** Remembered "base|timestamp"; ignored once stale. */
  const remembered = (): string | null => {
    const raw = memory.get();
    if (!raw) return null;
    const i = raw.lastIndexOf('|');
    const at = Number(raw.slice(i + 1));
    const base = raw.slice(0, i);
    return Number.isFinite(at) && now() - at < REMEMBER_MS && bases.includes(base) ? base : null;
  };
  const remember = (base: string) => memory.set(`${base}|${now()}`);
  const forget = () => memory.set(null);

  const order = (): string[] => {
    const first = remembered();
    return first === null ? [...bases] : [first, ...bases.filter((b) => b !== first)];
  };

  async function withTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try {
      return await doFetch(url, { ...init, signal: c.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function send(base: string, name: string, data: unknown, token: string, requestId: string, timeoutMs: number): Promise<Sent> {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(`${base}/api/call/${encodeURIComponent(name)}`, {
        method: 'POST',
        headers: { ...jsonHeaders, 'X-Client-Request-Id': requestId, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ data }),
        signal: c.signal,
      });
    } catch (err) {
      return (err as { name?: string })?.name === 'AbortError' ? { kind: 'timeout' } : { kind: 'network', message: String((err as Error)?.message ?? err) };
    } finally {
      clearTimeout(t);
    }
    let payload: Extract<Sent, { kind: 'response' }>['payload'] = {};
    let isApi = false;
    try {
      payload = await response.json();
      isApi = payload !== null && typeof payload === 'object' && ('data' in payload || 'error' in payload);
    } catch {
      /* not JSON: a gateway page, the site's own web page, a platform error */
    }
    return { kind: 'response', response, payload, isApi };
  }

  /**
   * Why a call got no reply. A POST with JSON and an Authorization header is always preflighted by a browser, so when the server
   * answers a plain JSON POST readably, CORS is fine and the host is up (→ dropped). When it does not, a no-cors GET that still
   * connects means the host is up but refuses this page (→ origin-blocked); one that cannot connect means unreachable.
   */
  async function classify(base: string): Promise<'offline' | 'origin-blocked' | 'unreachable' | 'dropped'> {
    if (offline()) return 'offline';
    try {
      await withTimeout(`${base}/api/call/__connection_check`, { method: 'POST', headers: jsonHeaders, body: '{"data":{}}', cache: 'no-store' }, PROBE_MS);
      return 'dropped';
    } catch {
      /* not readable */
    }
    if (!pageOrigin || base === '') return 'unreachable'; // a native app, or our own address: CORS cannot be the cause
    try {
      await withTimeout(`${base}/api/health`, { method: 'GET', mode: 'no-cors', cache: 'no-store' }, PROBE_MS);
      return 'origin-blocked';
    } catch {
      return 'unreachable';
    }
  }

  const failure = (kind: FailureKind, base: string): BackendError => {
    const where = label(base);
    switch (kind) {
      case 'offline':
        return new BackendError('unavailable', 'You are offline. Reconnect to the internet and try again.', { reason: 'offline' });
      case 'origin-blocked':
        return new BackendError('unavailable', `The NESAM server is online but is not accepting requests from this website address (${pageOrigin}). Please tell NESAM support so it can be allowed. Nothing was sent. (Reference: origin-blocked)`, { reason: 'origin-blocked', origin: pageOrigin, server: where });
      case 'unreachable':
        return new BackendError('unavailable', 'The NESAM server is not responding right now. Nothing was sent. Please try again in a minute. (Reference: server-unreachable)', { reason: 'unreachable', server: where });
      case 'dropped':
        return new BackendError('unavailable', 'The connection dropped before the server replied. If you were saving something, check whether it was saved before trying again. (Reference: connection-dropped)', { reason: 'dropped', server: where });
      default:
        return new BackendError('deadline-exceeded', 'The server took too long to respond. If you were saving something, check whether it was saved before trying again.', { reason: 'timeout', server: where });
    }
  };

  /** A reply that is not from our API: the site's own web page (no forwarder here), a removed deployment, a gateway page. */
  const notOurApi = (s: Extract<Sent, { kind: 'response' }>): boolean => {
    if (s.isApi) return false;
    const vercelError = s.response.headers?.get?.('x-vercel-error') ?? '';
    // A platform error that means "no deployment answers here" proves nothing ran. A crashed or timed-out function (FUNCTION_…) may have.
    if (vercelError) return /^(DEPLOYMENT_NOT_FOUND|DEPLOYMENT_DISABLED|DEPLOYMENT_PAUSED|DEPLOYMENT_BLOCKED|NOT_FOUND|BAD_HOST)$/.test(vercelError);
    return [200, 301, 308, 404, 405].includes(s.response.status);
  };

  async function call<Res>(name: string, data: unknown, timeoutMs = 60000): Promise<Res> {
    const requestId = `${name}-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const readOnly = isReadOnlyCall(name);
    let token = await cfg.getToken(false);
    let refreshed = false;
    let lastFailure: BackendError | null = null;
    let blocked: BackendError | null = null;

    for (const base of order()) {
      let transient = 0;
      for (;;) {
        const sent = await send(base, name, data, token, requestId, timeoutMs);

        if (sent.kind === 'timeout') {
          log('timeout', { name, base: label(base), requestId });
          throw failure('timeout', base);
        }

        if (sent.kind === 'network') {
          const why = await classify(base);
          log('network-failure', { name, base: label(base), requestId, why, error: sent.message });
          if (why === 'offline') throw failure('offline', base);
          if (why === 'dropped') {
            // The host answered a probe, so the first try may have been executed: only a read may be repeated.
            if (readOnly && transient < retries) { transient++; await sleep(backoff * 2 ** (transient - 1) + Math.random() * 100); continue; }
            throw failure('dropped', base);
          }
          // Blocked or unreachable: provably never delivered, so any call may move on to the next address.
          const f = failure(why, base);
          if (why === 'origin-blocked') blocked = f;
          lastFailure = blocked ?? f;
          forget();
          break;
        }

        const { response, payload } = sent;

        if (response.status === 401 && payload.error?.code === 'unauthenticated' && !refreshed) {
          const reason = (payload.error.details as { reason?: string } | undefined)?.reason ?? '';
          if (!['token-revoked', 'project-mismatch', 'no-credentials'].includes(reason) && token) {
            refreshed = true;
            token = await cfg.getToken(true);
            continue;
          }
        }

        if (response.status === 429 && transient < 1) {
          // The server's rate limit answers before running anything, so waiting and repeating is safe for every call.
          transient++;
          const after = Number(response.headers?.get?.('retry-after'));
          await sleep(Math.min(MAX_RETRY_AFTER_MS, Number.isFinite(after) && after > 0 ? after * 1000 : 1500));
          continue;
        }

        if (notOurApi(sent)) {
          // Not an answer from our API (no forwarder here, deployment removed): try the next address.
          log('not-api', { name, base: label(base), status: response.status, requestId });
          lastFailure = lastFailure ?? failure('unreachable', base);
          forget();
          break;
        }

        if ([502, 503, 504].includes(response.status) && !sent.isApi) {
          // A gateway error. It may have run: only a read is repeated.
          if (readOnly && transient < retries) { transient++; await sleep(backoff * 2 ** (transient - 1) + Math.random() * 100); continue; }
          throw new BackendError(response.status === 504 ? 'deadline-exceeded' : 'unavailable', 'The server is busy or restarting. Please try again in a moment.', { reason: `http-${response.status}` });
        }

        if (!response.ok || payload.error) {
          const code = payload.error?.code ?? (response.status === 401 ? 'unauthenticated' : response.status === 504 ? 'deadline-exceeded' : 'internal');
          throw new BackendError(code, payload.error?.message ?? 'The server could not complete the request.', payload.error?.details);
        }
        remember(base);
        return payload.data as Res;
      }
    }

    throw blocked ?? lastFailure ?? failure('unreachable', bases[0] ?? '');
  }

  /** What `nesamApiCheck()` prints: every address, whether this page can use it, and what to do when not. */
  async function diagnose(): Promise<Record<string, unknown>> {
    const report: Record<string, unknown> = { page: pageOrigin || '(native app)', addresses: [] as unknown[], remembered: remembered() };
    const list = report.addresses as Record<string, unknown>[];
    for (const base of bases) {
      const row: Record<string, unknown> = { address: label(base) };
      try {
        const res = await withTimeout(`${base}/api/call/__connection_check`, { method: 'POST', headers: jsonHeaders, body: '{"data":{}}', cache: 'no-store' }, PROBE_MS);
        const body = await res.json().catch(() => null) as { error?: unknown } | null;
        row.status = res.status;
        row.verdict = body && typeof body === 'object' && 'error' in body ? 'OK: the API answered and this page may use it.' : `Not the NESAM API (HTTP ${res.status}): this address has no API forwarder.`;
        row.usable = !!body && typeof body === 'object' && 'error' in body;
      } catch {
        const why = await classify(base);
        row.usable = false;
        row.verdict = why === 'origin-blocked'
          ? `BLOCKED: the server is up but does not allow this page (${pageOrigin}). Add it to APP_ORIGINS in functions/src/corsOrigins.ts (or ALLOWED_ORIGINS on the API project) and redeploy the API.`
          : why === 'offline' ? 'This device is offline.' : 'UNREACHABLE: no connection could be made (host down, wrong address or deployment removed).';
      }
      list.push(row);
    }
    report.verdict = list.some((r) => r.usable) ? 'At least one address works: calls will use it.' : 'No address works: calls will fail until one of the above is fixed.';
    log('diagnose', report);
    return report;
  }

  return { call, diagnose, classify };
}

/** A sessionStorage-backed memory for browsers; falls back to a plain variable where storage is blocked. */
export function browserMemory(key = 'nesam.apiBase'): { get(): string | null; set(value: string | null): void } {
  let value: string | null = null;
  return {
    get() {
      try {
        return (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null) ?? value;
      } catch {
        return value;
      }
    },
    set(v) {
      value = v;
      try {
        if (typeof sessionStorage === 'undefined') return;
        if (v === null) sessionStorage.removeItem(key);
        else sessionStorage.setItem(key, v);
      } catch {
        /* storage blocked: the in-memory copy is enough */
      }
    },
  };
}

/** Comma-separated extra API addresses from a build setting, trimmed and without trailing slashes. */
export const parseBases = (raw: string | undefined): string[] =>
  (raw ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => /^https?:\/\//i.test(s));
