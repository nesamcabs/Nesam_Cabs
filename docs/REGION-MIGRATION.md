# Moving the server to Mumbai (asia-south1)

**Why:** the Firestore database is in Mumbai, but the functions ran in `us-central1` (USA). Every quote and booking made several
round trips across the world: browser → USA, and USA → Mumbai database for each read. Running the functions in Mumbai
puts them next to the database and close to riders.

## What changed in the code

| Where | Change |
|---|---|
| `functions/src/region.ts` (new), imported first in `functions/src/index.ts` | Every function (137 callables, 10 database triggers, 3 scheduled jobs) now runs in `asia-south1`. |
| `functions/src/paymentWebhook.ts`, `functions/src/customerVerification.ts` | The Razorpay and WhatsApp **webhooks stay in `us-central1`**: their addresses are saved in those companies' dashboards. |
| `functions/vercel.json` | The optional Vercel HTTP API runs in Mumbai (`bom1`). |
| Admin, driver (web + app), vendor (web + app), user app, People Taxi, One Way Car Rentals, NESAM website | `getFunctions(app, 'asia-south1')` so every call goes to Mumbai. Local emulator, dev proxy and early-connection hints updated to match. |
| `functions/test/*.e2e*` | The emulator tests address the functions in `asia-south1`. |

## Rollout: the order matters

A client that calls Mumbai before the Mumbai functions exist gets "not found". So:

1. **Deploy the functions first.**
   `firebase deploy --only functions` (from `Project/`).
   The Firebase CLI will notice about 150 functions in `us-central1` that are no longer in the source and ask whether to delete
   them. **Answer No.** (Do not use `--force`.) Old app versions still call `us-central1`.

2. **Delete the old database triggers and scheduled jobs right away** (otherwise each event runs twice, once per region):
   ```
   firebase functions:delete onPublicReviewWritten onPublicServiceWritten onPublicPackageWritten onPublicLocationWritten onBookingCancelled onBookingMoneyChange onBookingFinanceChange onPayoutRequestWritten onBookingSettlementChange onBookingRated unassignedBookingAlerts periodicJobs ltDispatchSweep --region us-central1 --force
   ```

3. **Check in the Firebase console → Functions** that the functions now list `asia-south1`, then open the admin and place a
   test quote.

4. **Deploy the websites** (admin, driver web, vendor web, People Taxi, One Way Car Rentals, NESAM website). They already point
   to Mumbai in this code.

5. **Release new mobile builds** (customer, driver and vendor apps). Old installed versions keep working because the old
   `us-central1` callables are still deployed.

6. **Later, when old app versions are gone,** remove the leftover `us-central1` callables (they run old code and get no
   updates). List them in the console, or `firebase functions:delete <name> --region us-central1`.

## Webhooks (optional, later)
`razorpayWebhook` and `whatsappWebhook` stay at `https://us-central1-nesamtoursandtravels-202f5.cloudfunctions.net/...`.
To move them, change `WEBHOOK_REGION` in `functions/src/region.ts`, deploy, and update the address in the Razorpay dashboard
and the WhatsApp (Meta) webhook settings at the same time.

## Cost note
`quoteBooking`, `createBooking` and `searchGooglePlaces` keep one warm instance (`functions/src/hotOptions.ts`). Those
instances now run in Mumbai. The old `us-central1` copies are not kept warm.

## Rollback
Remove `import './region';` from `functions/src/index.ts`, redeploy, and revert the `getFunctions(app, 'asia-south1')` lines.
