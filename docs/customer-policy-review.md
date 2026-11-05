# Customer policy implementation — 27 October 2026

Both customer sites now expose terms, privacy/location, cancellation, refund, fare/payment and passenger safety policies at /legal with section links. Footer, login, booking review and payment history link to the policies. The existing server-published versioned agreements and acceptance gate remain in place; the public text does not fabricate acceptance records.

Cancellation wording follows user/app/src/services/rideService.ts, including the Pending exemption and the exact one-hour boundary. Prices/windows reference shared constants. Refund wording distinguishes an unpaid request, recorded refund and bank settlement; no unverified settlement SLA is advertised.

## Where the policies are linked (both sites)

| Decision point | Policies linked |
| --- | --- |
| Footer | Terms, Privacy & location, Cancellation, Refund, Fare & payment |
| Sign-in / sign-up popup and profile / account-hold screens | Terms, Privacy (next to the "By continuing you agree" text; opens in a new tab so the popup and booking stay intact) |
| Terms acceptance gate (new published version) | Link to the public policies; /legal stays readable before accepting |
| Location search ("Use current location") | Privacy & location |
| Booking review | Terms, Fare & payment, Cancellation, Refund beside the acceptance checkbox; Privacy when booking for someone else |
| Vehicle choice (One Way Car Rentals toll notice) and every fare breakdown | Fare & payment |
| Cancel dialog | Cancellation, Refund, before "Cancel ride" |
| Cancelled booking details | Refund, when a cancellation fee or refund is shown |
| Receipt (screen and printed) | Fare & payment, Refund |
| Payments & refunds page | Fare & payment, Refund |
| Account | "Terms, privacy & customer policies" entry (signed in and signed out) |
| Support | Cancellation, Refund, Passenger safety, Privacy |
| Safety centre (SOS) | Passenger safety & support |

Access: /legal is public. It also stays readable from the profile-setup, account-hold and load-error screens and while a new agreement version awaits acceptance; those screens render it as for a signed-out visitor, and private pages are unchanged. The account-specific agreement versions and acceptance status still load only for a signed-in user, and acceptance is still recorded only through the existing gate checkbox (no new acceptance control was added). Section links scroll on direct load, refresh, in-app navigation and repeated clicks on the same section.

The booking-review checkbox wording was corrected to match `cancellationQuote`: free while Pending or more than the configured window before pickup, fee at or within the window (values from the shared constants).

## Business details still required

Before production publication, the business should reconcile any existing published legal_documents with this public wording and confirm the operator identity, registered address, grievance officer name/contact, a customer support / grievance email address, complaint handling timetable, retention periods and actual refund processing commitment. The repository supplies a company name and support phone but does not establish all these details. They have not been invented. Publishing a new mandatory agreement still uses the existing admin legal document workflow.

Reference material reviewed:
- https://consumeraffairs.gov.in/public/upload/files/E%20commerce%20rules_1732703966.pdf
- https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa

Changes are local source changes; no remote policy records or hosting deployments were performed.
