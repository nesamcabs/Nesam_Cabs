// Time-based round trip (Customer UX v7): turns the server's per-vehicle package lists into the one fare in force.
// The server prices every package (5-hour, 8-hour, Full-Day, Next-Day, Morning Return) for every vehicle; the rider picks a
// package, and from then on every screen reads that package's fare as if it were the vehicle's only fare.
import type { HillStationInfo, ServerCategoryQuote, ServerQuoteResponse, ServerTimePackage } from '../services/quoteService';

const IST_OFFSET_MS = 19_800_000;
const DAY_MS = 86_400_000;
/** Minutes after IST midnight of an instant (0–1439): the packages are defined on IST clock time, whatever zone the device is in. */
export const istMinutesOf = (d: Date): number => Math.floor(((((d.getTime() + IST_OFFSET_MS) % DAY_MS) + DAY_MS) % DAY_MS) / 60_000);

/** "17 Nov" — the way the guide writes a package's return date. */
export const packageDay = (d: Date): string => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`;
/** "11:45 PM" / "9:00 AM" — no leading zero, upper-case meridiem. */
export const packageClock = (d: Date): string => d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

/** A same-day package ends at 11:45 PM and the shortest runs 5 hours, so a pickup after 6:45 PM can never finish the same day. */
export const OVERNIGHT_AFTER_MIN = 18 * 60 + 45;
/** Pickups before 1:00 AM (12:00–12:59 AM) still belong to the previous night: no same-day package either (Customer UX v8 §04). */
export const LATE_NIGHT_END_MIN = 60;

/** True when a round trip picked up at this instant has no same-day package, so it is at least a 2-day trip (6:46 PM – 12:59 AM). */
export function isOvernightPickup(at: Date | null | undefined): boolean {
  if (!at || Number.isNaN(at.getTime())) return false;
  const m = istMinutesOf(at);
  return m > OVERNIGHT_AFTER_MIN || m < LATE_NIGHT_END_MIN;
}

/**
 * The days the server is asked about. When the trip became 2 days only because the rider picked an overnight package
 * (`daysAuto`), the server is still asked for the rider's own 1 day, so the same-day packages stay on the list and
 * moving the pickup earlier brings the trip back to 1 day. Days the rider chose themselves are always sent as chosen.
 */
export function requestedTripDays(d: { tripDays: number; daysAuto?: boolean }): number {
  return d.daysAuto ? 1 : d.tripDays;
}

/** The vehicle's quote with the picked package's fare, breakup, included km and days in place of the default package's. */
export function withTimePackage(x: ServerCategoryQuote, wanted: string): ServerCategoryQuote {
  if (!x.ok || !x.packages?.length) return x;
  const pkg = x.packages.find((p) => p.id === wanted) ?? x.packages.find((p) => p.id === x.selectedPackage) ?? x.packages[0]!;
  return {
    ...x, fare: pkg.fare, breakup: pkg.breakup, strikeTotal: pkg.strikeTotal, couponMessage: pkg.couponMessage, couponApplied: pkg.couponApplied,
    includedKm: pkg.includedKm, days: pkg.days, extraKmRate: pkg.extraKmRate, selectedPackage: pkg.id,
  };
}

export interface TimePackageView {
  data: ServerQuoteResponse | null;
  /** The packages of the chosen vehicle (before a vehicle is chosen: of the first vehicle that has any). */
  packages: ServerTimePackage[];
  selected: ServerTimePackage | null;
  /** 1 day was asked for, but the pickup is too late to finish the same day, so 2 days are quoted. */
  autoDays: boolean;
  /** Every vehicle was refused as a custom quote (more days than the configured maximum). */
  customQuote: boolean;
  /** Hill stations on the trip (Customer UX v8): a separate Hill Station Allowance / Charge, no 5-hour / 8-hour package. */
  hillStations: HillStationInfo[];
}

export function timePackageView(data: ServerQuoteResponse | null, wanted: string, categoryId: string): TimePackageView {
  if (!data) return { data, packages: [], selected: null, autoDays: false, customQuote: false, hillStations: [] };
  const own = data.quotes.find((x) => x.categoryId === categoryId && x.ok && x.packages?.length);
  const source = own ?? data.quotes.find((x) => x.ok && x.packages?.length) ?? null;
  const packages = source?.packages ?? [];
  const selected = packages.find((p) => p.id === wanted) ?? packages.find((p) => p.id === source?.selectedPackage) ?? packages[0] ?? null;
  return {
    data: { ...data, quotes: data.quotes.map((x) => withTimePackage(x, wanted)) },
    packages, selected, autoDays: source?.autoDays === true,
    customQuote: data.quotes.length > 0 && data.quotes.every((x) => !x.ok && x.code === 'custom-quote'),
    hillStations: data.hillStations ?? [],
  };
}

/**
 * The one-line rule under the round-trip packages (Customer UX 9.0): which package follows from how long the trip runs. It is built from
 * the packages the server returned for this pickup, so the hours, kilometres and cutoff it names are always the ones in force.
 */
export function packageRuleText(packages: ServerTimePackage[], clock: (at: Date) => string): string {
  if (!packages.length) return '';
  const find = (id: string) => packages.find((p) => p.id === id);
  const five = find('same:five');
  const eight = find('same:eight');
  const full = find('same:full');
  const next = find('next');
  const morning = packages.find((p) => p.kind === 'morning');
  if (morning) return `Choose ${morning.label} or ${next?.label ?? 'the next package'}. The ${clock(new Date(morning.morningCutoffAt ?? morning.endAt))} ${morning.label} cutoff is fixed.`;
  if (full) {
    const end = clock(new Date(full.endAt));
    if (five && eight) return `Over ${five.hours} hours → ${eight.label}. Over ${eight.hours} hours or ${eight.includedKm} km → ${full.label}. Return by ${end}.`;
    if (five) return `${five.label} or ${full.label} fits this pickup. Over ${five.hours} hours → ${full.label}. Return by ${end}.`;
    if (eight) return `Over ${eight.hours} hours or ${eight.includedKm} km → ${full.label}. Return by ${end}.`;
    return `${full.label} ends at ${end} on your pickup date. Extra kilometres follow your selected vehicle rate.`;
  }
  if (next) return `${next.label} is valid until ${clock(new Date(next.endAt))} on the last day. Driver bata for all days is included.`;
  return '';
}
