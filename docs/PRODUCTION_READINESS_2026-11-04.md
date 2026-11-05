# Production readiness record — 4 November 2026

Maintained checklist for the NESAM platform. Status words: **unreviewed**, **reviewed in code**, **tested** (an automated check ran and passed), **fixed + retested**, **blocked**. A build or type-check alone is never recorded as "tested".

## 1. Inventory

| Id | Path | Stack | Run / build | Deploy target (from repo) |
|---|---|---|---|---|
| NESAM customer web | `user/web` | React 19 + Vite, shares `user/app/src` via `@core` | `npm run dev` / `npm run build` (also regenerates multi-domain sitemaps/robots) | Vercel (`vercel.json`), 6 domains |
| NESAM customer app | `user/app` | Expo 57 / RN 0.86 | `npm run android` / `eas.json` | Android (Play) |
| One Way Car Rentals web | `one_way_car_rentals` | React 19 + Vite | `npm run build` | Vercel (onewaycarrentals.in) |
| People Taxi web | `people_taxi` | React 19 + Vite | `npm run build` | Vercel (peopletaxi.in) |
| Driver app / web | `driver/app`, `driver/web` | Expo / Vite | as above | Android / web |
| Vendor app / web | `vendor/app`, `vendor/web` | Expo / Vite | as above | Android / web |
| Admin + super-admin | `admin` | React 19 + Vite + Tailwind 4 | `npm run build` | Vercel |
| Backend | `functions` | Firebase Functions (Node, TS), Firestore, Storage, Auth; HTTP mirror in `functions/api` | `npm run build`, `npm test` | Firebase (Blaze) and/or Vercel |
| Rules | `firestore.rules`, `storage.rules`, `firestore.indexes.json` | | `firebase deploy --only firestore,storage` | Firebase |
| Scripts | `scripts/` | Node | seeding / audits | local |

No separate OneWayCarRentals / People Taxi mobile apps exist in the repo: both are web-only, and **all three brands share one backend and one Firestore** (brand is a field on bookings/tariffs; `brandContext.ts`, `fareScope.ts`). Pricing, GST and service rules are scoped per brand/service with a "Common" baseline (see `FARE_WORKSPACE_CORRECTION_2026-10-30.md`).

Roles: customer, driver, vendor, staff (`admins/*` with `staffRole`, permissions and module actions in `permissions.ts`, `staff.ts`), super admin.

## 2. Work done in this pass

| # | Finding | Fix | Status |
|---|---|---|---|
| 1 | `vendor/app` did not compile: two sheet components had been pasted into the middle of a JSX block in `VehiclesScreen.tsx` (broke the release build and hid the vehicle "Availability" / "Renew a document" buttons) | Components moved to module level, buttons restored | fixed + retested (tsc, jest) |
| 2 | Global fare adjustment (`business_config/fare_adjustment`) is still applied by the fare engine but its editor was dropped from the admin in the 3 Nov pricing rewrite — staff could neither see nor switch it off | `FareAdjustmentCard` re-mounted under Pricing rules → Common | fixed (admin build + workspace test) |
| 3 | No account-deletion path anywhere (Play Store / App Store / DPDP requirement) | New callable `requestAccountDeletion` (`functions/src/support.ts`): authenticated customer/driver/vendor, one open request per account, creates a Support ticket "Account deletion", audit entry, office alert, email acknowledgement. Nothing is erased automatically. UI: customer app Settings, NESAM/OWCR/People Taxi Account page, driver app Profile → Help, vendor app Profile. Public "Account & Data Deletion" policy section on all three sites (`/legal#deletion`) | fixed + tested (4 emulator tests) |
| 4 | NESAM website `/legal` called a sign-in-only function, so signed-out visitors (store reviewers, crawlers) saw an error instead of the privacy policy | Public static policy sections (same as sister sites) + signed-in agreement versions below | fixed (build) |
| 5 | About page missing on One Way Car Rentals and People Taxi | `AboutPage` + route `/about`, footer, side drawer, Account list, SEO, prerender and sitemap entries | fixed (typecheck/build) |
| 6 | Customer-facing OTP errors told users to "add a test number in Firebase Console", exposed plan limits and test OTP `123456` (user web, OWCR, customer app, driver/vendor web) | Replaced with customer-safe messages; diagnostics stay in the console log | fixed (typecheck/build) |
| 7 | Customer app estimate said GST "Included in the total payable" while the booking record says "Added on top of the fare…" (failing parity test) | Wording aligned to the server | fixed + retested |
| 8 | Copyright / company line missing in app About screens; no support email in apps | Added to customer, driver, vendor apps | fixed (typecheck) |
| 9 | Emulator suites had rotted (95/180 failing): they assumed GST is *added* to the tariff, but since 3 Nov the default is *included*; partner pricing moved to `booking_pricing_private`; fixtures sent map pins where master locations are required; shared emulator state leaked between files | Test expectations updated to the current documented rules, `booking()` helper joins private pricing, new `test/runE2e.cjs` wipes the emulator between files | see section 4 |
| 10 | Stale admin workspace test and jest module resolution for shared server code | `scripts/admin-workspaces.test.cjs` updated; `modulePaths` added to `user/app` jest config | fixed + retested |

