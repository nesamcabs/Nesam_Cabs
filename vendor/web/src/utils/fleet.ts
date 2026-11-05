// Fleet helpers: plate handling, per-vehicle validation and the FleetDetails the application stores.
// Pure, no I/O. A vehicle needs only its registration number to join an application: there is no
// register lookup, and documents are optional extras NESAM can ask for during review.
// Mirrored in vendor/{app,web}/src/utils/fleet.ts.
import type { FleetDetails, FleetVehicleDoc } from '../types';

/** Plate as printed, with or without spaces/hyphens. */
export const normalizePlate = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isPlate = (v: string) => {
  const n = normalizePlate(v);
  return (n.length >= 6 && /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(n)) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(n);
};

/** "TN01AB1234" → "TN 01 AB 1234" (falls back to the normalised text for odd plates). */
export function displayPlate(v: string): string {
  const n = normalizePlate(v);
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(n);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : n;
}

/** Today in India (YYYY-MM-DD); document validity is a calendar-day matter. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const emptyVehicle = (): FleetVehicleDoc => ({
  registrationNumber: '',
  source: 'manual',
  category: '',
  make: '',
  model: '',
  fuelType: '',
  passengerSeats: 0,
  seatClass: '',
  year: '',
  issues: [],
  insuranceUpto: '',
  fitnessUpto: '',
  permitUpto: '',
  rcFiles: [],
  insuranceFiles: [],
  fitnessFiles: [],
  permitFiles: [],
  frontPhotoFiles: [],
});

/** A vehicle known only by its registration number. */
export const vehicleFromPlate = (plate: string): FleetVehicleDoc => ({ ...emptyVehicle(), registrationNumber: normalizePlate(plate) });

export type VehicleErrors = Partial<Record<'registrationNumber', string>>;

/** What a vehicle needs before it joins the application: a valid plate that is not already listed. */
export function validateVehicle(v: Pick<FleetVehicleDoc, 'registrationNumber'>, ctx: { others: string[] }): VehicleErrors {
  const plate = normalizePlate(v.registrationNumber);
  if (!isPlate(plate)) return { registrationNumber: 'Enter a valid registration number (e.g. TN 01 AB 1234).' };
  if (ctx.others.includes(plate)) return { registrationNumber: 'This vehicle is already in your application.' };
  return {};
}

/** The FleetDetails stored on vendors/{uid}: the vehicles plus per-document aggregates for the viewers. */
export function buildFleetDetails(vehicles: FleetVehicleDoc[]): FleetDetails {
  return {
    vehicleTypes: [...new Set(vehicles.map((v) => v.category).filter(Boolean))],
    fleetSize: vehicles.length,
    rcFiles: vehicles.flatMap((v) => v.rcFiles),
    vehiclePhotos: vehicles.flatMap((v) => v.frontPhotoFiles),
    insuranceFiles: vehicles.flatMap((v) => v.insuranceFiles),
    fcFiles: vehicles.flatMap((v) => v.fitnessFiles),
    permitFiles: vehicles.flatMap((v) => v.permitFiles),
    plates: vehicles.map((v) => normalizePlate(v.registrationNumber)),
    vehicles,
  };
}

/** True when the fleet lists at least one vehicle and every plate is valid and unique. */
export function fleetIsComplete(fleet: FleetDetails | null): boolean {
  const list = fleet?.vehicles;
  if (!list?.length) return false;
  const seen = new Set<string>();
  return list.every((v) => {
    const plate = normalizePlate(v.registrationNumber);
    if (!isPlate(plate) || seen.has(plate)) return false;
    seen.add(plate);
    return true;
  });
}
