# Booking connection and environment diagnosis

Checked 16 October 2026. Scope: supplied production screenshots, current source, and read-only requests to the public deployment. No production configuration or application code changed.

## Confirmed production failure

The customer site at https://nesam-travels-user.vercel.app/ returns HTTP 200.

Browser preflight requests using that origin, requested method POST and requested header content-type return:

| URL | HTTP status | Access-Control-Allow-Origin |
|---|---|---|
| https://us-central1-nesamtoursandtravels-202f5.cloudfunctions.net/quoteBooking | 404 | absent |
| https://us-central1-nesamtoursandtravels-202f5.cloudfunctions.net/getLegalStatus | 404 | absent |

The browser reports CORS because it cannot read those responses. The underlying endpoint availability failure must be resolved first; merely allowing more origins in an unrelated HTTP handler will not create these Firebase endpoints.

These checks establish that the requested endpoints are unavailable at those exact addresses. They do not distinguish absent deployments from a wrong project/region/URL or platform-level configuration. Firebase deployment inventory and hosting environment settings were not available in this investigation.

## Why the application starts without a .env file

- Customer browser Firebase initialization (`user/web/src/platform/firebase.ts`) includes literal fallback public Firebase configuration. Driver and vendor browser Firebase initialization and admin configuration do likewise.
- These public identifiers allow Firebase SDK initialization independently of a local `.env`; they are not server service-account credentials.
- Customer transport (`user/app/src/services/backend.ts`, reused by the website) selects HTTP only when `EXPO_PUBLIC_API_URL` is nonempty. Customer Vite also maps `VITE_API_URL` to that setting. Otherwise it calls Firebase Functions using `getFunctions(app)` with its default region.
- Driver and vendor browser transports use `VITE_API_URL`; when empty they also call Firebase Functions. Admin uses the same VITE_API_URL convention.
- The screenshot shows Firebase Functions requests, establishing that the pictured customer deployment is using the Firebase transport rather than the Vercel HTTP API.
- Hosting environment variables can be injected at build time without a local `.env`. The actual remote variable inventory was not inspected. No local frontend `.env` or extensionless `env` file was found at the checked customer, driver, vendor and admin web roots.
- Loading the UI, signing in or reading Firestore does not prove the privileged backend endpoints are deployed and working.

## Supported remedies

Choose the existing intended deployment architecture. Do not mix URLs or invent an API hostname.

### If using the Vercel API

1. Verify/deploy the existing `functions` HTTP API project and obtain its actual base URL. Configure its server-only Firebase credentials and required server variables through the host, never in frontend variables.
2. Set customer `EXPO_PUBLIC_API_URL` (or its supported VITE_API_URL alias), driver web `VITE_API_URL`, vendor web `VITE_API_URL` and admin `VITE_API_URL` to that actual base URL.
3. Set API-side `ALLOWED_ORIGINS` to the actual frontend origins. This setting controls `functions/src/http/util.ts`, not Google Cloud's missing-endpoint responses.
4. Rebuild/redeploy each affected frontend; these values are captured at build time.
5. Verify `/api/health`, then preflight and authenticated `/api/call/quoteBooking` and `/api/call/getLegalStatus`, and complete the booking flow with test accounts. Health alone is insufficient proof.

### If using Firebase Functions

1. Inspect deployed functions for project `nesamtoursandtravels-202f5`, their region, and invocation configuration.
2. Deploy the required current exports, including quoteBooking, getLegalStatus and the rest of the operational callables, in the intended region with the necessary backend configuration.
3. Match frontend function region to the actual deployment. Confirm preflights and authenticated requests succeed, then verify the complete booking flow.

The older deployment documents contain outdated app root paths; the current browser projects inspected here are `user/web`, `driver/web`, `vendor/web`, and `admin`.

## Separate font error

The live customer CSP permits styles only from self and inline styles, and fonts only from self/data. `user/web/index.html` nevertheless requests a Google Fonts stylesheet. This is blocked by the configured policy. `user/web/src/main.tsx` already imports bundled Poppins weights through @fontsource/poppins, so the external stylesheet/preconnect links can be removed, or the font policy deliberately updated if external fonts are desired. This font problem does not explain the missing backend endpoints.

The reCAPTCHA Enterprise fallback message alone does not establish an authentication failure; the screenshot shows fallback to the v2 verification path. It is not evidence that reCAPTCHA caused these HTTP 404 responses.

## Verification boundary

No real booking, payment, dispatch, production data change or deployment was performed. The user's report says three applications are affected; current source shows the shared fallback pattern, but only the supplied customer deployment's endpoints were directly probed. No claim is made that all three deployed builds or their remote environment settings were inspected.
