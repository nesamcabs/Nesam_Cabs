/**
 * How a point chosen in the admin map dialog becomes the booking's pickup / drop (New Booking). The booking server
 * needs a real address for every map pin (functions/src/bookingBuild.ts pinPlace), so a pin is only quoted once its
 * address is known: looked up by the map, or typed by the admin. Unit tested in scripts/new-booking-points.test.cjs.
 */
import type { PickedPoint } from "../components/MapLocationPicker";

/** The map picker's own name for a pin whose address is not known yet. */
export const PIN_PLACEHOLDER_NAME = "Pinned location";

/** True while a pin's address is still being looked up, when no address was found, or when the address is too short to book. */
export const pinNeedsAddress = (pt: PickedPoint | null): boolean => !!pt && (pt.resolved === false || pt.address.trim().length < 3);

export const coordsText = (pt: { lat: number; lng: number }) => `${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)}`;

/**
 * The point to store and the text to show in the location field. An address typed for a pin also names it (never the
 * placeholder); a pin without an address shows its coordinates, so the field and the pin always describe the same place.
 */
export function pickedForBooking(picked: PickedPoint | null): { point: PickedPoint | null; label: string } {
  if (!picked) return { point: null, label: "" };
  const address = picked.address.trim();
  const point = picked.resolved !== false && address && (!picked.name || picked.name === PIN_PLACEHOLDER_NAME)
    ? { ...picked, name: address.split(",")[0].trim() }
    : picked;
  const label = point.resolved === false ? coordsText(point) : point.name || address.split(",")[0];
  return { point, label };
}
