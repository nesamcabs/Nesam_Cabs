import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MasterLocation } from "../../types";
import { MAP_ATTRIBUTION, MAP_TILE_URL } from "../../services/geoService";

/**
 * The zone's mapped locations on the admin's existing map (Leaflet with the configured tile server). Only saved coordinates are drawn:
 * no boundary is invented from pincodes, circles or a geocoder viewport. The view fits the drawn points.
 */
export default function MappedLocationsMap({ points }: { points: MasterLocation[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!box.current || map.current) return undefined;
    map.current = L.map(box.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION, maxZoom: 19 }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const ll = points.filter((p) => typeof p.lat === "number" && typeof p.lng === "number").map((p) => {
      L.circleMarker([p.lat!, p.lng!], { radius: 6, color: "#991b1b", weight: 2, fillColor: "#ef4444", fillOpacity: 0.7 }).bindTooltip(p.name).addTo(g);
      return L.latLng(p.lat!, p.lng!);
    });
    if (ll.length === 1) m.setView(ll[0]!, 13);
    else if (ll.length > 1) m.fitBounds(L.latLngBounds(ll), { padding: [24, 24], maxZoom: 14 });
    setTimeout(() => m.invalidateSize(), 0);
  }, [points]);
  return <div ref={box} className="h-[220px] w-full overflow-hidden rounded-lg border border-slate-200" role="img" aria-label="Mapped locations of the zone" />;
}
