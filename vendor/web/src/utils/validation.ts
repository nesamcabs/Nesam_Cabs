/**
 * Pure form validators. Each returns an error message, or '' when valid.
 * Formats follow the official Indian specs (GSTIN, PAN, IFSC, Aadhaar
 * Verhoeff checksum, Indian mobile numbering plan).
 */

export const normalizeSpaces = (s: string) => s.replace(/\s+/g, ' ').trim();
export const digitsOnly = (s: string) => s.replace(/\D/g, '');

export function validatePersonName(value: string, label = 'Name'): string {
  const v = normalizeSpaces(value);
  if (!v) return `${label} is required.`;
  if (v.length < 2) return `${label} is too short.`;
  if (v.length > 80) return `${label} must be under 80 characters.`;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(v)) return `${label} may contain letters, spaces, dots and hyphens only.`;
  return '';
}

export function validateBusinessName(value: string): string {
  const v = normalizeSpaces(value);
  if (!v) return 'Business / agency name is required.';
  if (v.length < 2) return 'Business name is too short.';
  if (v.length > 100) return 'Business name must be under 100 characters.';
  if (!/[A-Za-z]/.test(v)) return 'Business name must contain letters.';
  return '';
}

export function validateEmail(value: string): string {
  const v = value.trim();
  if (!v) return 'Email address is required.';
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v)) return 'Enter a valid email address.';
  return '';
}

/** Optional 10-digit Indian mobile number that must differ from the login number. */
export function validateAltPhone(value: string, primaryE164: string): string {
  const v = digitsOnly(value);
  if (!v) return '';
  if (!/^[6-9]\d{9}$/.test(v)) return 'Enter a valid 10-digit mobile number.';
  if (primaryE164.endsWith(v)) return 'Alternate number must differ from your registered number.';
  return '';
}

export function validateRequired(value: string, label: string, max = 120): string {
  const v = normalizeSpaces(value);
  if (!v) return `${label} is required.`;
  if (v.length > max) return `${label} must be under ${max} characters.`;
  return '';
}

export function validatePincode(value: string): string {
  const v = value.trim();
  if (!v) return 'PIN code is required.';
  if (!/^[1-9]\d{5}$/.test(v)) return 'Enter a valid 6-digit PIN code.';
  return '';
}

export function validateGstin(value: string): string {
  const v = value.trim().toUpperCase();
  if (!v) return 'GSTIN is required.';
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) return 'Enter a valid 15-character GSTIN.';
  return '';
}

export function validateRegistrationNumber(value: string): string {
  const v = value.trim();
  if (!v) return 'Registration / license number is required.';
  if (!/^[A-Za-z0-9/\-. ]{4,30}$/.test(v)) return 'Use 4–30 letters, digits, "/", "-" or ".".';
  return '';
}

export function validatePan(value: string): string {
  const v = value.trim().toUpperCase();
  if (!v) return 'PAN is required.';
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) return 'Enter a valid 10-character PAN (e.g. ABCDE1234F).';
  return '';
}

export function validatePassport(value: string): string {
  const v = value.trim().toUpperCase();
  if (!v) return 'Passport number is required.';
  if (!/^[A-Z][0-9]{7}$/.test(v)) return 'Enter a valid passport number (1 letter + 7 digits).';
  return '';
}

// Verhoeff checksum tables (used by UIDAI for Aadhaar).
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
function verhoeffValid(num: string): boolean {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
  return c === 0;
}

export function validateAadhaar(value: string): string {
  const v = digitsOnly(value);
  if (!v) return 'Aadhaar number is required.';
  if (!/^[2-9]\d{11}$/.test(v) || !verhoeffValid(v)) return 'Enter a valid 12-digit Aadhaar number.';
  return '';
}

export function validateFleetSize(value: string): string {
  const v = value.trim();
  if (!v) return 'Fleet size is required.';
  if (!/^\d+$/.test(v)) return 'Fleet size must be a whole number.';
  const n = Number(v);
  if (n < 1) return 'You need at least 1 vehicle.';
  if (n > 5000) return 'Fleet size looks too large — contact support for enterprise onboarding.';
  return '';
}

export function validateAccountNumber(value: string): string {
  const v = digitsOnly(value);
  if (!v) return 'Account number is required.';
  if (!/^\d{9,18}$/.test(v)) return 'Account number must be 9–18 digits.';
  if (/^0+$/.test(v)) return 'Enter a valid account number.';
  return '';
}

export function validateIfsc(value: string): string {
  const v = value.trim().toUpperCase();
  if (!v) return 'IFSC code is required.';
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v)) return 'Enter a valid 11-character IFSC (e.g. SBIN0001234).';
  return '';
}

/** UPI is optional; validated only when provided. */
export function validateUpi(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (!/^[A-Za-z0-9.\-_]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/.test(v)) return 'Enter a valid UPI ID (e.g. name@okhdfcbank).';
  return '';
}

export function maskTail(value: string, visible = 4): string {
  const v = value.replace(/\s/g, '');
  if (v.length <= visible) return v;
  return '•'.repeat(Math.min(v.length - visible, 8)) + v.slice(-visible);
}

export const hasErrors = (errors: Record<string, string>) => Object.values(errors).some(Boolean);
