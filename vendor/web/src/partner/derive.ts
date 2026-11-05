// Readings the Partner screens share: booking stage, assignment deadline, document state and assignment eligibility.
// The server re-checks every rule; these only decide what the screen shows and enables.
import type { FleetDriver, FleetVehicle, OperationsConfig, VendorTrip } from '../types';
import { daysUntil, dayTime, isoDay } from './format';
import type { BadgeKind } from './ui';

export type BookingStage = 'Accepted' | 'Upcoming' | 'On Trip' | 'Completed' | 'Cancelled';

export function stageOf(t: VendorTrip): BookingStage {
  if (t.status === 'Completed') return 'Completed';
  if (t.status === 'Cancelled' || t.status === 'Rejected') return 'Cancelled';
  if (t.status === 'Ongoing' || t.tripSubStatus === 'Reached Pickup' || t.tripSubStatus === 'Trip Started' || t.tripSubStatus === 'Trip Ended') return 'On Trip';
  return t.driverId && t.vehicleId ? 'Upcoming' : 'Accepted';
}

/** The detail-page status words of the reference. */
export function stateLabel(t: VendorTrip): [string, BadgeKind] {
  const st = stageOf(t);
  if (st === 'Completed') return ['Completed', 'green'];
  if (st === 'Cancelled') return ['Cancelled', 'neutral'];
  if (t.tripSubStatus === 'Trip Started' || t.status === 'Ongoing') return ['Trip in progress', 'red'];
  if (t.tripSubStatus === 'Reached Pickup') return ['Reached pickup', 'neutral'];
  if (st === 'Upcoming') return ['Driver assigned', 'neutral'];
  return ['Assignment pending', 'amber'];
}

/** Assign-by time: the server stores it on acceptance; older duties use the same rule from the acceptance time. */
export function assignDeadline(t: VendorTrip, ops: OperationsConfig): Date | null {
  if (t.assignBy) return t.assignBy;
  const accepted = t.acceptedAt?.getTime();
  if (!accepted) return null;
  const byWindow = accepted + ops.assignmentWindowHours * 3600000;
  const pickup = t.pickupAt?.getTime();
  if (!pickup) return new Date(byWindow);
  const preferred = Math.min(byWindow, pickup - ops.assignBeforePickupHours * 3600000);
  return new Date(preferred > accepted ? preferred : Math.min(byWindow, pickup));
}

export const canChangeTeam = (t: VendorTrip) => {
  const st = stageOf(t);
  return (st === 'Accepted' || st === 'Upcoming') && (!t.tripSubStatus || t.tripSubStatus === 'Not Started');
};

// ── Documents ──────────────────────────────────────────────────────────────

export type DocState = 'Verified' | 'Expired' | 'Expiring' | 'Rejected' | 'Pending';
export const docKind = (s: DocState): BadgeKind => (s === 'Verified' ? 'green' : s === 'Rejected' || s === 'Expired' ? 'amber' : 'neutral');

const expiryState = (iso: string, now: number): DocState | null => {
  const d = daysUntil(iso, now);
  if (d === null) return null;
  if (d < 0) return 'Expired';
  if (d <= 15) return 'Expiring';
  return null;
};

export function driverDocState(d: FleetDriver, now = Date.now()): DocState {
  if (d.docStatus === 'Rejected' || d.accountStatus === 'Rejected') return 'Rejected';
  const e = expiryState(d.licenseExpiry, now);
  if (e) return e;
  return d.accountStatus === 'Approved' ? 'Verified' : 'Pending';
}

export const VEHICLE_DOCS: [keyof FleetVehicle['expiries'], string][] = [['rc', 'RC'], ['insurance', 'Insurance'], ['fitness', 'Fitness certificate'], ['permit', 'Permit'], ['puc', 'PUC']];

export function vehicleDocState(v: FleetVehicle, now = Date.now()): DocState {
  if (v.docStatus === 'Rejected') return 'Rejected';
  const states = VEHICLE_DOCS.map(([k]) => expiryState(v.expiries[k], now)).filter(Boolean) as DocState[];
  if (states.includes('Expired')) return 'Expired';
  if (states.includes('Expiring')) return 'Expiring';
  return v.docStatus === 'Approved' ? 'Verified' : 'Pending';
}

