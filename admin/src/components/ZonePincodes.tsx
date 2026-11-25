import { useEffect, useState } from "react";
import type { MasterLocation } from "../types";
import { setZonePincodes } from "../services/locationService";
import { GST_STATES } from "../domain/gstStates";
import { usePincodeScope } from "../hooks/usePincodeScope";
import PincodePicker from "./PincodePicker";
import { Button } from "./ui";

/**
 * Pickup & Drop zones by pincode. A pickup whose pincode is listed in a zone is priced with that zone's rates (the booking server
 * reads the pincode from the pickup's address); a pickup in the city but in no zone uses the city's rates.
 *   - no zone chosen: name a new zone and tick its pincodes;
 *   - a zone chosen:  change its pincodes.
 * The list is the city's own pincodes and the nearest first, then the rest of the district (India Post).
 */
export default function ZonePincodes({ city, zone, zones, busy, canEdit, onCreate, onToast }: {
  city: MasterLocation;
  zone?: MasterLocation;
  /** Every active zone of this city. */
  zones: MasterLocation[];
  busy: boolean;
  canEdit: boolean;
  /** Creates the zone record; resolves once it is saved. */
  onCreate: (name: string, pincodes: string[]) => Promise<void>;
  onToast: (text: string) => void;
}) {
  const cityName = city.name || city.city;
  const stateCode = GST_STATES.find(([, n]) => n.trim().toLowerCase() === (city.state || "").trim().toLowerCase())?.[0] ?? "";
  const scope = usePincodeScope(stateCode, cityName, "none");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>(zone?.pincodes ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setPicked(zone?.pincodes ?? []); setError(""); setName(""); }, [zone?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = zone ? picked : scope.pins;
  const setSelected = zone ? setPicked : scope.setPins;
  const others = zones.filter((z) => z.id !== zone?.id);
  const clash = (pins: string[]) => {
    for (const z of others) {
      const pin = pins.find((p) => z.pincodes?.includes(p));
      if (pin) return `${pin} is already in the zone "${z.name || z.area}". A pincode can be in one zone only.`;
    }
    return "";
  };

  if (!stateCode || scope.list === null) {
    return <p className="fm-hint">No pincode list for {cityName}{stateCode ? "" : " (its state is not a listed one)"}. Zones can still be added by name from the list above.</p>;
  }

  const submit = async () => {
    setError("");
    if (!selected.length) return setError("Tick at least one pincode.");
    const problem = clash(selected);
    if (problem) return setError(problem);
    setSaving(true);
    try {
      if (zone) {
        await setZonePincodes(zone, selected);
        onToast(`${zone.name || zone.area}: ${selected.length} pincode${selected.length === 1 ? "" : "s"} saved. New quotes use them now.`);
      } else {
        const first = scope.list?.pins.find((p) => p.pin === selected[0])?.name ?? "";
        const zoneName = name.trim() || `${first || "Zone"} (${selected.length} pincode${selected.length === 1 ? "" : "s"})`;
        if (zones.some((z) => (z.name || z.area || "").trim().toLowerCase() === zoneName.toLowerCase())) {
          setError(`A zone named "${zoneName}" already exists in ${cityName}. Choose another name.`);
          return;
        }
        await onCreate(zoneName, selected);
        setName("");
        scope.setPins([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The zone was not saved.");
    } finally {
      setSaving(false);
    }
  };

  const changed = zone ? JSON.stringify([...picked].sort()) !== JSON.stringify([...(zone.pincodes ?? [])].sort()) : true;
  return (
    <div className="space-y-2">
      <div className="fm-place-picker">
        {!zone && (
          <label className="fm-mini"><span>New zone name</span>
            <input className="ds-input" value={name} maxLength={80} placeholder="e.g. Periyakulam side" disabled={!canEdit || busy || saving} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <div className="fm-mini"><span>{zone ? `Pincodes in ${zone.name || zone.area}` : "Zone pincodes"}</span>
          <div className="relative"><PincodePicker list={scope.list} selected={selected} onChange={setSelected} cityChosen disabled={!canEdit || busy || saving} label="Zone pincodes" /></div>
        </div>
        {canEdit && <Button icon={zone ? "check" : "plus"} onClick={() => void submit()} loading={saving} disabled={busy || saving || !selected.length || !changed}>{zone ? "Save pincodes" : "Add zone"}</Button>}
      </div>
      <p className="fm-hint">{zone ? "A pickup with one of these pincodes is priced with this zone's rates." : `Tick the pincodes this zone covers. A pickup in ${cityName} with one of them is priced with the zone's rates; other pickups use the city rates.`}</p>
      {error && <p className="ds-error" role="alert">{error}</p>}
    </div>
  );
}
