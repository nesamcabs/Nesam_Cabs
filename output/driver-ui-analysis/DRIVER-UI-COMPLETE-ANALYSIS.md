# NESAM driver reference — complete source analysis and implementation specification

Analyzed 19 October 2026. Reference: `Nesam_Driver_App_UX_Updated.html`, 688 physical lines, 576,633 bytes. SHA-256: `3757dab48cfcb79fd10c12737e9469756f17f47fc19a99312b4f48799b63b0a1`.

## Scope and evidence

The complete HTML, CSS and JavaScript source was read from beginning to end. The two enormous logo lines contain the same embedded JPEG, rather than hundreds of kilobytes of additional behavior. Both images were decoded, their hashes compared, and the logo inspected. The embedded wordmark font was decoded and preserved. The script was parsed with the installed TypeScript parser: zero syntax diagnostics, 84 named function declarations. There are 23 local SVG symbols and 28 literal `data-action` values; dynamic actions, forms, navigation, links and sliders add further interactions.

This is a source-complete analysis, not a claim that every interaction was executed. The browser tool blocked opening the local file URL, so no rendered browser screenshots or device checks were obtained. No alternate browser route was used to bypass that restriction. Pixel matching, native font metrics, camera permissions and gesture behavior still require rendered/device verification during implementation.

Only analysis artifacts were created in this folder. Driver app/web source, services and production data were not changed. Pre-existing driver registration/KYC edits were observed and left untouched.

Supporting files:

- `reference-numbered.txt`: every original source line, with binary data represented by decoded size and hash.
- `LINE-COVERAGE.md`: an index covering all 688 original lines.
- `FUNCTION-INDEX.md`: all 84 named functions with original start/end lines.
- `inventory.json`: action names, symbols, embedded payloads and media queries.
- `structure.json`: function structure, references, variable declarations and syntax diagnostics.
- `embedded-logo-2.jpeg` / `embedded-logo-3.jpeg`: identical source logos.
- `embedded-wordmark.woff`: original embedded wordmark font.

## 1. Top-to-bottom source map

| Original lines | Contents and interpretation |
|---|---|
| 1–8 | HTML5 document; English language; UTF-8; safe-area viewport; theme color; prototype description and title |
| 9–23 | Initial global tokens, reset, shell, sidebar, header, dashboard cards, earnings/wallet/profile, dialogs, toast, initial responsive and print rules |
| 25–122 | Trip-specific tokens and component styling, progress, route, sliders, OTP, fields, bills, review and completion styles |
| 125–131 | Integration into the shared shell, initial trip-width adjustment, mobile headings, print behavior and mobile text-size amendments |
| 132–160 | Final-distance form, large KM input, separate-charge note, cash collection card and settlement note |
| 162–215 | Header online switch, trip photo checklist, camera preview, capture states, paid styles and mobile amendments |
| 217–239 | Customer privacy card: masked/unlocked identity, phone, call button and unlock notice |
| 241–327 | Later global palette override, compact trip-card restyling, cancellation forms/policy styles and responsive overrides |
| 329–342 | Final top-of-trip help toolbar, cancellation choices and office-contact styling |
| 344–356 | Embedded wordmark font and final logo/wordmark sizing; these override earlier brand styling |
| 358–409 | Body shell, skip link, 23 SVG symbols, sidebar, desktop/mobile brand, header actions, main region, footer, bottom navigation, dialog, live toast and noscript message |
| 410–453 | Script setup, fixtures, data helpers, availability and metrics helpers, duty cards, profile, dialogs, support and clipboard/reset helpers |
| 454–504 | Seven-stage flow model, persistence recovery, fare calculation, history, pending settlements and date/icon helpers |
| 505–542 | Navigation, final Home rendering, trip lists, earnings, wallet, accept-duty modal, notifications, rendering and customer privacy |
| 543–581 | Trip-stage panels, completion money display, swipes, OTP and KM forms, edit/close handlers |
| 582–616 | Live camera state, capture workflow, stream cleanup, visibility/page-exit behavior |
| 617–657 | Cancellation quote, reason/request/review states, ledger adjustments and simulated admin response |
| 659–684 | Main click/change handlers, preferences, reset, dialog dismiss/focus restoration and initial render |
| 686–688 | Script/body/document closing |

## 2. Final visual system: preserve the cascade, not just the first CSS block

