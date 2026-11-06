// The trip form of New booking, drawn exactly as the customer sites draw theirs (Nesam Cabs, People Taxi, One Way Car Rentals):
// the services bar, the pickup / drop fields with the swap button, round-trip stops, the pickup date and the time wheels.
// The platform theme (colours, type, corners) comes from the `.cf--<platform>` wrapper and customerForm.css. What it edits is
// the same QuickTrip the rest of the admin uses, so pricing and booking do not change.
import { useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import "../../styles/customerFonts";
import "../../styles/customerForm.css";
import "../../styles/customerFormAdmin.css";
import { Icon, type IconName } from "../ui";
import { isoDateIST } from "../../utils/time";
import {
  PlaceField, TRIP_OPTION, TRIP_SERVICES, airportSide, tripOptionKey, tripTypeForService, withPickup, withTripType,
  type QuickData, type QuickTrip,
} from "./QuickFare";

const iconFor = (tripType: QuickTrip["tripType"], multicity?: boolean, local?: boolean): IconName =>
  multicity ? "route" : local ? "map-pin" : tripType === "Round Trip" ? "arrow-left-right" : tripType === "Local Rental" ? "clock" : tripType === "Airport Taxi" ? "car-front" : "arrow-right";

/** "7:05 PM" from "19:05". */
export const formatTime12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** Today / Tomorrow / weekday, as the customer form's date chip. */
const dayHint = (iso: string) => {
  if (!iso) return "";
  if (iso === isoDateIST(new Date())) return "Today";
  if (iso === isoDateIST(new Date(Date.now() + 86400000))) return "Tomorrow";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-IN", { weekday: "short" });
};

// ── The time sheet: three scrolling wheels (hour, minute, AM / PM), as on the customer sites ──────────────────────────────
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const MERIDIEMS = ["AM", "PM"];
const ITEM_H = 44;

function Wheel<T extends string | number>({ label, items, value, format = String, onChange }: { label: string; items: T[]; value: T; format?: (item: T) => string; onChange: (item: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: items.indexOf(value) * ITEM_H });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const next = items[Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)))] as T;
    if (next !== value) onChange(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number | undefined> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    const step = steps[e.key];
    const at = items.indexOf(value);
    const to = step !== undefined ? at + step : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const i = Math.min(items.length - 1, Math.max(0, to));
    ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" });
    onChange(items[i] as T);
  };
  return (
    <div ref={ref} className="timepick__wheel" role="listbox" aria-label={label} tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown}>
      {items.map((item, i) => (
        <div key={item} role="option" aria-selected={item === value} className={item === value ? "is-on" : ""} onClick={() => ref.current?.scrollTo({ top: i * ITEM_H, behavior: "smooth" })}>
          {format(item)}
        </div>
      ))}
    </div>
  );
}

