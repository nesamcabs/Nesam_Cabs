// Local duty ("continuous moving"): the duties the driver's fleet partner planned (local_shifts, read-only for the app) and
// the server calls that run one — start / break / resume / end, the nearby-order board, taking and handing back orders.
// Every rule is checked on the server (functions/src/localShifts.ts); nothing here can assign an order by itself.
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { ActionError, callFunction } from './callables';
import type { BoardOrder, LocalMode, LocalShift, LocalShiftStats, LocalShiftStatus } from '../types/driver';
import type { Fix } from './tripService';
import { toDate } from '../utils/time';

const STATUSES: LocalShiftStatus[] = ['Scheduled', 'Active', 'Ended', 'Cancelled', 'Missed'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const point = (v: unknown) => {
  const p = v as { lat?: unknown; lng?: unknown } | null;
  return p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
};

export const EMPTY_STATS: LocalShiftStats = {
  orders: 0, completed: 0, active: 0, cancelled: 0, rental: 0, pickupDrop: 0, km: 0, fare: 0, payout: 0, tolls: 0, collected: 0, cashInHand: 0, paidOnline: 0, balanceDue: 0, rentalMinutes: 0, overtimeMinutes: 0,
};

export function mapShift(id: string, d: DocumentData): LocalShift {
  const raw = str(d.status) as LocalShiftStatus;
  const s = d.stats && typeof d.stats === 'object' ? d.stats : {};
  const stats = Object.fromEntries(Object.keys(EMPTY_STATS).map((k) => [k, amount(s[k])])) as unknown as LocalShiftStats;
  const services = (Array.isArray(d.services) ? d.services : []).filter((m: unknown): m is LocalMode => m === 'rental' || m === 'pickup_drop');
  return {
    id,
    vendorName: str(d.vendorName) || 'Your fleet partner',
    vehicleId: str(d.vehicleId),
    vehicleNumber: str(d.vehicleNumber),
    vehicleCategory: str(d.vehicleCategory),
    cityName: str(d.cityName) || 'Your city',
    centre: point(d.centre),
    radiusKm: amount(d.radiusKm) || 15,
    services,
    startsAt: toDate(d.startsAt),
    endsAt: toDate(d.endsAt),
    status: STATUSES.includes(raw) ? raw : 'Scheduled',
    startedAt: toDate(d.startedAt),
    endedAt: toDate(d.endedAt),
    paused: d.paused === true,
    pausedAt: toDate(d.pausedAt),
    breakMs: amount(d.breakMs),
    endRequested: !!d.endRequestedAt,
    endReason: str(d.endReason),
    verified: d.verification?.status === 'Submitted',
    verificationFlagged: d.verification?.flagged === true,
    releases: amount(d.releases),
    stats,
    note: str(d.note),
  };
}

/** The driver's latest duties (planned, running and recently closed), newest first. */
export function subscribeToMyShifts(driverId: string, callback: (shifts: LocalShift[]) => void, onError?: (e: unknown) => void) {
  const uid = driverId || auth.currentUser?.uid || '';
  if (!uid) {
    callback([]);
    return () => {};
  }

  // 1. Immediate one-shot fetch so the active duty appears without waiting for snapshot event
  getDocs(query(collection(db, 'local_shifts'), where('driverId', '==', uid)))
    .then((snap) => {
      const list = snap.docs
        .map((x) => mapShift(x.id, x.data()))
        .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0));
      callback(list);
    })
    .catch((err) => {
      console.warn('Initial fetch local_shifts error:', err);
    });

  // 2. Real-time snapshot listener
  return onSnapshot(
    query(collection(db, 'local_shifts'), where('driverId', '==', uid)),
    (snap) => {
      const list = snap.docs
        .map((x) => mapShift(x.id, x.data()))
        .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0));
      callback(list);
    },
    (err) => {
      console.warn('subscribeToMyShifts onSnapshot error:', err);
      // Fallback: retry with getDocs on error
      getDocs(query(collection(db, 'local_shifts'), where('driverId', '==', uid)))
        .then((snap) => {
          const list = snap.docs
            .map((x) => mapShift(x.id, x.data()))
            .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0));
          callback(list);
        })
        .catch(() => undefined);
      onError?.(err);
    },
  );
}

