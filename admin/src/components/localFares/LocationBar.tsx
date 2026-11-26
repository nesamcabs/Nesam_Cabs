import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { GST_STATES } from "../../domain/gstStates";
import { DISTRICTS_BY_STATE } from "../../domain/pincodeDistricts";
import type { AreaEntry } from "../../domain/pincodes";
import type { Coverage, DistrictGeo } from "../../domain/localPricing";
import { selectClass } from "./parts";

export interface PinOption { pin: string; label: string }

/** State → District → Service zone → Area / Village → PIN code, with PIN search and the district's service coverage. */
export default function LocationBar({ lead, state, district, zoneId, areaKey, pin, geo, byDistrict, listed, pins, areaLabel, loading, coverage, canEdit, onState, onDistrict, onZone, onArea, onPin, onFound, onCoverage }: {
  /** Shown at the start of the top row (the service switch). */
  lead: ReactNode;
  state: string; district: string; zoneId: string; areaKey: string;
  /** The chosen PIN code, or that of the chosen area. */
  pin: string;
  geo: DistrictGeo;
  /** Every district of the state with its areas (for PIN search). */
  byDistrict: Record<string, AreaEntry[]>;
  /** Areas of the chosen zone and PIN code. */
  listed: AreaEntry[];
  /** PIN codes of the chosen zone. */
  pins: PinOption[];
  areaLabel: (a: AreaEntry) => string;
  loading: boolean;
  coverage: Required<Coverage>; canEdit: boolean;
  onState: (code: string) => void; onDistrict: (name: string) => void; onZone: (id: string) => void; onArea: (key: string) => void; onPin: (pin: string) => void;
  onFound: (district: string, areaKey: string) => void;
  onCoverage: (key: keyof Coverage, on: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    if (search.length < 3) return [];
    return Object.entries(byDistrict).flatMap(([name, areas]) => areas.filter((a) => a.pin.startsWith(search)).map((area) => ({ district: name, area })))
      .sort((a, b) => a.area.pin.localeCompare(b.area.pin) || a.area.name.localeCompare(b.area.name));
  }, [search, byDistrict]);
  const shown = matches.slice(0, 200);
  const pick = (m: (typeof matches)[number]) => { onFound(m.district, m.area.key); setSearch(""); setOpen(false); };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-2xs space-y-4" aria-label="Location">
      <div className="lf-between gap-3">
        {lead}
        <div className="relative w-full lf-search">
          <div className="flex items-center h-9 px-3 rounded-xl border border-slate-200 bg-slate-50/70 focus-within:bg-white focus-within:border-[#991B1B] gap-2">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input type="text" inputMode="numeric" maxLength={6} value={search} aria-label="Search PIN" placeholder="Search PIN..." className="lf-bare w-full font-semibold"
              onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)}
              onChange={(e) => { setSearch(e.target.value.replace(/\D/g, "").slice(0, 6)); setOpen(true); }}
              onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) pick(matches[0]); if (e.key === "Escape") setOpen(false); }} />
          </div>
          {open && search.length >= 3 && (
            <div className="absolute right-0 left-0 top-[calc(100%+6px)] z-30 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
              <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase text-slate-400">
                {matches.length ? `Matched Areas (${matches.length})${matches.length > shown.length ? " · type more digits" : ""}` : "No area with this PIN"}
              </div>
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {shown.map((m) => (
                  <button key={`${m.district}:${m.area.key}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)} className="w-full px-3 py-2 text-left hover:bg-red-50/40 flex items-center justify-between gap-2 text-xs">
                    <span>
                      <span className="block font-bold text-slate-900">{areaLabel(m.area)}</span>
                      <span className="block text-[10px] text-slate-500">{m.district}</span>
                    </span>
                    <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">{m.area.pin}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lf-five">
        <label className="block"><span className="lf-label">State</span>
          <select className={selectClass} value={state} onChange={(e) => onState(e.target.value)}>
            {GST_STATES.filter(([code]) => DISTRICTS_BY_STATE[code]?.length).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">District</span>
          <select className={selectClass} value={district} onChange={(e) => onDistrict(e.target.value)}>
            {(DISTRICTS_BY_STATE[state] ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">Service zone</span>
          <select className={selectClass} value={zoneId} onChange={(e) => onZone(e.target.value)}>
            <option value="">All zones ({geo.zones.length})</option>
            {geo.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">Area / Village</span>
          <select className={selectClass} value={areaKey} disabled={loading} onChange={(e) => onArea(e.target.value)}>
            <option value="">{loading ? "Loading areas…" : `All mapped areas (${listed.length})`}</option>
            {listed.map((a) => <option key={a.key} value={a.key}>{areaLabel(a)}</option>)}
          </select>
        </label>
        <label className="block"><span className="lf-label">PIN code</span>
          <select className={`${selectClass} font-mono`} value={pin} disabled={loading} onChange={(e) => onPin(e.target.value)}>
            <option value="">All PIN codes ({pins.length})</option>
            {pins.map((p) => <option key={p.pin} value={p.pin}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <div className="px-3.5 py-2 rounded-xl bg-slate-50/90 border border-slate-200/70 flex flex-wrap items-center gap-2.5 text-xs">
        <span className="font-semibold text-slate-700">Service coverage</span>
        <span className="px-2 py-0.5 rounded-md bg-red-50 text-[#991B1B] font-bold text-[11px] border border-red-200/70">{listed.length} mapped areas</span>
        {(["local", "outstation"] as const).map((key) => (
          <button key={key} type="button" role="switch" aria-checked={coverage[key]} disabled={!canEdit} onClick={() => onCoverage(key, !coverage[key])}
            title={`${coverage[key] ? "Switch off" : "Switch on"} ${key} trips picked up anywhere in ${district} district`}
            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors ${coverage[key] ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
            {key === "local" ? "Local" : "Outstation"}: {coverage[key] ? "ON" : "OFF"}
          </button>
        ))}
      </div>
    </section>
  );
}
