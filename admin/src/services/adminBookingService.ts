/**
 * Admin (phone / walk-in) bookings. The booking server prices every booking
 * with the same engine as customer bookings: this module asks it for a quote
 * (re-asked automatically whenever a price input changes) and books against that
 * quote. The base fare is never typed in. A different amount can only be charged
 * as an explicit override with a reason, which the server stores and audits.
 */
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS, describeDataError } from "./adminFirestoreService";
import { ActionError, callFunction } from "./callables";
import type { Booking, MasterLocation, VehicleCategory } from "../types";
import { toEngineCategory, type BookingFareBreakdown } from "./bookingFareEngine";
import type { PickedPoint } from "../components/MapLocationPicker";

export { ActionError as AdminBookingError, newId as newRequestIdWithPrefix } from "./callables";
export type { PickedPoint };

export interface ManualBookingForm {
  customerId: string;
  customerName: string;
  customerPhone: string;
  whatsappSame: boolean;
  whatsappCountryCode: string;
  whatsappNumber: string;
  /** Optional. */
  email: string;
  serviceId: string;
  pickup: PickedPoint | null;
  drop: PickedPoint | null;
  /** Door number / landmark added to the pickup address. */
  pickupAddress: string;
  dropAddress: string;
  categoryId: string;
  tripType: "One Way" | "Round Trip" | "Local Rental" | "Airport Taxi";
  /** Required: NESAM takes advance bookings only. A local "YYYY-MM-DDTHH:mm" value. */
  pickupAt: string;
  /** Round trips: when the trip ends. Billing counts Indian calendar dates from pickup to here. */
  tripEndAt: string;
  paymentMethod: string;
  advanceEnabled: boolean;
  advanceAmount: string;
  advanceMethod: string;
  advanceReference: string;
  discountType: "none" | "percentage" | "fixed";
  discountValue: string;
  discountReason: string;
  notes: string;
  /** Coupon code; the server validates and prices it (never a discount computed here). */
  couponCode?: string;
  overrideEnabled: boolean;
  overrideFare: string;
  overrideReason: string;
  channel: "nesam" | "onewaycarrentals" | "people_taxi";
}
export type ManualBookingField = keyof ManualBookingForm;

export const emptyManualBooking = (): ManualBookingForm => ({
  customerId: "",
  customerName: "",
  customerPhone: "",
  whatsappSame: true,
  whatsappCountryCode: "+91",
  whatsappNumber: "",
  email: "",
  serviceId: "",
  pickup: null,
  drop: null,
  pickupAddress: "",
  dropAddress: "",
  categoryId: "",
  tripType: "One Way",
  pickupAt: "",
  tripEndAt: "",
  paymentMethod: "Cash",
  advanceEnabled: false,
  advanceAmount: "",
  advanceMethod: "UPI",
  advanceReference: "",
  discountType: "none",
  discountValue: "",
  discountReason: "",
  notes: "",
  overrideEnabled: false,
  overrideFare: "",
  overrideReason: "",
  channel: "nesam",
});

export const PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer"] as const;
export const COUNTRY_CODES = ["+91", "+971", "+966", "+974", "+965", "+968", "+973", "+94", "+977", "+880", "+65", "+60", "+44", "+1", "+61"];

export const inIndia = (l: MasterLocation) =>
  typeof l.lat === "number" && typeof l.lng === "number" && l.lat >= 6.5 && l.lat <= 35.7 && l.lng >= 68.1 && l.lng <= 97.4;

/** Locations the admin can start a pin from (active, enabled for admin bookings, with coordinates). */
export function bookableLocations(locations: MasterLocation[], role: "pickup" | "drop") {
  return locations.filter(
    (l) => l.status === "Active" && l.adminBookingEnabled !== false && (role === "pickup" ? l.pickupEnabled !== false : l.dropEnabled !== false) && inIndia(l),
  );
}

export function pointFromLocation(l: MasterLocation): PickedPoint {
  return { lat: l.lat as number, lng: l.lng as number, name: l.name, address: [l.name, l.address || l.city].filter(Boolean).join(", "), type: l.type === "Airport" ? "airport" : "other", confirmed: true };
}

