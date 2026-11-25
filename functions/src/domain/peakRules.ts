// Scheduled peak-hour charges for Local Pickup & Drop and Hourly Rental (collection peak_rules). Pure functions, no database.
//
// A rule names a brand ('' = all brands), a service, a geographic scope (geoScope.ts), the weekdays and time slots it runs on
// (minute precision, Asia/Kolkata), optional effective dates, and a percentage or fixed charge with an optional cap.
// It is matched on the SCHEDULED pickup time, never on when the app was opened. A slot that ends at or before its start runs
// overnight; its weekday and dates are those of the evening it starts (Fri 22:00–02:00 covers Saturday 01:30).
// One rule applies per quote: the brand's own rule beats a shared one, then the most specific place, then the higher priority.
// Two rules still tied are ambiguous and the quote is refused (the save already refuses such overlaps).
// The charge is worked out on the eligible ride fare only: never on tolls, parking, airport entry or taxes.
import { keyRank } from './geoScope';

export interface PeakSlot { start: string; end: string }
export interface PeakRule {
  id: string;
  brand: string;
  service: 'local' | 'rental';
  scopeKey: string;
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  slots: PeakSlot[];
  /** IST dates, YYYY-MM-DD, both included; '' = open. */
  from?: string;
  until?: string;
  type: 'percent' | 'fixed';
  value: number;
  /** Maximum extra in rupees; absent = no cap. */
  cap?: number;
  priority: number;
  version?: number;
  name?: string;
}

const IST_MS = 330 * 60_000;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const minutesOf = (t: string) => { const m = HHMM.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const istParts = (ms: number) => {
  const d = new Date(ms + IST_MS);
  return { date: d.toISOString().slice(0, 10), weekday: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
};
const prevDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The IST date the matching window started on, or null when the rule's schedule does not cover this pickup. */
export function windowStart(rule: Pick<PeakRule, 'days' | 'slots' | 'from' | 'until'>, pickupMs: number): string | null {
  const now = istParts(pickupMs);
  for (const s of rule.slots) {
    const a = minutesOf(s.start), b = minutesOf(s.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    let startDate: string | null = null, weekday = now.weekday;
    if (b > a) { if (now.minute >= a && now.minute < b) startDate = now.date; }
    else if (now.minute >= a) startDate = now.date;
    else if (now.minute < b) { startDate = prevDate(now.date); weekday = (now.weekday + 6) % 7; }
    if (!startDate || !rule.days.includes(weekday)) continue;
    if (rule.from && startDate < rule.from) continue;
    if (rule.until && startDate > rule.until) continue;
    return startDate;
  }
  return null;
}

export type PeakPick = { rule: PeakRule | null; ambiguous?: PeakRule[] };

/** The one peak rule for a quote. `keys` are the pickup's scope keys (peakKeysOf). */
export function selectPeakRule(rules: readonly PeakRule[], q: { brand: string; service: 'local' | 'rental'; keys: string[]; pickupMs: number }): PeakPick {
  const hits = rules.filter((r) => r.enabled && r.service === q.service && (!r.brand || r.brand === q.brand) && q.keys.includes(r.scopeKey) && windowStart(r, q.pickupMs));
  if (!hits.length) return { rule: null };
  const rank = (r: PeakRule) => [r.brand ? 1 : 0, keyRank(r.scopeKey), r.priority];
  hits.sort((x, y) => { const a = rank(x), b = rank(y); return b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]!; });
  const top = rank(hits[0]!);
  const tied = hits.filter((r) => rank(r).every((n, i) => n === top[i]));
  return tied.length > 1 ? { rule: null, ambiguous: tied } : { rule: hits[0]! };
}

/** The peak charge on an eligible ride fare (paise): a percentage of it or a fixed amount, never above the cap. */
export function peakAmountPaise(rule: Pick<PeakRule, 'type' | 'value' | 'cap'>, eligiblePaise: number): number {
  const raw = rule.type === 'percent' ? Math.round((Math.max(0, eligiblePaise) * rule.value) / 100) : Math.round(rule.value * 100);
  return rule.cap !== undefined ? Math.min(raw, Math.round(rule.cap * 100)) : raw;
}

/** Validates a rule from the admin page; throws a readable message. */
export function validatePeakRule(r: Omit<PeakRule, 'id'>): void {
  if (r.service !== 'local' && r.service !== 'rental') throw new Error('Choose Local Pickup & Drop or Hourly Rental.');
  if (!r.days.length || r.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Choose at least one day.');
  if (!r.slots.length || r.slots.length > 6) throw new Error('Add one to six time slots.');
  for (const s of r.slots) {
    const a = minutesOf(s.start), b = minutesOf(s.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Enter every slot time as HH:MM.');
    if (a === b) throw new Error('A time slot must end at a different time than it starts.');
  }
  if (r.from && !/^\d{4}-\d{2}-\d{2}$/.test(r.from)) throw new Error('Enter the effective-from date.');
  if (r.until && !/^\d{4}-\d{2}-\d{2}$/.test(r.until)) throw new Error('Enter the until date.');
  if (r.from && r.until && r.until < r.from) throw new Error('The until date must be on or after the effective-from date.');
  if (!(typeof r.value === 'number' && Number.isFinite(r.value) && r.value > 0)) throw new Error('Enter the peak adjustment value (more than zero).');
  if (r.type === 'percent' && r.value > 200) throw new Error('A percentage above 200% is not allowed.');
  if (r.type === 'fixed' && r.value > 100000) throw new Error('A fixed charge above ₹1,00,000 is not allowed.');
  if (r.cap !== undefined && !(Number.isFinite(r.cap) && r.cap > 0 && r.cap <= 100000)) throw new Error('Enter a maximum extra above zero, or leave it empty.');
  if (!Number.isInteger(r.priority) || r.priority < 1 || r.priority > 99) throw new Error('Priority must be a whole number from 1 to 99.');
}

/** Minute intervals of a week a rule's slots cover, as [start, end) in minutes from Sunday 00:00 (overnight wraps into the next day). */
function weekIntervals(r: Pick<PeakRule, 'days' | 'slots'>): [number, number][] {
  const out: [number, number][] = [];
  for (const d of r.days) for (const s of r.slots) {
    const a = minutesOf(s.start), b = minutesOf(s.end);
    const start = d * 1440 + a, end = d * 1440 + (b > a ? b : b + 1440);
    if (end <= 7 * 1440) out.push([start, end]);
    else { out.push([start, 7 * 1440]); out.push([0, end - 7 * 1440]); }
  }
  return out;
}
const datesOverlap = (a: Pick<PeakRule, 'from' | 'until'>, b: Pick<PeakRule, 'from' | 'until'>) =>
  (!a.until || !b.from || b.from <= a.until) && (!b.until || !a.from || a.from <= b.until);

/** Enabled rules of the same brand, service, scope and priority whose weekly windows and dates overlap `r`: ambiguous together. */
export function overlappingRules(r: Omit<PeakRule, 'id'> & { id?: string }, others: readonly PeakRule[]): PeakRule[] {
  if (!r.enabled) return [];
  const mine = weekIntervals(r);
  return others.filter((o) => o.id !== r.id && o.enabled && o.brand === r.brand && o.service === r.service && o.scopeKey === r.scopeKey && o.priority === r.priority
    && datesOverlap(r, o) && weekIntervals(o).some(([a, b]) => mine.some(([c, d]) => a < d && c < b)));
}
