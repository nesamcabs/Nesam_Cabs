import type { MarketplaceOffer, TripDetails } from '../../types';
import { formatDate, formatTime12 } from '../../utils/time';

const TZ = 'Asia/Kolkata';

/** ₹1,234 / ₹1,234.50 — whole rupees drop the decimals. */
export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Math.round(n * 100) / 100;
  const text = Math.abs(v).toLocaleString('en-IN', Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}₹${text}`;
}

/** The first part of an address ("Koyambedu Bus Terminus, Chennai" → "Koyambedu Bus Terminus"). */
export function placeName(address: string | undefined): string {
  const first = (address ?? '').split(',')[0]?.trim();
  return first || (address ?? '').trim() || '—';
}

const dayKey = (v: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);

/** "Today" / "Tomorrow" / "07 Oct 2026" in India time. */
export function dayLabel(at: Date | null, now: number): string {
  if (!at) return '';
  const k = dayKey(at);
  if (k === dayKey(new Date(now))) return 'Today';
  if (k === dayKey(new Date(now + 86400000))) return 'Tomorrow';
  return formatDate(at);
}

/** "19 Oct" */
export function shortDate(at: Date | null): string {
  return at ? at.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short' }) : '';
}

export function tripWhen(t: Pick<TripDetails, 'pickupAt' | 'scheduledDate' | 'scheduledTime'>): { date: string; time: string } {
  if (t.pickupAt) return { date: formatDate(t.pickupAt), time: formatTime12(t.pickupAt) };
  return { date: t.scheduledDate || 'Date to be confirmed', time: t.scheduledTime || '' };
}

export function offerWhen(o: Pick<MarketplaceOffer, 'pickupAt' | 'travelDate' | 'pickupTime'>): { date: string; time: string; key: string } {
  if (o.pickupAt) return { date: formatDate(o.pickupAt), time: formatTime12(o.pickupAt), key: dayKey(o.pickupAt) };
  return { date: o.travelDate || 'Date to be confirmed', time: o.pickupTime || '', key: o.travelDate || '' };
}

export function kmText(km: number): string {
  return km > 0 ? `${Math.round(km)} km` : '';
}

/** Customer-facing phone number as "+91 98765 43210". */
export function phoneText(raw: string): string {
  const d = raw.replace(/\D/g, '');
  const n = d.length > 10 ? d.slice(-10) : d;
  return n.length === 10 ? `+91 ${n.slice(0, 5)} ${n.slice(5)}` : raw;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || 'D';


/** Where the trip stands, in the reference's wording. */
export function tripStageLabel(t: TripDetails): string {
  if (t.status === 'Completed' || t.subStatus === 'Trip Ended') return 'Completed';
  if (t.subStatus === 'Trip Started') return 'On trip';
  if (t.subStatus === 'Reached Pickup') return t.boardingVerified || t.legacyFlow ? 'Ready to start' : 'Boarding OTP';
  return t.verificationSubmitted ? 'Heading to pickup' : 'Confirmed';
}

export const tripIsActive = (t: TripDetails) => t.subStatus !== 'Not Started' || t.verificationSubmitted;

export function payoutLabel(t: TripDetails): string {
  if (t.fleetTrip) return 'Paid by your fleet';
  return t.driverEarnings !== null ? inr(t.driverEarnings) : 'Not recorded';
}

export function payoutNote(t: TripDetails): string {
  if (t.fleetTrip) return 'Settled by your fleet operator';
  if (t.driverEarnings === null) return 'Payout not recorded yet';
  return t.payoutFinalized ? 'Finalized by NESAM finance' : 'Agreed payout';
}

/** "6 hours", "90 minutes", "1 hour 30 minutes" */
export function durationText(ms: number): string {
  const min = Math.round(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  const parts = [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' ') || '0 minutes';
}

/**
 * When the first trip step ("Reached Pickup") opens. The server refuses it earlier than its configured window before
 * the pickup time (settings/operations.tripStartWindowMinutes); the screen only mirrors that. With no rules or no
 * pickup time it never blocks — the server's own message is shown if it refuses.
 */
export function arrivalWindow(trip: Pick<TripDetails, 'pickupAt'>, rules: { startWindowMs: number } | null, now: number): { open: boolean; opensAt: Date | null } {
  if (!rules || !trip.pickupAt) return { open: true, opensAt: null };
  const opensAt = new Date(trip.pickupAt.getTime() - rules.startWindowMs);
  return { open: now >= opensAt.getTime(), opensAt };
}
