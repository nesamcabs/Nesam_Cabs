# Nesam project vs supplied specifications

Audit date: 14 October 2026 (Asia/Kolkata). Checkout: `6e86dd7`.

## Result and counting method

The desktop redesign is present, but the supplied business specifications are not fully implemented. This audit groups the requirements into **48 functional work packages**: **9 have the scoped implementation present, 24 are partial or mismatched, and 15 have no complete implementation found**. Therefore **39 packages need further work**. These are grouped checklist counts, not an estimate of engineering hours or a claim that 81% of the entire product remains to be built. Partial packages differ substantially in size.

"Present" means implementation evidence was found in this local checkout for the stated scope. It does not certify production operation. "Partial" includes existing foundations with a missing integration or contradictory behavior. "Missing" means the required complete path was not found in the inspected source, rather than proof that no external service exists.

Inspected all three source PDFs (43 pages), active app entry points, navigation, service modules, backend functions, Firestore rules, admin operational modules and existing tests. No production database, deployed scheduler, real payment transfer, phone OTP, device camera or live multi-user session was exercised. Existing untracked visual assets were preserved. Application code was not changed.

## Source priority

- **F**: `E:/Legendary One/nesam documents/new/Nesam_Developer_Functional_Specification_v1_0.pdf` (16 pages).
- **T**: `E:/Legendary One/nesam documents/new/Nesam_Developer_Tariff_and_Operations_v2_0.pdf` (24 pages).
- **V**: `E:/Legendary One/nesam documents/new/Nesam_Vehicle_Category_and_Vendor_Duty_Rules.pdf` (3 pages).

T v2 supersedes the earlier normal-trip 10% commission examples. Use fixed partner tariffs for normal duties and accepted payout for marketplace duties. Calendar-date round-trip billing and fixed-route marketplace fulfillment are resolved requirements. F's older money fixtures must not be counted as current tariff acceptance targets. V's explicit category/seating matrix and broad Vendor visibility remain applicable. Proposed controls and unresolved business decisions are identified separately below; they are not all confirmed contractual rules.

## Highest-priority findings

### 1. Vendor assignment has a client/rules contract mismatch

Active `vendor/src/screens/TripsScreen.tsx:193` calls `dispatchDriver`. `vendor/src/services/vendorService.ts:282` builds an assignment with vehicle number but no `assignedVehicleId`. `firestore.rules:493` requires a nonempty vehicle ID for Vendor dispatch. A fresh Confirmed booking without that ID cannot pass this rule. This is a source-confirmed failure condition; a live Firestore reproduction was not run. Select a vehicle record and submit its stable ID, then enforce matching, capacity, expiry and schedule checks.

### 2. Raw customer phone is accessible to Vendors and drivers before the allowed window

`firestore.rules:574` permits an assigned Vendor to read the full booking document containing `phone`; assigned driver access follows at line 575. `vendor/src/services/vendorService.ts:229` maps the raw phone, and `vendor/src/screens/TripsScreen.tsx:100` renders a call action. There is no T-minus-8-hour reveal gate or dedicated reveal audit path in the inspected implementation. Document-level Firestore reads do not mask individual fields. Put raw contact data behind a protected server-controlled reveal path; serve masked partner read models. This is a confirmed mismatch with T page 16.

### 3. Partner UPI collections are omitted from settlement

`functions/src/domain/bookingFlow.ts:188` includes partner collections only when the method is Cash. `functions/src/ledger.ts` debits `paymentSummary.partnerCashHeld`. A UPI payment received directly by the driver/Vendor reduces customer balance but does not reduce partner payout as required. A pure-function probe with company advance 1,000 and driver UPI receipt 5,000 returned `Paid` with `partnerCashHeld: 0`; it should recognize 5,000 held by the partner regardless of channel.

### 4. Trip completion does not calculate the final fare from total KM

`functions/src/trips.ts:122` requires end odometer, then marks the booking Completed and adds tolls. It does not derive verified billable KM and recompute the locked quote plus extra KM. `functions/src/domain/pricing.ts` is used at booking creation, not by this completion branch. The document's driver-entered total KM and final collection/invoice contract is incomplete.

### 5. New tariff and round-trip models are missing from authoritative booking logic