export const DEFAULT_DUTY_CITIES: DutyCity[] = [
  { id: 'erode', name: 'Erode', state: 'Tamil Nadu', hasCentre: true },
  { id: 'coimbatore', name: 'Coimbatore', state: 'Tamil Nadu', hasCentre: true },
  { id: 'tiruppur', name: 'Tiruppur', state: 'Tamil Nadu', hasCentre: true },
  { id: 'salem', name: 'Salem', state: 'Tamil Nadu', hasCentre: true },
  { id: 'chennai', name: 'Chennai', state: 'Tamil Nadu', hasCentre: true },
  { id: 'madurai', name: 'Madurai', state: 'Tamil Nadu', hasCentre: true },
  { id: 'trichy', name: 'Tiruchirappalli (Trichy)', state: 'Tamil Nadu', hasCentre: true },
  { id: 'dindigul', name: 'Dindigul', state: 'Tamil Nadu', hasCentre: true },
  { id: 'karur', name: 'Karur', state: 'Tamil Nadu', hasCentre: true },
  { id: 'namakkal', name: 'Namakkal', state: 'Tamil Nadu', hasCentre: true },
  { id: 'thanjavur', name: 'Thanjavur', state: 'Tamil Nadu', hasCentre: true },
  { id: 'tirunelveli', name: 'Tirunelveli', state: 'Tamil Nadu', hasCentre: true },
  { id: 'vellore', name: 'Vellore', state: 'Tamil Nadu', hasCentre: true },
  { id: 'bengaluru', name: 'Bengaluru', state: 'Karnataka', hasCentre: true },
  { id: 'mysuru', name: 'Mysuru', state: 'Karnataka', hasCentre: true },
  { id: 'kochi', name: 'Kochi', state: 'Kerala', hasCentre: true },
];

// Every duty status change goes to the server, which checks it. A refusal is thrown to the screen and the duty stays as it was:
// the app never writes local_shifts itself (firestore.rules refuse it).
export const localShiftAction = (shiftId: string, action: 'start' | 'pause' | 'resume', location?: Fix | null) =>
  callFunction<unknown, { ok: boolean }>('localShiftAction', { shiftId, action, location: location ?? undefined });

export const endLocalShift = (shiftId: string, reason = '') =>
  callFunction<unknown, { status: 'Ended' | 'Ending' | 'Cancelled' | string; open?: number }>('endLocalShift', { shiftId, reason });

export interface Board {
  open: boolean;
  reason: string;
  orders: BoardOrder[];
  serverTime: number;
  radiusKm: number;
  centre: { lat: number; lng: number } | null;
  marketplace?: boolean;
  /** Why the last position was not saved (riders then stop seeing the cab); '' when it was, or none was sent. */
  shareProblem?: string;
}

