import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MasterLocation } from "../../types";
import { GST_STATES } from "../../domain/gstStates";
import {
  areasOf, breadcrumbOf, changeSel, districtsOf, indexLocations, locationsWithPin, pinsOfLocation, selOfLocation, stateCodeOf, stateNameOf, zonesOf,
  type Indexed, type LocSel,
} from "../../domain/locationHierarchy";
import { districtOfPinLoaded, loadStatePins, pinOffices, type PinOffice } from "../../domain/pincodes";
import { Icon } from "../ui";

/**
 * The shared location selector:  State → District → Service zone → Area / Village, with PIN search and the PIN display.
 * Used by Local & Rental pricing, Booking rules (places & cabs, price changes, date-based rules) and Fixed route fares; each screen
 * keeps its own selection and saves its own scope. Depth and the broad "all" choices are set per screen.
 *   - depth "state": State only.   - "district": State, District.   - "zone": + Service zone.   - "area": + Area / Village.
 * Broad choices are configuration scopes; when a screen needs one real place (`requireArea`), "All mapped areas" is not offered.
 */
export interface SelectorProps {
  value: LocSel;
  onChange: (next: LocSel) => void;
  locations: MasterLocation[];
  depth?: "state" | "district" | "zone" | "area";
  /** Labels of the broad choices. Absent label = that level must be chosen ("Select …"). */
  broad?: { state?: string; district?: string; zone?: string; area?: string };
  /** PIN search: "multi" lets rule screens pick several PINs (one place each, as before); "locate" only jumps to a saved location. */
  pinSearch?: "multi" | "locate" | false;
  /** Show the breadcrumb line (workspace header style). */
  breadcrumb?: boolean;
  /** Extra control at the end of the row, e.g. the "Add location" button. */
  action?: ReactNode;
  disabled?: boolean;
  label?: string;
  /** Opens Locations (empty states). */
  onManageLocations?: () => void;
  /** Card chrome (workspace) or a plain row inside an existing card (rule screens). */
  variant?: "card" | "row";
  className?: string;
}

const fieldCls = "flex min-w-0 flex-col gap-1";
const labelCls = "text-[12px] font-semibold text-slate-700";

