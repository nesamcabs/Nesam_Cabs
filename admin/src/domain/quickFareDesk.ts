/**
 * Pure rules and types for the Quick Fare & Enquiry Desk (pages/QuickFare.tsx).
 * No UI and no database calls: deterministic and unit-tested (scripts/quick-fare-desk.test.cjs).
 *
 * Every date and time here is India time (Asia/Kolkata, UTC+05:30, no daylight saving), whatever the
 * browser's own zone. Follow-ups are the office's enquiries (services/enquiryService.ts); this file only
 * reads them.
 */

export type DeskBrand = "nesam" | "onewaycarrentals" | "people_taxi";

export interface BrandMeta {
  id: DeskBrand;
  name: string;
  /** Source dot: colour and ring. */
  dotClass: string;
  /** Check mark of the selected source in the menu. */
  checkClass: string;
}

export const DESK_BRANDS: Record<DeskBrand, BrandMeta> = {
  nesam: { id: "nesam", name: "Nesam Cabs", dotClass: "bg-[#991B1B] ring-crimson-100", checkClass: "text-[#991B1B]" },
  onewaycarrentals: { id: "onewaycarrentals", name: "One Way Car Rentals", dotClass: "bg-blue-600 ring-blue-100", checkClass: "text-blue-600" },
  people_taxi: { id: "people_taxi", name: "People Taxi", dotClass: "bg-emerald-600 ring-emerald-100", checkClass: "text-emerald-600" },
};

export const DESK_BRAND_LIST: DeskBrand[] = ["nesam", "onewaycarrentals", "people_taxi"];

/** Brand id of a stored value ("onewaycarrentals", "People Taxi" …); anything else is Nesam Cabs. */
export function normalizeBrand(raw?: string): DeskBrand {
  if (!raw) return "nesam";
  const s = raw.toLowerCase().trim();
  if (s.includes("people")) return "people_taxi";
  if (s.includes("oneway") || s.includes("one_way") || s.includes("one-way") || s.includes("one way")) return "onewaycarrentals";
  return "nesam";
}

/** The desk's six trip types, in tab order. */
export const DESK_TABS = ["One Way", "Round Trip", "Multicity", "Airport", "Rental", "Local"] as const;
export type DeskTab = (typeof DESK_TABS)[number];

export type QueueFilter = "all" | "due" | "upcoming" | "booked" | "lost";
export type QueueStatus = Exclude<QueueFilter, "all">;

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

/** The server's enquiry reveal categories (functions/src/customerDirectory.ts ENQUIRY_REVEAL_CATEGORIES). */
export const REVEAL_CATEGORIES = [
  "Scheduled follow-up callback",
  "WhatsApp fare quote confirmation",
  "Pickup time / cab availability update",
] as const;
/** The server refuses a reveal note shorter than this (NOTE_MIN). */
export const REVEAL_NOTE_MIN = 10;

export function formatINR(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return "₹0";
  return "₹" + Math.round(val).toLocaleString("en-IN");
}

