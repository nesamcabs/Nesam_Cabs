import { useState } from "react";
import { Calculator, Zap } from "lucide-react";
import type { AreaEntry } from "../../domain/pincodes";
import { LOCAL_HOURS, WEEKDAYS, areaSlug, istParts, matchPeak, type DistrictGeo, type FaresByBrand, type LocalClass, type LocalSettings, type Weekday } from "../../domain/localPricing";
import type { LocalVehicle } from "./RateTables";
import { testQuote, type CommonNight, type PlatformRules } from "./quotePreview";
import { NumberBox, hourLabel, rupees, selectClass } from "./parts";

const DAY = 86_400_000;
/** The date (YYYY-MM-DD) in India `offset` days from now. */
const istDay = (offset: number) => new Date(Date.now() + 330 * 60000 + offset * DAY).toISOString().slice(0, 10);

export default function TestQuote({ service, district, fares, brand, geo, settings, areas, areaLabel, vehicles, cls, areaKey, hours, platform, night, unsaved, onCls, onArea, onHours }: {
  service: "ride" | "rental"; district: string; fares: FaresByBrand; brand: string; geo: DistrictGeo; settings: LocalSettings;
  areas: AreaEntry[]; areaLabel: (a: AreaEntry) => string; vehicles: LocalVehicle[]; cls: LocalClass; areaKey: string; hours: number; platform: PlatformRules; night: CommonNight;
  /** The preview includes changes that are not saved yet. */
  unsaved: boolean;
  onCls: (c: LocalClass) => void; onArea: (key: string) => void; onHours: (h: number) => void;
}) {
  const [km, setKm] = useState(8);
  const [hour, setHour] = useState(8);
  const [dayOffset, setDayOffset] = useState(0);
  const [waitMins, setWaitMins] = useState(0);
  const [routeHasToll, setRouteHasToll] = useState(false);
  const [airport, setAirport] = useState(false);

  const date = istDay(dayOffset);
  const pickupMs = Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+05:30`);
  const { weekday } = istParts(pickupMs);
  const dateText = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  // Until an area is chosen the district's own town is tested.
  const area = areas.find((a) => a.key === areaKey) ?? areas.find((a) => areaSlug(a.name) === areaSlug(district)) ?? areas[0];
  const vehicle = vehicles.find((v) => v.cls === cls) ?? vehicles[0];
  const result = !area || !vehicle ? null : testQuote({
    service, fares, brand, geo, settings, district, cls: vehicle.cls, vehicle: vehicle.name, pin: area.pin, areaNames: [areaSlug(area.name)], km, hours, waitMins, pickupMs, routeHasToll, airport, platform, night,
  });
  const peakService = service === "ride" ? "local" : "rental";
  /** The next date (today or later) that falls on a weekday. */
  const pickWeekday = (day: Weekday) => {
    for (let n = 0; n < 7; n++) if (istParts(Date.parse(`${istDay(n)}T12:00:00+05:30`)).weekday === day) return setDayOffset(n);
  };

  return (
    <aside className="lf-aside bg-white rounded-2xl border border-slate-200/90 p-5 shadow-2xs space-y-4" aria-label="Test quote">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-red-50 text-[#991B1B] flex items-center justify-center"><Calculator className="w-4 h-4" /></div>
        <h2 className="text-sm font-bold text-slate-900">Test quote</h2>
        {unsaved && <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">Includes unsaved changes</span>}
      </div>

      <div className="space-y-3 text-xs">
        <label className="block"><span className="lf-label">Pickup area</span>
          <select className={selectClass} value={area?.key ?? ""} onChange={(e) => onArea(e.target.value)}>
            {areas.map((a) => <option key={a.key} value={a.key}>{areaLabel(a)} · {a.pin}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="block"><span className="lf-label">Vehicle</span>
            <select className={selectClass} value={vehicle?.cls ?? ""} onChange={(e) => onCls(e.target.value as LocalClass)}>
              {vehicles.map((v) => <option key={v.cls} value={v.cls}>{v.name}</option>)}
            </select>
          </label>
          {service === "ride" ? (
            <div><span className="lf-label">Distance (km)</span><NumberBox label="Distance in km" className="w-full h-9" value={km} onChange={setKm} /></div>
          ) : (
            <label className="block"><span className="lf-label">Package hours</span>
              <select className={selectClass} value={hours} onChange={(e) => onHours(Number(e.target.value))}>
                {LOCAL_HOURS.map((h) => <option key={h} value={h}>{h} {h === 1 ? "hour" : "hours"}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="lf-when">
          <div>
            <div className="flex items-center justify-between gap-1 mb-1">
              <span className="lf-label lf-label--flat">Day &amp; time</span>
              <button type="button" onClick={() => setDayOffset(dayOffset === 0 ? 1 : 0)} className="text-[10px] font-bold text-[#991B1B] hover:underline whitespace-nowrap">
                {dayOffset === 0 ? "Today" : dayOffset === 1 ? "Tomorrow" : "Later"} ({weekday})
              </button>
            </div>
            <select className={selectClass} aria-label="Pickup time" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)} ({matchPeak(settings, peakService, weekday, h) ? "Peak" : "Normal"})</option>)}
            </select>
          </div>
          {service === "ride" ? (
            <div><span className="lf-label">Total wait (mins)</span><NumberBox label="Total waiting minutes" className="w-full h-9" integer max={1440} value={waitMins} onChange={setWaitMins} /></div>
          ) : (
            <label className="block"><span className="lf-label">Day of week</span>
              <select className={selectClass} value={weekday} onChange={(e) => pickWeekday(e.target.value as Weekday)}>
                {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          )}
        </div>
        {service === "ride" && (
          <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px]">
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700"><input type="checkbox" className="lf-check" checked={routeHasToll} onChange={(e) => setRouteHasToll(e.target.checked)} /><span>Route has toll</span></label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer font-semibold text-slate-700"><input type="checkbox" className="lf-check" checked={airport} onChange={(e) => setAirport(e.target.checked)} /><span>Airport pickup/drop</span></label>
          </div>
        )}
      </div>

      <dl className="pt-3 border-t border-slate-100 space-y-1.5 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Pickup schedule</dt><dd className="font-bold text-slate-800 text-right">{dateText} ({weekday})</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Matched area</dt><dd className="font-bold text-slate-900 text-right">{area ? `${area.name} (${area.pin})` : "—"}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-slate-500">Applied rate</dt><dd className="font-bold text-[#991B1B] text-right">{result?.ok ? result.rateLabel : "—"}</dd></div>
      </dl>

      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2 text-xs" aria-live="polite">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Customer Quote Breakdown</p>
        {!result ? <p className="text-slate-500">Loading areas…</p> : !result.ok ? <p className="font-semibold text-amber-800">{result.message}</p> : (
          <>
            {result.lines.map((l) => l.tone === "peak" ? (
              <div key={l.key} className="flex justify-between items-center gap-2 text-amber-900 bg-amber-50 border border-amber-200/80 px-2.5 py-1.5 rounded-lg font-bold">
                <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5 text-amber-600 shrink-0" /> {l.label}</span><span className="whitespace-nowrap">+{rupees(l.amount)}</span>
              </div>
            ) : (
              <div key={l.key} className={`flex justify-between gap-2 ${l.tone === "minimum" ? "text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-1 rounded" : "text-slate-600"}`}>
                <span>{l.label}</span><span className="font-semibold text-slate-900 whitespace-nowrap">{l.key === "base" || l.key === "package" ? "" : "+"}{rupees(l.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between text-slate-600">
              <span>GST ({settings.gst.percent}%{settings.gst.mode === "included" ? ", included" : ""})</span>
              <span className="font-semibold text-slate-900">{settings.gst.mode === "included" ? "" : "+"}{rupees(result.gst)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
              <span className="font-bold text-slate-900">Estimated Total</span>
              <span className="text-lg font-extrabold text-[#991B1B]">{rupees(result.total)}</span>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
