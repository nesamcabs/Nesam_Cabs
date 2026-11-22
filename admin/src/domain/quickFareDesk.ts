/**
 * Pure domain rules and types for the NESAM CABS Quick Fare & Follow-Up Desk.
 * No UI or direct database calls — pure, deterministic, and unit-tested.
 */
import type { BookingSourceType } from "./bookingSource";
import type { Enquiry, EnquiryStatus } from "../services/enquiryService";
import { formatDateTime12 } from "../utils/time";

export type DeskBrand = "nesam" | "onewaycarrentals" | "people_taxi";

export interface BrandMeta {
  id: DeskBrand;
  name: string;
  dotClass: string;
  ringClass: string;
  bannerTone: string;
}

export const DESK_BRANDS: Record<DeskBrand, BrandMeta> = {
  nesam: {
    id: "nesam",
    name: "Nesam Cabs",
    dotClass: "bg-[#991B1B]",
    ringClass: "ring-crimson-100",
    bannerTone: "text-[#991B1B]",
  },
  onewaycarrentals: {
    id: "onewaycarrentals",
    name: "One Way Car Rentals",
    dotClass: "bg-blue-600",
    ringClass: "ring-blue-100",
    bannerTone: "text-blue-700",
  },
  people_taxi: {
    id: "people_taxi",
    name: "People Taxi",
    dotClass: "bg-emerald-600",
    ringClass: "ring-emerald-100",
    bannerTone: "text-emerald-700",
  },
};

export const DESK_BRAND_LIST: DeskBrand[] = ["nesam", "onewaycarrentals", "people_taxi"];

export function normalizeBrand(raw?: string): DeskBrand {
  if (!raw) return "nesam";
  const s = raw.toLowerCase().trim();
  if (s.includes("people")) return "people_taxi";
  if (s.includes("oneway") || s.includes("one_way") || s.includes("one-way") || s.includes("one way")) return "onewaycarrentals";
  return "nesam";
}

export const TRIP_SERVICES = [
  { key: "One Way", label: "One Way", icon: "arrow-right", tripType: "One Way" },
  { key: "Round Trip", label: "Round Trip", icon: "arrow-left-right", tripType: "Round Trip" },
  { key: "Multicity", label: "Multicity", icon: "route", tripType: "Round Trip", multicity: true },
  { key: "Airport", label: "Airport", icon: "plane", tripType: "Airport Taxi" },
  { key: "Rental", label: "Rental", icon: "clock", tripType: "Local Rental" },
  { key: "Local", label: "Local", icon: "map-pin", tripType: "One Way", local: true },
] as const;

export type DeskTripServiceKey = (typeof TRIP_SERVICES)[number]["key"];

export type QueueFilter = "all" | "due" | "upcoming" | "booked" | "lost";

export const QUEUE_FILTERS: { id: QueueFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "due", label: "Due Now" },
  { id: "upcoming", label: "Upcoming" },
  { id: "booked", label: "Booked" },
  { id: "lost", label: "Lost" },
];

