import { useRef, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { ArrowLeftRight, ArrowRight, ArrowUpDown, Calculator, Calendar, Clock, Info, LoaderCircle, LocateFixed, MapPin, Minus, Plane, Plus, RotateCcw, Route, X } from "lucide-react";
import { PlaceField, airportSide, type QuickData, type QuickTrip } from "../booking/QuickFare";
import type { PickedPoint } from "../MapLocationPicker";
import { DESK_TABS, addDaysIst, clock12, ddmmyyyy, istDateOf, istDayOffset, pickupTimeOptions, type DeskTab } from "../../domain/quickFareDesk";
import { DESK_MAX_DAYS, DESK_MAX_STOPS, deskTabOf } from "./deskTrip";

const TAB_ICON: Record<DeskTab, ReactNode> = {
  "One Way": <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  "Round Trip": <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  Multicity: <Route className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  Airport: <Plane className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  Rental: <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
  Local: <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
};

const FIELD = "relative h-[58px] pl-3.5 pr-2.5 py-1.5 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] focus-within:ring-2 focus-within:ring-[#991B1B]/15 transition-all flex items-center justify-between gap-2";
const LABEL = "text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none mb-1 cursor-text select-none";

/** Clicking the field's label puts the cursor in its place search. */
const focusField = (e: MouseEvent<HTMLElement>) => e.currentTarget.closest("[data-place-field]")?.querySelector<HTMLInputElement>("input")?.focus();

const addressOf = (p: PickedPoint | null) => (p?.address && p.placeId !== "place-local-disposal" ? p.address : undefined);

function MapButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="shrink-0 px-2.5 py-1 rounded-full border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs font-semibold text-slate-600 flex items-center gap-1 shadow-2xs transition-colors">
      <LocateFixed className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
      <span>Map</span>
    </button>
  );
}

