# Admin controls, connections and trigger audit — 29 October 2026

> Follow-up fixes are recorded in [WIRING_FIXES_2026-10-29.md](WIRING_FIXES_2026-10-29.md). The open-gap list below is the audit-time baseline, not the current implementation status.

**Result: several defects fixed; the whole product cannot be certified as a perfect end-to-end flow.** Every sidebar page is included in the source inventory. Browser clicking was blocked by the computer-use tool because it could not identify the current Windows browser URL confidently. No browser restriction was bypassed. This report therefore distinguishes source tracing, real handler/rules tests, earlier integration evidence and unfinished features.

## Scope and evidence

- All **36** requested sidebar destinations, their imported components, global header/sidebar controls, booking details and new booking are inventoried.
- **158** reachable source modules and **2,081** JSX control/callback declarations were enumerated. These include buttons, fields, forms, tabs, modal callbacks and shared components. They are source declarations, not 2,081 distinct rendered buttons or clicks.
- Every raw button was checked for a click handler or submit behavior. The only remaining scanner exception is the shared `Button`, which correctly forwards its handler through `{...rest}`. No uncontrolled editable input was found by this structural check. This does not establish correctness of arbitrary callback bodies.
- **35** primary admin root collections were actually queried as the local Master account with the real deployed-source Firestore rules.
- **Six new emulator tests pass**, executing real admin service source: root reads; catalog/settings/support/review/account writes and failed-save returns; simultaneous/replayed business receipts; invoice creation/booking linkage/duplicate refusal; in-app notification creation/delivery logging; restricted staff moderation versus forbidden pricing/finance writes.
- Admin production build/typecheck passes after the fixes. Large bundle warnings remain.
- The previous audit's 56 cross-role emulator tests remain prior evidence for booking, dispatch, trip, contact, payment, settlement and partner linking. They were not relabeled as newly clicked admin UI tests.

`Communication21` in the supplied list is the Communication menu plus its live unread badge; 21 is not another action/page. `useNavBadges` derives that number from unread admin notifications.

## Fixed defects

1. **Dashboard → View had no handler.** It now opens the selected booking through `onSelectBooking(b.id)`.
2. **Business accounts → Quote/New booking lost the selected business.** The selected business ID now reaches the new-booking draft. An unestimated draft starts on the trip step instead of jumping ahead.
3. **Business receipts could double-credit or leave orphan receipts.** Receipt and account balance now commit in one transaction; a deterministic identity for method/reference makes simultaneous submissions and retries idempotent. A reused reference with a different amount, missing account, negative amount or invalid precision is rejected. This protects receipts recorded through the updated handler; it does not reconcile historical duplicate receipts or lock out an older deployed client.
4. **Reviews moderation/response displayed success after a failed write.** Both handlers now stop and report failure before changing local data or displaying success.
5. **Review Settings was a simulated Save.** No settings were persisted or consumed. It now displays the actual fixed policy, disables unavailable automation choices and has a Close action. No automatic publication or low-rating alert feature was invented.
6. **Support ticket status changed locally before confirming the database write.** It now checks the write result first and displays read/write errors.
7. **Account-notice delivery swallowed tracking-write failures.** A notice no longer claims a complete success when its delivery status could not be saved; busy state clears on every path and the operator is directed to the delivery log before retrying.
8. **Unconnected settings and contract-pricing claims were misleading.** Settings now distinguishes stored office preferences from operating rules/provider controls. Business pages no longer say contract rates/credit limits are automatically applied when the server only records the account/billing reference.

## Every sidebar page

S = source/control graph inspected; T = new handler/rules test; E = earlier cross-role emulator evidence; G = a specific missing connection. All entries are S; extra markers indicate stronger evidence or gaps. The control register contains the individual file/line/handler declarations, including shared dialogs.