The initial summary of the file was not specific enough: the final Home does not render the early `metrics()` or `availability()` panels. Likewise, initial colors and sizing are overridden lower in the file. An exact implementation must follow the effective selectors at the target width.

### Colors

| Use | Effective value | Source |
|---|---|---|
| Main action red | `#d82035` | Root override, line 241 |
| Main soft red | `#fff0f2` | Root override, line 241 |
| Main ink | `#171b24` | Root override |
| Main muted text | `#6f7785` | Root override |
| Main border | `#e7eaf0` | Root override |
| Page background | `#f6f7f9` | Root override |
| White panels | `#fff` | Initial root |
| Main positive | `#167a50` / `#e9f7ef` | Initial root |
| Main warning | `#946000` / `#fff5de` | Initial root |
| Hover red | `#b81c2a` | Initial root |
| Trip action red | `#d92535` / `#fff0f1` | Local trip variables, line 25 |
| Trip ink/muted | `#1c1d24` / `#747c89` | Local trip variables |
| Trip positive | `#187c51` / `#eaf7ef` | Local trip variables |
| Wordmark red | `#e43d32` | `.nesam-brand`, line 346 |

Do not accidentally unify all three reds if reproducing this reference exactly. The page theme-color remains the original `#D92535`; it does not automatically follow the later CSS root value.

### Typography and branding

- Body uses the OS/system stack: `-apple-system`, BlinkMacSystemFont, Segoe UI, Arial, sans-serif. Default 14 px, 1.5 line height; later body letter-spacing is −0.08 px. This reference does not use Poppins for body text.
- Headings and values use strong weights, often 650–780. Actual font-weight rendering depends on platform/font availability.
- Main desktop H1 starts at 27 px. Mobile secondary page heading is 22 px. Route title is 23 px.
- Final NESAM wordmark uses the embedded `NESAM Wordmark` WOFF, weight 900; desktop 24 px, mobile ≤700 px 23 px, ≤360 px 22 px. Its letter-spacing is also reduced by width.
- DRIVER product label uses Arial, 9 px, weight 700, letter-spacing 3.3 px desktop, 3 px mobile, 2.8 px narrow mobile. The earlier decorative dash is explicitly removed.
- Final emblem wrapper is 44×44 px, 40×40 px at ≤360 px. Its image is enlarged to 127.45% with negative offsets to crop the white margins. A simple uncropped 44 px `<Image>` will look different.
- The same 159,691-byte JPEG occurs twice. Extract and reuse one local asset; do not duplicate base64 payloads in production code.
- Native font loading must preserve the wordmark appearance. If native tooling requires another font container, derive it from the supplied font rather than substituting an unrelated display font, and verify actual glyph rendering.

### Shapes, spacing and controls

- Most final panels have 16 px corners, 1 px borders and a restrained `0 3px 14px #16203305` shadow. Duty cards use 15 px; form controls generally 9–14 px.
- Desktop shell max width is 1600 px, centered. Sidebar is sticky and full viewport height.
- Route pickup uses a hollow red circle; destination uses a filled dark square; dashed vertical connector between them.
- Primary buttons are solid red, secondary buttons white/bordered, soft buttons pale red. Disabled controls retain their layout and reduce opacity.
- General primary button minimum height is 44 px; compact next-trip CTA is 46 px. Camera actions 46 px; final closing actions 49 px. Some secondary controls are smaller; do not assume every target meets a 44 px minimum.
- Online status is a green pill with dot and mini switch; offline is grey. Header switch height is 40 px; its internal toggle is 26×16 px.
- Cash collection amount is 43 px, 38 px on narrow devices; KM input is 36 px within an 82 px-tall control. OTP input is 31 px, centered with 12 px letter-spacing.

## 3. Shell, navigation and responsive behavior

### Desktop

- Left rail contains logo/wordmark, YOUR WORKSPACE caption, Home, My Trips, Earnings, Wallet and Profile.
- My Trips navigation badge shows active assigned-duty count, not completed count.
- Lower sidebar has support card and a small sample driver identity.
- Main header shows page title/subtitle on widths ≥701 px, online/offline control and notification bell. The support header button is hidden by a later selector; sidebar support remains accessible.
- Calendar/date markup exists and is updated, but the date tag is hidden by the final relevant styling.
- Footer shows the company legal name and, on larger layouts, “Made for every mile.”

### Mobile

