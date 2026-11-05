# Local Taxi module

On-demand city rides inside admin-drawn service zones. Built on the existing stack (Firebase: Firestore, Cloud Functions,
security rules; React admin, People Taxi site, driver web app). It does not replace outstation, airport, rental or Multicity.

## What exists

| Who | What works |
|---|---|
| Customer (People Taxi) | `Local Taxi` tab → `/local-taxi`: pick pickup/drop (search, current location, map pin), live service-area check, fare per vehicle type with breakdown and a locked-fare countdown, pay by cash (if the zone allows) or online (only if the payment keys exist), book, then `/local-taxi/ride/:id`: live status, driver, ride code, driver position, cancel (fee shown first), receipt, online payment, rating. |
| Driver (driver web) | `Local Taxi` item: go online (needs enabled zone + fresh GPS inside the zone), one offer at a time with a countdown, accept/decline, on the way, arrived, ride code, start, complete, collect cash, give the ride back, rider no-show. |
| Admin | `Operations → Local Taxi`: zone map editor (draw, undo, overlap view, draft/active/off), vehicle types and dispatch settings per zone, versioned fares with a simulator, driver eligibility (zones + vehicle types), live rides (manual assign, cancel with reason, timeline), change history for zones and fares. |

## Zones and the boundary

- A zone is a GeoJSON Polygon/MultiPolygon stored in `lt_zones/{id}.boundaryJson` (a JSON string, because Firestore rejects nested arrays). Every boundary change bumps `boundaryVersion` and keeps the old one in `lt_zones/{id}/versions/{n}`.
- **Boundary policy:** a point exactly on an edge or vertex is **inside**. The edge of a hole belongs to the zone. Zones may not touch or overlap (no priority rule), self-crossing outlines, unclosed rings, points outside India and zones wider than ~200 km are rejected.
- **Pickup and drop must both be inside the same active zone.** The server re-checks this when quoting and again when booking. The road route may leave the polygon; that is allowed and does not change the fare. (Strict route containment is **not** implemented; it would need a separate policy and route geometry checks.)
- A zone stays **draft** until it has a boundary and at least one vehicle type with an active fare. **No Erode boundary is shipped**: no verified polygon was available, so none was invented. Create the zone "Erode", draw the verified boundary, add a fare, activate.
- Switching a zone off or redrawing it never affects rides already booked: each ride stores the zone id, boundary version, policy version and dispatch settings it was booked with, and dispatch uses that boundary version.

## Fares (all money in integer paise)

Order of calculation (also documented at the top of `functions/src/localTaxi/fare.ts`):

```
distanceFare   = round( max(0, distanceMeters - includedMeters) × perKm / 1000 )
billableSecs   = max(0, rideSeconds - waitingSeconds)          // waiting is never billed twice
timeFare       = round( billableSecs × perMinute / 60 )
meteredFare    = max(minimumFare, base + distanceFare + timeFare)
nightSurcharge = round( meteredFare × night% )                  // by ride START time in the zone's time zone; windows may cross midnight
adjustedFare   = (meteredFare + nightSurcharge) × surge         // surge only inside its dates; never above its limit
waitingCharge  = round( max(0, waiting - freeWaiting) × waitingPerMinute / 60 )
taxableBase    = adjustedFare + pickupCharge + waitingCharge    // the platform fee is not taxed
tax            = round( taxableBase × tax% )                    // 0 unless enabled
total          = rounding( taxableBase + platformFee + tax )
commission     = round( taxableBase × commission% )             // taken from the driver's share, never added to the customer's fare
```

- Night and surge touch only the metered fare. Surge must have an end date. Tax is off until enabled.
- Quotes use the routing provider's road distance and duration (Google Routes if `GOOGLE_MAPS_SERVER_API_KEY` is set, else OSRM). Every quote is stored with an expiry and bound to the customer.
- The final fare is computed on the server at completion from server-recorded times (arrival, boarding, completion) and the server-tracked GPS distance, never from a total sent by a client. Tracked distance below 90 % of the quote falls back to the quote; above the configured cap (default 150 %) it is capped. The cap is shown to the customer before booking.
- Fare versions: `draft → active (or scheduled) → retired`; exactly one active version per zone + vehicle type (guarded by `lt_fare_heads`). A new version applies to new quotes only; a ride keeps the full fare configuration it was booked with. `ltActivateFare` records who and when; every save is in `audit_logs`.
- Development sample fares are flagged `sample: true`, labelled in the admin and to riders, and **cannot be activated in production** unless `LT_ALLOW_SAMPLE_FARES=true`.

## Ride lifecycle

`requested → searching → assigned → driver_arriving → driver_arrived → in_progress → completed`, plus `cancelled`, `expired`, `no_driver_available`. The transition table and who may make each change is `functions/src/localTaxi/states.ts`; every function calls it. A driver who gives a ride back sends it to `searching` again (max 4 times). The ride code is 4 digits, single use, 5 wrong tries lock it for 10 minutes, and the driver can never read it.

Dispatch: nearest eligible driver first, one offer at a time with an expiry, radius widening in steps, then `no_driver_available` after the search timeout. A driver is eligible only if approved, enabled for the zone + vehicle type, online, available, not on a ride, and has a fresh location **inside the boundary**. Acceptance is a transaction that re-reads the ride, the offer and the driver, so two drivers (or a driver and a staff assignment) can never both win. The search is advanced by the customer's status poll, the driver's response and a one-minute scheduled sweep (`ltDispatchSweep`).

## Payments

