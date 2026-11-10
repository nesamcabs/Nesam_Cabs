// Step 2 — choose your cab: every vehicle category priced with the server's authoritative fare.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { RideCategory } from '@core/types';
import { quotedInclusionLine } from '@core/utils/bookingRules';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { buildFareBreakup } from '@core/utils/fareBreakup';
import { formatDate, formatDistance, formatDuration, formatINR, formatTime } from '@core/utils/format';
import { BackButton, Badge, Button, EmptyState, Notice } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useBooking, useBookingQuote } from '@/state/Booking';
import { useOnline } from '@/lib/hooks';
import { categoryGroup, categoryName, categoryPhoto, type CategoryGroup } from '@/lib/categories';
import { tripTypeLabel } from '@/lib/services';
import { CabIcon, FuelPick, type FuelChoice } from '@/components/CabParts';
import { FareDialog, FlowBar, PromoControl } from './parts';

const TOO_FAR_KM = 1500;
type Sort = 'recommended' | 'low' | 'high';

export function ChooseStep() {
  const navigate = useNavigate();
  const { draft, update, route, routeStatus, retryRoute, categories, categoryStatus, adjustment } = useBooking();
  const q = useBookingQuote();
  const { online } = useOnline();
  const [fareFor, setFareFor] = useState<RideCategory | null>(null);
  const [group, setGroup] = useState<'All' | CategoryGroup>('All');
  const [sort, setSort] = useState<Sort>('recommended');
  // The fuel chosen on each card (CNG is offered only on vehicles whose CNG rates the admin has saved).
  // The fuel chosen on each card. CNG is offered only on the cab types the admin enabled it for (and that have CNG rates saved).
  const [fuelPick, setFuelPick] = useState<Record<string, FuelChoice>>({});
  const { pickup, drop, tripType, scheduledAt, categoryId } = draft;
  // A Round Trip always ends back at the pickup: the drop is simply the last place visited.
  const sameAsPickup = !!pickup && !!drop && Math.abs(pickup.lat - drop.lat) < 0.0001 && Math.abs(pickup.lng - drop.lng) < 0.0001;
  const roundVia = tripType === 'Round Trip' ? [...draft.stops, ...(sameAsPickup || !drop ? [] : [drop])] : [];

  const groups = useMemo(() => {
    const present = new Set(categories.map(categoryGroup));
    return (['Sedan', 'SUV', 'Innova', 'Van & bus'] as CategoryGroup[]).filter((g) => present.has(g));
  }, [categories]);

  const shown = useMemo(() => {
    const list = categories.filter((c) => group === 'All' || categoryGroup(c) === group);
    if (sort === 'recommended') return list;
    const price = (c: RideCategory) => q.quotes.get(c.id)?.total ?? (sort === 'low' ? Infinity : -Infinity);
    return [...list].sort((a, b) => (sort === 'low' ? price(a) - price(b) : price(b) - price(a)));
  }, [categories, group, sort, q.quotes]);

  if (!pickup || !drop) return null;

  const tooFar = !!route && route.distanceKm > TOO_FAR_KM;
  const selected = q.category;
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
    if (c.id === selected?.id && q.breakup) return q.breakup;
    const f = q.quotes.get(c.id);
    return f ? buildFareBreakup(c, f, q.outstation) : null;
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
                  <span>{tripType === 'Round Trip' ? pickup.name : drop.id === 'place-local-disposal' ? 'Local City Disposal' : drop.name}</span>
                </p>
                {roundVia.length ? <p className="trip-sum__when">Via {roundVia.map((stop) => stop.name).join(' → ')}</p> : null}
                <p className="trip-sum__meta">
                  <span>
                    <Badge variant="blue">{tripTypeLabel(draft.multicity ? 'Multicity' : tripType)}</Badge>
                  </span>
                  {scheduledAt ? <span className="trip-sum__when">{formatDate(scheduledAt)}, {formatTime(scheduledAt)}</span> : null}
                  {route && tripType !== 'Local Rental' ? <span>{formatDistance(q.trip?.distanceKm ?? route.totalDistanceKm ?? route.distanceKm)} · about {formatDuration(q.trip?.durationMin ?? route.totalDurationMin ?? route.durationMin)}</span> : null}
                </p>
              </div>
            </section>

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


            <div className="cabs" role="radiogroup" aria-label="Available cabs">
              {categoryStatus === 'loading' && categories.length === 0 ? (
                <>
                  <div className="skeleton cab-skel" />
                  <div className="skeleton cab-skel" />
                  <div className="skeleton cab-skel" />
                </>
              ) : null}

              {shown.map((c) => {
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
                const incl = quotedInclusionLine(entry && cngAlt ? { ...entry, extraKmRate: cngAlt.extraKmRate } : entry, c, q.outstation);

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
                      <img src={photo} alt={c.name} loading="lazy" />
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

                      <ul className="cabx-rows">
                        {incl ? <li><CabIcon kind="road" size={20} /> {incl}</li> : null}
                      </ul>

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
            </div>
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
                  <img src={categoryPhoto(selected)} alt={selected.name} />
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
        onBack={() => navigate(tripType === 'Local Rental' ? '/local-rentals?mode=hourly' : '/book')}
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
