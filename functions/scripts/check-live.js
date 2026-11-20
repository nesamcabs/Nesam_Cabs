#!/usr/bin/env node
// Checks the LIVE API the way the apps' browsers use it. Run after every deploy of the API or of an app:
//   node scripts/check-live.js [https://nesam-travels-api.vercel.app]
// For each NESAM web address it sends the preflight a browser sends and says whether the API will let that page read its replies.
// Needs `npm run build` first (it reads the allowed addresses from lib/corsOrigins.js). Exit code 1 when anything is wrong.
const { APP_ORIGINS, PUBLIC_CALLABLE_ORIGINS } = require('../lib/corsOrigins');

const API = (process.argv[2] || process.env.API_URL || 'https://nesam-travels-api.vercel.app').replace(/\/+$/, '');
const sites = [
  ...APP_ORIGINS.map((o) => [o, 'staff / partner app']),
  ...PUBLIC_CALLABLE_ORIGINS.filter((o) => o.startsWith('https://www.')).slice(0, 4).map((o) => [o, 'customer site']),
];
let bad = 0;
const line = (ok, text) => { if (!ok) bad++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${text}`); };

(async () => {
  console.log(`Checking ${API}\n`);
  try {
    const h = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(20000) });
    const j = await h.json();
    line(h.ok && j.ok, `health: HTTP ${h.status}, project ${j.auth?.projectId || '?'}, sign-in verification ${j.auth?.serviceAccount ? 'configured' : 'NOT configured'}, release ${j.release || 'unknown'}`);
    if (!j.auth?.serviceAccount) bad++;
  } catch (e) {
    line(false, `health: no reply (${e.message}). The API address is wrong, down, or its deployment was removed.`);
    process.exit(1);
  }
  for (const [origin, what] of sites) {
    try {
      const r = await fetch(`${API}/api/call/getLegalStatus`, {
        method: 'OPTIONS', signal: AbortSignal.timeout(20000),
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-client-request-id' },
      });
      const allow = r.headers.get('access-control-allow-origin');
      line(allow === origin, `${what.padEnd(19)} ${origin} → ${allow === origin ? 'allowed' : 'BLOCKED: the browser would refuse every call from this page. Add it to APP_ORIGINS and redeploy the API.'}`);
    } catch (e) {
      line(false, `${what.padEnd(19)} ${origin} → no reply (${e.message})`);
    }
  }
  const evil = await fetch(`${API}/api/call/getLegalStatus`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.net', 'Access-Control-Request-Method': 'POST' } }).catch(() => null);
  line(!!evil && !evil.headers.get('access-control-allow-origin'), 'unknown site https://evil.example.net → refused (as it should be)');
  const noTok = await fetch(`${API}/api/call/saveTariffSection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"data":{}}' }).catch(() => null);
  line(!!noTok && noTok.status === 401, `a call with no sign-in → HTTP ${noTok?.status} (expected 401)`);
  console.log(bad ? `\n${bad} problem(s) found.` : '\nAll good.');
  process.exit(bad ? 1 : 0);
})();
