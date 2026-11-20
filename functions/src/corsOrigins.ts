/**
 * Allowed origins for public Firebase callable functions (onCall cors option).
 * These are all customer-facing domains (with and without www) that call the
 * server directly via Firebase callables or the Vercel HTTP API.
 */
export const PUBLIC_CALLABLE_ORIGINS: string[] = [
  // ── Nesam Cabs ────────────────────────────────────────────────────────────
  'https://www.nesamcabs.com',
  'https://nesamcabs.com',
  'https://www.nesamcabs.in',
  'https://nesamcabs.in',

  // ── Nesam Tours and Travels ───────────────────────────────────────────────
  'https://www.nesamtoursandtravels.com',
  'https://nesamtoursandtravels.com',
  'https://www.nesamtoursandtravels.in',
  'https://nesamtoursandtravels.in',

  // ── Nesam Travels ─────────────────────────────────────────────────────────
  'https://www.nesamtravels.com',
  'https://nesamtravels.com',
  'https://www.nesamtravels.in',
  'https://nesamtravels.in',

  // ── NESAM Cabs customer site on Vercel ────────────────────────────────────
  'https://nesamcabs-app.vercel.app',

  // ── One Way Car Rentals ───────────────────────────────────────────────────
  'https://www.onewaycarrentals.in',
  'https://onewaycarrentals.in',
  'https://onewaycarrentals.vercel.app',

  // ── People Taxi ───────────────────────────────────────────────────────────
  'https://www.peopletaxi.in',
  'https://peopletaxi.in',

  'https://peopletaxi.vercel.app',

  // ── Local development (Vite dev server defaults, and the three sites' own ports) ──
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:4173',
  // A site's dev server moves to the next free port when its own is busy (8084, 8086 → 8085, 8087 …), so the whole range is allowed.
  ...Array.from({ length: 16 }, (_, i) => `http://localhost:${8080 + i}`).filter((o) => o !== 'http://localhost:8084' && o !== 'http://localhost:8086'),
  'http://localhost:8084',
  'http://localhost:8086',
];

/**
 * Vercel gives every deployment of a customer site its own address (`<project>-<hash>-<team>.vercel.app`, and
 * `<project>-git-<branch>-<team>.vercel.app` per branch), so these cannot be listed one by one. `*` stands for one
 * DNS label (letters, digits, dashes). Used by the HTTP API only; the browser never gets a credential from CORS.
 */
export const PUBLIC_ORIGIN_PATTERNS: string[] = [
  // Vercel preview deployments of the staff and partner apps (a stable production address is in APP_ORIGINS).
  'https://nesamtravelsadmin-*-legendary-ones-projects.vercel.app',
  'https://nesamtravelsdriver-*-legendary-ones-projects.vercel.app',
  'https://nesamtravelsvendor-*-legendary-ones-projects.vercel.app',
  'https://peopletaxi-*-nesam1.vercel.app',
  'https://onewaycarrentals-*-nesam1.vercel.app',
  // Vercel also hands out a short alias with no team segment (e.g. peopletaxi-lime.vercel.app).
  'https://peopletaxi-*.vercel.app',
  'https://onewaycarrentals-*.vercel.app',
];

/**
 * The NESAM staff and partner web apps on Vercel (Admin, Driver, Vendor) and the customer site's Vercel address. They call the HTTP API
 * from the browser with a Bearer token, so the browser must be told they may read the replies. They are listed here, in the code, so a
 * missing or stale ALLOWED_ORIGINS setting on the API project can never lock the Admin out ("Could not reach the server").
 * Used by the HTTP API only. ALLOWED_ORIGINS still adds any other site.
 */
export const APP_ORIGINS: string[] = [
  'https://nesamtravelsadmin.vercel.app',
  'https://nesamtravelsdriver.vercel.app',
  'https://nesamtravelsvendor.vercel.app',
  'https://nesamcabs.vercel.app',
];
