// Local duty ("continuous moving"): pure rules shared by the local-shift functions, the trip workflow and the tests.
//
// A vendor puts one of its drivers, in one of its vehicles, on local duty for a city and a time window. While the duty is
// on, the driver takes local orders one after another (Hourly Rental and / or Pickup & Drop) instead of receiving one
// assigned duty at a time. Every order is still an ordinary booking with the ordinary server trip workflow; these rules only
// decide which orders fit the duty, how many a driver may hold at once and how the duty's totals are worked out.

export type LocalMode = 'rental' | 'pickup_drop';
export const LOCAL_MODES: readonly LocalMode[] = ['rental', 'pickup_drop'];
export const LOCAL_MODE_LABEL: Record<LocalMode, string> = { rental: 'Hourly Rental', pickup_drop: 'Pickup & Drop' };

/** A Pickup & Drop order is a one-way trip inside one city; anything longer is outstation (customer app CITY_LIMIT_KM). */
export const LOCAL_PICKUP_DROP_MAX_KM = 40;

/** Shift window limits. */
export const SHIFT_MIN_MS = 60 * 60000;
export const SHIFT_MAX_MS = 16 * 3600000;
/** A duty may be planned up to a week ahead. */
export const SHIFT_PLAN_AHEAD_MS = 7 * 86400000;
/** The driver may start the duty this long before its planned start. */
export const SHIFT_EARLY_START_MS = 30 * 60000;

export const RADIUS_DEFAULT_KM = 15;
export const RADIUS_MIN_KM = 3;
export const RADIUS_MAX_KM = 60;

/** Board: an order at most this far from the driver (or the duty centre) is shown. Pickups outside the duty area never are. */
export const BOARD_LIMIT = 40;
/** Fleet orders whose pickup time passed less than this long ago are still shown (marked overdue). */
export const OVERDUE_GRACE_MS = 90 * 60000;

/** At most a current order and one next order at a time. */
export const MAX_HELD_ORDERS = 2;
/** A driver may hand back at most this many orders in one duty. */
export const MAX_RELEASES_PER_SHIFT = 3;

export const SHIFT_STATUSES = ['Scheduled', 'Active', 'Ended', 'Cancelled', 'Missed'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];
export const OPEN_SHIFT_STATUSES: readonly ShiftStatus[] = ['Scheduled', 'Active'];

interface BookingLike {
  tripType?: unknown;
  service?: unknown;
  distanceKm?: unknown;
  pricing?: { model?: unknown } | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0);

/**
 * Which local service a booking (or a published duty) is: an Hourly Rental, a Pickup & Drop inside one city, or neither
 * (outstation, airport, multicity …). The booked trip type and the pricing model are authoritative; the service name and
 * the distance only decide for older records that carry neither.
 */
export function localModeOf(b: BookingLike): LocalMode | null {
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

export function servicesOf(v: unknown): LocalMode[] {
  const list = Array.isArray(v) ? v : [];
  return LOCAL_MODES.filter((m) => list.includes(m));
}

/** Straight-line distance in km. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const isPoint = (p: unknown): p is { lat: number; lng: number } =>
  !!p && typeof p === 'object' && Number.isFinite((p as { lat?: unknown }).lat) && Number.isFinite((p as { lng?: unknown }).lng)
  && Math.abs((p as { lat: number }).lat) <= 90 && Math.abs((p as { lng: number }).lng) <= 180
  && !((p as { lat: number }).lat === 0 && (p as { lng: number }).lng === 0);

export function radiusOf(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : RADIUS_DEFAULT_KM;
  return Math.min(RADIUS_MAX_KM, Math.max(RADIUS_MIN_KM, n));
}

/** Why a duty window cannot be saved ('' when it can). `creating` also refuses a start that is long past. */
export function shiftWindowProblem(startMs: number, endMs: number, nowMs: number, creating = true): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'Choose when the local duty starts and ends.';
  if (endMs <= startMs) return 'The duty must end after it starts.';
  if (endMs - startMs < SHIFT_MIN_MS) return 'A local duty must be at least 1 hour long.';
  if (endMs - startMs > SHIFT_MAX_MS) return 'A local duty can be at most 16 hours long.';
  if (endMs <= nowMs) return 'The end time has already passed.';
  if (creating && startMs < nowMs - 60 * 60000) return 'The start time has already passed. Start the duty from now.';
  if (startMs - nowMs > SHIFT_PLAN_AHEAD_MS) return 'A local duty can be planned up to 7 days ahead.';
  return '';
}

