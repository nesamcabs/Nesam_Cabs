import type { CategoryEstimate, QuickTrip } from "../booking/QuickFare";
import { emptyTrip, estimateFacts, tripPickupDate } from "../booking/QuickFare";
import type { PickedPoint } from "../MapLocationPicker";
import {
  deskFuelLabel,
  istDateOf,
  istTimeOf,
  rateNoteOf,
  type DeskBrand,
  type DeskQuoteLine,
  type DeskTab,
  type DeskTripSnapshot,
  type PricingLike,
} from "../../domain/quickFareDesk";

export const DESK_MAX_STOPS = 4;
export const DESK_MAX_DAYS = 15;
export const DESK_MAX_RENTAL_HOURS = 15;

/** Desk tab → the trip it prices (Multicity is priced from the Round Trip rates; Local is a One Way on the city's Local fare). */
export const TAB_TRIP: Record<DeskTab, { tripType: QuickTrip["tripType"]; multicity?: boolean; local?: boolean }> = {
  "One Way": { tripType: "One Way" },
  "Round Trip": { tripType: "Round Trip" },
  Multicity: { tripType: "Round Trip", multicity: true },
  Airport: { tripType: "Airport Taxi" },
  Rental: { tripType: "Local Rental" },
  Local: { tripType: "One Way", local: true },
};
/** Desk tab → the built-in trip-type key the Services page switches on and off. */
export const SERVICE_KEY: Record<DeskTab, string> = { "One Way": "One Way", "Round Trip": "Round Trip", Multicity: "Multicity", Airport: "Airport Taxi", Rental: "Local Rental", Local: "Pickup & Drop" };

export const deskTabOf = (t: QuickTrip): DeskTab =>
  t.multicity ? "Multicity" : t.local ? "Local" : t.tripType === "Airport Taxi" ? "Airport" : t.tripType === "Local Rental" ? "Rental" : t.tripType === "Round Trip" ? "Round Trip" : "One Way";

/**
 * The trip as it is priced and saved: settings the chosen trip type does not use are dropped
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

/** Changes to any of these make a fare result out of date. */
export const quoteKeyOf = (t: QuickTrip, brand: DeskBrand) => {
  const a = activeTrip(t);
  return JSON.stringify([brand, a.tripType, a.multicity, a.local, a.serviceId, a.airportDirection, a.pickup?.lat, a.pickup?.lng, a.drop?.lat, a.drop?.lng,
    (a.stops ?? []).map((s) => [s.point?.lat, s.point?.lng]), a.date, a.time, a.days, a.rentalHours, a.fuel ?? "", a.carrier === true, a.pets === true]);
};

const placeName = (p: { name?: string; address?: string } | null, text: string) => p?.name || text.trim() || p?.address || "";
const round4 = (n?: number) => (typeof n === "number" ? n.toFixed(4) : "-");

/** Route label of a trip, in order ("Local Rental • Coimbatore" for a rental). */
export function routeOf(t: QuickTrip): string {
  const a = activeTrip(t);
  const p = placeName(a.pickup, a.pickupText);
  const d = placeName(a.drop, a.dropText);
  if (a.tripType === "Local Rental") return `Local Rental • ${p}`;
  const stops = (a.stops ?? []).map((s) => placeName(s.point, s.text)).filter(Boolean);
  if (a.tripType === "Round Trip" && !a.multicity) return stops.length ? `${p} → ${stops.join(" → ")} → ${d} → ${p}` : `${p} ⇄ ${d}`;
  return stops.length ? `${p} → ${stops.join(" → ")} → ${d}` : `${p} → ${d}`;
}

