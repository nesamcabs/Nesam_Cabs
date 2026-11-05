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

  // ── One Way Car Rentals ───────────────────────────────────────────────────
  'https://www.onewaycarrentals.in',
  'https://onewaycarrentals.in',
  'https://onewaycarrentals.vercel.app',

  // ── People Taxi ───────────────────────────────────────────────────────────
  'https://www.peopletaxi.in',
  'https://peopletaxi.in',

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
