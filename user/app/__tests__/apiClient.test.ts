import { BackendError, browserMemory, createApiClient, isReadOnlyCall, parseBases, type ApiClientConfig } from '../src/services/apiClient';

// A scripted network. Each host answers the real call (POST /api/call/<name>), the CORS probe (POST /api/call/__connection_check)
// and the reachability probe (GET /api/health, no-cors) according to its mode. `sent` records every real call that reached a host.
type Mode = 'ok' | 'down' | 'blocked' | 'spa' | 'removed' | 'drop-once' | 'drop-always' | '502-once' | '502-always' | '429-once' | '401-once' | 'crash' | 'hang' | 'app-error';
const PRIMARY = 'https://api.example.com';
const PAGE = 'https://admin.example.com';

function network(modes: Record<string, Mode>) {
  const sent: { base: string; name: string; auth: string | null }[] = [];
  const counts: Record<string, number> = {};
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const html = (status: number, headers: Record<string, string> = {}) => new Response('<html>page</html>', { status, headers: { 'content-type': 'text/html', ...headers } });
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const base = [...Object.keys(modes)].find((b) => (b === '' ? !/^https?:/.test(url) : url.startsWith(b))) ?? '';
    const path = url.slice(base.length);
    const mode = modes[base];
    const isProbe = path.includes('__connection_check');
    const isHealth = path.startsWith('/api/health');
    const headers = new Headers(init?.headers as HeadersInit);
    if (mode === 'down') throw new TypeError('Failed to fetch');
    if (mode === 'blocked') {
      // The host is up; a browser refuses to hand the reply to this page. A no-cors GET still connects.
      if (isHealth && init?.mode === 'no-cors') return new Response(null, { status: 200 });
      throw new TypeError('Failed to fetch');
    }
    if (isHealth) return json(200, { ok: true });
    if (isProbe) return mode === 'spa' ? html(405) : json(404, { error: { code: 'not-found', message: 'Unknown function.' } });
    const name = decodeURIComponent(path.replace('/api/call/', ''));
    if (mode === 'spa') return html(405);
    if (mode === 'removed') return html(404, { 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' });
    sent.push({ base, name, auth: headers.get('authorization') });
    counts[base] = (counts[base] ?? 0) + 1;
    if (mode === 'hang') { await new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))); }
    if (mode === 'drop-always' || (mode === 'drop-once' && counts[base] === 1)) throw new TypeError('Failed to fetch');
    if (mode === '502-always' || (mode === '502-once' && counts[base] === 1)) return html(502);
    if (mode === '429-once' && counts[base] === 1) return json(429, { error: { code: 'resource-exhausted', message: 'Too many requests.' } }, { 'retry-after': '2' });
    if (mode === '401-once' && counts[base] === 1) return json(401, { error: { code: 'unauthenticated', message: 'Your session has expired.', details: { reason: 'token-expired' } } });
    if (mode === 'crash') return html(500, { 'x-vercel-error': 'FUNCTION_INVOCATION_FAILED' });
    if (mode === 'app-error') return json(400, { error: { code: 'failed-precondition', message: 'The fare changed. Review it and book again.', details: { fare: 4000 } } });
    return json(200, { data: { ok: true, name, base } });
  });
  return { fetchImpl, sent };
}

function client(modes: Record<string, Mode>, extra: Partial<ApiClientConfig> = {}) {
  const net = network(modes);
  const sleeps: number[] = [];
  let t = 1_000_000;
  const tokens: boolean[] = [];
  const c = createApiClient({
    bases: Object.keys(modes), pageOrigin: PAGE, fetchImpl: net.fetchImpl as unknown as typeof fetch,
    getToken: async (force) => { tokens.push(!!force); return force ? 'fresh-token' : 'token'; },
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t, isOffline: () => false, ...extra,
  });
  return { ...net, c, sleeps, tokens, advance: (ms: number) => { t += ms; } };
}
const reason = (e: unknown) => ((e as BackendError).details as { reason?: string })?.reason;

describe('which calls may be repeated', () => {
  it('only reads and harmless refreshes; never a write', () => {
    for (const n of ['getLegalStatus', 'quoteBooking', 'searchGooglePlaces', 'reconcile', 'ltGetRide', 'localShiftBoard']) expect(isReadOnlyCall(n)).toBe(true);
    for (const n of ['saveTariffSection', 'approveBooking', 'createBooking', 'recordPayment', 'refundGatewayPayment', 'createRazorpayOrder', 'issuePenalty', 'advanceTrip']) expect(isReadOnlyCall(n)).toBe(false);
  });
});

