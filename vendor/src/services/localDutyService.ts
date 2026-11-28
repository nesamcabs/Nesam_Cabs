// Local duty ("continuous moving") for the fleet partner: put a driver + vehicle on local duty for a city and a time window
// (Hourly Rental and / or Pickup & Drop), follow it live, change its end time or services, and end it. The duty record is
// read-only here (local_shifts, firestore.rules); every change is a server call (functions/src/localShifts.ts).
import { collection, getDocs, limit, onSnapshot, query, where, type DocumentData } from 'firebase/firestore';
import { db } from '../config/firebase';
import { callFunction } from './callables';
import { num, str, toDate } from '../utils/format';

export type LocalMode = 'rental' | 'pickup_drop';
export const LOCAL_MODE_LABEL: Record<LocalMode, string> = { rental: 'Hourly Rental', pickup_drop: 'Pickup & Drop' };
export type LocalShiftStatus = 'Scheduled' | 'Active' | 'Ended' | 'Cancelled' | 'Missed';

export interface LocalShiftStats {
  orders: number;
  completed: number;
  active: number;
  cancelled: number;
  rental: number;
  pickupDrop: number;
  km: number;
  fare: number;
  payout: number;
  tolls: number;
  collected: number;
  cashInHand: number;
  paidOnline: number;
  balanceDue: number;
  rentalMinutes: number;
  overtimeMinutes: number;
}

export interface LocalShift {
  id: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  vehicleNumber: string;
  vehicleCategory: string;
  cityName: string;
  radiusKm: number;
  services: LocalMode[];
  startsAt: Date | null;
  endsAt: Date | null;
  status: LocalShiftStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  endedBy: string;
  paused: boolean;
  pausedAt: Date | null;
  breakMs: number;
  endRequested: boolean;
  endReason: string;
  verified: boolean;
  verificationFlagged: boolean;
  releases: number;
  lastLocation: { lat: number; lng: number; at: Date | null } | null;
  stats: LocalShiftStats;
  statsUpdatedAt: Date | null;
  note: string;
}

const STATUSES: LocalShiftStatus[] = ['Scheduled', 'Active', 'Ended', 'Cancelled', 'Missed'];
const STAT_KEYS: (keyof LocalShiftStats)[] = ['orders', 'completed', 'active', 'cancelled', 'rental', 'pickupDrop', 'km', 'fare', 'payout', 'tolls', 'collected', 'cashInHand', 'paidOnline', 'balanceDue', 'rentalMinutes', 'overtimeMinutes'];

export function mapShift(id: string, d: DocumentData): LocalShift {
  const s = d.stats && typeof d.stats === 'object' ? d.stats : {};
  const loc = d.lastLocation && typeof d.lastLocation === 'object' && typeof d.lastLocation.lat === 'number' ? d.lastLocation : null;
  return {
    id,
    driverId: str(d.driverId),
    driverName: str(d.driverName) || 'Driver',
    driverPhone: str(d.driverPhone),
    vehicleId: str(d.vehicleId),
    vehicleNumber: str(d.vehicleNumber),
    vehicleCategory: str(d.vehicleCategory),
    cityName: str(d.cityName) || 'City',
    radiusKm: num(d.radiusKm) || 15,
    services: (Array.isArray(d.services) ? d.services : []).filter((m: unknown): m is LocalMode => m === 'rental' || m === 'pickup_drop'),
    startsAt: toDate(d.startsAt),
    endsAt: toDate(d.endsAt),
    status: STATUSES.includes(d.status) ? d.status : 'Scheduled',
    startedAt: toDate(d.startedAt),
    endedAt: toDate(d.endedAt),
    endedBy: str(d.endedBy || d.endRequestedBy),
    paused: d.paused === true,
    pausedAt: toDate(d.pausedAt),
    breakMs: num(d.breakMs),
    endRequested: !!d.endRequestedAt,
    endReason: str(d.endReason),
    verified: d.verification?.status === 'Submitted',
    verificationFlagged: d.verification?.flagged === true,
    releases: num(d.releases),
    lastLocation: loc ? { lat: loc.lat, lng: loc.lng, at: toDate(loc.at) } : null,
    stats: Object.fromEntries(STAT_KEYS.map((k) => [k, num(s[k])])) as unknown as LocalShiftStats,
    statsUpdatedAt: toDate(d.statsUpdatedAt),
    note: str(d.note),
  };
}