- Sidebar disappears at ≤700 px. White full-width header contains branded emblem/wordmark, online toggle and bell.
- Mobile header minimum height 74 px, falling to 69 px at ≤360 px.
- Fixed bottom navigation has five items: Home, My Trips, Earnings, Wallet, Profile. Active icon/text is red with a small top marker. Trip count is hidden in mobile navigation.
- Main workspace final padding is 15 px top, 17 px sides and 98 px bottom. ≤360 px side padding is 13 px. Bottom nav adds the safe-area inset.
- Non-Home list/financial/profile pages receive an extra mobile page heading. Trip/camera pages provide their own heading.
- Home stacks next/current trip before available duties. Trip lists and available-duty cards become one column.
- Toast is centered above the bottom navigation and safe area.

### Breakpoints and cascade details

| Width / mode | Reference behavior |
|---|---|
| ≥1450 px | Wider workspace side padding and larger initial card spacing; later rules still override individual properties |
| 1131–1449 px | Standard 226 px sidebar and desktop content |
| 901–1130 px | Sidebar shrinks to 190 px; tighter workspace/card spacing |
| 701–900 px | Sidebar shrinks to 80 px; navigation labels/counts/support/profile text hidden; two-column auxiliary pages become one column |
| ≤700 px | Mobile header and bottom nav; sidebar hidden; mobile stacks/padding |
| ≤360 px | Narrow-phone spacing, emblem and type reductions |
| Reduced motion | Animation/transition/scroll animation disabled |
| Print | Sidebar, navigation, headers/actions, footer and trip controls hidden; white printable content |

Important static cascade risks to check visually:

1. The 701–900 px rule initially requests a single-column dashboard, but the later `.dashboard-grid` rule on line 257 sets two columns again. Only ≤700 px switches the container to flex stacking. A faithful port must consciously resolve this actual source behavior; do not describe the earlier tablet rule as the final one.
2. Tablet hiding uses `.brand-copy`, while final markup uses `.nesam-brand-text`. The full wordmark may therefore overflow the compact 80 px sidebar. This is a source-identified risk, not a screenshot-confirmed defect.
3. The header/title elements are hidden and redisplayed by different selectors. Do not retain both mobile brand and desktop page heading accidentally.
4. Trip container starts at 650 px, then finishes with max-width 540 px. Its final mobile width behavior must follow the combined max-width and containing-width constraints.
5. Wordmark, CTA and microcopy text metrics require Android/iOS comparison; CSS flex/grid values are not drop-in React Native styles.

## 4. Home — exact final content

Source: lines 516–517, using helpers 436–445.

The final Home renders a two-part dashboard: next/current trip on the left, available duties on the right. It does **not** call the earlier driver-strip/availability or four-metric-card helpers. Avoid adding those cards above this dashboard in a supposed exact reproduction.

### Next/current trip

- Section changes between “Your next trip” and “Your current trip”.
- My Trips link shows active assignment count.
- Date is Today/Tomorrow plus date, or an absolute date; time is large.
- Badge is Confirmed, current flow label, or Cancellation under review. Green/red/amber distinguishes state.
- Pickup/drop route stack shows cities and addresses.
- Facts: Sedan, estimated kilometres and One way trip type.
- Payout row says Driver payout and Driver allowance included.
- CTA selection: View request for pending cancellation; Continue trip for a started duty; Start Trip once its scheduled start is reached; otherwise View Trip.
- With no active assigned duty, show completion/history empty state and link to completed or cancelled history.

### Available duties

- Header count, “Duties eligible for your Sedan”, date selector.
- Prototype dates are All dates / 19 Oct / 20 Oct / 21 Oct. Production dates must come from actual offered duties.
- Card: date/time, trip-type badge, route, vehicle category, route kilometres, pickup distance, optional schedule-conflict note, payout and View details.
- Conflict checks use actual interval overlap (`start < other.end && end > other.start`); touching endpoints are not an overlap in the prototype.
- Offline state replaces the list with “You’re taking a break” and Go online, while assigned trips remain accessible.
- Empty filtered date and globally empty list have different copy and Refresh duties action.
- Refresh only resets the local filter and rerenders sample data. It is not a network refresh.
- Available list excludes assigned/expired duties. It can still display a future overlapping duty with a warning; acceptance is disabled/rejected.

### Available-duty modal

