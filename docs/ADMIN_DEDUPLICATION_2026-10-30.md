# Admin workspace consolidation — 30 October 2026

Local UI changes remove repeated editors and navigation entries while retaining stored records, existing server pricing and permissions. No production deployment or data migration was performed.

## Consolidated controls

| Repeated option | Single location after the change | Compatibility and safety |
| --- | --- | --- |
| Global fare adjustment in Service & Fare Settings and Pricing & Fare Management | Service & Fare Settings → Pricing rules | The same component and server save action remain; the second instance is removed. |
| Base tariff editor in a Base rates dialog and Pricing & Fare Management | Service & Fare Settings → More settings → Base rates | The original dialog's unsaved-change and save-in-progress guards remain. |
| Tax-policy editor in pricing and invoices | Invoices → Tax automation | The existing finance-owned policy editor remains; the pricing copy and its independent fallback policy are removed. |
| Coupons in Communication and a separate Offers page | Offers & Coupons | Communication no longer contains another coupon editor. Its old Coupons shortcut resolves to Offers. Existing engagement readers retain read access; editing still requires pricing plus Settings edit. |
| Vehicle Categories in the sidebar and under Cab types | Service & Fare Settings → Cab types → Vehicle categories | The repeated sidebar item is removed. The existing `categories` destination still opens the same embedded manager for older shortcuts. |
| Accounts → Statements and Accounts → Partner statements rendering the same statement component | Accounts → Statements | The picker includes customers, business accounts, vendors and drivers. Older Partner statements shortcuts resolve to Statements, preserving any account suffix. |

The older Pricing & Fare Management page is now clearly named **Legacy rate cards**. Its distinct reference records and calculator remain available under More settings; it no longer presents another live tariff or global-adjustment editor. Back navigation and unsaved legacy-form checks remain.

## Coupon records are preserved

The coupon workspace has one place to create new campaigns, including an explicit Office bookings only setting, description and terms. Current campaigns and older records use separate, non-overlapping lists within this workspace:

- Records carrying the existing `audience` schema use Customer campaigns, including office-only campaigns and an Archived filter.
- Earlier records without that schema use Legacy coupon records and their existing form. The old create/copy buttons are removed; existing edit, activation and deletion rules remain. Read-only staff do not receive these write actions.
- Earlier records are not automatically converted into campaigns. Their existing dates, zero/unlimited limits, eligibility and redemption history therefore do not change because of this cleanup.
- Engagement readers who formerly viewed coupons inside Communication retain their former public-coupon read view in Offers. They do not gain pricing or Settings edit rights.

## Source-wide overlap review

The sidebar/page inventory and shared-component uses were scanned across the admin source. Similar names were not treated as sufficient reason to delete a workflow:

| Area reviewed | Why the remaining screens/actions are distinct |
| --- | --- |
| Dashboard, Bookings, Trips, Open Marketplace, Partner Requests | Overview, booking lifecycle, dispatch tracking, external duty allocation and request decisions serve different operations. Assignment/cancellation dialogs are shared contextual actions on the selected booking. |
| Customers, Business accounts, Driver Partners, Vendors, Vendor Drivers, Vehicles, Verification, Partner Links | Different account/entity types, document-review queues and relationship approvals; a verification queue is not another account list. Vehicle Categories has been consolidated as described above. |
| Accounts, Payments, Invoices, Reports & GST, Full & Final | Accounting register, payment transactions, invoice lifecycle, tax reporting and closed-account settlement are separate records/workflows. Shared tax-payment/refund dialogs and closed-account statements remain contextual views of the same implementation. |
| Penalties, Driver Earnings, Vendor Finance, Commission Policy | Disputes, individual driver earnings, vendor balances and commission configuration have distinct ownership and actions. |
| Service & Fare Settings, Services, Tour Packages, Locations, Offers & Coupons | Booking/pricing rules, public service masters, package catalog, geographic masters and promotions are distinct. More settings links to Business accounts/Locations open their existing pages instead of another editor. |
| Communication, Support, Reviews | Delivery/notices, customer support and review moderation are separate queues. The duplicate coupon workspace is removed from Communication. |
| Staff & Access, Staff activity, Settings, B2B Integrations, Terms & Privacy | Staff authorization, audit records, operational preferences, external-partner records and legal documents are separate responsibilities. |

Base tariff class defaults and category-specific Extra charges were retained as separate scopes. This change does not alter their backend precedence, booking snapshots, payments, payouts or notification triggers.

## Verification

- `npm run test:workspaces`: **6/6 passed**. Tests exercise real permission/navigation functions, campaign serialization, preservation of office-only/terms/redemption fields, disjoint legacy/current record ownership, single pricing/tax/coupon editor owners, and sidebar uniqueness.
- Admin production build: TypeScript and Vite passed. The existing bundle-size advisory remains non-blocking.
- `git diff --check`: passed.
- Source inventory regenerated in `output/admin-audit/`; this is a source inventory, not evidence of browser clicks.
- Logs: `output/admin-dedup-tests.log`, `output/admin-dedup-build.log`.

A live browser click pass and deployment are not certified by these checks. The earlier computer-use restriction has not been bypassed. Backend/provider integration tests from the prior wiring fix are historical evidence, not rerun claims for this UI consolidation.
