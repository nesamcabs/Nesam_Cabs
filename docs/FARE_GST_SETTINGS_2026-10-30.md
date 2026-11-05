# Fare GST settings — 30 October 2026

Service & Fare Settings now has a visible **GST calculation** shortcut. In Rates & extra charges, its GST editor follows the selected brand and service, across vehicle categories. It supports included/excluded fares, configurable total GST percentage including zero, supplier registration state, service classification, approval reference and change reason.

Policies are stored in `business_config/tariff_v2.fareGst`. Resolution order: brand pickup-state override, brand default, Common pickup-state override, Common default. Removing an override restores inheritance. Existing calculations remain when no applicable policy is saved. Saves use the existing pricing/Settings permission checks, tariff-version conflict checks and audited transaction.

GST components use supplier registration state and place of supply: CGST + SGST, CGST + UTGST for applicable Union Territories, or IGST. Passenger transport uses registered recipient state or verified boarding state. Domestic vehicle rental uses recipient state/address on record, otherwise supplier state. Rates and classification are administrator-configured; this does not determine eligibility for input tax credits, reverse charge or cess.

## Connections and boundaries

- Shared server pricing is consumed by customer quotes, customer booking creation and admin booking creation/preview. Snapshot tax survives trip completion and office fare overrides.
- Included fares retain their original amounts in a customer-only snapshot for final kilometre billing, so tax is extracted once rather than compounding per-unit rounding. Partner payouts are not converted.
- Fixed routes and business contracts retain their explicit included/excluded choice. Approved waiting/hill/carrier charges retain their separate tax treatment and use the booking's saved rate.
- Invoice issuance, print and GST reports support all four components. Supplier registration mismatches and conflicting booked/invoice tax jurisdictions require review. A pending place of supply needs verification before invoice issuance.
- **User selected master-location verification only.** No external geocoder was added. A master location must match pickup coordinates; state can be inherited from its parents. Unverified map pins cannot use pickup-state overrides and need booking-desk assistance. Defaults can calculate an aggregate GST quote while the jurisdiction split remains pending.
- Cities/areas inherit their verified state. Multicity remains manual enquiry/quotation.

## Validation

Admin and backend TypeScript compilation checked with `tsc --noEmit`. No automated tests, browser interaction, booking writes, production configuration changes or deployment performed.

Tax references consulted: [CBIC sectoral GST FAQs](https://cbic-gst.gov.in/hindi/sectoral-faq.html), [IGST Act, intra-State services](https://taxinformation.cbic.gov.in/content-page/explore-act/1000616/1000001).
