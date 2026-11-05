/**
 * User-facing dates and times. Stored values stay UTC timestamps; only the
 * text shown to people is formatted — always India time, 12-hour clock,
 * "06:30 PM". Use these instead of toLocaleTimeString / toLocaleString.
 */
const TZ = "Asia/Kolkata";

export type DateLike = Date | { toDate?: () => Date; seconds?: number } | string | number | null | undefined;

export function toDate(v: DateLike): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "object") {
    if (typeof v.toDate === "function") return v.toDate();
    if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
    return null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "06:30 PM" */
export function formatTime12(v: DateLike): string {
  const d = toDate(v);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}

/** "07 Oct 2026" */
export function formatDate(v: DateLike): string {
  const d = toDate(v);
  return d ? d.toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric" }) : "";
}

/** "07 Oct 2026, 06:30 PM" */
export function formatDateTime12(v: DateLike): string {
  const d = toDate(v);
  return d ? `${formatDate(d)}, ${formatTime12(d)}` : "";
}

/** "07 Oct, 06:30 PM" (no year, for lists) */
export function formatShortDateTime12(v: DateLike): string {
  const d = toDate(v);
  return d ? `${d.toLocaleDateString("en-IN", { timeZone: TZ, day: "2-digit", month: "short" })}, ${formatTime12(d)}` : "";
}

/** "HH:MM" 24-hour value (as an <input type="time"> uses) → "06:30 PM". Display only. */
export function formatClock12(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return hhmm;
  const h = Number(m[1]);
  if (h > 23) return hhmm;
  return `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0")}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/** "12 AM", "6 PM" for chart axes. */
export function formatHourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? "PM" : "AM"}`;
}

/** YYYY-MM-DD of an instant on the India calendar. */
export function isoDateIST(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Whole calendar days from `now` to `d` on the India calendar (0 = today, 1 = tomorrow). */
export function dayOffsetIST(d: Date, now = new Date()): number {
  const a = Date.parse(`${isoDateIST(d)}T00:00:00Z`);
  const b = Date.parse(`${isoDateIST(now)}T00:00:00Z`);
  return Math.round((a - b) / 86400000);
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/**
 * The pickup instant of a booking: `pickupAt`, else `scheduledAt`. Older
 * bookings only carry the display strings ("07 Oct 2026" + "06:30 PM"), which are
 * read as India time; "Now" bookings fall back to when they were created.
 */
export function bookingPickupDate(b: { pickupAt?: unknown; scheduledAt?: unknown; date?: string; time?: string; createdAt?: unknown }): Date | null {
  const direct = toDate(b.pickupAt as DateLike) ?? toDate(b.scheduledAt as DateLike);
  if (direct) return direct;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec((b.date ?? "").trim());
  if (!m || MONTHS[m[2].toLowerCase()] === undefined) return toDate(b.createdAt as DateLike);
  const t = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/.exec((b.time ?? "").trim());
  let h = 0, min = 0;
  if (t) {
    h = Number(t[1]);
    min = Number(t[2]);
    if (t[3]) h = (h % 12) + (/p/i.test(t[3]) ? 12 : 0);
  } else if ((b.time ?? "").trim() === "Now") {
    return toDate(b.createdAt as DateLike);
  }
  // India time (UTC+05:30) → instant.
  return new Date(Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), h, min) - 330 * 60000);
}

/** "in 2 h 15 min", "45 min ago". */
export function relativeFromNow(d: Date, now = new Date()): string {
  const mins = Math.round((d.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(mins);
  const text = abs >= 1440 ? `${Math.round(abs / 1440)} d` : abs >= 60 ? `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ""}` : `${abs} min`;
  return mins >= 0 ? `in ${text}` : `${text} ago`;
}
