import DateTime12Input from "../DateTime12Input";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import type { MasterLocation, TravelService, VehicleCategory } from "../../types";
import { subscribeLocations, subscribeServices, subscribeVehicleCategories } from "../../services/adminFirestoreService";
import {
  bookableCategories, bookableLocations, emptyManualBooking, newRequestId, pointFromLocation, quoteAdminBooking,
  type FareQuote, type ManualBookingForm,
} from "../../services/adminBookingService";
import { ActionError } from "../../services/callables";
import { mainCityPlaces, placeDetail, placeLabel, searchPlaces, type LatLng, type PlaceResult } from "../../services/geoService";
import { saveEnquiry, type Enquiry } from "../../services/enquiryService";
import MapLocationPicker, { type PickedPoint } from "../MapLocationPicker";
import { Modal } from "../Feedback";
import { Button, Icon } from "../ui";
import { FareBreakupCard } from "./Enquiries";
import { isoDateIST } from "../../utils/time";
import TimeSelect12 from "../TimeSelect12";
import { refDateTime, rupee } from "../../domain/officeStage";
import { subscribeBusinessAccounts, type BusinessAccount } from "../../services/businessService";

/** The trip half of a booking: everything the estimate depends on, no customer details. */
export interface QuickTrip {
  businessId: string;
  serviceId: string;
  tripType: ManualBookingForm["tripType"] | "Local Rental" | "Airport Taxi";
  /** A Multicity trip: priced and booked as a Round Trip, but chosen and named as Multicity. */
  multicity?: boolean;
  pickupText: string;
  dropText: string;
  pickup: PickedPoint | null;
  drop: PickedPoint | null;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  /** Airport transfers: whether the airport is the drop ("to") or the pickup ("from"). */
  airportDirection: "to" | "from";
  /** Extras & terms the office records with the booking. */
  hill: boolean;
  carrier: boolean;
  waitingMin: string;
  priceEntered: "Excluding GST" | "Including GST";
}

export const emptyTrip = (): QuickTrip => ({
  businessId: "", serviceId: "", tripType: "One Way", pickupText: "", dropText: "", pickup: null, drop: null,
  date: isoDateIST(new Date(Date.now() + 86400000)), time: "08:00", endDate: "", endTime: "20:00", airportDirection: "to",
  hill: false, carrier: false, waitingMin: "0", priceEntered: "Excluding GST",
});

export interface CategoryEstimate {
  category: VehicleCategory;
  quote: FareQuote | null;
  error: string | null;
}

/** Local "YYYY-MM-DDTHH:mm" India time → the value the booking form expects. */
export const tripPickupAt = (t: QuickTrip) => (t.date && t.time ? `${t.date}T${t.time}` : "");
// A Multicity quote has no return date: it is priced for the pickup day.
export const tripEndAt = (t: QuickTrip) => (t.tripType !== "Round Trip" ? "" : t.multicity && t.date ? `${t.date}T23:59` : t.endDate ? `${t.endDate}T${t.endTime || "20:00"}` : "");

/** The booking-form view of a trip (customer fields left empty for a quote). */
export function tripToForm(t: QuickTrip, categoryId: string, base: ManualBookingForm = emptyManualBooking()): ManualBookingForm {
  return {
    ...base,
    serviceId: t.serviceId,
    pickup: t.pickup,
    drop: t.drop,
    categoryId,
    tripType: t.tripType,
    pickupAt: tripPickupAt(t),
    tripEndAt: tripEndAt(t),
  };
}

/** Pickup instant shown on cards. Inputs are India time. */
export function tripPickupDate(t: QuickTrip): Date | null {
  const v = tripPickupAt(t);
  return v ? new Date(Date.parse(`${v}:00Z`) - 330 * 60000) : null;
}

export function useQuickData() {
  const [services, setServices] = useState<TravelService[]>([]);
  const [locations, setLocations] = useState<MasterLocation[]>([]);
  const [categories, setCategories] = useState<VehicleCategory[]>([]);
  const [business, setBusiness] = useState<BusinessAccount[]>([]);
  useEffect(() => {
    const u = [subscribeServices(setServices), subscribeLocations(setLocations), subscribeVehicleCategories(setCategories), subscribeBusinessAccounts(setBusiness, () => undefined)];
    return () => u.forEach((x) => x());
  }, []);
  const activeServices = useMemo(() => services.filter((s) => s.status === "Active" && s.adminBookingEnabled !== false), [services]);
  const pickups = useMemo(() => bookableLocations(locations, "pickup"), [locations]);
  const drops = useMemo(() => bookableLocations(locations, "drop"), [locations]);
  const cats = useMemo(() => bookableCategories(categories).sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99)), [categories]);
  return { services: activeServices, pickups, drops, categories: cats, business: business.filter((b) => b.status === "Active") };
}
export type QuickData = ReturnType<typeof useQuickData>;

