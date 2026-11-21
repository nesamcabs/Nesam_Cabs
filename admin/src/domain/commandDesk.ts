/**
 * The Master Admin command desk, as pure rules: which stage a booking is in, how source / stage / service / search filters combine,
 * which pickups are today and tomorrow (India time), what the revenue cards add up, the hourly offer schedule, the order bids are
 * decided in, and the text of the duty slip and final bill. Nothing here reads or writes data.
 */
import type { Booking, MarketplaceTrip } from "../types";
import { addDaysISO, bookingPickupDate, dayOffsetIST, isoDateIST } from "../utils/time";
import { bookingTaxable } from "../utils/analytics";
import { paymentOf } from "./bookingFlow";
import { getBookingSourceDisplay, type BookingSourceDisplay, type BookingSourceType } from "./bookingSource";
import { agreedPayoutOf, bookingTabOf, displayTripType, fareOf, rupee, tripTabOf, type TripTab } from "./officeStage";

// ── Sources ────────────────────────────────────────────────────────────────

export type SourceScope = "ALL" | BookingSourceType;
export const SOURCE_NAME: Record<BookingSourceType, string> = { nesam: "Nesam Cabs", people_taxi: "PeopleTaxi.in", onewaycarrentals: "One Way Car Rentals" };
export const SOURCE_ORDER: BookingSourceType[] = ["nesam", "people_taxi", "onewaycarrentals"];

/** Brand scope of a booking. A booking with no recognisable source shows under "All sources" only, never under a brand. */
export const inScope = (b: Booking, scope: SourceScope): boolean => scope === "ALL" || getBookingSourceDisplay(b) === scope;

export function sourceCounts(bookings: Booking[]): Record<BookingSourceDisplay, number> {
  const out: Record<BookingSourceDisplay, number> = { nesam: 0, people_taxi: 0, onewaycarrentals: 0, unknown: 0 };
  for (const b of bookings) out[getBookingSourceDisplay(b)]++;
  return out;
}

// ── Stages ─────────────────────────────────────────────────────────────────

/**
 * The five pipeline stages plus where a trip goes after them. "assign" is an accepted duty still waiting for driver and cab details;
 * "assigned" has a driver and cab and waits for the driver to start the trip.
 */
