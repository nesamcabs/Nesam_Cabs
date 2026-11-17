// Time-based Round Trip (Customer UX v8 · "Round Trip & Hill Station Developer Guide", 16 Nov 2026 — supersedes v7).
//
// Pure helpers only (no Firestore, no imports from tariff.ts) so the same rules serve the quote, the
// booking snapshot, the Morning Return upgrade and the final fare, and are unit-testable on their own.
//
// The customer picks pickup, destination, stops, pickup date/time and TRIP DAYS. The return date/time is never
// asked: it follows from the days and the package (2 days = two calendar dates, never 48 hours). Every time is IST.
//
//  • 1 day, pickup 1:00 AM–2:59 PM : 5-Hour / 8-Hour / Full-Day Return by round-trip distance + driving time (5h ≤ 100 km,
//              8h ≤ 150 km, above that only the Full Day; beyond 250 km the Full Day plus extra km). A drive that cannot be
//              back by the 11:45 PM cutoff becomes a 2-day trip.
//  • 1 day, pickup 3:00 PM and later : NO stand-alone Full-Day card. Only 5-Hour (until 6:45 PM) / 8-Hour (until 3:45 PM) while
//              they still fit, plus the overnight options (Morning Return, Next-Day Return); choosing an overnight option makes it 2 days.
//  • 2 days  : Next-Day Return = day-1 slab (by ORIGINAL pickup time: before 3 PM Full Day, 3–9:59 PM 8-hour, 10 PM–12:59 AM 5-hour)
//              + one Full Day, ending the last calendar date at 11:45 PM.
//              Morning Return (pickups from 3:00 PM to 12:59 AM, round trip ≤ 250 km, back by 9:00 AM) = one fixed fare; if it is still
//              running after 9:00 AM it upgrades to the Next-Day Return of the original pickup time.
//  • 3+ days : first-day slab + one Full Day for every further day (3 days = ₹12,000 / ₹10,780 / ₹10,080 for a Sedan).
//  • Hill stations: 5-Hour / 8-Hour never apply (the trip goes straight to the Full Day or the multi-day slab); the hill charge is a
//              separate line (domain/hillStations.ts).
//
// All amounts below are integer paise, exactly as the tariff stores them.

export type SlabId = 'five' | 'eight' | 'full';
export const SLAB_RANK: Readonly<Record<SlabId, number>> = { five: 1, eight: 2, full: 3 };
export const SLAB_LABEL: Readonly<Record<SlabId, string>> = { five: '5-Hour Return', eight: '8-Hour Return', full: 'Full-Day Return' };
export type TimePackageKind = 'same_day' | 'next_day' | 'morning';

/** Settings shared by every vehicle class. Minutes are minutes after IST midnight. */
export interface TimeBasedSettings {
  enabled: boolean;
  /** The day's booked cutoff: a package must end by here. 1425 = 11:45 PM. */
  cutoffMinutes: number;
  /** Strict cutoff of the Morning Return on the next day. 540 = 9:00 AM. */
  morningCutoffMinutes: number;
  /** Next-Day Return day-1 slab: pickups before this minute use a Full Day, from here an 8-hour slab. 900 = 3:00 PM. */
  nextDayEightFromMinutes: number;
  /** Next-Day Return day-1 slab: pickups from this minute use a 5-hour slab. 1320 = 10:00 PM. */
  nextDayFiveFromMinutes: number;
  /** The 8-hour package is shown only up to this round-trip distance, and a booked 5-hour never stays on its slab at or beyond it. */
  shortKmLimit: number;
  /** The 5-hour package is shown only up to this round-trip distance (inclusive). 100 = the 5-hour slab's own 100 km. */
  fiveKmLimit: number;
  /** Pickups before this minute (1:00 AM = 60) still belong to the previous night: no same-day package, 5-hour first slab. */
  lateNightEndMinutes: number;
  fiveHours: number;
  eightHours: number;
}

