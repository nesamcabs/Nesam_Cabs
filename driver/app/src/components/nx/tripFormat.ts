import type { MarketplaceOffer, TripDetails } from '../../types/driver';
import { formatDate, formatTime12 } from '../../utils/time';
import { formatINR } from '../../utils/format';

const TZ = 'Asia/Kolkata';

const dayKey = (v: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(v);

/** "Today" / "Tomorrow" / "07 Oct 2026" in India time; empty when the pickup instant is unknown. */
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

export function offerWhen(o: Pick<MarketplaceOffer, 'travelDate' | 'pickupTime'>): { date: string; time: string; key: string } {
  return { date: o.travelDate || 'Date to be confirmed', time: o.pickupTime || '', key: o.travelDate || '' };
}

export const kmText = (km: number) => (km > 0 ? `${Math.round(km)} km` : '');

export function tripStageLabel(t: TripDetails): string {
  if (t.status === 'Completed' || t.subStatus === 'Trip Ended') return 'Completed';
  if (t.subStatus === 'Trip Started') return 'On trip';
  if (t.subStatus === 'Reached Pickup') return t.boardingVerified ? 'Ready to start' : 'Boarding OTP';
  return t.verificationSubmitted ? 'Heading to pickup' : 'Confirmed';
}

export const tripIsActive = (t: TripDetails) => t.subStatus !== 'Not Started' || t.verificationSubmitted;

export function payoutLabel(t: TripDetails): string {
  if (t.fleetTrip) return 'Paid by your fleet';
  return t.payoutRecorded ? formatINR(t.driverEarnings) : 'Not recorded';
}

export function payoutCaption(t: TripDetails): string {
  if (t.fleetTrip) return 'Settled by your fleet operator';
  if (!t.payoutRecorded) return 'Payout not recorded yet';
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
 * When the first trip step ("Reached Pickup") opens. The server refuses it earlier than its configured window before the
 * pickup time; the screen only mirrors that. With no rules or no pickup time it never blocks — the server's own message
 * is shown if it refuses.
 */
export function arrivalWindow(trip: Pick<TripDetails, 'pickupAt'>, rules: { startWindowMs: number } | null, now: number): { open: boolean; opensAt: Date | null } {
  if (!rules || !trip.pickupAt) return { open: true, opensAt: null };
  const opensAt = new Date(trip.pickupAt.getTime() - rules.startWindowMs);
  return { open: now >= opensAt.getTime(), opensAt };
}
