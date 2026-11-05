# NESAM wiring audit — 29 October 2026

Local source and automated verification of customer, driver, vendor, admin, People Taxi and One Way Car Rentals. Changes are local; nothing was deployed and no real payment or outbound message was sent.

## What the checks establish

- 779 TypeScript/TSX source files inventoried across nine frontends, including legacy source. This is a static inventory, not a claim that all files are reachable screens.
- 180 literal backend call sites checked against 96 registered endpoints. No missing endpoint names. The small number of dynamic calls are transport wrappers; marketplace, staff and partner-link wrappers were followed to their literal call sites.
- All 36 admin sidebar entries have a rendering route and an explicit access rule. This proves wiring, not successful use by every staff role.
- Customer web imports shared customer app services through `@core`; Vite substitutes browser Firebase persistence and browser location support. People Taxi and One Way Car Rentals use the same shared backend.
- Customer, driver, vendor and admin Firebase defaults point to `nesamtoursandtravels-202f5`. Each Android google-services configuration matches its app package and the same Firebase project.
- All three mobile Expo prebuild configurations resolve their declared plugins successfully. Camera, location, notifications, audio, document/image pickers, sharing and local build plugins are configured where used. This is configuration validation; no APK/device runtime was exercised.

## Results

| Check | Result |
|---|---|
| Customer, driver, vendor app typechecks | Pass |
| Customer, driver, vendor web and admin typechecks | Pass |
| Backend TypeScript build | Pass |
| Customer web, driver web, vendor web, admin, People Taxi, One Way Car Rentals production builds | All six pass |
| Customer app tests | 65 pass, including account-switch privacy and stale quote regressions |
| Driver app tests | 81 pass after renderer cleanup fix |
| Vendor app tests | 46 pass |
| Customer web tests | 22 pass |
| People Taxi tests | 15 pass |
| One Way Car Rentals tests | 9 pass |
| Backend unit/transport tests | 57 pass, including export parity and webhook raw-byte handling |
| Firebase emulator journeys | 56 / 56 pass in the final complete run (`output/wiring-e2e-complete.log`) |
| Mobile lint | Zero errors in all three apps; existing warnings remain |

The final suites total 351 passing automated tests. An earlier complete run had an intermittent reassignment test failure; explicit setup assertions were added, and both the focused rerun and final complete run passed. This is recorded rather than treating the earlier run as clean.

Builds report some large JavaScript chunks. These are performance warnings, not connection failures. Test execution used installed dependencies and a cached Firebase CLI to avoid unnecessary downloads. Mobile Jest caches were placed inside `output/` because Windows temporary-directory renames were denied.

## Fixes made

1. **Firebase deployment missed three HTTP endpoints.** `createRazorpayOrder`, `verifyRazorpayPayment` and `reconcile` existed in the HTTP registry but were absent from `functions/src/index.ts`. Added exports and a regression test requiring every registered callable to have the same Firebase export.
2. **Firebase lacked the Razorpay webhook entry point.** Added a Firebase HTTP function with its webhook secret explicitly bound. It shares the existing Vercel handler and uses Firebase's preserved raw request bytes, so signature validation does not depend on JSON reserialization. Tests cover both transports, tampering and oversized bodies. It is excluded from the client-callable registry.
3. **Wallet recharge depended on the checkout callback returning.** The existing webhook handled booking orders only. Added capture recovery for stored wallet orders, with authoritative owner/amount checks and a single credit per order even if callbacks/webhooks replay. Added an emulator regression test.
4. **Driver render tests leaked mounted screens.** Registered all renderer instances for unmounting after each test; the screen time interval now cleans up and Jest exits without post-test state updates.
5. **Existing integration fixtures described old contracts.** Vendor bids now require explicit automatic-acceptance consent, already sent by the vendor UI. Fixtures now send that consent and test rejection without it. Pickup GPS verification is deliberately disabled in both driver UIs and server; replaced obsolete geofence assertions with driver-confirmed arrival assertions while retaining boarding OTP, photo, schedule and admin override checks.
6. **Provider setup template was incomplete.** Added the implemented SMS, WhatsApp, email, webhook and integrity environment variable names to `functions/.env.example`. No credentials were inserted.
7. **Mobile hook checks failed.** Replaced render-time animation ref access with stable lazy state; moved quote request refs into an effect and reset quotes when request identity changes; keyed customer data by account to clear previous trips immediately; removed unnecessary effect state updates in vendor onboarding and driver profile section navigation. Two new customer tests verify account data isolation and rejection of stale/late quote results. All mobile lint errors are resolved; existing unused-import/dependency warnings remain.

