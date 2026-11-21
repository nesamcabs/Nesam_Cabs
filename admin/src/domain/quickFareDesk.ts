/**
 * Pure domain rules and types for the NESAM CABS Quick Fare & Follow-Up Desk.
 * No UI or direct database calls — pure, deterministic, and unit-tested.
 */
import type { BookingSourceType } from "./bookingSource";
import type { Enquiry, EnquiryStatus } from "../services/enquiryService";

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
  const dt = new Date(dueMs);
  const istDate = new Date(dt.getTime() + 330 * 60000).toISOString();
  const d = `${istDate.slice(8, 10)}-${istDate.slice(5, 7)}-${istDate.slice(0, 4)}`;
  const hours = dt.getHours();
  const mins = String(dt.getMinutes()).padStart(2, "0");
  const mer = hours >= 12 ? "PM" : "AM";
  const h12 = hours % 12 || 12;
  return `${d} • ${h12}:${mins} ${mer}`;
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** WhatsApp fare quote format matching reference */
export function formatWhatsAppQuote(params: {
  brandName: string;
  route: string;
  dateStr: string;
  timeStr: string;
  vehicleLines: { name: string; seats?: number | string; fare: number }[];
}): string {
  const lines = params.vehicleLines.map((v) => {
    const seatText = v.seats ? ` (${typeof v.seats === "number" ? `${v.seats} Seats` : v.seats})` : "";
    return `• ${v.name}${seatText}: ${formatINR(v.fare)}`;
  });
  return `*${params.brandName} — Fare Estimate*
Route: ${params.route}
Date: ${params.dateStr} at ${params.timeStr}

${lines.join("\n")}

_(Includes Driver Bata. Toll, Parking & Permit extra as actuals)_
Reply to confirm your cab!`;
}

/** WhatsApp booking confirmation format matching reference */
export function formatWhatsAppBooking(params: {
  brandName: string;
  bookingId: string;
  customerName: string;
  phone: string;
  route: string;
  dateStr: string;
  timeStr: string;
  vehicleName: string;
  fare: number;
}): string {
  return `*${params.brandName} — Booking Confirmed*
Booking ID: ${params.bookingId}
Customer: ${params.customerName} (+91 ${params.phone})
Route: ${params.route}
Pickup: ${params.dateStr} at ${params.timeStr}
Cab: ${params.vehicleName}
Fare: ${formatINR(params.fare)} (+ Toll/Parking/Permit actuals)
Thank you!`;
}