- Duty ID eyebrow, Available duty title, highlighted base payout and allowance note.
- Full route, pickup date/time, estimated end time, category and estimated KM.
- Separate toll/parking/state-tax note and optional conflict warning.
- Accept duty button disabled offline or with overlap; text reflects the reason.
- Acceptance rechecks availability and overlap, assigns locally, saves acceptance time, closes dialog and shows toast.
- Cancellation-policy summary and View policy link remain accessible.

## 5. My Trips

Source: 518–520.

- Upcoming, Completed and Cancelled pill buttons, each with count and active styling.
- Upcoming uses the same compact next-trip cards as Home; no upcoming trips offers Browse duties.
- Completed combines newly closed pending-settlement trips and fixed previously settled fixtures. Each card shows date, status, route, trip ID, payout/credited earnings and Trip summary or View receipt.
- Cancelled shows admin-approved cancellations only, route, ID, final cancellation charge and View details. Pending/declined cancellation requests remain assigned; they do not immediately move to Cancelled.
- Completed fixtures mean this particular prototype has no genuinely empty completed history at initial load.
- Footnote: duty changes and cancellation requests are reviewed by NESAM.
- Trip-detail and camera pages keep My Trips active in primary navigation.

## 6. Seven-stage trip flow

Source: 455 and 543–581.

| Stage | Name | Screen / actions | Gate / result |
|---|---|---|---|
| 0 | Confirmed | Before you start; pickup summary; two photo rows; Take photo/Retake; Slide to Start Trip | Scheduled time reached, no other started duty, no pending/approved cancellation, both in-memory photos captured |
| 1 | Heading to pickup | On the way to pickup; arrival card; Slide to Mark Reached; navigation-to-pickup card | Prototype pickup distance ≤3 km |
| 2 | Boarding OTP | Shield icon, four-digit field, Verify & Continue, inline error | Four numeric digits and prototype code 2468 |
| 3 | On trip | OTP verified strip, destination, Navigate to Drop, boarding GPS label, distance estimate, Slide to End Trip | Verified boarding OTP |
| 4 | Closing trip | Actual pickup-to-drop running KM input; extra-charge note; Review & Close | Positive distance ≤10,000, one decimal precision, valid form |
| 5 | Review closing | Total running KM, booked coverage, optional extra distance, payment badge; Confirm & Close / Edit kilometres | Valid bill and stage |
| 6 | Completed | Success, cash balance/Pending, payment status, distance, refund warning if applicable, settlement note, Back to My Trips | Receipt is local demo completion; payout remains pending |

### Persistent trip shell

- Top toolbar: My Trips back button and state-sensitive help button.
- Trip ID/type, route, date/time.
- Four-part progress line: Start → Pickup → On trip → Close. Stages 1/2 share Pickup, stages 4/5 share Close; all segments become done at completion.
- Customer privacy panel before the stage content, except after completion/cancellation.
- Pending cancellation replaces normal stage content; declined request displays a separate status card while the duty remains usable under normal guards.

### Swipes, keyboard and validation

- Slider range 0–100, step 1. Commit threshold is ≥96 on release/change.
- Pointer must start within the first 60 px of the slider; clicking near the far end is prevented/reset.
- Incomplete pointer gestures and pointer cancellation reset the knob.
- Knob movement is `calc(value% + (4 − 0.56 × value)px)`; label opacity decreases to a floor of 0.15.
- Screen-reader value reports percent or Release to confirm. Help text permits keyboard focus then End; keyboard changes can trigger confirmation without a pointer gesture.
- Completion guard prevents repeated successful action per slider instance. Production must still preserve server idempotency/loading handling.
- OTP strips non-digits, caps at four, disables Verify until length four and clears the prior error when edited.
- KM edits persist only at stage 4. Form errors clear on editing. Invalid values prevent moving to review.
- Editing from review returns to the KM form; confirming closes only from stage 5 with a valid bill.
- Entering OTP stage focuses the OTP field; entering closing stage focuses KM.
- Navigation opens Google Maps in a new tab with destination address and driving mode. It does not implement live tracking inside the prototype.

## 7. Live camera — every state

Source: 583–616; CSS 180–209.

