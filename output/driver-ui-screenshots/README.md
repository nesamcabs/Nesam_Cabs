# Driver UI screenshots

All captured from the website in headless Microsoft Edge (Windows). Names end in the viewport width in CSS px.
**No Android or iOS screenshots exist** — there is no emulator or device on the build machine (see the report).

| Folder | What it shows |
|---|---|
| `before/web-v1/` | First rebuild (system font, 1600 px cap, centred 540 px trip column): 390 and 1440 wide, plus `breakpoints/` 360–1131 |
| `before/web-v1-layout-poppins/` | The same layout with Poppins swapped in, at 320, 414 and 1920 (shows the blank side bands and the centred trip column) |
| `after/web/home-widths/` | Home at 320, 360, 390, 414, 700, 701, 900, 901, 1130, 1131, 1440, 1920 |
| `after/web/screens/` | Every screen and state at 360, 768 and 1440 (preview harness, sample data) |
| `after/web/states/` | Dialogs and in-flow states (offer, bid, support, payout, profile edit, toll receipt, closing form, review, penalties, earnings week) at 360 and 1440 |
| `after/web/legacy-and-fleet/` | Sign-in screen in Poppins; fleet-driver view (no Earnings / Wallet tabs) |
| `after/web-e2e/` | The **real app** (not the harness) against the Firebase emulators: live Firestore data, real callables — home, preparation, arrival closed, refused steps, boarding OTP, trip in progress, closing form, receipt, bid refused |

Re-create the harness shots: `cd driver/web && npx vite`, then `http://localhost:3002/preview.html?screen=<name>`.
Re-run the real-app journey: see `driver/web/e2e/driver-journey.e2e.cjs`.