/** Categories the server can price (active with a per-km rate) — same test as the server. */
export const bookableCategories = (categories: VehicleCategory[]) => categories.filter((c) => c.status === "Active" && toEngineCategory(c));

export const normalizePhone = (v: string) => {
  const digits = v.replace(/[\s()-]/g, "").replace(/^\+?91(?=\d{10}$)/, "");
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : "";
};

/** Optional email: a format check only when something is entered. */
export const emailError = (v: string): string | null => {
  const e = v.trim();
  if (!e) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? null : "Enter a valid email address or leave it blank.";
};

export function whatsappError(f: Pick<ManualBookingForm, "whatsappSame" | "whatsappCountryCode" | "whatsappNumber">): string | null {
  if (f.whatsappSame) return null;
  const cc = f.whatsappCountryCode.trim();
  const n = f.whatsappNumber.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{0,2}$/.test(cc)) return "Enter the country code, for example +91.";
  if (!/^\d+$/.test(n)) return "The WhatsApp number can contain digits only.";
  if (cc === "+91") return /^[6-9]\d{9}$/.test(n) ? null : "Enter a valid 10-digit WhatsApp number.";
  return n.length >= 6 && n.length <= 14 && cc.length - 1 + n.length <= 15 ? null : "Enter a valid WhatsApp number for that country code.";
}

const round5 = (n: number) => n.toFixed(5);

/** Everything that decides the price. A quote is valid only while these are unchanged. */
export const quoteKey = (f: ManualBookingForm) =>
  JSON.stringify([
    f.serviceId, f.pickup && [round5(f.pickup.lat), round5(f.pickup.lng)], f.drop && [round5(f.drop.lat), round5(f.drop.lng)],
    f.categoryId, f.tripType, f.pickupAt, f.tripType === "Round Trip" ? f.tripEndAt : "", f.discountType, f.discountType === "none" ? "" : f.discountValue.trim(),
    (f.couponCode ?? "").trim(), f.channel || "nesam",
  ]);

/** The discount as a number, or an error message. null value = no discount. */
export function discountOf(f: Pick<ManualBookingForm, "discountType" | "discountValue">): { value: { type: "percentage" | "fixed"; value: number } | null; error: string | null } {
  if (f.discountType === "none") return { value: null, error: null };
  const raw = f.discountValue.trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return { value: null, error: "Enter a discount greater than zero." };
  if (f.discountType === "percentage" && n > 100) return { value: null, error: "A percentage discount cannot exceed 100%." };
  if (f.discountType === "fixed" && !/^\d+$/.test(raw)) return { value: null, error: "Enter the fixed discount in whole rupees." };
  return { value: { type: f.discountType, value: n }, error: null };
}

/** Is there enough to ask the server for a price? */
export function readyToQuote(f: ManualBookingForm): boolean {
  return !!(f.pickup?.confirmed && f.drop?.confirmed && f.categoryId && !discountOf(f).error && !pickupTimeError(f.pickupAt) && (f.tripType !== "Round Trip" || !!f.tripEndAt));
}

/** Mirrors the server's default window (settings/operations can change it; the server is authoritative). */
export const ADMIN_MIN_LEAD_MINUTES = 30;

export function pickupTimeError(pickupAt: string, now = Date.now()): string | null {
  if (!pickupAt) return "Choose the pickup date and time. NESAM takes advance bookings only.";
  const t = new Date(pickupAt).getTime();
  if (!Number.isFinite(t)) return "Enter a valid pickup date and time.";
  if (t < now + ADMIN_MIN_LEAD_MINUTES * 60000) return `Pickup must be at least ${ADMIN_MIN_LEAD_MINUTES} minutes from now.`;
  if (t > now + 180 * 86400000) return "Pickups can be booked up to 180 days ahead.";
  return null;
}

