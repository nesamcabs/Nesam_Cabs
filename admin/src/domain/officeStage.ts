/**
 * The Master Admin vocabulary for a booking: which office stage it is in (New bookings → To publish
 * → Published → Accepted), how its trip type and customer group read, and the partner payout the
 * office sees. Everything is derived from the stored booking (and its marketplace record); nothing
 * here writes data.
 */
import type { Booking, MarketplaceTrip } from "../types";
import { bookingPickupDate, toDate, type DateLike } from "../utils/time";
import { fulfilmentOf } from "./bookingFlow";

/** The Bookings tabs: the four stages of an open booking, then where a booking ends up. */
export const OFFICE_STAGES = ["New bookings", "To publish", "Published", "Accepted", "Ongoing", "Completed", "Cancelled", "All bookings"] as const;
export type OfficeStage = (typeof OFFICE_STAGES)[number];
/** The stages of a booking that is still open (not yet on trip). */
export type OpenStage = "New bookings" | "To publish" | "Published" | "Accepted";

/** Stage of an open booking; null once it is on trip, completed, cancelled or rejected. */
export function officeStageOf(b: Booking, market?: Pick<MarketplaceTrip, "status"> | null): OpenStage | null {
  const f = fulfilmentOf(b, market?.status);
  switch (f) {
    case "awaiting_review": return "New bookings";
    case "awaiting_fulfilment": return "To publish";
    case "published": return "Published";
    case "vendor_assigned":
    case "driver_assigned": return "Accepted";
    default: return null;
  }
}

/** The Bookings tab a booking belongs in: its open stage, or Ongoing / Completed / Cancelled (rejected bookings count as Cancelled). */
export function bookingTabOf(b: Booking, market?: Pick<MarketplaceTrip, "status"> | null): Exclude<OfficeStage, "All bookings"> {
  switch (fulfilmentOf(b, market?.status)) {
    case "in_progress": return "Ongoing";
    case "completed": return "Completed";
    case "cancelled":
    case "rejected": return "Cancelled";
    default: return officeStageOf(b, market) ?? "New bookings";
  }
}

/** Status words the reference uses in the All bookings list and booking headers. */
export function officeStatusLabel(b: Booking, market?: Pick<MarketplaceTrip, "status"> | null): string {
  switch (fulfilmentOf(b, market?.status)) {
    case "awaiting_review": return "New booking";
    case "awaiting_fulfilment": return "To publish";
    case "published": return "Published";
    case "vendor_assigned": return "Assignment pending";
    case "driver_assigned": return "Assigned";
    case "in_progress": return "On trip";
    case "completed": return "Completed";
    case "rejected": return "Rejected";
    case "cancelled": return "Cancelled";
  }
}

const has = (re: RegExp, ...v: unknown[]) => v.some((x) => typeof x === "string" && re.test(x));

/** "One Way" · "Round Trip" · "Multi-stop" · "Local Rental" · "Package" (reference Trip type column). */
export function tripTypeOf(b: Pick<Booking, "service" | "serviceType" | "tripType">): string {
  const s = [b.tripType, b.serviceType, b.service];
  if (has(/multi|stop/i, ...s)) return "Multi-stop";
  if (has(/round/i, ...s)) return "Round Trip";
  if (has(/package|tour/i, ...s)) return "Package";
  if (has(/rental|hour|local\s*rent/i, ...s)) return "Local Rental";
  if (has(/drop|pickup\s*&|local/i, ...s) && !has(/airport/i, ...s)) return "Local Pickup & Drop";
  return "One Way";
}

/** The trip-type tabs on Bookings. */
export const TRIP_TABS = ["All trips", "One Way", "Round Trip", "Local Rental", "Multicity", "Airport Taxi"] as const;
export type TripTab = (typeof TRIP_TABS)[number];

/** Which trip-type tab a booking belongs to. A Multicity tour is stored as a Round Trip tagged Multicity, so that is checked first. */
export function tripTabOf(b: Pick<Booking, "service" | "serviceType" | "tripType">): Exclude<TripTab, "All trips"> {
  const s = [b.tripType, b.serviceType, b.service, (b as { tourType?: string }).tourType];
  if (has(/airport/i, ...s)) return "Airport Taxi";
  if (has(/multi/i, ...s)) return "Multicity";
  if (has(/round/i, ...s)) return "Round Trip";
  if (has(/rental|hour/i, ...s)) return "Local Rental";
  return "One Way";
}

/** Service family under the trip type: Outstation · Airport · Local. */
export function serviceFamilyOf(b: Pick<Booking, "service" | "serviceType" | "tripType">): string {
  const s = [b.tripType, b.serviceType, b.service];
  if (has(/airport/i, ...s)) return "Airport";
  if (has(/rental|hour|local/i, ...s)) return "Local";
  return "Outstation";
}

/** Trip-type filter used on Bookings (One Way / Round Trip / Multi-stop / Package). */
export function matchesTripType(b: Booking, filter: string): boolean {
  if (!filter || filter === "All") return true;
  return tripTypeOf(b) === filter;
}

