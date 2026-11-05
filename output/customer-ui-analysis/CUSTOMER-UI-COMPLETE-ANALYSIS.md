# NESAM Customer reference — complete source analysis

Analyzed: 21 October 2026. Scope: the attached `Nesam_Customer_App_Outstation_UX.html`. This is an analysis deliverable, not an implementation or deployment.

## 1. Evidence and limits

- Original: `C:/Users/User/AppData/Local/Packages/5319275A.WhatsAppDesktop_cv1g1gvanyjgm/LocalState/sessions/D7D63B2FDAD1E6D555CC68856B66F53BB992169A/transfers/2026-43/Nesam_Customer_App_Outstation_UX.html`.
- Size: 13,587,100 bytes; 2,710 physical lines.
- SHA256: `a02a7e8cf297e49727e20923114b4d030ae51fb2b6f38aa5fea3c40cea3f9b1a`.
- Two top-level stylesheets; 1,713 parsed CSS rules, including 645 inside at-rule conditions. A third `<style>` string belongs to the downloadable sample receipt, not the main page.
- 187 named function declarations and 64 subsequent assignments of functions. The final behavior depends on the override chain, not the first occurrence of a function.
- 167 button-factory call sites, additional directly generated controls, and 16 event-listener registrations. These counts are source occurrences, not counts of distinct visible buttons.
- Main JavaScript parses without syntax diagnostics using the repository's TypeScript parser. Both top-level stylesheets parse using PostCSS.
- Embedded images were decoded, dimension-checked and inspected in a contact sheet. This is **not** a screenshot of the rendered interface.
- No browser execution, screenshots of screens, device/emulator checks, live backend calls, payment, SMS or production booking was performed. Source findings below must not be represented as successful end-to-end tests.
- Application code under `user/` was not changed. Outputs are confined to this analysis directory.

Supporting evidence: `reference-numbered.txt`, `LINE-COVERAGE.md`, `FUNCTION-INDEX.md`, `CONTROLS.md`, `CSS-INDEX.md`, `inventory.json`, `structure.json`, `css-inventory.json`, `asset-metadata.json`, `ASSET-CONTACT-SHEET.jpg`. The line ledger indexes every physical line; it is a navigation aid, not proof that every runtime state was exercised. Embedded binary strings are replaced by hashes in the readable source, with decoded files retained separately.

## 2. What this file actually is

A self-contained, responsive customer booking **prototype** built with plain HTML, CSS, SVG and JavaScript. It is neither a React application nor a React Native implementation. It contains a substantial local booking simulator and a corporate homepage around it.

The main root is `#nesam-customer-app`. Rendering replaces its contents from a page variable and modal state. The source has no Firebase client, server fetch, payment SDK or real geocoding integration. Telephone, WhatsApp, email and directions links can open external applications; that does not make the booking simulator connected to those services.

State is kept in localStorage under `nesam-customer-app-v2`. A sample signed-in customer and booking are seeded. Returning users may see a different state because stored version-2 data is restored. Login/logout switches between local account snapshots, not authenticated server accounts. Reset restores a seeded sample booking.

## 3. Final visual system

| Element | Final source intent |
|---|---|
| Main typography | Inter; `Noto Sans Tamil` and system fallback for Tamil |
| Header wordmark | Manrope/Inter; custom embedded brand face in the footer |
| Some section headings | Embedded `Nesam UI`, then Manrope/Inter |
| Brand color | Primarily `#c62828`; restrained red active underlines and links |
| Text/background | Dark slate text, muted blue-gray supporting copy, white surfaces, pale borders |
| Buttons | Solid red primary, white bordered secondary, plain text links; later rules use 7px corners |
| Fields | Later rules use approximately 6px corners; visible labels and inline errors |
| Icons | Inline SVG drawing dictionary plus custom service pictograms; no external icon font required |
| Imagery | White vehicle photos and red landmark illustrations on pale backgrounds |
| Footer | Dark navy `#19212c`, contact information, service/help/company links |

**Poppins is not the final font in this reference.** If Poppins remains a separate product requirement, applying it would be a deliberate visual change from this file. Tamil font embedding also needs consideration: the reference names a Tamil fallback but does not embed a dedicated Tamil font payload.

Do not port the first CSS blocks alone. They include older green/red themes, a 460px shell, different card styles and superseded navigation. The later corporate and responsive rules determine the intended final appearance.

## 4. Responsive behavior