/** Last 10 digits of an Indian phone ("+91 98421 44510" → "9842144510"); "" when it has fewer. */
export function phoneDigits(raw?: string): string {
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** "+91 98421 •••••": the last five digits hidden. */
export function maskPhone(phone?: string): string {
  const digits = phoneDigits(phone);
  if (digits.length < 10) return phone ? "+91 •••••" : "—";
  return `+91 ${digits.slice(0, 5)} •••••`;
}

/** "+91 98421 44510". */
export function spacedPhone(phone?: string): string {
  const d = phoneDigits(phone);
  return d ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : "";
}

/**
 * Indian mobile → "+91XXXXXXXXXX". Accepts 10 digits, +91 / 91 / 0091 prefixes and one leading zero, with spaces,
 * dashes, dots or brackets. Anything else is rejected: digits are never dropped to make a number fit.
 */
export function normalizeIndianMobile(raw: string): { ok: true; e164: string; digits: string } | { ok: false; reason: string } {
  const compact = (raw || "").trim().replace(/[\s().-]/g, "");
  if (!compact) return { ok: false, reason: "Enter the caller's mobile number." };
  if (!/^\+?\d+$/.test(compact)) return { ok: false, reason: "Use digits only (with an optional +91)." };
  const m = /^(?:\+91|0091|91|0)?([6-9]\d{9})$/.exec(compact);
  if (!m || (compact.startsWith("+") && !compact.startsWith("+91"))) {
    return { ok: false, reason: "Enter a valid 10-digit Indian mobile number (starting 6–9)." };
  }
  return { ok: true, e164: `+91${m[1]}`, digits: m[1] };
}

/**
 * What a mobile box keeps as the person types or pastes: a pasted "+91 98421 44510" becomes "9842144510" (never cut
 * to its first ten characters); anything that is not a full number yet is kept as typed, up to 16 characters.
 */
export function mobileInputValue(raw: string): string {
  const n = normalizeIndianMobile(raw);
  return n.ok ? n.digits : raw.slice(0, 16);
}

// ── India time ─────────────────────────────────────────────────────────────────────────────────────

const IST_MS = 330 * 60000;
const DAY_MS = 86400000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of an instant on the India calendar. */
export const istDateOf = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 10);
/** "HH:mm" (24 h) of an instant on the India clock. */
export const istTimeOf = (ms: number) => new Date(ms + IST_MS).toISOString().slice(11, 16);
/** The instant of an India date and "HH:mm" time; NaN when either is not valid. */
export function istMs(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
  return Date.parse(`${date}T${time}:00Z`) - IST_MS;
}
/** India date `n` days after `iso`. */
export const addDaysIst = (iso: string, n: number) => istDateOf(istMs(iso, "12:00") + n * DAY_MS);
/** Whole India calendar days from today to `iso` (0 today, 1 tomorrow, −1 yesterday); null when not a date. */
export function istDayOffset(iso: string, nowMs: number): number | null {
  const a = istMs(iso, "00:00");
  if (Number.isNaN(a)) return null;
  return Math.round((a - istMs(istDateOf(nowMs), "00:00")) / DAY_MS);
}
/** "22-11-2026". */
export function ddmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

/** "08:00" → "8:00 AM", "00:30" → "12:30 AM", "12:00" → "12:00 PM". */
export function clock12(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

/** The 48 half-hour pickup times of a day, 12:00 AM to 11:30 PM. */
export const PICKUP_TIME_SLOTS: { value: string; label: string }[] = Array.from({ length: 48 }, (_, i) => {
  const value = `${pad2(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`;
  return { value, label: clock12(value) };
});

/** The pickup time options; a saved time between half-hours (08:15) is listed in its place, never rounded. */
export function pickupTimeOptions(value: string): { value: string; label: string }[] {
  if (!value || PICKUP_TIME_SLOTS.some((s) => s.value === value) || !clock12(value)) return PICKUP_TIME_SLOTS;
  return [...PICKUP_TIME_SLOTS, { value, label: clock12(value) }].sort((a, b) => a.value.localeCompare(b.value));
}

export type Meridiem = "AM" | "PM";
/** "17:05" → { hour: "05", minute: "05", mer: "PM" }. */
export function splitClock12(hhmm: string): { hour: string; minute: string; mer: Meridiem } {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "") ?? ["", "09", "00"];
  const h = Number(m[1]);
  return { hour: pad2(h % 12 === 0 ? 12 : h % 12), minute: m[2], mer: h >= 12 ? "PM" : "AM" };
}
/** { "12", "00", "AM" } → "00:00"; { "12", "30", "PM" } → "12:30". */
export function joinClock12(hour: string, minute: string, mer: Meridiem): string {
  const h = Math.min(12, Math.max(1, Number(hour) || 12)) % 12;
  return `${pad2(mer === "PM" ? h + 12 : h)}:${pad2(Math.min(59, Math.max(0, Number(minute) || 0)))}`;
}
export const HOURS_12 = Array.from({ length: 12 }, (_, i) => pad2(i + 1));
export const MINUTES_60 = Array.from({ length: 60 }, (_, i) => pad2(i));