## 3. Coverage checklist

| Area | Item | Status |
|---|---|---|
| Public pages | About: NESAM web, OWCR, People Taxi, customer app (Settings → About) | fixed (builds); customer app dedicated screen not added — About is a card in Settings |
| | Terms / privacy / cancellation / refund / fare & payment / safety / deletion | reviewed in code; text is the project's own working text, **not legally reviewed** (blocker L1) |
| | Footer, drawer, account links on all 3 sites | reviewed in code |
| | Copyright notice | footers on 3 sites (existing), About pages, app Settings/Profile |
| Auth | Phone OTP sign-in, error messages | fixed; rate limiting is Firebase's (see S2) |
| Booking | Quote → create → approve → assign → trip → completion → payment → settlement (vendor and owner-driver paths) | tested (emulator `crossRoleJourneys`, `integration`) |
| | Advance-booking rules, duplicate submissions, concurrent credit | tested (`advanceBooking`, `wiringFixes`) |
| | Pricing: one-way, round trip, airport, rental, multicity, fixed routes, business contracts, GST modes, per-brand/service scopes | tested (`serviceFareControls`, `serviceFareMatrix`: 80 brand × service × class cases) |
| | Gateway payment idempotency / webhook | tested at function level (`G1`, `walletRecharge`); **live Razorpay not tested** (B3) |
| Admin | Panel permissions, staff credentials | tested (`adminPanel`, `staffCredentials`) |
| | Every admin page/button | reviewed previously (`ADMIN_CONTROL_AUDIT_2026-10-29.md`); not re-clicked in a browser in this pass (B5) |
| Mobile | Release builds, push, deep links, permissions, offline | **not tested** — no device/emulator session in this pass (B5) |

## 4. Test commands and results (this working tree, 4 Nov 2026, Windows, Node 24, Java 17, firebase-tools 13 via `npx`)

