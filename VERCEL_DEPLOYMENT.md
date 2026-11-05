# Deploying NESAM on Vercel

Vercel hosts the four web apps and the server API. Firebase stays the database,
sign-in and file store (Firestore, Auth, Storage) — Vercel replaces **Firebase Hosting
and Cloud Functions**, so no Blaze-plan Cloud Functions are needed.

```
 customer / driver / vendor / admin  ──(Firebase SDK)──►  Firestore · Auth · Storage   (protected by firestore.rules)
            │
            └─ Bearer <Firebase ID token> ──►  Vercel API  /api/call/<function>  ──(Admin SDK)──►  Firestore
```

## Why the server functions did not move into the browser

Booking creation, fares, wallets, payments, payouts, penalties, approvals and trip
stages are written **only** by server code: `firestore.rules` rejects every client
write to those fields. Moving that logic into the front-end would mean opening those
rules, and then any customer could set their own fare or credit their own wallet.
So the same, unchanged server code (`functions/src`) now runs as Vercel serverless
functions; the front-ends call it over HTTPS with the signed-in user's token. The
parts that are safe to run client-side (fare quotes, validation, UI logic) already
run in the apps, and nothing authoritative was loosened.

| Concern | How it is handled |
|---|---|
| Authentication | Every call needs a valid Firebase ID token, verified with the Admin SDK. |
| Authorisation | Unchanged: the same `requireAdmin` / ownership / state-machine checks as before. |
| Secrets | Only in Vercel environment variables on the API project (never `EXPO_PUBLIC_*` / `VITE_*`). |
| Allow-list | Only functions listed in `functions/src/registry.ts` are reachable; triggers/webhooks/cron are not. |
| CORS | Only the origins in `ALLOWED_ORIGINS`. Auth is a Bearer token, never a cookie. |
| Webhook | WhatsApp receipts require the Meta HMAC signature over the raw body. |
| Cron | Requires `Authorization: Bearer $CRON_SECRET`; fails closed if the secret is unset. |
| Errors | Internal errors are logged server-side and returned as a generic message. |

## Firestore triggers → API hooks

Vercel has no Firestore triggers. The four triggers and the scheduler became:

| Was | Now |
|---|---|
| `onBookingCancelled`, `onBookingMoneyChange`, `onBookingFinanceChange`, `onPayoutRequestWritten` | `reconcile` runs automatically after every server function that changes a booking / payout, and the apps call it after the few direct writes the rules allow (customer cancel, toll receipts, marketplace claim, dispatch). |
| Safety net | `GET /api/cron/reconcile` re-settles every booking written in the last 30 minutes. |
| `unassignedBookingAlerts` (every 10 min) | `GET /api/cron/alerts` |
| `whatsappWebhook` | `/api/whatsapp-webhook` |

All reconcile steps are idempotent (they derive from stored data), so running them twice is harmless.

## Projects to create (one Git repo, five Vercel projects)

| Vercel project | Root Directory | Framework | Env vars |
|---|---|---|---|
| `nesam-api` | `functions` | Other | see below |
| `nesam-customer` | `user` | Other | `EXPO_PUBLIC_API_URL` |
| `nesam-driver` | `driver` | Other | `EXPO_PUBLIC_API_URL` |
| `nesam-vendor` | `vendor` | Other | `EXPO_PUBLIC_API_URL` |
| `nesam-admin` | `admin` | Vite | `VITE_API_URL` |

`EXPO_PUBLIC_API_URL` / `VITE_API_URL` = the API project's URL, e.g. `https://api.nesam.example`
(no trailing slash). It is read **at build time**, so redeploy a front-end after changing it.
Build settings are already in each folder's `vercel.json`. If unset, the apps fall back to
Firebase callables (the native Android builds can keep using those).

### `nesam-api` environment variables

| Name | Required | Notes |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | yes | Firebase console › Project settings › Service accounts › *Generate new private key*. Paste the JSON (or its base64). |
| `FIREBASE_STORAGE_BUCKET` | optional | Defaults to `<project>.firebasestorage.app`. |
| `ALLOWED_ORIGINS` | yes | Comma-separated front-end origins, e.g. `https://customer.nesam.example,https://driver.nesam.example,https://vendor.nesam.example,https://admin.nesam.example`. `https://*.vercel.app` style wildcards are supported. |
| `CRON_SECRET` | yes | Any random string ≥ 16 chars. Vercel sends it automatically to cron paths. |
| `OTP_PEPPER` | yes | Random string used to hash customer verification codes. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | if using Razorpay | Payment functions answer `PAYMENT_NOT_CONFIGURED` until set. |
| `WHATSAPP_*`, `VEHICLE_LOOKUP_*`, `PLAY_INTEGRITY_PACKAGE_NAME`, `VENDOR_PORTAL_URL`, `ROUTING_URL` | as needed | Same names as `functions/.env.example`. |

## One-time steps

1. **Deploy rules and indexes from your machine** (Vercel does not do this):
   `firebase deploy --only firestore:rules,firestore:indexes,storage`.
2. **Create the five projects** above (Import Git repository → set *Root Directory*).
3. **Add the domains** of the four front-ends under Firebase console › Authentication ›
   Settings › *Authorized domains* (phone sign-in fails otherwise).
4. Set the environment variables, deploy `nesam-api` first, then the front-ends.
5. Check `https://<api>/api/health` returns `{"ok":true}`.
6. WhatsApp (if used): set the webhook URL to `https://<api>/api/whatsapp-webhook`.

## Limits to know about

- **Cron:** `vercel.json` schedules both jobs **daily** because the Hobby plan allows
  nothing more frequent. On Pro change them to `*/10 * * * *`, or call the endpoints
  from a free pinger (e.g. cron-job.org) with the header `Authorization: Bearer <CRON_SECRET>`.
  Day-to-day settlement does not depend on cron — it happens right after each action.
- **Duration:** functions are capped at 60 s. `rebuildPartnerLedger` (a rare back-fill, up to
  9 min on Firebase) needs a plan with longer limits or must be run in chunks.
- **Request size:** Vercel caps request bodies at 4.5 MB. Vehicle photos go to Storage first,
  so this does not affect them.
- **Rate limiting** in the API is per warm instance (best effort). For hard limits add
  Vercel's Firewall rate-limit rules on `/api/call/*`.
- **Push notifications** to Android still go through FCM from the server; browsers get
  in-app popups only (see `WEB_DEPLOYMENT.md`).

## Verifying locally

```bash
cd functions
npm install
npm run test:http      # builds, then checks routing, auth gate, CORS, cron secret, webhook signature
```
