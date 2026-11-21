# Resume the NESAM CABS admin redesign

Use the current local working tree as the starting point. The inspected HEAD was `171abf4` on 21 November 2026. Run `git status --short --untracked-files=all` and inspect current diffs before editing. Important implementation files are untracked. Keep all existing work, including concurrent edits outside these three modules. Do not reset, clean, overwrite the checkout, or deploy. Use one active implementation session and one Firebase emulator suite at a time.

## Original visual references

Use the three original HTML attachments in this session. If missing, ask for the corresponding original before claiming visual parity. Render and exercise each original alongside the current route. Use its layout, typography, responsive states and dialogs, with live app data, real permissions and persistent operations. Preserve existing admin workflows absent from the prototypes.

- Customers — [nesam_cabs_customers_directory.html](https://chatgpt.com/library?file_id=libfile_15761a36dbf48191bc214970515535b2&account_id=personal)
- Dashboard — [nesam_cabs_master_admi_dashboard.html](https://chatgpt.com/library?file_id=libfile_eb061986bb008191b5c5da3d6c31aae9&account_id=personal) (original spelling)
- Staff — [nesam_cabs_master_admin_staff_access.html](https://chatgpt.com/library?file_id=libfile_3024e67e3be08191b536760ee9105846&account_id=personal)

These links open under the owner's ChatGPT account. Local originals can be placed in `handoff-references/`. Use the HTML files supplied by the owner, including for the Staff screen where the interrupted session had a temporary scratch copy.

## 1. Customers Directory — verify and finish existing work first

The working tree contains edits to `admin/src/pages/Customers.tsx` and `admin/src/services/customerStats.ts`, plus new customer table, dialogs, drawer, directory domain, hook, service, CSS, backend and tests. Inspect those files and their integration before making changes. The last Claude screenshot shows a Functions emulator startup collision. That run did not establish an application failure or a passing integration test.

Confirm live filters, KPI counts, segmentation, legacy groups and records, pagination, row/bulk selection, masked contacts, reason-audited reveal, master-only export, customer creation/editing, booking prefill, profile history, statements, preferences, reminders, coupons, settlement and block/unblock. Check permissions, persistence, and duplicate/retry handling. Use the original HTML for detailed control and visual coverage.

## 2. Master Admin Dashboard — continue from the domain layer

Found `admin/src/domain/commandDesk.ts`, `scripts/command-desk.test.cjs`, and `functions/test/commandDesk{,.e2e}.test.js`. At inspection, Git showed no changes to the existing `admin/src/pages/Dashboard.tsx`. Inspect staged, unstaged and untracked UI work before building. Reuse the new domain helpers where appropriate.

Finish the authenticated Command Desk, All Trips and Revenue & GST views inside the existing shell. Preserve OfficeDashboard, OperationsSection and staff access behavior. Cover source-aware queues, approval/publish, own-fleet and vendor assignment, capped bidding, duty slips, actual trip start, trip close and billing, alerts and sound settings, real Quick Fare/New Booking entry points, and existing reports. Keep sample data, mock quotes and role simulations out of live operations.

## 3. Staff & Access — use the original attachment

The last visible Claude action wrote a temporary reference copy. At inspection Git showed no changes to StaffRoles.tsx, the existing staff component directory, staff.ts or staffProfiles.ts. Inspect current state first. Existing staff implementation is substantial. Start with StaffRoles.tsx, StaffAccessEditor.tsx, StaffProfilePanel.tsx, both permission configurations, staffService.ts and staffProfiles.ts.

Reproduce and diagnose the reported Add Staff failure in the emulator. Verify owner creates one staff identity, remains signed in, and the employee can sign in separately with the assigned privileges. Implement the four primary views, seven role presets, three-step editor, attendance, audit and protected admin accounts. Retain granular per-module actions, existing roles, access requests, session revocation, credential reset, and legacy conversion. Verify a shift-only edit preserves all individual permission bits. Keep the original HTML's plaintext demo credentials and fictional audit events out of the implementation.

## Verification and stopping point

I reran `node --test scripts/command-desk.test.cjs scripts/customer-directory.test.cjs` from repo root. All 23 tests passed. This covers those two test files only. The emulator suites, authenticated browser flows and visual comparisons remain unverified in this handoff.

Inspect `firebase.e2e.json`, `functions/package.json` and the targeted tests before starting services. The default E2E command inspected did not list the three specific suites below. Build the required local bundles and explicitly run customerDirectory.e2e.test.js, commandDesk.e2e.test.js, and staffCredentials.e2e.test.js against demo-nesam, serially. If a port is busy, identify its owner and check whether a suite is running. Let that run finish or use an isolated, consistently configured port set. Never terminate an unidentified process or point tests at production.

Compare each live route with its original HTML using equivalent fictional fixtures at desktop, tablet and phone widths. Run relevant builds and permission, persistence and lifecycle tests. Record the outcome per module, including any remaining blocker. This handoff covers these three interrupted Claude sessions only. Keep other booking and pricing work intact.
