// A fleet driver's request to take an Outstation Round Trip directly (same contract as
// functions/src/driverTripRequests.ts). The app never assigns anything itself: approving or
// rejecting is decided by the server, which re-checks eligibility and schedule overlap.
import { collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callFunction } from './callables';
import { describeDataError } from '../utils/retry';

export type DriverTripRequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface DriverTripRequest {
  id: string;
  bookingId: string;
  bookingCode: string;
  driverId: string;
  driverName: string;
  vehicleId: string;
  vehicleNumber: string;
  status: DriverTripRequestStatus;
  reason: string;
  requestedAt: Date | null;
  decidedAt: Date | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const dateOf = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

export function mapDriverTripRequest(id: string, d: Record<string, unknown>): DriverTripRequest {
  return {
    id,
    bookingId: str(d.bookingId),
    bookingCode: str(d.bookingCode) || str(d.bookingId),
    driverId: str(d.driverId),
    driverName: str(d.driverName),
    vehicleId: str(d.vehicleId),
    vehicleNumber: str(d.vehicleNumber),
    status: (str(d.status) || 'Pending') as DriverTripRequestStatus,
    reason: str(d.reason),
    requestedAt: dateOf(d.requestedAt),
    decidedAt: dateOf(d.decidedAt),
  };
}

export const requestIsOpen = (r: Pick<DriverTripRequest, 'status'>) => r.status === 'Pending';

/** Every round-trip request filed by this vendor's drivers, newest first. */
export function subscribeToDriverTripRequests(vendorId: string, cb: (requests: DriverTripRequest[]) => void, onError: (message: string) => void): () => void {
  return onSnapshot(
    query(collection(db, 'driver_trip_requests'), where('vendorId', '==', vendorId)),
    (snap) => cb(snap.docs.map((d) => mapDriverTripRequest(d.id, d.data())).sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0))),
    (err) => onError(describeDataError(err)),
  );
}

export const approveDriverTripRequest = (requestId: string) => callFunction<unknown, { ok: boolean; status: DriverTripRequestStatus }>('decideDriverTripRequest', { requestId, decision: 'approve' });
export const rejectDriverTripRequest = (requestId: string, reason = '') => callFunction<unknown, { ok: boolean; status: DriverTripRequestStatus }>('decideDriverTripRequest', { requestId, decision: 'reject', reason });