Payment status is separate from ride status. Cash: the driver confirms the exact amount; a settlement record notes the commission due. Online: `ltCreatePaymentOrder` (amount read from the ride, one open order per ride) → Razorpay checkout → `ltVerifyPayment` (signature + provider fetch + exact amount) or the signed webhook (same handler in `payments.ts`, idempotent on the provider payment id). Online is offered only when the payment keys are configured. A failed payment is recorded and the ride stays payable. Because nothing is charged before the ride, there is no prepayment to refund on cancellation; a cancellation fee is collected like any other due amount.

## Files

- Backend: `functions/src/localTaxi/{geo,fare,states,model,adminFns,rideFns,driverFns,dispatch,payFns,sweep}.ts`; registered in `functions/src/index.ts` and `registry.ts` (`ltCheckServiceability` is public); webhook branch in `functions/src/payments.ts`.
- Rules: `firestore.rules` (section "Local Taxi"; clients can read what they own and never write); indexes in `firestore.indexes.json`.
- Admin: `admin/src/pages/LocalTaxi.tsx`, `admin/src/services/localTaxiService.ts`, nav entry `local-taxi` (permission `pricing`).
- Customer: `people_taxi/src/pages/localTaxi/*`, `styles/localtaxi.css`, routes in `App.tsx`, entry from the `Local Taxi` tab in `BookingForm.tsx`.
- Driver: `driver/web/src/screens/LocalTaxiScreen.tsx`, `styles/localTaxi.css`, nav item in `components/nx/Shell.tsx`.
- Tests: `functions/test/localTaxi.test.js` (25 unit tests: geometry, fare engine, state machine) and `functions/test/localTaxi.e2e.test.js` (15 emulator tests).

## Collections

`lt_zones` (+`versions`), `lt_fares`, `lt_fare_heads`, `lt_quotes`, `lt_rides` (+`events`), `lt_ride_secrets`, `lt_ride_live`, `lt_ride_tracking`, `lt_driver_state`, `lt_offers`, `lt_payments`, `lt_payment_orders`, `lt_settlements`, `lt_customer_state`. All are new; nothing existing is migrated. **Rollback:** remove the `lt*` exports from `index.ts`/`registry.ts`, deploy functions, and the new collections become inert (delete them only if you want the data gone); the rules and indexes additions are harmless to leave.

## Deploy and configure

1. `firebase deploy --only firestore:rules,firestore:indexes` (new composite indexes take a few minutes to build; Local Taxi dispatch needs the `lt_driver_state` index).
2. `firebase deploy --only functions` (adds 21 callables and the `ltDispatchSweep` schedule).
3. Deploy the admin, People Taxi and driver web apps.
4. Environment: `GOOGLE_MAPS_SERVER_API_KEY` (optional; OSRM fallback), `ROUTING_URL`, and the existing Razorpay secrets `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` for online payment. For emulator or staging tests only: `LT_ALLOW_SAMPLE_FARES=true`.
5. In Admin → Local Taxi: create zone → draw the verified boundary → enable vehicle types → save a fare (version) → make it live → activate the zone → enable drivers (zones + vehicle types).

## Setting up Erode from the current fare settings

Admin → Local Taxi has helpers so the zone and fares start from what you already run:

- **Quick start (Service zones tab, shown while there are no zones):** creates the `erode` zone as a **draft** with the outline from OpenStreetMap, and one **draft** fare per active vehicle type copied from the saved **Local Pickup & Drop** fare for Erode (Pricing → Local fares). It stops with a clear message if Erode has no saved Local fare. Nothing goes live: you then press **Make live** on each fare and **Activate** on the zone.
- **Load outline from OpenStreetMap (zone editor):** fills the map with the smallest matching OpenStreetMap area. For "Erode" OpenStreetMap only has the district (about 103 × 120 km) and the taluk (about 23 × 18 km), not the city limits; the taluk is used and the admin is warned it is bigger than a city. It is community data, not a survey record: trim it to the city limits, or draw your own, before activating.
- **Current fare settings panel (Fares tab):** shows the saved Local Pickup & Drop fare for the chosen city and vehicle class, a side-by-side table (2 to 15 km) of what the current tariff charges versus the Local Taxi numbers in the form, and **Use as starting point**.
- **How a Local fare maps:** base fare = minimum km × customer rate, included distance = minimum km, per extra km = customer rate, minimum fare = base fare, waiting per minute = waiting per hour ÷ 60, free waiting = the tariff's free waiting minutes, platform commission = (customer rate − partner rate) ÷ customer rate. Per-minute time charge, night, surge, tax and the cancellation fee are **not** in the current tariff, so they start off (cancellation fee starts at the development default of ₹30 after 2 min): choose them deliberately. Current fares are before GST; Local Taxi tax is off until enabled.

## Not production-ready until

- A verified Erode boundary is drawn and approved (none is shipped).
- Approved business fares are entered (the development sample must not be used) and the tax/GST treatment is confirmed with your accountant (tax is off by default).
- Payment keys are configured and one real online payment and webhook are tested (the payment flow is covered by code review and shared Razorpay code; there is no automated test of the Razorpay callbacks for Local Taxi yet).
- Drivers are enabled per zone and vehicle type and the driver web app is tried on real phones with GPS (the heartbeat runs only while the app is open; there is no background tracking and the native driver app was not changed).
- Add rate limits for quote and booking calls if you expose the functions beyond the signed-in apps (the HTTP API already rate-limits per user; the direct callables do not).
- Rider-facing live map shows the driver as a dot; there is no turn-by-turn route line.
