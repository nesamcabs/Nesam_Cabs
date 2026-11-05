// Formatting + validation helpers.

export function formatINR(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km)) return '—';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export function formatDuration(min: number): string {
  if (!Number.isFinite(min)) return '—';
  const m = Math.max(1, Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "06:30 PM" in the device's zone (the same zone the pickers use). Built from parts so every JS engine prints the same text. */
export function formatTime(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')} ${get('dayPeriod').toUpperCase()}`;
}

export function formatDateTime(d: Date | null): string {
  return d ? `${formatDate(d)}, ${formatTime(d)}` : '—';
}

export function timeAgo(d: Date | null, now = Date.now()): string {
  if (!d) return 'unknown';
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return formatDate(d);
}

/** Last 10 digits of an Indian number, or '' if it isn't one. */
export function localMobile(phone: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : '';
}

export function isValidIndianMobile(digits: string): boolean {
  return /^[6-9]\d{9}$/.test(digits);
}

export function formatPhone(phone: string): string {
  const local = localMobile(phone);
  return local ? `+91 ${local.slice(0, 5)} ${local.slice(5)}` : phone;
}

export function telHref(phone: string): string {
  const local = localMobile(phone);
  return local ? `tel:+91${local}` : `tel:${phone.replace(/[^\d+]/g, '')}`;
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

// Explicit script ranges (Latin incl. accents, Devanagari, Tamil) instead of
// \p{L}: Unicode property escapes are not reliable on every Hermes build.
const NAME_RE = /^[A-Za-zÀ-ɏऀ-ॿ஀-௿ .'-]+$/;

export function isValidName(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= 60 && NAME_RE.test(n);
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}

/** Escapes text for safe interpolation into generated HTML (print receipts). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Firestore Timestamp | Date | ISO string | millis → Date. */
export function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}