describe('the healthy path', () => {
  it('S1 returns the answer, sends the token and remembers the address', async () => {
    const t = client({ [PRIMARY]: 'ok', '': 'ok' });
    await expect(t.c.call('saveTariffSection', { a: 1 })).resolves.toMatchObject({ ok: true, base: PRIMARY });
    expect(t.sent).toEqual([{ base: PRIMARY, name: 'saveTariffSection', auth: 'Bearer token' }]);
  });
  it('S16 a signed-out visitor is sent without an Authorization header', async () => {
    const t = client({ [PRIMARY]: 'ok' }, { getToken: async () => '' });
    await t.c.call('quoteBooking', {});
    expect(t.sent[0]!.auth).toBeNull();
  });
  it('S11 the server’s own answers pass through untouched and are never retried', async () => {
    const t = client({ [PRIMARY]: 'app-error', '': 'ok' });
    const err = await t.c.call('createBooking', {}).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err.code).toBe('functions/failed-precondition');
    expect(err.message).toBe('The fare changed. Review it and book again.');
    expect(err.details).toEqual({ fare: 4000 });
    expect(t.sent).toHaveLength(1);
  });
});

describe('a website address the server refuses (CORS) — the Admin outage', () => {
  it('S2 a save is moved to the same-origin forwarder, delivered exactly once, and that address is remembered', async () => {
    const t = client({ [PRIMARY]: 'blocked', '': 'ok' });
    await expect(t.c.call('saveTariffSection', {})).resolves.toMatchObject({ base: '' });
    expect(t.sent).toEqual([{ base: '', name: 'saveTariffSection', auth: 'Bearer token' }]);
    t.fetchImpl.mockClear();
    await t.c.call('saveTariffSection', {});
    const calledPrimary = t.fetchImpl.mock.calls.some((a) => String(a[0]).startsWith(PRIMARY));
    expect(calledPrimary).toBe(false); // the dead primary is not tried again for ten minutes
  });
  it('S3 with no forwarder either, the person is told exactly which address is blocked and that nothing was sent', async () => {
    const t = client({ [PRIMARY]: 'blocked', '': 'spa' });
    const err = await t.c.call('approveBooking', {}).catch((e) => e);
    expect(reason(err)).toBe('origin-blocked');
    expect(err.message).toContain(PAGE);
    expect(err.message).toContain('Nothing was sent');
    expect(err.code).toBe('functions/unavailable');
    expect(t.sent).toHaveLength(0);
  });
  it('S13 the remembered address expires after ten minutes and the primary is tried again', async () => {
    const t = client({ [PRIMARY]: 'blocked', '': 'ok' });
    await t.c.call('getLegalStatus', {});
    t.advance(11 * 60 * 1000);
    t.fetchImpl.mockClear();
    await t.c.call('getLegalStatus', {});
    expect(t.fetchImpl.mock.calls.some((a) => String(a[0]).startsWith(PRIMARY))).toBe(true);
  });
});

describe('a dead or removed server — the October outage', () => {
  it('S14 an unreachable primary fails over to the next address, even for a write (it was never delivered)', async () => {
    const t = client({ [PRIMARY]: 'down', 'https://backup.example.com': 'ok' });
    await expect(t.c.call('recordPayment', {})).resolves.toMatchObject({ base: 'https://backup.example.com' });
    expect(t.sent.map((s) => s.base)).toEqual(['https://backup.example.com']);
  });
  it('S10 a removed deployment (DEPLOYMENT_NOT_FOUND) is skipped', async () => {
    const t = client({ [PRIMARY]: 'removed', '': 'ok' });
    await expect(t.c.call('saveTariffSection', {})).resolves.toMatchObject({ base: '' });
  });
  it('every address down: one clear message that nothing was sent', async () => {
    const t = client({ [PRIMARY]: 'down', '': 'down' });
    const err = await t.c.call('saveTariffSection', {}).catch((e) => e);
    expect(reason(err)).toBe('unreachable');
    expect(err.message).toContain('Nothing was sent');
  });
  it('a forwarder that serves the site’s web page instead of the API is not mistaken for the API', async () => {
    const t = client({ [PRIMARY]: 'down', '': 'spa' });
    const err = await t.c.call('getLegalStatus', {}).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(reason(err)).toBe('unreachable');
  });
});

describe('same-origin mode', () => {
  it('an API address equal to the page’s own address is never blamed on CORS', async () => {
    const t = client({ [PAGE]: 'down', 'https://other.example.com': 'ok' }, { pageOrigin: PAGE });
    await expect(t.c.call('getLegalStatus', {})).resolves.toMatchObject({ ok: true });
    const probes = t.fetchImpl.mock.calls.filter((a) => (a[1] as RequestInit | undefined)?.mode === 'no-cors');
    expect(probes).toHaveLength(0);
  });
});

describe('an offline device', () => {
  it('S4 says so at once and sends nothing', async () => {
    const t = client({ [PRIMARY]: 'down', '': 'down' }, { isOffline: () => true });
    const err = await t.c.call('saveTariffSection', {}).catch((e) => e);
    expect(reason(err)).toBe('offline');
    expect(err.message).toMatch(/offline/i);
    expect(t.sent).toHaveLength(0);
  });
});

