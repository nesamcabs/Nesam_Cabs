# NESAM Driver — UI implementation report

Rebuild of the Driver website (`driver/web`) and the Driver Android app (`driver/app`) to the supplied reference interface, then refined (second pass) for Poppins, fluid layouts, accurate trip-step rules, the reference's own icons, and a full feature-preservation check.

| | |
|---|---|
| Reference | `Nesam_Driver_App_UX_Updated.html`, SHA-256 `3757dab48cfcb79fd10c12737e9469756f17f47fc19a99312b4f48799b63b0a1` |
| Targets | `driver/web` (React 19, Tailwind 4, Vite) · `driver/app` (Expo 57, React Native 0.86 — native screens, no WebView) |
| Not done, on purpose | No deploy, publish, push or commit. No change to Firebase rules, functions source, env files or other apps. |

Reference rule used throughout: the HTML decides structure, hierarchy and interaction presentation; the second-pass requirements (Poppins, no wasted side space, responsive) win over its font and fixed widths. Reference defects were fixed, not copied.

---

## 1. Verdict first — what is verified and what is not

| Area | Status |
|---|---|
| Website, real app against the Firebase emulators (live data, real callables, real rules) | ✅ **30/30** checks (`driver/web/e2e/driver-journey.e2e.cjs`) |
| Website layout, 12 widths for Home + every screen/state, short/zoom/keyboard | ✅ screenshots + automated audit |
| Backend contract the screens depend on (emulator suites) | ✅ 40 existing + 4 new tests pass |
| Android app — types, lint, 70 tests, Android bundle | ✅ |
| **Android app on a screen** (Poppins, spacing, safe areas, slider feel, camera) | ❌ **not verified — no emulator or device exists on this machine.** Exact device checks are listed in §9. |
| Production integrations (live Firebase project, real SMS, payments, push, Play Integrity) | ❌ not retested; nothing here touched production |

---

## 2. Problems found and their causes

**Website layout (from the first-pass screenshots at 320 / 414 / 1920 px):**

| Symptom | Cause | Fix |
|---|---|---|
| Blank bands left and right on large screens | `.app{max-width:1600px;margin:auto}` | cap removed; workspace fills the space beside the sidebar with `clamp()` gutters (22–52 px) |
| Trip screen a narrow 540 px column in the middle | `.trip-flow{max-width:540px}` | header across the top; working panels beside Customer + Fare panels from 1000 px; one readable column below; forms/sliders capped at 520 px |
| Two cramped ~290 px columns on tablets | the reference's later rule restores two columns at every width above 700 px | stacked below 1000 px; duty/trip cards flow in `auto-fill` grids; Earnings/Wallet/Profile columns are `auto-fit(min 420 px)` |
| Brand clipped by the status pill at 320 px | fixed-width top bar content | the pill drops its word (still announced) below 375 px |
| Long route titles wrap to 3 lines on phones | 23 px title in a wider face | 20 px on phones |
| Sidebar caption wrapped at 901–1130 px | wider face | nowrap + tighter tracking |
| Poppins looked cramped/small | reference sizes and negative tracking were tuned for a system font | negative tracking cut to 35 %; 9–13 px text raised by 1 px (floor 12 px) |
| Pinch-zoom blocked | `maximum-scale=1, user-scalable=no` | removed; `viewport-fit=cover` added |
| Tiny touch targets | preference switch, document links, "Show all duties" | hit areas ≥ 40 px |

**Behaviour bugs found by running the real app against the emulators (all fixed):**

| Bug | Effect | Fix |
|---|---|---|
| Website sent the GPS fix **without a timestamp** (`capturedAt`), which the server treats as stale | **"Reached Pickup" could never succeed from the website** ("Your location is out of date"). This predates the redesign. | `services/location.ts` now sends the reading's time |
| A slider kept its "done" state when the next stage appeared in the same place | after Start Trip, **Slide to End Trip was dead** | each slider has its own `key` (web and app) |
| App slider animated `width` with the native driver | rejected on a real device | slides with `translateX` only; test asserts no native-animated error |
| Client pickup radius hard-coded at 2 km; server default is 3 km and configurable | valid arrivals refused on the phone | app now uses `settings/operations.pickupRadiusKm` (default 3) |
| Bid-only duties (`bid_review`) showed **Accept**, which the server refuses (`bid-only`) | drivers could not take those duties at all; `submitDutyBid` existed but no screen used it | counter-amount form + withdraw on both platforms (server rules unchanged) |