- Exactly two checklist slots: Live selfie, then Car front photo. Front capture is disabled until selfie is saved.
- Each slot has 49 px preview, step label, title, hint, Take photo/Retake action and green captured feedback. Narrow view reduces thumbnail size.
- Camera screen has back link, Step 1/2 of 2, Live camera/Captured live badge, task title and instructions.
- Selfie frame is 4:5 with oval guide; car frame is 4:3 with rectangular guide. Live selfie video is mirrored, but captured canvas data is not explicitly mirrored; verify expected preview consistency.
- While opening: permission message, disabled capture and “Opening camera…” control.
- `getUserMedia` requests video only, ideal front camera for selfie/rear camera for car, ideal 1280×960.
- Capture enables only once a live track and loaded, playable video dimensions exist.
- Captured image view offers Use selfie & continue / Use car photo and Retake live photo. Saving selfie automatically opens car capture; saving car returns to trip checks.
- Capture uses a canvas, scales only down to max 960 px width, exports JPEG quality 0.82, checks nonempty data and associates kind/time/duty ID.
- Guard rejects stale camera responses using generation token and current duty/page. Late streams are stopped rather than attached to another screen.
- Back/navigation, replacement stream, track ending, hidden tab and page exit stop camera tracks.
- Errors distinguish insecure/unavailable context, blocked permission, no camera, busy camera, stream stopped and capture failure. Retry remains accessible.
- No gallery upload, no audio, no backend upload. Photos live in an in-memory Map; only timestamps persist.
- Refresh loses actual photo data. Restored later stages can rely on saved timestamps, while restored stage 0 requires fresh in-memory photos. This is demo behavior, not server-accepted verification evidence.

Production UI must preserve the same visual camera/checklist treatment for all existing required photo slots. Current native verification requires selfie, front, rear, interior and starting odometer with server session/challenge/upload/finalization. Reducing it to the prototype's two slots would remove existing functionality.

## 8. Customer contact privacy

Source: 534–542, matching the existing eight-hour concept in `functions/src/contacts.ts`.

- Only currently assigned, not-completed/not-cancelled duties receive the panel.
- Unlock instant is scheduled pickup minus eight hours, inclusive.
- Locked: Private badge, masked name/phone, disabled Call and exact unlock date/time notice.
- Unlocked: Available badge, name, formatted Indian phone, enabled tel link and eight-hour policy note.
- The markup intentionally does not place unmasked contact values in hidden fields or links when locked.
- Fixtures still contain fictional customer names/zero phone values; production data must be withheld server-side, not merely visually masked.
- Pending cancellation retains assigned contact rules until admin decision. Approved cancellation/completion removes the panel.

## 9. Fare, closing and collection semantics

Source: calculateTrip 460–469 and receipt views 556–562.

### Prototype calculation

- Booked coverage from duty KM, booked fare from fixture; if missing, fallback is `KM × ₹15 + ₹500`.
- Default extra-KM rate ₹15; default extra-KM GST 5%. These are demo assumptions, not approved production tariffs.
- Booked fare is treated as already GST-inclusive. Extra charge uses excess distance only; GST is added to that extra base.
- Distance precision is tenths; monetary calculations use integer paise and explicit rounding.
- Actual distance below booked coverage does not reduce booked fare in this prototype.
- Online amount is deducted only when its verification flag is true; confirmed advance is deducted separately.
- Any positive unverified online amount makes collection Pending rather than suggesting a potentially wrong cash amount.
- Cash due is max(total − confirmed payments, 0); overpayment becomes a refund-review amount rather than negative cash collection.
- Validation rejects nonfinite, nonpositive/out-of-range distance, excess decimal precision, invalid coverage and negative money/rates.

### What is visibly displayed

- Closing form shows KM and separate-charge note, not a full live bill breakdown.
- Review shows distance/coverage/extra distance and paid/advance badge. It explicitly withholds the final cash amount until after close.
- Completion shows Cash to collect, zero-due green card, or Pending; verified full/part online payment or advance badge; extra KM; optional refund warning; admin-settlement note.
- Toll, parking and state tax are said to be extra and collected separately against receipts. These are excluded from the prototype's collection amount.
- Closing a trip does not mark payment received, credit wallet or approve settlement.
- There is print CSS but no explicit Print/Download receipt button in the final rendered receipt.

Preserve existing production fare rules and receipt uploads. Current TripScreen has toll/parking evidence and explicit payment recording/reference fields; the reference's minimal close screen must not make those functions disappear. Do not introduce the prototype's fallback rates or automatically mark real payments verified.

## 10. Earnings

Source: 521 and 446.

