# Wiring fixes — 29 October 2026

This supersedes the corresponding open connections in the admin audit. Changes are local, with no production deployment, live message or real payment.

## Implemented

- **Business contract pricing:** the admin quote, coupon recalculation and final booking all carry the selected business account. A single active contract matching the exact pickup/drop place or city, service/trip type and category overrides public fixed routes and standard pricing. Inactive/malformed/duplicate contracts are not silently selected. Fixed and per-km customer/partner rates, GST mode and the contract's peak-adjustment choice are snapshotted. Per-km round trips include both legs; extra actual kilometres use the saved rates.
- **Business account enforcement:** inactive/on-hold accounts are refused by the server. Company-paid bookings include existing open reservations, completed/cancelled charges and business receipts when checking credit/prepaid funds. Updating the account reservation version in the booking transaction serializes competing bookings. Passenger-paid trips do not consume company credit.
- **Authoritative service restrictions:** configured service masters control online service/category eligibility in both customer quote and creation. Admin-selected services also validate trip type and allowed category. No master for a trip type preserves the previous supported-service behavior; arbitrary new trip types are not invented.
- **Booking settings:** saving the customer horizon/minimum notice updates `settings/operations` atomically with office config; the settings screen reads back the authoritative values. The office retains its existing longer booking horizon. The Cash switch is checked on new customer/admin bookings; a retry of an already-created customer booking remains idempotent.
- **Delivery preferences:** explicit SMS/email/WhatsApp off switches block the relevant server provider sends; Push off records a skipped delivery before contacting devices. Missing legacy preferences preserve existing delivery behavior. Provider credentials are still required when enabled. Firebase Authentication's own sign-in OTP is separate. MSG91 now accepts the documented `SMS_MSG91_TEMPLATE_ID` environment variable and the legacy alias.
- **Public reviews and catalog:** following the user's approval of the recommended business setup, server-written `public_content` contains only approved public fields. Published reviews expose first name, stars, review text and official response; Active service/location/package records expose public descriptions and customer starting prices. Raw contact fields, internal moderation notes, corporate rates and partner payouts are excluded. Inactive/hidden/deleted records are retracted. Anonymous clients can read this projection and cannot write it; raw reviews remain protected.
- **Website consumers:** NESAM, People Taxi and One Way Car Rentals now reuse the same public reviews/catalog sections. Supported online services link to the booking flow; custom services and packages use an honest enquiry action. Starting prices are labelled as starting prices, not a completed checkout quote.
- **Hosting parity:** Firebase source-write triggers refresh public content; scheduled reconciliation backfills existing masters and covers HTTP-only hosting. Generic HTTP review/master updates request an immediate refresh. Unchanged projections are not rewritten. Public sync requires the corresponding staff permission.
- **Unsupported controls:** legacy percentage cancellation controls and unused general/tax display preferences are read-only. Current customer cancellation/tax behavior remains authoritative; changing a saved reference field cannot pretend to change those policies. Unconnected external B2B API credential creation is disabled rather than issuing unusable new secrets.

## Verification

The new regression tests exercise actual callable handlers and rules in `demo-nesam`, including:

1. A contract quote replacing the standard fare, one winner from concurrent bookings competing for one credit allowance, and rejection of an on-hold account.
2. Duplicate contract rejection, exact zone matching, prepaid/credit arithmetic and immutable per-km final billing.
3. Anonymous access to the approved projection, denial of raw review access, exclusion of private fields, and withdrawal after hide/delete.
4. Provider off switches returning a real non-delivery result without contacting providers, and enforcement of the Cash preference.
5. Online service/category restrictions in the real customer quote path.
6. The admin settings form service saving booking limits into the actual server-consumed document, with invalid values rejected.

Completed verification: **68/68 integration tests** and **59/59 backend unit/transport/pricing tests** passed. The admin and all three customer websites built successfully; the shared customer app passed type checking. New tests are included in `functions`' normal emulator command.

Logs: `output/wiring-fixes-final-e2e.log`, `output/wiring-fixes-functions-checks.log`, `output/wiring-fixes-admin-checks.log`, `output/wiring-fixes-user-web-checks.log`, `output/wiring-fixes-people_taxi-checks.log`, and `output/wiring-fixes-one_way_car_rentals-checks.log`.

Final privacy hardening also removes unrelated signed-in customers' raw Published-review access and limits raw service/location/package masters to active admin accounts. Review owners retain their own record access; public visitors use the projection. The focused rerun passed **12/12 tests** with these final rules, including real admin collection access and the new wiring scenarios (`output/wiring-fixes-privacy-e2e.log`). `git diff --check` passed.

## Explicit remaining boundaries

- Deploy the functions, public-content rules, and rebuilt frontend before these changes affect a live site. A full browser click pass was not completed: the computer-use tool stopped when it could not identify the Windows browser URL. No alternate browser-control route was used to bypass that restriction.
- Live SMS/WhatsApp/email/payment/push require the actual service configuration and device/provider acceptance tests. The integration tests do not certify provider delivery.
- An external corporate booking API, hosted endpoint/consumer onboarding, provider accounts, native embedded Maps credentials, automated review publication and an end-to-end package checkout are separate product integrations. They have not been fabricated. The UI keeps unsupported actions disabled or explicitly routes to enquiry/manual approval.
- Public display shares one component across all three customer websites, with the same server-owned projection and booking eligibility. A native app package-checkout screen was not invented.
- Contract zones use exact canonical names/cities. Ambiguous duplicate contracts are refused; a partial free-text address never guesses a cheaper business fare.

The earlier source audit is historical evidence; its previously open business pricing, credit, delivery preference and NESAM public-content connections are now implemented as described above.
