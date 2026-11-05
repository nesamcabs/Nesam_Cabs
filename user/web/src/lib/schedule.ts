import { SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MIN } from '@core/config/constants';
import type { LocationErrorKind } from '@core/services/geoService';

const pad = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd in the browser's zone, for <input type="date">. */
export const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** hh:mm in the browser's zone, for <input type="time">. */
export const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function combineDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const out = new Date(y, m - 1, d, hh, mm, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

/** The earliest pickup the booking server accepts, rounded up to the next 5 minutes. */
export function earliestPickup(now = Date.now()): Date {
  const t = new Date(now + (SCHEDULE_MIN_LEAD_MIN + 5) * 60000);
  t.setSeconds(0, 0);
  t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5);
  return t;
}

export const latestPickup = (now = Date.now()) => new Date(now + SCHEDULE_MAX_DAYS * 86400000);

/** Location problems explained for a browser (the shared texts talk about phone settings). */
export const LOCATION_HELP: Record<LocationErrorKind, string> = {
  denied: 'Location permission was not granted. Allow it in your browser, or search for your pickup.',
  blocked: 'Location is blocked for this site. Allow it from the address bar’s site settings, or search for your pickup.',
  disabled: 'Your device’s location is switched off. Turn it on, or search for your pickup.',
  unavailable: 'We couldn’t get a location fix. Search for your pickup instead.',
  timeout: 'Getting your location is taking too long. Try again or search for your pickup.',
};
