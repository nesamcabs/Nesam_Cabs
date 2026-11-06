// Step 2 of New booking, drawn as the customer sites draw "Choose your vehicle": the trip summary and the vehicle cards on the
// left, the Trip Summary card with the fare and Book Now on the right. The cards are the admin's priced categories, so the
// choice, the fare and the follow-up are the same as before; only the look and the order of the screen are the customer's.
import { useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "../ui";
import { rupee } from "../../domain/officeStage";
import {
  estimateFacts, refPickupLabel, tripServiceLabel,
  type CategoryEstimate, type QuickTrip,
} from "./QuickFare";

type CabIconKind = "seat" | "ac" | "bag" | "road";
const PAL: Record<CabIconKind, { bg: string; fg: string }> = {
  seat: { bg: "#e8f0ff", fg: "#2f6df6" },
  ac: { bg: "#e0f6fb", fg: "#0aa4c4" },
  bag: { bg: "#fff1d6", fg: "#d98a00" },
  road: { bg: "#ffe9e0", fg: "#e8590c" },
};
const PATHS: Record<CabIconKind, ReactNode> = {
  seat: (<><circle cx="12" cy="8" r="3.2" /><path d="M5.5 19c.6-3.4 3.2-5.2 6.5-5.2s5.9 1.8 6.5 5.2" /></>),
  ac: (<><path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" /><path d="m9.6 4.6 2.4 1.9 2.4-1.9M9.6 19.4l2.4-1.9 2.4 1.9" /></>),
  bag: (<><rect x="5" y="8" width="14" height="11.5" rx="2.4" /><path d="M9.2 8V6.4A1.6 1.6 0 0 1 10.8 4.8h2.4a1.6 1.6 0 0 1 1.6 1.6V8M5 13h14" /></>),
  road: (<><path d="M8.2 20 10 4M15.8 20 14 4" /><path d="M12 6.5v2.2M12 11.2v2.4M12 16v2.2" /></>),
};
/** The customer sites' coloured round icon on the vehicle card. */
function CabIcon({ kind, size = 20 }: { kind: CabIconKind; size?: number }) {
  const { bg, fg } = PAL[kind];
  const style: CSSProperties = { width: size, height: size, background: bg, color: fg };
  return (
    <span className="cabx-ico" style={style} aria-hidden="true">
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.68)} height={Math.round(size * 0.68)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">{PATHS[kind]}</svg>
    </span>
  );
}

export default function CustomerChooseStep({ trip, set, estimates, selected, onSelect, renderBreakup, onContinue, onEdit, onSave, canSeePayout }: {
  trip: QuickTrip;
  set: (p: Partial<QuickTrip>) => void;
  estimates: CategoryEstimate[];
  selected: string;
  onSelect: (id: string) => void;
  renderBreakup: (e: CategoryEstimate) => ReactNode;
  onContinue: () => void;
  onEdit: () => void;
  onSave: () => void;
  canSeePayout: boolean;
}) {
  const [fareFor, setFareFor] = useState<CategoryEstimate | null>(null);
  const chosen = estimates.find((e) => e.category.id === selected && e.quote) ?? null;
  const first = estimates.find((e) => e.quote)?.quote ?? null;
  const roadKm = first ? Math.round(first.roadKm ?? first.quote.distanceKm) : null;
  const roadMin = first ? Math.round(first.roadMinutes ?? first.quote.durationMin) : null;
  const pickupName = trip.pickup?.name || trip.pickupText;
  const dropName = trip.tripType === "Local Rental" ? "Within City Disposal" : trip.drop?.name || trip.dropText;
  const viaNames = trip.tripType === "Round Trip" && !trip.multicity ? (trip.stops ?? []).map((s) => s.point?.name || s.text).filter(Boolean) : [];
  const label = tripServiceLabel(trip);
  const q = chosen?.quote ?? null;

  return (
    <div className="flow-page flow-page--choose">
      <div className="wrap flow-page__wrap">
        <div className="choose">
          <div className="choose__main">
            <section className="trip-sum trip-sum--compact" aria-label="Trip summary">
              <div className="trip-sum__body">
                <p className="route-title">
                  <span>{pickupName}</span>
                  <Icon name="arrow-right" size={14} />
                  <span>{trip.tripType === "Round Trip" ? pickupName : dropName}</span>
                </p>
                {viaNames.length ? <p className="trip-sum__when">Via {viaNames.join(" → ")}</p> : null}
                <p className="trip-sum__meta">
                  <span><span className="badge badge--blue">{label}</span></span>
                  <span className="trip-sum__when">{refPickupLabel(trip)}</span>
                  {roadKm !== null && trip.tripType !== "Local Rental" ? <span>{roadKm} km · about {Math.floor((roadMin ?? 0) / 60)}h {(roadMin ?? 0) % 60}m</span> : null}
                </p>
              </div>
            </section>

            <div className="cabs" role="radiogroup" aria-label="Available cabs">
              {estimates.map((e) => {
                const c = e.category;
                const quote = e.quote;
                const on = c.id === selected;
                const disabled = !quote;
                const total = quote?.quote.total ?? 0;
                const gst = quote?.quote.gst ?? 0;
                const incl = quote ? `${Math.round(estimateFacts.includedKmOf(quote))} km included · extra ${rupee(estimateFacts.extraKmRateOf(quote))}/km` : "";
                const bags = c.luggageCapacity ?? (c.seatingCapacity >= 6 ? 4 : 2);
                return (
                  <div
                    key={c.id}
                    className={`cab ${on ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}
                    role="radio"
                    aria-checked={on}
                    tabIndex={disabled ? -1 : 0}
                    onClick={() => !disabled && onSelect(c.id)}
                    onKeyDown={(ev) => { if ((ev.key === " " || ev.key === "Enter") && !disabled) { ev.preventDefault(); onSelect(c.id); } }}
                  >
                    <span className="cab__tick" aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
                    <div className="cab__photo">{c.imageUrl ? <img src={c.imageUrl} alt={c.name} loading="lazy" /> : <span className="cf-nophoto"><Icon name="car-front" size={34} /></span>}</div>
                    <div className="cab__info">
                      <div className="cab__header">
                        <h3 className="cab__name">{c.name}</h3>
                        <ul className="cabx-facts">
                          <li><CabIcon kind="seat" /> {c.seatingCapacity} seats</li>
                          <li><CabIcon kind="ac" /> AC</li>
                          <li><CabIcon kind="bag" /> {bags} bags</li>
                        </ul>
                      </div>
                      <ul className="cabx-rows">{incl ? <li><CabIcon kind="road" /> {incl}</li> : null}</ul>
                      {quote ? (
                        <button type="button" className="cab__breakup-btn" onClick={(ev) => { ev.stopPropagation(); setFareFor(e); }}>
                          <Icon name="info" size={12} /> Fare details
                        </button>
                      ) : null}
                    </div>
                    <div className="cab__price">
                      {quote ? (
                        <>
                          <strong>{rupee(total - gst)}</strong>
                          {gst > 0 ? <small className="cab__tax">+ {rupee(gst)} GST</small> : null}
                        </>
                      ) : (
                        <span className="cab__na">{e.error || "Unavailable for this route"}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <aside className="choose__aside">
            <div className="sel-card">
              <div className="sel-card__top">
                <span className="sel-card__eyebrow">Trip Summary</span>
                <span className="badge badge--blue">{label}</span>
              </div>

              {chosen ? (
                <div className="sel-card__car">
                  <div>
                    <strong>{chosen.category.name}</strong>
                    <small className="muted">{chosen.category.seatingCapacity} seats · AC</small>
                  </div>
                  {chosen.category.imageUrl ? <img src={chosen.category.imageUrl} alt={chosen.category.name} /> : null}
                </div>
              ) : (
                <div className="sel-card__placeholder muted">Please choose a vehicle category from the list.</div>
              )}

              <dl className="sel-card__trip">
                <div><dt>Pickup Point</dt><dd>{pickupName}</dd></div>
                <div><dt>Destination</dt><dd>{dropName}</dd></div>
                <div><dt>Pickup Schedule</dt><dd>{refPickupLabel(trip)}</dd></div>
              </dl>

              <div className="cf-extras">
                <label className="check"><input type="checkbox" className="check__input" checked={trip.hill} onChange={(ev) => set({ hill: ev.target.checked })} /><span className="check__label"><strong>Hill travel</strong></span></label>
                <label className="check"><input type="checkbox" className="check__input" checked={trip.carrier} onChange={(ev) => set({ carrier: ev.target.checked })} /><span className="check__label"><strong>Roof carrier (+{rupee(chosen?.category.fare?.carrierCharge ?? 0)} / trip)</strong></span></label>
                <label className="check"><input type="checkbox" className="check__input" checked={trip.pets === true} onChange={(ev) => set({ pets: ev.target.checked })} /><span className="check__label"><strong>Travelling with pets (+{rupee(chosen?.quote?.addOnRates?.petCharge ?? 0)} / trip)</strong></span></label>
                <input className="input bf-input cf-sm" inputMode="numeric" aria-label="Expected waiting in minutes" placeholder="Waiting (minutes)" value={trip.waitingMin === "0" ? "" : trip.waitingMin} onChange={(ev) => set({ waitingMin: ev.target.value.replace(/\D/g, "") || "0" })} />
              </div>

              {q ? (
                <>
                  <div className="sel-card__total">
                    <div><span>Estimated Upfront Fare</span></div>
                    <strong>{rupee(q.quote.total)}</strong>
                  </div>
                  {canSeePayout ? <p className="sel-card__fine">Partner payout {rupee(estimateFacts.partnerPayoutOf(q))}</p> : null}
                  <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onContinue}>Book Now <Icon name="arrow-right" size={18} /></button>
                  <button type="button" className="btn btn--secondary btn--block cf-gap" onClick={onSave}>Save for follow-up</button>
                </>
              ) : (
                <button type="button" className="btn btn--primary btn--lg btn--block" disabled>Select a Cab</button>
              )}
              <button type="button" className="btn btn--text cf-gap" onClick={onEdit}>Edit trip details</button>
            </div>
          </aside>
        </div>
      </div>

      {fareFor ? (
        <div className="overlay overlay--dialog" onMouseDown={(ev) => ev.target === ev.currentTarget && setFareFor(null)} onKeyDown={(ev) => ev.key === "Escape" && setFareFor(null)}>
          <div className="dialog dialog--dialog dialog--wide" role="dialog" aria-modal="true" aria-label="Fare details">
            <div className="dialog__head">
              <div><h2>Fare Breakup &amp; Exclusions</h2></div>
              <button type="button" className="btn btn--ghost btn--sm" aria-label="Close" onClick={() => setFareFor(null)}><Icon name="x" size={18} /></button>
            </div>
            <div className="dialog__body">{renderBreakup(fareFor)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
