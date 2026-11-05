# Backend rollout

This release changes the client/server contract. Ship the updated apps/web clients together with these functions and rules. Old clients that directly create bookings or payout requests will be denied after rules deployment.

1. Back up Firestore and review the `driver_private` migration in a staging project.
2. Install Functions dependencies with `npm ci` and run `npm run build`.
3. With authorized Application Default Credentials, run `node functions/scripts/migrate-driver-private.cjs` (counts only). Run again with `--apply` to atomically move bank/identity fields; existing private values take precedence. Never put a service-account key in git.
4. Deploy `createBooking`, `requestPartnerPayout`, `onTripCompleted`, Firestore rules/indexes and Storage rules together. Verify the project with `firebase use` first.
5. Verify phone sign-in, booking, both claim paths, bid award, OTP start, completion, private KYC reads, cancellation, SOS and profile uploads in staging and on physical Android devices.

Only the three functions exported from `src/index.ts` belong to this deployment. The previous `auth.ts`, `otp.ts` and `payments.ts` implementations are archived source, not live exports. If older versions were previously deployed, inventory and retire their endpoints during rollout; leaving an old Admin SDK callable running can bypass the new rules. Do not accept an unreviewed CLI deletion prompt for unknown functions.

`createBooking` resolves the road route on the server (optional `ROUTING_URL`), prices with admin categories or the documented defaults, verifies coupons transactionally, and creates the booking/secret/marketplace atomically. It returns the current fare on quote mismatch so the rider can review it before resubmitting. Routing failures fail closed.

`requestPartnerPayout` serializes requests per partner and checks verified, completed, paid non-cash trips. Fleet revenue belongs to the vendor, not both the vendor and driver. Cash already collected is not also payable by the platform. Toll reimbursements require admin `tollsApproved`. Legacy trips lacking `fareVerified` require explicit reconciliation. Rejected/cancelled requests release their reservation; Deferred requests continue to reserve it.

Online gateway checkout and push are not enabled by this rollout. Existing UPI/cash handling needs administrator reconciliation of actual received money. Gateway credentials, FCM configuration and production signing remain external integrations. Signing was explicitly deferred by the owner.

## Partner onboarding (spec page 13)

Driver, vendor and vendor-employee onboarding collects only what page 13 lists. Ship these together:

- Functions: `lookupVehicleByRegistration`, `requestVendorRegistration`, `issueVendorInvitation`, `revokeVendorInvitation`, `redeemVendorInvitation`.
- Firestore rules: vendor accounts are created only by `redeemVendorInvitation`; `vehicle_lookups`, `vendor_requests`, `vendor_invitations` are server-written.
- Clients: Driver app/web, Vendor app/web and the Admin panel. An old Vendor client that creates its own `vendors/{uid}` is refused by the new rules.

**Vehicle auto-detection needs a data provider.** mParivahan / VAHAN has no public API for private companies, so the lookup is a provider adapter:
set `VEHICLE_LOOKUP_PROVIDER`, `VEHICLE_LOOKUP_API_KEY` (and `VEHICLE_LOOKUP_API_URL` for a provider other than `surepass`) — see `.env.example`.
Before go-live, run one real plate through the deployed function and confirm the provider's field names map (`src/domain/vehicleRegistry.ts`
accepts the common spellings; an unfamiliar one yields a record without that field, never a wrong value). Without credentials the lookup answers
`not_configured` and onboarding falls back to document upload with manual verification. Do not scrape the Parivahan site: it is captcha-protected
and its terms forbid automated access.

Set `VENDOR_PORTAL_URL` so the admin panel can build one-time invitation links.