/** Everything a follow-up or booking keeps about the quoted trip. */
export function snapshotOf(t: QuickTrip, source: DeskBrand, roadKm: number | null): DeskTripSnapshot {
  const a = activeTrip(t);
  const at = tripPickupDate(a);
  const ms = at ? at.getTime() : 0;
  const points = [a.pickup, ...(a.stops ?? []).map((s) => s.point), a.tripType === "Local Rental" ? null : a.drop];
  return {
    source,
    tab: deskTabOf(a),
    route: routeOf(a),
    pickup: placeName(a.pickup, a.pickupText),
    drop: a.tripType === "Local Rental" ? "" : placeName(a.drop, a.dropText),
    stops: (a.stops ?? []).map((s) => placeName(s.point, s.text)),
    placeKey: points.map((p) => (p ? `${round4(p.lat)},${round4(p.lng)}` : "")).join(";"),
    pickupAtMs: ms,
    date: ms ? istDateOf(ms) : a.date,
    time: ms ? istTimeOf(ms) : a.time,
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
export const seatsOf = (c: { seatingCapacity?: number }) => (c.seatingCapacity ? `${c.seatingCapacity} Seats` : "");
export const bagsOf = (c: { luggageCapacity?: string | number }) => (c.luggageCapacity ? `${c.luggageCapacity} Bags` : "");

/** The server's pricing snapshot carried by a quote (absent from older servers). */
export const pricingOf = (q: CategoryEstimate["quote"]): PricingLike | null => ((q as { pricing?: PricingLike } | null)?.pricing ?? null);

/** A priced vehicle → the line shown, copied and saved. */
export function lineOfEstimate(e: CategoryEstimate): DeskQuoteLine | null {
  if (!e.quote) return null;
  const km = estimateFacts.includedKmOf(e.quote);
  return {
    categoryId: e.category.id,
    vehicle: e.category.name,
    classBadge: classBadgeOf(e.category),
    seats: seatsOf(e.category),
    bags: bagsOf(e.category),
    fare: e.quote.quote.total,
    rateNote: rateNoteOf(pricingOf(e.quote), deskFuelLabel(e.quote.fuelType === "cng" ? "cng" : null)),
    includedKm: km || null,
    manual: false,
  };
}

// ── The trip stored with a follow-up, so a saved enquiry can be re-quoted and booked exactly as quoted ──

export interface DeskTripRecord {
  v: 1;
  tab: DeskTab;
  route: string;
  tripType: QuickTrip["tripType"];
  multicity: boolean;
  local: boolean;
  serviceId: string;
  airportDirection: "to" | "from";
  pickup: PickedPoint | null;
  pickupText: string;
  drop: PickedPoint | null;
  dropText: string;
  stops: { text: string; point: PickedPoint | null }[];
  date: string;
  time: string;
  days: number;
  rentalHours: number;
  fuel: "cng" | null;
  carrier: boolean;
  pets: boolean;
}

/** Firestore refuses `undefined`: only defined values are kept. */
const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function deskTripRecord(t: QuickTrip): DeskTripRecord {
  const a = activeTrip(t);
  return plain({
    v: 1 as const,
    tab: deskTabOf(a),
    route: routeOf(a),
    tripType: a.tripType,
    multicity: !!a.multicity,
    local: !!a.local,
    serviceId: a.serviceId || "",
    airportDirection: a.airportDirection,
    pickup: a.pickup,
    pickupText: a.pickupText,
    drop: a.drop,
    dropText: a.dropText,
    stops: a.stops ?? [],
    date: a.date,
    time: a.time,
    days: a.days,
    rentalHours: a.rentalHours ?? 1,
    fuel: a.fuel === "cng" ? ("cng" as const) : null,
    carrier: a.carrier === true,
    pets: a.pets === true,
  });
}

const isPoint = (p: unknown): p is PickedPoint => !!p && typeof (p as PickedPoint).lat === "number" && typeof (p as PickedPoint).lng === "number";
const TRIP_TYPES: QuickTrip["tripType"][] = ["One Way", "Round Trip", "Local Rental", "Airport Taxi"];

/** The quoted trip of a saved follow-up; null when the enquiry was not saved from this desk (or is unreadable). */
export function quickTripOfRecord(r: unknown): QuickTrip | null {
  const x = r as Partial<DeskTripRecord> | null;
  if (!x || x.v !== 1 || !isPoint(x.pickup) || !x.tripType || !TRIP_TYPES.includes(x.tripType)) return null;
  if (x.tripType !== "Local Rental" && !isPoint(x.drop)) return null;
  return {
    ...emptyTrip(),
    tripType: x.tripType,
    multicity: x.multicity === true,
    local: x.local === true,
    serviceId: typeof x.serviceId === "string" ? x.serviceId : "",
    airportDirection: x.airportDirection === "from" ? "from" : "to",
    pickup: x.pickup,
    pickupText: x.pickupText || x.pickup.name || "",
    drop: isPoint(x.drop) ? x.drop : null,
    dropText: x.dropText || (isPoint(x.drop) ? x.drop.name : "") || "",
    stops: Array.isArray(x.stops) ? x.stops.map((s) => ({ text: String(s?.text ?? ""), point: isPoint(s?.point) ? s.point : null })) : [],
    date: typeof x.date === "string" ? x.date : "",
    time: typeof x.time === "string" ? x.time : "",
    days: Number(x.days) >= 1 ? Number(x.days) : 1,
    rentalHours: Number(x.rentalHours) >= 1 ? Number(x.rentalHours) : 1,
    fuel: x.fuel === "cng" ? "cng" : undefined,
    carrier: x.carrier === true,
    pets: x.pets === true,
  };
}
