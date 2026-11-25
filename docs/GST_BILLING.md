# Automatic GST bills

The server issues GST documents for trips and payments (`functions/src/gstDocuments.ts`, rules in
`functions/src/domain/gstInvoice.ts`). The admin downloads them in **Invoices**.

| Event | Document | Number | Collection |
|---|---|---|---|
| Trip or Local Taxi ride completed | Tax invoice | `NES/26-27/000001` | `invoices` |
| Cancellation charge kept | Tax invoice | `NES/…` | `invoices` |
| Extra charges approved after the invoice | Debit note | `NDN/…` | `invoices` |
| Payment before the trip ended | Receipt voucher (with GST) | `NRV/…` | `gst_receipts` |
| Payment after the trip | Payment receipt (not a tax invoice) | `NPR/…` | `gst_receipts` |
| Refund marked Completed | Refund voucher | `NRF/…` | `gst_receipts` |

## Before anything is issued

1. Settings → Company: name, GSTIN, registered address.
2. Invoices → Tax automation: accountant-approved classification and SAC codes.
3. Invoices → Signature: signatory name and signature image.

## When a document is held

It appears under **Invoices → Needs attention** with the reason: missing setup, pickup state unknown, extra charges
waiting for approval, fare needing review, no saved GST amount, trip older than 30 days, voided invoice, GST switched
off in a Local Taxi zone, or a bill of ₹50,000+ without the customer's address. The periodic job retries held items;
**Generate pending bills** also covers trips older than 30 days.

A voided invoice is never replaced automatically. Because the invoice now appears as soon as the trip completes, a fare
change on a completed trip needs the invoice voided first.

## Deploy

1. `firebase deploy --only firestore:rules`
2. Deploy the API (`functions/`), then the admin.
3. The periodic job (`api/cron/tick` or `periodicJobs`) must be scheduled for retries.

## Not covered: confirm with the accountant

- E-invoicing (IRN / signed QR) for B2B invoices, mandatory above the turnover threshold. Not integrated.
- GSTR filing. Reports & GST counts invoices and debit notes; GST on advances (receipt and refund vouchers) is not in
  its totals.
- Credit notes. Voiding is available; a reported invoice needs a credit note instead.
- Tolls and some extras are shown as non-taxable, and the Local Taxi platform fee follows the zone fare (not taxed).
- Partner-side bills (vendor commission, wallet recharges, dues, security deposits).

## Tests

`node --test test/gstDocuments.test.js` and `npm run test:e2e:gst` in `functions/`.
