/**
 * Communication › Offers & Coupons. Coupons stay in the existing `coupons` collection (the
 * customer quote and booking server validate them); the Master Admin form adds the customer
 * audience, booking / pickup windows, location scope and fare-kind exclusions, which the server
 * applies to every coupon that carries an `audience` (functions/src/domain/pricing.ts).
 */
import { addDoc, arrayUnion, collection, doc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import type { MasterCoupon } from "../types";
import { getEffectiveCouponStatus, normalizeCouponCode } from "./couponEngine";

export const COUPON_SERVICES = ["One Way", "Round Trip", "Airport", "Multicity", "Local Rental", "Local Pickup & Drop"] as const;
export const AUDIENCES = ["All", "New", "Returning", "Regular"] as const;
export type Audience = (typeof AUDIENCES)[number];
export type CouponScope = "Any" | "Pickup city" | "Exact route";
export type CouponState = "Active" | "Scheduled" | "Ended" | "Disabled";

/** Fields the Master Admin form adds to a coupon document. */
export interface MasterCouponExtras {
  audience?: Audience;
  couponServices?: string[];
  couponCategories?: string[];
  scope?: CouponScope;
  city?: string;
  dropCity?: string;
  allowFixed?: boolean;
  allowBusiness?: boolean;
  allowPeak?: boolean;
  bookFrom?: string;
  bookUntil?: string;
  pickupFrom?: string;
  pickupUntil?: string;
  reason?: string;
  sample?: boolean;
  version?: number;
  history?: { action: string; reason: string; byName: string; at: Timestamp }[];
}
export type Coupon = MasterCoupon & MasterCouponExtras;

export interface CouponDraft {
  description: string;
  termsAndConditions: string;
  adminBookingOnly: boolean;
  code: string;
  name: string;
  type: "Amount" | "Percent";
  value: number;
  max: number;
  minFare: number;
  audience: Audience;
  services: string[];
  categories: string[];
  scope: CouponScope;
  city: string;
  dropCity: string;
  allowFixed: boolean;
  allowBusiness: boolean;
  allowPeak: boolean;
  /** Local India date-time "YYYY-MM-DDTHH:mm". */
  bookFrom: string;
  bookUntil: string;
  pickupFrom: string;
  pickupUntil: string;
  perCustomer: number;
  totalLimit: number;
  active: boolean;
  reason: string;
}

const DAY = 86_400_000;
/** "YYYY-MM-DDTHH:mm" in India time for an instant. */
export const istInput = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 16);
/** Instant of a local India "YYYY-MM-DDTHH:mm" (or an ISO string with an offset). */
export const istAt = (v?: string) => {
  if (!v) return NaN;
  return /[zZ]|[+-]\d\d:\d\d$/.test(v) ? Date.parse(v) : Date.parse(`${v.length === 16 ? `${v}:00` : v}+05:30`);
};
const toIso = (v: string) => `${v.length === 16 ? `${v}:00` : v}+05:30`;
const fromIso = (v?: string) => (v ? istInput(istAt(v)) : "");

export function emptyCouponDraft(categories: string[]): CouponDraft {
  const now = Date.now();
  return {
    code: "", name: "", description: "", termsAndConditions: "", adminBookingOnly: false, type: "Amount", value: 100, max: 100, minFare: 2000, audience: "All",
    services: [...COUPON_SERVICES], categories: [...categories], scope: "Any", city: "", dropCity: "",
    bookFrom: istInput(now), bookUntil: istInput(now + 30 * DAY), pickupFrom: istInput(now), pickupUntil: istInput(now + 60 * DAY),
    perCustomer: 1, totalLimit: 100, allowFixed: false, allowBusiness: false, allowPeak: false, active: true, reason: "",
  };
}

export function draftOf(c: Coupon, categories: string[]): CouponDraft {
  const all = emptyCouponDraft(categories);
  const day = (d: string, end = false) => (d ? `${d}T${end ? "23:59" : "00:00"}` : "");
  return {
    ...all,
    description: c.description ?? "", termsAndConditions: c.termsAndConditions ?? "", adminBookingOnly: !!c.adminBookingOnly,
    code: c.code, name: c.name, type: c.discountType === "PERCENTAGE" ? "Percent" : "Amount", value: c.discountValue,
    max: c.maximumDiscount || 0, minFare: c.minimumBookingAmount || 0,
    audience: c.audience ?? (c.firstBookingOnly ? "New" : "All"),
    services: c.couponServices ?? (c.serviceNames?.length ? c.serviceNames : [...COUPON_SERVICES]),
    categories: c.couponCategories ?? (c.vehicleCategoryIds?.length ? c.vehicleCategoryIds : [...categories]),
    scope: c.scope ?? "Any", city: c.city ?? "", dropCity: c.dropCity ?? "",
    allowFixed: !!c.allowFixed, allowBusiness: !!c.allowBusiness, allowPeak: !!c.allowPeak,
    bookFrom: fromIso(c.bookFrom) || day(c.validFrom) || all.bookFrom, bookUntil: fromIso(c.bookUntil) || day(c.validUntil, true) || all.bookUntil,
    pickupFrom: fromIso(c.pickupFrom) || day(c.validFrom) || all.pickupFrom, pickupUntil: fromIso(c.pickupUntil) || all.pickupUntil,
    perCustomer: c.perCustomerLimit || 1, totalLimit: c.totalUsageLimit || 100,
    active: c.status === "Active" || c.status === "Scheduled", reason: "",
  };
}

