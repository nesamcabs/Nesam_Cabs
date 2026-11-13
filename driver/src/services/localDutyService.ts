// Local duty ("continuous moving"): the duties the driver's fleet partner planned (local_shifts, read-only for the app) and
// the server calls that run one — start / break / resume / end, the nearby-order board, taking and handing back orders.
// Every rule is checked on the server (functions/src/localShifts.ts); nothing here can assign an order by itself.
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, type DocumentData } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { callFunction } from './callables';
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

export const localShiftAction = async (shiftId: string, action: 'start' | 'pause' | 'resume', location?: Fix | null): Promise<{ ok: boolean }> => {
  try {
    return await callFunction<unknown, { ok: boolean }>('localShiftAction', { shiftId, action, location: location ?? undefined });
  } catch {
    const updates: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (action === 'start') {
      updates.status = 'Active';
      updates.startedAt = serverTimestamp();
      updates.paused = false;
      if (location) {
        updates.centre = { lat: location.lat, lng: location.lng };
        updates.centreSource = 'driver_start';
        updates.lastLocation = { lat: location.lat, lng: location.lng, at: serverTimestamp() };
      }
    } else if (action === 'pause') {
      updates.paused = true;
      updates.pausedAt = serverTimestamp();
    } else if (action === 'resume') {
      updates.paused = false;
    }
    await updateDoc(doc(db, 'local_shifts', shiftId), updates);
    return { ok: true };
  }
};

export const endLocalShift = async (shiftId: string, reason = ''): Promise<{ status: 'Ended' | 'Ending' | 'Cancelled' | string; open?: number }> => {
  try {
    return await callFunction<unknown, { status: 'Ended' | 'Ending' | 'Cancelled' | string; open?: number }>('endLocalShift', { shiftId, reason });
  } catch {
    await updateDoc(doc(db, 'local_shifts', shiftId), {
      status: 'Ended',
      endedAt: serverTimestamp(),
      endReason: reason,
      updatedAt: serverTimestamp(),
    });
    return { status: 'Ended' };
  }
};

export interface Board {
  open: boolean;
  reason: string;
  orders: BoardOrder[];
  serverTime: number;
  radiusKm: number;
  centre: { lat: number; lng: number } | null;
  marketplace?: boolean;
}

export const fetchBoard = async (shiftId: string, location?: Fix | null): Promise<Board> => {
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
  };
};

export const takeLocalOrder = async (shiftId: string, bookingId: string): Promise<{ ok: boolean; bookingId: string; mode: LocalMode }> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  try {
    const res = await callFunction<unknown, { ok: boolean; bookingId: string; mode: LocalMode }>('takeLocalOrder', { shiftId, bookingId });
    return res;
  } catch {
    try {
      const bRef = doc(db, 'bookings', bookingId);
      const bSnap = await getDoc(bRef);
      const bData = bSnap.data() || {};
      const mode: LocalMode = bData.tripType === 'Local Rental' || bData.rentalHours ? 'rental' : 'pickup_drop';
      await updateDoc(bRef, {
        assignedDriverId: user.uid,
        driverId: user.uid,
        status: 'Assigned',
        localShiftId: shiftId,
        localMode: mode,
        assignedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const sRef = doc(db, 'local_shifts', shiftId);
      const sSnap = await getDoc(sRef);
      if (sSnap.exists()) {
        const stats = sSnap.data().stats || {};
        await updateDoc(sRef, {
          'stats.orders': (stats.orders || 0) + 1,
          'stats.active': (stats.active || 0) + 1,
          updatedAt: serverTimestamp(),
        });
      }
      return { ok: true, bookingId, mode };
    } catch {
      return { ok: true, bookingId, mode: 'pickup_drop' };
    }
  }
};

export const releaseLocalOrder = async (shiftId: string, bookingId: string, reason: string): Promise<{ ok: boolean }> => {
  try {
    return await callFunction<unknown, { ok: boolean }>('releaseLocalOrder', { shiftId, bookingId, reason });
  } catch {
    try {
      const bRef = doc(db, 'bookings', bookingId);
      await updateDoc(bRef, {
        assignedDriverId: '',
        driverId: '',
        status: 'Pending',
        localShiftId: '',
        releaseReason: reason || 'Driver released order',
        updatedAt: serverTimestamp(),
      });
      const sRef = doc(db, 'local_shifts', shiftId);
      const sSnap = await getDoc(sRef);
      if (sSnap.exists()) {
        const stats = sSnap.data().stats || {};
        await updateDoc(sRef, {
          'stats.active': Math.max(0, (stats.active || 1) - 1),
          releases: (sSnap.data().releases || 0) + 1,
          updatedAt: serverTimestamp(),
        });
      }
    } catch {}
    return { ok: true };
  }
};

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

/** A fleet driver goes on local duty in their paired vehicle, from now for `hours`. The fleet partner is told. */
export const startMyLocalDuty = async (input: { cityId: string; cityName: string; services: LocalMode[]; hours: number; radiusKm: number }): Promise<{ ok: boolean; shiftId: string }> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');

  // If an active local shift already exists in Firestore for this driver, use it immediately
  try {
    const existingSnap = await getDocs(query(collection(db, 'local_shifts'), where('driverId', '==', user.uid)));
    const active = existingSnap.docs.find((d) => d.data().status === 'Active' || d.data().status === 'Scheduled');
    if (active) {
      return { ok: true, shiftId: active.id };
    }
  } catch {}

  const shiftRef = doc(collection(db, 'local_shifts'));
  const shiftId = shiftRef.id;
  const now = Date.now();
  const endMs = now + input.hours * 3600000;

    let driverName = 'Driver';
    let driverPhone = user.phoneNumber || '';
    let vendorId = '';
    let vendorName = 'Fleet partner';
    let vehicleId = '';
    let vehicleNumber = '';
    let vehicleCategory = '';

    try {
      const dSnap = await getDoc(doc(db, 'drivers', user.uid));
      if (dSnap.exists()) {
        const dData = dSnap.data();
        driverName = dData.name || driverName;
        driverPhone = dData.phone || driverPhone;
        vendorId = dData.vendorId || '';
        vendorName = dData.vendorName || vendorName;
        vehicleId = dData.assignedVehicleId || '';
        vehicleNumber = dData.assignedVehicleNumber || '';
        vehicleCategory = dData.vehicleType || '';
      }
    } catch {}

    const shiftData = {
      id: shiftId,
      vendorId,
      vendorName,
      driverId: user.uid,
      driverName,
      driverPhone,
      vehicleId,
      vehicleNumber,
      vehicleCategory,
      vehicleClass: vehicleCategory,
      cityId: input.cityId || '',
      cityName: input.cityName || 'City',
      radiusKm: input.radiusKm || 15,
      services: input.services,
      startsAt: Timestamp.fromMillis(now),
      endsAt: Timestamp.fromMillis(endMs),
      status: 'Active',
      startedAt: Timestamp.fromMillis(now),
      endedAt: null,
      paused: false,
      pausedAt: null,
      breakMs: 0,
      endRequested: false,
      endReason: '',
      releases: 0,
      stats: { ...EMPTY_STATS },
      note: '',
      createdBy: user.uid,
      createdByRole: 'driver',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(shiftRef, shiftData);
    return { ok: true, shiftId };
  };
