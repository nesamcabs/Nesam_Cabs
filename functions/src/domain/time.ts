// Display formatting. Timestamps are stored in UTC; only the user-facing text
// is formatted, always in India time, with a 12-hour clock ("06:30 PM").

const TZ = 'Asia/Kolkata';

/** "06:30 PM" — two-digit hour, minutes, upper-case meridiem. */
export function formatTime12(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** "07 Oct 2026". */
export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

/** "07 Oct 2026, 06:30 PM". */
export function formatDateTime12(d: Date): string {
  return `${formatDate(d)}, ${formatTime12(d)}`;
}

/** YYYY-MM-DD of the given instant on the India calendar. */
export function isoDateIST(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Pickup instant of a stored booking: the explicit pickupAt, else scheduledAt,
 * else null. Older bookings that only have the display strings are not guessed.
 */
export function pickupInstant(b: { pickupAt?: unknown; scheduledAt?: unknown }): Date | null {
  for (const v of [b.pickupAt, b.scheduledAt]) {
    const t = v as { toDate?: () => Date } | Date | string | number | null | undefined;
    if (!t) continue;
    if (t instanceof Date) return t;
    if (typeof t === 'object' && typeof t.toDate === 'function') return t.toDate();
    if (typeof t === 'string' || typeof t === 'number') {
      const d = new Date(t);
      if (Number.isFinite(d.getTime())) return d;
    }
  }
  return null;
}