Also found, **not mine and not changed**: `functions/.env` was edited today and now contains `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_STORAGE_BUCKET`. The Firebase CLI refuses keys with the `FIREBASE_` prefix, so **the functions emulator (and a Firebase deploy) will fail to load** until those two lines move elsewhere (they are for the Vercel API). I ran the emulator from a copy of `functions/` without that file.

---

## 3. Poppins

- Bundled locally: website `public/fonts/` (woff2 for 400/500/600/700 × latin, latin-ext, devanagari — ₹ lives in the devanagari file), app `assets/fonts/` (TTF 400/500/600/700). OFL licence text beside each. **No Google Fonts request**: the link and `Inter` are gone from `index.html`.
- Website: `@theme` makes Poppins the Tailwind `sans` **and `mono`** face (plates, references), so the older Tailwind screens (sign-in, registration, legal, popups, penalty modal) follow. Checked in the browser: loaded faces are Poppins 400/500/600/700 + the NESAM wordmark.
- App: `Text`/`TextInput` wrappers (`components/nx/Text.tsx`) map a style's `fontWeight` to the right Poppins family (React Native picks custom fonts by family), reset `fontWeight` so Android does not fake a second bold, keep nested text inheriting, honour an explicit `fontFamily`, cap system font scaling at 1.4× (tab labels 1.15×). A codemod switched all 32 files that used `react-native`'s `Text`/`TextInput`, so registration, auth and legal screens are included; placeholders use the input face. `App.tsx` holds the splash screen until fonts settle, with a 5-second give-up and a system-font fallback; React Navigation's theme fonts are Poppins.
- **Logo artwork kept as supplied**: the emblem image and the embedded NESAM wordmark face (it *is* the logo lettering). The separately rendered "DRIVER" label is Poppins.
- Unavoidable system text: Android/iOS `Alert` dialogs and the date-picker are drawn by the OS.

---

## 4. Responsive behaviour

