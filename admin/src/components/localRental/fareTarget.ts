import type { MasterLocation } from "../../types";
import { scopeKeyOf, stateNameOf, zoneOfArea, type Indexed, type LocSel } from "../../domain/locationHierarchy";
import { keysFrom, type EditLevel } from "../../domain/geoFareView";
import { geoDocId, type GeoScopeInput, type GeoService } from "../../services/geoFareService";

/**
 * What the Fare rates editor writes to: the scope(s) of the chosen level. Separate from how a quote is priced: the server resolves
 * every booking from its own pickup location, never from the tab that happens to be open here.
 *   District default → the selected district.   Zone override → the selected zone.   Area override → the selected area, or the areas
 *   ticked in Areas & coverage (bulk: only the edited fields are written to each, nothing is copied between them).
 */
export interface FareTarget {
  ready: boolean;
  /** Why nothing can be edited yet (choose a district / zone / area). */
  needs?: string;
  scopes: GeoScopeInput[];
  ids: string[];
  /** Keys the first target inherits from, at and above its level (area → zone → district). */
  keys: string[];
  label: string;
}

export function fareTarget(level: EditLevel, sel: LocSel, bulkIds: string[], index: Indexed[], brand: string, service: GeoService): FareTarget {
  const empty = (needs: string): FareTarget => ({ ready: false, needs, scopes: [], ids: [], keys: [], label: "" });
  if (!sel.state || !sel.district) return empty("Choose a state and district above.");
  const district = scopeKeyOf({ level: "district", state: sel.state, district: sel.district });
  const base = { state: sel.state, district: sel.district };
  const name = (id: string) => index.find((x) => x.loc.id === id)?.loc.name ?? "Unknown location";
  if (level === "district") {
    return { ready: true, scopes: [{ level: "district", ...base }], ids: [geoDocId(brand, service, district)], keys: [district], label: `${sel.district} district` };
  }
  if (level === "zone") {
    if (!sel.zoneId) return empty("Choose a service zone above to set its override.");
    const zone = `z_${sel.zoneId}`;
    return { ready: true, scopes: [{ level: "zone", ...base, zoneId: sel.zoneId }], ids: [geoDocId(brand, service, zone)], keys: keysFrom("zone", { zone, district }), label: name(sel.zoneId) };
  }
  const areaIds = bulkIds.length ? bulkIds : sel.locationId ? [sel.locationId] : [];
  if (!areaIds.length) return empty("Choose an area / village above (or tick areas in Areas & coverage) to set an override.");
  const first = index.find((x) => x.loc.id === areaIds[0])?.loc as MasterLocation | undefined;
  const zoneId = first ? zoneOfArea(first, index)?.id : undefined;
  return {
    ready: true,
    scopes: areaIds.map((id) => ({ level: "area", ...base, locationId: id })),
    ids: areaIds.map((id) => geoDocId(brand, service, `a_${id}`)),
    keys: keysFrom("area", { area: `a_${areaIds[0]}`, zone: zoneId ? `z_${zoneId}` : undefined, district }),
    label: areaIds.length > 1 ? `${areaIds.length} areas` : name(areaIds[0]!),
  };
}

export const brandText = (brand: string, labels: Record<string, string>) => (brand === "common" ? "All brands" : labels[brand] ?? brand);
export const placeText = (sel: LocSel, label: string) => (label ? label : sel.state ? stateNameOf(sel.state) : "All locations");