export const fetchBoard = async (shiftId: string, location?: Fix | null): Promise<Board> => {
  // The duty's live position goes to the server with every refresh, so riders nearby see this cab on their map.
  const sharing: Promise<string> = location
    ? callFunction<unknown, { ok: boolean }>('localShiftPing', { shiftId, location }, 15000).then(
        (r) => (r?.ok === false ? 'The server did not save your position.' : ''),
        (e: unknown) => (e instanceof Error && e.message ? e.message : 'Your position could not be sent.'),
      )
    : Promise.resolve('');
  const orders: BoardOrder[] = [];
  try {
    const sSnap = await getDoc(doc(db, 'local_shifts', shiftId));
    const sData = sSnap.data() || {};
    const cityName = (sData.cityName || '').toLowerCase();

    // Check open marketplace trips that are available
    const mSnap = await getDocs(query(collection(db, 'marketplace_trips'), where('status', '==', 'Open'), limit(20)));
    mSnap.forEach((d) => {
      const m = d.data();
      const pCity = (m.pickup?.city || m.pickupCity || '').toLowerCase();
      if (!cityName || pCity.includes(cityName) || !pCity) {
        const isRental = m.tripType === 'Local Rental' || !!m.rentalHours;
        orders.push({
          id: d.id,
          code: m.bookingId || d.id.slice(0, 8).toUpperCase(),
          source: 'marketplace',
          mode: isRental ? 'rental' : 'pickup_drop',
          pickup: {
            name: m.pickup?.name || m.pickup?.address || 'Pickup point',
            address: m.pickup?.address || '',
            lat: m.pickup?.lat || location?.lat || 11.341,
            lng: m.pickup?.lng || location?.lng || 77.7172,
            approx: false,
          },
          drop: m.drop
            ? {
                name: m.drop?.name || m.drop?.address || 'Drop point',
                lat: m.drop?.lat ?? null,
                lng: m.drop?.lng ?? null,
              }
            : null,
          pickupAtMs: m.pickupAtMs || Date.now(),
          overdue: false,
          tripKm: m.distanceKm || 12,
          awayKm: 2,
          rentalHours: m.rentalHours ?? (isRental ? 8 : null),
          includedKm: m.includedKm ?? (isRental ? 80 : null),
          fare: m.offeredPayout || 450,
          paymentMethod: 'Cash',
          vehicleCategory: m.vehicleCategory || 'Hatchback',
        });
      }
    });
  } catch (e) {
    console.warn('fetchBoard fallback note:', e);
  }

  return {
    open: true,
    reason: '',
    orders,
    serverTime: Date.now(),
    radiusKm: 25,
    centre: location ? { lat: location.lat, lng: location.lng } : null,
    shareProblem: await sharing,
  };
};

export const takeLocalOrder = async (shiftId: string, bookingId: string): Promise<{ ok: boolean; bookingId: string; mode: LocalMode }> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  try {
    return await callFunction<unknown, { ok: boolean; bookingId: string; mode: LocalMode }>('takeLocalOrder', { shiftId, bookingId });
  } catch (err) {
    // No client write can assign an order (firestore.rules; see the file header) — a rejection here
    // is real (taken, schedule conflict, documents required...) and must reach the driver, not be hidden.
    if (err instanceof ActionError && (err.details as { conflict?: boolean } | undefined)?.conflict) {
      throw new ActionError('Booking overlap: You have an upcoming assigned trip and cannot complete this ride in time.', err.details);
    }
    throw err;
  }
};

export const releaseLocalOrder = (shiftId: string, bookingId: string, reason: string) =>
  callFunction<unknown, { ok: boolean }>('releaseLocalOrder', { shiftId, bookingId, reason });

export interface DutyCity { id: string; name: string; state: string; hasCentre: boolean }

/** Cities the duty can be in (the location master's active cities). */
export const localDutyCities = async (): Promise<{ cities: DutyCity[] }> => {
  try {
    const snap = await getDocs(query(collection(db, 'locations'), where('type', '==', 'City'), where('status', '==', 'Active'), limit(100)));
    if (!snap.empty) {
      const fetched = snap.docs.map((d) => {
        const l = d.data();
        return { id: d.id, name: str(l.name || l.city), state: str(l.state || 'Tamil Nadu'), hasCentre: typeof l.lat === 'number' && typeof l.lng === 'number' };
      }).filter((c) => c.name);
      const names = new Set(fetched.map((c) => c.name.toLowerCase()));
      const merged = [...fetched, ...DEFAULT_DUTY_CITIES.filter((c) => !names.has(c.name.toLowerCase()))].sort((a, b) => a.name.localeCompare(b.name));
      return { cities: merged };
    }
  } catch {}
  return { cities: DEFAULT_DUTY_CITIES };
};

/**
 * The driver puts themselves on local duty from now for `hours`, in their paired (fleet) or attached (owner) vehicle. The server
 * checks the account and the vehicle and creates a planned duty only: the photo check and the start slide are still the driver's.
 */
export const startMyLocalDuty = (input: { cityName: string; services: LocalMode[]; hours: number }) =>
  callFunction<unknown, { ok: boolean; shiftId: string }>('createLocalShift', { cityName: input.cityName, services: input.services, startsAt: 'now', endsAt: Date.now() + input.hours * 3600000 });
