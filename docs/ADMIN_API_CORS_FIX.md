# Admin API "CORS" failure — diagnosis and status

Date: 20 October 2026 · Status: **PARTIALLY DONE — configuration staged in Production, deployment BLOCKED (see §7)** · The old hostname is **not yet restored**; Admin is **still failing** until the steps in §7 are run.

## 1. Symptom
Admin (`https://nesamtravelsadmin.vercel.app`) shows "Could not reach the server" on Approve booking; the browser reports a failed preflight with no `Access-Control-Allow-Origin` for `/api/call/getLegalStatus` and `/api/call/approveBooking` on `https://nesam-travels-api.vercel.app`.

## 2. Root cause (confirmed) — not a CORS-handler defect
The real response from the API host is a Vercel platform error that never reaches our code:

```
OPTIONS https://nesam-travels-api.vercel.app/api/call/getLegalStatus   (Origin: https://nesamtravelsadmin.vercel.app,
        Access-Control-Request-Method: POST, Access-Control-Request-Headers: authorization,content-type)
HTTP/1.1 404 Not Found
X-Vercel-Error: DEPLOYMENT_NOT_FOUND            (same for /api/call/approveBooking, /api/health and a control origin)
```

1. The Vercel project `nesam-travels-api` (`prj_E3WUSiXj1fzslKFT4nFF0ywixhZP`) no longer exists in team `legendary-ones-projects`; the hostname resolves to no deployment (re-checked 20 Oct: still `DEPLOYMENT_NOT_FOUND`).
2. Its replacement is **`nesam_travels-functions`** (`prj_U04oLQ0z1P7ibocWw8sOVVuGw0Y9`, team `team_1lb2BSEvQimPcakaRVz6U1UT`, root dir `functions`, created 19 Oct 2026 14:41 IST). It serves `https://nesamtravels-functions.vercel.app`; latest Ready production deployment before my changes: `nesamtravels-functions-gfggil356-legendary-ones-projects.vercel.app`. It is the only API-shaped project in the team, matches `functions/.vercel/project.json`, and had no environment variables.
3. All four frontend projects have the dead host baked in at build time (`VITE_API_URL` on admin, driver, vendor; `EXPO_PUBLIC_API_URL` on user — all `https://nesam-travels-api.vercel.app`, Production+Preview). `onewaycarrental` and `people_taxi` have no API variable set (they do not use this HTTP API today).
4. With zero env vars the replacement also gave no CORS headers (`ALLOWED_ORIGINS` unset) and could not verify ID tokens (`FIREBASE_SERVICE_ACCOUNT` unset).

`functions/src/http/util.ts` / `call.ts` were reviewed and **not changed**: OPTIONS is answered before auth (204), the matching origin is echoed with `Vary: Origin`, methods `POST, GET, OPTIONS`, headers `Authorization, Content-Type`, and 401/404/500 JSON errors are sent after `applyCors`.

## 3. Verified identity and ownership (before any change)
| Item | Result |
|---|---|
| Vercel account | `vigneshsivakspm`, team `legendary-ones-projects` |
| Project | `nesam_travels-functions`, id above, root dir `functions`, Node 24.x, region iad1 |
| Firebase project | Service-account file `…\Downloads\nesamtoursandtravels-202f5-firebase-adminsdk-fbsvc-292e301f9a.json` exists, readable, `type=service_account`, `project_id=nesamtoursandtravels-202f5` (matches the project ID hard-coded in admin/driver/vendor/user configs). Only that file was read; contents never printed or logged. |
| Old hostname | Not assigned to any project in the team (`DEPLOYMENT_NOT_FOUND`). Ownership of the `.vercel.app` name cannot be proved from the CLI; whether Vercel lets this project claim it is **untested** (see §7). |

## 4. Production changes made (project `nesam_travels-functions`, Production only)
| Variable | Type | Value |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | sensitive | service-account JSON, uploaded from the named file via stdin (not printed). Project `nesamtoursandtravels-202f5`. |
| `ALLOWED_ORIGINS` | plain | `https://nesamtravelsadmin.vercel.app,https://nesamtravelsdriver.vercel.app,https://nesamtravelsvendor.vercel.app,https://nesamcabs.vercel.app,https://www.nesamtoursandtravels.in,https://www.nesamtravels.com,https://www.nesamtoursandtravels.com,https://www.nesamtravels.in` |