const locLabel = (l: MasterLocation) => [l.name, l.area && l.area !== l.name ? l.area : "", l.city && l.city !== l.name ? l.city : ""].filter(Boolean).join(", ");

/** The built-in services: the platform's trip types, offered before any configured service. */
export const TRIP_SERVICES: { key: string; tripType: QuickTrip["tripType"]; label: string; multicity?: boolean }[] = [
  { key: "One Way", tripType: "One Way", label: "Outstation · One Way" },
  { key: "Round Trip", tripType: "Round Trip", label: "Outstation · Round Trip" },
  // Multicity is priced from the Round Trip rates (the tariff inherits them), so it uses that trip type.
  { key: "Multicity", tripType: "Round Trip", label: "Multicity", multicity: true },
  { key: "Local Rental", tripType: "Local Rental", label: "Local Rental" },
  { key: "Airport Taxi", tripType: "Airport Taxi", label: "Airport Transfer" },
];
const TRIP_OPTION = "trip:";
export const tripServiceLabel = (t: Pick<QuickTrip, "tripType" | "multicity">) => TRIP_SERVICES.find((x) => x.tripType === t.tripType && !!x.multicity === !!t.multicity)?.label ?? TRIP_SERVICES[0].label;
const tripOptionKey = (t: Pick<QuickTrip, "tripType" | "multicity">) => (t.multicity ? "Multicity" : t.tripType);

/** Local rentals are priced to a city-disposal point beside the pickup, as the customer apps book them. */
const DISPOSAL_ID = "place-local-disposal";
const DISPOSAL_NAME = "Local City Disposal";
const disposalFor = (p: PickedPoint): PickedPoint => ({
  lat: p.lat + 0.04, lng: p.lng + 0.04, name: DISPOSAL_NAME, address: `${p.name} & City Limits (Within city disposal)`, type: "other", confirmed: true, placeId: DISPOSAL_ID,
});

/** A new pickup; a local rental's drop follows it. */
const withPickup = (t: QuickTrip, pickup: PickedPoint | null, pickupText: string): Partial<QuickTrip> =>
  t.tripType === "Local Rental" ? { pickup, pickupText, drop: pickup ? disposalFor(pickup) : null, dropText: pickup ? DISPOSAL_NAME : "" } : { pickup, pickupText };

/** A new trip type. Only what it cannot use is cleared: the city-disposal drop outside a local rental. */
function withTripType(t: QuickTrip, tripType: QuickTrip["tripType"]): Partial<QuickTrip> {
  if (tripType === "Local Rental") return { tripType, ...withPickup({ ...t, tripType }, t.pickup, t.pickupText) };
  return t.drop?.placeId === DISPOSAL_ID ? { tripType, drop: null, dropText: "" } : { tripType };
}

const airportSide = (t: QuickTrip): "pickup" | "drop" => (t.airportDirection === "from" ? "pickup" : "drop");

/** Trip type implied by a service name (One Way / Round Trip / Local Rental / Airport). */
export function tripTypeForService(s?: TravelService): QuickTrip["tripType"] {
  const n = `${s?.name ?? ""} ${(s as { category?: string } | undefined)?.category ?? ""}`;
  if (/round/i.test(n)) return "Round Trip";
  if (/rental|hour/i.test(n)) return "Local Rental";
  if (/airport/i.test(n)) return "Airport Taxi";
  return "One Way";
}

export function validateTrip(t: QuickTrip): string | null {
  if (!t.pickup) return "Select the locations and calculate the route, or record an authorised manual distance with a reason.";
  if (!t.drop) return "Select the locations and calculate the route, or record an authorised manual distance with a reason.";
  if (!t.date || !t.time) return "Choose the pickup date and time.";
  const at = tripPickupDate(t);
  if (!at || at.getTime() < Date.now() + 30 * 60000) return "Pickup must be at least 30 minutes from now.";
  if (t.tripType === "Round Trip" && !t.multicity && !t.endDate) return "Choose when the trip ends.";
  if (t.tripType === "Airport Taxi" && t[airportSide(t)]?.type !== "airport") return `Choose the airport as the ${airportSide(t)} for this transfer.`;
  return null;
}

