import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin';
import { GeoPlace, RouteInfo } from './domain/types';
import { AccountAction, AccountType, AdminAccess, DUTY_LABEL, DutyAction, FlagGroup, ModuleAction, Permission, StaffModule, accessOf, matrixAllows, matrixFlag } from './permissions';

export const approved = (s: unknown) => ['Approved', 'APPROVED', 'Active'].includes(String(s));
export const text = (v: unknown, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Client-generated idempotency key (also the booking document id). */
export function requestIdOf(v: unknown): string {
  if (typeof v !== 'string' || !/^[a-zA-Z0-9_-]{10,100}$/.test(v)) throw new HttpsError('invalid-argument', 'Invalid request ID.');
  return v;
}

export const inIndia = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= 6.5 && lat <= 35.7 && lng >= 68.1 && lng <= 97.4;

// A route between two points does not change when a tariff does, so a looked-up route is remembered
// for a few hours on this instance. Repeat quotes for the same trip (and the same popular routes asked
// by different riders) skip the routing service, which is the slowest step of a quote.
const ROUTE_TTL_MS = 6 * 60 * 60 * 1000;
const ROUTE_CACHE_MAX = 800;
const routeCache = new Map<string, { at: number; info: RouteInfo }>();
const routeKey = (a: GeoPlace, b: GeoPlace) => [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(',');

export async function routeFor(a: GeoPlace, b: GeoPlace): Promise<RouteInfo> {
  const key = routeKey(a, b);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < ROUTE_TTL_MS) return hit.info;
  const info = await lookUpRoute(a, b);
  if (!info.estimated) {
    if (routeCache.size >= ROUTE_CACHE_MAX) routeCache.delete(routeCache.keys().next().value as string);
    routeCache.set(key, { at: Date.now(), info });
  }
  return info;
}

/** Authoritative route totals across an ordered pickup → stops → drop itinerary. */
export async function routeThrough(points: GeoPlace[]): Promise<RouteInfo> {
  if (points.length < 2) throw new HttpsError('invalid-argument', 'Choose a pickup and drop location.');
  const legs = await Promise.all(points.slice(1).map((point, index) => routeFor(points[index]!, point)));
  return {
    distanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    durationMin: legs.reduce((sum, leg) => sum + leg.durationMin, 0),
    path: [],
    estimated: legs.some((leg) => leg.estimated),
  };
}

/**
 * Round-trip pricing historically receives one outward route and doubles it. When the rider
 * explicitly builds a closed itinerary (pickup -> stops -> the same pickup), routeThrough has
 * already measured the whole circuit. Give the pricing engine one half of that circuit so its
 * established round-trip doubling produces the real total once, not twice.
 */
export function routeForRoundTripPricing(route: RouteInfo, tripType: string, pickup: GeoPlace, drop: GeoPlace, stopCount: number): RouteInfo {
  const closesAtPickup = stopCount > 0
    && Math.abs(pickup.lat - drop.lat) < 0.0001
    && Math.abs(pickup.lng - drop.lng) < 0.0001;
  if (tripType !== 'Round Trip' || !closesAtPickup) return route;
  return { ...route, distanceKm: route.distanceKm / 2, durationMin: route.durationMin / 2 };
}

/**
 * The route a Round Trip is priced on. The pricing engine doubles the route it is given (out and back), so this returns
 * half of the real total running distance:
 *  - pickup -> stops -> a drop that is the pickup again (a closed circuit): the whole circuit is the total.
 *  - pickup -> stops -> final drop: the total is that outward route plus the direct way back from the final drop to the
 *    pickup (A -> Erode -> Salem is 200 KM, Salem -> A is 200 KM, so 400 KM).
 * Without stops the outward route is simply doubled, as before. Billing then applies the daily minimum KM on top.
 */
export async function roundTripPricingRoute(route: RouteInfo, tripType: string, pickup: GeoPlace, drop: GeoPlace, stopCount: number): Promise<RouteInfo> {
  if (tripType !== 'Round Trip' || stopCount === 0) return route;
  const closesAtPickup = Math.abs(pickup.lat - drop.lat) < 0.0001 && Math.abs(pickup.lng - drop.lng) < 0.0001;
  if (closesAtPickup) return routeForRoundTripPricing(route, tripType, pickup, drop, stopCount);
  const back = await routeFor(drop, pickup);
  return {
    ...route,
    distanceKm: (route.distanceKm + back.distanceKm) / 2,
    durationMin: (route.durationMin + back.durationMin) / 2,
    estimated: route.estimated || back.estimated,
  };
}

async function lookUpRoute(a: GeoPlace, b: GeoPlace): Promise<RouteInfo> {
  // Never accept distance or duration from the caller.
  if (Math.abs(a.lat - b.lat) < 0.0001 && Math.abs(a.lng - b.lng) < 0.0001) {
    return { distanceKm: 1, durationMin: 15, estimated: true, path: [] };
  }
  const googleKey = (process.env.GOOGLE_MAPS_SERVER_API_KEY ?? '').trim();
  if (googleKey) {
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
        body: JSON.stringify({ origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } }, destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'en-IN', units: 'METRIC' }),
        signal: AbortSignal.timeout(10000),
      });
      const data = response.ok ? await response.json() as any : null;
      const route = data?.routes?.[0];
      if (route && Number.isFinite(route.distanceMeters)) {
        return { distanceKm: Math.max(0.1, route.distanceMeters / 1000), durationMin: Math.max(1, Number(String(route.duration ?? '0s').replace('s', '')) / 60), estimated: false, path: [] };
      }
      console.warn('[routing] Google Routes unavailable; using OSRM fallback', { status: response.status });
    } catch (error) {
      console.warn('[routing] Google Routes failed; using OSRM fallback', error instanceof Error ? error.message : error);
    }
  }
  const base = (process.env.ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('routing unavailable');
    const result = await response.json() as any;
    const r = result.code === 'Ok' && result.routes?.[0];
    if (!r || !Number.isFinite(r.distance) || !Number.isFinite(r.duration)) throw new Error('invalid route');
    return { distanceKm: Math.max(0.1, r.distance / 1000), durationMin: Math.max(1, r.duration / 60), estimated: false, path: [] };
  } catch {
    throw new HttpsError('unavailable', 'Route pricing is temporarily unavailable. Please try again.');
  }
}