| Command | Result |
|---|---|
| `tsc --noEmit` in admin, driver/web, vendor/web, user/web, one_way_car_rentals, people_taxi, driver/app, user/app, vendor/app, functions | all pass (vendor/app failed before fix #1) |
| `functions`: `node --test` unit files (tariff, pricing, payment wiring, advance booking, HTTP registry, partner ops, business pricing, groq, round trip, multicity, service rules) | 68 / 68 |
| `user/app`, `driver/app`, `vendor/app`: `jest --ci` | 65 / 65, 81 / 81, 46 / 46 |
| `user/web`, `one_way_car_rentals`, `people_taxi`: `vitest run` | 8, 4, 6 files — all pass |
| `scripts/admin-workspaces.test.cjs` | 6 / 6 |
| `npm run build` in admin, driver/web, vendor/web, user/web, one_way_car_rentals, people_taxi | all succeed |
| Emulator e2e: `npx firebase-tools@13 emulators:exec --config ../firebase.e2e.json --project demo-nesam --only auth,firestore,functions "node test/runE2e.cjs"` (in `functions/`) | see "E2E result" below |

Environment used: local Firebase emulators (Auth, Firestore, Functions) with a stubbed routing server. Nothing touched production, real SMS/WhatsApp/email, or Razorpay.

Not run: Android builds (`expo run:android`/EAS), browser end-to-end, Razorpay sandbox, Google Maps live keys, push delivery.

### E2E result

(filled in below after the final run)

## 5. Environment variables (names only)

Backend (`functions`): `OFFICE_EMAIL`, `CRON_SECRET`, `GROQ_API_KEY`, `GROQ_MODEL`, Razorpay key id/secret and webhook secret, Google Maps server key, SMS/WhatsApp/email provider credentials (see `functions/DEPLOYMENT.md`, `docs/AI_CHAT_SETUP.md`). Clients: `VITE_API_URL` / `EXPO_PUBLIC_API_URL`, `VITE_FIREBASE_*` / `EXPO_PUBLIC_FIREBASE_*`, `EXPO_PUBLIC_GEOCODER_URL`, `EXPO_PUBLIC_ROUTING_URL`, `EXPO_PUBLIC_COMPANY_UPI_ID`, `VITE_MAP_ATTRIBUTION`. Real values are not in this document and must not be committed.

## 6. Deploy / rollback

1. `cd functions && npm run build && npm test` (unit), then the emulator command above.
2. `firebase deploy --only functions` (new callable `requestAccountDeletion`), then `--only firestore:rules,storage` if rules changed (this pass changed no rules).
3. Web apps: build each (`npm run build`) and deploy to its Vercel project; `user/web` build regenerates sitemaps/robots for the 6 domains.
4. Android: EAS build per app (`eas.json`); release signing credentials stay in EAS, not in the repo.
5. Rollback: redeploy the previous Vercel deployment; `firebase functions:delete requestAccountDeletion` is safe (nothing depends on it); previous function versions via git tag + `firebase deploy`. No data migrations were added in this pass.
6. Backups: Firestore export schedule is not configured in the repo — see B6.

## 7. Owner decisions and information needed (not guessed)

| Id | Needed |
|---|---|
| L1 | Legal review of the policy text on all three sites and of the seeded `legal_documents` (they are templates). |
| L2 | Grievance officer name/contact and complaint-handling timetable (required for Indian e-commerce/consumer rules), registered office address if different from Theni, CIN/GSTIN to publish, motor-vehicle aggregator licence status for the operating states. None of these are in the repo and none were invented. |
| L3 | Data-retention periods (bookings, invoices, KYC documents, location data) — drives the account-deletion procedure and the Play "Data safety" form. |
| L4 | Account deletion is a *request* flow. Decide whether to automate erasure (anonymise profile, delete auth user, keep invoices) and the target turnaround to publish. |
| P1 | GST rounding: with GST included, a ₹2,350 tariff fare can quote as ₹2,349.99 (taxable value and 5 % of it cannot sum to every inclusive total). Decide whether total payable must equal the rate exactly (tax = total − taxable) or tax must equal exactly 5 % of the taxable value (current). |
| P2 | Default GST treatment with no saved rule is now *included* (since 3 Nov). Confirm this is the intended customer-facing rule for all three brands; the legacy category engine still adds GST on top. |
| P3 | City-drop zones and "load documented defaults" had their only editor (`TariffConfigCard`) removed in the 3 Nov redesign. Decide whether to restore a small zones editor, or seed through `scripts/populate-approved-categories-and-tariff.cjs`. |
| P4 | Existing open items from earlier notes: extra charges billed at actuals not wired; partner dues excess payment; razorpayWebhook secret; Groq key. |

## 8. Launch blockers (priority order)

1. **L1/L2 legal and business details** (privacy policy URL is public now, but content unreviewed; grievance officer missing).
2. **B3 Payments**: webhook secret and a sandbox end-to-end Razorpay run (create order → pay → webhook → receipt → refund) have not been done; customer payments are also switched off by `CUSTOMER_PAYMENTS_ENABLED=false` (pay-later model), so decide the launch payment model.
3. **B5 Device and browser verification**: no Android release-build, push-notification, location-permission, offline or deep-link testing was possible in this pass; no browser click-through of admin/driver/vendor panels.
4. **S2 Abuse controls**: OTP limits rely on Firebase Auth defaults; there is no App Check / device-attestation enforcement evidence in the repo for callables (`security.ts` exists — verify it is enforced in production config).
5. **B6 Operations**: no scheduled Firestore backup/restore procedure, no monitoring/alerting configuration, and the cron/`periodicJobs` scheduler needs Blaze or an external cron (`docs/cron-schedule.disabled.json` indicates it is currently off).
6. **P1/P2/P3** decisions above.
7. Account-deletion operating procedure (L3/L4) before store submission.

## 9. Candid assessment

Code health is better than the failing suites first suggested: after correcting stale test assumptions, the booking, pricing, payment-recording, settlement and admin-permission paths behave consistently in the emulator. But the platform is **not yet production-ready**: legal/business disclosures are unreviewed, payments and notifications are unverified against live sandboxes, mobile apps were not run on a device, and backup/monitoring are not in place. These are listed above with the exact missing input. Treat this record as the starting checklist for the next session.