(`ALLOWED_ORIGINS` was first created as sensitive, then removed and re-created as plain so it can be audited; no deployment ran in between.)

**How the origins were verified** (project domain lists via the Vercel API, plus a live `GET /` on each):
- Admin `nesamtravelsadmin.vercel.app`, Driver `nesamtravelsdriver.vercel.app`, Vendor `nesamtravelsvendor.vercel.app` — verified domains of their projects, HTTP 200.
- Customer (`nesam-travels-user`): verified domains `www.nesamtoursandtravels.in`, `www.nesamtravels.com`, `www.nesamtoursandtravels.com`, `www.nesamtravels.in`, `nesamcabs.vercel.app` — all HTTP 200.
- **Excluded:** the apex customer domains (308 redirects to `www`, never the page origin); `nesam-travels-user.vercel.app` (appears in the project list but returns `DEPLOYMENT_NOT_FOUND`, so not a live origin); `nesamtravelsvendor.app` (team domain, not assigned to the vendor project, does not resolve); `peopletaxi.*` and `onewaycarrentals.*` (their projects have no API variable; add them if those sites are switched to the HTTP API); every wildcard (`*`, `https://*.vercel.app`). The previous project's list was unrecoverable, so any extra origin it had must be re-added by the owner.

Nothing else was changed: no cron schedules (none are declared in `functions/vercel.json`), no Razorpay/WhatsApp/SMS/email values, no alias, domain or project rename, no key deletion, no commit or push.

## 5. `OTP_PEPPER` — decision recorded, not set
- Used in `functions/src/customerVerification.ts` only to HMAC OTP codes (`codeHash`) and the per-phone rate-limit key (`phoneKey`). It is not read by `getLegalStatus`, `approveBooking` or any auth path, so it does **not** block this fix. Without it, `sendVerificationCode` / `verifyCustomerCode` return `failed-precondition` ("not configured").
- Effect of a **new** pepper on existing data: OTP records live 10 minutes (`CODE_TTL_MS`) and are stored with a status; already-`verified` bookings keep `customerVerified: true` (never recomputed). Only codes issued before the outage and still pending would fail, and they expired long ago. Rate-limit keys (1-hour window) simply reset. So no migration is needed and generating a fresh value is safe.
- Left unset on purpose because you asked that it not be generated silently. **Decision for you:** approve generating a new random ≥16-char `OTP_PEPPER` (recommended, then never rotate while codes are pending), or supply the old one if you still have it.

## 6. Checks executed
| Check | Type | Result |
|---|---|---|
| `npm run test:http` in `functions/` (build + 10 tests, including the new Admin preflight regression) | local | **10/10 pass** |
| `npm run test:e2e` from a scratch copy without the stray `.env` (Firebase Auth+Firestore+Functions emulators, isolated `demo-nesam` data) | emulator | **43/44 pass**, including `3. approval alone does not publish or notify partners` and the cross-role journeys. 1 failure: `X2. trip execution gates…` (`integration.e2e.test.js:322`, the `Trip Started` step after boarding OTP). Not an approval/legal-status path; not investigated further, so cause unknown. |
| Old host OPTIONS/GET | live | `404 DEPLOYMENT_NOT_FOUND` (unchanged) |
| Project identity, env var names/types, domain lists, origin liveness | Vercel API/CLI + live GET | as §3–§4 |

Note: the repo's `functions/.env` (git-ignored, dated 19 Oct, a blank template) makes `firebase emulators` fail with "Failed to load environment variables from .env" when run in place. I did not edit it; the e2e run used a copy of `functions/` without it under the scratchpad.

## 7. Blocker — production deployment was refused
`vercel redeploy https://nesamtravels-functions-gfggil356-legendary-ones-projects.vercel.app --target production` (rebuild of the current production commit so the new env vars take effect) was **denied by the session's auto-mode classifier ("Production Deploy")**. I did not retry or look for another way to trigger a production deploy. Consequently:
- The env vars exist but **no running deployment has them yet**; production `nesamtravels-functions.vercel.app` still behaves as in the original diagnosis (204 without `Access-Control-Allow-Origin`, 401 for unauthenticated calls).
- The hostname `nesam-travels-api.vercel.app` has **not** been re-attached; no alias or domain command was run.
- Nothing below was run: restored-hostname health/preflights, origin allow/deny matrix, missing/fake-token checks, Admin `getLegalStatus`, customer-forbidden `approveBooking`, live Admin browser inspection.

