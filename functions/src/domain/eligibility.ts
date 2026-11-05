// Duty eligibility rules shared by every claim, direct assignment, dispatch and
// reassignment path (Vehicle Category and Vendor Duty Rules; Tariff & Operations v2 p.14-15).
// Pure functions only: the callers read the documents and enforce the verdict in a
// transaction, so a client that skips its own checks changes nothing.

// ── Vehicle class matrix ────────────────────────────────────────────────────

/** What a booked duty asks for. */
export type DutyClass = 'sedan' | 'suv6' | 'suv7' | 'innova' | 'crysta';
/** What a vehicle is. A vehicle is exactly one class. */
export type VehicleClass = 'sedan' | 'suv6' | 'suv7' | 'innova6' | 'innova7' | 'crysta6' | 'crysta7';

export const DUTY_CLASSES: readonly DutyClass[] = ['sedan', 'suv6', 'suv7', 'innova', 'crysta'];
export const VEHICLE_CLASSES: readonly VehicleClass[] = ['sedan', 'suv6', 'suv7', 'innova6', 'innova7', 'crysta6', 'crysta7'];

/** The confirmed 7 × 5 matrix: which duty classes an attached vehicle class may serve. */
export const CLASS_MATRIX: Readonly<Record<VehicleClass, readonly DutyClass[]>> = {
  sedan: ['sedan'],
  suv6: ['sedan', 'suv6'],
  suv7: ['sedan', 'suv6', 'suv7'],
  innova6: ['sedan', 'suv6', 'innova'],
  innova7: ['sedan', 'suv6', 'suv7', 'innova'],
  crysta6: ['sedan', 'suv6', 'innova', 'crysta'],
  crysta7: ['sedan', 'suv6', 'suv7', 'innova', 'crysta'],
};

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const asVehicleClass = (v: unknown): VehicleClass | null => (VEHICLE_CLASSES as readonly string[]).includes(norm(v)) ? (norm(v) as VehicleClass) : null;
const asDutyClass = (v: unknown): DutyClass | null => (DUTY_CLASSES as readonly string[]).includes(norm(v)) ? (norm(v) as DutyClass) : null;

/**
 * The duty class of a booked category. An explicit `dutyClass` on the category wins (set by
 * admin); otherwise it is read from the name and the passenger seats. null = cannot be
 * classified, in which case the caller falls back to seats only and surfaces a warning.
 */
export function dutyClassOf(category: { dutyClass?: unknown; name?: unknown; seats?: unknown; seatingCapacity?: unknown }): DutyClass | null {
  const explicit = asDutyClass(category.dutyClass);
  if (explicit) return explicit;
  const name = norm(category.name);
  const seats = Number(category.seats ?? category.seatingCapacity) || 0;
  if (!name && !seats) return null;
  if (/crysta/.test(name)) return 'crysta';
  if (/innova/.test(name)) return 'innova';
  if (/(suv|xuv|ertiga|marazzo|carens|xl6|scorpio|fortuner|muv|mpv)/.test(name)) return seats >= 7 || /7\s*\+\s*1/.test(name) ? 'suv7' : 'suv6';
  if (/(sedan|dzire|etios|aura|verna|mini|hatch|micro|swift|wagon|alto|auto)/.test(name)) return 'sedan';
  if (seats >= 7) return 'suv7';
  if (seats >= 6) return 'suv6';
  if (seats > 0) return 'sedan';
  return null;
}

/** The class of an approved vehicle record (explicit `vehicleClass` wins over what is inferred). */
export function vehicleClassOf(v: { vehicleClass?: unknown; category?: unknown; make?: unknown; model?: unknown; name?: unknown; seatingCapacity?: unknown; seats?: unknown }): VehicleClass | null {
  const explicit = asVehicleClass(v.vehicleClass);
  if (explicit) return explicit;
  const seats = Math.round(Number(v.seatingCapacity ?? v.seats) || 0);
  const text = [v.make, v.model, v.name, v.category].map(norm).join(' ');
  const seven = seats >= 7;
  if (/crysta/.test(text)) return seven ? 'crysta7' : 'crysta6';
  if (/innova|hycross/.test(text)) return seven ? 'innova7' : 'innova6';
  if (/(suv|xuv|ertiga|marazzo|carens|xl6|scorpio|fortuner|muv|mpv|tempo|traveller|van)/.test(text) || seats >= 6) return seven ? 'suv7' : 'suv6';
  if (seats > 0 || /(sedan|dzire|etios|aura|verna|mini|hatch|swift|wagon|alto)/.test(text)) return 'sedan';
  return null;
}

export const classAllows = (vehicle: VehicleClass, duty: DutyClass): boolean => CLASS_MATRIX[vehicle].includes(duty);

export interface ClassVerdict { ok: boolean; reason: string; vehicleClass: VehicleClass | null; dutyClass: DutyClass | null }

/**
 * Category compatibility plus passenger capacity. Capacity counts passengers only (the
 * driver's seat is excluded) and is checked separately from the category: a larger class
 * label never overrides a vehicle that physically seats fewer passengers.
 */
