# Service & Fare Settings wiring audit

Audit date: 2026-11-03. All rate mutations and bookings use Firebase emulators and the synthetic `demo-nesam` project. No production prices, customers, bookings or payouts are changed.

## Scope and evidence

The matrix covers Common, NESAM, People Taxi and One Way Car Rentals; One Way, Round Trip, Airport Taxi, Local Rental and Multicity; Sedan, SUV, Innova and Innova Crysta (80 combinations). Each applicable scalar price/policy is saved independently and repriced. Rental package cells cover 4/6/8/10/12 hours, including minimum-hour rejection.

The matrix uses the real authenticated save, quote, booking, approval, vendor assignment and driver dispatch callables. Customer/vendor/driver booking reads and private-price denials go through Firestore security rules. Customer quotes use `quoteBooking`; Multicity uses its dedicated enquiry/quote/conversion flow. Route responses are deterministic synthetic 80 km legs, not a live routing-provider accuracy check.

Machine-readable matrix results: `service-fare-wiring-results.json`. The controls suite additionally exercises availability, category restrictions, percentage adjustments, scheduled windows, limits, GST, fixed routes, shared city fares, rental packages, business contract matching, independent-driver assignment, approved extras, engine-switch preservation, version conflicts, access control and audit history.

## Intentionally different scopes

| Control | Actual scope |
|---|---|
| Base rates, bata, extra-km and extra-charge overrides | Brand → service → tariff class, with Common inheritance |
| GST | Brand → service → verified pickup state/default; all vehicle classes |
| Availability, cab restrictions, scheduled adjustments, limits | Brand → service → location/schedule; category restrictions/limits where configured |
| Vehicle category catalogue | Shared catalogue; not a separate catalogue for each location/brand |
| Shared Local Pickup & Drop | Master city → tariff class; shared across brands |
| Rental packages | Brand/service/class overrides over shared package definitions |
| Fixed route fare | Brand/Common → One Way → exact master route/category/direction/dates |
| Business contracts | Business account and contract route/service/category; not every retail booking |
| Location boundaries | Shared location-master context; not a new brand-specific price table |
| History and rule status | Audited server writes with version checks |

All three customer web apps call the shared server quote/booking services. Vendor and driver apps display recorded assignment/finalized payouts rather than recalculating prices from today's tariff. A vendor fleet driver's earnings are distinct from the vendor's entitlement; changing vendor payout must not invent a fleet employee salary.

New settings affect new quotes/bookings. Existing confirmed booking fares and agreed payouts remain locked to their snapshots. Marketplace bidding/manual agreements can intentionally replace the initial tariff offer.

## Defects corrected during this audit

1. Multicity quotes ignored scoped customer/partner extra charges and waiting policies. Ordinary and Multicity quotes now use a shared extra-charge resolver.
2. Multicity quotes did not enforce the Service Areas/category/percentage/limit rules exposed for that service. Every itinerary leg is checked; the winning pricing rule is applied once across the itinerary, not compounded at each stop. Limited availability survives conversion.
3. Multicity conversion failed internally for valid legacy category records containing `seatingCapacity` without `seats`. Both supported fields are handled; missing capacity gives an actionable refusal.
4. Calling the ordinary public quote endpoint with Multicity silently produced a One Way fare. It now directs the caller to the itinerary enquiry flow.
5. Trip-end partner billing rebuilt an adjusted payout from rate plus unchanged bata, losing part of the agreed percentage adjustment. It now retains the agreed base and adds only extra distance/calendar usage. A shorter tour does not reduce the agreed payout.

## Verification boundary

Backend emulator checks demonstrate authenticated pricing/booking/assignment and security-rule behavior with synthetic data. They do not demonstrate that every production screen was manually clicked or that production has deployed this source. Live authenticated browser/device rendering, deployed function versions, real routing-provider behavior and external payment/delivery providers remain separate verification steps. No claim of a bug-free production deployment is made.

Final execution counts are recorded after the audit suites finish.