export const DEFAULT_TIME_BASED: Readonly<TimeBasedSettings> = {
  enabled: false, cutoffMinutes: 1425, morningCutoffMinutes: 540, nextDayEightFromMinutes: 900, nextDayFiveFromMinutes: 1320,
  shortKmLimit: 150, fiveKmLimit: 100, lateNightEndMinutes: 60, fiveHours: 5, eightHours: 8,
};

/** Per-class fixed amounts in rupees. The Full-Day package is the class's normal Round Trip day, not stored here. */
export interface TimeBasedClassRates {
  fiveFare: number; fiveKm: number; fivePartner: number;
  eightFare: number; eightKm: number; eightPartner: number;
  /** Morning Return — all three together or none (the option is then not offered for the class). */
  morningFare?: number; morningKm?: number; morningPartner?: number;
}

/** The class's Round Trip day rates the Full-Day package is derived from. */
export interface DayRates { customerRate: number; customerBata: number; partnerRate: number; partnerBata: number; minKmPerDay: number }

export interface SlabAmounts { farePaise: number; partnerPaise: number; includedKm: number; hours: number | null }

/** What a booking keeps so a later upgrade or the final fare never depends on the tariff as it is then. */
export interface TimeBasedSnapshot {
  kind: TimePackageKind;
  /** 'same:five' | 'same:eight' | 'same:full' | 'next' | 'morning'. */
  packageId: string;
  label: string;
  pickupMs: number;
  /** IST minute of the pickup. */
  pickupMin: number;
  cutoffMin: number;
  /** Calendar days the package covers (1 for same-day, 2 for Next-Day / Morning, N for a multi-day trip). */
  days: number;
  /** Short slabs: the hour limit of the selected slab. */
  hours: number | null;
  /** When this package's coverage ends (an instant). */
  coverageEndMs: number;
  limits: { fiveHours: number; eightHours: number; shortKmLimit: number };
  /** The booked package's own fare, partner payout and included km (without any estimated extra km). */
  base: SlabAmounts;
  /** Included km of each calendar day (e.g. [150, 250]); shown on the package card. */
  dayKm?: number[];
  /** Same-day: every slab of the class (to upgrade into) and the ones this pickup time may use. */
  slabs?: Partial<Record<SlabId, SlabAmounts>>;
  allowed?: SlabId[];
  selected?: SlabId;
  /** Next-Day / multi-day: the slab charged for the pickup day (every further day is a Full Day). */
  day1?: SlabId;
  /** Morning Return only. */
  morningCutoffMs?: number;
  upgrade?: { packageId: string; label: string; farePaise: number; partnerPaise: number; includedKm: number; day1: SlabId; coverageEndMs: number };
  /** The customer asked for 1 day but the pickup is too late for any same-day package, so 2 days were quoted. */
  autoDays?: boolean;
}

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 19_800_000;
const paiseOf = (rupees: number): number => Math.round(rupees * 100);
const kmPaise = (km: number, ratePaise: number): number => Math.floor((Math.round(km * 10) * ratePaise) / 10 + 0.5);