export function validateManualBooking(f: ManualBookingForm, now = Date.now()): Partial<Record<ManualBookingField, string>> {
  const e: Partial<Record<ManualBookingField, string>> = {};
  if (f.customerName.trim().length < 2) e.customerName = "Enter the customer name.";
  if (!normalizePhone(f.customerPhone)) e.customerPhone = "Enter a valid 10-digit Indian mobile number.";
  const wa = whatsappError(f);
  if (wa) e.whatsappNumber = wa;
  const em = emailError(f.email);
  if (em) e.email = em;
  if (!f.pickup) e.pickup = "Choose the pickup point on the map.";
  else if (!f.pickup.confirmed) e.pickup = "Confirm the pickup location (press “Confirm location”).";
  if (!f.drop) e.drop = "Choose the drop point on the map.";
  else if (!f.drop.confirmed) e.drop = "Confirm the drop location (press “Confirm location”).";
  else if (f.pickup && Math.abs(f.pickup.lat - f.drop.lat) < 0.0009 && Math.abs(f.pickup.lng - f.drop.lng) < 0.0009) e.drop = "Pickup and drop must be different places.";
  if (!f.categoryId) e.categoryId = "Choose a vehicle category.";
  const t = pickupTimeError(f.pickupAt, now);
  if (t) e.pickupAt = t;
  if (f.tripType === "Round Trip") {
    if (!f.tripEndAt) e.tripEndAt = "Choose when the round trip ends. It decides the chargeable days.";
    else if (f.pickupAt && new Date(f.tripEndAt).getTime() < new Date(f.pickupAt).getTime()) e.tripEndAt = "The trip cannot end before it starts.";
  }
  const d = discountOf(f);
  if (d.error) e.discountValue = d.error;
  if (f.discountType !== "none" && f.discountReason.trim().length > 0 && f.discountReason.trim().length < 3) e.discountReason = "Give a short reason or leave it blank.";
  if (f.advanceEnabled) {
    const a = Number(f.advanceAmount);
    if (!f.advanceAmount.trim() || !Number.isFinite(a) || a <= 0) e.advanceAmount = "Enter the advance amount received.";
    else if (Math.abs(a * 100 - Math.round(a * 100)) > 1e-6) e.advanceAmount = "Use at most two decimal places.";
    if (f.advanceMethod !== "Cash" && f.advanceReference.trim().length < 4) e.advanceReference = `Enter the ${f.advanceMethod === "UPI" ? "UPI transaction" : "transfer"} reference.`;
  }
  return e;
}

export function validateOverride(f: ManualBookingForm, calculatedTotal: number | null): Partial<Record<ManualBookingField, string>> {
  const e: Partial<Record<ManualBookingField, string>> = {};
  if (!f.overrideEnabled) return e;
  const fare = Number(f.overrideFare);
  if (!/^\d+$/.test(f.overrideFare.trim()) || !(fare >= 1) || fare > 1000000) e.overrideFare = "Enter the fare in whole rupees.";
  else if (calculatedTotal !== null && fare === calculatedTotal) e.overrideFare = "This is the calculated fare — turn the override off instead.";
  if (f.overrideReason.trim().length < 10) e.overrideReason = "Give a reason of at least 10 characters.";
  return e;
}

const pointPayload = (p: PickedPoint) => ({ lat: p.lat, lng: p.lng, address: p.address.trim(), name: p.name, type: p.type });

const bookingRequest = (f: ManualBookingForm, requestId: string) => ({
  requestId,
  customerId: f.customerId,
  customerName: f.customerName.trim(),
  customerPhone: normalizePhone(f.customerPhone),
  customerWhatsapp: f.whatsappSame ? { sameAsMobile: true } : { sameAsMobile: false, countryCode: f.whatsappCountryCode.trim(), number: f.whatsappNumber.replace(/[\s()-]/g, "") },
  customerEmail: f.email.trim(),
  serviceId: f.serviceId,
  pickupPoint: f.pickup ? pointPayload(f.pickup) : null,
  dropPoint: f.drop ? pointPayload(f.drop) : null,
  pickupAddress: f.pickupAddress.trim(),
  dropAddress: f.dropAddress.trim(),
  categoryId: f.categoryId,
  tripType: f.tripType,
  scheduledAt: f.pickupAt && Number.isFinite(new Date(f.pickupAt).getTime()) ? new Date(f.pickupAt).toISOString() : null,
  tripEndAt: f.tripType === "Round Trip" && f.tripEndAt && Number.isFinite(new Date(f.tripEndAt).getTime()) ? new Date(f.tripEndAt).toISOString() : null,
  paymentMethod: f.paymentMethod,
  bookingSource: f.channel || "nesam",
  source: f.channel && f.channel !== "nesam" ? f.channel : "admin",
  brand: f.channel || "nesam",
  notes: f.notes.trim(),
  discount: (() => {
    const d = discountOf(f).value;
    return d ? { ...d, reason: f.discountReason.trim() } : null;
  })(),
  couponCode: (f.couponCode ?? "").trim(),
});

