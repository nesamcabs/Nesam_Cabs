/**
 * Customers Directory rules, kept free of React and Firebase so they can be tested.
 * Segments, KPIs, filtering, loyalty, messages and the CSV export live here.
 */
import type { Customer, MasterCoupon } from "../types";
import type { CustomerStats } from "../services/customerStats";
import { getEffectiveCouponStatus, normalizeCouponCode } from "../services/couponEngine";

// ── Status ───────────────────────────────────────────────────────────────────
// Canonical values written by the admin are "Active" and "Blocked". Accounts created by the customer apps carry
// "Approved" (the rules treat it as active); older records may be empty or in another case. Anything else is shown as it is.
export const STATUS_ACTIVE = "Active";
export const STATUS_BLOCKED = "Blocked";
export const isBlockedStatus = (s: unknown) => typeof s === "string" && /^(blocked|block)$/i.test(s.trim());
export const isActiveStatus = (s: unknown) => !s || (typeof s === "string" && /^(active|approved)$/i.test(s.trim()));
/** "Active" for every active alias; the raw text for any other state. */
export const statusLabel = (s: unknown) => (isActiveStatus(s) ? STATUS_ACTIVE : isBlockedStatus(s) ? STATUS_BLOCKED : String(s));

// ── Groups and segments ──────────────────────────────────────────────────────
export type Group = "New" | "Returning" | "Regular";
/** Derived from completed trips: none = New, one or two = Returning, three or more = Regular. */
export const groupOf = (completed: number): Group => (completed >= 3 ? "Regular" : completed >= 1 ? "Returning" : "New");

export type Segment = "All" | "New" | "Returning" | "Regular" | "Corporate" | "Due" | "Blocked";
export const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "All", label: "All" },
  { id: "New", label: "New" },
  { id: "Returning", label: "Returning" },
  { id: "Regular", label: "Regular / VIP" },
  { id: "Corporate", label: "Corporate" },
  { id: "Due", label: "Credit Due" },
  { id: "Blocked", label: "Blocked" },
];

export interface Row { c: Customer; s: CustomerStats }
export const isRegularOrVip = (r: Row) => r.c.isVip === true || groupOf(r.s.completed) === "Regular";
export const isCorporate = (r: Row) => r.c.isCorporate === true;
export const hasDue = (r: Row) => r.s.outstanding > 0.004;

/** Whether a customer belongs to a segment. Each fact is separate: one customer can be in several segments, and counts once in each. */
export function inSegment(r: Row, seg: Segment): boolean {
  switch (seg) {
    case "All": return true;
    case "New": return groupOf(r.s.completed) === "New";
    case "Returning": return groupOf(r.s.completed) === "Returning";
    case "Regular": return isRegularOrVip(r);
    case "Corporate": return isCorporate(r);
    case "Due": return hasDue(r);
    case "Blocked": return isBlockedStatus(r.c.status);
  }
}

/** Main badge: an explicit designation wins over the derived group. */
export function primaryBadge(r: Row): { label: string; tone: "blue" | "amber" | "green" } {
  if (isCorporate(r)) return { label: "Corporate", tone: "blue" };
  if (r.c.isVip) return { label: "VIP", tone: "amber" };
  const g = groupOf(r.s.completed);
  return g === "Regular" ? { label: "Regular", tone: "amber" } : g === "Returning" ? { label: "Returning", tone: "blue" } : { label: "New", tone: "green" };
}
/** The segment name the CSV and message use. */
export const segmentName = (r: Row): string => (isCorporate(r) ? "Corporate" : r.c.isVip ? "VIP" : groupOf(r.s.completed));

export function countSegments(rows: Row[]): Record<Segment, number> {
  const out = {} as Record<Segment, number>;
  for (const { id } of SEGMENTS) out[id] = rows.filter((r) => inSegment(r, id)).length;
  return out;
}

export interface Kpis { total: number; vip: number; corporate: number; due: number; dueAccounts: number }
export function computeKpis(rows: Row[]): Kpis {
  return {
    total: rows.length,
    vip: rows.filter(isRegularOrVip).length,
    corporate: rows.filter(isCorporate).length,
    due: rows.reduce((n, r) => n + Math.max(0, r.s.outstanding), 0),
    dueAccounts: rows.filter(hasDue).length,
  };
}

// ── Brands ───────────────────────────────────────────────────────────────────
export const BRANDS = [
  { id: "nesam", label: "Nesam Cabs" },
  { id: "onewaycarrentals", label: "One Way Car Rentals" },
  { id: "people_taxi", label: "People Taxi" },
] as const;
export const brandLabel = (id: string) => BRANDS.find((b) => b.id === id)?.label ?? id;
/** A customer with no recorded booking brand matches only "All Brands": nothing is guessed. */
export const inBrand = (c: Customer, brand: string) => brand === "all" || (c.brands ?? []).includes(brand);

// ── Search and filters ───────────────────────────────────────────────────────
export const digitsOf = (v: string) => v.replace(/\D/g, "");

/**
 * Name, customer code, document id, email, city and lead source match by text. The mobile number matches on the digits the
 * masked list shows (the first five) when 4–5 digits are typed; a full 10-digit number is looked up on the server (`lookedUp`).
 */
