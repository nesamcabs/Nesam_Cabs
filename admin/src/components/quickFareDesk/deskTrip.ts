import type { CategoryEstimate, QuickTrip } from "../booking/QuickFare";
import { estimateFacts, tripPickupDate } from "../booking/QuickFare";
import type { DeskBrand, DeskQuoteLine, DeskTripSnapshot } from "../../domain/quickFareDesk";
import { formatDate, formatDateTime12, formatTime12, isoDateIST } from "../../utils/time";

export const DESK_MAX_STOPS = 4;
export const DESK_MAX_DAYS = 15;
export const DESK_MAX_RENTAL_HOURS = 15;

/** "YYYY-MM-DD" + "HH:mm" read as India time. */
export const istInstant = (date: string, time: string) => new Date(`${date}T${time || "09:00"}:00+05:30`);
/** "HH:mm" of an instant on the India clock. */
export const hhmmIST = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
export const time12 = (hhmm: string) => (hhmm ? formatTime12(istInstant(isoDateIST(new Date()), hhmm)) : "");
export const dateLabel = (iso: string) => (iso ? formatDate(istInstant(iso, "12:00")) : "");

/** Desk tab of a trip. */
export type DeskTab = "One Way" | "Round Trip" | "Multicity" | "Airport" | "Rental" | "Local";
export const deskTabOf = (t: QuickTrip): DeskTab =>
  t.multicity ? "Multicity" : t.local ? "Local" : t.tripType === "Airport Taxi" ? "Airport" : t.tripType === "Local Rental" ? "Rental" : t.tripType === "Round Trip" ? "Round Trip" : "One Way";

/**
 * The trip as it is priced and saved: settings that the chosen trip type does not use are dropped
 * (stops outside Round Trip / Multicity, days outside Round Trip, hours outside Rental).
 */
export function activeTrip(t: QuickTrip): QuickTrip {
  const round = t.tripType === "Round Trip";
  return {
    ...t,
    stops: round ? (t.stops ?? []).slice(0, DESK_MAX_STOPS) : [],
    days: round && !t.multicity ? Math.min(DESK_MAX_DAYS, Math.max(1, t.days)) : 1,
    rentalHours: t.tripType === "Local Rental" ? Math.min(DESK_MAX_RENTAL_HOURS, Math.max(1, t.rentalHours ?? 1)) : 1,
    airportDirection: t.tripType === "Airport Taxi" ? t.airportDirection : "to",
  };
}

/** Changes to any of these invalidate a fare result. */
export const quoteKeyOf = (t: QuickTrip, brand: DeskBrand) => {
  const a = activeTrip(t);
  return JSON.stringify([brand, a.tripType, a.multicity, a.local, a.serviceId, a.airportDirection, a.pickup?.lat, a.pickup?.lng, a.drop?.lat, a.drop?.lng,
    (a.stops ?? []).map((s) => [s.point?.lat, s.point?.lng]), a.date, a.time, a.days, a.rentalHours, a.fuel ?? "", a.carrier === true, a.pets === true]);
};

const placeName = (p: { name?: string; address?: string } | null, text: string) => p?.name || text.trim() || p?.address || "";
const round4 = (n?: number) => (typeof n === "number" ? n.toFixed(4) : "-");

/** Route label of a trip, in order. */
export function routeOf(t: QuickTrip): string {
  const a = activeTrip(t);
  const p = placeName(a.pickup, a.pickupText);
  const d = placeName(a.drop, a.dropText);
  if (a.tripType === "Local Rental") return `Local rental • ${p}`;
  const stops = (a.stops ?? []).map((s) => placeName(s.point, s.text)).filter(Boolean);
  if (a.tripType === "Round Trip" && !a.multicity) return stops.length ? `${p} → ${stops.join(" → ")} → ${d} → ${p}` : `${p} ⇄ ${d}`;
  return stops.length ? `${p} → ${stops.join(" → ")} → ${d}` : `${p} → ${d}`;
}

/** Everything the follow-up / booking draft keeps about the quoted trip. */
export function snapshotOf(t: QuickTrip, source: DeskBrand, roadKm: number | null): DeskTripSnapshot {
  const a = activeTrip(t);
  const at = tripPickupDate(a);
  const stops = (a.stops ?? []).map((s) => placeName(s.point, s.text));
  const points = [a.pickup, ...(a.stops ?? []).map((s) => s.point), a.tripType === "Local Rental" ? null : a.drop];
  return {
    source,
    tripLabel: deskTabOf(a),
    route: routeOf(a),
    pickup: placeName(a.pickup, a.pickupText),
    drop: a.tripType === "Local Rental" ? "" : placeName(a.drop, a.dropText),
    stops,
    placeKey: points.map((p) => (p ? `${round4(p.lat)},${round4(p.lng)}` : "")).join(";"),
    pickupAtMs: at ? at.getTime() : 0,
    pickupLabel: at ? `${formatDateTime12(at)} IST` : "",
    days: a.tripType === "Round Trip" && !a.multicity ? a.days : null,
    rentalHours: a.tripType === "Local Rental" ? (a.rentalHours ?? 1) : null,
    roadKm,
    fuel: a.fuel === "cng" ? "cng" : null,
    addOns: { pets: a.pets === true, carrier: a.carrier === true },
  };
}

/** Short class badge (SEDAN, SUV…) unless the vehicle name already says it ("Innova" / INNOVA). */
const alnum = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const classBadgeOf = (c: { name: string; code?: string; tariffClass?: string }) => {
  const code = (c.code || c.tariffClass || "").trim().toUpperCase();
  return code && !alnum(c.name).includes(alnum(code)) ? code : "";
};
export const seatsLineOf = (c: { seatingCapacity?: number; luggageCapacity?: string | number }) =>
  [c.seatingCapacity ? `${c.seatingCapacity} Seats` : "", c.luggageCapacity ? `${c.luggageCapacity} Bags` : ""].filter(Boolean).join(" • ");

/** "₹15/km + ₹500 Bata" from the server quote's customer rate card (nothing when the quote does not carry it). */
export function rateLineOf(q: CategoryEstimate["quote"]): string {
  const p = (q as { pricing?: { customerRatePaise?: number; customerBataPaise?: number } } | null)?.pricing;
  const rate = p?.customerRatePaise ? `₹${Math.round(p.customerRatePaise) / 100}/km` : "";
  const bata = p?.customerBataPaise ? `₹${Math.round(p.customerBataPaise) / 100} Bata` : "";
  return [rate, bata].filter(Boolean).join(" + ");
}

/** A priced vehicle → the line shown, copied and saved. */
export function lineOfEstimate(e: CategoryEstimate): DeskQuoteLine | null {
  if (!e.quote) return null;
  const km = estimateFacts.includedKmOf(e.quote);
  return {
    categoryId: e.category.id,
    vehicle: e.category.name,
    classBadge: classBadgeOf(e.category),
    seats: seatsLineOf(e.category),
    fare: e.quote.quote.total,
    rateLine: rateLineOf(e.quote),
    includedKm: km || null,
    manual: false,
  };
}