type CallerAuth = { uid: string; token?: { email?: string } } | undefined;

/** Same check as firestore.rules isAdmin(): an admins/{uid} doc with role admin and status active. */
export async function requireAdmin(auth: CallerAuth): Promise<AdminAccess> {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.doc(`admins/${auth.uid}`).get();
  const a = snap.data();
  // Staff IDs also carry a lifecycle status (Invited / Active / Inactive / Suspended); only Active passes.
  if (!snap.exists || a?.role !== 'admin' || a?.status !== 'active' || (a?.accountStatus ?? 'Active') !== 'Active') throw new HttpsError('permission-denied', 'Only active admins can do this.');
  const access = accessOf(auth.uid, a, text(auth.token?.email, 120));
  // A record that is neither Master, a role-based account nor a Staff ID grants nothing.
  if (access.kind === 'none') throw new HttpsError('permission-denied', 'Your admin record has no recognised access. Ask the Master account to set it up in Staff & Access.');
  return access;
}

/** The duty action must be in the admin's effective duty list (Staff ID: its own; role-based: legacy mapping). */
export function requireDuty(admin: AdminAccess, action: DutyAction): void {
  if (admin.isSuper || admin.duty.includes(action)) return;
  throw new HttpsError('permission-denied', `Your Staff ID does not include “${DUTY_LABEL[action]}”. Ask the Master account.`);
}

/** Same check as firestore.rules can(p): an active admin holding every listed permission. */
export async function requirePermission(auth: CallerAuth, ...needed: Permission[]): Promise<AdminAccess> {
  const admin = await requireAdmin(auth);
  const missing = needed.filter((p) => !admin.permissions.includes(p));
  if (missing.length) throw new HttpsError('permission-denied', `Your role does not include ${missing.join(' and ')} access.`);
  return admin;
}

/** The module action must be in the admin's effective matrix (Staff ID: its own; role-based: legacyAccessOf). */
export function requireAction(admin: AdminAccess, module: StaffModule, action: ModuleAction): void {
  if (admin.isSuper || matrixAllows(admin.matrix, module, action)) return;
  throw new HttpsError('permission-denied', `Your Staff ID does not include ${module} · ${action}. Ask the Master account.`);
}

/** The separate right (sensitive data, swaps, partner rights, privacy) must be in the effective matrix. */
export function requireStaffFlag(admin: AdminAccess, group: FlagGroup, key: string, label: string): void {
  if (admin.isSuper || matrixFlag(admin.matrix, group, key)) return;
  throw new HttpsError('permission-denied', `Your Staff ID does not include “${label}”. Ask the Master account.`);
}

/** Entity-specific account control (suspend / reactivate / inactive / dispute) from the effective matrix. */
export function requireAccountControl(admin: AdminAccess, type: AccountType, action: AccountAction): void {
  if (admin.isSuper || (admin.matrix.accountControls[type] ?? []).includes(action)) return;
  throw new HttpsError('permission-denied', `Your Staff ID cannot ${action} ${type}. Ask the Master account.`);
}

/** Settlement / payout amounts above the admin's approval limit need the Master account. */
export function requireWithinBankLimit(admin: AdminAccess, amount: number): void {
  if (admin.isSuper) return;
  if (Number.isFinite(amount) && amount <= admin.matrix.bankLimit) return;
  throw new HttpsError('permission-denied', `₹${Math.round(amount).toLocaleString('en-IN')} is above your settlement approval limit (₹${admin.matrix.bankLimit.toLocaleString('en-IN')}). Ask the Master account.`);
}

export async function requireSuperAdmin(auth: CallerAuth): Promise<AdminAccess> {
  const admin = await requireAdmin(auth);
  if (!admin.isSuper) throw new HttpsError('permission-denied', 'Only a super admin can manage staff access.');
  return admin;
}

export const NO_BOOKABLE_CATEGORIES =
  'Booking is unavailable: no active vehicle category has fares configured. An admin must set the category fares first.';