export default function LocationScopeSelector({
  value, onChange, locations, depth = "area", broad = {}, pinSearch = "locate", breadcrumb = false, action, disabled, label = "Location", onManageLocations, variant = "card", className = "",
}: SelectorProps) {
  // The chosen state's India Post file is loaded so records with only a pincode still land in the right district.
  const [pinsReady, setPinsReady] = useState(0);
  useEffect(() => {
    if (!value.state) return undefined;
    let live = true;
    void loadStatePins(value.state).then(() => { if (live) setPinsReady((n) => n + 1); });
    return () => { live = false; };
  }, [value.state]);
  const index: Indexed[] = useMemo(() => indexLocations(locations, districtOfPinLoaded), [locations, pinsReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch: Partial<LocSel>) => onChange(changeSel(value, patch, index));

  const savedStates = useMemo(() => new Set(index.map((x) => x.state).filter(Boolean)), [index]);
  const districts = useMemo(() => (value.state ? districtsOf(value.state, index) : []), [value.state, index]);
  const zones = useMemo(() => (value.district ? zonesOf(index, value.state, value.district, value.zoneId) : []), [index, value.state, value.district, value.zoneId]);
  const areas = useMemo(() => (value.district ? areasOf(index, value.state, value.district, value.zoneId, value.locationId) : []), [index, value.state, value.district, value.zoneId, value.locationId]);
  const area = index.find((x) => x.loc.id === value.locationId)?.loc;
  const zone = index.find((x) => x.loc.id === value.zoneId)?.loc;
  const shownPins = value.pins.length ? value.pins : area ? pinsOfLocation(area) : zone ? pinsOfLocation(zone) : [];
  const show = (d: "district" | "zone" | "area") => ({ state: 0, district: 1, zone: 2, area: 3 })[depth] >= ({ district: 1, zone: 2, area: 3 })[d];
  const crumbs = breadcrumbOf(value, index, { state: broad.state ?? "Select a state", zone: broad.zone ?? "Select zone", area: broad.area ?? "Select area" });

  const selects = (
    <div className={`grid gap-3 ${{ state: "grid-cols-1", district: "grid-cols-1 sm:grid-cols-2", zone: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4", area: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-5" }[depth]}`}>
      <label className={fieldCls}><span className={labelCls}>State</span>
        <select className="ds-select" value={value.state} disabled={disabled} aria-label={`${label}: state`} onChange={(e) => set({ state: e.target.value })}>
          <option value="">{broad.state ?? "Select a state"}</option>
          {GST_STATES.map(([code, name]) => <option key={code} value={code}>{name}{savedStates.has(code) ? "" : ""}</option>)}
        </select>
      </label>
      {show("district") && (
        <label className={fieldCls}><span className={labelCls}>District</span>
          <select className="ds-select" value={value.district} disabled={disabled || !value.state} aria-label={`${label}: district`} onChange={(e) => set({ district: e.target.value })}>
            <option value="">{value.state ? broad.district ?? "Select a district" : "Choose a state first"}</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      )}
      {show("zone") && (
        <label className={fieldCls}><span className={labelCls}>Service zone</span>
          <select className="ds-select" value={value.zoneId} disabled={disabled || !value.district || (!zones.length && !value.zoneId)} aria-label={`${label}: service zone`} onChange={(e) => set({ zoneId: e.target.value })}>
            <option value="">{!value.district ? "Choose a district first" : !zones.length ? "No zones saved" : broad.zone ?? "Select zone"}</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.status !== "Active" ? " (inactive)" : ""}</option>)}
          </select>
        </label>
      )}
      {show("area") && (
        <label className={fieldCls}><span className={labelCls}>Area / Village</span>
          <select className="ds-select" value={value.locationId} disabled={disabled || !value.district || (!areas.length && !value.locationId)} aria-label={`${label}: area or village`} onChange={(e) => set({ locationId: e.target.value })}>
            <option value="">{!value.district ? "Choose a district first" : !areas.length ? "No mapped areas" : broad.area ?? "Select area"}</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type !== "Area / Locality" ? ` · ${a.type}` : ""}{pinsOfLocation(a)[0] ? ` · ${pinsOfLocation(a)[0]}` : ""}{a.status !== "Active" ? " (inactive)" : ""}</option>)}
          </select>
        </label>
      )}
      {(depth === "zone" || depth === "area") && (
        <div className={fieldCls}><span className={labelCls}>PIN code</span>
          <div className="ds-input flex min-h-[38px] items-center gap-1 overflow-hidden bg-slate-50 text-[13px] text-slate-700" aria-label={`${label}: PIN codes`} title={shownPins.join(", ")}>
            {value.pins.length ? value.pins.map((p) => (
              <span key={p} className="inline-flex shrink-0 items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[12px] font-semibold ring-1 ring-slate-200">
                {p}{!disabled && <button type="button" aria-label={`Remove PIN ${p}`} className="text-slate-400 hover:text-red-700" onClick={() => set({ pins: value.pins.filter((x) => x !== p) })}>×</button>}
              </span>
            )) : <span className="truncate">{shownPins.length ? shownPins.slice(0, 3).join(", ") + (shownPins.length > 3 ? ` +${shownPins.length - 3}` : "") : "—"}</span>}
          </div>
        </div>
      )}
    </div>
  );

  const search = pinSearch ? <PinSearch index={index} mode={pinSearch} disabled={disabled} value={value} onPick={onChange} /> : null;
  const noData = value.district && depth !== "state" && depth !== "district" && !zones.length && !areas.length;

  if (variant === "row") {
    return (
      <div className={`grid gap-2 ${className}`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[min(100%,360px)] flex-1">{selects}</div>
          {search && <div className="w-full sm:w-[220px]">{search}</div>}
          {action}
        </div>
        {noData && <EmptyNote onManage={onManageLocations} />}
      </div>
    );
  }
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`} aria-label={label}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        {breadcrumb ? (
          <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[15px] font-bold text-[#b91c1c]">
            <Icon name="map-pin" size={18} />
            {crumbs.map((c, i) => <span key={i} className="flex items-center gap-1.5">{i > 0 && <span className="text-slate-400">/</span>}{c}</span>)}
          </p>
        ) : <span />}
        {search && <div className="w-full sm:w-[300px]">{search}</div>}
      </div>
      {selects}
      {action && <div className="mt-3 flex justify-end">{action}</div>}
      {noData && <EmptyNote onManage={onManageLocations} />}
    </section>
  );
}

function EmptyNote({ onManage }: { onManage?: () => void }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
      <Icon name="info" size={14} /> No service zones or mapped areas are saved for this district yet.
      {onManage && <button type="button" className="fm-linkbtn" onClick={onManage}>Open Locations</button>}
    </p>
  );
}

/**
 * PIN search. A pincode may serve several villages and can sit in records of different zones, so every match is listed with its
 * full hierarchy. Saved Locations records come first (choosing one fills State → Area); India Post offices without a saved record
 * select their district only ("multi" also adds the PIN as its own place). Late answers for an older query are ignored.
 */
function PinSearch({ index, mode, disabled, value, onPick }: { index: Indexed[]; mode: "multi" | "locate"; disabled?: boolean; value: LocSel; onPick: (s: LocSel) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [offices, setOffices] = useState<PinOffice[] | null>(null);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const pin = /^[1-9]\d{5}$/.test(q.trim()) ? q.trim() : "";
  useEffect(() => {
    const mine = ++seq.current;
    setOffices(null);
    if (!pin) return;
    void pinOffices(pin).then((r) => { if (seq.current === mine) setOffices(r); });
  }, [pin]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const saved = pin ? locationsWithPin(pin, index) : [];
  const name = (id?: string) => index.find((x) => x.loc.id === id)?.loc.name;
  const choose = (s: LocSel | null) => { if (s) { onPick(s); setOpen(false); setQ(""); } };

  return (
    <div ref={box} className="relative">
      <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input className="ds-input w-full !pl-9" inputMode="numeric" maxLength={6} placeholder="Search PIN" aria-label="Search PIN" value={q} disabled={disabled}
        onChange={(e) => { setQ(e.target.value.replace(/\D/g, "")); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {open && q && (
        <div className="absolute right-0 z-50 mt-1 max-h-[320px] w-[min(420px,90vw)] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-[13px] shadow-lg" role="listbox" aria-label="PIN matches">
          {!pin ? <p className="px-3 py-2 text-slate-500">Enter all six digits.</p>
            : offices === null ? <p className="px-3 py-2 text-slate-500" role="status">Searching {pin}…</p>
            : !saved.length && !offices.length ? <p className="px-3 py-2 text-slate-500">No location carries PIN {pin}.</p>
            : (
              <>
                {saved.length > 0 && <p className="px-3 pb-1 pt-1.5 text-[11px] font-bold uppercase text-slate-500">Saved locations</p>}
                {saved.map((x) => {
                  const z = x.zone ? null : index.find((i) => i.zone && i.loc.id === selOfLocation(x.loc.id, index)?.zoneId)?.loc;
                  return (
                    <button key={x.loc.id} type="button" role="option" aria-selected={false} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => choose(selOfLocation(x.loc.id, index))}>
                      <strong className="text-slate-800">{x.loc.name}</strong> <span className="text-slate-500">· {x.zone ? "Service zone" : x.loc.type}</span>
                      <small className="block text-slate-500">{[z?.name && `${z.name} (zone)`, x.district || "District not set", stateNameOf(x.state)].filter(Boolean).join(" · ")}</small>
                    </button>
                  );
                })}
                {offices.length > 0 && <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase text-slate-500">India Post offices · {pin}</p>}
                {offices.map((o) => (
                  <button key={`${o.district}|${o.office}`} type="button" role="option" aria-selected={false} className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                    onClick={() => choose(mode === "multi"
                      ? { state: o.state, district: o.district, zoneId: "", locationId: "", pins: value.state === o.state && value.district === o.district ? [...new Set([...value.pins, pin])] : [pin] }
                      : { state: o.state, district: o.district, zoneId: "", locationId: "", pins: [] })}>
                    <strong className="text-slate-800">{o.office}</strong>
                    <small className="block text-slate-500">{o.district} · {stateNameOf(o.state)}{mode === "multi" ? " · add this PIN" : " · selects the district"}</small>
                  </button>
                ))}
                {name(value.locationId) && <p className="border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">Current: {name(value.locationId)}</p>}
              </>
            )}
        </div>
      )}
    </div>
  );
}

export { stateCodeOf };