/** Earliest recorded expiry ("Documents valid until"). */
export function vehicleValidUntil(v: FleetVehicle): string {
  const dates = VEHICLE_DOCS.map(([k]) => v.expiries[k]).filter(Boolean).sort();
  return dates[0] ?? '';
}

export const shortDate = (iso: string): string => {
  if (!iso) return '';
  const t = Date.parse(iso.length === 10 ? `${iso}T12:00:00+05:30` : iso);
  return Number.isFinite(t) ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(t)) : iso;
};

// ── Assignment eligibility (shown as disabled options with the reason) ─────

const tripEnd = (t: VendorTrip) => isoDay(t.pickupAt ?? null);

export function driverBlocker(d: FleetDriver, t: VendorTrip, trips: VendorTrip[]): string {
  if (d.accountStatus !== 'Approved') return d.accountStatus === 'Rejected' ? 'Document rejected · upload again' : 'Verification pending';
  if (d.suspended) return 'Account suspended';
  if (d.licenseExpiry && tripEnd(t) && d.licenseExpiry.slice(0, 10) < tripEnd(t)) return 'Driving licence on hold';
  const busy = trips.find((x) => x.id !== t.id && x.driverId === d.id && stageOf(x) !== 'Completed' && stageOf(x) !== 'Cancelled'
    && x.pickupAt && t.pickupAt && Math.abs(x.pickupAt.getTime() - t.pickupAt.getTime()) < 6 * 3600000);
  if (busy) return `Assigned to ${busy.bookingId}`;
  return '';
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function vehicleBlocker(v: FleetVehicle, t: VendorTrip, trips: VendorTrip[]): string {
  if (v.docStatus !== 'Approved') return v.docStatus === 'Rejected' ? 'Document rejected · upload again' : 'Verification pending';
  if (v.status !== 'Active') return v.status === 'Inactive' ? 'Marked inactive' : v.status;
  if (t.vehicleCategory && v.category && norm(v.category) !== norm(t.vehicleCategory)) return `${t.vehicleCategory} required`;
  const end = tripEnd(t);
  if (end && VEHICLE_DOCS.some(([k]) => v.expiries[k] && v.expiries[k].slice(0, 10) < end)) return 'Document expires before trip ends';
  const busy = trips.find((x) => x.id !== t.id && x.vehicleId === v.id && stageOf(x) !== 'Completed' && stageOf(x) !== 'Cancelled'
    && x.pickupAt && t.pickupAt && Math.abs(x.pickupAt.getTime() - t.pickupAt.getTime()) < 6 * 3600000);
  if (busy) return `Assigned to ${busy.bookingId}`;
  return '';
}

/** Reference car artwork by model / category. */
export function carImage(v: Pick<FleetVehicle, 'category' | 'model' | 'make'>): string {
  const k = `${v.make} ${v.model} ${v.category}`.toLowerCase();
  if (/crysta/.test(k)) return '/brand/cars/crysta.webp';
  if (/innova/.test(k)) return '/brand/cars/innova.jpeg';
  if (/carens/.test(k)) return '/brand/cars/carens.png';
  if (/suv|ertiga|xl6|marazzo|muv|7/.test(k)) return '/brand/cars/suv.webp';
  return '/brand/cars/sedan.webp';
}

/** "Assigned · NSM-…" / "On duty · NSM-…" / "Available for new duties" for a vehicle or driver. */
export function dutyLine(trips: VendorTrip[], match: (t: VendorTrip) => boolean, held: string): string {
  const live = trips.find((t) => match(t) && stageOf(t) === 'On Trip');
  if (live) return `On duty · ${live.bookingId}`;
  const next = trips.filter((t) => match(t) && stageOf(t) === 'Upcoming').sort((a, b) => (a.pickupAt?.getTime() ?? 0) - (b.pickupAt?.getTime() ?? 0))[0];
  if (next) return `Assigned · ${next.bookingId}`;
  return held;
}

export const deadlineText = (d: Date | null) => (d ? dayTime(d) : 'Not set');
