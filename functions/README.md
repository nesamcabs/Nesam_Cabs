# Cloud Functions

The supported deployment exports exactly three functions from `src/index.ts`:

- `createBooking`: authenticated callable; validates the customer, obtains a road route, calculates the fare and coupon eligibility on the server, then atomically creates the booking, private boarding OTP and marketplace offer. The client reviews a changed fare before retrying. Request IDs make successful retries idempotent.
- `requestPartnerPayout`: authenticated callable; validates approved partner status, saved private payout details and available settled revenue. Transactions serialize competing requests. Cash collections, unpaid/unverified trips and vendor-owned driver revenue are excluded. Deferred requests continue to reserve funds.
- `onTripCompleted`: writes one deterministic audit ledger entry per verified completed booking. Repeated event delivery cannot credit the same trip twice. Withdrawable balance is calculated from settled bookings and payout reservations, not a client-editable wallet field.

Roles are read from Firestore profile documents. The old auth, OTP and Razorpay modules are retained as historical source but are not exported. Existing boarding OTP verification uses the booking-secret Firestore rules; this release does not activate those legacy callable implementations.

## Verification

From this directory:

```powershell
npm.cmd ci
npm.cmd test
```

The test command compiles functions and runs the local Firestore emulator suite, including rules, real callable handlers and actual admin transaction operations. It requires Java, a cached Firebase Firestore emulator, and installed dependencies in `../tests/firestore-rules` and `../admin`. Handler tests mock routing HTTP responses; they do not exercise deployed HTTPS transport or real routing availability.

## Rollout

Follow [DEPLOYMENT.md](DEPLOYMENT.md). Updated clients depend on these callables. Deploying only the new rules breaks old clients that directly create bookings and payouts. Migrate existing public driver bank/identity fields with the dry-run-first script before releasing the new private-data contract.

In Admin Booking Details, record a UPI payment only after confirming receipt in the company account. Exact fare plus approved tolls is required. This records manual reconciliation; it is not gateway checkout or an actual bank transfer. Payout processing remains an administrator operation.

Phone testing, upload signing, production routing capacity, gateway integration and push notification delivery are separate rollout requirements. No production data migration or deployment is performed by the test command.
