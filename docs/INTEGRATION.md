# NESAM Travels — integration record

This is the working record of how the Customer, Admin, Vendor and Driver applications connect to the shared
server (`functions/src`), what is verified and by what, and what is still open. Statuses are deliberately
strict: **Verified** means exercised by an automated emulator test or a browser run described below; a passing
typecheck or build alone is marked **Typecheck/build only**.

- Business sources: *Developer Functional Specification v1.0*, *Tariff & Operations v2.0* (09 Oct 2026, supersedes
  the 10 % normal-trip commission), *Vehicle Category and Vendor Duty Rules*. Historical audit:
  `output/spec-audit/PROJECT_PENDING_AUDIT.md`.
- Confirmed flow: **all bookings are advance bookings**; Admin chooses publish / vendor / owner-driver; approval
  alone never publishes.

## 1. Architecture and transport

| Layer | Entry point | Notes |
|---|---|---|
| Admin | `admin/src/App.tsx` (Vite) | Calls server functions through `services/backend.ts`; reads Firestore directly for lists. |
| Customer web | `user/web/src/App.tsx` | Imports shared customer logic from `user/app/src` via `@core`. |
| Customer app | `user/app/App.tsx` | Expo / React Native, same server. |
| Driver | `driver/App.tsx` → `MainNavigator` | `RootNavigator`, `DashboardScreen`, `MarketplaceScreen`, `TripExecutionScreen` are legacy and excluded from `tsconfig`. |
| Vendor | `vendor/App.tsx` | `vendorFirestoreService.ts`, `screens/main/*` are legacy and excluded. |
| Server | `functions/src/index.ts` (Firebase) / `functions/src/registry.ts` (HTTP) | One implementation, two transports. |

**Transports.** Every callable is exported from `index.ts` (Firebase callable) and listed in `registry.ts`
(`POST /api/call/:name`, Bearer ID token). The set of functions is identical; `functions/test/http.test.js` and
test `A1` check the registry. Clients use `callBackend`, which picks the HTTP API when `EXPO_PUBLIC_API_URL` /
`VITE_API_URL` is set and Firebase callables otherwise. **Supported configurations:** (a) Firebase Functions
(Blaze) with Firestore triggers and the `periodicJobs` scheduler, or (b) Vercel HTTP API where the same work runs
through `reconcile` hooks and `/api/cron/tick`. Mixed use of both writers is safe: every derived write is
idempotent.

**Scheduling.** Frequent work must not depend on Vercel Hobby. All jobs are backlog/watermark based
(`jobs.ts`: `system/reconcile_state`, `reconcile_failures/*`), so even the daily Vercel crons recover everything
missed. For minute-level behaviour provision one of: Firebase scheduled function `periodicJobs` (every 5 min,
Blaze), Vercel Pro cron on `/api/cron/tick`, or any external cron calling `/api/cron/tick` with
`Authorization: Bearer $CRON_SECRET`.

## 2. Booking and fulfilment state

```
Customer request (advance, pickup required, terms accepted)  → Pending
Admin approve (no partner notified)                           → Approved  [awaiting fulfilment]
  ├─ publish (mode: accept_offer | bid_review, optional escalation, cut-off)  → marketplace_trips Open
  ├─ assign vendor  (payout recorded; vendor then dispatches driver + vehicle) → Confirmed → Assigned
  └─ assign owner driver (+ approved eligible vehicle)                         → Assigned
Driver: Reached (fresh GPS) → boarding OTP → live photos (selfie + 3) → Trip Started → Trip Ended (total km)
Server: final fare from verified km → payments (receipts) → settlement due (completion + 4 h)
```

* Publication, reservation, resource assignment, execution, customer payment and partner settlement are separate
  records (`marketplace_trips`, `bookings.assigned*`, `bookings.tripSubStatus`, `payment_transactions`,
  `wallet_ledger`/`settlement_dues`).
* A direct assignment closes any open offer and rejects pending bids in the same transaction.

## 3. Data contracts added or changed