**To finish** (any of these, then rerun §8):
1. Allow the deploy (add a PowerShell permission rule for `vercel redeploy` / `vercel deploy`, or run it yourself): `cd functions; npx vercel redeploy https://nesamtravels-functions-gfggil356-legendary-ones-projects.vercel.app --target production`. Alternatively use Vercel dashboard → `nesam_travels-functions` → Deployments → ⋯ → Redeploy.
2. Verify on `https://nesamtravels-functions.vercel.app` first (health, preflights, 401s).
3. Re-attach the hostname: `npx vercel domains add nesam-travels-api.vercel.app nesam_travels-functions` or Settings → Domains → add `nesam-travels-api.vercel.app` (a `.vercel.app` name is only claimable if Vercel treats it as free; if it refuses, the fallback is to set `VITE_API_URL` (admin, driver, vendor) and `EXPO_PUBLIC_API_URL` (user) to `https://nesamtravels-functions.vercel.app` and rebuild all four plus any mobile builds — **not done; needs your decision**). Do not rename or delete other projects.
4. Provide a test Admin account (or run a Firebase ID-token mint with the service account) for the authenticated checks.

## 8. Verification plan once deployed (not yet run)
Health `200 {"ok":true}`; OPTIONS (`Origin`, `Access-Control-Request-Headers: authorization,content-type`) on `getLegalStatus` and `approveBooking` for each origin in §4 → 204 + echoed origin + `Vary: Origin`; `https://evil.example` and `https://nesam-travels-user.vercel.app` → no `Access-Control-Allow-Origin`; no token / fake token → 401 JSON with CORS header; Admin token → `getLegalStatus` ok; customer token → `approveBooking` permission-denied; then load the live Admin and confirm the Network tab shows 200s (transport only). Real approval of the screenshot booking must not be run; approval is covered only by the emulator test above.

## 9. Local files touched
- `functions/test/http.test.js` — regression test added earlier (uncommitted).
- `functions/.vercel/project.json` — local link now points at `nesam_travels-functions` (git-ignored).
- `docs/ADMIN_API_CORS_FIX.md` — this report.

## 10. Second attempt (20 Oct 2026, later) — still blocked at the deploy step
Re-verified before acting: Production env on `nesam_travels-functions` still holds `ALLOWED_ORIGINS` (plain) and `FIREBASE_SERVICE_ACCOUNT` (sensitive); the old host still returns `404`; `https://nesamtravels-functions.vercel.app/api/health` → `200 {"ok":true,…}`. The running deployment is still `nesamtravels-functions-gfggil356-…` (built before the env vars existed).

| Probe on `nesamtravels-functions.vercel.app` | Result now |
|---|---|
| OPTIONS `getLegalStatus` / `quoteBooking` / `approveBooking`, Origin `https://nesamcabs.vercel.app` and `https://nesamtravelsadmin.vercel.app`, `Access-Control-Request-Headers: authorization,content-type` | `204`, `Vary: Origin`, **no `Access-Control-Allow-Origin`** (env not yet in the running build) |
| POST, no token (all three functions) | `401 {"error":{"code":"unauthenticated","message":"Sign in required."}}` |
| POST, fake bearer (all three) | `401 … "Your session has expired. Please sign in again."` |

The `vercel redeploy … --target production` command was refused a second time by the session's "Production Deploy" check even though the task text authorizes it. I did not retry or use another mechanism. **Manual action:** Vercel dashboard → `nesam_travels-functions` → Deployments → deployment `nesamtravels-functions-gfggil356-legendary-ones-projects.vercel.app` → ⋯ → Redeploy (Production, use existing build cache off), or add a PowerShell permission rule for `vercel redeploy` and ask me to continue.

Not done, deliberately: hostname reassignment and frontend `VITE_API_URL` / `EXPO_PUBLIC_API_URL` changes (the replacement must be verified first; the old name is currently unreachable so frontends are no worse off), authenticated `getLegalStatus` / `quoteBooking` / `approveBooking` checks, quote/category/fare data check (needs the deployed API or production Firestore read access, neither granted), and the Firestore `Listen/channel` message review (only meaningful after the API works).

Test change: `functions/test/http.test.js` now also covers `quoteBooking` in the preflight/401 regression — `npm run test:http` 10/10 pass.