/** Same states as the reference list: Disabled · Ended · Scheduled · Active. */
export function couponState(c: Coupon, now = Date.now()): CouponState {
  if (c.audience) {
    if (!(c.status === "Active" || c.status === "Scheduled")) return "Disabled";
    if (istAt(c.bookUntil) <= now || istAt(c.pickupUntil) <= now) return "Ended";
    if (istAt(c.bookFrom) > now) return "Scheduled";
    return "Active";
  }
  const s = getEffectiveCouponStatus(c);
  return s === "Active" ? "Active" : s === "Scheduled" ? "Scheduled" : s === "Expired" ? "Ended" : "Disabled";
}

export const isEnabled = (c: Coupon) => c.status === "Active" || c.status === "Scheduled";

export function generateCode(existing: Coupon[]): string {
  for (let i = 0; i < 20; i++) {
    const v = new Uint32Array(2);
    crypto.getRandomValues(v);
    const code = `NESAM-${Array.from(v, (n) => n.toString(36).toUpperCase()).join("").slice(0, 6)}`;
    if (!existing.some((c) => normalizeCouponCode(c.code) === code)) return code;
  }
  throw new Error("Try generating a code again.");
}

/** Validation messages from the reference coupon form. */
export function validateDraft(d: CouponDraft, existing: Coupon[], editing: Coupon | null, cities: string[], categoryCount = 1): string | null {
  const code = d.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{2,23}$/.test(code)) return "Use a 3–24 character coupon code: letters, numbers, underscore or hyphen.";
  if (existing.some((c) => c.id !== editing?.id && normalizeCouponCode(c.code) === code)) return "This coupon code already exists.";
  if (d.name.trim().length < 3 || d.reason.trim().length < 5) return "Enter a name and change reason.";
  if (!(Number.isFinite(d.value) && d.value > 0 && d.value <= (d.type === "Percent" ? 100 : 1000000))) return "Enter a valid discount.";
  if (d.type === "Amount" && !Number.isInteger(d.value)) return "Amount coupons use whole rupees.";
  if (d.type === "Percent" && !(Number.isInteger(d.max) && d.max > 0 && d.max <= 1000000)) return "A percentage coupon needs a maximum discount.";
  if (!(Number.isFinite(d.minFare) && d.minFare >= 0 && d.minFare <= 1000000)) return "Enter a valid minimum eligible base fare.";
  if (!d.services.length || (categoryCount > 0 && !d.categories.length)) return "Choose at least one service and vehicle category.";
  if (d.scope !== "Any" && !cities.includes(d.city)) return "Choose a verified pickup city.";
  if (d.scope === "Exact route" && (!cities.includes(d.dropCity) || d.city === d.dropCity)) return "Choose a different verified drop city.";
  for (const [a, b] of [[d.bookFrom, d.bookUntil], [d.pickupFrom, d.pickupUntil]] as const) {
    if (!Number.isFinite(istAt(a)) || !(istAt(b) > istAt(a))) return "Each end date/time must be after its start.";
  }
  if (!(Number.isInteger(d.perCustomer) && d.perCustomer >= 1 && d.perCustomer <= 100 && Number.isInteger(d.totalLimit) && d.totalLimit >= 1 && d.totalLimit <= 1000000)) return "Set valid per-customer and overall usage limits.";
  const used = editing?.usedCount ?? 0;
  if (d.totalLimit < used) return "Overall limit cannot be below confirmed uses.";
  if (used && editing && code !== normalizeCouponCode(editing.code)) return "A used code keeps its original name. Create a new coupon for a different code.";
  return null;
}

const who = () => auth.currentUser?.displayName || auth.currentUser?.email?.split("@")[0] || "Staff";

