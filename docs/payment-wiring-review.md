# Payment wiring review — 29 October 2026

Reviewed the customer receipt → booking summary → partner entitlement → wallet → payout chain, using targeted source inspection and existing tests.

## Project ownership model

- Customer pays for the booking. Each successful receipt records whether NESAM/staff, driver, vendor or gateway collected it.
- Independent-driver trips settle to the driver. Fleet trips settle to the vendor; employee drivers cannot withdraw a separate NESAM wallet.
- Partner-held money, including UPI received directly by the partner, reduces what NESAM owes. Company-collected advances are not treated as partner cash.
- Wallet earnings require completed, verified trips and confirmed customer payment. Withdrawals reserve funds in the ledger.
- Partner bank/UPI payouts are recorded external transfers; these actions do not themselves initiate an automated bank transfer.

## Fixes

- Settlement payment now rechecks current booking eligibility and amount, verifies available ledger funds, and writes the payout debit atomically under the same partner lock as wallet withdrawals. This prevents both paths spending the same available balance. Held settlements must be released first.
- Payment-summary changes now trigger ledger and settlement reconciliation even if the top-level Paid status stays unchanged.
- Captured webhooks reject noncaptured status, non-INR currency, noninteger or nonpositive amounts, in addition to the existing signature/order/amount checks.
- Successful and duplicate gateway confirmations explicitly reconcile the booking, wallet and settlement on HTTP hosting, which has no Firestore triggers. A failed reconciliation can be retried without recording the receipt twice.

## Verification

Backend build passed. 55 Node tests passed, including eight new payment checks: split company/partner collections, vendor versus independent driver ownership, failed/voided receipts, partner debt, payout reservations and release, refund gating, webhook signature tampering and invalid captured events. New tests are included in the normal test command.

## Remaining limits

Customer web and mobile source inspection found no Razorpay checkout invocation. The website explicitly states online payment is unavailable; it offers cash/UPI payment history. Backend gateway handlers existing is not evidence of an operational customer checkout.

Live gateway credentials, provider webhook setup, real transfers, browser journeys, refund delivery and concurrent database transactions were not exercised. Emulator integration verification remains blocked by installed Java 17 versus the Firebase CLI's Java 21 requirement, previously confirmed in this chat. Changes are local and undeployed. In particular, the concurrent-payout protection needs emulator acceptance testing before production deployment.