| Width | Intended adaptation |
|---|---|
| Below 360px | Smaller gutters, wordmark, labels, route cards and app-store labels |
| Phone to 599px | Full-width app shell; header and bottom navigation; independently scrolling content; stacked booking inputs; horizontally scrolling route cards |
| 600–999px | Wider gutters and fields; more route cards visible; adapted benefits/footer grids |
| 700px and above | Earlier rules add result/review/account/booking desktop arrangements; later rules retain a mobile-style home/header through 999px |
| 1000px and above | Desktop header, hero copy and booking form side by side; text service selector; desktop footer; three-column popular routes |
| 1000–1150px | Compact header spacing and smaller hero adjustments |
| 1440px and above | Earlier large-screen hero adjustments remain subject to later selector specificity |

Important details:

- At up to 999px the shell uses `100dvh`, hides outer overflow, and scrolls `.nc-main`.
- Desktop main content is intentionally centered with a maximum width of approximately **1216px**, including padding. Wide-screen side space is therefore part of the reference, not automatically a bug.
- Desktop results include category filters, sorting and a selection summary. Account sections can use a sidebar; review and booking details reorganize into columns.
- A 700px rule set overlaps the later 999px mobile overrides. Test 699/700/701 and 999/1000/1001 explicitly; reading only one breakpoint gives an incomplete specification.
- Mobile navigation accounts for the bottom safe-area inset. Keyboard, notches, Android back behavior and native safe areas still require actual platform testing.
- Reduced-motion rules suppress confirmation animations. They do not by themselves prove accessibility compliance.

## 5. Home page, top to bottom

1. NESAM emblem and wordmark; notification badge and support actions.
2. Desktop navigation includes booking/account controls and an app-download popover.
3. Desktop hero: “Your next journey, made simple”, descriptive copy, clear-fare/support points and vehicle artwork. Mobile prioritizes a centered service title and booking form.
4. Service selection. Final mobile navigation order: **Airport → Multicity → Outstation → Local Rental → Account**. Outstation contains **One Way / Round Trip** tabs and remembers the last selected one.
5. Booking form with route, schedule and service-specific fields.
6. Popular journeys from Chennai: **Trichy, Madurai, Thanjavur, Puducherry, Coimbatore, Rameswaram**. Desktop initially hides items after the third until “View all routes”; mobile uses a horizontal card rail.
7. “The NESAM Way”: clear fares, doorstep pickup, trip support.
8. Customer reviews. The publication array is empty; the active state asks for feedback and says reviews will appear once published. It does not publish fabricated ratings or customers.
9. Five FAQ accordions covering fare inclusions, extras, payment choices, assignment timing and cancellation/refunds.
10. App availability section: Google Play and App Store say **Coming soon**. These are not working download links.
11. Company footer with office address, phone, two emails, directions, service shortcuts, booking/help links and company/policy views.

The earlier recent-search shortcut implementation still records up to two distinct routes, but the final `routeShortcuts` override renders the permanent popular-route collection. Do not describe the final homepage as a recent-search list.

## 6. Services and booking form

| Service | Fields / behavior |
|---|---|
| One Way | Pickup, drop, swap, pickup date/time |
| Round Trip | Same plus return date/time strictly after pickup |
| Airport | To-airport/from-airport direction, appropriate pickup/drop, airport suggestions, optional flight number |
| Multicity | Pickup, final drop, 1–4 intermediate stops, add/remove/move-up controls |
| Local Rental | Rental city, pickup within that city, standard/extended package; package hours/km vary by selected category |

Changing service retains per-service draft values during the session. Changing route/schedule clears the quote and acceptance state. Selecting a saved address can add its landmark to pickup instructions.

The location picker offers saved addresses, recent selections (up to six), sample places, search filtering and a “current location” preview. **Current location resolves to a fixture; it does not request GPS.** Airports and rental pickups are filtered for their respective constraints.

Dates/times use IST. The custom time picker uses 12-hour selection, AM/PM and quarter-hour minutes. It validates again when confirmed so a time that became past while open is rejected.

Validation covers missing/invalid dates, past pickup, unsupported locations, same-city outstation routes, wrong airport selection, rental-city mismatch, adjacent duplicate multicity cities, missing intermediate stops, invalid return ordering, contact numbers and terms acceptance. Invalid fields receive ARIA descriptions and focus/scroll targeting.

## 7. Search and vehicle choice

Search shows a roughly 650ms fixture loading state, then results, unavailability, or a connection/retry state. A serial counter prevents stale search completion after navigating away. Offline behavior can be triggered by `navigator.onLine` or the lab.

Six category records exist: Sedan, two SUV records, two Innova records and Crysta. Cards contain model description, photo, selected indicator, passenger/bag/AC badges, included km/hours, total fare, extra-km rate and “View fare”.