export async function saveCoupon(d: CouponDraft, editing: Coupon | null, allCategories: { id: string; name: string }[]) {
  const allServices = d.services.length === COUPON_SERVICES.length;
  const allCats = allCategories.every((c) => d.categories.includes(c.id));
  const doc_ = {
    code: d.code.trim().toUpperCase(), name: d.name.trim(), description: d.description.trim(), termsAndConditions: d.termsAndConditions.trim(),
    discountType: d.type === "Percent" ? "PERCENTAGE" : "FIXED_AMOUNT", discountValue: d.value,
    maximumDiscount: d.type === "Percent" ? d.max : 0, minimumBookingAmount: d.minFare,
    validFrom: d.bookFrom.slice(0, 10), validUntil: istInput(istAt(d.bookUntil) - 60000).slice(0, 10),
    totalUsageLimit: d.totalLimit, perCustomerLimit: d.perCustomer, firstBookingOnly: d.audience === "New",
    serviceNames: allServices ? [] : d.services,
    vehicleCategoryIds: allCats ? [] : d.categories,
    vehicleCategoryNames: allCats ? [] : allCategories.filter((c) => d.categories.includes(c.id)).map((c) => c.name),
    adminBookingOnly: d.adminBookingOnly, status: d.active ? "Active" : "Inactive",
    audience: d.audience, couponServices: d.services, couponCategories: d.categories,
    scope: d.scope, city: d.scope === "Any" ? "" : d.city, dropCity: d.scope === "Exact route" ? d.dropCity : "",
    allowFixed: d.allowFixed, allowBusiness: d.allowBusiness, allowPeak: d.allowPeak,
    bookFrom: toIso(d.bookFrom), bookUntil: toIso(d.bookUntil), pickupFrom: toIso(d.pickupFrom), pickupUntil: toIso(d.pickupUntil),
    reason: d.reason.trim(), updatedAt: serverTimestamp(),
  };
  const entry = { action: editing ? "Coupon edited" : "Coupon created", reason: d.reason.trim(), byName: who(), at: Timestamp.now() };
  if (editing) {
    await updateDoc(doc(db, "coupons", editing.id), { ...doc_, version: (editing.version ?? 1) + 1, history: arrayUnion(entry) });
  } else {
    await addDoc(collection(db, "coupons"), { ...doc_, usedCount: 0, version: 1, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid ?? "", history: [entry] });
  }
}

export async function setCouponActive(c: Coupon, active: boolean, reason: string) {
  await updateDoc(doc(db, "coupons", c.id), {
    status: active ? "Active" : "Inactive", reason, version: (c.version ?? 1) + 1, updatedAt: serverTimestamp(),
    history: arrayUnion({ action: active ? "Coupon enabled" : "Coupon disabled", reason, byName: who(), at: Timestamp.now() }),
  });
}

export interface CouponTestInput {
  service: string;
  categoryId: string;
  pickupAt: number;
  pickupText: string;
  dropText: string;
  group: "New" | "Returning" | "Regular";
  /** Eligible base fare (pre-GST subtotal) and total of the quote. */
  base: number;
  total: number;
  taxable: number;
  peakAdjusted: boolean;
}

export type CouponCheck = { eligible: true; reason: string; amount: number; total: number } | { eligible: false; reason: string };

/** The server's coupon rules applied to a quote, for the preview only (nothing is recorded). */
export function checkCoupon(c: Coupon, q: CouponTestInput, now = Date.now()): CouponCheck {
  const fail = (reason: string): CouponCheck => ({ eligible: false, reason });
  if (!isEnabled(c)) return fail("This coupon is disabled.");
  const d = draftOf(c, []);
  if (now < istAt(d.bookFrom) || now >= istAt(d.bookUntil)) return fail("Booking date is outside the coupon validity.");
  if (c.audience && (q.pickupAt < istAt(d.pickupFrom) || q.pickupAt >= istAt(d.pickupUntil))) return fail("Pickup date is outside the travel window.");
  if (d.services.length && !d.services.some((s) => s.toLowerCase().includes(q.service.toLowerCase()) || q.service.toLowerCase().includes(s.toLowerCase()))) return fail("This service is not eligible.");
  if (c.vehicleCategoryIds?.length && !c.vehicleCategoryIds.includes(q.categoryId)) return fail("This car category is not eligible.");
  if (q.peakAdjusted && c.audience && !c.allowPeak) return fail("Peak-adjusted fares are excluded.");
  const has = (place: string, city?: string) => !city || place.toLowerCase().includes(city.toLowerCase());
  if (c.scope && c.scope !== "Any" && !has(q.pickupText, c.city)) return fail("Pickup city is not eligible.");
  if (c.scope === "Exact route" && !has(q.dropText, c.dropCity)) return fail("This directional route is not eligible.");
  if (d.audience !== "All" && d.audience !== q.group) return fail(`This coupon is for ${d.audience.toLowerCase()} customers.`);
  if (c.totalUsageLimit && (c.usedCount ?? 0) >= c.totalUsageLimit) return fail("Overall usage limit reached.");
  const base = Math.round(q.base);
  if (base < (c.minimumBookingAmount || 0)) return fail(`Minimum eligible base fare is ₹${(c.minimumBookingAmount || 0).toLocaleString("en-IN")}.`);
  const raw = c.discountType === "PERCENTAGE" ? Math.round((base * c.discountValue) / 100) : Math.round(c.discountValue);
  const amount = Math.min(base, raw, c.discountType === "PERCENTAGE" && c.maximumDiscount ? Math.floor(c.maximumDiscount) : Infinity);
  if (!(amount > 0) || base - amount <= 0) return fail("This coupon would make the payable fare invalid.");
  const ratio = q.taxable > 0 ? q.total / q.taxable : 1;
  return { eligible: true, reason: "Eligible", amount, total: Math.round(q.total - amount * ratio) };
}
