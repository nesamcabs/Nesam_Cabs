// Local Taxi data model: collection names, shared validators, and the zone / fare lookups every function uses.
// Every collection here is written ONLY by these server functions (firestore.rules grant reads, never writes).
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentData, Timestamp } from 'firebase-admin/firestore';
import { db } from '../admin';
import { FareConfig, validateFareConfig } from './fare';
import { Geometry, LatLng, bboxOf, pointInGeometry } from './geo';

export const COL = {
  zones: 'lt_zones', // service zones (boundary, status, dispatch policy)
  fares: 'lt_fares', // versioned fare configurations
  fareHeads: 'lt_fare_heads', // per zone+category: which version is active / scheduled
  quotes: 'lt_quotes',
  rides: 'lt_rides',
  rideSecrets: 'lt_ride_secrets', // boarding OTP (customer + staff can read, never the driver)
  rideLive: 'lt_ride_live', // driver position for the customer, deleted when the ride ends
  rideTracking: 'lt_ride_tracking', // server-side distance tracker
  driverState: 'lt_driver_state', // availability, eligibility and last location of each driver
  offers: 'lt_offers',
  payments: 'lt_payments',
  paymentOrders: 'lt_payment_orders',
  settlements: 'lt_settlements',
} as const;

export const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const cleanId = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !idPattern.test(v)) throw new HttpsError('invalid-argument', `Invalid ${what}.`);
  return v;
};
export const requestId = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{10,100}$/.test(v)) throw new HttpsError('invalid-argument', 'Invalid request ID.');
  return v;
};
export const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export const tsMs = (v: unknown): number | null => {
  const t = v as Timestamp | undefined;
  return t && typeof t.toMillis === 'function' ? t.toMillis() : typeof v === 'number' ? v : null;
};

export interface Place { lat: number; lng: number; name: string; address: string }

const indiaLatLng = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && lat >= 6.5 && lat <= 35.7 && lng >= 68.1 && lng <= 97.4;

export function placeOf(v: unknown, label: string): Place {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  if (!indiaLatLng(o.lat, o.lng)) throw new HttpsError('invalid-argument', `Choose a valid ${label}.`);
  return { lat: o.lat as number, lng: o.lng as number, name: str(o.name, 120) || label, address: str(o.address, 240) };
}

// ── Zones ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface DispatchPolicy {
  radiusStartMeters: number; radiusStepMeters: number; radiusMaxMeters: number;
  offerTtlSeconds: number; searchTimeoutSeconds: number; locationMaxAgeSeconds: number; arrivalRadiusMeters: number;
  quoteTtlSeconds: number;
}
export const DEFAULT_DISPATCH: DispatchPolicy = {
  radiusStartMeters: 2000, radiusStepMeters: 1000, radiusMaxMeters: 6000, offerTtlSeconds: 20, searchTimeoutSeconds: 180, locationMaxAgeSeconds: 60, arrivalRadiusMeters: 250, quoteTtlSeconds: 300,
};

export function dispatchOf(raw: unknown): DispatchPolicy {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof DispatchPolicy, lo: number, hi: number) => {
    const v = o[k];
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : DEFAULT_DISPATCH[k];
  };
  const p: DispatchPolicy = {
    radiusStartMeters: n('radiusStartMeters', 200, 20000), radiusStepMeters: n('radiusStepMeters', 100, 20000), radiusMaxMeters: n('radiusMaxMeters', 500, 50000),
    offerTtlSeconds: n('offerTtlSeconds', 8, 120), searchTimeoutSeconds: n('searchTimeoutSeconds', 30, 900), locationMaxAgeSeconds: n('locationMaxAgeSeconds', 10, 600),
    arrivalRadiusMeters: n('arrivalRadiusMeters', 50, 2000), quoteTtlSeconds: n('quoteTtlSeconds', 60, 1800),
  };
  if (p.radiusMaxMeters < p.radiusStartMeters) p.radiusMaxMeters = p.radiusStartMeters;
  return p;
}

export interface Zone {
  id: string; name: string; status: 'draft' | 'active' | 'inactive'; timezone: string; boundary: Geometry | null; boundaryVersion: number; policyVersion: number;
  categoryIds: string[]; cashEnabled: boolean; dispatch: DispatchPolicy;
}

