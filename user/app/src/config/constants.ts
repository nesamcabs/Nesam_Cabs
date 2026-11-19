import { RideCategory } from '../types';

// ── External map services (overridable at build time) ──────────────────────
// Same public Photon / OSRM endpoints as the Customer Web panel. Expo inlines
// EXPO_PUBLIC_* variables at bundle time, so no code change is needed to point
// these at a self-hosted instance for production volume.
export const GEOCODER_URL = (process.env.EXPO_PUBLIC_GEOCODER_URL || 'https://photon.komoot.io').replace(/\/$/, '');
export const ROUTING_URL = (process.env.EXPO_PUBLIC_ROUTING_URL || 'https://router.project-osrm.org').replace(/\/$/, '');

/** Optional company UPI VPA — enables a "Pay via UPI app" deep link on the receipt. */
export const COMPANY_UPI_ID: string = process.env.EXPO_PUBLIC_COMPANY_UPI_ID || '';
/**
 * Customer payment options in the NESAM website and app. Switched off for now: no payment-method choice
 * when booking and no "Open UPI app" button. Every booking is pay-later (recorded as Cash, settled after
 * the trip). Set to true to bring both back.
 */
export const CUSTOMER_PAYMENTS_ENABLED: boolean = false;
export const COMPANY_NAME = 'NESAM Tours & Travels';
export const COMPANY_LEGAL_NAME = 'NESAM Tours and Travels Private Limited';
/** Name shown in copyright notices and footers. */
export const COPYRIGHT_HOLDER = 'Nesam Tours & Travels Private Limited';

// Search results are restricted to India (lon/lat bounding box).
export const INDIA_BBOX = '68.1,6.5,97.4,35.7';
/** Map centre used until the device location is known (Theni, head office). */
export const DEFAULT_CENTER = { lat: 10.0104, lng: 77.4768 };

// ── Contacts ────────────────────────────────────────────────────────────────
export const SUPPORT_PHONE = '+919025099990';
export const SUPPORT_PHONE_DISPLAY = '+91 90250 99990';
/** WhatsApp line the booking screen has always used for trip enquiries (international format, no +). */
export const SUPPORT_WHATSAPP = '919025099990';
export const SUPPORT_EMAIL = 'support@nesamcabs.com';
export const EMERGENCY_NUMBER = '112';

// ── Pricing policy ──────────────────────────────────────────────────────────
export const GST_RATE = 0.05; // passenger transport services (no ITC)
/** Trips longer than this (one way) are outstation: driver allowance applies. */
export const OUTSTATION_THRESHOLD_KM = 40;
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

// ── Dispatch & tracking ─────────────────────────────────────────────────────
export const NEARBY_RADIUS_KM = 10;
export const PRESENCE_STALE_MS = 3 * 60 * 1000;
export const AVG_CITY_SPEED_KMPH = 24;
/**
 * Earliest / latest schedulable pickup. These mirror the server defaults (settings/operations
 * bookingMinLeadMinutes / bookingMaxAdvanceDays); the server is the authority and rejects a
 * missing or out-of-window pickup whatever the client sends.
 */
export const SCHEDULE_MIN_LEAD_MIN = 30;
export const SCHEDULE_MAX_DAYS = 30;

// ── Cancellation policy ─────────────────────────────────────────────────────
/** Free cancellation window after a driver is assigned (instant rides). */
export const FREE_CANCEL_AFTER_ASSIGN_MS = 3 * 60 * 1000;
export const INSTANT_CANCELLATION_FEE = 50;
/** Scheduled rides are free to cancel until this long before pickup. */
export const SCHEDULED_FREE_CANCEL_BEFORE_MS = 60 * 60 * 1000;
export const SCHEDULED_CANCELLATION_FEE = 100;

export const CANCEL_REASONS = [
  'Driver is taking too long',
  'Driver asked me to cancel',
  'Changed my plans',
  'Booked by mistake',
  'Wrong pickup location',
  'Found another ride',
  'Other',
];

