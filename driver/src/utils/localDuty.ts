// Local duty helpers for the driver app. The rules mirror functions/src/domain/localShift.ts (the server decides; these
// only present what it decided): which kind of local order a booking is, the hourly-rental clock and duty time.
import type { LocalMode, LocalShift, TripDetails } from '../types/driver';

export const LOCAL_MODE_LABEL: Record<LocalMode, string> = { rental: 'Hourly Rental', pickup_drop: 'Pickup & Drop' };
const LOCAL_PICKUP_DROP_MAX_KM = 40;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);

/** Hourly Rental, Pickup & Drop inside one city, or neither (same rule as the server's localModeOf). */
export function localModeOf(b: { tripType?: unknown; service?: unknown; distanceKm?: unknown; pricing?: { model?: unknown } | null }): LocalMode | null {
  const tripType = str(b.tripType);
  const model = str(b.pricing && typeof b.pricing === 'object' ? b.pricing.model : '');
  const service = str(b.service).toLowerCase();
  if (tripType === 'Local Rental' || model === 'rental_package' || model === 'rental_time') return 'rental';
  if (tripType === 'Airport Taxi' || tripType === 'Round Trip' || tripType === 'Multicity' || model === 'airport_transfer') return null;
  if (/airport|multicity|outstation/.test(service)) return null;
  if (/rental/.test(service) && !/one\s*way|pickup/.test(service)) return 'rental';
  if (model === 'local_pickup_drop') return 'pickup_drop';
  if (tripType === 'One Way' || tripType === '') {
    if (/pickup\s*(&|and)\s*drop|local/.test(service)) return 'pickup_drop';
    const km = num(b.distanceKm);
    if (km > 0 && km <= LOCAL_PICKUP_DROP_MAX_KM) return 'pickup_drop';
  }
  return null;
}

/** The booked rental time: used, left and over, from the server's start stamp. */
export function rentalClock(startedAt: Date | null | undefined, hours: number, now: number) {
  const packageMs = Math.max(0, hours) * 3600000;
  const start = startedAt?.getTime();
  if (!start || !Number.isFinite(start)) return { started: false, elapsedMs: 0, remainingMs: packageMs, overtimeMs: 0, progress: 0, packageMs };
  const elapsedMs = Math.max(0, now - start);
  return { started: true, elapsedMs, remainingMs: Math.max(0, packageMs - elapsedMs), overtimeMs: Math.max(0, elapsedMs - packageMs), progress: packageMs > 0 ? Math.min(1, elapsedMs / packageMs) : 0, packageMs };
}

/** 2:05:09 (hours not padded). */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "3 h 20 m", "45 m". */
export function spanText(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} m` : ''}` : `${m} m`;
}

/** Minutes worked on the duty so far, without breaks (an open break included). */
export function dutyMinutes(shift: Pick<LocalShift, 'startedAt' | 'endedAt' | 'breakMs' | 'pausedAt' | 'paused'>, now: number): number {
  const start = shift.startedAt?.getTime();
  if (!start) return 0;
  const end = shift.endedAt?.getTime() ?? now;
  const open = shift.paused && shift.pausedAt && !shift.endedAt ? Math.max(0, now - shift.pausedAt.getTime()) : 0;
  return Math.max(0, Math.round((end - start - Math.max(0, shift.breakMs) - open) / 60000));
}

/** The duty the Local Taxi page is about: a running one first, else the next planned one, else the latest closed today. */
export function currentShift(shifts: LocalShift[], now: number): LocalShift | null {
  const active = shifts.find((s) => s.status === 'Active');
  if (active) return active;
  const planned = shifts
    .filter((s) => s.status === 'Scheduled' && (s.endsAt?.getTime() ?? 0) > now)
    .sort((a, b) => (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0));
  if (planned[0]) return planned[0];
  const dayAgo = now - 18 * 3600000;
  return shifts.find((s) => (s.status === 'Ended' || s.status === 'Missed' || s.status === 'Cancelled') && (s.endedAt?.getTime() ?? s.endsAt?.getTime() ?? 0) > dayAgo) ?? null;
}

/** The duty's orders in the order the driver works them: running first, then next, then finished (latest first). */
export function shiftOrders(trips: TripDetails[], shiftId: string) {
  const mine = trips.filter((t) => t.localShiftId === shiftId);
  const inHand = mine
    .filter((t) => t.status === 'Assigned' || t.status === 'Ongoing')
    .sort((a, b) => Number(b.status === 'Ongoing') - Number(a.status === 'Ongoing') || Number(b.subStatus !== 'Not Started') - Number(a.subStatus !== 'Not Started') || (a.assignedAt?.getTime() ?? 0) - (b.assignedAt?.getTime() ?? 0));
  const done = mine.filter((t) => t.status === 'Completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  return { current: inHand[0] ?? null, next: inHand[1] ?? null, inHand, done, all: mine };
}

/** "in 25 min", "now", "12 min late", "at 4:30 PM". */
export function pickupWhen(ms: number | null, now: number): string {
  if (ms == null) return 'Time not set';
  const diff = Math.round((ms - now) / 60000);
  if (diff < -1) return `${spanText(-diff)} late`;
  if (diff <= 1) return 'Now';
  if (diff <= 120) return `in ${spanText(diff)}`;
  return `at ${new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}`;
}

/** Why another order cannot be taken right now ('' when it can) — the server's queue rule, shown before asking it. */
export function takeBlockReason(inHand: TripDetails[], mode: LocalMode): string {
  const rental = inHand.find((t) => t.localMode === 'rental');
  if (rental) return `Finish your hourly rental ${rental.bookingId} first.`;
  if (inHand.length >= 2) return 'You already have a current and a next order.';
  if (mode === 'rental' && inHand.some((t) => t.subStatus === 'Not Started' && t.status !== 'Ongoing')) return 'Start your next order before taking a rental.';
  return '';
}

export interface LiveTotals {
  done: number;
  inHand: number;
  rental: number;
  pickupDrop: number;
  km: number;
  fare: number;
  collected: number;
  cashInHand: number;
  balanceDue: number;
  rentalMinutes: number;
  overtimeMinutes: number;
}

/** The duty's totals from its own orders, live (the server keeps the same totals on the duty record). */
export function liveTotals(trips: TripDetails[]): LiveTotals {
  const t: LiveTotals = { done: 0, inHand: 0, rental: 0, pickupDrop: 0, km: 0, fare: 0, collected: 0, cashInHand: 0, balanceDue: 0, rentalMinutes: 0, overtimeMinutes: 0 };
  for (const b of trips) {
    if (b.status === 'Cancelled' || b.status === 'Rejected') continue;
    if (b.localMode === 'rental') t.rental += 1;
    else t.pickupDrop += 1;
    if (b.status === 'Assigned' || b.status === 'Ongoing') t.inHand += 1;
    if (b.status !== 'Completed') continue;
    t.done += 1;
    t.km += b.totalKm || b.distanceKm || 0;
    t.fare += b.fareAmount || 0;
    t.collected += b.totalPaid ?? 0;
    t.cashInHand += b.cashHeld ?? 0;
    t.balanceDue += Math.max(0, b.balanceDue ?? 0);
    t.rentalMinutes += b.rentalUsage?.usedMinutes ?? 0;
    t.overtimeMinutes += b.rentalUsage?.overtimeMinutes ?? 0;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { ...t, km: Math.round(t.km * 10) / 10, fare: r2(t.fare), collected: r2(t.collected), cashInHand: r2(t.cashInHand), balanceDue: r2(t.balanceDue) };
}