export type DeskStage = "new" | "publish" | "published" | "assign" | "assigned" | "ontrip" | "completed" | "cancelled";
export const PIPELINE_STAGES = ["new", "publish", "published", "assign", "ontrip"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Record<DeskStage, string> = {
  new: "New", publish: "To Publish", published: "Published", assign: "Assign Pending", assigned: "Assigned", ontrip: "On Trip", completed: "Completed", cancelled: "Cancelled",
};
/** Tab names of the All Trips explorer (the reference's six, then the stages that follow them). */
export const TAB_LABEL: Record<"all" | DeskStage, string> = {
  all: "All Trips", new: "New bookings", publish: "To publish", published: "Published", assign: "Assign pending", ontrip: "Ongoing", assigned: "Assigned", completed: "Completed", cancelled: "Cancelled",
};
export const TAB_ORDER: ("all" | DeskStage)[] = ["all", "new", "publish", "published", "assign", "ontrip", "assigned", "completed", "cancelled"];

export interface TripRow { b: Booking; stage: DeskStage; market?: Pick<MarketplaceTrip, "status"> & Partial<MarketplaceTrip> }

/** The one stage mapping every card, queue, table and count uses (it is the office's existing booking-tab rule, legacy statuses included). */
export function deskStageOf(b: Booking, market?: Pick<MarketplaceTrip, "status"> | null): DeskStage {
  switch (bookingTabOf(b, market)) {
    case "New bookings": return "new";
    case "To publish": return "publish";
    case "Published": return "published";
    case "Accepted": return b.assignedDriverId ? "assigned" : "assign";
    case "Ongoing": return "ontrip";
    case "Completed": return "completed";
    case "Cancelled": return "cancelled";
  }
}

export function buildRows(bookings: Booking[], marketById: Map<string, MarketplaceTrip>): TripRow[] {
  return bookings.map((b) => ({ b, stage: deskStageOf(b, marketById.get(b.id)), market: marketById.get(b.id) }));
}

export function stageCounts(rows: TripRow[]): Record<DeskStage, number> {
  const c: Record<DeskStage, number> = { new: 0, publish: 0, published: 0, assign: 0, assigned: 0, ontrip: 0, completed: 0, cancelled: 0 };
  for (const r of rows) c[r.stage]++;
  return c;
}

/** Stages that are still open work (not finished, not cancelled). */
export const isOpenStage = (s: DeskStage) => s !== "completed" && s !== "cancelled";

// ── Filters ────────────────────────────────────────────────────────────────

export type StageFilter = "all" | DeskStage;
export const SERVICE_PILLS = ["All Trips", "One Way", "Round Trip", "Hourly Rental", "Pickup & Drop", "Multicity", "Airport"] as const;
export type ServicePill = (typeof SERVICE_PILLS)[number];

const PILL_OF_TAB: Record<Exclude<TripTab, "All trips">, ServicePill> = {
  "One Way": "One Way", "Round Trip": "Round Trip", "Local Rental": "Hourly Rental", "Pickup & Drop": "Pickup & Drop", Multicity: "Multicity", "Airport Taxi": "Airport",
};
export const servicePillOf = (b: Booking): ServicePill => PILL_OF_TAB[tripTabOf(b)];

export const customerNameOf = (b: Booking) => b.customer || b.customerName || "";
export const phoneOf = (b: Booking) => String(b.phone || b.customerPhone || "");

/** Everything a search can match: ids, the route and its stops, the customer and — only when the booking carries it — the mobile number. */
export function searchHaystack(b: Booking): string {
  const stops = Array.isArray(b.itinerary) ? b.itinerary.map((p) => p.name) : [];
  return [b.id, b.bookingId, customerNameOf(b), phoneOf(b).replace(/\D/g, ""), phoneOf(b), b.pickup, b.drop, ...stops].filter(Boolean).join(" ").toLowerCase();
}

export interface TripFilters { stage: StageFilter; service: ServicePill; search: string }
export const NO_TRIP_FILTERS: TripFilters = { stage: "all", service: "All Trips", search: "" };

export function matchesFilters(r: TripRow, f: TripFilters): boolean {
  if (f.stage !== "all" && r.stage !== f.stage) return false;
  if (f.service !== "All Trips" && servicePillOf(r.b) !== f.service) return false;
  const q = f.search.trim().toLowerCase();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const hay = searchHaystack(r.b);
    // A mobile number matches on its digits, so "98421 44510" and "+91 9842144510" find the same booking.
    if (!hay.includes(q) && !(digits.length >= 4 && hay.includes(digits))) return false;
  }
  return true;
}

const pickupMs = (b: Booking) => bookingPickupDate(b)?.getTime() ?? 0;
export const byPickup = (a: TripRow, z: TripRow) => pickupMs(a.b) - pickupMs(z.b);

/** Rows after the source scope, stage, service and search filters, soonest pickup first. */
export function filterRows(rows: TripRow[], scope: SourceScope, f: TripFilters): TripRow[] {
  return rows.filter((r) => inScope(r.b, scope) && matchesFilters(r, f)).sort(byPickup);
}

// ── Today / tomorrow ───────────────────────────────────────────────────────

/** Open trips whose pickup falls on today / tomorrow on the India calendar (so 11:59 PM and 12:01 AM land on different days). */
export function scheduleSplit(rows: TripRow[], now: Date): { today: TripRow[]; tomorrow: TripRow[] } {
  const today: TripRow[] = [], tomorrow: TripRow[] = [];
  for (const r of rows) {
    if (!isOpenStage(r.stage)) continue;
    const p = bookingPickupDate(r.b);
    if (!p) continue;
    const d = dayOffsetIST(p, now);
    if (d === 0) today.push(r);
    else if (d === 1) tomorrow.push(r);
  }
  return { today: today.sort(byPickup), tomorrow: tomorrow.sort(byPickup) };
}

// ── Revenue ────────────────────────────────────────────────────────────────

export type Period = "Today" | "Week" | "Month" | "Year";
export interface Bucket { label: string; start: number; end: number }
export interface PeriodWindow { period: Period; start: number; end: number; prevStart: number; prevEnd: number; buckets: Bucket[]; scope: string; prevScope: string }