- Today and Last 7 days toggle; weekly initially selected.
- Approved earnings card, date range, Approved badge and large total.
- Weekly chart has seven bars, current-day red and other days pale red, date labels and an accessible data summary.
- Weekly fixture total is ₹10,850; Today is hardcoded ₹0 for the fixed demo date.
- Pending settlement card shows count and total quoted base payout, warns collections need verification and links to Wallet.
- Last approved trip earnings section shows the two settled fixture records with route/date/green credit.
- The unused early `metrics()` helper instead says Today's earnings ₹3,250 / two completed trips. Do not accidentally display this stale alternative on the final Home.
- Pending closed trips remain outside approved earnings. Native/web production must derive approved/pending values from the existing ledger.

## 11. Wallet and settlement

Source: 522, 651–655 and 672–673.

- Dark balance card: Approved wallet balance, large amount, red View balance breakdown button, settlement/adjustment note.
- Two small summary cards: Base payouts under review and Completed trips pending.
- Cash balances awaiting verification notice.
- Pending trip settlements list, route/base payout and Trip summary; empty copy when none; Get settlement help button.
- Last approved credits list remains separate from pending payouts.
- Cancellation reviews appear when requests exist, distinguishing under review, declined, approved charge and waived charge.
- Balance breakdown dialog starts at ₹1,600 opening + ₹3,250 approved trips − approved cancellation penalties = fixture balance initially ₹4,850.
- Previously settled receipt dialog shows payout credited, route, time, Completed/settled and credit destination Driver wallet.
- No actual payout request/withdraw form exists in this reference, whereas production has it. Retain the existing payout functionality styled to match, rather than replacing it with a balance-only page.

## 12. Profile and documents

Source: 447.

- Profile overview: circular initials avatar, name, Single vehicle owner / driver, green verified badge.
- Rows: vehicle model, registration number, category, pickup zone.
- Preferences card: Duty notifications switch, cancellation-policy link, demo/reset note.
- Document verification card: heading, sample status, All approved badge; seven rows: licence, RC, insurance, fitness certificate, permit, vehicle photos, driver selfie.
- Each row has document icon and green Verified badge. Contact office note for updates.
- These are fixed sample statuses. Existing document expiry/rejection/resubmission, profile/contact/bank editing and sign-out must remain functional even though the prototype omits their controls.

## 13. Notifications, support, dialogs and feedback

- Bell initially has a red unread dot; opening it marks all prototype updates read, persists and removes the dot.
- Notifications are a dialog, not one of the five navigation pages. It contains next-trip action, pending-settlement summary and sample verification notice, then Done.
- Notification preference persists and changes toast text; it does not configure a push provider or suppress incoming backend events.
- Support dialog has office-help description, 90250 99990 and a tel link. Actual production contact constants remain authoritative.
- Pickup-address dialog and clipboard helper exist; clipboard requires a secure context and falls back to a selectable readonly field. The final live template does not emit a pickup-address action, so this path is not visibly exposed by current markup.
- Dialog max width 460 px (viewport minus 30 px), maximum height 88vh/88dvh, scrollable body, fixed header/footer structure and blurred dark backdrop.
- Open dialog saves trigger element. Close button, native dialog dismissal and outside-backdrop click close it. Close restores focus to trigger if still present, otherwise main.
- Toast is role=status, aria-live=polite and atomic; auto-hides after 3.4 seconds.
- Page navigation resets scroll and focuses main without additional scrolling. Screen-enter effect is 0.2 seconds and respects reduced-motion preference.

## 14. Help and cancellation — all branches

Source: 618–657.

### Entry states

- Confirmed, no request: Help / Request Cancellation.
- Pending review: Request help.
- Started duty: Trip help / Call office.
- Completed: help entry removed.
- Before start, help dialog offers Request cancellation, process explanation, policy and office call.
- Once duty has started, request action is absent; office must handle changes.
- Declined request cannot be resubmitted through the same prototype flow; office contact is offered.

### Quoted policy (reference only)

| Timing at request submission | Potential charge |
|---|---|
| Pickup in four hours or less | ₹1,000; this takes priority |
| Pickup more than four hours away, request within four hours of acceptance | ₹0 |
| Pickup more than four hours away, request after acceptance grace | ₹500 |

Quote includes request, pickup and acceptance timestamps; invalid ordering prevents a quote. Admin review time does not increase the quoted penalty. Valid reasons may be waived by admin; selecting a reason is not an automatic waiver.

### Request form

