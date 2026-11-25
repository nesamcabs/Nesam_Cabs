/**
 * Scheduled peak rules on the admin page: the overlap check shown before saving (the server repeats it: functions/src/domain/peakRules.ts)
 * and readable summaries. Times are minute precision in Asia/Kolkata; a slot ending at or before its start runs overnight and belongs
 * to the evening it starts on.
 */
export interface PeakDraft {
  id?: string;
  brand: string;
  service: "local" | "rental";
  scopeKey: string;
  enabled: boolean;
  days: number[];
  slots: { start: string; end: string }[];
  from?: string;
  until?: string;
  priority: number;
  name?: string;
}

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Display order Mon → Sun; values are JS weekdays (0 = Sunday). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const minutesOf = (t: string) => { const m = HHMM.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

function weekIntervals(r: Pick<PeakDraft, "days" | "slots">): [number, number][] {
  const out: [number, number][] = [];
  for (const d of r.days) for (const s of r.slots) {
    const a = minutesOf(s.start), b = minutesOf(s.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
    const start = d * 1440 + a, end = d * 1440 + (b > a ? b : b + 1440);
    if (end <= 10080) out.push([start, end]); else { out.push([start, 10080]); out.push([0, end - 10080]); }
  }
  return out;
}
const datesOverlap = (a: Pick<PeakDraft, "from" | "until">, b: Pick<PeakDraft, "from" | "until">) =>
  (!a.until || !b.from || b.from <= a.until) && (!b.until || !a.from || a.from <= b.until);

/** Enabled rules of the same brand, service, place and priority whose windows and dates overlap: one would have to win arbitrarily. */
export function overlapsWith(r: PeakDraft, others: readonly PeakDraft[]): PeakDraft[] {
  if (!r.enabled) return [];
  const mine = weekIntervals(r);
  return others.filter((o) => o.id !== r.id && o.enabled && o.brand === r.brand && o.service === r.service && o.scopeKey === r.scopeKey && o.priority === r.priority
    && datesOverlap(r, o) && weekIntervals(o).some(([a, b]) => mine.some(([c, d]) => a < d && c < b)));
}

const t12 = (t: string) => { const m = minutesOf(t); if (!Number.isFinite(m)) return t; const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export function daysText(days: number[]): string {
  const set = WEEK.filter((d) => days.includes(d));
  if (set.length === 7) return "Every day";
  if (set.length === 5 && [1, 2, 3, 4, 5].every((d) => set.includes(d))) return "Mon–Fri";
  return set.map((d) => DAY_SHORT[d]).join(", ");
}
export const slotsText = (slots: { start: string; end: string }[]) =>
  slots.map((s) => `${t12(s.start)}–${t12(s.end)}${minutesOf(s.end) <= minutesOf(s.start) ? " (overnight)" : ""}`).join(", ");
