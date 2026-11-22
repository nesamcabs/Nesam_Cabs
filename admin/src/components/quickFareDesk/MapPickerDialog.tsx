import { useMemo } from "react";
import { MapPin, Plane } from "lucide-react";
import DeskDialog from "./DeskDialog";
import MapLocationPicker, { type PickedPoint } from "../MapLocationPicker";
import { pointFromLocation } from "../../services/adminBookingService";
import type { LatLng } from "../../services/geoService";
import type { MasterLocation } from "../../types";

/** Saved airports first, then the other saved hubs: real Master Locations only (none are invented). */
function hubsOf(saved: MasterLocation[]): MasterLocation[] {
  const airports = saved.filter((l) => l.type === "Airport");
  const others = saved.filter((l) => l.type !== "Airport");
  return [...airports, ...others].slice(0, 8);
}

/**
 * Pickup / drop on the map: the app's own map picker (its Maps provider, search and reverse geocoding), with the saved
 * hubs and airports as one-tap choices. The chosen place updates only the field the dialog was opened for.
 */
export default function MapPickerDialog({ side, value, startNear, saved, onChange, onClose }: {
  side: "pickup" | "drop";
  value: PickedPoint | null;
  startNear: LatLng | null;
  saved: MasterLocation[];
  onChange: (p: PickedPoint | null) => void;
  onClose: () => void;
}) {
  const hubs = useMemo(() => hubsOf(saved), [saved]);
  const label = side === "pickup" ? "Pickup" : "Drop";
  return (
    <DeskDialog title={`Select ${label} Location on Map`} subtitle="Search a place or click the map to drop the pin, or choose a saved hub below"
      icon={<MapPin className="w-4 h-4" />} tone="crimson" variant="center" size="xl" onClose={onClose}>
      <div className="p-5 space-y-4">
        <MapLocationPicker label={`${label} location`} tone={side} value={value} startNear={startNear} onChange={onChange} />
        {hubs.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Popular Hubs &amp; Airports</p>
            <div className="flex flex-wrap gap-1.5">
              {hubs.map((l) => (
                <button key={l.id} type="button" onClick={() => { onChange(pointFromLocation(l)); onClose(); }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 hover:bg-crimson-50 hover:text-[#991B1B] text-slate-700 transition-colors inline-flex items-center gap-1">
                  {l.type === "Airport" && <Plane className="w-3 h-3" aria-hidden="true" />}{l.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" onClick={onClose} disabled={!value}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-[#991B1B] text-white hover:bg-[#7F1D1D] disabled:opacity-50 disabled:cursor-not-allowed">
            Use this location
          </button>
        </div>
      </div>
    </DeskDialog>
  );
}
