import type { LocalClass, LocalRuleField, Party, RentalRowField, Scope } from "../../domain/localPricing";
import { LOCAL_HOURS } from "../../domain/localPricing";
import { clearRow, clearRules, editRow, editRule, readRow, readRule, sourceLabel, unpairedRules, type Cell, type EditContext, type Level } from "./model";
import { NumberBox } from "./parts";

export interface LocalVehicle { cls: LocalClass; name: string; subtitle: string }

function SourceBadge({ cell, brand, canEdit, onClear, clearText }: { cell: Pick<Cell<object>, "source" | "incomplete" | "own">; brand: string; canEdit: boolean; onClear: (() => void) | null; clearText: string }) {
  const text = sourceLabel(cell, brand);
  const tone = text === "Incomplete" ? "bg-red-50 text-red-700 border-red-200"
    : text === "Not set" ? "bg-slate-100 text-slate-500 border-slate-200"
    : text === "Mixed" ? "bg-blue-50 text-blue-700 border-blue-200"
    : text.startsWith("Area") ? "bg-purple-50 text-purple-800 border-purple-200"
    : text.startsWith("Zone") ? "bg-amber-50 text-amber-800 border-amber-200"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${tone}`}>{text}</span>
      {canEdit && onClear && cell.own !== "none" ? <button type="button" onClick={(e) => { e.stopPropagation(); onClear(); }} className="text-[10px] font-bold text-slate-500 hover:text-[#991B1B] hover:underline">{clearText}</button> : null}
    </span>
  );
}

/** Local Pickup & Drop: one row per vehicle. */
export function RideTable({ context, vehicles, levels, party, tab, canEdit, selected, onSelect, onChange }: {
  context: EditContext; vehicles: LocalVehicle[]; levels: Level[]; party: Party; tab: Scope; canEdit: boolean;
  selected: LocalClass; onSelect: (cls: LocalClass) => void; onChange: (next: EditContext["mine"]) => void;
}) {
  const unpaired = unpairedRules(context, levels, vehicles.map((v) => v.cls));
  return (
    <>
      <div className="overflow-x-auto border border-slate-200/80 rounded-xl">
        <table className="w-full text-left border-collapse lf-table">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/90 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <th>Vehicle</th><th>Min fare ₹</th><th>Base fare ₹</th><th>Included km</th><th>Rate beyond min km</th><th>Free wait / ₹/min</th><th className="text-right">Rate source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {vehicles.map((v) => {
              const cell = readRule(context, party, v.cls, levels);
              const other = readRule(context, party === "customer" ? "partner" : "customer", v.cls, levels);
              const box = (field: LocalRuleField, label: string, className: string, integer?: boolean) => (
                <NumberBox key={`${tab}:${party}:${v.cls}:${field}:${levels.map((l) => ("id" in l ? l.id : "d")).join()}`} label={`${v.name} ${label}`} className={className} integer={integer} disabled={!canEdit}
                  placeholder={cell.mixed.includes(field) ? "Mixed" : "0"} value={cell.value[field]} onChange={(n) => onChange(editRule(context, party, v.cls, levels, field, n))} />
              );
              // "Clear" removes both sides typed here, so a vehicle never keeps a half override.
              const shown = cell.own === "none" && other.own !== "none" ? { ...cell, own: other.own } : cell;
              return (
                <tr key={v.cls} onClick={() => onSelect(v.cls)} className={`cursor-pointer transition-colors ${selected === v.cls ? "bg-red-50/25" : "hover:bg-slate-50/80"}`}>
                  <td>
                    <p className="font-bold text-slate-900">{v.name}</p>
                    <p className="text-[10px] text-slate-400">{v.subtitle}</p>
                    {unpaired.includes(v.cls) ? <p className="text-[10px] font-semibold text-amber-700">Needs customer fare and payout</p> : null}
                  </td>
                  <td>{box("minimumFare", "minimum fare", "w-16")}</td>
                  <td>{box("baseFare", "base fare", "w-16")}</td>
                  <td>{box("includedKm", "included km", "w-14")}</td>
                  <td>{box("extraPerKm", "rate beyond included km", "w-16 lf-red")}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {box("freeWaitMins", "free waiting minutes", "w-11 text-center", true)}
                      <span className="text-slate-400 whitespace-nowrap">m / ₹</span>
                      {box("waitPerMin", "charge per minute after free wait", "w-12 text-center")}
                    </div>
                  </td>
                  <td className="text-right">
                    <SourceBadge cell={shown} brand={context.brand} canEdit={canEdit} clearText={tab === "district" ? "Clear" : "Use inherited"} onClear={() => onChange(clearRules(context, v.cls, levels))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Hourly Rental: packages of one vehicle, 1 to 15 hours. */
export function RentalTable({ context, levels, vehicle, tab, canEdit, selectedHours, onSelectHours, onChange }: {
  context: EditContext; levels: Level[]; vehicle: LocalVehicle; tab: Scope; canEdit: boolean;
  selectedHours: number; onSelectHours: (h: number) => void; onChange: (next: EditContext["mine"]) => void;
}) {
  return (
    <div className="overflow-auto border border-slate-200/80 rounded-xl max-h-[430px]">
      <table className="w-full text-left border-collapse lf-table lf-rental">
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <th>Package</th><th>Customer fare ₹</th><th>Partner payout ₹</th><th>Included km</th><th>Extra km ₹</th><th>Extra hour ₹</th><th className="text-right">Rate source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-xs">
          {LOCAL_HOURS.map((h) => {
            const cell = readRow(context, vehicle.cls, h, levels);
            const box = (field: RentalRowField, label: string, className: string) => (
              <NumberBox key={`${tab}:${vehicle.cls}:${h}:${field}:${levels.map((l) => ("id" in l ? l.id : "d")).join()}`} label={`${vehicle.name} ${h} hour ${label}`} className={className} disabled={!canEdit}
                placeholder={cell.mixed.includes(field) ? "Mixed" : "0"} value={cell.value[field]} onChange={(n) => onChange(editRow(context, vehicle.cls, h, levels, field, n))} />
            );
            return (
              <tr key={h} onClick={() => onSelectHours(h)} className={`cursor-pointer transition-colors ${selectedHours === h ? "bg-red-50/30" : "hover:bg-slate-50/80"}`}>
                <td className="font-bold text-slate-900 whitespace-nowrap">{h} {h === 1 ? "hour" : "hours"}</td>
                <td>{box("customerFare", "customer fare", "w-20")}</td>
                <td>{box("partnerPayout", "partner payout", "w-20 lf-green")}</td>
                <td>{box("includedKm", "included km", "w-16")}</td>
                <td>{box("extraKmRate", "extra km rate", "w-16")}</td>
                <td>{box("extraHourRate", "extra hour rate", "w-16")}</td>
                <td className="text-right"><SourceBadge cell={cell} brand={context.brand} canEdit={canEdit} clearText={tab === "district" ? "Clear" : "Use inherited"} onClear={() => onChange(clearRow(context, vehicle.cls, h, levels))} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