**Website** — verified at 320, 360, 390, 414, 700, 701, 900, 901, 1000, 1001, 1130, 1131, 1440, 1920 (Home) and 360 / 768 / 1440 (every screen and state).
Automated audit (100 screen × width combinations in headless Edge): **no horizontal overflow, no unnamed control, no unlabelled field, no off-screen control, bottom bar never covers content**; small-target findings fixed. Keyboard walk with real key events: logical tab order, 3 px focus ring on every stop, native modal dialogs keep focus inside (only the browser's own chrome is reachable), Escape closes and returns focus to the opener. Safe-area insets are respected on phones in landscape. Dialogs scroll inside themselves on short screens.

**App** — one column up to 760 dp, two columns from 900 dp (Home, Trip flow, Earnings, Wallet, Profile, My Trips), 1180 dp max; tablet gutters; `SafeAreaView` on all edges; compact top and tab bars in short landscape; keyboard-avoiding scroll; no fixed card widths; fixed-height controls (slider 58, knob 48) hold at 1.4× text. *Not seen on a device — see §9.*

---

## 5. Start-trip rule (the invented three-hour window is gone)

What the server actually enforces (`functions/src/trips.ts`, read, not guessed):
- The **first** driver step, *Reached Pickup*, opens `tripStartWindowMinutes` before the pickup time (`settings/operations`, default 360 min, range 15–4320). Earlier → `too-early` ("can be started from …").
- Also refused: another trip of this driver or vehicle in progress, driver/vehicle not eligible, no fresh accurate GPS fix, outside `pickupRadiusKm` (default 3 km).
- Trip Started needs the boarding OTP and the submitted vehicle photos. Photos can be taken at any time.

What the screens now do:
- Trip cards say **Open trip** / **Continue trip** — opening details and preparing is not starting the journey. "Start Trip" survives only as the slider that records the real start, which unlocks only after OTP + photos.
- Both platforms read `settings/operations` (readable by any signed-in user; the new emulator test confirms drivers cannot write it). Inside the window the arrival slider is live; outside it is disabled with the exact reason ("Marking arrival opens 20 Oct, 01:35 AM IST — 6 hours before the pickup time. You can take the vehicle photos now."). If the settings cannot be read the screen does **not** guess — the server's own message is shown. Verified live: window 120 min → slider disabled for a pickup in 20 h, enabled for 1.5 h.
- Preserved: pickup-distance validation (app pre-check now uses the server radius), integrity retry, OTP lock message, idempotent request ids (a repeated request returns `duplicate: true`).
- Time ticks while the app is open (`useNow`), so a slider unlocks without reopening.

---

## 6. Icons

The reference's **23 SVG symbols** were already ported to the website. The app now draws the **same geometry**: `react-native-svg` (Expo-matched 15.15.4, added with `expo install`; the smallest compatible renderer and the only dependency added) renders paths generated from the website's icon file (`src/components/nx/iconData.ts`, header says how) — 24-unit grid, round caps/joins, 1.8 stroke, identical on both platforms. The Ionicons stand-ins are gone from every screen, including sign-in/registration/account-state/photo fields. Icons are decorative; the control carries the accessible label. **Deviation:** 7 icons the reference lacks (alert, logout, camera, edit, trash, plus, bank) are drawn in the same style. **Needs a native rebuild** (new native module).

---

## 7. Feature-preservation comparison (pre-redesign files in Git `5d7d49d` → new code)

Method: every user-facing string, validation message, service call and handler of each replaced file was extracted from Git and searched for in the new source; every gap was reviewed. Remaining differences are wording only, except those listed as "restored".

| Old | New home | Notes |
|---|---|---|
| web `DashboardScreen` (profile + status, stats, active trip, marketplace) | `HomeScreen` + Shell | Duty switch → top bar; stats **restored** as metric cards (today's earnings, 7-day, completed, rating, wallet, upcoming); accept now via details dialog; category match, show-all, fleet/offline/active/empty states, document-rejected banner, mismatch warning kept; **bid + withdraw added** |
| web `TripExecutionScreen`, `FarePanel` | `TripFlowScreen` | reach, OTP, start, km (validated), tolls + receipt photo + remove, collections (UPI/bank reference rules), end with idempotency key, customer contact reveal (8 h, server), fare/paid/balance/extra lines, fare-line treatment labels and payout + note **restored**, payment mode and step times **restored**, receipt/cancelled states |
| web `Header`, `BottomNav` | `Shell` | navigation, fleet hides Earnings/Wallet, unread dot (count in label), SOS/help on every screen, sign-out in Profile |
| web `VehicleVerificationScreen`, `CameraCapture` | same files, restyled | consent, session → 4 challenges with countdown → upload → submit, retake, odometer, "show or write the code" text **restored** |
| web Earnings / Wallet / Profile / Notifications | same files, restyled | chart, tolls awaiting approval, payout dialog + rules, requests, ledger, edit validation, document expiry badges, sound preference, mark-all-read, penalties tab, **severity colours/"Urgent"/"Warning" restored** |
| web `DriverWorkspace` | same file | all subscriptions, presence sync (On Trip ↔ Online), accept/trip/payout handlers, popups, penalty gate, deep links |
| app `TripScreen` | `TripFlowScreen` | 2 km → server-configured radius check, integrity retry, per-action request ids, OTP, collections, tolls, notes, payout note, fare card; payment mode + "Reached pickup" time restored |
| app `HomeScreen` | `HomeScreen` + top bar + `usePresence` | accept confirmation, device warning, doc-rejected, SOS (police 112 + office), stats **restored**, bid + withdraw added |
| app Earnings / Wallet / Profile / Notifications / PreTrip | same files | min-payout rule, payout dialog, edit validation + account confirmation, camera modal with single-use challenge and expiry, severity colours |
| app `MainNavigator` | same file | tabs, `PreTrip`/`Notifications`/`UpdateDocuments` kept, `TripFlow` added; **active-trip restoration and push/notification deep links open the trip flow** |

Unchanged code paths (verified by diff and by tests): authentication, registration/approval/rejection, legal acceptance, document update/resubmission, penalty acknowledge/dispute, notification tones, location sharing, offline banner. Support number remains the configured **+91 90250 99990**; police 112 added. No cancellation backend or penalty values invented — the Help dialog offers the office call.
Permissions: independent vs fleet (no marketplace, no Earnings/Wallet), customer-contact privacy (masked number until the server reveals it), server-authoritative steps — all as before.

---

## 8. Checks run

| Check | Result |
|---|---|
| `driver/web` typecheck, production build | ✅ (`preview.html` not in `dist`; preview page renders nothing outside the dev server) |
| **Real website vs emulators** (`driver/web/e2e/driver-journey.e2e.cjs`) | ✅ 30/30: sign-in, live data, Poppins loaded, preparation, window closed/open, location denied, far from pickup, offline, retry (one transition), boarding OTP wrong → right, start, end, km/collection/review/receipt, bid refused above fare, bid accepted and stored |
| Emulator suites (`functions`: 3 existing files) | ✅ 40/40 |
| New `driverUiContract.e2e.test.js` (4) | ✅ operating limits readable not writable; first step refused too early with the message shown; duplicate request changes nothing; bid/withdraw payloads, double withdrawal refused; photo session + 4 challenges for the assigned driver only, finish refused without photos |
| `driver/app` `tsc`, `eslint` | ✅ 0 errors (2 older warnings in files not touched) |
| `driver/app` `jest` | ✅ 70 (46 existing + 24 new): every screen mounts, trip stages, arrival gating, bid marking, slider (accessibility action, real drag commit, short drag, wrong start, failure, exception, disabled, no native-animated errors), Poppins mapping/fallback |
| `driver/app` `expo export --platform android` | ✅ Metro + Hermes bundle; fonts, emblem, wordmark resolve |
| Website audit / keyboard walk | ✅ §4 |

Photos: the 4-photo session/challenge/finalize contract is tested on the backend; the in-browser camera capture and upload need a real camera and were not exercised (the E2E marks the check submitted directly).

---

## 9. Remaining verification (cannot be done here)

**Android build first:** rebuild the app (new native module `react-native-svg`; the existing Gradle flow in `driver/app/android` works) and install.
1. Poppins renders in every screen (no fallback face), incl. sign-in, registration, legal and the penalty modal; numbers and ₹ glyph look right.
2. Spacing at 360 × 640, 412 × 915, a 10-inch tablet (portrait + landscape) and a short landscape phone; tab bar compaction.
3. System font scale 1.3 and 1.5: no clipped slider/tab/button labels.
4. Slider feel: slow drag, flick, release at 90 % (springs back), repeated drags, busy state, TalkBack "activate" action.
5. Camera: permission prompt, front/back camera, shutter, single-use code expiry, upload, retake; keyboard over forms (odometer, profile, payout).
6. Gesture navigation / notch safe areas; background → resume lands on the active trip; push tap deep links.
7. Real-device GPS for Reached Pickup (arrival window, radius, permission denied).
iOS is not built for this app; nothing was checked there.

---

## 10. Deviations (cumulative)

| # | Deviation | Why |
|---|---|---|
| 1 | No prototype sample data or fake logic ships | production data only |
| 2 | Trip steps follow the server, not the prototype's local stages; "Slide to End Trip" opens the closing form and **Confirm & Close** makes the Trip End call | server-authoritative order |
| 3 | No driver cancellation request / penalty quote / policy | no backend workflow or approved amounts exist; needs a product decision |
| 4 | Support number is the configured one; police 112 added | existing SOS must not be lost |
| 5 | Header help button visible (reference hides it) | SOS reachable everywhere |
| 6 | Fare, tolls, collections, consent, breakup, photo-check extras added | production features the prototype lacks |
| 7 | 4 photos + odometer (prototype: 2 photos) | the server requires them |
| 8 | Notifications are a page with category filters (web also Penalties tab) | inbox, read state and penalty flows must stay |
| 9 | "Credited / awaiting settlement" wording from the ledger; document rows show Uploaded + expiry | what the system records |
| 10 | Document update opens the existing form (full-screen on web, stack screen in the app) | outside the redesign scope |
| 11 | Home metric cards restored from the old dashboard (above the grid on wide screens, below it on phones) | feature parity |
| 12 | Poppins for all text; logo artwork kept; type floor 12 px, tracking reduced | requested; Poppins is wider |
| 13 | Fluid layout: no 1600 px cap, two-pane trip flow ≥ 1000 px, 760/1180 dp app columns, 1.4× font-scale cap | requested; reference was fixed-width |
| 14 | Extra icons drawn in the reference's style (7) | reference has 23 |
| 15 | CSS fixes to reference defects (dialog centring, input styles, focus ring, narrow rail, tablet columns, targets) | marked `DEVIATION n` in `driver/web/src/styles/reference.css` |
| 16 | Old dead screens removed (web: Dashboard, TripExecution, Header, BottomNav, FarePanel; app: TripScreen) | replaced, no importers |

**Screenshots:** `output/driver-ui-screenshots/` (see its `README.md`; `before/` and `after/` labelled by viewport).
**Files to know:** `driver/web/src/styles/{reference,fonts}.css`, `driver/web/src/components/nx/`, `driver/web/e2e/driver-journey.e2e.cjs`, `driver/app/src/components/nx/`, `driver/app/src/theme/{nx,fonts}.ts`, `driver/app/__tests__/nx-render.test.tsx`, `functions/test/driverUiContract.e2e.test.js`.
