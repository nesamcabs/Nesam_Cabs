// Step 2 — choose your cab: every vehicle category priced with the server's authoritative fare.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RideCategory } from '@core/types';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { breakupFromFare } from '@core/utils/fareBreakup';
import { formatDate, formatDistance, formatDuration, formatINR, formatTime } from '@core/utils/format';
import { BackButton, Badge, Button, EmptyState, Notice } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useBooking, useBookingQuote } from '@/state/Booking';
import { useOnline } from '@/lib/hooks';
import { categoryGroup, categoryName, categoryPhoto, type CategoryGroup } from '@/lib/categories';
import { tripTypeLabel } from '@/lib/services';
import { CabIcon, FuelPick, type FuelChoice } from '@/components/CabParts';
import { FareDialog, FlowBar, PromoControl } from './parts';
import { RoundVehiclePackage } from './RoundVehiclePackage';
import { EditTripDialog } from './EditTripDialog';
import { packageClock, packageDay } from '@core/utils/timePackages';

const TOO_FAR_KM = 1500;
type Sort = 'recommended' | 'low' | 'high';

export function ChooseStep() {
  const navigate = useNavigate();
  const { draft, update, route, routeStatus, retryRoute, categories, categoryStatus, adjustment } = useBooking();
  const q = useBookingQuote();
  const { online } = useOnline();
  const [fareFor, setFareFor] = useState<RideCategory | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [group, setGroup] = useState<'All' | CategoryGroup>('All');
  const [sort, setSort] = useState<Sort>('recommended');
  // The fuel chosen on each card (CNG is offered only on vehicles whose CNG rates the admin has saved).
  // The fuel chosen on each card. CNG is offered only on the cab types the admin enabled it for (and that have CNG rates saved).
  const [fuelPick, setFuelPick] = useState<Record<string, FuelChoice>>({});
  const { pickup, drop, tripType, scheduledAt, categoryId } = draft;
  // A Round Trip always ends back at the pickup: the drop is simply the last place visited. A Multicity tour does not: it ends at its own final drop.
  const sameAsPickup = !!pickup && !!drop && Math.abs(pickup.lat - drop.lat) < 0.0001 && Math.abs(pickup.lng - drop.lng) < 0.0001;
  const returnsToPickup = tripType === 'Round Trip' && !draft.multicity;
  const roundVia = draft.multicity ? draft.stops : returnsToPickup ? [...draft.stops, ...(sameAsPickup || !drop ? [] : [drop])] : [];

  // A cab type the office turned off for this location is left out completely: no card, no tab.
  const visible = useMemo(() => categories.filter((c) => !q.hidden.has(c.id)), [categories, q.hidden]);
  const groups = useMemo(() => {
    const present = new Set(visible.map(categoryGroup));
    return (['Sedan', 'SUV', 'Innova', 'Van & bus'] as CategoryGroup[]).filter((g) => present.has(g));
  }, [visible]);

  const shown = useMemo(() => {
    const list = visible.filter((c) => group === 'All' || categoryGroup(c) === group);
    if (sort === 'recommended') return list;
    const price = (c: RideCategory) => q.quotes.get(c.id)?.total ?? (sort === 'low' ? Infinity : -Infinity);
    return [...list].sort((a, b) => (sort === 'low' ? price(a) - price(b) : price(b) - price(a)));
  }, [visible, group, sort, q.quotes]);

  // If the chosen cab type is one that is now hidden, move to the first one still offered.
  useEffect(() => {
    if (!categoryId || !q.hidden.has(categoryId)) return;
    const next = visible.find((c) => !q.unavailable.has(c.id)) ?? visible[0];
    if (next) update({ categoryId: next.id, fuelType: '' });
  }, [categoryId, q.hidden, q.unavailable, visible, update]);

  if (!pickup || !drop) return null;

  const tooFar = !!route && route.distanceKm > TOO_FAR_KM;
  const selected = q.category;
  const roundPick = tripType === 'Round Trip' && !draft.multicity;
  const quote = q.quote;
  const canContinue = q.authoritative && !!quote && !tooFar && !!selected && !q.unavailable.has(selected.id);
  const cngOf = (c: RideCategory) => q.entries.get(c.id)?.cng ?? null;
  const fuelOf = (c: RideCategory): FuelChoice => (cngOf(c) ? fuelPick[c.id] ?? (c.id === categoryId && draft.fuelType === 'cng' ? 'cng' : 'diesel') : 'diesel');
  const chooseCategory = (c: RideCategory) => update({ categoryId: c.id, fuelType: fuelOf(c) === 'cng' ? 'cng' : '' });
  const chooseFuel = (c: RideCategory, f: FuelChoice) => {
    setFuelPick((p) => ({ ...p, [c.id]: f }));
    update({ categoryId: c.id, fuelType: f === 'cng' ? 'cng' : '' });
  };
  const breakupFor = (c: RideCategory) => {
    const alt = fuelOf(c) === 'cng' ? cngOf(c) : null;
    if (alt) return alt.breakup;
    // The server's own breakup for this vehicle: it carries the night allowance and the platform fee when they apply.
    const own = q.entries.get(c.id);
    if (own?.ok && own.breakup) return own.breakup;
    if (c.id === selected?.id && q.breakup) return q.breakup;
    const f = q.quotes.get(c.id);
    return f ? breakupFromFare(f) : null;
  };

  const handleNext = () => {
    if (canContinue) navigate('/book/confirm');
  };

  return (
    <div className="flow-page flow-page--choose">
      <div className="wrap flow-page__wrap">
        <div className="choose">
          <div className="choose__main">
            <section className="trip-sum trip-sum--compact" aria-label="Trip summary">
              <h1 className="sr-only">Choose your vehicle</h1>
              <div className="trip-sum__body">
                <p className="route-title">
                  <span>{pickup.name}</span>
                  <Icon name="arrow-right" size={14} />
                  <span>{returnsToPickup ? pickup.name : drop.id === 'place-local-disposal' ? 'Local City Disposal' : drop.name}</span>
                </p>
                {roundVia.length ? <p className="trip-sum__when">Via {roundVia.map((stop) => stop.name).join(' → ')}</p> : null}
                <p className="trip-sum__meta">
                  <span>
                    <Badge variant="blue">{tripTypeLabel(draft.multicity ? 'Multicity' : tripType)}</Badge>
                  </span>
                  {scheduledAt ? <span className="trip-sum__when">{formatDate(scheduledAt)}, {formatTime(scheduledAt)}</span> : null}
                  {tripType === 'Round Trip' && !draft.multicity && q.selectedPackage ? (
                    <span className="trip-sum__when">{q.selectedPackage.days} calendar {q.selectedPackage.days === 1 ? 'day' : 'days'} · Return by {packageDay(new Date(q.selectedPackage.endAt))}, {packageClock(new Date(q.selectedPackage.endAt))}</span>
                  ) : null}
                  {route && tripType !== 'Local Rental' ? <span>{formatDistance(q.trip?.distanceKm ?? route.totalDistanceKm ?? route.distanceKm)} · about {formatDuration(q.trip?.durationMin ?? route.totalDurationMin ?? route.durationMin)}</span> : null}
                </p>
                {tripType !== 'Local Rental' ? (
                  <button type="button" className="trip-sum__edit" onClick={() => setEditOpen(true)} aria-label="Edit pickup date, time and trip days">
                    <Icon name="edit" size={13} /> Edit
                  </button>
                ) : null}
              </div>
            </section>
            {editOpen ? <EditTripDialog onClose={() => setEditOpen(false)} /> : null}

            <div className="choose__notices">
              {!online ? (
                <Notice variant="error" icon="warning">
                  You are offline right now. Vehicle prices will update automatically once connection is restored.
                </Notice>
              ) : null}

              {routeStatus === 'error' ? (
                <Notice
                  variant="warning"
                  icon="warning"
                  action={
                    <Button variant="secondary" size="sm" onClick={retryRoute}>
                      Retry Route
                    </Button>
                  }
                >
                  We couldn't get highway routing right now. Fares use direct distance until road routing reconnects.
                </Notice>
              ) : null}

              {tooFar ? (
                <Notice variant="warning" icon="warning">
                  Journeys over {TOO_FAR_KM} km require a custom multi-day itinerary.{' '}
                  <a href={`tel:${SUPPORT_PHONE}`}>Call {SUPPORT_PHONE_DISPLAY}</a> to plan with dispatch.
                </Notice>
              ) : null}

              {categoryStatus === 'error' ? (
                <Notice variant="error" icon="warning">
                  We couldn't load the available vehicles. Please check your connection and refresh the page.
                </Notice>
              ) : categoryStatus === 'unavailable' ? (
                <Notice variant="warning" icon="warning">
                  No vehicles are configured for online booking right now. Please call <a href={`tel:${SUPPORT_PHONE}`}>{SUPPORT_PHONE_DISPLAY}</a>.
                </Notice>
              ) : null}

              {q.quoteError ? (
                <Notice
                  variant="error"
                  icon="warning"
                  action={<Button variant="secondary" size="sm" onClick={q.retryQuote}>Retry Fare</Button>}
                >
                  {q.quoteError}
                </Notice>
              ) : null}
            </div>


            {q.customQuote ? (
              <Notice variant="warning" icon="info">
                Round trips of {draft.tripDays} days are quoted individually, so the fare is not shown here. Please{' '}
                <a href={`tel:${SUPPORT_PHONE}`}>call {SUPPORT_PHONE_DISPLAY}</a> for a custom quote, or choose fewer days.
              </Notice>
            ) : null}

            {q.hillStations.length ? (
              <Notice variant="info" icon="info">
                <strong>Hill station trip · {q.hillStations.map((h) => h.name).join(', ')}.</strong>{' '}
                A separate “Hill Station Allowance / Charge” is added to your fare{q.breakup?.lines.some((l) => l.key === 'hillStation') ? '' : ' (confirmed by our team)'}.
                {tripType === 'Round Trip' ? ' The 5-hour and 8-hour packages do not apply to hill stations.' : ''}
              </Notice>
            ) : null}

            {!roundPick && q.packages.length ? (
              <section className="pkgs" aria-labelledby="pkgs-title">
                <h2 id="pkgs-title" className="pkgs__title">Choose your round-trip package</h2>
                {q.autoDays ? (
                  <p className="pkgs__auto">
                    <Icon name="clock" size={15} /> No same-day package fits this pickup time and trip, so it is planned as a {q.packages[0]?.days ?? 2}-day trip.
                  </p>
                ) : null}
                <div className="pkgs__list" role="radiogroup" aria-label="Round-trip packages">
                  {q.packages.map((p) => {
                    const on = p.id === q.selectedPackage?.id;
                    const end = new Date(p.endAt);
                    const sameDay = scheduledAt ? packageDay(end) === packageDay(scheduledAt) : true;
                    const dayLabel = p.days === 1 ? 'Same day' : `${p.days} calendar days`;
                    const split = p.dayKm && p.dayKm.length > 1
                      ? ` (First day: ${p.dayKm[0]} km + ${p.dayKm.length === 2 ? 'Next day' : `Each next day`}: ${p.dayKm[1]} km)`
                      : '';
                    const detail = p.kind === 'morning'
                      ? 'Overnight · back by 9:00 AM (strict)'
                      : p.hours
                        ? `Up to ${p.hours} hours`
                        : p.kind === 'next_day'
                          ? `${dayLabel}${split}`
                          : 'Full day';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`pkg ${on ? 'is-selected' : ''}`}
                        onClick={() => update({ timePackage: p.id })}
                      >
                        <span className="pkg__tick" aria-hidden="true">{on ? <Icon name="check" size={13} /> : null}</span>
                        <span className="pkg__body">
                          <strong>{p.label}</strong>
                          <small>{detail} · {p.includedKm} km included</small>
                          <small><b>Return by {sameDay ? '' : `${packageDay(end)}, `}{packageClock(end)}</b> · Driver bata included · Extra {formatINR(p.extraKmRate)}/km</small>
                          {p.upgrade ? <small className="pkg__note">Still running after {packageClock(new Date(p.morningCutoffAt ?? p.endAt))}? It upgrades to {p.upgrade.label} (+{formatINR(p.upgrade.increase)}, {p.upgrade.includedKm} km included).</small> : null}
                        </span>
                        <span className="pkg__price">
                          {p.strikeTotal && p.strikeTotal > p.fare.total ? <s>{formatINR(Math.round((p.fare.taxableAmount * p.strikeTotal) / p.fare.total))}</s> : null}
                          <b>{formatINR(p.fare.taxableAmount)}</b>
                          {p.fare.gst > 0 ? <small>+ {formatINR(p.fare.gst)} GST</small> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="pkgs__fine">Driver bata is included. Toll, parking and state permit / entry tax are extra. Your package is the minimum charge; a longer or farther trip moves to the next package.</p>
              </section>
            ) : null}

            {roundPick ? (
              <RoundVehiclePackage
                categories={visible}
                selected={selected}
                entries={q.entries}
                unavailable={q.unavailable}
                packages={q.packages}
                selectedPackage={q.selectedPackage}
                autoDays={q.autoDays}
                fuel={selected ? fuelOf(selected) : 'diesel'}
                hasCng={!!selected && !!cngOf(selected)}
                scheduledAt={scheduledAt}
                loading={categoryStatus === 'loading'}
                quoteLoading={q.quoteLoading}
                onPickVehicle={chooseCategory}
                onPickPackage={(id) => update({ timePackage: id })}
                onFuel={chooseFuel}
                onFareDetails={setFareFor}
              />
            ) : null}

            {roundPick ? null : <div className="cabs" role="radiogroup" aria-label="Available cabs">
              {categoryStatus === 'loading' && categories.length === 0 ? (
                <>
                  <div className="skeleton cab-skel" />
                  <div className="skeleton cab-skel" />
                  <div className="skeleton cab-skel" />
                </>
              ) : null}

              {shown.map((c, index) => {
                const isSelected = c.id === categoryId;
                const cngAlt = fuelOf(c) === 'cng' ? cngOf(c) : null;
                const fare = cngAlt ? cngAlt.fare : q.quotes.get(c.id);
                const unavailable = q.unavailable.has(c.id);
                const disabled = unavailable || tooFar;
                const photo = categoryPhoto(c);
                const name = categoryName(c);
                const b = breakupFor(c);
                const entry = q.entries.get(c.id);
                const strikeTotal = (cngAlt ? cngAlt.strikeTotal : entry?.strikeTotal) ?? 0;
                const strike = fare && strikeTotal > 0 && fare.total > 0 ? Math.round((fare.taxableAmount * strikeTotal) / fare.total) : 0;

                return (
                  <div
                    key={c.id}
                    className={`cab ${isSelected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                    onClick={() => !disabled && chooseCategory(c)}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={disabled ? -1 : 0}
                    onKeyDown={(e) => {
                      if ((e.key === ' ' || e.key === 'Enter') && !disabled) {
                        e.preventDefault();
                        chooseCategory(c);
                      }
                    }}
                  >
                    <span className="cab__tick" aria-hidden="true">
                      {isSelected ? <Icon name="check" size={13} /> : null}
                    </span>

                    <div className="cab__photo">
                      <img src={photo} alt={c.name} loading={index < 4 ? 'eager' : 'lazy'} decoding="async" fetchPriority={index < 2 ? 'high' : 'auto'} />
                    </div>

                    <div className="cab__info">
                      <div className="cab__header">
                        <h3 className="cab__name">{c.iconUrl ? <img className="cab__category-icon" src={c.iconUrl} alt="" width={24} height={24} loading="lazy" /> : null}{name}</h3>
                        <ul className="cabx-facts">
                          <li><CabIcon kind="seat" size={20} /> {c.seats} seats</li>
                          <li><CabIcon kind="ac" size={20} /> AC</li>
                          <li><CabIcon kind="bag" size={20} /> {((c as any).luggage ?? (c.seats >= 6 ? 4 : 2))} bags</li>
                        </ul>
                      </div>

                      {cngOf(c) ? <FuelPick name={`fuel-${c.id}`} value={fuelOf(c)} onChange={(f) => !disabled && chooseFuel(c, f)} /> : null}

                      {fare ? (
                        <button
                          type="button"
                          className="cab__breakup-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFareFor(c);
                          }}
                        >
                          <Icon name="info" size={12} /> Fare details
                        </button>
                      ) : null}

                    </div>

                    <div className="cab__price">
                      {fare ? (
                        <>
                          {strike > 0 ? <s className="cab__strike">{formatINR(strike)}</s> : null}
                          <strong>{formatINR(fare.taxableAmount)}</strong>
                          {fare.gst > 0 ? <small className="cab__tax">+ {formatINR(fare.gst)} GST</small> : null}
                          {fare.discount > 0 ? (
                            <span className="cab__saving">Save {formatINR(fare.discount)}</span>
                          ) : null}
                        </>
                      ) : unavailable ? (
                        <span className="cab__na">{q.unavailable.get(c.id) || 'Unavailable for this route'}</span>
                      ) : (
                        <span className="cab__price-skel skeleton" />
                      )}
                    </div>
                  </div>
                );
              })}

              {shown.length === 0 && categoryStatus === 'ready' ? (
                <EmptyState
                  title="No vehicles match this filter"
                  action={
                    <Button variant="secondary" onClick={() => setGroup('All')}>
                      Show All Vehicles
                    </Button>
                  }
                >
                  Try selecting "All Vehicles" to browse our complete driver fleet.
                </EmptyState>
              ) : null}
            </div>}
          </div>

          <aside className="choose__aside">
            <div className="sel-card">
              <div className="sel-card__top">
                <span className="sel-card__eyebrow">Trip Summary</span>
                <Badge variant="blue">{tripTypeLabel(draft.multicity ? 'Multicity' : tripType)}</Badge>
              </div>

              {selected ? (
                <div className="sel-card__car">
                  <div>
                    <strong>{categoryName(selected)}</strong>
                    <small className="muted">{selected.seats} seats · AC</small>
                  </div>
                  <img src={categoryPhoto(selected)} alt={selected.name} decoding="async" />
                </div>
              ) : (
                <div className="sel-card__placeholder muted">Please choose a vehicle category from the list.</div>
              )}

              <dl className="sel-card__trip">
                <div>
                  <dt>Pickup Point</dt>
                  <dd>{pickup.name}</dd>
                </div>
                <div>
                  <dt>Destination</dt>
                  <dd>{drop.id === 'place-local-disposal' ? 'Within City Disposal' : drop.name}</dd>
                </div>
                {scheduledAt ? (
                  <div>
                    <dt>Pickup Schedule</dt>
                    <dd>{formatDate(scheduledAt)}, {formatTime(scheduledAt)}</dd>
                  </div>
                ) : null}
              </dl>

              <PromoControl
                code={draft.promoCode}
                applied={!!quote && quote.discount > 0}
                onApply={(code) => update({ promoCode: code })}
                onRemove={() => update({ promoCode: '' })}
              />

              {quote ? (
                <>
                  <div className="sel-card__total">
                    <div>
                      <span>Estimated Upfront Fare</span>
                      {quote.discount > 0 ? (
                        <p className="sel-card__saving">Promo applied: -{formatINR(quote.discount)}</p>
                      ) : null}
                    </div>
                    <strong>{formatINR(quote.total)}</strong>
                  </div>

                  <p className="sel-card__fine">
                    
                  </p>

                  <Button
                    variant="primary"
                    size="lg"
                    block
                    disabled={!canContinue}
                    onClick={handleNext}
                    iconTrailing="arrow-right"
                  >
                    Book Now
                  </Button>
                </>
              ) : (
                <Button variant="primary" size="lg" block disabled>
                  Select a Cab
                </Button>
              )}
            </div>
          </aside>
        </div>
      </div>

      <FlowBar
        onNext={handleNext}
        nextLabel="Continue"
        nextDisabled={!canContinue}
        total={quote?.total}
        hideFare
        onBack={() => navigate(tripType === 'Local Rental' ? '/local-rentals?mode=hourly' : draft.multicity ? '/book?service=multicity' : '/book')}
        backLabel="Back"
        onHome={() => navigate('/')}
      />

      {fareFor && breakupFor(fareFor) ? (
        <FareDialog fare={breakupFor(fareFor)!} onClose={() => setFareFor(null)} />
      ) : null}
    </div>
  );
}
export default ChooseStep;