| Page | Actions and primary outgoing connection | Incoming data / cross-panel result | Evidence or gap |
|---|---|---|---|
| Dashboard | Filters, quote/enquiry, new booking, shortcut cards, View → booking selection | Shared booking/fleet/customer/penalty listeners and live badges | Fixed View; E for booking lifecycle |
| Bookings | Filter/search, enquiry conversion, approve/reject/cancel, publish, assignment, contact/fare/payment/invoice drawers → booking callables | `bookings`, `booking_contacts`, assignments/events; customer/partner listeners and notifications | E; individual UI drawer submissions not clicked |
| Trips | Stage filters, booking detail, follow-ups/ownership, operational actions | `bookings`, `office_followups`, `booking_ownership`; driver advances feed live status | E |
| Open Marketplace | Publish/offer/bid award/reject and booking open → marketplace services/callables | `marketplace_trips`/bids; eligible vendor/driver offer subscriptions | E |
| Partner Requests | Filters, inspect, approve/reject cancellation/bank/document requests → `decidePartnerRequest` | `partner_requests`, partner records, notices and penalty/finance effects | E for selected requests; other decisions S |
| Customers | Search/filter, view/edit/status, booking navigation → customer profile writes | `customers`, customer-owned profile/bookings | Root access T; form-specific behavior S |
| Business accounts | Add/edit, contract rows, statements, receipt, credentials, Quote/New booking | `business_accounts` and nested payments/credentials; account ID recorded on admin bookings | Receipt T; navigation fixed; contract/credit/API G |
| Driver Partners | Registry tabs, profile/KYC/document/account actions, booking open | `drivers`, `driver_private`, vehicles, requests/notices; driver context refreshes | Root reads T; E eligibility/linking |
| Vendors | Registry, application/KYC/account actions, fleet/trip/finance links | `vendors`, `vendor_kyc`, invitations, bookings/wallets; vendor context refreshes | Root reads T; E dispatch/linking |
| Vendor Drivers | Fleet-driver search/profile/link/account actions | Drivers/vendor association, `partner_links`, linked bookings | E |
| Vehicles | Registry/filter, documents, approval/status, pairing and history | `vehicles`, partner links and assigned booking vehicle snapshots | E eligibility/linking; document UI S |
| Verification | Driver/vendor/vehicle review entry points and decisions | Partner/document approval fields; partner apps listen for status | S and shared registry data |
| Partner Links | Find, request/OTP/help, approve/reject/cancel/override | `partner_links`/events; server updates ownership/pairing and notifies parties | E |
| Vehicle Categories | Create/edit/status, reference checks, rename propagation/delete protection | `vehicle_categories`; quote eligibility and fare configuration; dependent names copied to linked masters | Root read T; E pricing/eligibility; rename dialogs S |
| Accounts | Register, statement, opening/adjustment/deposit/settlement, match/verify and export | `accounts_register`, wallet/settlement/deposit data and server finance functions | Register create/verify T; E settlement |
| Penalties | Issue, inspect, acknowledgement/dispute history, transition | `penalties`, wallet ledger/debits and partner notifications | E |
| Invoices | Eligibility/billing, issue, inspect, print/export, void | `invoices`, booking invoice link, `settings/invoice_sequence` | Issue/link/duplicate T; UI print/void S |
| Reports & GST | Period/filter, aggregations, registers, statement/export actions | Bookings/invoices/register/finance projections; no live bank/tax filing integration | Root reads T; calculations/export UI S |
| Full & Final | Partner inspection, liabilities/deposit/closure/reopen controls | Partner accounts, `ff_records`, ledger and deposits | Root reads T; closure/reopen S |
| Payments | Search/filter, booking open, verified receipt/void/refund actions | Canonical booking transactions and derived balances | E; failed/pending receipts do not count |
| Driver Earnings | Driver/period filters, statement/payout inspection | `wallets`, `wallet_ledger`, bookings/payouts | E finance derivation; UI filters S |
| Vendor Finance | Vendor balances, settlement and payout actions | Same ledger owned by vendor for fleet trips | E |
| Commission Policy | Global/service/category policy edit/save → `saveCommissionPolicy` | `business_config/commission`, versioned snapshots; applicable booking pricing | E selected finance paths; policy form S |
| Service & Fare Settings | Rate sections, preview, rules, fixed routes, dispatch/operation settings | Tariff/config/service-rule records; server quote/assignment consumers | E pricing; some unconsumed airport fields G |
| Communication | Message draft/send/schedule/cancel, recipient/channel selection, delivery history/retry, inbox/coupons | `notice_campaigns`, `notifications`, `notification_deliveries`, read/ack states; scheduled job and provider webhooks | In-app T; external providers and scheduling G |
| Support | Customer/SOS/partner queues, status/follow-up, booking open | `support_tickets`, `sos_alerts`, `partner_requests`; customer records reflect resolution | Ticket status T; failed-save handling fixed |
| Staff & Access | Staff/role create/edit/status, rights, session revocation | Staff callables update `admins`/roles/access versions; auth session listener updates allowed pages | Limited-role restrictions T; E selected staff permissions |
| Staff activity | Search/filter, staff/session/activity inspection and booking navigation | `staff_sessions`, `staff_activity`, audit/security records; shell heartbeat/page logs | Root reads T; actual browser heartbeat not exercised |
| Settings | Company/config save, booking/payment/notification/general tabs and connected operations cards | `settings/config`; company details feed invoice snapshots; operations consumers use their own configured records | Config save T; reference-only controls disclosed G |
| Offers & Coupons | Create/edit/status, test eligibility, usage, export | `coupons`; shared customer coupon subscriptions and server validation | CRUD/access T; E selected pricing |
| Services | Create/edit/status, reference-check/rename/delete | `services`, admin booking service selection and copied fare/coupon names | CRUD T; automatic customer catalog/channel control G |
| Tour Packages | Create/edit/duplicate/status, itinerary/departure, references/delete | `tour_packages` and copied catalog references | CRUD T; customer package booking/catalog G |
| Locations | Create/edit/status, hierarchy, service references, rename/delete checks | `locations`; admin booking selectors and fixed-route location identities | CRUD T; customer place search uses external geocoder G |
| Reviews | Filter/sort, publish/hide/flag, notes and response | `reviews`; customer rating also updates booking/partner aggregates separately | CRUD/moderation/access T; public display/automation G |
| B2B Integrations | Read partner directory | `b2b_partners`; this screen has no external API connect/handshake implementation | Root read T; external booking API G |
| Terms & Privacy | Seed/publish/version/acceptance inspection → legal callables | `legal_documents`, `legal_acceptances`; customer/driver/vendor/admin legal gates | E for server paths; every gate UI not clicked |

