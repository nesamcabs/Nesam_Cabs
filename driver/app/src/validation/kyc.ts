// Driver onboarding validation (spec page 13). The wizard collects only:
//   step 1  selfie + driving licence
//   step 2  vehicle: registration number (detected from the register), RC,
//           insurance, FC, permit and the vehicle-front photo
// Vendor employee drivers have step 1 only — their vehicle is assigned by the
// vendor. Dates are compared as local calendar days (the Web used UTC, which
// misjudged expiry before 05:30 IST). The format validators below are shared
// with the profile screen.
import type { IdentityDetails, RegistrationData } from '../types/driver';

export type Errors = Record<string, string>;

export function localDateISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export const isFutureDate = (iso: string, today = localDateISO()) => !!iso && iso > today;

export function ageOn(dob: string, now = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return 0;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return age;
}

// Verhoeff checksum tables (UIDAI Aadhaar).
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function isValidAadhaar(value: string): boolean {
  const v = value.replace(/\s/g, '');
  if (!/^[2-9]\d{11}$/.test(v)) return false;
  let c = 0;
  const digits = v.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![digits[i]!]!]!;
  return c === 0;
}

export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** The forms the identity numbers are compared and stored in (spaces dropped; PAN upper-case). */
export const normalizeAadhaar = (v: string | undefined) => (v ?? '').replace(/\s/g, '');
export const normalizePan = (v: string | undefined) => (v ?? '').trim().toUpperCase();
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const UPI_RE = /^[A-Za-z0-9.\-_]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;
export const VEHICLE_NO_RE = /^[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,3}[\s-]?\d{1,4}$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;

/**
 * TEMPORARILY OFF: the vehicle-register (VAHAN) provider key is not available yet.
 * While false the registration form never calls the server lookup: the partner
 * types the registration number and picks the vehicle type by hand, and NESAM
 * verifies the vehicle from the uploaded documents. Set to true to bring back
 * automatic detection (the lookupVehicleByRegistration function must be configured).
 */
export const AUTO_VEHICLE_DETECTION = false;

export interface ValidateOptions {
  /** A vendor's employee: no vehicle step. */
  fleetDriver?: boolean;
  /**
   * Update / resubmission: the identity already saved. A number identical to it (after normalising) is not validated again, so a
   * legacy value that predates the current checks cannot block an unrelated document update. Omit at signup: every number is validated.
   */
  originalIdentity?: Partial<IdentityDetails>;
  /** Override AUTO_VEHICLE_DETECTION (tests). */
  autoDetect?: boolean;
  today?: string;
}

/** Plate as printed, with or without spaces/hyphens. */
export const normalizePlate = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isPlate = (v: string) => {
  const n = normalizePlate(v);
  return (n.length >= 6 && /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(n)) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(n);
};

export function validateStep(step: number, d: RegistrationData, opts: ValidateOptions = {}): Errors {
  const today = opts.today ?? localDateISO();
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
    // Aadhaar and PAN are optional; a number that is entered must be valid.
    const id = d.identity;
    const was = opts.originalIdentity;
    const aadhaar = normalizeAadhaar(id?.aadhaarNumber);
    const pan = normalizePan(id?.panNumber);
    if (aadhaar && (!was || aadhaar !== normalizeAadhaar(was.aadhaarNumber)) && !isValidAadhaar(aadhaar)) e.aadhaarNumber = 'Enter a valid 12-digit Aadhaar number';
    if (pan && (!was || pan !== normalizePan(was.panNumber)) && !PAN_RE.test(pan)) e.panNumber = 'Enter a valid PAN (e.g. ABCDE1234F)';
  }

  if (step === 2 && !opts.fleetDriver) {
    const v = d.vehicle;
    if (!isPlate(v.vehicleNumber)) e.vehicleNumber = 'Enter a valid registration number (e.g. TN 01 AB 1234)';
    else if (!(opts.autoDetect ?? AUTO_VEHICLE_DETECTION)) {
      // Manual entry: the partner must choose the vehicle type themselves.
      if (!v.vahan?.manualType) e.vehicleType = 'Choose your vehicle type.';
    } else if (!v.vahan || v.vahan.lookupId !== normalizePlate(v.vehicleNumber)) e.vehicleNumber = 'Check the vehicle first: tap "Detect vehicle".';
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

export const maskAccount = (n: string) => (n.length > 4 ? `${'•'.repeat(Math.min(n.length - 4, 8))}${n.slice(-4)}` : n);
export const maskAadhaar = (n: string) => {
  const d = n.replace(/\s/g, '');
  return d.length === 12 ? `XXXX XXXX ${d.slice(-4)}` : d;
};