export const LOST_REASONS = [
  "Rate too high / Budget issue",
  "Booked another cab / Local taxi",
  "Trip cancelled / Postponed",
  "No response after 2 calls",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const REVEAL_CATEGORIES = [
  "Scheduled follow-up callback",
  "WhatsApp fare quote confirmation",
  "Pickup time / cab availability update",
] as const;
export type RevealCategory = (typeof REVEAL_CATEGORIES)[number];

export type PaymentPlan = "later" | "partial" | "full";

export function formatINR(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "₹0";
  return "₹" + Math.round(val).toLocaleString("en-IN");
}

/** Last 10 digits of an Indian phone ("+91 98421 44510" -> "9842144510") */
export function phoneDigits(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** "+91 98421 •••••" - masks the last 5 digits */
export function maskPhone(phone?: string): string {
  const digits = phoneDigits(phone);
  if (digits.length < 10) return phone || "—";
  return `+91 ${digits.slice(0, 5)} •••••`;
}

/** Computes desk filter for an enquiry */
export function deskFilterOf(e: Enquiry, nowMs = Date.now()): QueueFilter {
  if (e.status === "Converted" || !!e.convertedBookingId) return "booked";
  if (e.status === "Closed" && !!e.lostReason) return "lost";
  const dueMs = e.followUpAt?.toMillis?.() ?? (e.due?.toMillis?.() ?? null);
  if (dueMs !== null) {
    return dueMs <= nowMs ? "due" : "upcoming";
  }
  return "all";
}

/** Returns whether an enquiry is currently Due Now */
export function isFollowUpDue(e: Enquiry, nowMs = Date.now()): boolean {
  if (e.status === "Converted" || e.status === "Closed" || !!e.convertedBookingId) return false;
  const dueMs = e.followUpAt?.toMillis?.() ?? (e.due?.toMillis?.() ?? null);
  return dueMs !== null && dueMs <= nowMs;
}

/** Computes human-readable due label */
export function dueLabelOf(e: Enquiry, nowMs = Date.now()): string {
  if (e.status === "Converted" || !!e.convertedBookingId) return "Booked";
  if (e.status === "Closed" && !!e.lostReason) return `Lost • ${e.lostReason}`;
  const dueMs = e.followUpAt?.toMillis?.() ?? (e.due?.toMillis?.() ?? null);
  if (dueMs === null) return "Saved";
  if (dueMs <= nowMs) return "Due Now";
  const diffMin = Math.round((dueMs - nowMs) / 60000);
  if (diffMin <= 60) return `In ${diffMin} min${diffMin === 1 ? "" : "s"}`;
  // India time for both the date and the clock (the office works in IST whatever the browser's zone).
  return formatDateTime12(new Date(dueMs));
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Frontend desk records (this phase keeps them in the browser session; see services/quickFareDeskBackend.ts) ──

/**
 * Indian mobile → "+91XXXXXXXXXX". Accepts 10 digits, +91 / 91 / 0091 prefixes and one leading zero, with spaces,
 * dashes, dots or brackets. Anything else is rejected — digits are never dropped to make a number fit.
 */
export function normalizeIndianMobile(raw: string): { ok: true; e164: string; digits: string } | { ok: false; reason: string } {
  const compact = (raw || "").trim().replace(/[\s().-]/g, "");
  if (!compact) return { ok: false, reason: "Enter the caller's mobile number." };
  if (!/^\+?\d+$/.test(compact)) return { ok: false, reason: "Use digits only (with an optional +91)." };
  const m = /^(?:\+91|0091|91|0)?([6-9]\d{9})$/.exec(compact);
  if (!m || (compact.startsWith("+") && !compact.startsWith("+91"))) {
    return { ok: false, reason: "Enter a valid Indian mobile: 10 digits starting 6–9, optionally with +91, 0091 or 0." };
  }
  return { ok: true, e164: `+91${m[1]}`, digits: m[1] };
}

export type DeskPayChoice = "later" | "part" | "full";

/** One priced (or manually drafted) vehicle line, exactly as it was shown to the caller. */
export interface DeskQuoteLine {
  categoryId: string;
  vehicle: string;
  classBadge: string;
  seats: string;
  fare: number;
  /** "₹15/km + ₹500 Bata" from the pricing server's rate card; empty when not provided. */
  rateLine: string;
  includedKm: number | null;
  /** True when staff typed the fare (pricing data unavailable): a draft quote, not a server price. */
  manual: boolean;
}

/** The trip the quote was made for — only the fields that apply to its trip type. */
export interface DeskTripSnapshot {
  source: DeskBrand;
  tripLabel: string;
  route: string;
  pickup: string;
  drop: string;
  stops: string[];
  /** Coordinates (rounded) of each chosen place, in order — part of the duplicate check. */
  placeKey: string;
  /** Pickup instant (ms) and its India-time label. */
  pickupAtMs: number;
  pickupLabel: string;
  days: number | null;
  rentalHours: number | null;
  roadKm: number | null;
  /** "cng" when the fare is on the CNG rate card; null for the standard Diesel / Petrol rate (absent on older records). */
  fuel?: "cng" | null;
  /** Paid add-ons included in the fare (absent on older records). */
  addOns?: { pets: boolean; carrier: boolean };
}

// ── Fuel and add-ons (the server prices both: CNG rate cards, pet and roof-carrier charges) ──

/** Desk names for the trip add-ons: pets → "Pet Friendly", roof carrier → "Luggage Carrier". */
export const DESK_ADDON_LABELS = { pets: "Pet Friendly", carrier: "Luggage Carrier" } as const;

/** "CNG" or "Diesel" (the standard Diesel / Petrol rate). */
export const deskFuelLabel = (fuel?: "cng" | null): "CNG" | "Diesel" => (fuel === "cng" ? "CNG" : "Diesel");

/** Labels of the add-ons a fare includes, in toolbar order. */
export function deskAddOnLabels(a?: { pets: boolean; carrier: boolean } | null): string[] {
  if (!a) return [];
  return [a.pets ? DESK_ADDON_LABELS.pets : "", a.carrier ? DESK_ADDON_LABELS.carrier : ""].filter(Boolean);
}

/** Fuel first, then add-ons: "CNG • Pet Friendly". */
export const deskExtrasLabel = (t: Pick<DeskTripSnapshot, "fuel" | "addOns">) => [deskFuelLabel(t.fuel), ...deskAddOnLabels(t.addOns)].join(" • ");

/**
 * Price tag of an add-on across the priced vehicles: "+₹300" when they all charge the same,
 * "from +₹250" when it differs by vehicle, "" when no quote carries it.
 */
export function addOnRateLabel(amounts: ReadonlyArray<number | null | undefined>): string {
  const vals = amounts.filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);
  if (!vals.length) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? `+${formatINR(min)}` : `from +${formatINR(min)}`;
}

export interface DeskFollowUp {
  id: string;
  key: string;
  state: "open" | "draft" | "lost";
  customerId: string | null;
  mobile: string; // +91XXXXXXXXXX
  name: string;
  trip: DeskTripSnapshot;
  quote: DeskQuoteLine;
  reminderAtMs: number;
  note: string;
  lostReason?: string;
  draftRef?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface DeskBookingDraft {
  ref: string;
  key: string;
  trip: DeskTripSnapshot;
  quote: DeskQuoteLine;
  customerId: string | null;
  mobile: string;
  name: string;
  payment: DeskPayChoice;
  /** Percent paid now for "part", from Payment options when that setting could be read. */
  partPercent: number | null;
  amountNow: number | null;
  followUpId: string | null;
  createdAtMs: number;
}

export interface DeskRevealEntry {
  id: string;
  atMs: number;
  staff: string;
  caller: string;
  reason: string;
}

/** Same customer + source + itinerary + pickup time + vehicle = the same enquiry. */
export function deskEnquiryKey(p: { customerId: string | null; mobile: string; trip: DeskTripSnapshot; categoryId: string }): string {
  const who = p.customerId ? `c:${p.customerId}` : `m:${p.mobile}`;
  const t = p.trip;
  return [who, t.source, t.tripLabel, t.placeKey, t.pickupAtMs, t.days ?? "", t.rentalHours ?? "", p.categoryId].join("|");
}

/** Queue filter of a desk follow-up at `nowMs`. */
export function deskFollowUpStatus(f: DeskFollowUp, nowMs: number): Exclude<QueueFilter, "all"> {
  if (f.state === "draft") return "booked";
  if (f.state === "lost") return "lost";
  return f.reminderAtMs <= nowMs ? "due" : "upcoming";
}

const STATUS_RANK: Record<Exclude<QueueFilter, "all">, number> = { due: 0, upcoming: 1, booked: 2, lost: 3 };

/** Due first (oldest reminder first), then upcoming (soonest first), then drafts and lost (newest first). */
export function sortDeskFollowUps(rows: DeskFollowUp[], nowMs: number): DeskFollowUp[] {
  return [...rows].sort((a, b) => {
    const sa = deskFollowUpStatus(a, nowMs), sb = deskFollowUpStatus(b, nowMs);
    if (sa !== sb) return STATUS_RANK[sa] - STATUS_RANK[sb];
    return sa === "due" || sa === "upcoming" ? a.reminderAtMs - b.reminderAtMs : b.updatedAtMs - a.updatedAtMs;
  });
}

/** "In 12 mins" / "Due now" / "23 Nov 2026, 05:00 PM IST". */
export function deskReminderLabel(f: DeskFollowUp, nowMs: number): string {
  const s = deskFollowUpStatus(f, nowMs);
  if (s === "booked") return "Booking draft";
  if (s === "lost") return `Lost • ${f.lostReason ?? "Closed"}`;
  if (s === "due") return "Due now";
  const mins = Math.max(1, Math.round((f.reminderAtMs - nowMs) / 60000));
  return mins <= 60 ? `In ${mins} min${mins === 1 ? "" : "s"}` : `${formatDateTime12(new Date(f.reminderAtMs))} IST`;
}

/** A reference that cannot be mistaken for a production booking ID. */
export function newLocalDraftRef(nowMs = Date.now()): string {
  const ist = new Date(nowMs + 330 * 60000).toISOString();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `LOCAL-DRAFT-${ist.slice(2, 4)}${ist.slice(5, 7)}${ist.slice(8, 10)}-${rand}`;
}

/** Text of the quote exactly as displayed. It is copied for staff to paste; nothing is sent. */
export function formatDeskQuoteText(p: {
  brandName: string;
  route: string;
  when: string;
  roadKm: number | null;
  lines: DeskQuoteLine[];
  /** Adds "Fuel Type:" (CNG or Diesel) when given. */
  fuel?: "cng" | null;
  /** Add-ons the fares include ("Pet Friendly", "Luggage Carrier"). */
  addOns?: readonly string[];
}): string {
  const draft = p.lines.some((l) => l.manual);
  const body = p.lines.map((l) => {
    const extra = [l.seats, l.rateLine, l.includedKm ? `${l.includedKm} km included` : ""].filter(Boolean).join(", ");
    return `• ${l.vehicle}: ${formatINR(l.fare)}${extra ? ` (${extra})` : ""}`;
  });
  return [
    `*${p.brandName} — ${draft ? "Draft fare quote" : "Fare quote"}*`,
    `Route: ${p.route}`,
    `Pickup: ${p.when}`,
    ...(p.roadKm ? [`Distance: ${p.roadKm} km by road`] : []),
    ...(p.fuel !== undefined ? [`Fuel Type: ${deskFuelLabel(p.fuel)}`] : []),
    ...(p.addOns?.length ? [`Add-ons: ${p.addOns.join(", ")} (included in the fares)`] : []),
    "",
    ...body,
    ...(draft ? ["", "_Draft quote — not yet confirmed._"] : []),
  ].join("\n");
}
