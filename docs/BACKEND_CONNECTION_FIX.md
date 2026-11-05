# Backend Connection Fix & Production Booking Configuration — Status

Updated: 16 October 2026
Author: Senior QA & Full-Stack Release Engineering

---

## 1. Executive Summary
The backend connection and booking quoting pipeline across the NESAM Travels platform have been completely restored and verified in production. All frontends communicate with the unified Vercel API (`https://nesam-travels-api.vercel.app`), production Firestore contains the 5 owner-approved vehicle categories and Tariff v2 rate cards, the Admin CSP font blocking was fixed with bundled local fonts, and live route quoting works across all four trip types.

---

## 2. Root Causes Identified & Resolved

1. **Frontend Disconnection from Backend**:
   - Production web/mobile frontends had no API URL baked into their builds, falling back to non-existent Firebase callables on `nesamtoursandtravels-202f5` (returning 404 with missing CORS headers).
   - **Fix**: Created and deployed Vercel API project `nesam-travels-api` (URL: `https://nesam-travels-api.vercel.app`), configured CORS origins for all 4 roles, and injected `EXPO_PUBLIC_API_URL` / `VITE_API_URL` across all four frontends.

2. **Missing Vehicle Categories and Tariff Configuration**:
   - Production Firestore had zero documents in `vehicle_categories` and no `business_config/tariff_v2`.
   - `quoteBooking` returned empty quotes (`quotes: []`), completely blocking customer checkout with "no active vehicle category has fares configured".
   - **Fix**: Inspected authoritative owner specifications (`Nesam_Vehicle_Category_and_Vendor_Duty_Rules.pdf` and `Nesam_Developer_Tariff_and_Operations_v2_0.pdf`) and ran idempotent migration script `scripts/populate-approved-categories-and-tariff.cjs` using service-account credentials to populate the 5 approved vehicle categories and Tariff v2 configuration.

3. **Routing Engine Zero-Distance Edge Case**:
   - Short local trips or disposal trips where coordinates are nearly identical caused OSRM to report 0 distance/duration, causing `routeFor` in `functions/src/shared.ts` to throw "invalid route" and return 503 "Route pricing is temporarily unavailable".
   - **Fix**: Added zero-distance guard in `functions/src/shared.ts` returning `{ distanceKm: 1, durationMin: 15, estimated: true, path: [] }` with `Math.max` clamping.

4. **Admin Panel CSP Google Fonts Violation**:
   - `admin/vercel.json` enforces strict Content Security Policy (`font-src 'self' data:`, `style-src 'self' 'unsafe-inline'`). External Google Fonts links in `admin/index.html` and `@import` in `admin/src/index.css` were blocked by the browser.
   - **Fix**: Installed `@fontsource/poppins` in `admin/package.json`, imported font weights 300–900 in `admin/src/main.tsx`, and removed external stylesheet links. Admin now bundles Poppins locally with zero external network dependencies and zero CSP errors.

---

## 3. Authoritative Production Configuration Populated

The following records were populated deterministically in production Firestore (`nesamtoursandtravels-202f5`):

### A. Vehicle Categories (`vehicle_categories/{id}`)
| Document ID | Name | Seating Capacity | Duty Class | Tariff Class | Per KM Rate | Driver Allowance (Bata) | Minimum / Base Fare |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `sedan` | Sedan | 4 | `sedan` | `sedan` | ₹15/km | ₹400 | ₹800 (City drop 20km) |
| `suv-6-1` | SUV 6+1 | 6 | `suv6` | `suv` | ₹20/km | ₹400 | ₹1,200 (City drop 20km) |
| `suv-7-1` | SUV 7+1 | 7 | `suv7` | `suv` | ₹20/km | ₹400 | ₹1,200 (City drop 20km) |
| `innova` | Innova | 7 | `innova` | `suv` | ₹20/km | ₹400 | ₹1,200 (City drop 20km) |
| `innova-crysta` | Innova Crysta | 7 | `crysta` | `crysta` | ₹26/km | ₹600 | ₹2,000 (City drop 20km) |

All 5 categories have `active: true` and support all trip types: `['oneway', 'roundtrip', 'rental', 'airport']`.

### B. Business Tariff v2 (`business_config/tariff_v2`)
- **Version**: 1 (Active / Enabled)
- **GST Rate**: 5% (`0.05`)
- **One-Way (Outstation)**:
  - Sedan: ₹15/km, ₹400 bata, 130 km min
  - SUV: ₹20/km, ₹400 bata, 130 km min
  - Crysta: ₹26/km, ₹600 bata, 130 km min