/**
 * A boundary is stored as a JSON string (`boundaryJson`): Firestore cannot hold the nested arrays a GeoJSON polygon needs.
 * Clients parse it (the admin editor and the customer map do); the server always goes through here.
 */
export function boundaryOfDoc(d: DocumentData | undefined): Geometry | null {
  if (!d || typeof d.boundaryJson !== 'string' || !d.boundaryJson) return null;
  try { return JSON.parse(d.boundaryJson) as Geometry; } catch { return null; }
}

export const zoneOf = (id: string, d: DocumentData): Zone => ({
  id, name: str(d.name), status: d.status === 'active' || d.status === 'inactive' ? d.status : 'draft', timezone: str(d.timezone, 60) || 'Asia/Kolkata', boundary: boundaryOfDoc(d),
  boundaryVersion: Number(d.boundaryVersion ?? 0), policyVersion: Number(d.policyVersion ?? 0), categoryIds: Array.isArray(d.categoryIds) ? d.categoryIds.filter((x: unknown) => typeof x === 'string') : [],
  cashEnabled: d.cashEnabled === true, dispatch: dispatchOf(d.dispatch),
});

export const validTimeZone = (tz: string): boolean => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export const ZONE_PROBLEM = {
  outside: 'Local Taxi is not available at this location yet.',
  different: 'Pickup and drop must both be inside the same Local Taxi service area.',
} as const;

/** The active zone containing the point, if any. Boundary points count as inside (see geo.ts). */
export async function activeZoneAt(p: LatLng): Promise<Zone | null> {
  const snap = await db.collection(COL.zones).where('status', '==', 'active').get();
  for (const d of snap.docs) {
    const z = zoneOf(d.id, d.data());
    if (!z.boundary) continue;
    const b = bboxOf(z.boundary);
    if (p.lng < b.minLng || p.lng > b.maxLng || p.lat < b.minLat || p.lat > b.maxLat) continue;
    if (pointInGeometry(p, z.boundary)) return z;
  }
  return null;
}

/** Pickup and drop must lie inside the SAME active zone; anything else is refused on the server. */
export async function zoneForTrip(pickup: LatLng, drop: LatLng): Promise<Zone> {
  const [a, b] = await Promise.all([activeZoneAt(pickup), activeZoneAt(drop)]);
  if (!a) throw new HttpsError('failed-precondition', ZONE_PROBLEM.outside, { reason: 'pickup_outside_zone' });
  if (!b) throw new HttpsError('failed-precondition', ZONE_PROBLEM.outside, { reason: 'drop_outside_zone' });
  if (a.id !== b.id) throw new HttpsError('failed-precondition', ZONE_PROBLEM.different, { reason: 'different_zones' });
  return a;
}

// ── Fares ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const headId = (zoneId: string, categoryId: string) => `${zoneId}__${categoryId}`;
export const fareId = (zoneId: string, categoryId: string, version: number) => `${zoneId}__${categoryId}__v${version}`;

export interface FareVersion { id: string; zoneId: string; categoryId: string; version: number; status: string; effectiveFromMs: number; config: FareConfig; sample: boolean }

/** The fare version a NEW quote uses: the scheduled version once it is due, otherwise the active one. */
export async function resolveFare(zoneId: string, categoryId: string, nowMs: number): Promise<FareVersion | null> {
  const head = await db.doc(`${COL.fareHeads}/${headId(zoneId, categoryId)}`).get();
  if (!head.exists) return null;
  const h = head.data()!;
  const ids = [h.scheduledFareId, h.activeFareId].filter((x): x is string => typeof x === 'string' && !!x);
  const docs = await Promise.all(ids.map((id) => db.doc(`${COL.fares}/${id}`).get()));
  for (const d of docs) {
    if (!d.exists) continue;
    const f = d.data()!;
    const from = tsMs(f.effectiveFromMs) ?? 0;
    if (from > nowMs || !['active', 'scheduled'].includes(f.status)) continue;
    try {
      return { id: d.id, zoneId, categoryId, version: Number(f.version), status: f.status, effectiveFromMs: from, config: validateFareConfig(f.config), sample: f.sample === true };
    } catch { continue; }
  }
  return null;
}

export const actorName = (admin: { name?: string }) => str(admin.name, 80) || 'Admin';