export type CustomerGroup = "New" | "Returning" | "Regular" | "Unclassified";

const phoneKey = (v: unknown) => {
  const d = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return d.length >= 10 ? d.slice(-10) : "";
};

/**
 * Customer group for every booking: New (first trip), Returning (1–2 completed trips before),
 * Regular (3 or more), Unclassified (no customer contact on the booking).
 */
export function customerGroups(bookings: Booking[]): Map<string, CustomerGroup> {
  const completedBy = new Map<string, number[]>();
  const keyOf = (b: Booking) => b.customerId || phoneKey(b.phone || b.customerPhone);
  for (const b of bookings) {
    if (b.status !== "Completed") continue;
    const k = keyOf(b);
    if (!k) continue;
    const t = bookingPickupDate(b)?.getTime() ?? 0;
    completedBy.set(k, [...(completedBy.get(k) ?? []), t]);
  }
  const out = new Map<string, CustomerGroup>();
  for (const b of bookings) {
    const k = keyOf(b);
    if (!k || !(b.customer || b.customerName)) {
      out.set(b.id, "Unclassified");
      continue;
    }
    const at = bookingPickupDate(b)?.getTime() ?? Date.now();
    const before = (completedBy.get(k) ?? []).filter((t) => t < at).length;
    out.set(b.id, before >= 3 ? "Regular" : before >= 1 ? "Returning" : "New");
  }
  return out;
}

export const GROUP_TONE: Record<CustomerGroup, "green" | "amber" | "blue" | "neutral"> = {
  New: "green",
  Returning: "amber",
  Regular: "blue",
  Unclassified: "neutral",
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0);

export const fareOf = (b: Pick<Booking, "fare">) => num(b.fare);

/** Payout already agreed with a partner (accepted offer, awarded bid or office assignment). */
export const agreedPayoutOf = (b: Pick<Booking, "vendorPayout" | "driverPayout">) => num(b.vendorPayout) || num(b.driverPayout);

/**
 * The partner payout the office would start from before publishing: the tariff's normal partner
 * rate when the booking carries one, else the commission the booking was priced under.
 */
export function suggestedPayoutOf(b: Booking): number | null {
  const partner = b.pricing?.partner;
  if (partner && partner.mode === "NORMAL_RATE" && partner.basePaise > 0) return Math.round(partner.basePaise) / 100;
  const c = b.commission;
  if (c && typeof c.rate === "number") {
    const total = fareOf(b);
    const taxable = typeof b.fareBreakdown?.taxableAmount === "number" ? b.fareBreakdown.taxableAmount : total / 1.05;
    const base = c.base === "total" ? total : taxable;
    return Math.round(base * (1 - c.rate / 100));
  }
  return null;
}

// ── Dates in the reference style ──────────────────────────────────────────

const TZ = "Asia/Kolkata";
const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });

/** "24 Oct 2026" */
export function refDate(v: DateLike): string {
  const d = toDate(v);
  return d ? dateFmt.format(d) : "";
}

/** "8:00 AM" */
export function refTime(v: DateLike): string {
  const d = toDate(v);
  return d ? timeFmt.format(d).replace(/\s?(am|pm)$/i, (m) => " " + m.trim().toUpperCase()) : "";
}

/** "24 Oct 2026 · 8:00 am" */
export function refDateTime(v: DateLike): string {
  const d = toDate(v);
  return d ? `${refDate(d)} · ${refTime(d).toLowerCase()}` : "";
}

/** "3h remaining" · "1d 22h remaining" · "2h overdue". */
export function remainingLabel(target: Date, now: Date, suffix = "remaining"): string {
  const mins = Math.round((target.getTime() - now.getTime()) / 60000);
  const abs = Math.abs(mins);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const text = d ? `${d}d${h ? ` ${h}h` : ""}` : h ? `${h}h` : `${m}m`;
  return mins >= 0 ? `${text} ${suffix}` : `${text} overdue`;
}

/** When the driver and cab must be confirmed: `hours` before pickup (operations setting). */
export function assignmentDeadline(b: Booking, hours: number): Date | null {
  const p = bookingPickupDate(b);
  return p ? new Date(p.getTime() - hours * 3600000) : null;
}

export const rupee = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `₹${(Math.round(n * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "Chennai" from "Chennai, Porur"; the rest is the area. */
export function placeParts(v: string | undefined): { city: string; area: string } {
  const s = (v ?? "").trim();
  const i = s.indexOf(",");
  return i > 0 ? { city: s.slice(0, i).trim(), area: s.slice(i + 1).trim() } : { city: s, area: "" };
}

/** Where the booking came from, in the reference words (App · Office · Website · Partner). */
export function bookingSourceLabel(b: Pick<Booking, "source" | "bookingSource" | "createdBy" | "brand" | "website">): string {
  const s = String(b.bookingSource || b.source || "").toLowerCase();
  if (/admin|office|manual|phone/.test(s) || /admin/.test(String(b.createdBy || ""))) return "Office";
  if (/web|site|oneway|people/.test(s) || b.website) return "Website";
  if (/b2b|partner|corporate|api/.test(s)) return "Partner";
  return "App";
}