// ── Follow-up reminder presets ─────────────────────────────────────────────────────────────────────

export type ReminderPreset = "15" | "30" | "60" | "now" | "tmrw9" | "tmrw17";
export const REMINDER_CHIPS: { id: ReminderPreset; label: string }[] = [
  { id: "15", label: "In 15 min" },
  { id: "30", label: "In 30 min" },
  { id: "60", label: "In 1 hour" },
  { id: "now", label: "Alert Now" },
];
export const TOMORROW_PRESETS: { id: ReminderPreset; label: string; note: string }[] = [
  { id: "tmrw9", label: "Tomorrow 9:00 AM", note: "Customer said will book tomorrow morning" },
  { id: "tmrw17", label: "Tomorrow 5:00 PM", note: "Customer said will book tomorrow evening" },
];

/** The exact reminder instant of a preset: "In 15 min" is 15 minutes from `nowMs`, never rounded to a quarter-hour. */
export function reminderPresetAt(p: ReminderPreset, nowMs: number): number {
  if (p === "tmrw9" || p === "tmrw17") return istMs(addDaysIst(istDateOf(nowMs), 1), p === "tmrw9" ? "09:00" : "17:00");
  return nowMs + (p === "now" ? 0 : Number(p)) * 60000;
}

/** "dd-mm-yyyy • h:mm AM" of an instant. */
export const scheduleLabel = (ms: number) => `${ddmmyyyy(istDateOf(ms))} • ${clock12(istTimeOf(ms))}`;

// ── Fuel and add-ons (the server prices both: CNG rate cards, pet and roof-carrier charges) ───────

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
export const deskExtrasLabel = (t: { fuel?: "cng" | null; addOns?: { pets: boolean; carrier: boolean } }) => [deskFuelLabel(t.fuel), ...deskAddOnLabels(t.addOns)].join(" • ");

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

// ── Quotes ─────────────────────────────────────────────────────────────────────────────────────────

/** One priced (or manually drafted) vehicle line, exactly as it was shown to the caller. */
export interface DeskQuoteLine {
  categoryId: string;
  vehicle: string;
  /** SEDAN, SUV … (empty when the vehicle name already says it). */
  classBadge: string;
  /** "4 Seats" ("" when not configured). */
  seats: string;
  /** "2 Bags" ("" when not configured). */
  bags: string;
  fare: number;
  /** Rate explanation from the server's pricing ("₹14/km (Diesel) + ₹400 Bata"); empty when not provided. */
  rateNote: string;
  includedKm: number | null;
  /** True when staff typed the fare (pricing unavailable): a draft quote, not a server price. */
  manual: boolean;
}

/** The trip the quote was made for: only the fields its trip type uses. */
export interface DeskTripSnapshot {
  source: DeskBrand;
  tab: DeskTab;
  route: string;
  pickup: string;
  drop: string;
  stops: string[];
  /** Coordinates (rounded) of each chosen place, in order: part of the duplicate check. */
  placeKey: string;
  /** Pickup instant (ms); its India date and "HH:mm". */
  pickupAtMs: number;
  date: string;
  time: string;
  days: number | null;
  rentalHours: number | null;
  roadKm: number | null;
  /** "cng" when priced on the CNG rate card; null for the standard Diesel / Petrol rate. */
  fuel: "cng" | null;
  addOns: { pets: boolean; carrier: boolean };
}