| Document | Fields (server-written) |
|---|---|
| `bookings/{id}` | `pricing` (model, quoted/included km, rates in paise, days, `partner` normal-rate snapshot, `gates`), `finalFare`, `totalKm`, `distanceDiscrepancy`, `dutyClass`, `tariffClass`, `tripEndAt`, `billableDays`, `phoneMasked`, `payoutSource` (`tariff`/`offered`/`bid`/`manual`), `reachedPickupOverride`, `contactViews`, `ratingCounted` |
| `booking_contacts/{id}` | raw `phone`, `whatsapp`, `email` — staff and the booking’s customer only |
| `contact_access_logs/*` | every reveal / denial (never the number) |
| `marketplace_trips/{id}` | `mode`, `dutyClass`, `eligibleVehicleClasses`, `startOffer`, `ceiling`, `escalation{step,…}`, `cutoffAt`, `publishedAt`, `wave2At/wave3At` |
| `marketplace_trips/{id}/bids/{party_uid}` | `bidderType`, `bidderId`, `vendorCounterRate`, `status` |
| `settlement_dues/{bookingId}` | amount, entitlement, collectedByPartner, `dueAt`, `status` (Due/Processing/Paid/Failed/On Hold/Wallet), hold, reference |
| `business_config/tariff_v2` | confirmed one-way, round-trip, rental, city-drop rate cards, zones, `enabled`, `version` |
| `bookings/{id}/gateway_orders/{orderId}` | provider order, amount in paise, status |
| `system/reconcile_state`, `reconcile_failures/*` | watermark and parked retries |

`paymentSummary` gained `companyCollected`; `partnerCashHeld` now means *everything the partner received directly,
whatever the method*. Receipt `status` other than `Success` (or absent on legacy rows) never counts.

## 4. Verification evidence

Run `cd functions && npm test` (unit + HTTP + 34 emulator tests). Last result in this working tree:

| Suite | Result |
|---|---|
| `test/tariff.test.js` (confirmed fixtures, 35-cell matrix, schedule) | 13 / 13 |
| `test/advanceBooking.test.js`, `test/http.test.js` | 17 / 17 |
| `test/advanceBooking.e2e.test.js` (emulator, 15) + `test/integration.e2e.test.js` (emulator, 19) | 34 / 34 |
| admin `tsc` + `vite build` | pass |
| `user/web` `tsc`, `vitest` (9), `vite build` | pass |
| `user/app` jest (48) · `tsc` | 48 pass · only pre-existing `radius.full` errors |
| `driver` jest (44), `tsc`, `expo export --platform web` | pass |
| `vendor` jest (38), `tsc`, `expo export --platform web` | pass |
| Browser, customer web at 1280 and 390 px, against emulators | round-trip draft → server quote ₹8,190 → terms + “Submit booking request” |

Emulator tests run against the real security rules; test `R1` proves clients cannot write assignments, payouts,
fares, bids, wallets or contacts, and `P1` proves no raw customer number reaches a vendor or an early driver.

## 5. Integration matrix

Legend — **V** verified by the automated emulator suite (server + rules), **B** verified in a browser run,
**T** typecheck/build only (UI path not exercised), **N** not implemented, **P** policy-blocked (needs a business
decision), **X** needs an external service or a physical device.

### Customer (web + app)
| Action | Handler → server | Persisted | Status |
|---|---|---|---|
| Pick pickup/drop, date/time (required), trip type, return date | Plan step → `useServerQuotes` → `quoteBooking` | draft (tab) | B |
| See per-category fare, calendar days, unavailable reasons | `quoteBooking` (same engine as create) | — | V (server) · B (web) |
| Accept terms and submit request | `createBooking` | `bookings`, `booking_contacts`, `booking_secrets` | V · B |
| Past / missing / ambiguous pickup, no terms, no round-trip end | server validation | rejected | V |
| Several future bookings | no active-booking limit | — | V |
| Status wording (awaiting review … driver assigned) | `derivePhase`/`customerStatus` | — | unit (jest) · B |
| Cancel before trip | `cancelRide` (rules `customerUpdateOk`) | `bookings.status` | T |
| Notification → opens its booking | `NotificationsPage` uses `bookingId` | — | T |
| Receipt print | `printReceipt` | — | T |
| Native app screens (Book / Choose / Confirm / Active ride) | shared hook | — | T |