## Trigger and receiver map

| Event | Receiver / derived work | Visible result |
|---|---|---|
| Admin approve/reject/publish/assign/cancel/payment action | Corresponding callable verifies actor and transition, writes booking/marketplace/contact/receipt records and notices | App/web booking, offers, driver/vendor trip and admin list listeners update |
| Booking cancellation | `onBookingCancelled` / HTTP reconciliation | Marketplace is closed; stale claims fail; refund/money/finance work reconciles |
| Booking money fields change | `onBookingMoneyChange` | Payment summary, paid/balance and refund state derives from canonical receipts |
| Booking finance / payout request change | `onBookingFinanceChange`, `onPayoutRequestWritten` | Immutable finance snapshot, partner ledger and wallet recompute |
| Completed booking / settlement state | `onBookingSettlementChange` | Settlement due and processing/paid/hold states appear in finance queues |
| Customer booking rating | `onBookingRated` | Driver/vendor aggregates increment once; this is separate from public testimonial publication |
| Communication in-app send | `sendNotification` / campaign runner | Recipient-owned notification plus delivery attempt; read/ack updates feed admin campaign history |
| Scheduled work | Firebase `periodicJobs`, or externally invoked HTTP cron/tick | Offer cutoff/escalation, reminders, retries and scheduled notices; deployment scheduler still needs configuration |
| WhatsApp / Razorpay provider event | Signed webhook handlers | Delivery receipts / verified canonical booking or wallet credit; credentials/provider setup still required |
| Direct admin master/config edit | Firestore listeners; usually **no dedicated backend trigger** | Only consumers that actually query that collection update. Saving unused configuration does not create a missing consumer |

## Open connections and release limits

These are concrete source gaps, not failed local credentials or assumed product behavior:

- **Business contract pricing, credit enforcement and external API:** contract rows/limits/credentials can be recorded. Server admin booking only retains the business account/billed-to fields; it does not automatically price from `contractRates` or enforce business credit limits. External API credentials have no authenticated booking endpoint consuming them. UI claims were corrected; those features remain unimplemented.
- **Settings controls:** `advanceBookingLimit`, `minBookingNotice`, `cancelWindow`, `cancelCharge`, `allowCod`, `smsEnabled`, `emailEnabled`, `whatsappEnabled` and `pushEnabled` are stored in office config without corresponding global enforcement in the booking/provider code. GST/display preference fields are not the authoritative tariff inputs. Notes now make this visible.
- **Customer catalogs:** customer online service navigation is a fixed supported-service list, package shopping is not implemented, and place search uses geocoding rather than the admin locations catalog. Admin master CRUD succeeding does not mean those customer surfaces update automatically.
- **Reviews:** customer rating writes and admin moderation exist, but customer web's testimonials section is still an empty presentation; published review/official-response display is not wired. Auto-publish and automatic low-rating alert settings had no consumers.
- **Airport tariff fields:** some saved airport base/payout fields remain explicitly unapplied until their formula is settled, as in the earlier report.
- **Providers/devices/deployment:** no real SMS, WhatsApp/email delivery, payments, device push, physical camera/GPS or production scheduler/deployed rules/indexes was validated. No live messages/payments or deployment were performed.
- **Browser acceptance remains blocked:** successful typechecks, structural checks and handler tests do not establish every modal, keyboard interaction, disabled state, export/download or responsive layout. A complete interactive pass remains required before calling all buttons perfect.

## Reproduce / inspect

- Run `node scripts/admin-control-inventory.cjs`. It writes `output/admin-audit/control-inventory.json` with all file/line/tag/handler/disabled declarations, per-page reachable modules, collection references and callable names. The graph is at module granularity, so shared services can include unused exports; it is not an exact execution trace.
- `output/admin-audit/control-register.md` is the human-readable companion, generated from that inventory. It includes every enumerated declaration rather than only the 36 menu entries.
- New tests: `functions/test/adminPanel.e2e.test.js` and `adminServiceLoader.cjs`. The loader transpiles real admin service source, replaces only the Firebase connection with an authenticated local SDK and executes against actual emulator rules. It does not bypass permissions with the Admin SDK for the actions under test; the Admin SDK is used only to seed/read fixtures and assert stored results.
- `npm run test:e2e` in `functions` includes these tests. Logs for this run: `output/admin-audit/service-tests.log` and `build.log`. Expected permission-denied/not-found logs are asserted negative cases.
- `scripts/admin-audit-session.cjs` prepares a disposable `demo-nesam` fixture session; it refuses production project settings. The running audit session is stopped after verification.