Later code removes the `6+1` / `7+1` suffix from visible category names, so distinguish records by model and capacity rather than assuming the original labels remain. `suv7` has **six passenger seats** and a “7 seats including driver” capacity note. Treat this as a data mapping issue when connecting actual categories.

Desktop tools: All/Sedan/SUV/Innova filters and recommended/ascending-price/descending-price sort. Crysta is grouped with Innova. A selection can remain selected even when its card is filtered out; review that interaction during browser QA.

Fare details expose cab charge, bata, service fee, tax summary, included distance/time, extra rates and exclusions. Vehicle images represent categories; the actual assigned model may vary.

## 8. Demo pricing — not approved production pricing

Source: `quote` at lines 1612–1619 and category fixtures at 1568–1575.

- One-way uses a 130km minimum, category one-way rate and driver bata.
- Round trip doubles route distance and applies category minimum-km/day; days are calculated by elapsed 24-hour periods, rounded up.
- Multicity sums the fixture distances of each leg.
- Rental uses category package hours, km and fare. The extended package doubles hours/km with a 1.7 fare multiplier.
- Airport pricing uses a fixture minimum/formula and category multiplier.
- Cab plus bata disclose inclusive 5% GST; the demo adds a ₹100 service fee and ₹18 service tax. Extra distance/time receives 5% tax in the sample closure.
- Toll, parking and state tax are described as separately settled against receipts.
- Missing city-pair fixture distances reject the quote; there is no routing provider.

These are the prototype's assumptions. No tax, rate or cancellation policy has been approved by this analysis. Retain the real server's authoritative quote and approved fare configuration during any UI port.

## 9. Review, login, payment and confirmation

Review includes route/schedule/category/total, booking contact, booking for someone else, alternate passenger mobile and WhatsApp, optional WhatsApp sharing, 300-character pickup instructions, payment choice and policy acceptance.

Payment choices in the final reference are **pay later / 25% advance / full payment**. The older 20% helper is superseded by the later `paymentAmount` declaration. Do not accidentally implement 20% by copying its first occurrence.

Guest users can browse and search. Confirmation opens name/mobile login. Demo OTP is **246810**, expires in five minutes, allows five checks and has a 30-second resend guard. No SMS is sent. Verification restores a local account and returns to review; it does not silently submit the booking.

Confirmation creates a local confirmed booking before optional payment checkout. Failed/pending payment or closing checkout does not erase it. The later handlers route these cases to payment, and the saved booking can be reopened.

Checkout has explicit **simulate success / pending / failed** buttons. A pending payment prevents another payment. Payments are withheld during an ongoing trip until the final bill is prepared. Completed paid trips expose a downloadable **sample HTML receipt**, not a PDF or tax invoice.

The confirmation page is a ticket with booking ID, route/stops, dates, time, category and passenger capacity. A fresh booking can trigger a short animation and synthesized two-note chime once. Sound has on/off and preview controls; reduced motion, page visibility and browser audio restrictions are considered. This still needs browser/device testing.

## 10. Booking lifecycle and trip details

Final customer timeline has exactly five milestones:

**Booking Confirmed → Driver Assigned → Driver Arrived → Trip Started → Trip Completed.**

Older `onway` records remain internally supported but display as Driver Assigned; the final UI does not add a separate “Driver on the way” milestone. The old six-step implementation is superseded at lines 2678–2703.

My Bookings tabs: Upcoming, Ongoing, Completed, Cancelled. Details include itinerary, passenger, notes, flight/return details where relevant, fare/payment history, driver contact/share, change request, cancellation/help and rating after completion.

Driver details appear immediately when the sample driver is assigned. Until then the UI gives a pickup-minus-one-hour target; at that threshold a local urgent office alert is recorded. This is a local clock-driven preview, not a real scheduler or notification delivery.

Boarding OTP is separate from login OTP. It is visible after driver arrival; after trip start the UI says it was verified. Demo controls can advance the lifecycle without real driver verification.

Completion calculates extra km and rental extra hours, produces the final payable amount and enables the receipt after full settlement. The ordinary booking view currently omits the progress panel for completed/cancelled trips even though the five-step function contains a completed milestone. Preserve or intentionally resolve that inconsistency during implementation review.

## 11. Final cancellation, refunds and previous dues

The active rules are the later overrides at lines 2159–2223:

