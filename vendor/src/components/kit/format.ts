// Display helpers shared by every NESAM Partner page (India time, rupees, plates).
import type { MarketTrip, VendorBooking } from '../../types/operations';

const IST = 'Asia/Kolkata';

export const rupees = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const signed = (n: number): string => `${n < 0 ? '−' : '+'}${rupees(Math.abs(n))}`;

export const dayText = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

export const weekdayText = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

export const timeText = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true }).format(d) : '';

export const dayTime = (d: Date | null): string => (d ? `${dayText(d)} · ${timeText(d)}` : '—');

/** yyyy-mm-dd of an instant in India time (for grouping by pickup day). */
export const isoDay = (ms: number): string => (ms ? new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(ms)) : '');

export const plate = (v: string): string => {
  const k = (v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = k.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : v;
};

export const shortId = (id: string, prefix = 'NSM'): string => (id ? `${prefix}-${id.slice(0, 6).toUpperCase()}` : '—');

export const firstPart = (address: string): string => (address || '').split(',')[0]?.trim() || address || '—';

/** One label per trip type, the same words the customer apps use. */
export function tripTypeLabel(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (/round/.test(s)) return 'Round Trip';
  if (/airport/.test(s)) return 'Airport';
  if (/multi/.test(s)) return 'Multicity';
  if (/rental|hour|package/.test(s)) return 'Local Rental';
  if (/local|pickup\s*&|pickup and drop/.test(s)) return 'Pickup & Drop';
  if (/one|drop|outstation/.test(s)) return 'One Way';
  return raw || 'Trip';
}

export const marketType = (t: MarketTrip): string => tripTypeLabel(`${t.tripType} ${t.service}`);
export const marketFrom = (t: MarketTrip): string => t.pickup.city || firstPart(t.pickup.address);
export const marketTo = (t: MarketTrip): string => t.drop.city || firstPart(t.drop.address);
export const marketPickup = (t: MarketTrip): Date | null => (t.pickupMs ? new Date(t.pickupMs) : null);

export const bookingPickup = (b: VendorBooking): Date | null => b.pickupAt;
export const bookingWhen = (b: VendorBooking): string => (b.pickupAt ? dayTime(b.pickupAt) : [b.date, b.time].filter(Boolean).join(' · ') || '—');

/** Which artwork from the reference best matches a vehicle. */
export function carArt(category: string, model = ''): 'sedan' | 'suv' | 'innova' | 'crysta' | 'carens' {
  const s = `${category} ${model}`.toLowerCase();
  if (/carens/.test(s)) return 'carens';
  if (/crysta/.test(s)) return 'crysta';
  if (/innova|premium suv|tempo|traveller|bus/.test(s)) return 'innova';
  if (/suv|ertiga|xuv|muv|6\+1|7/.test(s)) return 'suv';
  return 'sedan';
}

export const initials = (name: string): string =>
  (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
