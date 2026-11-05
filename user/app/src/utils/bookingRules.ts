// Pure booking rules shared by the booking steps (unit-tested).
import { SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MIN } from '../config/constants';
import type { RideCategory } from '../types';
import { formatINR } from './format';

/**
 * Why a pickup can't be booked, or '' when it can. Every booking is an advance booking, so a
 * pickup date and time is required; the server enforces the same window and is the authority.
 */
export function scheduleProblem(at: Date | null, now = Date.now()): string {
  if (!at) return 'Choose your pickup date and time.';
  const lead = (at.getTime() - now) / 60000;
  if (lead < SCHEDULE_MIN_LEAD_MIN) return `Choose a pickup at least ${SCHEDULE_MIN_LEAD_MIN} minutes from now.`;
  if (lead > SCHEDULE_MAX_DAYS * 1440) return `You can book up to ${SCHEDULE_MAX_DAYS} days ahead.`;
  return '';
}

/** Same rules as the booking server (functions/src/bookingBuild.ts whatsappContact). */
export function whatsappProblem(same: boolean, code: string, number: string): string {
  if (same) return '';
  const digits = number.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{0,2}$/.test(code.trim())) return 'Enter the country code, for example +91.';
  if (!/^\d+$/.test(digits)) return 'Enter the WhatsApp number (digits only).';
  if (code.trim() === '+91') return /^[6-9]\d{9}$/.test(digits) ? '' : 'Enter a valid 10-digit WhatsApp number.';
  return digits.length >= 6 && digits.length <= 14 ? '' : 'Enter a valid WhatsApp number for that country code.';
}

/** "200 km included · ₹15/km extra" from the category's own configuration. */
export function inclusionLine(c: RideCategory, outstation: boolean): string {
  const parts: string[] = [];
  if (c.fare.baseKm > 0) parts.push(`${c.fare.baseKm} km included`);
  const extra = c.fare.extras?.extraKmRate ?? (outstation && c.fare.outstationPerKmRate ? c.fare.outstationPerKmRate : c.fare.perKmRate);
  if (extra > 0) parts.push(`${formatINR(extra)}/km extra`);
  return parts.join(' · ');
}

/**
 * The inclusion line of a car from its server quote (the admin tariff: package hours, included KM, extra-KM rate);
 * the category's own wording is used only until the server has answered.
 */
export function quotedInclusionLine(q: { ok: boolean; includedKm?: number; extraKmRate?: number; rentalHours?: number | null } | undefined, c: RideCategory, outstation: boolean): string {
  if (!q?.ok) return inclusionLine(c, outstation);
  const parts: string[] = [];
  if (q.rentalHours) parts.push(`${q.rentalHours} hours`);
  if (q.includedKm && q.includedKm > 0) parts.push(`${q.includedKm} km included`);
  if (q.extraKmRate && q.extraKmRate > 0) parts.push(`${formatINR(q.extraKmRate)}/km extra`);
  return parts.join(' · ');
}

/** The server keeps at most this many characters of a booking's notes (functions/src/shared.ts `text`). */
export const NOTES_MAX = 300;

/**
 * One notes string for the booking server: the structured extras the app collects (flight number,
 * a different travelling passenger) come first so a cut-off only ever shortens the customer's own words.
 */
export function composeBookingNotes(p: { flight?: string; passengerName?: string; passengerMobile?: string; notes?: string }): string {
  const parts: string[] = [];
  const flight = (p.flight ?? '').trim();
  if (flight) parts.push(`Flight: ${flight}`);
  const name = (p.passengerName ?? '').trim();
  const mobile = (p.passengerMobile ?? '').replace(/\s+/g, '');
  if (name || mobile) parts.push(`Travelling passenger: ${[name, mobile].filter(Boolean).join(', ')}`);
  const head = parts.join(' | ');
  const note = (p.notes ?? '').trim();
  const joined = head && note ? `${head} | ${note}` : head || note;
  return joined.slice(0, NOTES_MAX);
}