`functions/src/domain/finance.ts:84` derives partner payout from a commission percentage. `functions/src/commerce.ts:65` requires a commission policy. T pages 2-4 instead require separate fixed partner rates. `functions/src/domain/pricing.ts:117` doubles route distance for Round Trip and line 131 derives allowance from driving duration; the engine has no end-date input for calendar-day minimums/bata. Category configuration alone cannot supply the missing tariff dimensions and logic.

### 6. Pickup gate can succeed without location

`functions/src/trips.ts:21` hard-codes 2 km; T/F describe a configurable working value of 3 km awaiting final confirmation. At line 104, absent location becomes a note and the action proceeds. The confirmed requirement for fresh valid location is not enforced; a normal missing-GPS request should fail or use an explicit audited override.

### 7. Dispatch, category matching and document safety are incomplete

Approval immediately opens duties and announces to drivers and Vendors (`functions/src/bookingOps.ts:64`); rules contain no 120/180-second audience gate. Vehicle matching uses label aliases, not the 35-cell matrix/separate seating requirement. Assignment checks approval/status but not document validity through the scheduled trip. Driver overlap uses a fixed three-hour rule with a force bypass, without an independent vehicle interval/repositioning check.

## Full requirement checklist

Evidence paths below are relative to `E:/Legendary One/Nesam_Travels`. Document references identify the requirements; code evidence identifies current behavior. Missing entries were checked against backend exports, domain models and the corresponding active client services.

