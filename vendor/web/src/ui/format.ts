/** ₹1,234 / ₹1,234.50 — whole rupees drop the decimals; null/NaN shows a dash. */
export function inr(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const v = Math.round(n * 100) / 100;
  const text = Math.abs(v).toLocaleString('en-IN', Number.isInteger(v) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '−' : ''}₹${text}`;
}

export const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';

/** "Koyambedu Bus Terminus, Chennai, TN" → "Koyambedu Bus Terminus". */
export function placeName(address: string | undefined): string {
  const first = (address ?? '').split(',')[0]?.trim();
  return first || (address ?? '').trim() || '—';
}

/** "Chennai, TN" — the text after the first comma, or '' when there is none. */
export function placeDetail(address: string | undefined): string {
  const a = (address ?? '').trim();
  const i = a.indexOf(',');
  return i > 0 && i < a.length - 1 ? a.slice(i + 1).trim() : '';
}

export const tenDigits = (v: string): string => v.replace(/\D/g, '').slice(-10);

export const isMobile = (v: string): boolean => /^[6-9]\d{9}$/.test(v);