/** Minimal shape of the server's pricing snapshot that the desk reads (functions/src/domain/tariff.ts PricingSnapshot). */
export interface PricingLike {
  model?: string;
  quotedKm?: number;
  includedKm?: number;
  minKmPerDay?: number;
  days?: number;
  customerRatePaise?: number;
  customerBataPaise?: number;
  extraKmRatePaise?: number;
  rentalHours?: number;
  gstInclusiveBase?: { customerRatePaise?: number; customerBataPaise?: number; extraKmRatePaise?: number } | null;
  timeBased?: { label?: string } | null;
}

const rupees = (paise?: number) => (typeof paise === "number" && paise > 0 ? `₹${Math.round(paise) / 100}` : "");
/** The configured customer rate: GST-inclusive when the fare was set with GST inside it. */
const rateOf = (p: PricingLike, k: "customerRatePaise" | "customerBataPaise" | "extraKmRatePaise") => p.gstInclusiveBase?.[k] ?? p[k];
const hrs = (h: number) => `${h} ${h === 1 ? "Hr" : "Hrs"}`;

/** The tariff slab the fare used, from the first priced vehicle: "One Way • 215 km (Min 130 km)". */
export function slabLabelOf(tab: DeskTab, p: PricingLike | null | undefined, days: number | null, rentalHours: number | null): string {
  if (!p) return "";
  const km = p.includedKm || p.quotedKm || 0;
  if (p.timeBased?.label) return km ? `${p.timeBased.label} (${km} km)` : p.timeBased.label;
  switch (p.model) {
    case "one_way_standard":
      return `${tab} • ${p.quotedKm || km} km${p.minKmPerDay ? ` (Min ${p.minKmPerDay} km)` : ""}`;
    case "round_trip_calendar": {
      const d = p.days || days || 1;
      return `${d}-Day Round Trip${p.minKmPerDay ? ` (${d * p.minKmPerDay} km min)` : ""}`;
    }
    case "round_trip_mini":
      return `Mini Round Trip (${km} km)`;
    case "round_trip_overnight_combo":
      return `Overnight Round Trip (${km} km)`;
    case "rental_package":
    case "rental_time": {
      const h = p.rentalHours || rentalHours || 0;
      return `Rental • ${h ? hrs(h) : "Package"}${km ? ` / ${km} km` : ""}`;
    }
    case "airport_transfer":
      return `Airport Transfer${p.minKmPerDay ? ` (${p.minKmPerDay} km incl.)` : ""}`;
    case "local_pickup_drop":
      return "Local • Standard Rate";
    case "fixed_route":
      return "Fixed Route Fare";
    default:
      return km ? `${tab} • ${km} km` : `${tab} • Standard Rate`;
  }
}

/** "₹14/km (Diesel) + ₹400 Bata" from the pricing the server used; "" when it carries no rate. */
export function rateNoteOf(p: PricingLike | null | undefined, fuel: "CNG" | "Diesel"): string {
  if (!p) return "";
  const rate = rupees(rateOf(p, "customerRatePaise"));
  const bata = rupees(rateOf(p, "customerBataPaise"));
  const extra = rupees(rateOf(p, "extraKmRatePaise"));
  const km = p.includedKm || 0;
  switch (p.model) {
    case "one_way_standard":
      return rate ? `${rate}/km (${fuel})${bata ? ` + ${bata} Bata` : ""}` : `(${fuel})`;
    case "round_trip_calendar":
      return rate ? `${rate}/km (${fuel})${bata ? ` + ${bata}/day Bata` : ""}` : `(${fuel})`;
    case "rental_package":
    case "rental_time":
      return km ? `Includes ${km} km (${fuel})${extra ? ` • ${extra}/km extra` : ""}` : `(${fuel})`;
    default:
      if (km) return `${km} km incl. (${fuel})${bata ? ` + ${bata} Bata` : ""}`;
      return rate ? `${rate}/km (${fuel})${bata ? ` + ${bata} Bata` : ""}` : `(${fuel})`;
  }
}

/** Minimal shape of a fare breakup line (functions/src/domain/fareBreakup.ts). */
export interface BreakupLineLike { key: string; treatment: string; amount: number | null }