/** One quote per bookable category, in parallel. Each category that cannot be priced carries its error. */
export async function estimateAll(t: QuickTrip, categories: VehicleCategory[], channel?: "nesam" | "people_taxi" | "onewaycarrentals"): Promise<CategoryEstimate[]> {
  return Promise.all(
    categories.map(async (category) => {
      try {
        const quote = await quoteAdminBooking({ ...tripToForm(t, category.id), ...(channel ? { channel } : {}) }, newRequestId(), { businessAccountId:t.businessId });
        return { category, quote, error: null };
      } catch (e) {
        return { category, quote: null, error: e instanceof ActionError ? e.message : "This category could not be priced." };
      }
    }),
  );
}

/** Breakup lines of a quote, in the reference order. */
export function breakupLines(q: FareQuote): { label: string; amount: number }[] {
  const f = q.quote;
  const lines: { label: string; amount: number }[] = [];
  const base = (f.baseFare || 0) + (f.distanceFare || 0) + (f.timeFare || 0) + (f.minimumFareAdjustment || 0);
  if (base) lines.push({ label: "Base fare", amount: base });
  if (f.driverAllowance) lines.push({ label: "Driver allowance", amount: f.driverAllowance });
  if (f.nightCharge) lines.push({ label: "Night charge", amount: f.nightCharge });
  if (f.globalAdjustment?.amount) lines.push({ label: f.globalAdjustment.name || "Fare adjustment", amount: f.globalAdjustment.direction === "decrease" ? -f.globalAdjustment.amount : f.globalAdjustment.amount });
  if (f.discount) lines.push({ label: "Discount", amount: -f.discount });
  return lines;
}

const partnerPayoutOf = (q: FareQuote | null) => {
  const p = (q as { pricing?: { partner?: { basePaise?: number } | null } } | null)?.pricing?.partner;
  return p?.basePaise ? Math.round(p.basePaise) / 100 : null;
};
const includedKmOf = (q: FareQuote | null) => {
  const p = (q as { pricing?: { includedKm?: number; quotedKm?: number } } | null)?.pricing;
  return p?.includedKm || p?.quotedKm || Math.round(q?.quote.distanceKm ?? 0);
};
const extraKmRateOf = (q: FareQuote | null) => {
  const p = (q as { pricing?: { extraKmRatePaise?: number } } | null)?.pricing;
  return p?.extraKmRatePaise ? p.extraKmRatePaise / 100 : undefined;
};
export const estimateFacts = { partnerPayoutOf, includedKmOf, extraKmRateOf };

// ── Trip fields ───────────────────────────────────────────────────────────

/** The pickup and return times use the shared 12-hour (AM / PM) control; the value stays "HH:mm". */
const TimeSelect = TimeSelect12;

interface PlaceOption {
  key: string;
  label: string;
  detail: string;
  point: () => PickedPoint;
}

const placeFromResult = (r: PlaceResult): PickedPoint => ({ lat: r.lat, lng: r.lng, name: r.name, address: r.address, type: r.type, confirmed: true, placeId: r.id });

/**
 * Pickup / drop search: saved locations plus address suggestions from the map search. Only a
 * chosen suggestion sets the point (address + coordinates); typed text alone never prices a trip.
 */