- Highlighted potential-charge box and timing explanation.
- Reason select: Vehicle breakdown, Health issue, Personal emergency, Other reason.
- What happened textarea: required, at least 10 trimmed characters, maximum 500.
- Clear admin-approval explanation, inline error, Send Request, collapsible policy, office call.
- Submit rechecks assignment/stage/prior request, reason, details and current quote.
- If the timing window changed the quote, the value is updated and another review/submission is required.
- Success stores a pending request, closes dialog, opens the duty and shows Request sent toast. Assignment remains; no wallet debit yet.

### Decision states

- Pending: review badge, reason/request time/potential penalty, no-deduction note, office call; normal trip content is suppressed.
- Declined: assigned duty remains, no charge deducted, admin reason and support; normal actions may resume under the existing guards.
- Approved with charge: trip becomes Cancelled; final penalty affects sample balance and cancellation ledger.
- Approved with waiver: trip Cancelled, zero charge, explicit approved/waived copy.
- `applyAdminCancellationUpdate()` simulates approve/apply/waive/decline but no driver control calls it. It is not a backend integration or an authorization boundary.

These policies must be cross-checked against the approved production configuration. The user requested a UI change, not replacement of business rules with prototype literals.

## 15. Complete interaction inventory

### Literal action controls

| Action | UI / effect |
|---|---|
| accept-duty | Accept available duty after checks |
| view-duty | Open offered duty details or existing assigned trip |
| flow-open | Open assigned trip |
| flow-receipt | Open closed trip summary |
| flow-edit | Return from close review to distance entry |
| flow-close | Confirm valid stage-5 completion |
| trip-tab | Switch Upcoming / Completed / Cancelled |
| earnings-period | Today / Last 7 days |
| today-earnings | Go to Today earnings; emitted only by unused metrics helper |
| toggle-online | Flip sample presence; retain assignments |
| notifications | Mark read and open updates dialog |
| toggle-notifications | Persist sample notification preference |
| support | Open office-support dialog |
| wallet-breakdown | Show sample opening/credits/penalties/current balance |
| trip-help | Stage-sensitive help dialog |
| cancellation-policy | Open charge/waiver policy |
| cancel-request-open | Open cancellation form |
| camera-open | Open specific checklist camera |
| camera-retry | Retry camera permission/opening |
| camera-retake | Replace captured photo with fresh camera |
| camera-capture | Capture available live frame |
| camera-use | Save current capture to its duty/slot |
| camera-back | Stop stream and return to trip checks |
| copy-address | Clipboard with manual fallback; currently behind unexposed pickup helper |
| refresh | Reset date filter and sample-list view |
| reset | Open reset confirmation |
| confirm-reset | Clear all demo state and return Home |
| close-dialog | Dismiss dialog and restore focus |

### Additional actions not counted in the 28 literal values

- Dynamic `settlement`: settled fixture receipt button.
- Handler-only `pickup-address`: no emitting button in the final templates.
- Five `data-page` navigation targets, plus completed/cancelled tab shortcuts.
- Three slider actions: begin / reach / end.
- OTP form submit and KM-close form submit.
- Cancellation form submit.
- Date select change and KM/OTP input events.
- Google Maps navigation links, customer tel link, office tel links.
- Dialog Escape/native close and outside click; preference and focus restoration.
- Visibility/pagehide camera cleanup and slider pointer/keyboard cancellation.

## 16. State and persistence

- Storage key: `nesam-driver-complete-ux-v6`.
- Persistent fields: presence, assigned fixture IDs, read/preference flags, per-duty flow and fixed demo clock.
- Nonpersistent view state: active page, trip tab, duty date filter, earnings period, active trip ID and dialog trigger.
- Photos/streams remain in-memory; reset clears them.
- Fresh clock: 19 Oct 2026 08:00 IST. It is not a live ticking clock.
- Starting passenger stage advances it to at least pickup +10 minutes; entering closing advances it to scheduled end.
- Restored clock is bounded through 23 Oct 2026. Future sample duties will not unlock merely because real wall-clock time passes.
- Assigned IDs are validated/deduplicated and the original first assignment is always restored.
- Stages limited to 0–6; absent photo timestamps downgrade progressed flow; absent OTP downgrades ≥3 to OTP stage; invalid bill downgrades ≥5 to KM entry.
- Restoration allows at most one started active duty. Stored cancellation objects are whitelisted and bounded; invalid approved charges become pending.
- `persist()` tolerates unavailable localStorage. This resilience does not make local state authoritative for production financial or trip actions.

## 17. Existing feature preservation map