const istStart = (iso: string) => Date.parse(`${iso}T00:00:00+05:30`);
const DAY = 86400000;
const fmtDay = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o }).format(new Date(ms));
const dayLabel = (ms: number) => fmtDay(ms, { day: "numeric", month: "short" });
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h >= 12 ? "PM" : "AM"}`;

/**
 * The window a revenue card covers, in India time, and the equivalent window before it: a calendar day against the day before, the
 * last 7 days against the 7 before, the last 30 days against the 30 before, this calendar year against last year.
 * Bookings are placed by their pickup (service) date, so a trip later today is part of today.
 */
export function periodWindow(period: Period, now: Date): PeriodWindow {
  const todayIso = isoDateIST(now);
  const todayStart = istStart(todayIso);
  const tomorrowStart = todayStart + DAY;
  if (period === "Today") {
    const buckets = [0, 4, 8, 12, 16, 20].map((h) => ({ label: hourLabel(h), start: todayStart + h * 3600000, end: todayStart + (h + 4) * 3600000 }));
    return { period, start: todayStart, end: tomorrowStart, prevStart: todayStart - DAY, prevEnd: todayStart, buckets,
      scope: `Today · ${fmtDay(todayStart, { weekday: "short", day: "numeric", month: "short" })} · IST`, prevScope: "yesterday" };
  }
  if (period === "Week") {
    const start = tomorrowStart - 7 * DAY;
    const buckets = Array.from({ length: 7 }, (_, i) => ({ label: fmtDay(start + i * DAY, { weekday: "short" }), start: start + i * DAY, end: start + (i + 1) * DAY }));
    return { period, start, end: tomorrowStart, prevStart: start - 7 * DAY, prevEnd: start, buckets,
      scope: `Last 7 days · ${dayLabel(start)} – ${dayLabel(todayStart)} · IST`, prevScope: "the 7 days before" };
  }
  if (period === "Month") {
    const start = tomorrowStart - 30 * DAY;
    const buckets = Array.from({ length: 6 }, (_, i) => ({ label: dayLabel(start + i * 5 * DAY), start: start + i * 5 * DAY, end: start + (i + 1) * 5 * DAY }));
    return { period, start, end: tomorrowStart, prevStart: start - 30 * DAY, prevEnd: start, buckets,
      scope: `Last 30 days · ${dayLabel(start)} – ${dayLabel(todayStart)} · IST`, prevScope: "the 30 days before" };
  }
  const year = Number(todayIso.slice(0, 4));
  const start = istStart(`${year}-01-01`);
  const buckets = [0, 3, 6, 9].map((m, i) => ({ label: `Q${i + 1}`, start: istStart(`${year}-${String(m + 1).padStart(2, "0")}-01`), end: i === 3 ? istStart(`${year + 1}-01-01`) : istStart(`${year}-${String(m + 4).padStart(2, "0")}-01`) }));
  return { period, start, end: istStart(`${year + 1}-01-01`), prevStart: istStart(`${year - 1}-01-01`), prevEnd: start, buckets,
    scope: `${year} · Jan – Dec · IST`, prevScope: String(year - 1) };
}

/** What the customer is billed: the fare, plus tolls and approved extras once the trip is completed. Cancelled and rejected bookings are worth nothing. */
export const bookedValue = (b: Booking): number => (b.status === "Cancelled" || b.status === "Rejected" ? 0 : paymentOf(b).amountDue);
/** Cash actually recorded against the booking, net of refunds already paid out. */
export const collectedValue = (b: Booking): number => { const p = paymentOf(b); return Math.max(0, p.totalPaid - p.refunded); };
/** Customer value before GST less the agreed partner payout; null until a payout is agreed. */
export const marginOf = (b: Booking, payout = agreedPayoutOf(b)): number | null => (payout > 0 ? Math.round((bookingTaxable(b) - payout) * 100) / 100 : null);

export type ServiceKey = "ONEWAY" | "ROUND" | "MULTI" | "AIRPORT" | "RENTAL";
export const SERVICE_KEYS: ServiceKey[] = ["ONEWAY", "ROUND", "MULTI", "AIRPORT", "RENTAL"];
export const SERVICE_NAME: Record<ServiceKey, string> = { ONEWAY: "One Way", ROUND: "Round Trip", MULTI: "Multicity", AIRPORT: "Airport Taxi", RENTAL: "Hourly Rental" };
/** A Pickup & Drop inside one city is a One Way trip stored as "Local", so it is counted under ONEWAY. */
export function serviceKeyOf(b: Booking): ServiceKey {
  switch (tripTabOf(b)) {
    case "Round Trip": return "ROUND";
    case "Multicity": return "MULTI";
    case "Airport Taxi": return "AIRPORT";
    case "Local Rental": return "RENTAL";
    default: return "ONEWAY";
  }
}

export interface RevenueSummary {
  booked: number; collected: number; outstanding: number; margin: number; marginTrips: number; count: number;
  buckets: number[]; byService: Record<ServiceKey, number>; bySource: Record<BookingSourceDisplay, { booked: number; count: number }>;
}
const emptySummary = (n: number): RevenueSummary => ({
  booked: 0, collected: 0, outstanding: 0, margin: 0, marginTrips: 0, count: 0, buckets: Array(n).fill(0),
  byService: { ONEWAY: 0, ROUND: 0, MULTI: 0, AIRPORT: 0, RENTAL: 0 }, bySource: { nesam: { booked: 0, count: 0 }, people_taxi: { booked: 0, count: 0 }, onewaycarrentals: { booked: 0, count: 0 }, unknown: { booked: 0, count: 0 } },
});

/** Adds up the bookings whose pickup falls in [start, end). Bookings without a pickup time or worth nothing are left out. */
export function revenueSummary(bookings: Booking[], start: number, end: number, buckets: Bucket[] = []): RevenueSummary {
  const out = emptySummary(buckets.length);
  for (const b of bookings) {
    const t = bookingPickupDate(b)?.getTime();
    if (t === undefined || t < start || t >= end) continue;
    const value = bookedValue(b);
    const cash = collectedValue(b);
    if (value <= 0 && cash <= 0) continue;
    out.count++;
    out.booked += value;
    out.collected += cash;
    if (value > 0) out.outstanding += paymentOf(b).balanceDue;
    const m = value > 0 ? marginOf(b) : null;
    if (m !== null) { out.margin += m; out.marginTrips++; }
    out.byService[serviceKeyOf(b)] += value;
    const src = out.bySource[getBookingSourceDisplay(b)];
    src.booked += value;
    src.count++;
    const i = buckets.findIndex((k) => t >= k.start && t < k.end);
    if (i >= 0) out.buckets[i] += value;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  out.booked = r(out.booked); out.collected = r(out.collected); out.outstanding = r(out.outstanding); out.margin = r(out.margin);
  return out;
}

export interface Change { kind: "none" | "up" | "down" | "flat"; pct: number | null }
/** Change against the equivalent earlier period. With nothing to compare against there is no percentage — never an invented one. */
export function changeOf(current: number, previous: number): Change {
  if (!(previous > 0)) return { kind: "none", pct: null };
  const pct = Math.round(((current - previous) / previous) * 1000) / 10;
  return { kind: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct };
}
export const changeLabel = (c: Change) => (c.pct === null ? "No prior period" : `${c.pct > 0 ? "▲ +" : c.pct < 0 ? "▼ " : "• "}${c.pct}%`);

/** Value of the work still in the pipeline: every open trip, whatever its date. */
export const pipelineValue = (rows: TripRow[]): number =>
  Math.round(rows.filter((r) => isOpenStage(r.stage)).reduce((s, r) => s + fareOf(r.b), 0) * 100) / 100;

// ── Hourly offer schedule and bids (mirrors functions/src/domain/offerSchedule.ts) ──

/** Offer after `steps` whole hours: min(ceiling, round(start × (1 + step%)^steps)). Step 0 is the start offer exactly. */
export function scheduledOffer(start: number, stepPercent: number, ceiling: number, steps: number): number {
  if (!(steps > 0)) return start;
  const raw = Math.round(start * Math.pow(1 + stepPercent / 100, steps));
  return ceiling > 0 ? Math.min(ceiling, raw) : raw;
}
/** Whole hours since publication, measured from the server's publication time. */
export const elapsedWholeHours = (publishedMs: number | null | undefined, nowMs: number) => (publishedMs ? Math.max(0, Math.floor((nowMs - publishedMs) / 3600000)) : 0);

export interface RankableBid { id: string; status?: unknown; amount: number; submittedAtMs: number }
/** Bids under review, lowest first; a tie goes to the bid placed first, then to the lower id. */
export function rankPendingBids<T extends RankableBid>(bids: T[]): T[] {
  return bids
    .filter((b) => b.status === "Pending Review" && Number.isFinite(b.amount) && b.amount > 0)
    .sort((a, z) => a.amount - z.amount || a.submittedAtMs - z.submittedAtMs || (a.id < z.id ? -1 : a.id > z.id ? 1 : 0));
}

export const MAX_PAYOUT = 1_000_000;
export function fixedPayoutError(fare: number, payout: number): string | null {
  if (!Number.isInteger(payout) || payout <= 0) return "Enter the partner payout in whole rupees.";
  if (payout > MAX_PAYOUT) return "That payout looks too high. Check the amount.";
  if (payout > fare) return "The payout must be within the customer fare.";
  return null;
}
export function biddingError(fare: number, start: number, cap: number): string | null {
  const first = fixedPayoutError(fare, start);
  if (first) return first.replace("partner payout", "starting bid");
  if (!Number.isInteger(cap) || cap <= 0) return "Enter the maximum ending price in whole rupees.";
  if (cap <= start) return "The maximum price must be above the starting bid.";
  if (cap > fare) return "The maximum price cannot exceed the customer fare.";
  return null;
}

// ── Assignment text ────────────────────────────────────────────────────────

export interface Assignee { primary: string; secondary: string; tone: "muted" | "ok" | "warn" | "info" }
/** The Driver / Vendor column: who has the duty, or what is still needed. */
export function assigneeOf(r: TripRow): Assignee {
  const { b, stage, market } = r;
  const driver = b.assignedDriverName || b.driver || "";
  if (stage === "new") return { primary: "Awaiting approval", secondary: "", tone: "muted" };
  if (stage === "publish") return { primary: "Not published", secondary: "Approved · choose payout", tone: "warn" };
  if (stage === "published") {
    const bidding = market?.mode === "bid_review" || Boolean(market?.escalation?.enabled);
    const offer = Number(market?.offeredPayout) || 0;
    const cap = market?.ceiling ?? (market?.escalation?.ceilingPaise ? market.escalation.ceilingPaise / 100 : 0);
    return bidding
      ? { primary: `Bidding · ${rupee(offer)}${cap ? ` → ${rupee(cap)}` : ""}`, secondary: "Open to partners", tone: "info" }
      : { primary: `Fixed ${rupee(offer)}`, secondary: "Open to partners", tone: "info" };
  }
  if (stage === "assign") return { primary: b.assignedVendorName ? `Vendor: ${b.assignedVendorName}` : "Accepted", secondary: "Needs driver & cab", tone: "warn" };
  return {
    primary: driver || (b.assignedVendorName ? `Vendor: ${b.assignedVendorName}` : "Assigned"),
    secondary: [driver && b.assignedVendorName ? b.assignedVendorName : "", b.assignedVehicleNumber ?? ""].filter(Boolean).join(" · "),
    tone: "ok",
  };
}

// ── Duty slip and final bill (WhatsApp formatting; copying never sends anything) ──

const e164 = (v: string) => { const d = v.replace(/\D/g, ""); return d.length >= 10 ? `+91 ${d.slice(-10)}` : ""; };

export interface SlipContext { pickupText: string; payout?: number | null }
const termsOf = (b: Booking) => (b as { dutyTerms?: { items?: Record<string, string> } }).dutyTerms?.items;

/**
 * The slip a duty is handed over with, headed with the booking's own brand. The driver and customer contact appear only when the booking
 * carries them (a staff member without contact access never gets a number in the text).
 */
export function buildDutySlip(b: Booking, ctx: SlipContext): string {
  const brand = SOURCE_NAME[getBookingSourceDisplay(b) === "unknown" ? "nesam" : (getBookingSourceDisplay(b) as BookingSourceType)];
  const pay = paymentOf(b);
  const phone = e164(phoneOf(b));
  const customer = `${customerNameOf(b) || "Customer"}${phone ? ` (${phone})` : ""}`;
  const t = termsOf(b);
  const extras = t ? `Toll: ${t.toll ?? "At actuals"} · Parking: ${t.parking ?? "At actuals"} · State tax / permit: ${t.stateTax ?? "At actuals"}` : "Toll, parking & permit: at actuals, with receipt";
  const collect = `Fare ${rupee(fareOf(b))} · Paid ${rupee(pay.totalPaid)} · Collect from customer *${rupee(pay.balanceDue)}*`;
  const lines: string[] = [];
  if (b.assignedVendorName && !b.assignedDriverId) {
    lines.push(`*${brand.toUpperCase()} — VENDOR DUTY SLIP*`, `Booking ID: *${b.bookingId || b.id}*`, `Vendor: *${b.assignedVendorName}*`);
  } else if (b.assignedVendorName) {
    lines.push(`*${brand.toUpperCase()} — VENDOR DUTY SLIP*`, `Booking ID: *${b.bookingId || b.id}*`, `Vendor: *${b.assignedVendorName}*`);
  } else {
    lines.push(`*${brand.toUpperCase()} — DRIVER DUTY SLIP*`, `Booking ID: *${b.bookingId || b.id}*`);
  }
  lines.push(`Service: ${b.service || b.serviceType || displayTripType(b.tripType || "")}`, `Pickup: *${ctx.pickupText}*`, `Route: *${b.pickup} → ${b.drop}*`, `Customer: ${customer}`);
  lines.push(`Driver: *${b.assignedDriverName || b.driver || "To be updated by vendor"}*${b.driverPhone ? ` (${e164(String(b.driverPhone)) || b.driverPhone})` : ""}`);
  lines.push(`Cab: *${b.assignedVehicleNumber || b.vehicleCategory || b.vehicle || "To be updated"}*`, collect);
  if (b.assignedVendorName && ctx.payout) lines.push(`Vendor agreed amount: *${rupee(ctx.payout)}*`);
  lines.push(extras, b.assignedVendorName ? "_Collect toll, parking & permit actuals with receipt_" : "_Collect toll, parking & permit actuals with receipt. Safe drive!_");
  return lines.join("\n");
}

export interface CloseSummary {
  quotedFare: number; fare: number; gst: number | null; taxable: number | null; totalKm: number | null; quotedKm: number | null; includedKm: number | null;
  extraKm: number; extraKmRate: number | null; extraKmAmount: number | null; tollCharges: number; tolls: { name: string; amount: number }[]; amountDue: number; fareReview: boolean;
}

/** The bill the customer is handed, written from the saved close result (the figures the server calculated and stored). */
export function buildFinalBill(b: Booking, s: CloseSummary): string {
  const sourceKey = getBookingSourceDisplay(b);
  const brand = SOURCE_NAME[sourceKey === "unknown" ? "nesam" : (sourceKey as BookingSourceType)];
  const pay = paymentOf({ ...b, fare: s.fare, tollCharges: s.tollCharges, status: "Completed" });
  const lines = [
    `*${brand.toUpperCase()} — Final Trip Bill*`, `Booking ID: ${b.bookingId || b.id}`, `Customer: ${customerNameOf(b) || "Customer"}`, `Route: ${b.pickup} → ${b.drop}`,
    `Driver: ${b.assignedDriverName || b.driver || b.assignedVendorName || "—"}`,
    `Quoted fare: ${rupee(s.quotedFare)}`,
  ];
  if (s.totalKm !== null) lines.push(`Distance: ${s.totalKm} km${s.includedKm !== null ? ` (included ${s.includedKm} km)` : ""}`);
  if (s.extraKm > 0) lines.push(`Extra km: ${s.extraKm} km${s.extraKmRate !== null ? ` × ${rupee(s.extraKmRate)}` : ""}${s.extraKmAmount !== null ? ` = ${rupee(s.extraKmAmount)}` : ""}`);
  lines.push(`Trip fare (incl. GST): *${rupee(s.fare)}*`);
  for (const t of s.tolls) lines.push(`${t.name}: ${rupee(t.amount)}`);
  lines.push(`Total payable: *${rupee(s.amountDue)}*`, `Paid: ${rupee(pay.totalPaid)} · Balance: *${rupee(pay.balanceDue)}*`, `Thank you for travelling with ${brand}!`);
  return lines.join("\n");
}

/** Idempotency key for a close attempt: the same dialog session sends the same key, so a retry can never close the trip twice. */
export const closeRequestId = (bookingId: string, nonce: string) => `close_${bookingId.slice(0, 40)}_${nonce}`.replace(/[^A-Za-z0-9_-]/g, "_");
export { addDaysISO };