function TimeSheet({ title, value, onConfirm, onClose }: { title: string; value: string; onConfirm: (hhmm: string) => void; onClose: () => void }) {
  const [h0, m0] = value ? (value.split(":").map(Number) as [number, number]) : [18, 0];
  const [hour, setHour] = useState(h0 % 12 === 0 ? 12 : h0 % 12);
  const [minute, setMinute] = useState(Number.isFinite(m0) ? Math.min(59, Math.max(0, m0)) : 0);
  const [pm, setPm] = useState(h0 >= 12);
  const hhmm = `${String((hour % 12) + (pm ? 12 : 0)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return (
    <div className="overlay overlay--dialog" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="dialog dialog--dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog__head">
          <div>
            <h2>{title}</h2>
            <p className="dialog__sub">Times are in IST.</p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" aria-label="Close" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div className="dialog__body">
          <div className="timepick">
            <p className="timepick__now num" aria-live="polite">{hour}:{String(minute).padStart(2, "0")} <span>{pm ? "PM" : "AM"}</span></p>
            <div className="timepick__wheels">
              <Wheel label="Hour" items={HOURS} value={hour} onChange={setHour} />
              <Wheel label="Minutes" items={MINUTES} value={minute} format={(m) => String(m).padStart(2, "0")} onChange={setMinute} />
              <Wheel label="AM or PM" items={MERIDIEMS} value={pm ? "PM" : "AM"} onChange={(m) => setPm(m === "PM")} />
            </div>
          </div>
        </div>
        <div className="dialog__foot">
          <button type="button" className="btn btn--secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn btn--primary" onClick={() => onConfirm(hhmm)}><Icon name="check" size={16} />Confirm time</button>
        </div>
      </div>
    </div>
  );
}

// ── The form ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function CustomerTripForm({ trip, set, data, top, action, error, onSubmit, allowedTripTypes }: {
  trip: QuickTrip;
  set: (p: Partial<QuickTrip>) => void;
  data: QuickData;
  /** What sits above the services bar (the admin's own platform and customer choice). */
  top?: ReactNode;
  /** The submit button. */
  action: ReactNode;
  error?: string | null;
  onSubmit: (e: FormEvent) => void;
  allowedTripTypes?: QuickTrip["tripType"][];
}) {
  const [timeFor, setTimeFor] = useState<"pickup" | "return" | null>(null);
  const today = isoDateIST(new Date());
  const rental = trip.tripType === "Local Rental";
  const airportAt = trip.tripType === "Airport Taxi" ? airportSide(trip) : null;
  const round = trip.tripType === "Round Trip" && !trip.multicity;
  const stops = trip.stops ?? [];

  // The same service choices as before: the built-in trip types, then the configured services.
  const options = [
    ...TRIP_SERVICES.filter((x) => !allowedTripTypes || allowedTripTypes.includes(x.tripType)).map((x) => ({ value: `${TRIP_OPTION}${x.key}`, label: x.label, icon: iconFor(x.tripType, x.multicity, x.local) })),
    ...data.services.filter((s) => !allowedTripTypes || allowedTripTypes.includes(tripTypeForService(s))).map((s) => ({ value: s.id, label: s.name, icon: "car" as IconName })),
  ];
  const current = trip.serviceId || `${TRIP_OPTION}${tripOptionKey(trip)}`;
  const choose = (v: string) => {
    const builtIn = v.startsWith(TRIP_OPTION) ? TRIP_SERVICES.find((x) => x.key === v.slice(TRIP_OPTION.length)) : undefined;
    if (builtIn) set({ serviceId: "", multicity: !!builtIn.multicity, local: !!builtIn.local, ...withTripType(trip, builtIn.tripType) });
    else set({ serviceId: v, multicity: false, local: false, ...withTripType(trip, tripTypeForService(data.services.find((x) => x.id === v))) });
  };

  const pickPoint = (side: "pickup" | "drop", p: Parameters<typeof withPickup>[1], text: string) => set(side === "pickup" ? withPickup(trip, p, text) : { drop: p, dropText: text });
  const swap = () => set({ pickup: trip.drop, pickupText: trip.dropText, drop: trip.pickup, dropText: trip.pickupText });
  const swapButton = (
    <button type="button" className="bf-swap" aria-label="Swap pickup and drop" title="Swap route" disabled={!trip.pickup && !trip.drop} onClick={swap}>
      <Icon name="arrow-left-right" size={22} />
    </button>
  );

  return (
    <section className="bf" aria-label="New booking">
      {top}
      <div className="bf-services" role="group" aria-label="Services">
        {options.map((o) => (
          <button key={o.value} type="button" className={`bf-service ${o.value === current ? "is-active" : ""}`} aria-pressed={o.value === current} onClick={() => choose(o.value)}>
            <span className="bf-service__icon"><Icon name={o.icon} size={22} /></span>
            <span>{o.label}</span>
          </button>
        ))}
      </div>

      {airportAt ? (
        <div className="tabs tabs--line bf-journey" role="tablist">
          {(["to", "from"] as const).map((d) => (
            <button key={d} type="button" role="tab" aria-selected={trip.airportDirection === d} className={`tab ${trip.airportDirection === d ? "is-active" : ""}`} onClick={() => set({ airportDirection: d })}>
              <span>{d === "to" ? "To airport" : "From airport"}</span>
            </button>
          ))}
        </div>
      ) : null}

      <form className="bf-form" noValidate onSubmit={onSubmit}>
        <div className={`bf-route ${rental ? "bf-route--single" : ""} ${round ? "bf-route--round" : ""}`}>
          <div className="bf-route__cell">
            <PlaceField variant="cf" pin="pickup" label={airportAt === "pickup" ? "Pickup airport" : "Pickup location"} placeholder="" text={trip.pickupText} value={trip.pickup} saved={data.pickups} near={null} airport={airportAt === "pickup"} onChange={(text, p) => pickPoint("pickup", p, text)} />
          </div>
          {!round && !rental && !airportAt ? swapButton : null}
          {round ? (
            <>
              {stops.map((s, i) => (
                <div className="bf-route__cell" key={i}>
                  <PlaceField variant="cf" pin="stop" label={`Stop ${i + 1}`} placeholder="" text={s.text} value={s.point} saved={data.drops} near={trip.pickup} onRemove={() => set({ stops: stops.filter((_, n) => n !== i) })}
                    onChange={(text, p) => set({ stops: stops.map((x, n) => (n === i ? { text, point: p } : x)) })} />
                </div>
              ))}
              <div className="bf-route__tools">
                {stops.length < 8 ? <button type="button" className="bf-round-stop-add" onClick={() => set({ stops: [...stops, { text: "", point: null }] })}><Icon name="plus" size={16} /> Add stop</button> : null}
                {swapButton}
              </div>
            </>
          ) : null}
          {!rental ? (
            <div className="bf-route__cell">
              <PlaceField variant="cf" pin="drop" label={airportAt === "drop" ? "Drop airport" : "Drop location"} placeholder="" text={trip.dropText} value={trip.drop} saved={data.drops} near={trip.pickup} airport={airportAt === "drop"} onChange={(text, p) => pickPoint("drop", p, text)} />
            </div>
          ) : null}
        </div>

        <div className="bf-row">
          <div className="bf-cell">
            <label className="bf-label bf-label--out" htmlFor="nb-date">Pickup date</label>
            <div className="bf-datewrap">
              <input id="nb-date" className="input bf-input" type="date" value={trip.date} min={today} onChange={(e) => set({ date: e.target.value })} />
              {trip.date ? <span className="bf-chip">{dayHint(trip.date)}</span> : null}
            </div>
          </div>
          <div className="bf-cell">
            <span className="bf-label bf-label--out" id="nb-time-label">Pickup time</span>
            <button type="button" className={`bf-time ${trip.time ? "" : "is-empty"}`} aria-labelledby="nb-time-label nb-time-value" onClick={() => setTimeFor("pickup")}>
              <span id="nb-time-value">{trip.time ? formatTime12(trip.time) : ""}</span>
              <Icon name="clock" size={26} />
            </button>
          </div>
        </div>

        {round ? (
          <div className="bf-row">
            <div className="bf-cell">
              <label className="bf-label bf-label--out" htmlFor="nb-end-date">Return date</label>
              <div className="bf-datewrap">
                <input id="nb-end-date" className="input bf-input" type="date" value={trip.endDate} min={trip.date || today} onChange={(e) => set({ endDate: e.target.value })} />
                {trip.endDate ? <span className="bf-chip">{dayHint(trip.endDate)}</span> : null}
              </div>
            </div>
            <div className="bf-cell">
              <span className="bf-label bf-label--out" id="nb-end-time-label">Return time</span>
              <button type="button" className={`bf-time ${trip.endTime ? "" : "is-empty"}`} aria-labelledby="nb-end-time-label nb-end-time-value" onClick={() => setTimeFor("return")}>
                <span id="nb-end-time-value">{trip.endTime ? formatTime12(trip.endTime) : ""}</span>
                <Icon name="clock" size={26} />
              </button>
            </div>
          </div>
        ) : null}

        {error ? <p className="bf-error bf-error--form" role="alert">{error}</p> : null}
        {action}
      </form>

      {timeFor ? (
        <TimeSheet
          title={timeFor === "return" ? "Return time" : "Pickup time"}
          value={timeFor === "return" ? trip.endTime : trip.time}
          onClose={() => setTimeFor(null)}
          onConfirm={(t) => { set(timeFor === "return" ? { endTime: t } : { time: t }); setTimeFor(null); }}
        />
      ) : null}
    </section>
  );
}