Production entry points inspected: `driver/app/App.tsx`, native MainNavigator, HomeScreen, TripScreen, PreTripScreen, ProfileScreen, verification service; `driver/web/src/App.tsx`, DriverWorkspace, BottomNav, wallet screen and supporting references.

| Existing capability | How to retain it in this visual design |
|---|---|
| Auth / OTP / registration / account states | Extend the same typography/panel/action language to screens absent from this reference |
| Legal gate and document updates | Keep routes and handlers; restyle their existing controls |
| Independent versus fleet-driver permissions | Filter navigation/features according to existing vendor ownership; do not show financial/marketplace panels simply because prototype has them |
| Marketplace eligibility, accept/bid behavior where exposed | Keep real subscriptions, category checks and server decisions behind duty cards |
| Pre-trip four-slot evidence and odometer | Add matching checklist rows without reducing required evidence |
| Real navigation, GPS and customer location sharing | Use current platform/services; demo pickup distance and GPS labels must not replace actual fixes |
| Server boarding OTP and separate trip transition | Keep existing verification/start gates; prototype's automatic stage jump must not bypass them |
| Tolls/parking receipts and payment recording | Retain matching expandable section/actions in close/receipt flow |
| Payout requests and bank/UPI data | Keep existing supported financial workflows, styled inside Wallet/Profile |
| Contact privacy | Keep existing server contact endpoint/window and ownership checks |
| SOS | Keep existing emergency action reachable; prototype office support alone is not equivalent |
| Penalties: acknowledge/dispute and blocking modal | Retain existing overlay and backend actions |
| Notification popups, tones, deep links and read state | Preserve delivery and navigation; visual bell/dialog is only presentation |
| Error, loading, retry, empty/offline and permission states | Map to same cards/alerts; do not remove them for cleaner screenshots |
| Logout / profile and bank editing / document expiry | Preserve controls even though the static profile omits them |
| Active trip restoration after restart | Keep production navigation/session restoration rather than prototype default-Home behavior |

Visual match is exact for matching reference elements, while preserved production-only features receive the same visual language. Silently deleting those features would violate the requested scope. Do not replace the native app with a WebView of the demo.

## 18. Implementation acceptance checklist

This is a checklist for later implementation, not a record of completed tests.

1. Compare Home, My Trips (three tabs), Earnings (two periods), Wallet, Profile and Notifications against the reference at 320, 360, 390, 414, 700, 701, 900, 901, 1130, 1131, 1440, 1450 and 1600 px.
2. Verify final palette, wordmark font/crop, panel corners, border/shadow, CTA height, route markers and content order; exclude inactive metrics/driver-strip components.
3. Check native Android/iOS equivalent layouts, safe areas, font rendering, large-text behavior, keyboard and bottom navigation.
4. Check independent/fleet role differences and preserved legacy features.
5. Verify duties loading/empty/offline/date-filter/conflict/accept-failure states using real supported data.
6. Verify all seven reference stage presentations against actual allowed server transitions; confirm idempotency, busy states and retry handling.
7. Verify pointer, touch, keyboard and accessibility confirmation; no accidental click-to-complete or duplicate trip writes.
8. Verify every required camera slot, denied/busy/missing camera, retake, page leave/background and resume. Confirm backend evidence and odometer gates remain enforced.
9. Verify customer contact just before/at unlock, completed/cancelled duty privacy and server denial behavior.
10. Verify KM validation, booked minimums, extra distance, approved taxes, toll evidence, confirmed/unconfirmed payments, zero due, overpayment and pending settlement against backend results.
11. Verify cancellation policy/quote source, validation, changed quote, pending, decline, waive, charge, and post-start office-only UI without changing approved backend behavior.
12. Verify wallet payouts, penalties/disputes, profile/bank editing, auth/legal/document states, SOS, notification deep links and account restrictions remain reachable.
13. Verify responsive dialog scroll, close/focus restoration, toast safe area, reduced motion and printable receipt.
14. Complete a sandbox cross-role trip and compare backend state before/after. Browser source analysis alone is insufficient evidence for release.

## 19. Decision for the next work phase

Use this file as the exact visual reference for driver web and native app. Follow its final cascade and actual rendered-template structure; replace fixture data with the existing data/services. Preserve every production capability listed above. Where the reference demonstrates a different business policy or reduced verification, retain current backend rules and adapt the same visual treatment. No business-rule or production deployment changes were authorized by this analysis request.