| ID | Work package | Status | Document | Current evidence and remaining work |
|---|---|---|---|---|
| 01 | Owner-driver onboarding and two-resource approval | Partial | F 3; T 13 | `driver/App.tsx`, RegistrationScreen and admin Drivers support OTP/profile/review. Legacy claim permits absent vehicle ID; enforce separate approved vehicle before duties. |
| 02 | Mobile-bound expiring Vendor invitation | Present | F 3; T 13 (recommended route) | `functions/src/vendorOnboarding.ts` implements registration request, hashed one-time invitation and redemption. Business entry-route approval remains separate. |
| 03 | Vendor employee assigned-trip visibility | Present | F 2,4; T 14 | Booking rules scope driver reads to own assignments. Vendor employee marketplace claim is rejected by independent-driver rules and `driverService.ts`. |
| 04 | Employee experience and financial access restriction | Partial | F 2,7; T 14 | Active MainNavigator mounts Earnings/Wallet for all approved drivers; DriverData subscribes to them. Rules and payout API use driver identity without explicitly rejecting `vendorId`; enforce role restriction throughout. No duplicate Vendor-trip credit was found. |
| 05 | Duplicate identity/licence and controlled membership | Partial | F 4; T 13 | UID/mobile invites exist. No complete licence uniqueness registry, effective membership history and reviewed transfer path found. |
| 06 | Admin-only removal/suspension; no auto-promotion | Partial | F 4; T 13 | Membership fields are protected, but Vendor service has fleet suspension and draft deletion; rules allow Vendor fleet status edits. Add change requests and retained-history account workflow. |
| 07 | Admin approval before duty publication | Present | F 5; T 14 | `commerce.ts`, `bookingOps.ts` and rules hold Pending/Awaiting Approval until approved. |
| 08 | Single successful atomic claim | Present | F 5; V 3; T 22 | Driver/Vendor claim transactions plus cross-document getAfter rules prevent competing successful claims. Concurrent live acceptance still needs emulator QA. |
| 09 | High-rated first; owner expansion at 120s; Vendors at 180s | Missing | F 5; T 14 | Approval opens to all approved audiences immediately. Need server release timestamps, audience enforcement and retry-safe waves. Threshold remains D11. |
| 10 | Explicit 35-cell model/category matrix and passenger seats | Missing | V 1-3; T 14 | `pricing.ts` aliases and `vehicleTypeEligible` compare names. No complete matrix/capacity enforcement at list, claim, dispatch and swap. Vehicle classification detection is only a foundation. |
| 11 | Vendors see/accept all categories regardless of fleet | Present | V 1-2; T 14 | Vendor open query and claim rules do not filter by fleet category; claim reserves without requiring a compatible car yet. Release timing is package 09. |
| 12 | Vendor dispatch driver AND approved stable vehicle ID | Partial | F 4; V 2 | Driver ownership and approved vehicle are required by rules, but active dispatch omits vehicle ID. Fix integration and revalidate swaps. |
| 13 | Customer-approved category amendment and consent history | Missing | V 2; T 20 | No complete original/revised requirement, passenger capacity, agreed fare, consent, operator/time and booking-version recheck path found. |
| 14 | Independent driver/vehicle schedule conflict checks | Partial | F 4,13; T 15 | Admin fixed three-hour driver check and client busy checks exist. Need intervals, estimated end, repositioning, buffers and vehicle checks across all assignment paths. |
| 15 | Start window and prevention of simultaneous resource execution | Missing | F 6; T 11,15 | `advanceTrip` checks current booking/driver status, but no complete other-live-trip/vehicle/start-window transaction gate found. |
| 16 | Live selfie + front photo before departure | Partial | F 6-7; T 11 | Live camera challenges exist for front/rear/interior; `PreTripScreen.tsx` explicitly omits selfie. Submission gates passenger Trip Started, not a complete departure state. |
| 17 | Fresh GPS required; configurable Reached radius | Partial | F 6; T 11 | Distance check exists, but hard-coded 2 km and missing-GPS acceptance contradict the expected gate. Configure radius and validate freshness/accuracy. |
| 18 | Boarding OTP ownership, sequence and attempt limit | Present | F 6,14; T 11 | `trips.ts` verifies booking-specific secret for assigned driver after Reached, with five-attempt lockout. |
| 19 | Total-KM completion and final locked-rate recalculation | Missing | F 6,8-9; T 3,11 | Completion records end odometer/tolls without final distance fare calculation. Add included/actual/extra KM and final invoice/payment recomputation. |
| 20 | Standard one-way customer tariff, floor and bata | Partial | T 3 | Generic category pricing exists; no dedicated standard 130-KM quoted floor, per-service bata and locked extra-distance contract. Live configured category values were not inspected. |
| 21 | Normal fixed partner tariff replaces percentage commission | Missing | T 2-6 | Authoritative payout still uses commission-based `partnerPayoutFor`; need service/category partner rates, approved floor and quote snapshot. |
| 22 | IST calendar-date round-trip days/minimums/bata | Missing | T 4 | Engine doubles route; no pickup-to-end calendar date calculation. Preserve daily 250/300-KM category minima. |
| 23 | Rental minimum time and minute overtime; distance decision gate | Partial | T 5 | Admin rate-card engine has hourly package concepts, but authoritative booking only supports One Way/Round Trip. Implement confirmed time component and explicitly gate unresolved distance/partner rules. |
| 24 | Local-city drop 20-KM packages and distinct extra rates | Missing | T 6 | No complete customer/partner city-drop package product and boundary gate in booking backend. Generic Local classification is insufficient. |
| 25 | Toll/parking/carrier/hills/pet allocation | Partial | T 6 | Toll evidence/approval and generic carrier/permit fields exist. Missing CNG-Sedan exemption, pet acceptance, hills basis, paid-by allocation and inclusion deduplication. |
| 26 | State charge applicability and missing-rate rejection | Missing | T 7 | Vehicle lookup/permit expiry data exist; no complete state/category/seating/effective tariff and coverage check at quote/final settlement. |
| 27 | Same-day multi-city, via-route and planned halt | Missing | T 7 | No complete authoritative multi-city product/waypoint/overnight gate and approved halt allocation found. Base/partner/rounding decisions pending. |
| 28 | Fixed route master wired into server quote + marketplace | Partial | T 8 | Admin `fareEngine.ts` supports FIXED_ROUTE and fare rules. Booking functions use category `calculateFare`; no complete route-zone matching/inclusions/payout-policy snapshot wiring. |
| 29 | Marketplace accepted amount as partner entitlement | Present | T 8-10 | Vendor counter-bid award writes accepted payout; ledger uses stored Vendor payout rather than subtracting commission again. Full fixed-route quoting is package 28. |
| 30 | Hourly 5% escalation, ceiling and cutoff | Missing | T 9 | Marketplace offer exists; no corresponding offer-escalation scheduler, step idempotency, cap/cutoff and ceiling alert found. |
| 31 | Explicit per-post accept mode vs Admin-review mode | Missing | T 9; D09 proposed separation | Vendor can accept Open/Bidding while submitting counter-bids; no exclusive mode gate. Independent-driver bid submission path also absent. |
| 32 | Recorded receipts and outstanding balance | Present | F 9; T 12 | `bookingPayments.ts` records advances/partial/final collections with actor/reference; summary derives outstanding and refund/overpayment. Final fare recalculation is package 19. |
| 33 | Gateway success reconciled as verified receipt | Partial | F 13; T 12 | Razorpay signature/order checks exist in HTTP registry; verifier writes Paid directly rather than the canonical receipt path. Capture/status verification and idempotent receipt integration need QA. Not exported from Firebase index. |
| 34 | Entitlement minus all actual partner receipts | Partial | T 10,12 | Canonical wallet works for recorded cash/office advance cases. Direct partner UPI omitted; financial ownership should be locked before completion and preserved through role/reassignment changes. |
| 35 | Four-hour payout due/hold/overdue and small-wallet policy | Partial | T 12; F 11 | Wallet/payout requests and references exist. No completion+4h due scheduler/escalation found; under-300 priority remains unresolved. Current driver minimum 100/Vendor 500 are not supplied as approved rules here. |
| 36 | Append-only linked financial reversals and paise precision | Partial | F 11-13; T 10,21 | Deterministic entry IDs prevent repeat initial postings. Penalty Deducted is terminal; no linked post-deduction credit reversal. Pricing rounds GST/components to whole rupees; ledger statuses are updated rather than a complete append-only event history. |
| 37 | Expiry-through-trip gate and 20-day reminders | Partial | T 17 | Admin document expiry display and provider expiry checks exist. No complete assignment/start validity-through-trip gate and scheduled 20-day reminders found. |
| 38 | Inactivity warning/report and accident hold workflow | Missing | T 17-18 | Generic Maintenance/Inactive/Suspended controls exist, but no complete configurable inactivity lifecycle or accident case/affected-future-trips/safe-handover/verified-reactivation workflow. |
| 39 | Admin-only single-trip emergency ID and session expiry | Missing | T 13 | No booking-scoped temporary account lifecycle/revoke-on-terminal-state path in active backend exports/registry. |
| 40 | Executive suspend vs higher-authority unblock/delegation | Partial | T 18 | Coarse people/fleet/operations/compliance permissions exist. Suspend and reinstate share broad people controls; add action-level authority, delegation expiry and timed conduct cases. |
| 41 | Cancellation timing, liability, dispute and refund policy | Partial | T 19 | Audited cancellation/refund and manual penalties exist. No full accepted-at four-hour / last-minute policy, nonstacking liability, grace/evidence or linked deducted-penalty reversal. Amounts remain business/legal release decisions. |
| 42 | Shared year-based public booking sequence | Missing | T 20 (recommended) | Customer code is `NT<timestamp>-<request prefix>`; no shared `NTT-YYYY-000001` atomic sequence found. Internal IDs already exist. |
| 43 | Role notifications, safe retries and delivery failure handling | Partial | T 20 | In-app/push/customer email/SMS/WhatsApp delivery logs and unassigned alerts exist. Need complete expiry/payout/ETA ladders, safe transactional retry ownership and contact privacy in all outputs. Provider production settings unverified. |
| 44 | One verified rating and maintained review count | Partial | T 20 | Rules validate one completed-booking 1-5 rating; no complete server rating aggregate/review-count update feeding dispatch priority found. |
| 45 | Route/direction/time-specific seasonal precedence | Partial | T 21 | Global adjustment/coupons/effective admin rules exist. No complete route+season precedence, margin floor and travel-date-specific server quote integration. |
| 46 | Operational/finance/conversion/activity reports | Partial | T 17,21 | Admin ReportsAnalytics and finance dashboards exist. Need complete search-to-quote events, driver 30/90-day classification, payout ageing and allocated expense/tax contribution tied to new models. |
| 47 | Published terms versions and recorded acceptance | Present | F 12; T 20 (recommended) | `functions/src/legal.ts` and active LegalGate components provide versions/acceptance. Production policy content and confirmation-specific/call consent are separate review items. |
| 48 | Specification acceptance and integration QA | Partial | F 14-15; V 3; T 22 | Existing unit/HTTP checks pass, but full updated tariffs, matrix, security rules, concurrent claims, timers and end-to-end payment/payout fixtures are not established by them. `functions` default test points to absent `tests/firestore-rules`. |

