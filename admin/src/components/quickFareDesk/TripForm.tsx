import type { FormEvent } from "react";
import Icon from "../ui/Icon";
import DeskIcon, { TRIP_ICON } from "../ui/DeskIcons";
import TimeSelect12 from "../TimeSelect12";
import { PlaceField, airportSide, type QuickData, type QuickTrip } from "../booking/QuickFare";
import type { PickedPoint } from "../MapLocationPicker";
import { addDaysISO, dayOffsetIST, isoDateIST } from "../../utils/time";
import { DESK_MAX_DAYS, DESK_MAX_STOPS, dateLabel, deskTabOf, istInstant, time12, type DeskTab } from "./deskTrip";

const TABS: DeskTab[] = ["One Way", "Round Trip", "Multicity", "Airport", "Rental", "Local"];

export default function TripForm({ trip, set, data, tabs, notice, busy, stale, swapping, onTab, onPickPoint, onSwap, onPin, onRental, onClear, onSubmit }: {
  trip: QuickTrip;
  set: (p: Partial<QuickTrip>) => void;
  data: QuickData;
  /** Trip types offered (a type switched off on the Services page is hidden). */
  tabs: DeskTab[];
  notice: string | null;
  busy: boolean;
  stale: boolean;
  swapping: boolean;
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
  const today = isoDateIST(new Date());
  const offset = trip.date ? dayOffsetIST(istInstant(trip.date, "12:00")) : null;
  const addrOf = (p: PickedPoint | null, text: string) => {
    if (!p?.address || p.placeId === "place-local-disposal") return "";
    const a = p.address.trim().toLowerCase();
    return [p.name, text].some((x) => (x || "").trim().toLowerCase() === a) ? "" : p.address;
  };

  return (
    <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col min-w-0" aria-labelledby="qfTitle">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <h2 id="qfTitle" className="text-sm font-extrabold text-slate-900">Quick fare</h2>
        <button type="button" onClick={onClear} className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 flex items-center gap-1">
          <Icon name="rotate-ccw" size={14} /><span>Clear</span>
        </button>
      </div>

      <form onSubmit={onSubmit} noValidate className="p-5 space-y-4 flex-1 flex flex-col">
        <div role="radiogroup" aria-label="Trip type" className="bg-[#F1F5F9] p-1 rounded-xl grid grid-cols-3 gap-1">
          {TABS.filter((t) => tabs.includes(t)).map((t) => {
            const on = tab === t;
            return (
              <button key={t} type="button" role="radio" aria-checked={on} onClick={() => onTab(t)}
                className={`dk-type flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs transition-colors ${on ? "bg-white text-[#991B1B] shadow-sm font-extrabold" : "text-slate-600 hover:text-slate-900 font-semibold"}`}>
                <DeskIcon name={TRIP_ICON[t]} size={17} className="shrink-0" /><span>{t}</span>
              </button>
            );
          })}
        </div>

        {airportAt && (
          <div role="radiogroup" aria-label="Airport direction" className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[#F1F5F9] fade-slide-in">
            {(["to", "from"] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={trip.airportDirection === d} onClick={() => set({ airportDirection: d })}
                className={`py-1.5 rounded-lg text-xs transition-colors ${trip.airportDirection === d ? "bg-white text-[#991B1B] shadow-sm font-extrabold" : "text-slate-600 font-semibold"}`}>
                {d === "to" ? "To airport" : "From airport"}
              </button>
            ))}
          </div>
        )}

        <div className="dk-route" data-single={rental ? "true" : undefined}>
          {!rental && <span className="dk-route__rail" aria-hidden="true" />}
          <div className="dk-leg">
            <span className="dk-mark dk-mark--a" aria-hidden="true">A</span>
            <div className="dk-leg__main">
              <span className="dk-leg__label" aria-hidden="true">{airportAt === "pickup" ? "Pickup airport" : "Pickup"}</span>
              <PlaceField variant="desk" label="Pickup location" placeholder={airportAt === "pickup" ? "Search airport" : "Area, landmark or city"}
                text={trip.pickupText} value={trip.pickup} saved={data.pickups} near={null} airport={airportAt === "pickup"}
                onChange={(text, p) => onPickPoint("pickup", p, text)} />
              {addrOf(trip.pickup, trip.pickupText) && <span className="dk-leg__addr" title={addrOf(trip.pickup, trip.pickupText)}>{addrOf(trip.pickup, trip.pickupText)}</span>}
            </div>
            <div className="dk-leg__tools">
              {trip.pickupText && <button type="button" className="dk-clear" aria-label="Clear pickup" onClick={() => onPickPoint("pickup", null, "")}><Icon name="x" size={14} /></button>}
              <button type="button" className="dk-map" data-ok={trip.pickup?.confirmed ? "true" : undefined} onClick={() => onPin("pickup")} aria-label={trip.pickup?.confirmed ? "Pickup pin set. Check on map" : "Set pickup on map"}>
                <Icon name={trip.pickup?.confirmed ? "check" : "map-pin"} size={13} />Map
              </button>
            </div>
          </div>

          {stops.map((s, i) => (
            <div className="dk-leg dk-leg--stop" key={i}>
              <span className="dk-mark dk-mark--stop" aria-hidden="true">{i + 1}</span>
              <div className="dk-leg__main">
                <span className="dk-leg__label" aria-hidden="true">{trip.multicity ? `Via ${i + 1}` : `Stop ${i + 1}`}</span>
                <PlaceField variant="desk" label={`${trip.multicity ? "Via stop" : "Stop"} ${i + 1}`} placeholder="Area, landmark or city"
                  text={s.text} value={s.point} saved={data.drops} near={trip.pickup}
                  onChange={(text, p) => set({ stops: stops.map((x, n) => (n === i ? { text, point: p } : x)) })} />
                {addrOf(s.point, s.text) && <span className="dk-leg__addr">{addrOf(s.point, s.text)}</span>}
              </div>
              <div className="dk-leg__tools">
                <button type="button" className="dk-clear" aria-label={`Remove stop ${i + 1}`} disabled={!!trip.multicity && stops.length === 1}
                  onClick={() => set({ stops: stops.filter((_, n) => n !== i) })}><Icon name="trash-2" size={14} /></button>
              </div>
            </div>
          ))}

          {!rental && stops.length === 0 && (
            <button type="button" onClick={onSwap} aria-label="Swap pickup and drop" title="Swap pickup and drop" className={`dk-swap ${swapping ? "swap-spin" : ""}`}>
              <Icon name="arrow-up-down" size={15} />
            </button>
          )}

          {!rental && (
            <div className="dk-leg">
              <span className="dk-mark dk-mark--b" aria-hidden="true">B</span>
              <div className="dk-leg__main">
                <span className="dk-leg__label" aria-hidden="true">{airportAt === "drop" ? "Drop airport" : trip.multicity ? "Final drop" : "Drop"}</span>
                <PlaceField variant="desk" label={trip.multicity ? "Final drop location" : "Drop location"} placeholder={airportAt === "drop" ? "Search airport" : "Area, landmark or city"}
                  text={trip.dropText} value={trip.drop} saved={data.drops} near={trip.pickup} airport={airportAt === "drop"}
                  onChange={(text, p) => onPickPoint("drop", p, text)} />
                {addrOf(trip.drop, trip.dropText) && <span className="dk-leg__addr" title={addrOf(trip.drop, trip.dropText)}>{addrOf(trip.drop, trip.dropText)}</span>}
              </div>
              <div className="dk-leg__tools">
                {trip.dropText && <button type="button" className="dk-clear" aria-label="Clear drop" onClick={() => onPickPoint("drop", null, "")}><Icon name="x" size={14} /></button>}
                <button type="button" className="dk-map" data-ok={trip.drop?.confirmed ? "true" : undefined} onClick={() => onPin("drop")} aria-label={trip.drop?.confirmed ? "Drop pin set. Check on map" : "Set drop on map"}>
                  <Icon name={trip.drop?.confirmed ? "check" : "map-pin"} size={13} />Map
                </button>
              </div>
            </div>
          )}
        </div>

        {round && (
          <button type="button" disabled={stops.length >= DESK_MAX_STOPS} onClick={() => set({ stops: [...stops, { text: "", point: null }] })} className="dk-addstop">
            <Icon name="plus" size={13} /><span>{trip.multicity ? "Add via-stop" : "Add stop"}</span>
            <span className="text-[10.5px] font-semibold text-slate-400">{stops.length}/{DESK_MAX_STOPS}</span>
          </button>
        )}

        {rental && (
          <button type="button" onClick={onRental} className="w-full px-3.5 py-3 rounded-xl border-[1.5px] border-slate-200 bg-slate-50/50 hover:border-[#991B1B]/50 transition-colors flex items-center justify-between gap-2 text-left fade-slide-in">
            <span className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-lg bg-crimson-50 text-[#991B1B] flex items-center justify-center shrink-0"><Icon name="clock" size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Rental duration</span>
                <span className="block text-sm font-extrabold text-slate-900">{trip.rentalHours ?? 1} {(trip.rentalHours ?? 1) === 1 ? "hour" : "hours"}</span>
              </span>
            </span>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-crimson-50 text-[#991B1B] border border-crimson-200/70 shrink-0">Change</span>
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label htmlFor="qfDate" className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Pickup date</label>
              {offset === 0 && <span className="dk-day dk-day--today">Today</span>}
              {offset === 1 && <span className="dk-day">Tomorrow</span>}
            </div>
            <div className="relative h-[46px] px-3 rounded-xl border-[1.5px] border-slate-200 bg-white focus-within:border-[#991B1B] flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900">{dateLabel(trip.date) || "Choose date"}</span>
              <Icon name="calendar" size={16} className="text-slate-400 pointer-events-none" />
              <input type="date" id="qfDate" min={today} value={trip.date} onChange={(e) => set({ date: e.target.value })} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label htmlFor="qfTimeHour" className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">Pickup time</label>
              <span className="dk-ist">IST</span>
            </div>
            <div className="dk-timebox">
              <TimeSelect12 id="qfTimeHour" label="Pickup time" value={trip.time} onChange={(time) => set({ time })} className="dk-time12" />
            </div>
          </div>
        </div>

        {round && !trip.multicity && (
          <div className="px-3.5 py-2.5 rounded-xl border border-blue-200/80 bg-blue-50/20 flex items-center justify-between gap-3 fade-slide-in">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-slate-900">Days</p>
              <p className="text-[11px] font-semibold text-slate-500 truncate">
                {trip.days === 1 ? "Same-day return" : `Returns ${dateLabel(addDaysISO(trip.date, trip.days - 1))} by ${time12(trip.time)} IST`}
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 rounded-xl border border-slate-200 bg-white shrink-0">
              <button type="button" aria-label="One day less" disabled={trip.days <= 1} onClick={() => set({ days: Math.max(1, trip.days - 1) })}
                className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"><Icon name="minus" size={14} /></button>
              <span className="min-w-[56px] text-center text-xs font-extrabold text-slate-900" aria-live="polite">{trip.days} {trip.days === 1 ? "day" : "days"}</span>
              <button type="button" aria-label="One day more" disabled={trip.days >= DESK_MAX_DAYS} onClick={() => set({ days: Math.min(DESK_MAX_DAYS, trip.days + 1) })}
                className="w-8 h-8 rounded-lg bg-blue-50 text-[#2563EB] hover:bg-blue-100 disabled:opacity-40 flex items-center justify-center"><Icon name="plus" size={14} /></button>
            </div>
          </div>
        )}

        {notice && (
          <div role="alert" className="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-2">
            <Icon name="info" size={14} className="shrink-0" /><span>{notice}</span>
          </div>
        )}

        <div className="pt-1 mt-auto">
          <button type="submit" disabled={busy} aria-busy={busy || undefined}
            className="w-full bg-[#991B1B] hover:bg-[#7F1D1D] text-white font-extrabold text-sm h-12 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-70">
            {busy ? <span className="ds-spinner" aria-hidden="true" /> : <Icon name="calculator" size={16} />}
            <span>{busy ? "Getting fares…" : stale ? "Get Fare Again" : "Get Fare"}</span>
          </button>
        </div>
      </form>
    </section>
  );
}