export function matchesSearch(c: Customer, term: string, lookedUp: ReadonlySet<string>): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  if ([c.name, c.email === "N/A" ? "" : c.email, c.id, c.customerCode ?? "", c.city ?? "", c.leadSource ?? ""].some((v) => (v || "").toLowerCase().includes(t))) return true;
  const d = digitsOf(t).replace(/^91(?=\d{10}$)/, "");
  if (d.length >= 4 && d.length <= 5 && (c.phoneMasked ?? "").replace(/\D/g, "").slice(2).startsWith(d)) return true;
  return d.length === 10 && lookedUp.has(c.id);
}

export function filterRows(rows: Row[], f: { q: string; segment: Segment; brand: string; lookedUp: ReadonlySet<string> }): Row[] {
  return rows
    .filter((r) => inSegment(r, f.segment) && inBrand(r.c, f.brand) && matchesSearch(r.c, f.q, f.lookedUp))
    .sort((a, b) => (a.c.name || "").localeCompare(b.c.name || ""));
}

// ── Money and messages ───────────────────────────────────────────────────────
export const inr = (n: number) => `₹${(Math.round((Number.isFinite(n) ? n : 0) * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export interface Offer { code: "VIP500" | "NESAM250"; amount: 500 | 250 }
/** VIP, or at least three completed trips, receives VIP500 / ₹500; everyone else NESAM250 / ₹250. */
export const offerFor = (r: Row): Offer => (r.c.isVip || r.s.completed >= 3 ? { code: "VIP500", amount: 500 } : { code: "NESAM250", amount: 250 });

/**
 * The loyalty message names a code and an amount, so the code must exist in Offers & Coupons, be active today and give exactly that amount.
 * Nothing is created here: a missing or different coupon is reported and the message is not offered.
 */
export function checkOfferCoupon(coupons: MasterCoupon[] | null, o: Offer, now: Date = new Date()): { ok: boolean; message: string } {
  if (!coupons) return { ok: false, message: `Checking ${o.code} in Offers & Coupons…` };
  const c = coupons.find((x) => normalizeCouponCode(x.code) === o.code);
  if (!c) return { ok: false, message: `${o.code} is not set up in Offers & Coupons, so it cannot be offered yet.` };
  const state = getEffectiveCouponStatus(c, now);
  if (state !== "Active") return { ok: false, message: `${o.code} is ${state.toLowerCase()}, so it cannot be offered.` };
  if (c.discountType !== "FIXED_AMOUNT" || Math.round(c.discountValue) !== o.amount) {
    return { ok: false, message: `${o.code} is set to ${c.discountType === "PERCENTAGE" ? `${c.discountValue}%` : inr(c.discountValue)}, not ${inr(o.amount)}. Fix the coupon before offering it.` };
  }
  return { ok: true, message: "" };
}

export const reminderMessage =(name: string, due: number) =>
  `*NESAM CABS — Payment Reminder*\nHello ${name},\nPending balance for your recent trip(s) is *${inr(due)}*.\nPlease settle via UPI/Razorpay at your convenience. Thank you!`;
export const loyaltyMessage = (name: string, o: Offer) =>
  `*NESAM CABS — Special Loyalty Reward*\nHello ${name},\nThank you for riding with Nesam Cabs! Use promo code *${o.code}* on your next outstation booking to get *${inr(o.amount)} OFF*.\nCall/WhatsApp us anytime to book!`;
export const statementText = (r: Row, code: string) =>
  `NESAM CABS — Customer Statement\nCustomer: ${r.c.name} (${code})\nCompleted Trips: ${r.s.completed}\nTotal Spend: ${inr(r.s.spend)}`;

// ── Company / GSTIN single field (the reference's "Company / GSTIN (Optional)") ─────────────
const GSTIN_IN_TEXT = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/i;
/** "33AABCN1234F1Z5 • Sri Tex Exports" → { gstin, company }. Text without a GSTIN is the company name. */
export function splitCompanyGstin(input: string): { company: string; gstin: string } {
  const text = input.trim();
  const m = GSTIN_IN_TEXT.exec(text);
  if (!m) return { company: text, gstin: "" };
  const company = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/^[\s•·\-–—|,]+|[\s•·\-–—|,]+$/g, "").replace(/\s{2,}/g, " ");
  return { company, gstin: m[0].toUpperCase() };
}
export const joinCompanyGstin = (company?: string, gstin?: string) => [gstin, company].filter(Boolean).join(" • ");

// ── CSV ──────────────────────────────────────────────────────────────────────
/** A text cell that a spreadsheet would run as a formula is stored as text (OWASP CSV injection guidance). */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = v.replace(/\r\n|\r|\n/g, "\n");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const CSV_HEADERS = ["Customer ID", "Name", "Mobile", "City", "Segment", "Trips", "Total Spend"] as const;
/** The reference's seven fields. `mobile` is the masked form unless the Master asked for the full numbers. */
export function customersCsv(rows: Row[], mobile: (c: Customer) => string, code: (c: Customer) => string): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) lines.push([code(r.c), r.c.name, mobile(r.c), r.c.city ?? "", segmentName(r), r.s.completed, r.s.spend].map(csvCell).join(","));
  return lines.join("\n");
}
