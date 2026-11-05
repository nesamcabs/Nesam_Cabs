# Running the apps as websites

`user/` (Customer), `driver/` and `vendor/` are Expo apps. Each one now builds for
Android, iOS **and the web** from the same source.

## Run locally

```bash
cd user            # or driver / vendor
npm install
npm run web        # dev server: customer :8081, driver :8082, vendor :8083
```

## Build and host

```bash
npm run build:web  # writes ./dist (static files, single-page app)
npm run serve:web  # preview the build locally
```

Production hosting and the server API are on Vercel: see **VERCEL_DEPLOYMENT.md**.

## One-time Firebase setting

Phone sign-in only works on domains listed in **Firebase console › Authentication ›
Settings › Authorized domains**. `localhost` is there by default; add each deployed
domain (e.g. `customer.example.com`).

## How the web build differs from the phone apps

| Area | On the web |
|---|---|
| Layout | Fully responsive (see below): phone, tablet, desktop, landscape. |
| Dialogs / date & time pickers | Replaced by in-page dialogs and the browser's own date/time inputs (`src/platform/`). |
| OTP security check | Firebase's own invisible reCAPTCHA instead of the Android WebView. |
| Maps (customer) | Route card with "Open in Google Maps" links, same as a phone without a Maps key. |
| Receipt PDF | Opens the browser print dialog ("Save as PDF"). |
| Push notifications | In-app popups and tones work while the tab is open. Background push is **not** set up (needs FCM for Web: a VAPID key and a service worker). |
| Device integrity / root checks | Android-only; skipped in the browser. |
| Camera, location | Browser permissions; require HTTPS (or `localhost`). |

Platform-specific code lives in `src/platform/`, `*.web.ts(x)` files and `metro.config.js`
(web-only stand-ins for `jail-monkey`, `@expo/app-integrity` and the date picker).
Android and iOS builds do not load any of it.

## Responsive layout

One model for Android, iOS and the browser (`src/theme/responsive.ts`, `src/components/layout.tsx`):

| Window width | Class | Behaviour |
|---|---|---|
| under 600 | compact | Phone layout: full-width content, bottom tabs, bottom sheets. |
| 600 – 1023 | medium | Tablets / landscape phones: content centred (max 640), icon side rail, centred dialogs, 2-up card lists. |
| 1024 and up | expanded | Desktop / large tablets: labelled side navigation, dashboards up to 1040, 2-up card lists. |

- Screens use `ScrollView` / `FlatList` from `components/layout` (drop-in replacements) and `Screen` from `components/ui`; wide windows get a centred column automatically.
- Card lists opt in to columns with `multiColumn`; headers / footers outside a list use `<Content>` / `<Frame>`.
- Tested at 320, 360, 390, 414, 480, 599, 600, 768, 820, 1024, 1280 and 1920 px with no horizontal overflow.