## Direct probes and verification

All four app TypeScript checks passed; backend TypeScript build passed.

Existing checks: customer **48**, driver **43**, Vendor **28**, HTTP **9** tests passed (**128** total). Initial Jest runs hit sandbox temporary-cache rename errors before executing tests; rerunning with workspace cache directories succeeded. No application logic was changed to make these pass.

Pure-function comparisons used deliberately supplied category settings, not claimed production tariff values:

| Probe | Current result | Required/interpretation |
|---|---|---|
| 130-KM Sedan with 15/KM, bata 400, configured 10% taxable commission | Customer base 2,350; partner 2,115 | T example partner 2,055 under its stated matching-floor assumption. Confirms percentage payout does not implement fixed 13.50/KM + 300. |
| Round Sedan route 200 KM/300 min per leg, 14/KM; intended pickup Oct 9 noon/end Oct 10 10am | Current engine returns base 6,000 and accepts no end-date parameter | T requires 2 calendar days, floor 500 KM, bata 800: base 7,800. The absence of end-date input is itself the mismatch. |
| Company UPI advance 1,000 + driver UPI receipt 5,000 on 6,000 invoice | Paid, collectable 0, `partnerCashHeld` 0 | Partner actually holds 5,000. Settlement must use recipient, not Cash-only method filtering. |

