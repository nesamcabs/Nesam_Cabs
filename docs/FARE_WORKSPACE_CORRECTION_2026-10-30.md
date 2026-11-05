# Unified fare workspace correction — 30 October 2026

This corrects the earlier partial arrangement of a scoped rate tab alongside unscoped tools. Changes are local. Tests, builds, browser automation and production changes were not performed, as requested.

## Operator flow

Service & Fare Settings now has one persistent selection:

**Brand → Trip/service → section**

The default is NESAM → One Way, with People Taxi and One Way Car Rentals selectable. Common is explicitly labelled as shared across brands. Round Trip is absent from this workspace's service selector; historical backend identifiers and booking snapshots remain intact.

- **Rates & extra charges:** class-specific customer/partner rates, packages, extra charges and waiting policies use the selected brand/service. Classes remain the existing Sedan/SUV/Innova/Crysta tariff classes.
- **Booking availability / customer cab rules / pricing rules:** new records carry exact brand and service scope. Matching common records remain visible and labelled Common. Brand views cannot edit common records.
- **Route fares & limits:** the cards carry the active brand/service label and open scoped records. The existing fixed-route booking path supports One Way; the route editor is offered there only.
- **Shared catalog:** vehicle-category master names/specifications and fallback fields remain explicitly common rather than pretending to be a brand override.
- **Old entry points:** fare-rules and extra-charges destinations open the unified workspace. The Legacy rate cards tile and separate Base rates/Local fares/Extra charges editors have been removed from the main flow. Their stored records were not deleted or migrated.

## Server connections

- Versioned `saveTariffSection` saves common service overrides or brand service overrides separately in `business_config/tariff_v2.brandOverrides`.
- Resolution: existing baseline → common service/class override → selected brand/service/class override. Common saves no longer rewrite unrelated One Way/Round Trip base fields.
- Pricing resolves minimum distance and airport bases for the category actually being quoted, avoiding another class's scalar setting overwriting it.
- Local Rental package overrides and minimum hours are now validated and persisted by the handler; inherited disabled packages stay disabled. Clearing a field explicitly removes its override instead of silently preserving the old value.
- Customer/partner extra-charge rates and waiting policies resolve the same scope and are included in the existing pricing/private-payout snapshot path. Airport/Rental no longer fall back to an unrelated One Way override. Missing timing/tax policies remain unconfigured and require review rather than being invented.
- Service rules and managed fixed routes store brand/service metadata, validate scope and match it in customer quotes, customer creation and admin creation. Existing unscoped records retain shared compatibility. Conflict detection distinguishes separate scopes.
- Admin fare preview uses the selected brand and restricts service choices. The admin booking handler passes a trusted-staff flag only after its existing admin-record permission/action checks, allowing authorized cross-brand bookings without relying on optional custom token role claims.
- Existing business-contract/fixed-route precedence and finalization of agreed booking snapshots remain in place.

## Shared and historical behavior

The pricing-engine activation switch remains global and is labelled **all brands and services**, available under Common. Existing shared percentage adjustments remain under a clearly labelled Common-only disclosure; brand pricing rules take precedence where they match. Existing broad common rules remain editable under Common without silently narrowing their original service scope.

Existing city pickup/drop fallback configuration and engine on/off behavior are preserved; the outstation per-kilometre editor does not invent a replacement city-pricing policy. Multicity remains the travel-desk enquiry flow. Its quotation settings do not enable automated itinerary checkout or reinterpret Round Trip billing.

## Editing safety and review limits

The rates editor remains mounted when changing sections. Unsaved scope/category changes require discard confirmation; saves pin the version originally loaded. Live tariff updates do not overwrite unsaved edits. Page navigation and new-booking shortcuts guard pending/unsaved rate changes. Inputs and saves respect pricing plus Settings edit access.

Review performed: targeted source reads and diff/caller tracing only. No runtime, type-check, build, automated-test or browser acceptance claim is made. Earlier test results in other audit documents predate this change. Existing structural test expectations that name the former editor owners have not been maintained in this no-testing task.

Deploying the matching admin and backend changes remains pending. The pre-existing unrelated People Taxi MulticityForm edit was left untouched.
