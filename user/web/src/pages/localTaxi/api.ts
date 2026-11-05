// Local Taxi (customer): thin wrappers over the lt* server functions and live reads of the rider's own ride.
// Prices, availability and every status change are decided on the server; this file only calls it and listens.
import { doc, onSnapshot } from 'firebase/firestore';
import { callFunction, newId } from '@core/services/callables';
import { db } from '@/platform/firebase';

export interface Spot { lat: number; lng: number; name: string; address: string }
export interface FareLine { code: string; label: string; amountPaise: number }
export interface Quote {
  quoteId: string; categoryId: string; categoryName: string; seats: number | null; totalPaise: number; lines: FareLine[]; expiresAtMs: number;
  available: boolean; availableDrivers: number; etaMinutes: number | null; sampleFare: boolean; distanceCapMeters: number; cancellationFeePaise: number; cancellationGraceSeconds: number;
}
export interface QuoteResponse {
  zone: { id: string; name: string }; distanceMeters: number; durationSeconds: number; quotes: Quote[];
  policy: { estimate: string; final: string; boundary: string }; payment: { cash: boolean; online: boolean };
}
/** `failed` means the check itself could not run (offline, server unreachable): not the same as "not available here". */
export interface Serviceability { available: boolean; failed?: boolean; zoneId?: string; zoneName?: string; reason?: string; message?: string }
export interface RideView {
  id: string; status: string; statusAtMs: number | null; zoneName: string; categoryName: string; pickup: Spot; drop: Spot; route: { distanceMeters: number; durationSeconds: number };
  estimate: { totalPaise: number; lines: FareLine[] }; final: { totalPaise: number; lines: FareLine[]; distanceMeters: number; basis: string } | null;
  paymentMethod: 'cash' | 'online'; paymentStatus: string; driverName: string; driverPhone: string; driverVehicle: { number: string; type: string } | null;
  assignedAtMs: number | null; arrivedAtMs: number | null; startedAtMs: number | null; completedAtMs: number | null; cancelledBy: string; cancelReason: string;
  cancellationFeePaise: number; rating: { stars: number } | null; createdAtMs: number | null;
}
export interface DriverLocation { lat: number; lng: number; atMs: number }

export const ZONE_MESSAGES: Record<string, string> = {
  pickup_outside_zone: 'Local Taxi is not available at your pickup location yet.',
  drop_outside_zone: 'Local Taxi is not available at your drop location yet.',
  different_zones: 'Pickup and drop must both be inside the same Local Taxi service area.',
};

export const checkServiceability = (pickup: Spot, drop?: Spot | null) => callFunction<{ pickup: Spot; drop?: Spot }, Serviceability>('ltCheckServiceability', { pickup, ...(drop ? { drop } : {}) });
export const getQuotes = (pickup: Spot, drop: Spot) => callFunction<{ pickup: Spot; drop: Spot }, QuoteResponse>('ltGetQuotes', { pickup, drop });
export const createRide = (d: { requestId: string; quoteId: string; paymentMethod: 'cash' | 'online' }) => callFunction<typeof d, { rideId: string; status: string; duplicate: boolean }>('ltCreateRide', d);
export const cancellationQuote = (rideId: string) => callFunction<{ rideId: string }, { canCancel: boolean; message: string; feePaise: number; graceSeconds: number }>('ltCancellationQuote', { rideId });
export const cancelRide = (rideId: string, acceptFeePaise: number, reason: string) => callFunction('ltCancelRide', { rideId, acceptFeePaise, reason });
export const rateRide = (rideId: string, rating: number, comment: string) => callFunction('ltRateRide', { rideId, rating, comment });
export const getRide = (rideId: string) => callFunction<{ rideId: string }, { ride: RideView; otp: string | null; driverLocation: DriverLocation | null }>('ltGetRide', { rideId });
export const createPaymentOrder = (rideId: string) => callFunction<{ rideId: string }, { orderId: string; amount: number; currency: string; keyId: string }>('ltCreatePaymentOrder', { rideId });
export const verifyPayment = (d: { rideId: string; razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => callFunction<typeof d, { status: string }>('ltVerifyPayment', d);
export const newRequestId = () => newId('lt');

/** The road route to draw on the map (best effort: an empty list draws a straight dashed line instead). */
export async function routePath(from: Spot, to: Spot): Promise<[number, number][]> {
  try {
    const r = await callFunction<{ origin: { lat: number; lng: number }; destination: { lat: number; lng: number } }, { route: { path?: [number, number][] } }>('getGoogleRoute', { origin: { lat: from.lat, lng: from.lng }, destination: { lat: to.lat, lng: to.lng } }, 15000);
    return Array.isArray(r.route?.path) ? r.route.path : [];
  } catch { return []; }
}

/** Live ride document. `onError` fires on permission or network trouble so the page can fall back to polling. */
export function watchRide(id: string, cb: (r: RideView | null) => void, onError: () => void) {
  return onSnapshot(doc(db, 'lt_rides', id), (s) => cb(s.exists() ? toView(id, s.data()) : null), onError);
}
export function watchOtp(id: string, cb: (otp: string | null) => void) {
  return onSnapshot(doc(db, 'lt_ride_secrets', id), (s) => cb((s.data()?.otp as string) || null), () => cb(null));
}
export function watchDriver(id: string, cb: (l: DriverLocation | null) => void) {
  return onSnapshot(doc(db, 'lt_ride_live', id), (s) => {
    const l = s.data()?.location as { lat: number; lng: number; atMs: number } | null | undefined;
    cb(l ? { lat: l.lat, lng: l.lng, atMs: l.atMs } : null);
  }, () => cb(null));
}

function toView(id: string, d: Record<string, any>): RideView {
  const n = (k: string): number | null => (typeof d[k] === 'number' ? d[k] : null);
  return {
    id, status: d.status, statusAtMs: n('statusAtMs'), zoneName: d.zone?.name ?? '', categoryName: d.categoryName, pickup: d.pickup, drop: d.drop, route: d.route,
    estimate: { totalPaise: d.estimate?.totalPaise ?? 0, lines: d.estimate?.breakdown?.lines ?? [] },
    final: d.final ? { totalPaise: d.final.totalPaise, lines: d.final.breakdown?.lines ?? [], distanceMeters: d.final.distanceMeters, basis: d.final.basis } : null,
    paymentMethod: d.paymentMethod, paymentStatus: d.paymentStatus, driverName: d.driverName ?? '', driverPhone: d.driverPhone ?? '', driverVehicle: d.driverVehicle ?? null,
    assignedAtMs: n('assignedAtMs'), arrivedAtMs: n('arrivedAtMs'), startedAtMs: n('startedAtMs'), completedAtMs: n('completedAtMs'), cancelledBy: d.cancelledBy ?? '', cancelReason: d.cancelReason ?? '',
    cancellationFeePaise: d.cancellationFeePaise ?? 0, rating: d.rating ?? null, createdAtMs: n('createdAtMs'),
  };
}

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const km = (meters: number) => `${(meters / 1000).toFixed(1)} km`;