describe('a connection that drops mid-call (reachable host, CORS fine)', () => {
  it('S5 a read is repeated with a back-off and succeeds', async () => {
    const t = client({ [PRIMARY]: 'drop-once' });
    await expect(t.c.call('quoteBooking', {})).resolves.toMatchObject({ ok: true });
    expect(t.sent).toHaveLength(2); // the dropped try, then the repeat
    expect(t.sleeps).toHaveLength(1);
    expect(t.sleeps[0]).toBeGreaterThanOrEqual(400);
  });
  it('S5b a read that keeps dropping gives up after the allowed tries', async () => {
    const t = client({ [PRIMARY]: 'drop-always' });
    const err = await t.c.call('quoteBooking', {}).catch((e) => e);
    expect(reason(err)).toBe('dropped');
    expect(t.sleeps).toHaveLength(2);
  });
  it('S6 a write is NEVER repeated, because it may have been executed: the person is told to check', async () => {
    const t = client({ [PRIMARY]: 'drop-once', '': 'ok' });
    const err = await t.c.call('saveTariffSection', {}).catch((e) => e);
    expect(reason(err)).toBe('dropped');
    expect(err.message).toContain('check whether it was saved');
    expect(t.sent.map((x) => x.base)).toEqual([PRIMARY]); // exactly one attempt: not repeated, not sent to another address
    expect(t.sleeps).toHaveLength(0);
  });
});

describe('server trouble', () => {
  it('S7 a gateway 502 on a read is repeated; on a write it is not', async () => {
    const r = client({ [PRIMARY]: '502-once' });
    await expect(r.c.call('getDuesSummary', {})).resolves.toMatchObject({ ok: true });
    const w = client({ [PRIMARY]: '502-once' });
    const err = await w.c.call('createDuesPayment', {}).catch((e) => e);
    expect(err.message).toMatch(/busy or restarting/);
    expect(w.sent).toHaveLength(1);
  });
  it('a crashed function on a write is reported, never retried or failed over to another address', async () => {
    const t = client({ [PRIMARY]: 'crash', '': 'ok' });
    const err = await t.c.call('recordPayment', {}).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(t.sent.map((s) => s.base)).toEqual([PRIMARY]);
  });
  it('S8 a 429 waits for Retry-After and repeats once, for writes too (the limiter answers before running anything)', async () => {
    const t = client({ [PRIMARY]: '429-once' });
    await expect(t.c.call('saveTariffSection', {})).resolves.toMatchObject({ ok: true });
    expect(t.sleeps).toEqual([2000]);
    expect(t.sent).toHaveLength(2);
  });
  it('S12 a call that hangs times out, is not repeated, and the message warns a write may have gone through', async () => {
    const t = client({ [PRIMARY]: 'hang' });
    const err = await t.c.call('saveTariffSection', {}, 20).catch((e) => e);
    expect(err.code).toBe('functions/deadline-exceeded');
    expect(reason(err)).toBe('timeout');
    expect(err.message).toContain('check whether it was saved');
  });
});

describe('sign-in tokens', () => {
  it('S9 a stale token is refreshed once and the call repeated', async () => {
    const t = client({ [PRIMARY]: '401-once' });
    await expect(t.c.call('saveTariffSection', {})).resolves.toMatchObject({ ok: true });
    expect(t.tokens).toEqual([false, true]);
    expect(t.sent.map((s) => s.auth)).toEqual(['Bearer token', 'Bearer fresh-token']);
  });
  it('S15 a failure to get a token reaches the caller unchanged', async () => {
    const t = client({ [PRIMARY]: 'ok' }, { getToken: async () => { throw new BackendError('unauthenticated', 'Sign in required.'); } });
    await expect(t.c.call('saveTariffSection', {})).rejects.toMatchObject({ code: 'functions/unauthenticated' });
    expect(t.sent).toHaveLength(0);
  });
});

describe('the connection check', () => {
  it('names each address, what is wrong and what to do', async () => {
    const t = client({ [PRIMARY]: 'blocked', 'https://down.example.com': 'down', '': 'ok' });
    const r = await t.c.diagnose() as { addresses: { address: string; usable: boolean; verdict: string }[]; verdict: string };
    const by = Object.fromEntries(r.addresses.map((a) => [a.address, a]));
    expect(by[PRIMARY]!.usable).toBe(false);
    expect(by[PRIMARY]!.verdict).toMatch(/BLOCKED.*APP_ORIGINS/);
    expect(by['https://down.example.com']!.verdict).toMatch(/UNREACHABLE/);
    expect(by[PAGE]!.usable).toBe(true);
    expect(r.verdict).toMatch(/At least one address works/);
  });
});

describe('helpers', () => {
  it('parseBases keeps only http(s) addresses, trimmed, without trailing slashes', () => {
    expect(parseBases(' https://a.example.com/ , http://b.example.com,ftp://x, ,notaurl')).toEqual(['https://a.example.com', 'http://b.example.com']);
    expect(parseBases(undefined)).toEqual([]);
  });
  it('browserMemory works without sessionStorage', () => {
    const m = browserMemory('k');
    m.set('v');
    expect(m.get()).toBe('v');
    m.set(null);
    expect(m.get()).toBeNull();
  });
});