function PlaceField({ label, placeholder, text, value, saved, near, airport, onChange }: {
  label: string;
  placeholder: string;
  text: string;
  value: PickedPoint | null;
  saved: MasterLocation[];
  near: LatLng | null;
  airport?: boolean;
  onChange: (text: string, point: PickedPoint | null) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [found, setFound] = useState<PlaceResult[]>([]);
  const [foundQuery, setFoundQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const q = text.trim();

  useEffect(() => {
    if (value || q.length < 3) {
      setFound([]);
      setSearching(false);
      setFailed(false);
      return undefined;
    }
    const ctl = new AbortController();
    setSearching(true);
    const t = setTimeout(() => {
      searchPlaces(q, near, ctl.signal)
        .then((r) => {
          if (ctl.signal.aborted) return;
          setFound(r);
          setFoundQuery(q);
          setFailed(false);
        })
        .catch(() => {
          if (ctl.signal.aborted) return;
          setFound([]);
          setFailed(true);
        })
        .finally(() => {
          if (!ctl.signal.aborted) setSearching(false);
        });
    }, 350);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, value, near?.lat, near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo<PlaceOption[]>(() => {
    const lower = q.toLowerCase();
    const locs = saved.filter((l) => (!airport || l.type === "Airport") && (!lower || locLabel(l).toLowerCase().includes(lower))).slice(0, 5);
    const results = [...(airport ? [] : mainCityPlaces(q)), ...(foundQuery === q ? found : [])].filter(r => !airport || r.type === "airport");
    const remoteOption = (r: PlaceResult): PlaceOption => ({ key: r.id, label: placeLabel(r), detail: placeDetail(r), point: () => placeFromResult(r) });
    return [
      ...results.filter(r => r.kind === "city").map(remoteOption),
      ...locs.map((l) => ({ key: `loc-${l.id}`, label: l.type === "City" ? [l.name, l.state].filter(Boolean).join(", ") : l.name, detail: l.type === "City" ? "" : [l.city, l.state].filter(Boolean).join(", "), point: () => pointFromLocation(l) })),
      ...results.filter(r => r.kind !== "city").map(remoteOption),
    ].filter((option, index, all) => all.findIndex(other => other.key === option.key || other.label.toLowerCase() === option.label.toLowerCase() && other.detail.toLowerCase() === option.detail.toLowerCase()) === index).slice(0, 3);
  }, [q, saved, found, foundQuery, airport]);

  const shown = open && !value && options.length > 0;
  useEffect(() => {
    setActive(-1);
  }, [options]);
  useEffect(() => {
    if (shown && active >= 0) document.getElementById(`${id}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, shown, id]);
  const pick = (o: PlaceOption) => {
    onChange(o.label, o.point());
    setOpen(false);
    setActive(-1);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (options.length) setActive((i) => (e.key === "ArrowDown" ? (i + 1) % options.length : (i - 1 + options.length) % options.length));
    } else if (e.key === "Enter" && shown && options[active]) {
      e.preventDefault();
      pick(options[active]);
    } else if (e.key === "Escape" && shown) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const hint = value
    ? ""
    : searching
      ? "Searching places…"
      : failed
        ? "Place search is unavailable. Choose a saved location or set the pin."
        : q.length >= 3 && !options.length
          ? "No matching place. Refine the search or set the pin."
          : q
            ? "Choose a suggestion to set the location."
            : "";
  return (
    <div className="ds-field">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="ds-combo">
        <input
          id={`${id}-input`}
          className="ds-input"
          role="combobox"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 && active < options.length ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            onChange(e.target.value, null);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKey}
        />
        {text && (
          <button type="button" className="ds-combo-clear" aria-label={`Clear ${label.replace(/\s*\*$/, "").toLowerCase()}`} onClick={() => onChange("", null)}>
            <Icon name="x" size={13} />
          </button>
        )}
        {shown && (
          <ul id={`${id}-list`} role="listbox" className="ds-combo-list">
            {options.map((o, i) => (
              <li key={o.key} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} className="ds-combo-opt" title={`${o.label}\n${o.detail}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)}>
                <strong>{o.label}</strong>
                {o.detail && <small>{o.detail}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && <small className={`text-[10px] ${failed ? "text-warn" : "text-faint"}`} role={failed ? "alert" : undefined}>{hint}</small>}
    </div>
  );
}

export function TripFields({ trip, set, data, compact, idPrefix, action, allowedTripTypes }: { trip: QuickTrip; set: (p: Partial<QuickTrip>) => void; data: QuickData; compact?: boolean; idPrefix: string; action?: ReactNode; allowedTripTypes?: QuickTrip["tripType"][] }) {
  const [pin, setPin] = useState<"pickup" | "drop" | null>(null);
  const today = isoDateIST(new Date());
  const tomorrow = isoDateIST(new Date(Date.now() + 86400000));
  const service = data.services.find((s) => s.id === trip.serviceId);
  const rental = trip.tripType === "Local Rental";
  const airportAt = trip.tripType === "Airport Taxi" ? airportSide(trip) : null;
  const pickPoint = (side: "pickup" | "drop", p: PickedPoint | null, text: string) => set(side === "pickup" ? withPickup(trip, p, text) : { drop: p, dropText: text });
  return (
    <>
      <div className={compact ? "ds-quick-grid" : "ds-form-grid"}>
        <label className="ds-field" data-span={compact ? undefined : "2"}>
          <span>Service</span>
          <select className="ds-select" value={trip.serviceId || `${TRIP_OPTION}${tripOptionKey(trip)}`} onChange={(e) => {
            const v = e.target.value;
            const builtIn = v.startsWith(TRIP_OPTION) ? TRIP_SERVICES.find((x) => x.key === v.slice(TRIP_OPTION.length)) : undefined;
            if (builtIn) set({ serviceId: "", multicity: !!builtIn.multicity, ...withTripType(trip, builtIn.tripType) });
            else set({ serviceId: v, multicity: false, ...withTripType(trip, tripTypeForService(data.services.find((x) => x.id === v))) });
          }}>
            {TRIP_SERVICES.filter(x => !allowedTripTypes || allowedTripTypes.includes(x.tripType)).map((x) => <option key={x.key} value={`${TRIP_OPTION}${x.key}`}>{x.label}</option>)}
            {data.services.filter(s => !allowedTripTypes || allowedTripTypes.includes(tripTypeForService(s))).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {airportAt && (
            <span className="flex gap-3 text-[10px]" role="group" aria-label="Airport direction">
              {(["to", "from"] as const).map((d) => (
                <button key={d} type="button" className="ds-link" style={{ fontSize: 10, textDecoration: trip.airportDirection === d ? "underline" : undefined }} aria-pressed={trip.airportDirection === d} onClick={() => set({ airportDirection: d })}>
                  {d === "to" ? "To airport" : "From airport"}
                </button>
              ))}
            </span>
          )}
        </label>
        <PlaceField
          label={compact ? "Pickup" : "Pickup location *"}
          placeholder={airportAt === "pickup" ? "Airport" : "City / area / address"}
          text={trip.pickupText}
          value={trip.pickup}
          saved={data.pickups}
          near={null}
          airport={airportAt === "pickup"}
          onChange={(text, p) => pickPoint("pickup", p, text)}
        />
        {!rental && (
          <PlaceField
            label={compact ? "Drop" : "Drop location *"}
            placeholder={airportAt === "drop" ? "Airport" : "City / area / address"}
            text={trip.dropText}
            value={trip.drop}
            saved={data.drops}
            near={trip.pickup}
            airport={airportAt === "drop"}
            onChange={(text, p) => pickPoint("drop", p, text)}
          />
        )}
        <label className="ds-field">
          <span>{compact ? "Pickup date" : "Pickup date *"}</span>
          <input className="ds-input" type="date" min={today} value={trip.date} onChange={(e) => set({ date: e.target.value })} />
          <span className="flex gap-3 text-[10px]">
            <button type="button" className="ds-link" style={{ fontSize: 10 }} onClick={() => set({ date: today })}>Today</button>
            <button type="button" className="ds-link" style={{ fontSize: 10 }} onClick={() => set({ date: tomorrow })}>Tomorrow</button>
          </span>
        </label>
        <div className="ds-field">
          <label htmlFor={`${idPrefix}-time`}>{compact ? "Time · IST" : "Pickup time * · IST"}</label>
          <TimeSelect id={`${idPrefix}-time`} label="Pickup time" value={trip.time} onChange={(time) => set({ time })} />
        </div>
        {trip.tripType === "Round Trip" && !trip.multicity && (
          <>
            <label className="ds-field"><span>Return date *</span><input className="ds-input" type="date" min={trip.date || today} value={trip.endDate} onChange={(e) => set({ endDate: e.target.value })} /></label>
            <div className="ds-field">
              <label htmlFor={`${idPrefix}-end-time`}>Return time · IST</label>
              <TimeSelect id={`${idPrefix}-end-time`} label="Return time" value={trip.endTime || "20:00"} onChange={(endTime) => set({ endTime })} />
            </div>
          </>
        )}
        {action && <div className="ds-quick-action">{action}</div>}
      </div>
      <div className="ds-route-note">
        <span className="ds-dot" aria-hidden="true" />
        <div>
          <strong>{trip.pickup && trip.drop ? `${trip.pickup.name || trip.pickupText} → ${rental ? "Within city limits" : trip.drop.name || trip.dropText}` : rental ? "Choose the pickup" : "Choose pickup & drop"}</strong>
          <small>{trip.pickup && trip.drop ? "Road distance is calculated with the estimate." : `Search an address or choose from ${data.pickups.length} saved locations`}</small>
        </div>
        <small>{service?.name ?? tripServiceLabel(trip)}</small>
      </div>
      <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] text-faint">
        <span className="flex items-center gap-1.5"><Icon name="map-pin" size={13} />Location boundaries</span>
        <button type="button" className="ds-link" style={{ fontSize: 11 }} onClick={() => setPin("pickup")}>Pickup pin{trip.pickup?.confirmed ? " ✓" : ""}</button>
        {!rental && <button type="button" className="ds-link" style={{ fontSize: 11 }} onClick={() => setPin("drop")}>Drop pin{trip.drop?.confirmed ? " ✓" : ""}</button>}
      </div>
      {pin && (
        <Modal title="Verify location pin" onClose={() => setPin(null)} size="lg" footer={<Button variant="primary" onClick={() => setPin(null)}>Use verified pin</Button>}>
          <p className="text-[12px] text-muted mb-3">The pin must represent the selected pickup / drop address. Saved rule matching uses these coordinates.</p>
          <p className="text-[12px] font-semibold text-ink mb-3">{pin === "pickup" ? "Pickup" : "Drop"} · {compact ? "Dashboard Quick fare" : "New booking"}</p>
          <MapLocationPicker
            label={pin === "pickup" ? "Pickup" : "Drop"}
            tone={pin}
            value={pin === "pickup" ? trip.pickup : trip.drop}
            startNear={pin === "drop" ? trip.pickup : null}
            onChange={(p) => pickPoint(pin, p, p?.name || p?.address || (pin === "pickup" ? trip.pickupText : trip.dropText))}
          />
        </Modal>
      )}
    </>
  );
}

/** Extras & terms the office records for the trip (hill, carrier, waiting). */
export function ExtrasFields({ trip, set }: { trip: QuickTrip; set: (p: Partial<QuickTrip>) => void }) {
  return (
    <>
      <div className="flex flex-wrap gap-5 mb-3">
        <label className="ds-check"><input type="checkbox" checked={trip.hill} onChange={(e) => set({ hill: e.target.checked })} />Hill travel</label>
        <label className="ds-check"><input type="checkbox" checked={trip.carrier} onChange={(e) => set({ carrier: e.target.checked })} />Roof carrier required</label>
      </div>
      <label className="ds-field" style={{ maxWidth: 280 }}>
        <span>Expected waiting · minutes</span>
        <input className="ds-input" type="number" min={0} step={15} value={trip.waitingMin} onChange={(e) => set({ waitingMin: e.target.value })} />
      </label>
    </>
  );
}

export const extrasNote = (t: QuickTrip) =>
  [t.hill ? "Hill travel" : "", t.carrier ? "Roof carrier required" : "", Number(t.waitingMin) > 0 ? `Expected waiting ${t.waitingMin} min` : ""].filter(Boolean).join(" · ");

// ── Estimate list ─────────────────────────────────────────────────────────

/** How the quoted fare treated GST: inside the configured fare, or added on top. */
export const gstEntryOf = (q: FareQuote | null): QuickTrip["priceEntered"] => ((q as { pricing?: { gstInFare?: boolean } } | null)?.pricing?.gstInFare ? "Including GST" : "Excluding GST");

export function EstimateList({ estimates, selected, onSelect }: { estimates: CategoryEstimate[]; selected: string; onSelect: (id: string) => void; priceEntered?: string }) {
  return (
    <div className="ds-estimates">
      {estimates.map(({ category, quote, error }) => {
        const on = category.id === selected;
        const seats = (category as { seatingCapacity?: number; seats?: number }).seatingCapacity ?? (category as { seats?: number }).seats;
        return (
          <div key={category.id} className="ds-estimate" data-on={on ? "true" : undefined}>
            <button type="button" className="ds-estimate-head" onClick={() => quote && onSelect(category.id)} disabled={!quote} aria-pressed={on}>
              <span className="ds-radio" aria-hidden="true">{on && <Icon name="check" size={12} />}</span>
              <span className="min-w-0">
                <strong>{category.name}</strong>
                <small>{seats ? `${seats} passengers · ` : ""}AC</small>
              </span>
              <span className="ds-estimate-km">{quote ? `${estimateFacts.includedKmOf(quote)} km included` : error}</span>
              <span className="ds-estimate-price">
                <strong>{quote ? rupee(quote.quote.total) : "—"}</strong>
                <small>Estimated total</small>
              </span>
              <span className="ds-estimate-pick">{on ? "Selected" : "Select"}<Icon name={on ? "chevron-up" : "chevron-down"} size={13} /></span>
            </button>
            {on && quote && (
              <div className="ds-estimate-body">
                <FareBreakupCard
                  vehicle={category.name}
                  lines={breakupLines(quote)}
                  total={quote.quote.total}
                  gstRate={quote.quote.gstRate ?? 0}
                  gstAmount={quote.quote.gst}
                  extraKm={estimateFacts.extraKmRateOf(quote)}
                  payout={estimateFacts.partnerPayoutOf(quote)}
                  priceEntered={gstEntryOf(quote)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Save for follow-up ────────────────────────────────────────────────────

export function SaveEnquiryDialog({ trip, estimate, serviceName, onClose, onSaved }: {
  trip: QuickTrip;
  estimate: CategoryEstimate;
  serviceName: string;
  onClose: () => void;
  onSaved: (e: Enquiry) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [callback, setCallback] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = isoDateIST(new Date());
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (phone && !/^[6-9]\d{9}$/.test(digits)) return setError("Enter a 10-digit mobile number or leave it blank.");
    const q = estimate.quote!;
    setBusy(true);
    try {
      const at = tripPickupDate(trip);
      const { Timestamp } = await import("firebase/firestore");
      const saved = await saveEnquiry({
        pickup: trip.pickup?.address || trip.pickupText,
        drop: trip.drop?.address || trip.dropText,
        pickupPoint: trip.pickup, dropPoint: trip.drop,
        pickupAt: at ? Timestamp.fromDate(at) : null,
        serviceId: trip.serviceId, service: serviceName, tripType: trip.tripType === "Airport Taxi" ? "Airport" : trip.tripType,
        categoryId: estimate.category.id, vehicle: estimate.category.name,
        includedKm: estimateFacts.includedKmOf(q), extraKmRate: estimateFacts.extraKmRateOf(q),
        estimate: q.quote.total, breakup: breakupLines(q), gstRate: q.quote.gstRate ?? 0, payout: estimateFacts.partnerPayoutOf(q),
        customerName: name.trim(), phone: digits ? `+91${digits}` : "", whatsapp: digits ? `+91 ${digits}` : "",
        followUpAt: callback ? Timestamp.fromDate(new Date(callback)) : null,
        note: [note.trim(), extrasNote(trip)].filter(Boolean).join(" · "), source: "Phone",
        validUntil: Timestamp.fromDate(new Date(Date.now() + 86400000)),
        handler: null, nextAction: "", due: null, handoverNote: "",
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The enquiry was not saved.");
      setBusy(false);
    }
  };
  return (
    <Modal eyebrow="NESAM" title="Save enquiry for follow-up" onClose={onClose} busy={busy} footer={<Button variant="primary" type="submit" form="save-enquiry" loading={busy}>Save enquiry</Button>}>
      <form id="save-enquiry" onSubmit={save} className="grid gap-4" noValidate>
        {error && <div className="ds-error" role="alert"><Icon name="circle-alert" />{error}</div>}
        <div className="ds-sheet-card" style={{ marginBottom: 0 }}>
          <strong style={{ marginTop: 0 }}>{trip.pickup?.name || trip.pickupText} → {trip.drop?.name || trip.dropText}</strong>
          <small>Estimate {rupee(estimate.quote?.quote.total ?? null)}</small>
        </div>
        <label className="ds-field"><span>Callback mobile · optional</span><input className="ds-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
        <label className="ds-field"><span>Customer name · optional</span><input className="ds-input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="ds-field">
          <span>Callback time · optional</span>
          <DateTime12Input value={callback} onChange={setCallback} />
          <span className="flex gap-3 text-[10px]">
            <button type="button" className="ds-link" style={{ fontSize: 10 }} onClick={() => setCallback(`${today}T${(callback.slice(11) || "11:00")}`)}>Today</button>
            <button type="button" className="ds-link" style={{ fontSize: 10 }} onClick={() => setCallback(`${isoDateIST(new Date(Date.now() + 86400000))}T${(callback.slice(11) || "11:00")}`)}>Tomorrow</button>
          </span>
        </label>
        <label className="ds-field"><span>Enquiry note</span><textarea className="ds-input" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <p className="text-[11px] text-faint">With a callback number this becomes a follow-up. Without a contact it is saved as a draft enquiry.</p>
      </form>
    </Modal>
  );
}

// ── Dashboard card ────────────────────────────────────────────────────────

export function QuickFareCard({ onProceed, onSaved }: { onProceed: (trip: QuickTrip, categoryId: string, estimates: CategoryEstimate[]) => void; onSaved: (e: Enquiry) => void }) {
  const data = useQuickData();
  const [trip, setTrip] = useState<QuickTrip>(emptyTrip);
  const [estimates, setEstimates] = useState<CategoryEstimate[] | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const key = useRef("");
  const run = useRef(0);
  const latest = useRef(trip);
  latest.current = trip;
  const set = (p: Partial<QuickTrip>) => setTrip((t) => ({ ...t, ...p }));
  const sig = JSON.stringify([trip.serviceId, trip.tripType, trip.pickup?.lat, trip.pickup?.lng, trip.drop?.lat, trip.drop?.lng, trip.date, trip.time, trip.endDate, trip.endTime]);
  const stale = estimates !== null && key.current !== sig;
  const invalid = validateTrip(trip);

  /** Road distance and every category's fare from the booking server; an answer for an older trip is dropped. */
  const calculate = async (t: QuickTrip, s: string) => {
    const id = ++run.current;
    setBusy(true);
    setError(null);
    const list = await estimateAll(t, data.categories);
    if (id !== run.current) return;
    key.current = s;
    setEstimates(list);
    const first = list.find((x) => x.quote);
    setSelected((cur) => (list.some((x) => x.category.id === cur && x.quote) ? cur : first?.category.id ?? ""));
    if (!first) setError(list[0]?.error ?? "No vehicle category could be priced for this route.");
    setBusy(false);
  };

  // Recalculated whenever a fare input changes and the trip is complete; an incomplete trip cancels any pending answer.
  useEffect(() => {
    if (invalid || !data.categories.length) {
      run.current += 1;
      setBusy(false);
      return undefined;
    }
    const t = setTimeout(() => void calculate(latest.current, sig), 400);
    return () => clearTimeout(t);
  }, [sig, invalid, data.categories]); // eslint-disable-line react-hooks/exhaustive-deps

  const estimate = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return setError(invalid);
    void calculate(trip, sig);
  };
  const calculating = busy || (stale && !invalid);
  const chosen = estimates?.find((x) => x.category.id === selected && x.quote);
  const first = chosen?.quote;
  const service = data.services.find((s) => s.id === trip.serviceId);

  return (
    <section className="ds-panel ds-quick" aria-labelledby="quick-fare-title">
      <div className="ds-section-head">
        <div>
          <span className="ds-eyebrow" style={{ color: "var(--color-brand-ink)" }}>PHONE ENQUIRY</span>
          <h2 id="quick-fare-title">Quick fare</h2>
          <p>Get the estimate first. Customer details follow when booking.</p>
        </div>
      </div>
      <form className="ds-section-body" onSubmit={estimate} noValidate>
        <div className="flex flex-wrap items-center gap-3 mb-4 text-[11px]">
          <label className="flex items-center gap-2 text-[11px] text-muted">Booking for
            <select className="ds-select" style={{ minHeight: 30, fontSize: 11 }} value={trip.businessId} onChange={(e) => set({ businessId: e.target.value })}>
              <option value="">Direct customer</option>
              {data.business.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <span className="text-[10px] text-info">{trip.businessId ? "Matching business contracts apply; company credit is checked on submission" : "Existing direct-customer pricing and booking flow"}</span>
        </div>
        {error && <div className="ds-error" role="alert" style={{ marginBottom: 12 }}><Icon name="circle-alert" />{error}</div>}
        <TripFields trip={trip} set={set} data={data} compact idPrefix="dash-quick" action={<Button variant="primary" icon="refresh-cw" type="submit" loading={busy}>{estimates ? "Recalculate" : "Get estimate"}</Button>} />
        <details className="ds-disclosure">
          <summary>Trip details &amp; extras{first ? ` · ${estimateFacts.includedKmOf(first)} km` : ""}</summary>
          <ExtrasFields trip={trip} set={set} />
          <p className="text-[11px] text-faint mt-3">Toll, parking and state tax are extra at actuals.</p>
        </details>
        {calculating && (
          <p className="flex items-center gap-2 text-[11px] text-muted mt-3" role="status"><Icon name="loader-circle" size={13} className="animate-spin" />Calculating road distance and fares…</p>
        )}
        {estimates && !stale && !busy && (
          <div className="mt-4">
            {first && (
              <div className="flex flex-wrap gap-6 mb-3 text-[12px]">
                <span><strong className="text-ink text-[15px]">{Math.round(first.quote.distanceKm)} km</strong><br /><small className="text-faint">Road distance</small></span>
                <span><strong className="text-ink text-[15px]">{Math.floor(first.quote.durationMin / 60)}h {Math.round(first.quote.durationMin % 60)}m</strong><br /><small className="text-faint">Estimated travel time</small></span>
              </div>
            )}
            <h3 className="text-[13px] font-bold text-ink mb-2">Estimated fares {chosen ? `· ${rupee(chosen.quote!.quote.total)} selected · ${chosen.category.name}` : ""}</h3>
            <EstimateList estimates={estimates} selected={selected} onSelect={setSelected} priceEntered={trip.priceEntered} />
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <Button variant="primary" icon="circle-check" disabled={!chosen} onClick={() => onProceed(trip, selected, estimates)}>Proceed to booking</Button>
              <Button icon="phone-forwarded" disabled={!chosen} onClick={() => setSaving(true)}>Save for follow-up</Button>
              <span className="text-[11px] text-faint ml-auto">Name / mobile are requested after the estimate.</span>
            </div>
          </div>
        )}
        {stale && !calculating && <p className="text-[11px] text-warn mt-3">The trip changed. {invalid}</p>}
      </form>
      {saving && chosen && (
        <SaveEnquiryDialog trip={trip} estimate={chosen} serviceName={service?.name || tripServiceLabel(trip)} onClose={() => setSaving(false)} onSaved={(e) => { setSaving(false); onSaved(e); }} />
      )}
    </section>
  );
}

export const refPickupLabel = (t: QuickTrip) => {
  const d = tripPickupDate(t);
  return d ? refDateTime(d) : "";
};
