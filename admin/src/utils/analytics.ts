import { Booking } from "../types";

/** Parse "₹1,250" | 1250 | "1250.5" -> number (0 on failure). */
export const parseAmount = (v: string | number | undefined | null): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (!v) return 0;
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Best-effort date for a booking: Firestore Timestamp -> createdAt seconds -> date string. */
export const bookingDate = (b: Booking): Date | null => {
  const c = b.createdAt as any;
  if (c instanceof Date) return Number.isNaN(c.getTime()) ? null : c;
  if (c?.toDate) return c.toDate();
  if (c?.seconds) return new Date(c.seconds * 1000);
  if (b.date) {
    const d = new Date(b.date);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
};

export const isPaid = (b: Booking): boolean =>
  b.payment === "Paid" || b.paymentStatus === "Paid";

/** Compact Indian-currency formatting: ₹1.2K, ₹3.84L, ₹1.20Cr. */
export const formatINR = (n: number): string => {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${Math.round(n)}`;
};

export const inMonth = (d: Date | null, ref: Date): boolean =>
  d !== null &&
  d.getMonth() === ref.getMonth() &&
  d.getFullYear() === ref.getFullYear();

/** Signed percentage change; null when there is no baseline. */
export const pctChange = (current: number, previous: number): number | null =>
  previous > 0 ? ((current - previous) / previous) * 100 : null;

export const formatPct = (v: number | null): string =>
  v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Passenger transport GST (SAC 9964) applied by the booking backend. */
export const GST_RATE = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GST contained in a booking's fare. `fare` is the GST-inclusive total; the
 * server stores the exact split in `fareBreakdown`, otherwise it is derived.
 */
export const bookingGst = (b: Booking): number => {
  const gst = (b as { fareBreakdown?: { gst?: unknown } }).fareBreakdown?.gst;
  if (typeof gst === "number" && Number.isFinite(gst)) return gst;
  const total = parseAmount(b.fare);
  return round2(total - total / (1 + GST_RATE));
};

/** Taxable value (fare excluding GST) of a booking. */
export const bookingTaxable = (b: Booking): number =>
  round2(parseAmount(b.fare) - bookingGst(b));

export interface GstMonthRow {
  month: string;
  trips: number;
  taxable: number;
  gst: number;
  total: number;
}

/**
 * Month-wise GST on completed trips, newest month first. Only months with at
 * least one completed trip are returned.
 */
export const monthlyGstSummary = (bookings: Booking[]): GstMonthRow[] => {
  const rows = new Map<string, GstMonthRow & { sort: number }>();
  for (const b of bookings) {
    if (b.status !== "Completed") continue;
    // Tax period follows the date the service was completed.
    const done = b.completedAt as Date | { toDate?: () => Date; seconds?: number } | undefined;
    const d =
      done instanceof Date
        ? done
        : done?.toDate
          ? done.toDate()
          : done?.seconds
            ? new Date(done.seconds * 1000)
            : bookingDate(b);
    if (!d) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const row =
      rows.get(key) ??
      {
        month: d.toLocaleString("en-IN", { month: "short", year: "numeric" }),
        sort: d.getFullYear() * 12 + d.getMonth(),
        trips: 0,
        taxable: 0,
        gst: 0,
        total: 0,
      };
    row.trips += 1;
    row.taxable = round2(row.taxable + bookingTaxable(b));
    row.gst = round2(row.gst + bookingGst(b));
    row.total = round2(row.total + parseAmount(b.fare));
    rows.set(key, row);
  }
  return [...rows.values()]
    .sort((a, b) => b.sort - a.sort)
    .map((r) => ({ month: r.month, trips: r.trips, taxable: r.taxable, gst: r.gst, total: r.total }));
};
