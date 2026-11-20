// Driver ratings as the office reads them: one record per rated trip (functions/src/ratings.ts), grouped per driver.
// Pure functions only, so the grouping and the "needs attention" rules are the same everywhere and can be tested.

export type FollowUp = "None" | "New" | "In review" | "Resolved" | "Dismissed";
export const FOLLOW_UPS: ReadonlyArray<Exclude<FollowUp, "None">> = ["New", "In review", "Resolved", "Dismissed"];

/** Ratings up to and including this many stars are "low" (keep in step with functions/src/domain/ratingPolicy.ts). */
export const LOW_RATING_MAX = 2;

export interface DriverRating {
  id: string;
  source: "booking" | "local_taxi";
  bookingId: string;
  rideId: string;
  tripCode: string;
  driverId: string;
  driverName: string;
  vendorId: string;
  vehicleNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  stars: number;
  low: boolean;
  tags: string[];
  reason: string;
  feedback: string;
  improvements: string;
  comment: string;
  followUp: FollowUp;
  adminNote: string;
  handledByName?: string;
  handledAt?: unknown;
  createdAt?: unknown;
}

/** The driver fields the ratings page reads (a subset of the admin Driver type). */
export interface RatedDriver {
  id: string;
  name: string;
  phone?: string;
  vendorId?: string;
  vehicleNumber?: string;
  assignedVehicleNumber?: string;
  status?: string;
  rating?: number;
  ratingCount?: number;
  lowRatingCount?: number;
  ratingBreakdown?: Record<string, number>;
}

export type Standing = "Excellent" | "Good" | "Watch" | "At risk" | "Not rated";

export interface DriverSummary {
  driverId: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  isVendorDriver: boolean;
  /** Average the driver's profile shows (running average kept by the server), else the average of the records. */
  average: number;
  /** Ratings counted on the profile (may exceed the records when ratings pre-date this page). */
  count: number;
  /** Records available to read here. */
  records: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
  low: number;
  lowShare: number;
  open: number;
  last30Average: number | null;
  last30Count: number;
  lastRatedAt: number | null;
  standing: Standing;
  topReasons: Array<{ reason: string; count: number }>;
}