export interface FareQuote {
  quote: BookingFareBreakdown & {
    subtotalBeforeAdjustment?: number;
    globalAdjustment?: { id: string; name: string; direction: string; percent: number; amount: number } | null;
    discountDetail?: { type: string; value: number; amount: number; source: string; reason: string } | null;
  };
  breakup: NonNullable<Booking["fareBreakup"]>;
  service: string;
  categoryName: string;
  adjustmentApplied?: { name: string; direction: string; percent: number; amount: number } | null;
  /** Present when the quote was priced with a coupon the server accepted. */
  couponCode?: string;
  couponDiscount?: number;
}
/** @deprecated use FareQuote */
export type AdminQuote = FareQuote;

export const quoteAdminBooking = (f: ManualBookingForm, requestId: string, extras: { businessAccountId?: string; businessBilledTo?: string } = {}) =>
  callFunction<unknown, FareQuote>("createAdminBooking", { ...bookingRequest(f, requestId), ...extras, quoteOnly: true });

export interface CreatedAdminBooking {
  id: string;
  bookingId: string;
  fare: number;
  otp?: string;
}

/** Optional Master Admin booking details stored with the booking (see officeBookingExtras on the server). */
export interface OfficeBookingExtras {
  passenger?: { name: string; phone: string; whatsapp?: string } | null;
  enquirySource?: "Phone" | "WhatsApp" | "Office" | "App";
  businessAccountId?: string;
  businessBilledTo?: "Company pays" | "Passenger pays";
  tripExtras?: { hillTravel: boolean; roofCarrier: boolean; waitingMinutes: number };
  enquiryId?: string;
  termsAccepted?: boolean;
}

export function createAdminBooking(f: ManualBookingForm, requestId: string, expectedFare: number, extras: OfficeBookingExtras = {}): Promise<CreatedAdminBooking> {
  const override = f.overrideEnabled ? { fare: Number(f.overrideFare), reason: f.overrideReason.trim() } : null;
  const advance = f.advanceEnabled
    ? { amount: Number(f.advanceAmount), method: f.advanceMethod, reference: f.advanceReference.trim() }
    : null;
  return callFunction<unknown, CreatedAdminBooking>("createAdminBooking", { ...bookingRequest(f, requestId), expectedFare, override, advance, ...extras });
}

/** Why a booking's fare cannot be changed now ("" when it can). Mirrors the server checks. */
export function fareOverrideBlocker(b: Booking): string {
  if (b.status === "Cancelled" || b.status === "Rejected") return "Cancelled or rejected bookings cannot be repriced.";
  if (b.payment === "Paid" || b.paymentStatus === "Paid") return "This booking is already paid.";
  if (b.invoiceId) return `Invoice ${b.invoiceNumber || b.invoiceId} exists — void it before changing the fare.`;
  return "";
}

export async function overrideBookingFare(bookingId: string, fare: number, reason: string): Promise<number> {
  const res = await callFunction<unknown, { fare: number }>("overrideBookingFare", { bookingId, fare, reason: reason.trim() });
  return res.fare;
}

/** Contact corrections only; the price, payment and trip status have their own flows. */
export async function updateBookingContact(
  bookingId: string,
  c: { customer: string; phone: string; notes: string; email?: string; whatsapp?: { countryCode: string; number: string; e164: string; sameAsMobile: boolean } },
) {
  // The raw number is held in booking_contacts, written only by the server; partners never read it.
  await callFunction("updateBookingContact", { bookingId, customer: c.customer, phone: c.phone, notes: c.notes, email: c.email ?? "" });
}

export const newRequestId = () => `adm_${crypto.randomUUID().replace(/-/g, "")}`;