These probes do not test cloud transaction execution or deployed business configuration. Passing current implementation tests is not proof of conformance to the newer documents.

## Business decisions still open in the supplied documents

T page 23 explicitly lists **15 decision groups**. They overlap the work packages above and must not be added as 15 more missing features. No signed decision record or deployed setting was inspected; treat them as unresolved according to the supplied documents.

| Decision | Confirmation required |
|---|---|
| D01 | Rental 50/70/80 means first-KM price or included KM. |
| D02 | Rental partner minimum/overtime/extra-KM and clock events. |
| D03 | Normal partner floors/quoted KM and round SUV/Crysta rate interpretation. |
| D04 | Tax rate/base/inclusions/invoice ownership/allocation. |
| D05 | Add-on unit, partner share, waiting and reimbursements. |
| D06 | Missing state/Crysta charges, permit coverage and Puducherry seats. |
| D07 | Multi-city base/partner tariff and partial-hour halt. |
| D08 | Fixed-route zones, inclusions and marketplace cutoff. |
| D09 | Per-post acceptance vs reviewed bidding and release timing. |
| D10 | Cancellation applicability/windows/grace/refunds. |
| D11 | Ratings/new drivers, pickup radius, buffers and alert thresholds. |
| D12 | Inactivity/grace/emergency delegation scope. |
| D13 | Calendar-month vs 30-day suspension and appeals. |
| D14 | Under-300 wallet rule vs four-hour payout; negative balance/holds. |
| D15 | City boundaries, distance/time rounding and manual overrides. |

F additionally leaves Vendor registration entry route and cash-confirmation/dispute evidence explicit; do not assume that implementing a recommended invite flow proves business sign-off. This audit reports document release gates and does not make a current legal/tax applicability determination.

## Recommended implementation order

1. Correct the active Vendor dispatch payload; protect customer contact fields; repair recipient-based settlement and gateway receipt integration.
2. Add shared server eligibility: matrix/seats, approved IDs, validity-through-trip, resource intervals and single-execution gates. Then implement timed release and employee-only workspace restrictions.
3. Replace percentage normal payout with versioned customer/partner tariff snapshots. Add calendar days, final total-KM calculation, fixed-route server matching and marketplace accepted payout.
4. Implement confirmed rental time/local-city rules; leave unresolved distance/state/multi-city/tax paths explicitly gated until decisions are recorded.
5. Add offer escalation/modes, four-hour payout tracking, expiry reminders, account lifecycle and linked financial reversals.
6. Complete action-level staff permissions, amendments/consent, notifications and reports. Run updated spec fixtures with Firebase emulator and browser/device end-to-end verification before declaring completion.

No reliable delivery-day estimate is asserted: it depends on business decisions, deployed integrations and the desired scope of the first release. The concrete current backlog is the 39 partial/missing packages above.
