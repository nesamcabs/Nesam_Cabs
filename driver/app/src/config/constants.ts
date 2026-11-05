// Driver app constants. Support contact matches the Customer app / Customer
// Web configuration (the Driver Web panel had a stale hard-coded number).
export const SUPPORT_PHONE = '+919025099990';
export const SUPPORT_PHONE_DISPLAY = '+91 90250 99990';
export const SUPPORT_EMAIL = 'support@nesamcabs.com';
export const COMPANY_LEGAL_NAME = 'NESAM Tours and Travels Private Limited';
export const EMERGENCY_NUMBER = '112';

/** A driver must be within this distance of the pickup to mark arrival. This is the server's default; the configured value
 *  (settings/operations.pickupRadiusKm) is used when it can be read. */
export const PICKUP_RADIUS_KM = 3;

/** Live position is shared at most this often / after moving this far. */
export const LOCATION_SHARE_INTERVAL_MS = 20000;
export const LOCATION_SHARE_MIN_MOVE_KM = 0.1;