export default function TripForm({ trip, set, data, tabs, notice, busy, swapping, nowMs, rentalKm, onTab, onPickPoint, onSwap, onPin, onRental, onClear, onSubmit }: {
  trip: QuickTrip;
  set: (p: Partial<QuickTrip>) => void;
  data: QuickData;
  /** Trip types offered (a type switched off on the Services page is not shown). */
  tabs: DeskTab[];
  notice: string | null;
  busy: boolean;
  swapping: boolean;
  nowMs: number;
  /** Included km of the rental package on screen (from the quote); null before a rental is priced. */
  rentalKm: string | null;
  onTab: (t: DeskTab) => void;
  onPickPoint: (side: "pickup" | "drop", p: PickedPoint | null, text: string) => void;
  onSwap: () => void;
  onPin: (side: "pickup" | "drop") => void;
  onRental: () => void;
  onClear: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const tab = deskTabOf(trip);
  const rental = trip.tripType === "Local Rental";
  const round = trip.tripType === "Round Trip";
  const airportAt = trip.tripType === "Airport Taxi" ? airportSide(trip) : null;
  const stops = round ? trip.stops ?? [] : [];
  const today = istDateOf(nowMs);
  const offset = trip.date ? istDayOffset(trip.date, nowMs) : null;
  const hours = trip.rentalHours ?? 1;
  const stopList = useRef<HTMLDivElement>(null);

  const addStop = () => {
    if (stops.length >= DESK_MAX_STOPS) return;
    set({ stops: [...stops, { text: "", point: null }] });
    // The new stop's search box takes the cursor.
    window.setTimeout(() => stopList.current?.querySelector<HTMLInputElement>("[data-stop]:last-child input")?.focus(), 0);
  };
  const daysLine = () => {
    if (trip.days <= 1) return "Same day";
    const back = trip.date ? addDaysIst(trip.date, trip.days - 1) : "";
    const at = clock12(trip.time);
    return back && istDayOffset(back, nowMs) === 1 ? `Returns tomorrow • ${at}` : `${trip.days}-day round trip • Returns ${ddmmyyyy(back)}, ${at}`;
  };

  return (
    <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col min-w-0" aria-labelledby="qfCalcTitle">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="qfCalcTitle" className="text-sm font-bold text-slate-900">Quick Fare Calculator</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">Nothing is saved until you click Follow-up or Book</p>
        </div>
        <button type="button" onClick={onClear} className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors flex items-center gap-1 shrink-0">
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Clear</span>
        </button>
      </div>

      <form onSubmit={onSubmit} noValidate className="p-5 space-y-4 flex-1 flex flex-col">
        <div role="group" aria-label="Trip Type" className="bg-[#F1F5F9] p-1 rounded-xl grid grid-cols-3 gap-1">
          {DESK_TABS.filter((t) => tabs.includes(t)).map((t) => {
            const on = tab === t;
            return (
              <button key={t} type="button" aria-pressed={on} onClick={() => onTab(t)}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs whitespace-nowrap min-w-0 transition-all ${on ? "font-semibold bg-white text-[#991B1B] shadow-xs" : "font-medium text-slate-600 hover:text-slate-900"}`}>
                {TAB_ICON[t]}
                <span>{t}</span>
              </button>
            );
          })}
        </div>

        <div className="relative flex items-stretch gap-2.5">
          <div className="w-4 flex flex-col items-center py-5 shrink-0 select-none" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-50 shrink-0" />
            {!rental && <div className="flex-1 w-0 border-l-2 border-dashed border-slate-300 my-1.5" />}
            {!rental && <MapPin className="w-3.5 h-3.5 text-[#991B1B] shrink-0 fill-crimson-50" />}
          </div>

          <div className="flex-1 space-y-2.5 relative min-w-0">
            <div className={FIELD} data-place-field title={addressOf(trip.pickup)}>
              <div className="min-w-0 flex-1 flex flex-col justify-center">
                <span className={LABEL} onClick={focusField} aria-hidden="true">{airportAt === "pickup" ? "Pickup Airport" : "Pickup Location"}</span>
                <PlaceField variant="desk" label={airportAt === "pickup" ? "Pickup airport" : "Pickup location"} placeholder={airportAt === "pickup" ? "e.g., Coimbatore Airport" : "e.g., Coimbatore"}
                  text={trip.pickupText} value={trip.pickup} saved={data.pickups} near={null} airport={airportAt === "pickup"}
                  onChange={(text, p) => onPickPoint("pickup", p, text)} />
              </div>
              <MapButton label={trip.pickup ? "Check pickup on the map" : "Set pickup on the map"} onClick={() => onPin("pickup")} />
            </div>

            {round && (
              // Above the drop field: the entrance animation makes this block its own stacking context, and a stop's
              // suggestion list must not slide under the field below it.
              <div className="relative z-10 space-y-2 fade-slide-in">
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={addStop} disabled={stops.length >= DESK_MAX_STOPS}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#991B1B] bg-crimson-50/70 border border-crimson-200/70 hover:bg-crimson-50 disabled:opacity-50 disabled:cursor-not-allowed">
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    <span>{trip.multicity ? "Add Via-Stop" : "Add Itinerary Stop"}</span>
                  </button>
                  {!trip.multicity && (
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full" title="Stops are visited in this order and priced on the road route through them">Itinerary Lock</span>
                  )}
                  {stops.length >= DESK_MAX_STOPS && <span className="text-[10px] font-medium text-slate-400">Up to {DESK_MAX_STOPS} stops</span>}
                </div>
                {stops.length > 0 && (
                  <div className="space-y-1.5" ref={stopList}>
                    {stops.map((s, i) => (
                      <div key={i} className="flex items-center gap-1.5" data-stop>
                        <div className="dk-stop relative flex-1 min-w-0" title={addressOf(s.point)}>
                          <PlaceField variant="desk" label={`${trip.multicity ? "Via-stop" : "Itinerary stop"} ${i + 1}`} placeholder="Enter stop city..."
                            text={s.text} value={s.point} saved={data.drops} near={trip.pickup}
                            onChange={(text, p) => set({ stops: stops.map((x, n) => (n === i ? { text, point: p } : x)) })} />
                        </div>
                        <button type="button" aria-label={`Remove stop ${i + 1}`} onClick={() => set({ stops: stops.filter((_, n) => n !== i) })}
                          className="w-8 h-8 rounded-lg border border-slate-200 text-slate-400 hover:text-[#991B1B] flex items-center justify-center shrink-0">
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {!rental && stops.length === 0 && (
              <button type="button" onClick={onSwap} aria-label="Swap pickup and drop"
                className={`absolute right-[78px] top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-[#991B1B] hover:border-[#991B1B] flex items-center justify-center transition-colors ${swapping ? "swap-spin" : ""}`}>
                <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}

            {!rental && (
              <div className={FIELD} data-place-field title={addressOf(trip.drop)}>
                <div className="min-w-0 flex-1 flex flex-col justify-center">
                  <span className={LABEL} onClick={focusField} aria-hidden="true">{airportAt === "drop" ? "Drop Airport" : trip.multicity ? "Final Drop Location" : "Drop Location"}</span>
                  <PlaceField variant="desk" label={airportAt === "drop" ? "Drop airport" : trip.multicity ? "Final drop location" : "Drop location"} placeholder={airportAt === "drop" ? "e.g., Madurai Airport" : "e.g., Madurai"}
                    text={trip.dropText} value={trip.drop} saved={data.drops} near={trip.pickup} airport={airportAt === "drop"}
                    onChange={(text, p) => onPickPoint("drop", p, text)} />
                </div>
                <MapButton label={trip.drop ? "Check drop on the map" : "Set drop on the map"} onClick={() => onPin("drop")} />
              </div>
            )}
          </div>
        </div>

        {rental && (
          <div className="fade-slide-in">
            <button type="button" onClick={onRental} aria-haspopup="dialog"
              className="w-full px-3.5 py-3 rounded-xl border border-slate-200 bg-slate-50/50 hover:border-[#991B1B]/50 hover:bg-crimson-50/20 transition-all flex items-center justify-between gap-2 text-left">
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-lg bg-crimson-50 text-[#991B1B] flex items-center justify-center shrink-0" aria-hidden="true"><Clock className="w-4 h-4" /></span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rental Duration</span>
                  <span className="block text-xs sm:text-sm font-bold text-slate-900 truncate">{hours} {hours === 1 ? "hour" : "hours"}{rentalKm ? ` • ${rentalKm} included` : ""}</span>
                </span>
              </span>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-crimson-50 text-[#991B1B] border border-crimson-200/70 shrink-0">Change</span>
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <label htmlFor="qfDateNative" className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Pickup Date</label>
              {offset === 0 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">Today</span>}
              {offset === 1 && <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/70">Tomorrow</span>}
            </div>
            <div className="relative h-11 px-3 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] flex items-center justify-between">
              <span className="text-xs sm:text-sm font-medium text-slate-800">{ddmmyyyy(trip.date) || "Choose date"}</span>
              <Calendar className="w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              <input type="date" id="qfDateNative" min={today} value={trip.date} onChange={(e) => e.target.value && set({ date: e.target.value })}
                className="qfd-date-native absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor="qfTimeSelect" className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Pickup Time (12 Hrs)</label>
            <div className="relative h-11 rounded-xl border border-slate-200 bg-white focus-within:border-[#991B1B] flex items-center">
              <select id="qfTimeSelect" value={trip.time} onChange={(e) => set({ time: e.target.value })}
                className="w-full h-full pl-3 pr-8 text-xs sm:text-sm font-medium text-slate-800 bg-transparent appearance-none focus:outline-none cursor-pointer">
                {pickupTimeOptions(trip.time).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Clock className="w-4 h-4 text-slate-400 absolute right-3 pointer-events-none" aria-hidden="true" />
            </div>
          </div>
        </div>

        {round && !trip.multicity && (
          <div className="fade-slide-in">
            <div className="px-3.5 py-2.5 rounded-xl border border-blue-200/80 bg-blue-50/20 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900">Days</p>
                <p className="text-[11px] text-slate-500 truncate">{daysLine()}</p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white shrink-0">
                <button type="button" aria-label="One day less" disabled={trip.days <= 1} onClick={() => set({ days: Math.max(1, trip.days - 1) })}
                  className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"><Minus className="w-3.5 h-3.5" aria-hidden="true" /></button>
                <span className="min-w-[56px] text-center text-xs font-bold text-slate-900" aria-live="polite">{trip.days} {trip.days === 1 ? "day" : "days"}</span>
                <button type="button" aria-label="One day more" disabled={trip.days >= DESK_MAX_DAYS} onClick={() => set({ days: Math.min(DESK_MAX_DAYS, trip.days + 1) })}
                  className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"><Plus className="w-3.5 h-3.5" aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div role="alert" className="px-3 py-2 rounded-xl text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-2">
            <Info className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /><span>{notice}</span>
          </div>
        )}

        <div className="pt-1 mt-auto">
          <button type="submit" disabled={busy} aria-busy={busy || undefined}
            className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] active:scale-[0.99] text-white font-semibold text-sm py-3 rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 disabled:opacity-80 disabled:cursor-progress">
            {busy ? <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Calculator className="w-4 h-4" aria-hidden="true" />}
            <span>{busy ? "Getting Fares…" : "Get Fare"}</span>
          </button>
        </div>
      </form>
    </section>
  );
}
