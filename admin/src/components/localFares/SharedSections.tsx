import { useState } from "react";
import { Moon, Plus, Sliders, Tag, Trash2, Zap } from "lucide-react";
import { MAX_CORRIDORS, MAX_PEAK_RULES, WEEKDAYS, type LocalSettings, type PeakChargeMode, type PeakRule, type TollCorridor, type TollSource } from "../../domain/localPricing";
import { Accordion, NumberBox, hourLabel } from "./parts";

export interface AreaOption { pin: string; label: string }
type Open = "peak" | "additional" | "night" | "display" | null;

const check = "rounded border-slate-300 lf-check";

/** Peak hours, additional charges, night allowance and GST: one setting for every district of the brand. */
export default function SharedSections({ settings, canEdit, areas, onChange, onUseShared, strike }: {
  settings: LocalSettings; canEdit: boolean;
  /** PIN codes offered for mapped toll routes (the open district's, plus any already mapped). */
  areas: AreaOption[];
  onChange: (next: LocalSettings) => void;
  /** Set when the brand has its own settings: hands it back to the All brands ones. */
  onUseShared?: () => void;
  /** Hourly Rental: the percentage shown as a struck-out higher price in the customer apps. */
  strike?: { value: string; inherited: number | undefined; onChange: (value: string) => void };
}) {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (k: Exclude<Open, null>) => setOpen((o) => (o === k ? null : k));
  const { peak, additional: add, night, gst } = settings;
  const setPeak = (p: Partial<LocalSettings["peak"]>) => onChange({ ...settings, peak: { ...peak, ...p } });
  const setRule = (id: string, p: Partial<PeakRule>) => setPeak({ rules: peak.rules.map((r) => (r.id === id ? { ...r, ...p } : r)) });
  const setAdd = (p: Partial<LocalSettings["additional"]>) => onChange({ ...settings, additional: { ...add, ...p } });
  const setCorridor = (id: string, p: Partial<TollCorridor>) => setAdd({ corridors: add.corridors.map((c) => (c.id === id ? { ...c, ...p } : c)) });
  const areaName = (pin: string) => areas.find((a) => a.pin === pin)?.label ?? pin;
  const overlapping = peak.rules.filter((r) => r.active).some((a, i, all) => all.some((b, j) => j > i && a.startHour < b.endHour && b.startHour < a.endHour));

  return (
    <div className="space-y-2.5">
      {onUseShared && (
        <div className="flex justify-end">
          <button type="button" disabled={!canEdit} onClick={onUseShared} className="text-[11px] font-bold text-[#991B1B] hover:underline">Use the All brands settings</button>
        </div>
      )}

      <Accordion open={open === "peak"} onToggle={() => toggle("peak")} icon={<Zap className="w-4 h-4 text-amber-600" />} title="Scheduled peak-hour pricing (IST)"
        badge={`Local: ${peak.localEnabled ? "ON" : "OFF"} • Rental: ${peak.rentalEnabled ? "ON" : "OFF"}`}>
        <fieldset disabled={!canEdit} className="px-5 pb-5 pt-3 space-y-4 text-xs min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {([["localEnabled", "Local Peak"], ["rentalEnabled", "Rental Peak"]] as const).map(([key, label]) => (
                <button key={key} type="button" role="switch" aria-checked={peak[key]} onClick={() => setPeak({ [key]: !peak[key] })}
                  className={`px-3 py-1.5 rounded-xl font-bold border transition-all ${peak[key] ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                  {label}: {peak[key] ? "ON" : "OFF"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Peak weekdays">
              {WEEKDAYS.map((day) => {
                const on = peak.weekdays.includes(day);
                return (
                  <button key={day} type="button" aria-pressed={on} onClick={() => setPeak({ weekdays: WEEKDAYS.filter((d) => (d === day ? !on : peak.weekdays.includes(d))) })}
                    className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${on ? "bg-[#991B1B] text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200/70"}`}>
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5">
            {peak.rules.map((r) => (
              <div key={r.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <input type="checkbox" className={check} aria-label={`Use ${r.label}`} checked={r.active} onChange={(e) => setRule(r.id, { active: e.target.checked })} />
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      <select aria-label={`${r.label} starts`} className="lf-select" value={r.startHour} onChange={(e) => setRule(r.id, { startHour: Number(e.target.value) })}>
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                      </select>
                      <span className="font-bold text-slate-900">–</span>
                      <select aria-label={`${r.label} ends`} className="lf-select" value={r.endHour} onChange={(e) => setRule(r.id, { endHour: Number(e.target.value) })}>
                        {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{h === 24 ? "12:00 AM (midnight)" : hourLabel(h)}</option>)}
                      </select>
                      <span className="font-bold text-slate-900">IST</span>
                    </div>
                    <input aria-label="Peak window name" className="lf-bare text-[11px] text-slate-500 w-40" maxLength={60} value={r.label} onChange={(e) => setRule(r.id, { label: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select aria-label={`${r.label} charge type`} className="lf-select" value={r.chargeMode} onChange={(e) => setRule(r.id, { chargeMode: e.target.value as PeakChargeMode })}>
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed">Fixed Extra (₹)</option>
                  </select>
                  <div className="flex items-center gap-1">
                    <span className="text-slate-400 font-bold">+</span>
                    <NumberBox label={`${r.label} extra charge`} className="w-16 text-center" max={r.chargeMode === "percentage" ? 100 : undefined} value={r.value} onChange={(n) => setRule(r.id, { value: n })} />
                    <span className="text-slate-500 font-semibold">{r.chargeMode === "percentage" ? "%" : "₹"}</span>
                  </div>
                  <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
                    <span className="text-[11px] text-slate-500">Max cap ₹</span>
                    <NumberBox label={`${r.label} maximum extra`} className="w-16 text-center lf-red" value={r.maxCap} onChange={(n) => setRule(r.id, { maxCap: n })} />
                  </div>
                  {peak.rules.length > 1 && <button type="button" aria-label={`Remove ${r.label}`} onClick={() => setPeak({ rules: peak.rules.filter((x) => x.id !== r.id) })} className="p-1.5 rounded-lg text-slate-400 hover:text-[#991B1B]"><Trash2 className="w-3.5 h-3.5" /></button>}
                </div>
              </div>
            ))}
          </div>
          {peak.rules.length < MAX_PEAK_RULES && (
            <button type="button" onClick={() => setPeak({ rules: [...peak.rules, { id: `peak_${Date.now().toString(36)}`, label: "Extra Peak", startHour: 12, endHour: 14, chargeMode: "percentage", value: 0, maxCap: 0, active: false }] })}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#991B1B] hover:underline"><Plus className="w-3.5 h-3.5" /> Add peak window</button>
          )}
          {overlapping && <p className="text-[11px] font-semibold text-[#991B1B]" role="alert">Two ticked windows overlap. A trip can have only one peak window.</p>}
        </fieldset>
      </Accordion>

      <Accordion open={open === "additional"} onToggle={() => toggle("additional")} icon={<Sliders className="w-4 h-4 text-slate-500" />} title="Additional charges">
        <fieldset disabled={!canEdit} className="px-5 pb-4 pt-3 space-y-3 text-xs min-w-0">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className={check} checked={add.autoToll} onChange={(e) => setAdd({ autoToll: e.target.checked })} />
                <span className="font-bold text-slate-800">Auto-add local route toll</span>
              </label>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-slate-500 font-semibold">Fallback / Rate ₹</span>
                <NumberBox label="Fallback toll amount" className="w-20" disabled={!add.autoToll || add.tollSource === "at_actuals"} value={add.tollAmount} onChange={(n) => setAdd({ tollAmount: n })} />
              </div>
            </div>
            <label className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 text-[11px]">
              <span className="font-semibold text-slate-600">How system gets toll amount:</span>
              <select className="lf-select font-bold" value={add.tollSource} onChange={(e) => setAdd({ tollSource: e.target.value as TollSource })}>
                <option value="mapped_rate">Mapped route / plaza rate table</option>
                <option value="route_api">Live route toll API (with fallback ₹)</option>
                <option value="at_actuals">At actuals (receipt at trip end)</option>
              </select>
            </label>
            {add.autoToll && add.tollSource === "mapped_rate" && (
              <div className="space-y-1.5 pt-1">
                {add.corridors.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-1.5">
                    {(["fromPin", "toPin"] as const).map((end) => (
                      <select key={end} aria-label={end === "fromPin" ? "Toll route from" : "Toll route to"} className="lf-select max-w-44" value={c[end]} onChange={(e) => setCorridor(c.id, { [end]: e.target.value })}>
                        <option value="">{end === "fromPin" ? "From area" : "To area"}</option>
                        {c[end] && !areas.some((a) => a.pin === c[end]) ? <option value={c[end]}>{c[end]}</option> : null}
                        {areas.map((a) => <option key={a.pin} value={a.pin}>{a.label}</option>)}
                      </select>
                    ))}
                    <input aria-label="Toll plaza name" className="lf-text w-36" maxLength={80} placeholder="Plaza name" value={c.name} onChange={(e) => setCorridor(c.id, { name: e.target.value })} />
                    <span className="text-slate-500">₹</span>
                    <NumberBox label={`Toll between ${areaName(c.fromPin)} and ${areaName(c.toPin)}`} className="w-20" placeholder={add.tollAmount ? String(add.tollAmount) : "0"} value={c.amount} onChange={(n) => setCorridor(c.id, { amount: n })} />
                    <button type="button" aria-label="Remove toll route" onClick={() => setAdd({ corridors: add.corridors.filter((x) => x.id !== c.id) })} className="p-1.5 rounded-lg text-slate-400 hover:text-[#991B1B]"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {add.corridors.length < MAX_CORRIDORS && (
                  <button type="button" onClick={() => setAdd({ corridors: [...add.corridors, { id: `toll_${Date.now().toString(36)}`, fromPin: "", toPin: "", name: "", amount: 0 }] })}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#991B1B] hover:underline"><Plus className="w-3.5 h-3.5" /> Add toll route</button>
                )}
              </div>
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className={check} checked={add.airportEnabled} onChange={(e) => setAdd({ airportEnabled: e.target.checked })} />
              <span className="font-bold text-slate-800">Airport entry charge</span>
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 font-semibold">Entry ₹</span>
              <NumberBox label="Airport entry charge" className="w-20" disabled={!add.airportEnabled} value={add.airportFee} onChange={(n) => setAdd({ airportFee: n })} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className={check} checked={add.tollsAtActuals} onChange={(e) => setAdd({ tollsAtActuals: e.target.checked })} />
              <span className="font-medium text-slate-700">Other tolls at actuals</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className={check} checked={add.parkingAtActuals} onChange={(e) => setAdd({ parkingAtActuals: e.target.checked })} />
              <span className="font-medium text-slate-700">Parking charges at actuals</span>
            </label>
          </div>
        </fieldset>
      </Accordion>

      <Accordion open={open === "night"} onToggle={() => toggle("night")} icon={<Moon className="w-4 h-4 text-slate-500" />} title="Night allowance">
        <fieldset disabled={!canEdit} className="px-5 pb-4 pt-3 text-xs min-w-0">
          <label className="flex flex-wrap items-center gap-3" title="Pickup & Drop only. At 0%, the common ₹ night allowance applies; rentals always use the common one.">
            <span className="text-slate-600">Pickup &amp; Drop, 10:00 PM – 05:00 AM</span>
            <NumberBox label="Night allowance percent" className="w-16" max={100} value={night.percent} onChange={(n) => onChange({ ...settings, night: { percent: n } })} />
            <span className="text-slate-500">% extra</span>
          </label>
        </fieldset>
      </Accordion>

      <Accordion open={open === "display"} onToggle={() => toggle("display")} icon={<Tag className="w-4 h-4 text-slate-500" />} title={`Price display & GST (${gst.percent}%${gst.mode === "included" ? " included" : ""})`}>
        <fieldset disabled={!canEdit} className="px-5 pb-4 pt-3 space-y-3 text-xs min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-slate-600 w-28">GST</span>
            <NumberBox label="GST percent" className="w-16" max={40} value={gst.percent} onChange={(n) => onChange({ ...settings, gst: { ...gst, percent: n } })} />
            <span className="text-slate-500">%</span>
            <select aria-label="How GST is shown" className="lf-select" value={gst.mode} onChange={(e) => onChange({ ...settings, gst: { ...gst, mode: e.target.value === "included" ? "included" : "excluded" } })}>
              <option value="excluded">Added on top of the fare</option>
              <option value="included">Already included in the fare</option>
            </select>
          </div>
          {strike && (
            <label className="flex flex-wrap items-center gap-3" title="Shown crossed out above the real fare in the customer apps. The fare, GST and partner pay do not change.">
              <span className="text-slate-600 w-28">Strike-out price</span>
              <input type="number" inputMode="decimal" min={0} max={300} step="0.5" aria-label="Strike-out price percent" className="lf-num w-16" value={strike.value}
                placeholder={strike.inherited ? String(strike.inherited) : "None"} onChange={(e) => strike.onChange(e.target.value)} />
              <span className="text-slate-500">% higher</span>
            </label>
          )}
        </fieldset>
      </Accordion>
    </div>
  );
}