### Admin
| Action | Handler → server | Status |
|---|---|---|
| Approve / reject | `approveBooking`, `rejectBooking` | V |
| Publish (mode, escalation, cut-off) | `postBookingToMarketplace` | V |
| Assign vendor / owner driver / reassign / remove | `assignVendor`, `assignDriver` | V |
| Award / reject bid (vendor or owner-driver) | `awardMarketplaceBid`, `rejectMarketplaceBid` | V |
| Override fare, cancel, refund, record / void payment | `overrideBookingFare`, `cancelBooking`, `updateRefund`, `recordPayment`, `voidPayment` | V (payment) · T (others unchanged) |
| Mark pickup reached (audited exception) | `overrideReachedPickup` | T (UI) · server T |
| Partner payouts due: process / paid / failed / hold | `updateSettlement` | V · UI T |
| Tariff configuration; dispatch rules | `saveTariffConfig`; `settings/operations` | V (server) · UI T |
| Customer contact edit | `updateBookingContact` | server T · UI T |
| Booking list with contacts joined | `subscribeBookings` + `booking_contacts` | T |

### Vendor
| Action | Handler → server | Status |
|---|---|---|
| Accept current offer | `claimMarketplaceDuty` | V |
| Counter-bid / withdraw | `submitMarketplaceBid`, `withdrawMarketplaceBid` | V (server) · T |
| Dispatch driver + vehicle | `vendorAssignDriver` | V |
| Customer number | masked only; reveal refused | V |

### Driver (owner-driver / vendor employee)
| Action | Handler → server | Status |
|---|---|---|
| Accept duty / send bid | `claimMarketplaceDuty`, `submitMarketplaceBid` | V (server) · T |
| Employee: claim, bid, payout refused; wallet/earnings tabs hidden | server + navigator | V (server) · T |
| Reached (fresh, accurate, in radius) → OTP → Started → Ended with total km | `advanceTrip`, `verifyBoarding` | V |
| Call customer (T-8h reveal) | `getCustomerContact` | V (server) · T |
| Collection (cash / UPI to the partner) | `recordPayment` | V |
| Live selfie + front/rear/interior | `vehicleVerification` slots | server T · device X |

## 6. Decisions and external setup still open

**Business decisions (not coded as guesses):** D01/D02 rental distance and partner overtime; D03 partner floor
and round-trip SUV/Crysta partner reading; D04 tax rate/base/inclusions; D05 add-on units and partner share;
D06 missing state-entry rates and Crysta charges; D07 multi-city tariff; D08 fixed-route zones/cut-off;
D09 whether marketplace posts share the release delay; D10 cancellation windows and refunds; D11 top-rated
threshold, new-driver treatment and alert timings; D12 inactivity and emergency delegation; D13 suspension
convention; D14 under-₹300 wallet versus 4-hour payout (configurable, default pays on the same schedule);
D15 city boundaries and rounding.

**Not implemented in this pass:** inactivity warning / accident-hold lifecycle, admin-only single-trip temporary
driver identity, customer-approved category amendment with consent history, driver licence uniqueness registry
and membership transfer, action-level staff delegation with expiry (Executive vs unblock), public year-based
booking sequence (recommended, not confirmed), seasonal route-offer precedence, search-to-quote reporting,
fixed-route master matching, linked reversal for a deducted penalty. These have no half-built UI.

**External / device (could not be run here):** Razorpay live keys and webhook registration, SMS/WhatsApp/email
providers, FCM push on devices, Play Integrity, native camera capture, real OSRM/geocoder traffic from the
customer clients.

## 7. Run and configure

```
cd functions && npm install && npm test            # unit + HTTP + emulator suites (needs Java 17+, firebase-tools@13)
cd admin && npm run dev ; cd user/web && npm run dev
```
Emulator-only values live in `functions/.env.demo-nesam` (no real secrets). Server variables: `FIREBASE_SERVICE_ACCOUNT`
(non-Firebase hosts), `ROUTING_URL`, `CRON_SECRET`, `ALLOWED_ORIGINS`, `OTP_PEPPER`, `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `WHATSAPP_*`, SMS and SendGrid keys (see `functions/README.md`).
Client variables: `EXPO_PUBLIC_API_URL` (HTTP transport), `EXPO_PUBLIC_FIREBASE_*`, `VITE_*` equivalents,
`EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true` for local runs only.

**Deployment order:** functions → apps → `firestore.rules`/indexes (old partner builds write directly and would be
refused once the rules ship). Optional, never automatic, each with a dry run: `migrateBookingContacts`,
`backfillFulfilmentRoute`, `rebuildPartnerLedger`. Turn the confirmed tariff on from Admin → Pricing only after
reviewing the printed rate cards.