const andList = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} & ${items[items.length - 1]}`);

/** What the fare includes and what is paid separately, from the quote's breakup. Nothing is assumed. */
export function coverageOf(lines: ReadonlyArray<BreakupLineLike> | null | undefined): { includes: string[]; excludes: string[] } {
  const all = lines ?? [];
  const has = (key: string, treatment: string) => all.some((l) => l.key === key && l.treatment === treatment && (treatment !== "included" || (l.amount ?? 0) > 0));
  return {
    includes: has("driverAllowance", "included") ? ["Driver Bata"] : [],
    excludes: [
      has("toll", "extra") ? "Toll" : "",
      has("parking", "extra") ? "Parking" : "",
      has("stateTax", "extra") ? "State Permit Tax" : "",
    ].filter(Boolean),
  };
}

/** "Includes Driver Bata • Excludes Toll, Parking & State Permit Tax (Actuals)". */
export function coverageNote(c: { includes: string[]; excludes: string[] }): string {
  return [c.includes.length ? `Includes ${andList(c.includes)}` : "", c.excludes.length ? `Excludes ${andList(c.excludes)} (Actuals)` : ""].filter(Boolean).join(" • ");
}

/** The copied WhatsApp fare estimate: exactly the fares on screen. It is copied for staff to paste; nothing is sent. */
export function fareEstimateText(p: {
  brandName: string;
  route: string;
  date: string;
  time: string;
  /** null for a draft (typed) quote, which has no fuel rate card. */
  fuel: "cng" | null | undefined;
  addOns: readonly string[];
  lines: ReadonlyArray<Pick<DeskQuoteLine, "vehicle" | "seats" | "fare" | "manual">>;
  coverage: { includes: string[]; excludes: string[] };
}): string {
  const draft = p.lines.some((l) => l.manual);
  const { includes, excludes } = p.coverage;
  const terms = [includes.length ? `Includes ${andList(includes)}.` : "", excludes.length ? `${andList(excludes)} extra as actuals` : ""].filter(Boolean).join(" ");
  return [
    `*${p.brandName} — ${draft ? "Draft Fare Estimate" : "Fare Estimate"}*`,
    `Route: ${p.route}`,
    `Date: ${p.date} at ${p.time}`,
    ...(draft ? [] : [`Fuel Type: ${deskFuelLabel(p.fuel)}`]),
    ...(p.addOns.length ? [`Add-ons: ${p.addOns.join(", ")}`] : []),
    "",
    ...p.lines.map((l) => `• ${l.vehicle}${l.seats ? ` (${l.seats})` : ""}: ${formatINR(l.fare)}`),
    "",
    ...(terms ? [`_(${terms})_`] : []),
    draft ? "_Draft quote — not yet confirmed._" : "Reply to confirm your cab!",
  ].join("\n");
}

/** The copied WhatsApp booking confirmation, from the booking the server created (its real booking ID). */
export function bookingConfirmationText(p: {
  brandName: string;
  bookingId: string;
  customer: string;
  maskedPhone: string;
  route: string;
  date: string;
  time: string;
  vehicle: string;
  fuel: "cng" | null;
  addOns: readonly string[];
  fare: number;
  /** A payment link the server created (never assumed delivered). */
  paymentLink?: { url: string; amount: number } | null;
}): string {
  return [
    `*${p.brandName} — Booking Confirmed*`,
    `Booking ID: ${p.bookingId}`,
    `Customer: ${p.customer}${p.maskedPhone ? ` (${p.maskedPhone})` : ""}`,
    `Route: ${p.route}`,
    `Pickup: ${p.date} at ${p.time}`,
    `Cab: ${p.vehicle} (${deskFuelLabel(p.fuel)})`,
    ...(p.addOns.length ? [`Add-ons: ${p.addOns.join(", ")}`] : []),
    `Fare: ${formatINR(p.fare)} (+ Toll/Parking/Permit actuals)`,
    ...(p.paymentLink ? [`Payment link (${formatINR(p.paymentLink.amount)}): ${p.paymentLink.url}`] : []),
    "Thank you!",
  ].join("\n");
}

// ── Follow-ups (saved as office enquiries) ────────────────────────────────────────────────────────

/**
 * Same caller (mobile number) + same source + same trip (type, places in order, pickup time, days, hours) = the same
 * enquiry: saving it again updates the open one. Fuel, add-ons and the vehicle are part of the quote, not the trip.
 * Names are never compared: two callers who share a name are different customers.
 */
export function deskKeyOf(mobileDigits: string, t: Pick<DeskTripSnapshot, "source" | "tab" | "placeKey" | "pickupAtMs" | "days" | "rentalHours">): string {
  return [`m:${mobileDigits}`, t.source, t.tab, t.placeKey, t.pickupAtMs, t.days ?? "", t.rentalHours ?? ""].join("|");
}

type MsLike = { toMillis?: () => number; seconds?: number } | Date | number | null | undefined;
/** Milliseconds of a Firestore Timestamp, Date or number; null when absent. */
export function msOf(v: MsLike): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return null;
}

/** The enquiry fields the desk reads (services/enquiryService.ts Enquiry, plus the desk's own fields). */
export interface DeskEnquiryLike {
  id: string;
  code: string;
  status: string;
  brand?: string;
  pickup: string;
  drop: string;
  tripType?: string;
  vehicle?: string;
  estimate?: number;
  customerName?: string;
  phone?: string;
  followUpAt?: MsLike;
  validUntil?: MsLike;
  pickupAt?: MsLike;
  note?: string;
  lostReason?: string;
  convertedBookingId?: string;
  createdAt?: MsLike;
  history?: { at?: MsLike }[];
  deskKey?: string;
  deskQuote?: Partial<DeskQuoteLine> | null;
  deskTrip?: { tab?: string; route?: string; fuel?: "cng" | null; carrier?: boolean; pets?: boolean } | null;
}

export interface DeskQueueRow {
  id: string;
  code: string;
  status: QueueStatus;
  name: string;
  /** Stored mobile ("+91…"), for internal use only (booking on the saved number); never shown unmasked. */
  phone: string;
  masked: string;
  brand: DeskBrand;
  tab: string;
  route: string;
  pickupAtMs: number | null;
  vehicle: string;
  fare: number | null;
  manual: boolean;
  /** Fuel and add-ons are known for enquiries saved from this desk only. */
  fuel: "cng" | null;
  addOns: { pets: boolean; carrier: boolean };
  fromDesk: boolean;
  note: string;
  followUpAtMs: number | null;
  lostReason: string;
  bookingId: string;
  /** Latest change (creation or history entry), for ordering finished rows. */
  updatedMs: number;
}

/** Finished (booked / lost) follow-ups stay in the queue for this long. */
export const QUEUE_KEEP_FINISHED_MS = 30 * DAY_MS;

/** An enquiry as a queue row at `nowMs`, or null when it is not a follow-up (no callback time) or finished long ago. */
export function deskQueueRowOf(e: DeskEnquiryLike, nowMs: number): DeskQueueRow | null {
  const followUpAtMs = msOf(e.followUpAt);
  const fromDesk = !!e.deskKey;
  if (followUpAtMs === null && !fromDesk) return null;
  const historyMs = (e.history ?? []).map((h) => msOf(h.at) ?? 0);
  const updatedMs = Math.max(msOf(e.createdAt) ?? 0, ...historyMs, 0);
  const validUntil = msOf(e.validUntil);
  let status: QueueStatus;
  let lostReason = "";
  if (e.status === "Converted" || e.convertedBookingId) status = "booked";
  else if (e.status === "Closed") { status = "lost"; lostReason = e.lostReason || "Closed"; }
  else if (e.status === "Expired" || (validUntil !== null && validUntil < nowMs)) { status = "lost"; lostReason = "Quote expired"; }
  else if (followUpAtMs === null) return null;
  else status = followUpAtMs <= nowMs ? "due" : "upcoming";
  if ((status === "booked" || status === "lost") && updatedMs && nowMs - updatedMs > QUEUE_KEEP_FINISHED_MS) return null;
  const q = e.deskQuote ?? null;
  const fare = typeof q?.fare === "number" ? q.fare : typeof e.estimate === "number" && e.estimate > 0 ? e.estimate : null;
  return {
    id: e.id,
    code: e.code || e.id,
    status,
    name: (e.customerName || "").trim(),
    phone: e.phone || "",
    masked: e.phone ? maskPhone(e.phone) : "",
    brand: normalizeBrand(e.brand),
    tab: e.deskTrip?.tab || e.tripType || "One Way",
    route: e.deskTrip?.route || [e.pickup, e.drop].filter(Boolean).join(" → "),
    pickupAtMs: msOf(e.pickupAt),
    vehicle: q?.vehicle || e.vehicle || "",
    fare,
    manual: q?.manual === true,
    fuel: e.deskTrip?.fuel === "cng" ? "cng" : null,
    addOns: { pets: e.deskTrip?.pets === true, carrier: e.deskTrip?.carrier === true },
    fromDesk,
    note: (e.note || "").trim(),
    followUpAtMs,
    lostReason,
    bookingId: e.convertedBookingId || "",
    updatedMs,
  };
}

const RANK: Record<QueueStatus, number> = { due: 0, upcoming: 1, booked: 2, lost: 3 };

/** Due first (longest waiting first), then upcoming (soonest first), then booked and lost (latest first). */
export function sortQueue(rows: DeskQueueRow[]): DeskQueueRow[] {
  return [...rows].sort((a, b) => {
    if (a.status !== b.status) return RANK[a.status] - RANK[b.status];
    if (a.status === "due" || a.status === "upcoming") return (a.followUpAtMs ?? 0) - (b.followUpAtMs ?? 0);
    return b.updatedMs - a.updatedMs;
  });
}

/** The follow-up queue at `nowMs`: rows, and real counts per filter. */
export function buildQueue(enquiries: ReadonlyArray<DeskEnquiryLike>, nowMs: number): { rows: DeskQueueRow[]; counts: Record<QueueFilter, number> } {
  const rows = sortQueue(enquiries.map((e) => deskQueueRowOf(e, nowMs)).filter((r): r is DeskQueueRow => !!r));
  const counts: Record<QueueFilter, number> = { all: rows.length, due: 0, upcoming: 0, booked: 0, lost: 0 };
  for (const r of rows) counts[r.status] += 1;
  return { rows, counts };
}

/** The open enquiry (not booked, closed or expired) already saved for this caller and trip, if any. */
export function openDuplicateOf<T extends DeskEnquiryLike>(enquiries: ReadonlyArray<T>, key: string, nowMs: number): T | null {
  return enquiries.find((e) => {
    if (e.deskKey !== key || e.status === "Converted" || e.convertedBookingId || e.status === "Closed" || e.status === "Expired") return false;
    const until = msOf(e.validUntil);
    return until === null || until >= nowMs;
  }) ?? null;
}

/** "Due Now" / "In 12 mins" / "23-11-2026 • 5:00 PM". */
export function reminderLabel(r: Pick<DeskQueueRow, "status" | "followUpAtMs" | "lostReason">, nowMs: number): string {
  if (r.status === "booked") return "Booked";
  if (r.status === "lost") return `Lost • ${r.lostReason || "Closed"}`;
  if (r.status === "due" || r.followUpAtMs === null) return "Due Now";
  const mins = Math.max(1, Math.ceil((r.followUpAtMs - nowMs) / 60000));
  return mins <= 60 ? `In ${mins} min${mins === 1 ? "" : "s"}` : scheduleLabel(r.followUpAtMs);
}
