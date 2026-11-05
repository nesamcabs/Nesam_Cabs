// Display rules from the client reference: "23 Oct 2026 · 6:00 AM", "₹4,200", "TN 60 CD 5678", permanent IDs.
const IST = 'Asia/Kolkata';

export const rupees = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "+₹3,600" / "−₹500" for ledger rows. */
export const signedRupees = (n: number, credit: boolean): string => `${credit ? '+' : '−'}${rupees(Math.abs(n))}`;

export const day = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric' }).format(d) : '—';

/** 12-hour clock; the reference uses "6:00 AM" on cards and "6:00 am" in detail rows. */
export const time = (d: Date | null | undefined, lower = false): string => {
  if (!d) return '';
  const t = new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
  return lower ? t.toLowerCase() : t;
};

export const dayTime = (d: Date | null | undefined, lower = true): string => (d ? `${day(d)} · ${time(d, lower)}` : '—');

/** ISO calendar date in India time (date filter, grouping). */
export const isoDay = (d: Date | null | undefined): string =>
  d ? new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : '';

/** "TN60CD5678" → "TN 60 CD 5678"; anything unusual is shown as entered. */
export function plate(v: string): string {
  const k = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = k.match(/^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/);
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : v;
}

/** Stable display IDs from record ids, used wherever a record has no stored code. */
export const vendorCode = (id: string, stored?: string) => stored || `NSM-VN-${id.slice(0, 6).toUpperCase()}`;
export const driverCode = (id: string, stored?: string) => stored || `NSM-DR-${id.slice(0, 6).toUpperCase()}`;
export const carCode = (id: string, stored?: string) => stored || `NSM-CAR-${id.slice(0, 6).toUpperCase()}`;

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export const maskPhone = (p: string): string => {
  const d = p.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d}` : p;
};

/** Days until an ISO date (negative = past). null when the date is missing or unreadable. */
export function daysUntil(iso: string, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.length === 10 ? `${iso}T23:59:59+05:30` : iso);
  return Number.isFinite(t) ? Math.floor((t - now) / 86400000) : null;
}
