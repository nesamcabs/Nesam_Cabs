// Driver onboarding validation (spec page 13). The wizard collects only:
//   step 1  selfie + driving licence
//   step 2  vehicle: registration number (detected from the register), RC,
//           insurance, FC, permit and the vehicle-front photo
// A vendor's employee driver has step 1 only — the vendor assigns the vehicle.
// Mirrors driver/app/src/validation/kyc.ts.
import type { RegistrationData } from '../types';

export type Errors = Record<string, string>;

/** Today in India (YYYY-MM-DD); document validity is a calendar-day matter. */
export function indiaToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const isFutureDate = (iso: string, today = indiaToday()) => !!iso && iso > today;

/** Plate as printed, with or without spaces/hyphens. */
export const normalizePlate = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isPlate = (v: string) => {
  const n = normalizePlate(v);
  return (n.length >= 6 && /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(n)) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(n);
};

/**
 * TEMPORARILY OFF: the vehicle-register (VAHAN) provider key is not available yet.
 * While false the registration form never calls the server lookup: the partner
 * types the registration number and picks the vehicle type by hand, and NESAM
 * verifies the vehicle from the uploaded documents. Set to true to bring back
 * automatic detection (the lookupVehicleByRegistration function must be configured).
 */
export const AUTO_VEHICLE_DETECTION = false;

export interface ValidateOptions {
  fleetDriver?: boolean;
  /** Override AUTO_VEHICLE_DETECTION (tests). */
  autoDetect?: boolean;
  today?: string;
}

export function validateStep(step: number, d: RegistrationData, opts: ValidateOptions = {}): Errors {
  const today = opts.today ?? indiaToday();
  const e: Errors = {};
  const req = (key: string, val: string, msg = 'Required') => {
    if (!val || !val.trim()) e[key] = msg;
  };

  if (step === 1) {
    req('photoUrl', d.profile.photoUrl, 'A selfie is required');
    const l = d.license;
    if (l.number.replace(/[\s-]/g, '').length < 10 || !/^[A-Z]{2}/i.test(l.number.trim())) e.licenseNumber = 'Enter a valid driving licence number';
    req('licenseExpiry', l.expiryDate);
    if (l.expiryDate && !isFutureDate(l.expiryDate, today)) e.licenseExpiry = 'Licence has expired';
    req('dlFront', l.frontPhotoUrl, 'Licence front photo is required');
    req('dlBack', l.backPhotoUrl, 'Licence back photo is required');
  }

  if (step === 2 && !opts.fleetDriver) {
    const v = d.vehicle;
    if (!isPlate(v.vehicleNumber)) e.vehicleNumber = 'Enter a valid registration number (e.g. TN 01 AB 1234)';
    else if (!(opts.autoDetect ?? AUTO_VEHICLE_DETECTION)) {
      // Manual entry: the partner must choose the vehicle type themselves.
      if (!v.vahan?.manualType) e.vehicleType = 'Choose your vehicle type.';
    } else if (!v.vahan || v.vahan.lookupId !== normalizePlate(v.vehicleNumber)) e.vehicleNumber = 'Check the vehicle first: click "Detect vehicle".';
    else if (v.vahan.status === 'not_found') e.vehicleNumber = 'This registration number was not found in the vehicle register. Check it and try again.';
    else if (v.vahan.duplicate) e.vehicleNumber = 'This vehicle is already registered with another NESAM partner. Contact NESAM support.';
    else if (v.vahan.status !== 'found' && !v.vahan.manualType) e.vehicleType = 'Choose your vehicle type.';
    req('rcDocUrl', v.rcDocUrl, 'RC photo is required');
    req('insuranceDocUrl', v.insuranceDocUrl, 'Insurance photo is required');
    req('insuranceExpiry', v.insuranceExpiry);
    if (v.insuranceExpiry && !isFutureDate(v.insuranceExpiry, today)) e.insuranceExpiry = 'Insurance has expired';
    req('fitnessDocUrl', v.fitnessDocUrl, 'FC photo is required');
    req('fitnessExpiry', v.fitnessExpiry);
    if (v.fitnessExpiry && !isFutureDate(v.fitnessExpiry, today)) e.fitnessExpiry = 'Fitness certificate has expired';
    req('statePermitDocUrl', v.statePermitDocUrl, 'Permit photo is required');
    req('permitExpiry', v.permitExpiry);
    if (v.permitExpiry && !isFutureDate(v.permitExpiry, today)) e.permitExpiry = 'Permit has expired';
    req('frontPhotoUrl', v.frontPhotoUrl, 'Vehicle front photo is required');
  }

  return e;
}
