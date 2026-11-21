/**
 * Which website / app a booking came from. Pure, so the booking tables, the Master Admin dashboard and its tests read one rule.
 * The stored aliases are matched by name; a booking with no recognisable source is never attributed to a brand it did not come from.
 */
export type BookingSourceType = "nesam" | "onewaycarrentals" | "people_taxi";

type SourceFields = { source?: string; bookingSource?: string; brand?: string; website?: string; notes?: string } | null | undefined;

export function getBookingSource(b: SourceFields): BookingSourceType {
  if (!b) return "nesam";
  const raw = `${b.bookingSource || ""} ${b.source || ""} ${b.brand || ""} ${b.website || ""}`.toLowerCase();
  if (raw.includes("oneway") || raw.includes("one_way") || raw.includes("one-way")) return "onewaycarrentals";
  if (raw.includes("people") || raw.includes("peopletaxi")) return "people_taxi";
  const notes = (b.notes || "").toLowerCase();
  if (notes.includes("onewaycarrental") || notes.includes("one way car rental")) return "onewaycarrentals";
  if (notes.includes("people taxi") || notes.includes("peopletaxi")) return "people_taxi";
  return "nesam";
}

/** Source as shown in a table: "nesam" only when explicitly stored, otherwise "unknown". */
export type BookingSourceDisplay = BookingSourceType | "unknown";

export function getBookingSourceDisplay(b: SourceFields): BookingSourceDisplay {
  const s = getBookingSource(b);
  if (s !== "nesam") return s;
  const raw = `${b?.bookingSource || ""} ${b?.source || ""} ${b?.brand || ""} ${b?.website || ""}`.toLowerCase();
  return raw.includes("nesam") ? "nesam" : "unknown";
}