- **Round-Trip (Outstation)**:
  - Sedan: ₹14/km, ₹400 bata/day, 250 km/day min
  - SUV: ₹19/km, ₹400 bata/day, 250 km/day min
  - Crysta: ₹22/km, ₹500 bata/day, 300 km/day min
- **Rental (Local Packages)**:
  - Tiered packages for Sedan, SUV, and Crysta (1hr/10km up to 12hr/120km) with standard extra km / extra hour rates.
- **City Drop / Airport**:
  - Base fares with 20km included (Sedan ₹800, SUV ₹1200, Crysta ₹2000), extra km rates (₹35 / ₹50 / ₹70).

---

## 4. Verification & Test Execution Results

### A. Live Production API Verification (`https://nesam-travels-api.vercel.app`)
Executed via automated test script `scripts/verify-production-quotes.cjs`:
1. **Health Check**:
   - `GET /api/health` → `200 OK` (`{ ok: true }`).
2. **CORS Headers**:
   - Preflight `OPTIONS /api/quoteBooking` with Origin `https://nesam-travels-user.vercel.app` → `204 No Content` with matching `Access-Control-Allow-Origin`.
   - Preflight from unauthorized origin → No CORS origin allowed.
3. **Security / Authentication**:
   - `POST /api/quoteBooking` without token → `401 Unauthorized` (`unauthenticated`).
   - `POST /api/cron/tick` without secret → `401 Unauthorized`.
4. **Outstation One-Way Quote (Chennai Central to Madurai Junction, 455.7 km)**:
   - Returned 5 valid quotes with precise Tariff v2 amounts:
     - Sedan: ₹7,597.28
     - SUV 6+1: ₹9,989.70
     - SUV 7+1: ₹9,989.70
     - Innova: ₹9,989.70
     - Innova Crysta: ₹13,070.61
5. **Outstation Round-Trip Quote (Chennai to Pondicherry, 2 Calendar Days, 500 km min)**:
   - Returned 5 valid quotes with daily bata and minimum km billing:
     - Sedan: ₹8,190.00
     - SUV 6+1: ₹10,815.00
     - SUV 7+1: ₹10,815.00
     - Innova: ₹10,815.00
     - Innova Crysta: ₹14,910.00
6. **Airport Transfer Quote (Chennai Central to Chennai Airport MAA, 14.9 km)**:
   - Returned 5 valid quotes within base city drop threshold:
     - Sedan: ₹840.00
     - SUV 6+1: ₹1,260.00
     - SUV 7+1: ₹1,260.00
     - Innova: ₹1,260.00
     - Innova Crysta: ₹2,100.00
7. **Local Rental Quote (Disposal / Within City, 7.2 km)**:
   - Returned 5 valid quotes with rental package tiering.
8. **Test Account Cleanup**:
   - Temporary customer record (`customers/zz-test-cust-*`) and Firebase Auth user permanently deleted after test run. **0 test documents remain in production**.

### B. Admin Panel Build & CSP Verification
- Run `npm run build` in `admin/`:
  - Bundled `@fontsource/poppins` local font files in `dist/assets/poppins-*.woff2`.
  - Zero external font requests in generated `index.html`.
  - Zero CSP violations on font loading.

### C. Functions Build & Unit Tests
- `npm run build` in `functions/`: Passed with 0 TypeScript errors.
- `npm run test:http` in `functions/`: 9/9 passing tests.

---

## 5. Security & Operational Hygiene
- **Service Account Key**: As instructed, the downloaded key at `C:\Users\User\Downloads\nesamtoursandtravels-202f5-firebase-adminsdk-fbsvc-292e301f9a.json` was NOT deleted or rotated.
- **Cron Jobs**: Scheduled tasks remain **disabled** in `functions/vercel.json` (0 active cron definitions) to avoid background side-effects.
- **Safe Sandboxing**: No real money was charged; no live driver duties were dispatched.

---

## 6. Remaining External Integrations & Unverified Steps
1. **Live Booking Confirmation on Production**:
   - A final booking write (`createBooking`) was intentionally not triggered on production to avoid generating real unassigned duty notifications for registered drivers and vendors.
2. **Third-Party Secret Keys (Degrading Gracefully)**:
   - Razorpay API keys (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`) are not set in Vercel API env vars. Cash and offline UPI flows operate as default.
   - WhatsApp gateway and RTO vehicle lookup APIs are unset on Vercel API and degrade gracefully.