/** Two time windows overlap. */
export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

export interface HeldOrder {
  id: string;
  code?: string;
  mode: LocalMode | null;
  status: string;
  subStatus: string;
}

/**
 * Whether a driver on local duty may take one more order. A driver holds at most a current order and one next order; an
 * Hourly Rental keeps the car for the whole package, so nothing else can be taken while one is held. Returns '' when the
 * order may be taken, else the reason to show.
 */
export function queueProblem(held: HeldOrder[], candidate: LocalMode): string {
  const rental = held.find((h) => h.mode === 'rental');
  if (rental) return `Finish your hourly rental${rental.code ? ` ${rental.code}` : ''} before taking another order.`;
  if (held.length >= MAX_HELD_ORDERS) return 'You already have a current order and a next order. Finish the current one first.';
  if (candidate === 'rental' && held.some((h) => h.subStatus === 'Not Started' && h.status !== 'Ongoing')) {
    return 'Start your next order before taking an hourly rental.';
  }
  return '';
}

/** Rental package clock: how much of the booked time is used, left and over. */
export function rentalClock(startMs: number | null, hours: number, nowMs: number) {
  const packageMs = Math.max(0, hours) * 3600000;
  if (!startMs || !Number.isFinite(startMs)) return { started: false, elapsedMs: 0, remainingMs: packageMs, overtimeMs: 0, progress: 0, packageMs };
  const elapsedMs = Math.max(0, nowMs - startMs);
  return {
    started: true,
    elapsedMs,
    remainingMs: Math.max(0, packageMs - elapsedMs),
    overtimeMs: Math.max(0, elapsedMs - packageMs),
    progress: packageMs > 0 ? Math.min(1, elapsedMs / packageMs) : 0,
    packageMs,
  };
}

export interface RentalUsage {
  schema: 1;
  packageHours: number;
  usedMinutes: number;
  overtimeMinutes: number;
  /** Whole hours beyond the package, counted up (for information; the office bills extra hours at actuals). */
  extraHours: number;
  extraHourRate: number;
  /** extraHours × the booked extra-hour rate, before tax. Not added to the fare: recorded for the office to bill. */
  indicativeExtra: number;
  includedKm: number;
}

/**
 * What an Hourly Rental used, measured by the server from its own start and end stamps. The tariff bills extra hours at
 * actuals (they are never added to the final fare automatically), so this is a record for the office, the vendor and
 * the driver, not a charge.
 */
export function rentalUsageOf(
  b: { tripType?: unknown; service?: unknown; pricing?: { model?: unknown; rentalHours?: unknown; extraHourRatePaise?: unknown; includedKm?: unknown } | null },
  startMs: number | null,
  endMs: number,
): RentalUsage | null {
  if (localModeOf(b) !== 'rental' || !startMs || !Number.isFinite(startMs) || endMs < startMs) return null;
  const p = b.pricing && typeof b.pricing === 'object' ? b.pricing : {};
  const hours = num((p as { rentalHours?: unknown }).rentalHours);
  if (!(hours > 0)) return null;
  const usedMinutes = Math.round((endMs - startMs) / 60000);
  const overtimeMinutes = Math.max(0, usedMinutes - hours * 60);
  const extraHours = overtimeMinutes > 0 ? Math.ceil(overtimeMinutes / 60) : 0;
  const extraHourRate = Math.round(num((p as { extraHourRatePaise?: unknown }).extraHourRatePaise)) / 100;
  return {
    schema: 1, packageHours: hours, usedMinutes, overtimeMinutes, extraHours, extraHourRate,
    indicativeExtra: Math.round(extraHours * extraHourRate * 100) / 100, includedKm: num((p as { includedKm?: unknown }).includedKm),
  };
}

