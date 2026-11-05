# Pricing wiring review — 29 October 2026

Scope: the ten cards under Service & Fare Settings → More settings. This is a source and automated logic review, not a signed-in browser acceptance test or production deployment.

| Card | Project connection | Verification / limitation |
| --- | --- | --- |
| Base rates | TariffConfigCard → saveTariffSection / saveTariffConfig → business_config/tariff_v2 → priceBooking | Backend version checks; tariff fixtures pass. Enabled tariff and vehicle class mapping determine use. |
| Pricing & Fare Management | FareRules → legacy rate-card records, TariffConfigCard and FareAdjustmentCard | Legacy records are reference data, not a second automatic pricing engine. Managed fixed fares now reject legacy edit/status/copy/delete; database rules also protect them. |
| Local fares | LocalFares → saveTariffSection → rentalPackages / localPickupDrop → priceBooking | Added tests for city minimum, GST, partner payout and rental minimum. City pickup/drop identity is required for local office fares. |
| Extra charges | VehicleCategories → category fare extras | Category extras are used by category pricing; confirmed tariff extra usage is separately configured in base rates. They do not universally override each other. |
| Fixed route fares | FixedRouteFares → saveFixedRouteFare → managed fare_rules → matchFixedRoute / quoteFixedRoute | Added route/date/category/direction, GST, peak exclusion and snapshot-version tests. Canonical location IDs required. |
| Business contracts | BusinessAccounts → business service callables → business account contracts | Previously added failure/busy handling for activation, credential creation and revocation. Full contract save/quote journey still requires integration testing. |
| Service boundaries | Locations → location master; configured tariff city zones are separate | Location records and tariff radius zones serve different purposes. No claim that every location record automatically becomes a geofence. |
| Fare limits | ServiceRule limit → saveServiceRule → assertWithinLimits | Customer and partner bounds tested. Partner limit cannot be evaluated where the legacy pricing snapshot has no fixed partner payout. |
| All rules & schedules | service_rules subscription → edit/status callables → evaluateRules | Added tests for enabled status, pickup time endpoints, location precedence, state codes and cab restrictions. |
| Tax settings | settings/tax_policy → invoice classification | Save access now matches database finance/system permissions. Tax classification policy is separate from the tariff GST rate. |

Validation: admin production build and backend TypeScript build passed; 47 Node tests passed across tariff, service rules, advance booking, partner operations and HTTP behavior. The HTTP test was corrected to reflect the existing public, rate-limited quote preview: missing quote input gives 400; invalid tokens still give 401.

Remaining verification: Firestore rules compilation, database transactions and signed-in UI save/reload journeys. Emulator execution was attempted but the installed Firebase CLI requires Java 21+, while the available runtime is Java 17. The offline compatible CLI was not cached. Nothing was deployed; backend/rules changes require deployment before they affect the live project.