export function vehicleServesDuty(
  vehicle: Parameters<typeof vehicleClassOf>[0] & { seatingCapacity?: unknown },
  duty: { dutyClass?: DutyClass | null; passengerSeatsRequired?: unknown },
): ClassVerdict {
  const vehicleClass = vehicleClassOf(vehicle);
  const dutyClass = duty.dutyClass ?? null;
  const seats = Math.round(Number(vehicle.seatingCapacity ?? vehicle.seats) || 0);
  const needed = Math.round(Number(duty.passengerSeatsRequired) || 0);
  if (needed > 0 && seats > 0 && seats < needed) {
    return { ok: false, reason: `This vehicle has ${seats} passenger seats but the booking needs ${needed}.`, vehicleClass, dutyClass };
  }
  if (dutyClass && vehicleClass && !classAllows(vehicleClass, dutyClass)) {
    return { ok: false, reason: `A ${vehicleClass} vehicle cannot serve a ${dutyClass} duty.`, vehicleClass, dutyClass };
  }
  return { ok: true, reason: '', vehicleClass, dutyClass };
}

/** Duty classes a vehicle may be offered (what an owner-driver may see in Open Duties). */
export function dutiesServedBy(vehicleClass: VehicleClass | null): readonly DutyClass[] {
  return vehicleClass ? CLASS_MATRIX[vehicleClass] : [];
}

// ── Trip window and schedule overlap ────────────────────────────────────────

export interface TripWindow {
  /** Pickup, epoch ms. */
  start: number;
  /** Estimated end of the trip, epoch ms. */
  end: number;
  pickup?: { lat: number; lng: number } | null;
  drop?: { lat: number; lng: number } | null;
}

export interface ScheduleConfig {
  /** Operating buffer between two duties of the same resource. */
  bufferMinutes: number;
  /** Planning speed used to estimate repositioning between a drop and the next pickup. */
  repositionKmh: number;
  /** Used when a route's duration is unknown. */
  defaultTripMinutes: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = { bufferMinutes: 45, repositionKmh: 40, defaultTripMinutes: 180 };

export function scheduleConfigOf(v: unknown): ScheduleConfig {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pick = (x: unknown, d: number, min: number, max: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : d);
  return {
    bufferMinutes: pick(o.assignmentBufferMinutes, DEFAULT_SCHEDULE.bufferMinutes, 0, 600),
    repositionKmh: pick(o.repositionSpeedKmh, DEFAULT_SCHEDULE.repositionKmh, 10, 120),
    defaultTripMinutes: pick(o.defaultTripMinutes, DEFAULT_SCHEDULE.defaultTripMinutes, 30, 2880),
  };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (lat: unknown, lng: unknown) => (finite(lat) && finite(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null);

/** Estimated window of a booking: pickup → pickup + route duration (or the round-trip end date). */
export function tripWindowOf(b: Record<string, any>, pickupMs: number | null, cfg: ScheduleConfig = DEFAULT_SCHEDULE): TripWindow | null {
  if (pickupMs === null || !finite(pickupMs)) return null;
  let end = pickupMs + (finite(b.durationMin) && b.durationMin > 0 ? b.durationMin : cfg.defaultTripMinutes) * 60000;
  // A round trip occupies the vehicle through the end of its last billable day.
  const ret = typeof b.tripEndAt === 'string' ? Date.parse(b.tripEndAt) : b.tripEndAt?.toMillis?.();
  if (finite(ret) && ret > pickupMs) end = Math.max(end, ret);
  return { start: pickupMs, end, pickup: point(b.pickupLat, b.pickupLng), drop: point(b.dropLat, b.dropLng) };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Minutes a resource needs to get from one trip's drop to another's pickup (road ≈ 1.3 × straight line). */
export function repositionMinutes(from: TripWindow, to: TripWindow, cfg: ScheduleConfig): number {
  if (!from.drop || !to.pickup) return 0;
  return Math.ceil(((haversineKm(from.drop, to.pickup) * 1.3) / cfg.repositionKmh) * 60);
}

export interface ScheduleVerdict {
  ok: boolean;
  /** 'before' → the existing duty ends too late for the candidate; 'after' → the candidate runs into the existing duty. */
  kind: '' | 'before' | 'after' | 'overlap';
  /** Earliest the resource is ready for the candidate pickup, epoch ms (kind 'before'). */
  readyAt: number | null;
}

/**
 * A candidate duty is available for a resource when, against every other duty it holds,
 * either the other finishes + repositions + buffer before the candidate's pickup, or the
 * candidate finishes + repositions + buffer before the other's pickup. A running trip does
 * not block a later duty that it is expected to clear in time.
 */
export function scheduleVerdict(candidate: TripWindow, other: TripWindow, cfg: ScheduleConfig = DEFAULT_SCHEDULE): ScheduleVerdict {
  const buffer = cfg.bufferMinutes * 60000;
  const otherFirstReady = other.end + repositionMinutes(other, candidate, cfg) * 60000 + buffer;
  if (otherFirstReady <= candidate.start) return { ok: true, kind: '', readyAt: otherFirstReady };
  const candFirstReady = candidate.end + repositionMinutes(candidate, other, cfg) * 60000 + buffer;
  if (candFirstReady <= other.start) return { ok: true, kind: '', readyAt: null };
  const overlaps = candidate.start < other.end && other.start < candidate.end;
  return { ok: false, kind: overlaps ? 'overlap' : other.start <= candidate.start ? 'before' : 'after', readyAt: otherFirstReady };
}

// ── Document validity through the trip ──────────────────────────────────────

/** Expiry timestamps (epoch ms) of documents that must remain valid through `until`. */
export function expiredBefore(expiries: { label: string; at: number | null }[], until: number): string[] {
  return expiries.filter((e) => e.at !== null && e.at < until).map((e) => e.label);
}

/** An expiry date string ('YYYY-MM-DD' is valid through the end of that day in India). */
export function expiryMs(v: unknown): number | null {
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') return (v as { toMillis(): number }).toMillis();
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? `${v.trim()}T23:59:59+05:30` : v);
  return Number.isFinite(t) ? t : null;
}
