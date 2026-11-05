// Local Taxi (admin): typed wrappers over the lt* server functions and live reads of the lt_* collections.
// The server validates and audits everything; these helpers only call it and subscribe to the results.
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { callFunction } from "./callables";
import { db } from "./firebase";
import { describeDataError } from "./adminFirestoreService";

export type Position = [number, number]; // [longitude, latitude]
export interface ZoneGeometry { type: "Polygon" | "MultiPolygon"; coordinates: unknown }
export interface DispatchPolicy {
  radiusStartMeters: number; radiusStepMeters: number; radiusMaxMeters: number; offerTtlSeconds: number; searchTimeoutSeconds: number;
  locationMaxAgeSeconds: number; arrivalRadiusMeters: number; quoteTtlSeconds: number;
}
export interface LtZone {
  id: string; name: string; status: "draft" | "active" | "inactive"; timezone: string; boundary: ZoneGeometry | null; boundaryVersion: number; policyVersion: number;
  categoryIds: string[]; cashEnabled: boolean; dispatch: DispatchPolicy;
}
export interface FareConfig {
  currency: "INR"; baseFarePaise: number; includedMeters: number; perKmPaise: number; perMinutePaise: number; minimumFarePaise: number; freeWaitingSeconds: number;
  waitingPerMinutePaise: number; pickupChargePaise: number;
  night: { enabled: boolean; startMinute: number; endMinute: number; bps: number };
  surge: { enabled: boolean; multiplierBps: number; maxBps: number; effectiveFromMs: number | null; effectiveToMs: number | null };
  cancellation: { feePaise: number; graceSeconds: number }; tax: { enabled: boolean; bps: number }; platformFeePaise: number;
  rounding: "none" | "nearest_rupee" | "nearest_five" | "ceil_rupee"; commissionBps: number; maxDistanceOverQuoteBps: number;
}
export interface LtFare { id: string; zoneId: string; categoryId: string; version: number; status: "draft" | "scheduled" | "active" | "retired"; config: FareConfig; sample?: boolean; note?: string; effectiveFromMs?: number }
export interface FareBreakdown { lines: { code: string; label: string; amountPaise: number }[]; totalPaise: number; meteredFarePaise: number; commissionPaise: number; driverEarningsPaise: number; nightApplied: boolean; surgeApplied: boolean; minimumApplied: boolean }
export interface LtDriverState { id: string; driverName?: string; online?: boolean; available?: boolean; zoneIds?: string[]; categoryIds?: string[]; activeRideId?: string | null; location?: { lat: number; lng: number; atMs: number } | null }
export interface LtRide {
  id: string; status: string; customerId: string; customerName?: string; driverId?: string; driverName?: string; categoryName: string; zone: { id: string; name: string };
  pickup: { name: string }; drop: { name: string }; paymentMethod: string; paymentStatus: string; createdAtMs: number; estimate: { totalPaise: number }; final?: { totalPaise: number } | null;
  cancellationFeePaise?: number; cancelledBy?: string; cancelReason?: string; fare?: { version: number; sample?: boolean }; zoneSnapshot?: unknown;
}
export interface RideEvent { id: string; type: string; from?: string; to?: string; actorId: string; actorRole: string; atMs: number }
export interface AuditRow { id: string; action: string; performedByName?: string; performedBy: string; reason?: string; previous?: unknown; next?: unknown; at?: { toMillis?: () => number } }

export const saveZone = (d: { zoneId?: string; name: string; timezone: string; categoryIds: string[]; cashEnabled: boolean; dispatch: DispatchPolicy; boundary?: ZoneGeometry | null; reason?: string }) =>
  callFunction<typeof d, { zoneId: string; status: string; boundaryVersion: number }>("ltSaveZone", d);
export const setZoneStatus = (zoneId: string, status: "active" | "inactive", reason?: string) => callFunction("ltSetZoneStatus", { zoneId, status, reason });
export const saveFare = (d: { zoneId: string; categoryId: string; config: FareConfig; fareId?: string; note?: string; sample?: boolean }) =>
  callFunction<typeof d, { fareId: string; version: number }>("ltSaveFare", d);
export const activateFare = (fareId: string, effectiveFromMs?: number) => callFunction<{ fareId: string; effectiveFromMs?: number }, { status: string }>("ltActivateFare", { fareId, effectiveFromMs });
export const simulateFare = (d: { config: FareConfig; distanceMeters: number; rideSeconds: number; waitingSeconds: number; atMs?: number; timezone?: string }) => callFunction<typeof d, FareBreakdown>("ltSimulateFare", d);
export const setDriverEligibility = (driverId: string, zoneIds: string[], categoryIds: string[]) => callFunction("ltSetDriverEligibility", { driverId, zoneIds, categoryIds });
export const assignRide = (rideId: string, driverId: string) => callFunction("ltAssignRide", { rideId, driverId });
export const adminCancelRide = (rideId: string, reason: string) => callFunction("ltAdminCancelRide", { rideId, reason });

function watch<T>(path: string, cb: (rows: T[]) => void, onError: (m: string) => void, ...constraints: Parameters<typeof query>[1][]) {
  return onSnapshot(query(collection(db, path), ...constraints), (s) => cb(s.docs.map((d) => ({ ...d.data(), id: d.id }) as T)), (e) => onError(describeDataError(e)));
}
/** The boundary is stored as a JSON string (Firestore cannot hold nested arrays); parse it for the map. */
const parseBoundary = (json?: string): ZoneGeometry | null => { try { return json ? (JSON.parse(json) as ZoneGeometry) : null; } catch { return null; } };
export const watchZones = (cb: (r: LtZone[]) => void, onError: (m: string) => void) =>
  watch<LtZone & { boundaryJson?: string }>("lt_zones", (rows) => cb(rows.map((z) => ({ ...z, boundary: parseBoundary(z.boundaryJson) }))), onError);
export const watchFares = (cb: (r: LtFare[]) => void, onError: (m: string) => void) => watch<LtFare>("lt_fares", cb, onError);
export const watchDriverStates = (cb: (r: LtDriverState[]) => void, onError: (m: string) => void) => watch<LtDriverState>("lt_driver_state", cb, onError);
export const watchRides = (cb: (r: LtRide[]) => void, onError: (m: string) => void) => watch<LtRide>("lt_rides", cb, onError, orderBy("createdAtMs", "desc"), limit(100));

export async function rideEvents(rideId: string): Promise<RideEvent[]> {
  const s = await getDocs(query(collection(db, `lt_rides/${rideId}/events`), orderBy("atMs", "asc"), limit(100)));
  return s.docs.map((d) => ({ ...d.data(), id: d.id }) as RideEvent);
}

/** Change history (who, when, old and new values) from the shared audit trail. */
export async function auditFor(entity: "lt_zone" | "lt_fare" | "lt_ride", entityIdPrefix?: string): Promise<AuditRow[]> {
  const s = await getDocs(query(collection(db, "audit_logs"), where("entity", "==", entity), orderBy("at", "desc"), limit(60)));
  const rows = s.docs.map((d) => ({ ...d.data(), id: d.id }) as AuditRow & { entityId?: string });
  return entityIdPrefix ? rows.filter((r) => String(r.entityId ?? "").startsWith(entityIdPrefix)) : rows;
}

export const zoneDocRef = (id: string) => doc(db, "lt_zones", id);