export interface ShiftTripLike {
  status?: unknown;
  tripType?: unknown;
  service?: unknown;
  distanceKm?: unknown;
  pricing?: { model?: unknown } | null;
  fare?: unknown;
  totalKm?: unknown;
  vendorPayout?: unknown;
  tollCharges?: unknown;
  paymentSummary?: { totalPaid?: unknown; balanceDue?: unknown; partnerCashHeld?: unknown; companyCollected?: unknown } | null;
  rentalUsage?: { usedMinutes?: unknown; overtimeMinutes?: unknown } | null;
}

export interface ShiftTotals {
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
  /** Everything received for the duty's completed orders. */
  collected: number;
  /** Received by the driver (cash, UPI to the driver …): held by the fleet and settled with NESAM. */
  cashInHand: number;
  /** Paid to NESAM directly (online, office). */
  paidOnline: number;
  balanceDue: number;
  rentalMinutes: number;
  overtimeMinutes: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The duty's running totals, from its own bookings (the single source of truth). */
export function shiftTotals(trips: ShiftTripLike[]): ShiftTotals {
  const t: ShiftTotals = { orders: 0, completed: 0, active: 0, cancelled: 0, rental: 0, pickupDrop: 0, km: 0, fare: 0, payout: 0, tolls: 0, collected: 0, cashInHand: 0, paidOnline: 0, balanceDue: 0, rentalMinutes: 0, overtimeMinutes: 0 };
  for (const b of trips) {
    const status = str(b.status);
    if (status === 'Cancelled' || status === 'Rejected') {
      t.cancelled += 1;
      continue;
    }
    t.orders += 1;
    const mode = localModeOf(b);
    if (mode === 'rental') t.rental += 1;
    else t.pickupDrop += 1;
    if (status === 'Assigned' || status === 'Ongoing') t.active += 1;
    if (status !== 'Completed') continue;
    t.completed += 1;
    t.km += num(b.totalKm) || num(b.distanceKm);
    t.fare += num(b.fare);
    t.payout += num(b.vendorPayout);
    t.tolls += num(b.tollCharges);
    const ps = b.paymentSummary && typeof b.paymentSummary === 'object' ? b.paymentSummary : null;
    t.collected += num(ps?.totalPaid);
    t.cashInHand += num(ps?.partnerCashHeld);
    t.paidOnline += num(ps?.companyCollected);
    t.balanceDue += Math.max(0, num(ps?.balanceDue));
    if (b.rentalUsage && typeof b.rentalUsage === 'object') {
      t.rentalMinutes += num(b.rentalUsage.usedMinutes);
      t.overtimeMinutes += num(b.rentalUsage.overtimeMinutes);
    }
  }
  return { ...t, km: Math.round(t.km * 10) / 10, fare: r2(t.fare), payout: r2(t.payout), tolls: r2(t.tolls), collected: r2(t.collected), cashInHand: r2(t.cashInHand), paidOnline: r2(t.paidOnline), balanceDue: r2(t.balanceDue) };
}

/** Duty time worked so far, without breaks. */
export function dutyMinutes(startedAtMs: number | null, endedAtMs: number | null, breakMs: number, pausedAtMs: number | null, nowMs: number): number {
  if (!startedAtMs) return 0;
  const end = endedAtMs ?? nowMs;
  const openBreak = pausedAtMs && !endedAtMs ? Math.max(0, nowMs - pausedAtMs) : 0;
  return Math.max(0, Math.round((end - startedAtMs - Math.max(0, breakMs) - openBreak) / 60000));
}
