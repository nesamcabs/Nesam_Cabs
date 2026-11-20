# API connectivity: problems, what the apps do, what to do

The Admin, Driver, Vendor and customer apps and sites call the NESAM API (`functions/`, on Vercel) with a signed-in token.
One shared client (`apiClient.ts`, the same file in each app) tells failures apart, recovers where it is **safe**, and otherwise
says plainly what happened. "Could not reach the server" is no longer the answer to everything.

After any deploy of the API or an app, run: `cd functions && npm run build && npm run check:live`
In a browser console on any app: `nesamApiCheck()` lists every address the app can use and which of them work.

## Rules that keep data safe
- A **read** (get…, quote…, search…, reconcile…) is repeated up to 2 times with a back-off after a dropped connection or a 502/503/504.
- A **write** is never repeated when it is unknown whether the first try ran (dropped connection, timeout, 5xx). The person is told to check before trying again.
- A write moves to the next address only when it is **provable** it never reached the server: the address is blocked (the browser stops it at the preflight), nothing can connect, "no deployment here", or the rate limiter said 429 (it answers before running anything).
- A stale sign-in token is refreshed once, then the call is repeated (the server rejects before running anything).
- The address that last worked is remembered for 10 minutes, so a dead primary costs one failed try, not one per call.
- Addresses are tried in order: the API (`VITE_API_URL` / `EXPO_PUBLIC_API_URL`), extras from `VITE_API_FALLBACK_URLS` / `EXPO_PUBLIC_API_FALLBACK_URLS` (comma separated), then the app's **own** `/api` (a Vercel rewrite in each `vercel.json`, never a cross-site request, so CORS cannot block it).

## Scenarios
| # | Problem | What the person sees | What the app does | What you do |
|---|---|---|---|---|
| 1 | **This website's address is not allowed by the API (CORS)** — the Admin outage | Nothing was sent; the message names the blocked address (`origin-blocked`) | Uses the app's own `/api` forwarder if it has one, remembers it | Add the address to `APP_ORIGINS` in `functions/src/corsOrigins.ts` (or `ALLOWED_ORIGINS` on the API project) and redeploy the API. `check:live` shows BLOCKED. The API logs `[cors] refused origin` once per address. |
| 2 | API host removed or renamed (`DEPLOYMENT_NOT_FOUND`) | "Server not responding, nothing was sent" if nothing else works | Skips it, uses the next address / own `/api` | Re-attach the domain or point `*_API_URL` at the new one; set `*_API_FALLBACK_URLS` so a spare address exists |
| 3 | API down or DNS failure | "Server not responding, nothing was sent" (`server-unreachable`) | Fails over (reads and writes: nothing was delivered) | Check the Vercel project's status and logs |
| 4 | Device offline | "You are offline" at once; nothing is sent | Does not probe or retry | — |
| 5 | Connection drops mid-read (mobile network, cold start) | Nothing, the answer simply arrives | Retries with back-off | — |
| 6 | Connection drops during a **save / approve / payment** | "Check whether it was saved before trying again" (`connection-dropped`) | Does **not** repeat it | Open the record to see whether it saved |
| 7 | 502/503/504 from the gateway on a read | Nothing | Retries | — |
| 8 | 502/503/504 or a crashed function on a write | "Server busy or restarting" | Not repeated, not sent elsewhere | Check Vercel function logs |
| 9 | Rate limited (429) | Nothing for one hit | Waits for `Retry-After` (max 5 s) and repeats once, writes included | — |
| 10 | Call takes too long | "Check whether it was saved before trying again" | Not repeated | Check Vercel function duration/logs |
| 11 | Sign-in token stale or clock drift (401) | Nothing | Refreshes the token once and repeats | If it persists: sign out and in |
| 12 | Token revoked, wrong Firebase project, API without credentials | The server's message with a reference | Does not retry (a new token cannot fix it) | Fix the API's service account / project |
| 13 | Server refuses the request (validation, permission, version conflict) | The server's own message | Passed through untouched, never retried | — |
| 14 | The app's own `/api` has no forwarder (serves the web page, HTTP 405) | Not mistaken for the API | Treated as "no address here", next one is tried | Deploy the app with the `/api` rewrite in its `vercel.json` |
| 15 | Signed-out visitor | Public calls work without a token | Sent with no `Authorization` header | — |

## Where things are
- Client: `apiClient.ts` in `admin/src/services`, `vendor/src/services`, `driver/src/services`, `user/app/src/services` (the website uses the customer app's copy) and `People_Taxi` / `One_Way_Car_Rentals` `src/core/services`. Tests: `user/app/__tests__/apiClient.test.ts` (25 scenarios). Keep the copies identical.
- Server CORS: `functions/src/corsOrigins.ts` (`APP_ORIGINS`, preview patterns), `functions/src/http/util.ts` (`applyCors`, logging). `GET /api/health` reports whether the **caller's** address is allowed and the deployed release.
- Same-origin forwarders: the first rewrite in each web app's `vercel.json`.