/** Minutes after IST midnight (0–1439). */
export function istMinutes(ms: number): number {
  const t = (((ms + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS;
  return Math.floor(t / 60_000);
}
/** The instant of `minutes` IST on the day `dayOffset` days after the IST date of `ms`. */
export function istInstant(ms: number, dayOffset: number, minutes: number): number {
  const midnight = Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return midnight + dayOffset * DAY_MS + minutes * 60_000;
}

export function fullDaySlab(r: DayRates): SlabAmounts {
  return {
    farePaise: kmPaise(r.minKmPerDay, paiseOf(r.customerRate)) + paiseOf(r.customerBata),
    partnerPaise: kmPaise(r.minKmPerDay, paiseOf(r.partnerRate)) + paiseOf(r.partnerBata),
    includedKm: r.minKmPerDay, hours: null,
  };
}

export function slabsOf(settings: TimeBasedSettings, day: DayRates, t: TimeBasedClassRates): Record<SlabId, SlabAmounts> {
  return {
    five: { farePaise: paiseOf(t.fiveFare), partnerPaise: paiseOf(t.fivePartner), includedKm: t.fiveKm, hours: settings.fiveHours },
    eight: { farePaise: paiseOf(t.eightFare), partnerPaise: paiseOf(t.eightPartner), includedKm: t.eightKm, hours: settings.eightHours },
    full: fullDaySlab(day),
  };
}

export interface SameDayInput {
  settings: TimeBasedSettings; pickupMs: number; /** Whole round trip, km. */ roundTripKm: number; /** Whole round trip driving time, minutes. */ estMinutes: number;
  /** A hill station is on the trip: no short package is offered. */
  hill?: boolean;
}

/** Pickups from 10:00 PM up to (not including) 1:00 AM: the late-night group (5-hour first slab, no same-day package). */
export function isLateNight(s: TimeBasedSettings, pickupMin: number): boolean {
  return pickupMin >= s.nextDayFiveFromMinutes || pickupMin < s.lateNightEndMinutes;
}

/**
 * Same-day packages this pickup may be offered, in display order (8-hour, 5-hour, Full Day). An empty list means the
 * trip cannot be finished the same day, so it is quoted as an overnight trip.
 *   8-hour : pickup ≤ 3:45 PM, round trip ≤ 150 km, driving ≤ 8 h      5-hour : pickup ≤ 6:45 PM, round trip ≤ 100 km, driving ≤ 5 h
 *   Full Day (a stand-alone card) : pickups before 3:00 PM only, as long as the drive is back before the cutoff.
 */
export function sameDaySlabs(i: SameDayInput): SlabId[] {
  const s = i.settings, pm = istMinutes(i.pickupMs), out: SlabId[] = [];
  if (isLateNight(s, pm)) return out;
  const fiveMin = s.fiveHours * 60, eightMin = s.eightHours * 60;
  const km = Math.round(i.roundTripKm * 10) / 10;
  if (!i.hill) {
    if (pm + eightMin <= s.cutoffMinutes && km <= s.shortKmLimit && i.estMinutes <= eightMin) out.push('eight');
    if (pm + fiveMin <= s.cutoffMinutes && km <= s.fiveKmLimit && i.estMinutes <= fiveMin) out.push('five');
  }
  if (pm < s.nextDayEightFromMinutes && pm + i.estMinutes <= s.cutoffMinutes) out.push('full');
  return out;
}

/** Day-1 slab of a Next-Day / multi-day Return by the ORIGINAL pickup time (3 PM / 10 PM / 1 AM boundaries). */
export function nextDayFirstSlab(s: TimeBasedSettings, pickupMs: number): SlabId {
  const pm = istMinutes(pickupMs);
  if (pm < s.lateNightEndMinutes) return 'five';
  return pm < s.nextDayEightFromMinutes ? 'full' : pm < s.nextDayFiveFromMinutes ? 'eight' : 'five';
}

/** The Morning Return's strict cutoff: the first 9:00 AM after the pickup (the same date for a pickup after midnight). */
export function morningCutoffOf(s: TimeBasedSettings, pickupMs: number): number {
  return istInstant(pickupMs, istMinutes(pickupMs) < s.lateNightEndMinutes ? 0 : 1, s.morningCutoffMinutes);
}

/**
 * Morning Return: pickups from 3:00 PM until 12:59 AM, a round trip of at most the package's own kilometres (250), and a drive that
 * can be back by the next 9:00 AM. Hill stations are allowed (only the 5-hour / 8-hour packages are not).
 */
export function morningEligible(s: TimeBasedSettings, t: TimeBasedClassRates | undefined, pickupMs: number, estMinutes: number, roundTripKm = 0): boolean {
  if (!t || !(t.morningFare && t.morningFare > 0) || !(t.morningKm && t.morningKm > 0) || !(t.morningPartner && t.morningPartner > 0)) return false;
  const pm = istMinutes(pickupMs);
  if (!(pm >= s.nextDayEightFromMinutes || pm < s.lateNightEndMinutes)) return false;
  if (Math.round(roundTripKm * 10) / 10 > t.morningKm) return false;
  return pickupMs + estMinutes * 60_000 <= morningCutoffOf(s, pickupMs);
}

export function slabFits(s: TimeBasedSettings, slab: SlabId, hours: number, km: number, pickupMin: number): boolean {
  if (slab === 'full') return true;
  const limit = slab === 'five' ? s.fiveHours : s.eightHours;
  if (hours > limit + 1e-9) return false;
  if (slab === 'five' ? !(km < s.shortKmLimit) : km > s.shortKmLimit) return false;
  return pickupMin + limit * 60 <= s.cutoffMinutes;
}

export interface FinalTimeBased {
  slab: SlabId | 'next' | 'morning';
  label: string;
  farePaise: number;
  partnerPaise: number;
  includedKm: number;
  upgraded: boolean;
  /** True when the trip ran past what the booked package covers: the office must review the fare (it is never added silently). */
  coverageExceeded: boolean;
  coverageEndMs: number;
}

/**
 * What the booking is finally charged against, from how long the trip really ran and how far it really went.
 * Same-day: a trip that outgrows its slab moves up to the smallest slab that fits (else the Full Day) — never down.
 * Morning Return still running after 9:00 AM becomes the Next-Day Return of the original pickup time.
 */
export function resolveTimeBasedFinal(tb: TimeBasedSnapshot, actual: { startMs?: number | null; endMs: number; totalKm: number }): FinalTimeBased {
  const s: TimeBasedSettings = { ...DEFAULT_TIME_BASED, enabled: true, cutoffMinutes: tb.cutoffMin, fiveHours: tb.limits.fiveHours, eightHours: tb.limits.eightHours, shortKmLimit: tb.limits.shortKmLimit };
  if (tb.kind === 'same_day' && tb.slabs && tb.selected) {
    const start = Number.isFinite(actual.startMs) && (actual.startMs as number) > 0 ? (actual.startMs as number) : tb.pickupMs;
    const hours = Math.max(0, (actual.endMs - start) / 3_600_000);
    const km = Math.round(actual.totalKm * 10) / 10;
    const needed: SlabId = (['five', 'eight'] as const).find((slab) => tb.slabs![slab] && slabFits(s, slab, hours, km, tb.pickupMin)) ?? 'full';
    const final: SlabId = SLAB_RANK[needed] > SLAB_RANK[tb.selected] ? needed : tb.selected;
    const a = tb.slabs[final] ?? tb.slabs[tb.selected]!;
    const coverageEndMs = istInstant(tb.pickupMs, 0, tb.cutoffMin);
    return {
      slab: final, label: SLAB_LABEL[final], farePaise: a.farePaise, partnerPaise: a.partnerPaise, includedKm: a.includedKm, upgraded: final !== tb.selected,
      coverageExceeded: actual.endMs > coverageEndMs, coverageEndMs,
    };
  }
  if (tb.kind === 'morning' && tb.upgrade && tb.morningCutoffMs && actual.endMs > tb.morningCutoffMs) {
    const u = tb.upgrade;
    return { slab: 'next', label: u.label, farePaise: u.farePaise, partnerPaise: u.partnerPaise, includedKm: u.includedKm, upgraded: true, coverageExceeded: actual.endMs > u.coverageEndMs, coverageEndMs: u.coverageEndMs };
  }
  const c = tb.base;
  return { slab: tb.kind === 'morning' ? 'morning' : 'next', label: tb.label, farePaise: c.farePaise, partnerPaise: c.partnerPaise, includedKm: c.includedKm, upgraded: false, coverageExceeded: actual.endMs > tb.coverageEndMs, coverageEndMs: tb.coverageEndMs };
}