/** This fleet's local duties, newest first. */
export function subscribeToLocalShifts(vendorId: string, cb: (list: LocalShift[]) => void, onError?: (e: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'local_shifts'), where('vendorId', '==', vendorId)),
    (snap) => cb(snap.docs.map((x) => mapShift(x.id, x.data())).sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0))),
    (e) => onError?.(e),
  );
}

export const EMPTY_STATS: LocalShiftStats = {
  orders: 0, completed: 0, active: 0, cancelled: 0, rental: 0, pickupDrop: 0, km: 0, fare: 0, payout: 0, tolls: 0, collected: 0, cashInHand: 0, paidOnline: 0, balanceDue: 0, rentalMinutes: 0, overtimeMinutes: 0,
};

export interface DutyCity { id: string; name: string; state: string; hasCentre: boolean }

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

/** The id to send for a chosen city. A built-in city has no server record, so it goes by name alone (the server refuses unknown ids). */
export const masterCityId = (city: DutyCity | null): string => (city && !DEFAULT_DUTY_CITIES.includes(city) ? city.id : '');

export async function localDutyOptions(): Promise<{ cities: DutyCity[]; radius: { default: number; min: number; max: number } }> {
  try {
    const snap = await getDocs(query(collection(db, 'locations'), where('type', '==', 'City'), where('status', '==', 'Active'), limit(100)));
    if (!snap.empty) {
      const fetched = snap.docs.map((d) => {
        const l = d.data();
        return {
          id: d.id,
          name: str(l.name || l.city),
          state: str(l.state || 'Tamil Nadu'),
          hasCentre: typeof l.lat === 'number' && typeof l.lng === 'number',
        };
      }).filter((c) => c.name);

      const names = new Set(fetched.map((c) => c.name.toLowerCase()));
      const merged = [...fetched, ...DEFAULT_DUTY_CITIES.filter((c) => !names.has(c.name.toLowerCase()))].sort((a, b) => a.name.localeCompare(b.name));
      return { cities: merged, radius: { default: 15, min: 5, max: 40 } };
    }
  } catch {
    // Return curated default list
  }
  return { cities: DEFAULT_DUTY_CITIES, radius: { default: 15, min: 5, max: 40 } };
}

export interface CreateLocalShiftInput {
  driverId: string;
  vehicleId: string;
  cityId: string;
  cityName: string;
  services: LocalMode[];
  startsAt: number | 'now';
  endsAt: number;
  radiusKm: number;
  note: string;
}

// Every duty change goes to the server, which checks it. A refusal is thrown to the screen and the duty stays as it was: the app
// never writes local_shifts itself (firestore.rules refuse it). A new duty is planned: it starts after the driver's photo check.
export const createLocalShift = (input: CreateLocalShiftInput) =>
  callFunction<unknown, { ok: boolean; shiftId: string }>('createLocalShift', input);

export const updateLocalShift = (input: { shiftId: string; endsAt?: number; services?: LocalMode[]; radiusKm?: number }) =>
  callFunction<unknown, { ok: boolean; changed: boolean }>('updateLocalShift', input);

export const endLocalShift = (shiftId: string, reason = '') =>
  callFunction<unknown, { status: string; open?: number }>('endLocalShift', { shiftId, reason });

/** Duty time worked so far, without breaks. */
export function dutyMinutes(s: Pick<LocalShift, 'startedAt' | 'endedAt' | 'breakMs' | 'paused' | 'pausedAt'>, now: number): number {
  const start = s.startedAt?.getTime();
  if (!start) return 0;
  const end = s.endedAt?.getTime() ?? now;
  const open = s.paused && s.pausedAt && !s.endedAt ? Math.max(0, now - s.pausedAt.getTime()) : 0;
  return Math.max(0, Math.round((end - start - Math.max(0, s.breakMs) - open) / 60000));
}

export function spanText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} m` : ''}` : `${m} m`;
}

/** What the duty is doing right now, in a few words. */
export function shiftState(s: LocalShift): { label: string; tone: 'green' | 'amber' | 'neutral' | 'blue' | 'red' } {
  if (s.status === 'Scheduled') return { label: 'Planned', tone: 'blue' };
  if (s.status === 'Active') return s.endRequested ? { label: 'Ending', tone: 'amber' } : s.paused ? { label: 'On break', tone: 'amber' } : { label: 'On duty', tone: 'green' };
  if (s.status === 'Ended') return { label: 'Closed', tone: 'neutral' };
  if (s.status === 'Missed') return { label: 'Not started', tone: 'red' };
  return { label: 'Cancelled', tone: 'neutral' };
}