- Self-service cancellation is available **strictly more than 60 minutes before pickup**, only for active pre-trip bookings with no pending payment/request. Exactly at the cutoff, the customer must call the office.
- The customer selects a reason, accepts the displayed charge/refund and confirms. Details are optional. This final direct-cancel flow cancels immediately; it supersedes the earlier always-office-approved request screen.
- ₹300 arrival charge requires a driver, arrived state, correct pickup and office-verified arrival. Early arrival requires the customer's request.
- ₹500 no-show requires verified arrival and a full grace period after pickup/arrival: 30 minutes ordinarily, 60 for airport service.
- Charges are capped at the sample booked fare. Paid advance covers the charge first; the remainder is a refund. Refund state tracks initiated/completed/processed/remaining amounts.
- A confirmed, office-verified unpaid cancellation charge blocks a subsequent booking confirmation and opens a Previous Trip Balance screen.
- Charges under review do not block the next booking. Office-waived charges become zero. Cash paid to a driver is recognized only after an office confirmation in the simulator.
- Company inability to supply a cab produces no cancellation charge and a full refund of recorded payments.
- Office/driver update and settlement records are only local preview records.

These rules need real server equivalents and product approval before becoming production behavior. A UI-only task cannot safely implement them by trusting localStorage.

## 12. Account, support and company views

- Account overview links to bookings, payments/refunds, profile, saved addresses, help, notifications and settings/about.
- Profile supports name/email, read-only sign-in mobile, WhatsApp-same toggle and a separate WhatsApp number.
- Mobile change has a separate demo OTP challenge, resend/attempt/expiry guards and sample-account collision protection.
- Saved addresses support add/edit/delete/use-as-pickup, label/address/landmark and supported-city validation.
- Notifications show unread badges, open linked bookings and allow marking all read.
- Support can preserve the previous page/modal, open a call/WhatsApp link, or show a help-request form with locally recorded tickets.
- Settings include English/Tamil, confirmation sound and accessible prototype lab entry.
- About, cancellation/refunds, terms and privacy open readable views without intentionally discarding the current booking draft.
- Footer directions use a Google Maps search URL. Reviews and store links accurately retain unavailable/empty states.

Contact details in this reference: **90250 99990**, `Info@nesamcabs.com`, `support@nesamcabs.com`, 77/B Goundar Street, Koduvilarpatti, Theni-625534. They must be checked against approved production details; do not replace real contact details merely because the prototype contains these values.

## 13. Assets

Twenty embedded payload occurrences: nine font occurrences and eleven images. There are two duplicate font pairs. Image inventory:

| Files | Use | Dimensions |
|---|---|---|
| embedded-10.jpeg | NESAM emblem | 2048×1987 |
| embedded-11.webp | Sedan | 360×220 |
| embedded-12.webp | SUV/Ertiga | 360×220 |
| embedded-13.jpeg | Innova | 820×393 |
| embedded-14.webp | Crysta | 360×220 |
| embedded-15.png | White Carens, transparent | 1774×887 |
| embedded-16.png | Combined Trichy/Madurai landmark artwork | 1774×887 |
| embedded-17.webp | Thanjavur | 1774×887 |
| embedded-18.webp | Puducherry | 1774×887 |
| embedded-19.webp | Coimbatore | 1774×887 |
| embedded-20.webp | Rameswaram/Pamban | 1774×887 |

The combined landmark asset is reused for two destinations. Earlier styles crop it into halves, but later `.nc-restored-landmark` rules reset positioning/width/transform to show the full image. This is a source-level **visual risk**: both cards may show the combined artwork. It needs rendered comparison, not a claim that the current browser output was seen.

For implementation, retain exact SVG geometry/asset proportions, externalize reusable media and optimize delivery rather than copying megabytes of base64 into each component. Font internal family metadata was not independently inspected; family names above refer to CSS declarations.

## 14. Comparison with the existing customer project

This comparison is a targeted repository inspection, not a complete audit of every production function.

| Area | Reference | Repository evidence / implication |
|---|---|---|
| Service types | Five, including Multicity | `user/app/src/types/index.ts:121` and `functions/src/domain/types.ts:141` list four types; Multicity requires a data/API/backend design, not just an extra tab |
| Booking route | City strings and fixture km | `user/web/src/lib/draft.ts` requires valid coordinate-bearing `GeoPlace` values; retain real place and route services |
| Pricing | Fixed category records, service fee and sample formula | `functions/src/domain/pricing.ts` uses configured fare inputs, discounts and GST; copying sample prices would change business behavior |
| Payment choice | Later/25%/full simulator | Existing web draft records Cash/UPI; reconcile supported payment plans separately |
| Extras | Local fare calculations | Continue to trust server-calculated quotes and finalized charges |
| Promotion | No promo-code field in final review | Existing draft has `promoCode`; existing Offers screens must not disappear during a UI rebuild |
| Legal | Short information dialogs | Existing LegalPage/LegalGate/LegalDocuments screens need to remain; sample copy is not a substitute |
| Booking confirmation | Immediately confirmed locally | Preserve actual server statuses and any approval/assignment workflow |
| Native app | No native implementation | React Native needs explicit component/navigation/SVG/font/safe-area implementations |
| Public pages | In-memory page state | Existing route/service landing pages and routing must remain functional |

