# NESAM Travels — customer booking website

A desktop-first, phone-ready website for riders: book a ride, follow it live, see trips, receipts and
notifications, manage the account. It is a Vite + React + TypeScript app that **reuses the customer app's
business logic** (`../app/src`) so a fare, a coupon or a booking can never differ between the app and the site.

```bash
cd user/web
npm install
npm run dev        # http://localhost:8084
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ on :8084
npm test           # unit tests for the web-only logic
```

## What is shared with `../app`

Imported through the `@core` alias (see `vite.config.ts` / `tsconfig.json`), not copied:

| Area | Source |
|---|---|
| Fare engine, categories, coupons, fare adjustment | `app/src/services/pricingService.ts`, `utils/fareBreakup.ts`, `utils/bookingRules.ts` |
| Booking creation, live booking, OTP, cancel, rate, SOS | `app/src/services/rideService.ts` |
| Server transport (callables or HTTP API) | `app/src/services/backend.ts`, `callables.ts` |
| Profile, saved places, notifications, tickets | `app/src/services/userService.ts`, `partnerNotifications.ts` |
| Place search, reverse geocode, routing (Photon / OSRM) | `app/src/services/geoService.ts` |
| Types, constants, formatting, trip presentation | `app/src/types`, `config/constants.ts`, `utils/*` |

Two pieces are tied to native modules and are replaced for the browser at build time:

* `app/src/config/firebase.ts` → `src/platform/firebase.ts` (browser auth persistence, same project and emulator switch)
* `expo-location` → `src/platform/expoLocation.ts` (`navigator.geolocation`)

Everything user-facing (components, pages, styles) lives in `src/` and is web-only.

## Configuration

The site reads the same `EXPO_PUBLIC_*` variables as the app, so one set works for both (see `.env.example`).
With nothing set it talks to the default NESAM Firebase project through Firebase callables.

* `EXPO_PUBLIC_API_URL` — use the Vercel HTTP API instead of callables.
* `VITE_MAP_TILE_URL` / `VITE_MAP_ATTRIBUTION` — map tiles. The default is the public OpenStreetMap tile server,
  which is fine for light use; point this at a commercial or self-hosted tile service for production traffic.
* Phone sign-in needs the site's domain under **Firebase console › Authentication › Settings › Authorized domains**.

## Design system

A premium chauffeur-travel look: deep ink, NESAM red for action, warm paper surfaces, a restrained champagne accent.
Every page runs edge to edge (fluid gutter, no fixed narrow column).

* Tokens: `src/styles/tokens.css`. Components: `ui.css`. App frame, header, footer, page heads: `shell.css`.
  Booking home (hero, console, content bands): `home.css`. Booking workspace and live ride (panel + map): `booking.css`.
  Account, trips, notifications, offers, support, legal, sign-in: `pages.css`.
* Layout: the hero carries a full-width booking console; choosing a ride, reviewing and following a ride use a
  `Workspace` (scrolling panel + route map filling the rest of the screen, stacked on phones).
* Editorial content (routes, destinations, services, FAQs) lives in `src/pages/book/content.ts`. It contains no prices,
  ratings or reviews: fares always come from the booking server.
* Icons: the NESAM icon set (`src/assets/icons`), rendered by `components/Icon.tsx`.
* Images: `public/website-images/web/**` (WebP: heroes, photography, destinations, features, backgrounds, illustrations),
  `public/vehicles`, `public/art`, `public/brand`. Note `public/website-images` also holds the PNG masters and preview
  sheets; keep them out of `public/` for production deploys.
* Font: Plus Jakarta Sans (variable, self-hosted through `@fontsource-variable`; the CSP allows no third-party fonts).

## Routes

`/book` → `/book/ride` → `/book/confirm` (draft kept for the tab), `/ride/:id` and `/trips/:id` (live ride, receipt,
rating), `/trips`, `/notifications`, `/account`, `/account/edit`, `/account/places`, `/account/payments`, `/offers`,
`/support`, `/legal`.

## Hosting

`vercel.json` mirrors the app's headers and CSP and rewrites every path to `index.html`. The build imports
`../app/src`, so the Vercel project must be allowed to include files outside its root directory
(Project Settings › General › "Include files outside the Root Directory in the Build Step").

## Limits worth knowing

* No pre-booking ETA or driver availability is shown: the platform has no such data source for customers.
* Background web push is not set up (it needs an FCM web key and service worker); new notifications appear as
  in-page toasts while the tab is open.
* Payment is recorded as Cash or UPI to the driver — the booking server supports nothing else, so nothing else is offered.
