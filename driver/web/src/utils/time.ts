/**
 * User-facing dates and times: India time, 12-hour clock ("06:30 PM").
 * Stored timestamps stay UTC; only the text shown to people is formatted here.
 */
const TZ = 'Asia/Kolkata';

export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const o = v as { toDate?: () => Date; seconds?: number };
  if (typeof o === 'object') {
    if (typeof o.toDate === 'function') return o.toDate();
    if (typeof o.seconds === 'number') return new Date(o.seconds * 1000);
    return null;
  }
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "06:30 PM" */
export function formatTime12(v: unknown): string {
  const d = toDate(v);
  if (!d) return '';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

/** "07 Oct 2026" */
export function formatDate(v: unknown): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

/** "07 Oct 2026, 06:30 PM" */
export function formatDateTime12(v: unknown): string {
  const d = toDate(v);
  return d ? `${formatDate(d)}, ${formatTime12(d)}` : '';
}
