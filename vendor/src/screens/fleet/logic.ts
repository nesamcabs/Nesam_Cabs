// Fleet status words (reference wAccount / wDocState): account state, document state and what the office still has to do.
import type { FleetDriver, FleetVehicle } from '../../types/operations';
import type { Tone } from '../../components/kit/core';
import { daysUntil } from '../../utils/wallet';
import { EXPIRY_WARNING_DAYS } from '../../config/constants';

export type DocState = 'Verified' | 'Expiring soon' | 'Expired' | 'Waiting for approval' | 'Rejected';

export const VEHICLE_DOCS: { key: 'insuranceExpiry' | 'permitExpiry' | 'fitnessExpiry'; label: string }[] = [
  { key: 'insuranceExpiry', label: 'Insurance' },
  { key: 'permitExpiry', label: 'Permit' },
  { key: 'fitnessExpiry', label: 'Fitness (FC)' },
];

/** The earliest document expiry of a vehicle (yyyy-mm-dd) and how many days remain. */
export function nextExpiry(v: FleetVehicle): { label: string; date: string; days: number } | null {
  const list = VEHICLE_DOCS.map((d) => ({ label: d.label, date: v[d.key], days: daysUntil(v[d.key]) }))
    .filter((x): x is { label: string; date: string; days: number } => x.days !== null)
    .sort((a, b) => a.days - b.days);
  return list[0] ?? null;
}

export function vehicleDocState(v: FleetVehicle): DocState {
  if (v.docStatus === 'Rejected') return 'Rejected';
  if (v.docStatus !== 'Approved') return 'Waiting for approval';
  const n = nextExpiry(v);
  if (n && n.days < 0) return 'Expired';
  if (n && n.days <= EXPIRY_WARNING_DAYS) return 'Expiring soon';
  return 'Verified';
}

export function driverDocState(d: FleetDriver): DocState {
  if (d.approvalStatus === 'Rejected' || d.docStatus === 'Rejected') return 'Rejected';
  if (d.approvalStatus !== 'Approved') return 'Waiting for approval';
  const days = daysUntil(d.licenseExpiry);
  if (days !== null && days < 0) return 'Expired';
  if (days !== null && days <= EXPIRY_WARNING_DAYS) return 'Expiring soon';
  return 'Verified';
}

export const docTone = (s: DocState): Tone => (s === 'Verified' ? 'green' : s === 'Rejected' || s === 'Expired' ? 'red' : 'amber');

export const vehicleStatusLabel = (v: FleetVehicle) => (v.status === 'Active' ? 'In service' : v.status);
export const vehicleStatusTone = (v: FleetVehicle): Tone => (v.status === 'Active' ? 'neutral' : v.status === 'Maintenance' ? 'amber' : 'neutral');

export const VEHICLE_FILTERS = ['All', 'In service', 'Maintenance', 'Inactive', 'Verified', 'Waiting for approval', 'Expiring soon', 'Expired', 'Rejected'] as const;
export const DRIVER_FILTERS = ['All', 'Active', 'Suspended', 'On trip', 'Verified', 'Waiting for approval', 'Expiring soon', 'Expired', 'Rejected'] as const;

export function vehicleMatches(v: FleetVehicle, q: string, filter: string): boolean {
  const query = q.trim().toLowerCase().replace(/\s+/g, '');
  if (query && ![v.vehicleNumber, v.id, v.model, v.make, v.category, v.assignedDriverName].some((x) => (x || '').toLowerCase().replace(/\s+/g, '').includes(query))) return false;
  if (filter === 'All') return true;
  return filter === vehicleStatusLabel(v) || filter === vehicleDocState(v);
}

export function driverMatches(d: FleetDriver, q: string, filter: string): boolean {
  const query = q.trim().toLowerCase().replace(/\s+/g, '');
  if (query && ![d.name, d.phone, d.licenseNumber, d.id, d.assignedVehicleNumber].some((x) => (x || '').toLowerCase().replace(/\s+/g, '').includes(query))) return false;
  if (filter === 'All') return true;
  if (filter === 'Active') return d.fleetStatus !== 'Suspended';
  if (filter === 'Suspended') return d.fleetStatus === 'Suspended';
  if (filter === 'On trip') return d.presenceStatus === 'On Trip';
  return filter === driverDocState(d);
}
