import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import PincodePicker from "../PincodePicker";
import type { PincodeList } from "../../domain/pincodes";
import { MAX_ZONES, type DistrictGeo, type ServiceZone } from "../../domain/localPricing";

/** The district's service zones: a name and its pincodes. A pincode belongs to one zone only. Saved with the page. */
export default function ZoneManager({ list, geo, zoneId, canEdit, suggested, onChange, onSelect }: {
  list: PincodeList; geo: DistrictGeo; zoneId: string; canEdit: boolean;
  /** These zones were worked out from the district's towns and are not saved yet. */
  suggested: boolean;
  onChange: (zones: ServiceZone[]) => void;
  onSelect: (zoneId: string) => void;
}) {
  const [name, setName] = useState("");
  const [pins, setPins] = useState<string[]>([]);
  const [error, setError] = useState("");
  const zone = geo.zones.find((z) => z.id === zoneId);
  const holder = (pin: string, except?: string) => geo.zones.find((z) => z.id !== except && z.pins.includes(pin));
  /** The other zones once these PIN codes leave them (a zone left empty goes); null when the office says no. */
  const release = (next: string[], except?: string): ServiceZone[] | null => {
    const from = [...new Set(next.map((p) => holder(p, except)?.name).filter((n): n is string => !!n))];
    if (from.length && !window.confirm(`Move these PIN codes out of ${from.join(", ")}? A PIN code can be in one zone only. A zone left without any is removed with its rates.`)) return null;
    return geo.zones.map((z) => (z.id === except ? z : { ...z, pins: z.pins.filter((p) => !next.includes(p)) })).filter((z) => z.id === except || z.pins.length > 0);
  };
  const taken = (value: string, except?: string) => geo.zones.some((z) => z.id !== except && z.name.trim().toLowerCase() === value.trim().toLowerCase());

  const add = () => {
    const zoneName = name.trim();
    if (!zoneName) return setError("Name the zone.");
    if (taken(zoneName)) return setError(`A zone named "${zoneName}" already exists.`);
    if (!pins.length) return setError("Tick at least one PIN code.");
    if (geo.zones.length >= MAX_ZONES) return setError(`A district can have at most ${MAX_ZONES} zones.`);
    const others = release(pins);
    if (!others) return;
    const id = `z_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    onChange([...others, { id, name: zoneName, pins: [...pins].sort() }]);
    setName(""); setPins([]); setError("");
    onSelect(id);
  };
  const update = (patch: Partial<ServiceZone>) => {
    if (!zone) return;
    const others = patch.pins ? release(patch.pins, zone.id) : geo.zones;
    if (!others) return;
    setError("");
    onChange(others.map((z) => (z.id === zone.id ? { ...z, ...patch } : z)));
  };
  const remove = () => {
    if (!zone || !window.confirm(`Remove the zone "${zone.name}" and its zone rates?`)) return;
    onChange(geo.zones.filter((z) => z.id !== zone.id));
    onSelect("");
    setError("");
  };

  return (
    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
      {zone && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="lf-label">Zone name</span>
            <input className="lf-text w-56" maxLength={80} disabled={!canEdit} value={zone.name} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <div className="w-72 max-w-full"><span className="lf-label">Pincodes in this zone</span>
            <div className="relative"><PincodePicker list={list} selected={zone.pins} onChange={(next) => update({ pins: next })} cityChosen disabled={!canEdit} label="Zone pincodes" /></div>
          </div>
          {canEdit && <button type="button" onClick={remove} className="h-9 px-3 rounded-xl border border-slate-200 bg-white font-bold text-slate-600 inline-flex items-center gap-1.5 hover:text-[#991B1B]"><Trash2 className="w-3.5 h-3.5" /> Remove zone</button>}
        </div>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block"><span className="lf-label">New zone name</span>
            <input className="lf-text w-56" maxLength={80} placeholder="e.g. Periyakulam Zone" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
          </label>
          <div className="w-72 max-w-full"><span className="lf-label">Its pincodes</span>
            <div className="relative"><PincodePicker list={list} selected={pins} onChange={(next) => { setPins(next); setError(""); }} cityChosen label="New zone pincodes" /></div>
          </div>
          <button type="button" onClick={add} className="h-9 px-3 rounded-xl bg-slate-900 text-white font-bold inline-flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add zone</button>
        </div>
      )}
      {suggested && <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200" title="Worked out from the district's towns. Check their PIN codes: a zone is saved when you give it a rate or change it.">Suggested zones</span>}
      {error && <p className="text-[11px] font-semibold text-[#991B1B]" role="alert">{error}</p>}
    </div>
  );
}
