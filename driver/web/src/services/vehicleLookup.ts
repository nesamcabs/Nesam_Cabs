// Automatic vehicle detection: asks the server (which holds the VAHAN provider
// key) to look the registration number up. The browser never talks to the
// register itself and never sees the raw provider response.
import { callFunction } from './callables';
import type { DetectedVehicle, VahanSnapshot, VehicleLookupResult } from '../types';

export async function lookupVehicle(registrationNumber: string): Promise<VehicleLookupResult> {
  return callFunction<{ registrationNumber: string }, VehicleLookupResult>('lookupVehicleByRegistration', { registrationNumber }, 45000);
}

/** The vehicle fields the onboarding form takes from a detected vehicle. */
export function vehiclePatchFrom(d: DetectedVehicle) {
  return {
    make: d.make,
    model: [d.model, d.variant].filter(Boolean).join(' ').trim() || d.model,
    year: d.manufactureYear,
    color: d.colour,
    fuelType: d.fuelType || 'Diesel',
    // Seats exclude the driver (page 14: "6+1" is six passengers).
    capacity: d.passengerSeats || 0,
    vehicleType: d.category,
  };
}

export function snapshotFrom(result: VehicleLookupResult, manualType: boolean): VahanSnapshot {
  const base = { lookupId: result.registrationNumber, fetchedAtMs: Date.now(), manualType };
  if (result.status !== 'found') {
    return { ...base, status: result.status, duplicate: false, issues: [], seatClass: '', specClass: '', usage: '', validity: { fitnessUpto: '', insuranceUpto: '', permitUpto: '', taxUpto: '', pucUpto: '' } };
  }
  const v = result.vehicle;
  return {
    ...base,
    status: 'found',
    fetchedAtMs: result.fetchedAtMs,
    duplicate: result.duplicate,
    issues: result.issues.map((i) => i.code),
    seatClass: v.seatClass,
    specClass: v.specClass,
    usage: v.usage,
    validity: v.validity,
  };
}

/** Snapshot stored when the partner chose the vehicle type by hand (no register lookup). */
export function manualSnapshot(registrationNumber: string): VahanSnapshot {
  return {
    status: 'unavailable',
    lookupId: registrationNumber,
    fetchedAtMs: Date.now(),
    duplicate: false,
    issues: [],
    seatClass: '',
    specClass: '',
    usage: '',
    manualType: true,
    validity: { fitnessUpto: '', insuranceUpto: '', permitUpto: '', taxUpto: '', pucUpto: '' },
  };
}