## Feature and option coverage

| Area | Connections inspected / exercised | Limit |
|---|---|---|
| Customer booking | One way, round trip, local rental, airport; quote, category, schedule, return date, terms, request creation | Automated tests cover selected pricing/booking paths; every combination was not clicked in a browser |
| Customer account | Authentication, profile, saved places, trips, payments/refunds, offers, support, legal consent, notifications | Source wiring and existing tests; real SMS and all UI actions not exercised |
| Driver | Home, marketplace, bids, trip history, arrival, boarding OTP, vehicle-photo gates, start/end, tolls, payments, earnings, wallet, notifications, profile/KYC | Emulator/service tests plus render tests; physical GPS, camera and Play Integrity not exercised |
| Vendor | Registration/KYC, fleet, drivers, partner links, marketplace/consent, dispatch, assignment, wallet recharge, payouts, penalties, requests | Source/service/emulator checks; real gateway checkout not exercised |
| Admin operations | Dashboard, bookings, trips, marketplace, partner requests, manual booking, assignment and cancellation | Route/access inventory and selected emulator journeys |
| Admin people/fleet | Customers, business accounts, drivers, vendors, vendor drivers, vehicles, verification, partner links, vehicle categories | Route/access inventory and selected linking/eligibility tests |
| Admin finance | Accounts, penalties, invoices, GST/reports, full & final, payments, driver earnings, vendor finance, commissions | Route/access inventory and selected ledger/payment/settlement tests |
| Admin office | Fare/service settings, communication, support, staff/access, activity, settings, coupons, services, packages, locations, reviews, B2B, legal | All menu routes/access rules present; every CRUD/export control was not interactively exercised |
| Security/data | Client-write restrictions, partner contact masking, employee restrictions, staff permission gates, webhook signatures | Emulator rules tests and transport tests; no deployed rules audit |

## Explicit limits and unfinished integrations

- **Lint warnings:** customer 11, driver 3, vendor 11; these are unused imports/variables and dependency/import-order suggestions, not failing lint errors. See `output/wiring-*-lint-final.log`.

- **Provider credentials:** the local `functions/.env` has no usable Razorpay, WhatsApp, SMS, SendGrid, vehicle lookup or Play Integrity settings. Deployed secret/environment values were not inspected. Emulator dummy keys are not evidence of a working provider account.
- **Customer online checkout:** customer web explicitly says online/advance payment is unavailable. Payment history and cash/UPI collection are wired. Server payment endpoints existing does not mean the customer has a live checkout UI.
- **Wallet recharge:** server and checkout wiring exist; live capture, bank settlement and refund delivery still need provider sandbox/device acceptance with configured credentials.
- **Multicity:** no multi-stop server trip type; the website intentionally directs this service to phone booking.
- **Maps:** native customer map is currently in its documented external-Google-Maps fallback (`mapsEnabled` false); embedded native map requires an Android Maps key at build time. Browser maps use Leaflet; routing/geocoding availability was not live-tested.
- **Arrival verification:** driver-confirmed, with GPS enforcement disabled. Existing radius/accuracy settings do not enforce a pickup geofence in the current server. This audit preserves that explicit product behavior; it does not certify GPS enforcement.
- **Push:** Android project/package configuration exists; actual notification delivery and tap handling on a physical device remain unverified.
- **Scheduling:** Vercel configuration contains no active cron schedule. Firebase scheduled jobs or a configured external scheduler are required for automatic sweeps; emulator invocation does not establish that a production scheduler runs.
- **B2B:** the admin B2B page lists `b2b_partners`; this does not establish an external corporate booking API/plugin integration.
- **Tariff controls:** some airport base/payout controls themselves state their saved values are not yet applied until the formula is confirmed. Saving a field is not proof that quotes consume it.
- **Production:** no deployed URLs, staff/customer sessions, provider dashboards or production rules/indexes were checked. The host uses Node 24 while the backend targets Node 22; emulator results therefore do not replace validation in the deployed Node 22 runtime.

## Repeatable evidence

Run `node scripts/audit-wiring.cjs` from the repository root. It performs no network request and writes `output/wiring-inventory.json`, including screen paths, per-file call sites, navigation coverage and configuration-presence booleans. It never outputs secret values. It exits unsuccessfully on missing registered endpoints, missing Firebase exports or missing admin routes/access rules.

Test/build logs are `output/wiring-*.log`. Native resolved configuration and Jest caches are ignored generated outputs. `npm test` in `functions` includes the wallet webhook regression in the emulator suite. Real-provider and device checks remain separate acceptance work; a passing local suite is not a complete production readiness certification.