Other existing surfaces include payments, saved places, notifications, support, profile and active-trip screens. A future rebuild needs an old-to-new action checklist before removing any screen or module. The reference is a visual/interaction specification; it is not authority to delete existing features or replace backend contracts.

## 15. Source risks and QA priorities

1. **Override-heavy source:** 64 function assignments and many CSS revisions make first-match copying unreliable. Use the final effective UI and trace delegated handlers.
2. **Prototype controls exposed:** test lab, deterministic OTPs, driver/office/payment simulations and `root.__nesamTest` must stay out of production UI and authority paths.
3. **Font mismatch:** Inter is the reference. A Poppins requirement must be resolved explicitly; test Tamil glyph fallback and mixed-script wrapping.
4. **Responsive overlap:** test both 700px and 1000px boundaries. Desktop is intentionally constrained rather than edge-to-edge at every width.
5. **Navigation:** page transitions are in-memory; no history/pushState integration was found. Browser back, reload and deep links need real routing in the project.
6. **Accessibility:** there are labels, pressed/current states, ARIA errors, dialog semantics, focus outlines, Escape handling and reduced-motion support. A complete modal focus trap/return strategy is not established by this source inspection. Several compact controls and footer text are small; measure touch targets, contrast and zoom behavior.
7. **Localization:** many strings are translated through `t()`, but some fare/help/demo strings and date formatting remain English. The document starts `lang="en"`; no document-language update was found. Do not claim complete Tamil localization.
8. **Data/privacy:** localStorage contains sample profile/bookings/account snapshots. Production auth, authorization, personal-data handling and transaction integrity need existing secure services.
9. **Payment integrity:** client-side simulation is not payment verification. Use authenticated provider/server confirmation, retries and idempotency in the real app.
10. **Content accuracy:** office number, policy amounts, fares, fees, tax treatment, package definitions and store availability need approved business values.
11. **Image reuse:** verify combined landmark cropping, category capacity and image mapping against final screenshots.
12. **Performance:** the HTML is about 13.6MB uncompressed. Large embedded travel images and repeated font payloads should be addressed in a production port.
13. **SEO:** static title/description exist, but there are no independent routed policy/service pages, canonical/sitemap configuration or SSR strategy in this reference. Preserve the real project's SEO work.

## 16. Verification checklist for a later implementation

- Responsive reference comparison at 320, 360, 390, 599/600, 699/700/701, 999/1000/1001, 1150, 1440 and 1920px; short-height landscape; 200% zoom; long locations and Tamil.
- Each service: valid/invalid location and schedule, return ordering, airport direction, rental city/package and multicity ordering/limits where backend support exists.
- Search: loading, available, unavailable, offline/retry and navigation before asynchronous completion.
- Cars: every category, filtering/sorting, selection persistence, fare view and authoritative quote refresh.
- Guest login, failed/expired OTP, resend, account switching, profile/WhatsApp/mobile change and sign-out.
- Review: self/other passenger, terms, stale quote, duplicate taps and server rejection.
- Payment: later/advance/full only if supported; failure, pending, duplicate payment protection, cancellation mid-checkout and final-bill settlement.
- Trip: confirmed, assigned, arrived, boarding OTP, started, completed, rating, receipt, share and contact.
- Cancellation: just before/exactly at/after cutoff, verified/early arrival, no-show grace, pending payment, refund, dues, cash verification, review and waiver.
- Account/support: all links, saved address CRUD, notifications/read state, policy views and preserving draft/navigation context.
- Native: real Android/iOS rendering, camera/location permissions where relevant, hardware back, keyboard avoidance, safe areas, font loading, SVG fidelity and screen-reader behavior.

## 17. Conclusion

The reference specifies a polished responsive booking and account experience plus a local workflow simulator. It is sufficiently detailed to guide visual implementation, but its sample backend behavior is not a replacement for the current system. The most consequential differences are **Multicity support, Inter typography, three payment plans, final one-hour cancellation rules, five customer milestones and deliberate desktop content width**. No production readiness or bug-free claim can be made without running the resulting app and its integrations.