export const toMillis = (v: unknown): number | null => {
  if (!v) return null;
  if (v instanceof Date) return v.getTime();
  const t = v as { toMillis?: () => number; toDate?: () => Date; seconds?: number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  if (typeof t.seconds === "number") return t.seconds * 1000;
  const n = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

/** How a driver stands, from the average and how many ratings stand behind it. */
export function standingOf(average: number, count: number, lowShare: number): Standing {
  if (count <= 0) return "Not rated";
  // Few ratings: a single bad trip must not brand a driver, but it should still be visible.
  if (count < 5) return average < 3 ? "Watch" : "Good";
  if (average < 3.5 || lowShare >= 0.3) return "At risk";
  if (average < 4.2 || lowShare >= 0.15) return "Watch";
  return average >= 4.7 && lowShare < 0.05 ? "Excellent" : "Good";
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const emptyBreakdown = (): DriverSummary["breakdown"] => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

/** One summary per driver: every driver in `drivers`, plus any driver that only appears in the records. */
export function summariseDrivers(ratings: DriverRating[], drivers: RatedDriver[], now = Date.now()): DriverSummary[] {
  const byDriver = new Map<string, DriverRating[]>();
  for (const r of ratings) {
    if (!r.driverId) continue;
    const list = byDriver.get(r.driverId);
    if (list) list.push(r);
    else byDriver.set(r.driverId, [r]);
  }
  const known = new Map(drivers.map((d) => [d.id, d]));
  const ids = new Set<string>([...known.keys(), ...byDriver.keys()]);
  const since = now - 30 * 86400000;

  return [...ids].map((id) => {
    const d = known.get(id);
    const list = byDriver.get(id) ?? [];
    const breakdown = emptyBreakdown();
    let sum = 0;
    let low = 0;
    let open = 0;
    let recentSum = 0;
    let recentCount = 0;
    let last: number | null = null;
    const reasons = new Map<string, number>();
    for (const r of list) {
      const s = Math.min(5, Math.max(1, Math.round(r.stars))) as 1 | 2 | 3 | 4 | 5;
      breakdown[s]++;
      sum += s;
      if (s <= LOW_RATING_MAX) {
        low++;
        if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
        if (r.followUp === "New" || r.followUp === "In review") open++;
      }
      const at = toMillis(r.createdAt);
      if (at != null) {
        if (last == null || at > last) last = at;
        if (at >= since) {
          recentSum += s;
          recentCount++;
        }
      }
    }
    const profileCount = Number(d?.ratingCount) || 0;
    const profileAverage = Number(d?.rating) || 0;
    // The profile counts every rating since the beginning; the records only the ones kept here. Prefer the profile.
    const useProfile = profileCount >= list.length && profileCount > 0 && profileAverage > 0;
    const count = useProfile ? profileCount : list.length;
    const average = useProfile ? profileAverage : list.length ? round2(sum / list.length) : 0;
    const lowCount = Math.max(low, Number(d?.lowRatingCount) || 0);
    const lowShare = count > 0 ? Math.min(1, lowCount / count) : 0;
    return {
      driverId: id,
      name: d?.name || list[0]?.driverName || "Unknown driver",
      phone: d?.phone ?? "",
      vehicleNumber: d?.assignedVehicleNumber || d?.vehicleNumber || list[0]?.vehicleNumber || "",
      isVendorDriver: !!d?.vendorId,
      average,
      count,
      records: list.length,
      breakdown,
      low: lowCount,
      lowShare,
      open,
      last30Average: recentCount ? round2(recentSum / recentCount) : null,
      last30Count: recentCount,
      lastRatedAt: last,
      standing: standingOf(average, count, lowShare),
      topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([reason, count]) => ({ reason, count })),
    };
  });
}

export interface FleetSummary {
  drivers: number;
  ratedDrivers: number;
  ratings: number;
  average: number;
  lowRatings: number;
  openFollowUps: number;
  atRisk: number;
}

export function summariseFleet(rows: DriverSummary[], ratings: DriverRating[]): FleetSummary {
  const rated = rows.filter((r) => r.count > 0);
  const total = rated.reduce((s, r) => s + r.count, 0);
  const weighted = rated.reduce((s, r) => s + r.average * r.count, 0);
  return {
    drivers: rows.length,
    ratedDrivers: rated.length,
    ratings: total,
    average: total ? round2(weighted / total) : 0,
    lowRatings: ratings.filter((r) => r.low).length,
    openFollowUps: ratings.filter((r) => r.low && (r.followUp === "New" || r.followUp === "In review")).length,
    atRisk: rows.filter((r) => r.standing === "At risk").length,
  };
}

/** The reasons customers give most often across all low ratings (the first thing to fix as a business). */
export function reasonCounts(ratings: DriverRating[]): Array<{ reason: string; count: number }> {
  const m = new Map<string, number>();
  for (const r of ratings) if (r.low && r.reason) m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Spreadsheet formulas typed by a customer must not run when the file is opened.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function ratingsCsv(ratings: DriverRating[]): string {
  const head = ["Date", "Trip", "Source", "Driver", "Vehicle", "Customer", "Stars", "Reason", "What happened", "Improvements", "Comment", "Tags", "Follow-up", "Office note"];
  const rows = ratings.map((r) => {
    const at = toMillis(r.createdAt);
    return [at ? new Date(at).toISOString() : "", r.tripCode, r.source === "local_taxi" ? "Local Taxi" : "Booking", r.driverName, r.vehicleNumber, r.customerName, r.stars, r.reason, r.feedback, r.improvements, r.comment, r.tags.join("; "), r.followUp, r.adminNote];
  });
  return [head, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
