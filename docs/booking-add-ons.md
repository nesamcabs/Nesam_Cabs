# Carrier and pet booking charges

The review page on NESAM Cabs, PeopleTaxi, One Way Car Rentals, and the customer app offers roof carrier and pet travel selections. The admin booking flow offers the same choices. The booking server prices the selections; clients never submit charge amounts.

## Admin management

- Fleet → Vehicle Categories → Specs: edit the roof carrier price for each category. Pet travel pricing is not edited here.
- Pricing → Brand & service fares → Common pet travel charge: one shared pet price for all brands, services and vehicle categories. Duplicate carrier price inputs have been removed from the vehicle registration form and service-fare workspace.
- Prices are in INR per trip. Zero means no extra charge. No pet price is invented for existing categories.
- The booking's GST setting determines whether the entered price includes GST or has GST added. These are customer charges; existing partner payout/reimbursement policies continue to apply.
- Category carrier edits and common pet-price edits affect new quotes across all three brands. Confirmed bookings retain the selected amounts in their pricing snapshot.

## Billing and partner panels

Selections appear as included line items on the fare breakdown and admin invoice. Final-distance billing retains their quoted amounts. Post-trip extra-usage approval does not charge the customer twice for a prepaid carrier; the configured partner reimbursement is preserved.

Published marketplace duties expose carrier/pet requirements to vendor and driver panels. Assigned duties retain the included charge lines.

## Activation

The backend changes must be deployed before selected add-ons can be booked against the hosted booking service. Roll out these Firebase functions together:

`quoteBooking`, `createBooking`, `createAdminBooking`, `advanceTrip`, `reviewExtraUsage`, `postBookingToMarketplace`, `saveTariffSection`, `saveTariffConfig`.

Local Vite websites currently proxy the hosted functions, so refreshing localhost alone cannot activate new server-side billing. The review pages refuse an add-on booking when an older backend returns a quote without its selected fees. Rebuild/release the web panels and native apps through their normal release process. No production prices or bookings were changed by the tests.

## Validation

- TypeScript checks across the three customer sites and customer/admin/vendor/driver panels and apps.
- Fare, GST-inclusive/exclusive, immutable pricing, final-distance billing, duplicate carrier billing, and invoice tests.
- Five emulator integration tests create bookings for all three brands and admin, and confirm later rate edits leave existing bookings unchanged.
- Customer draft persistence and quote identity tests ensure changing either selection invalidates the previous quote.

## Deployment record

On 7 November 2026, after user approval, the six initial booking/billing functions were deployed successfully to `nesamtoursandtravels-202f5` in `us-central1`. Read-only live quote checks passed for six categories on each of the three brands, including fee line items and total reconciliation. No live bookings were created and no live category prices were changed.

The subsequent common-pet-price correction deployed `quoteBooking`, `createBooking`, `createAdminBooking`, `saveTariffSection`, and `saveTariffConfig`. Live checks confirmed all eighteen quoted brand/category combinations use the same common pet travel rate. Legacy category-specific pet prices are ignored for new quotes; existing booking snapshots remain intact. The shared pet price is left at its saved common value (or zero if none has been saved), for the admin to configure.

Firebase reported a non-blocking error cleaning up build images after the successful deployment. No existing registry images were manually deleted. Production web hosting and native app releases were not included in this functions-only deployment; localhost uses the updated backend with the current local UI code.
