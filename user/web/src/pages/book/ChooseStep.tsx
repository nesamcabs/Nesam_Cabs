// Step 2 — choose your cab. Every bookable category with the booking server's own fare for this
// exact trip; while the server is answering, the cards wait (no invented prices). Filters and
// sorting only change what is shown, never the fare.
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
import { useCustomerData } from '@/state/CustomerData';
import { useOnline } from '@/lib/hooks';
import { categoryGroup, categoryName, categoryPhoto, type CategoryGroup } from '@/lib/categories';
import { tripTypeLabel } from '@/lib/services';
import { CabIcon, FuelPick, type FuelChoice } from '@/components/CabParts';
import { BarIconButton, FareDialog, FlowBar, PromoControl } from './parts';

const TOO_FAR_KM = 1500;
type Sort = 'recommended' | 'low' | 'high';

export function ChooseStep() {
  const navigate = useNavigate();
  const { draft, update, route, routeStatus, retryRoute, categories, categoryStatus, adjustment } = useBooking();
  const q = useBookingQuote();
  const { online } = useOnline();
  const { profile } = useCustomerData();
  const guest = !profile;
  const [fareFor, setFareFor] = useState<RideCategory | null>(null);
  const [group, setGroup] = useState<'All' | CategoryGroup>('All');
  const [sort, setSort] = useState<Sort>('recommended');
  // The fuel chosen on each card (CNG is offered only on vehicles whose CNG rates the admin has saved).
  // The fuel chosen on each card. CNG is offered only on the cab types the admin enabled it for (and that have CNG rates saved).
  const [fuelPick, setFuelPick] = useState<Record<string, FuelChoice>>({});
  const { pickup, drop, tripType, scheduledAt, tripEndAt, categoryId } = draft;
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
  // NESAM's server prices a trip only for a signed-in customer. A guest continues with the clearly
  // labelled estimate, signs in on the review step, and can submit only once the server has priced it.
  const canContinue = (q.authoritative || (guest && !!quote && !q.quoteLoading)) && !!quote && !tooFar && !!selected && !q.unavailable.has(selected.id);
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
  const when = scheduledAt ? `${formatDate(scheduledAt)} · ${formatTime(scheduledAt)}` : 'Pickup time not chosen';
  const allUnavailable = !q.quoteLoading && categories.length > 0 && categories.every((c) => q.unavailable.has(c.id));
  const loading = categoryStatus === 'loading' || (q.quoteLoading && q.quotes.size === 0);
  const connection = !online || (!guest && !!q.quoteError && q.quotes.size === 0);
  const noCategories = categories.length === 0 && (categoryStatus === 'unavailable' || categoryStatus === 'error');
  const selectedHidden = !!selected && !shown.some((c) => c.id === selected.id);

  // The confirmed fare once the server has answered; until then the estimate, clearly labelled.
  const summaryFare = quote && selected && !q.unavailable.has(selected.id) ? quote.total : null;
  const summaryLabel = q.authoritative ? 'Total fare' : q.quoteLoading ? 'Estimated fare · confirming' : 'Estimated fare';

  return (
    <div className="flow-page">
      <div className="wrap flow-page__wrap">
        <div className="choose">
          <div className="choose__main">
            <section className="trip-sum trip-sum--compact" aria-label="Your trip">
              <h1 className="sr-only">Choose your cab</h1>
              <div className="trip-sum__body">
                <p className="route-title">
                  <span>{pickup.name}</span>
                  <Icon name="arrow-right" size={14} />
                  <span>{tripType === 'Round Trip' ? pickup.name : drop.id === 'place-local-disposal' ? 'Within the city' : drop.name}</span>
                </p>
                {roundVia.length ? <p className="trip-sum__when">Via {roundVia.map((stop) => stop.name).join(' → ')}</p> : null}
                <p className="trip-sum__meta">
                  <span>
                    <Badge tone="green">{tripTypeLabel(draft.multicity ? 'Multicity' : tripType)}</Badge>
                  </span>
                  <span className="trip-sum__when">{when}</span>
                  {tripType !== 'Local Rental' ? <span>{route ? `${formatDistance(route.totalDistanceKm ?? route.distanceKm)} · about ${formatDuration(route.totalDurationMin ?? route.durationMin)}${route.estimated ? ' (estimate)' : ''}` : routeStatus === 'error' ? 'Distance unavailable' : 'Calculating distance…'}</span> : null}
                  {tripType === 'Round Trip' && tripEndAt ? <span>Return {formatDate(tripEndAt)}, {formatTime(tripEndAt)}</span> : null}
                </p>
              </div>
            </section>

            <div className="choose__notices">
              {routeStatus === 'error' ? (
                <Notice
                  tone="warning"
                  action={
                    <Button size="sm" variant="secondary" onClick={retryRoute}>
                      Try again
                    </Button>
                  }
                >
                  We couldn’t calculate the route on this device. Fares still come from NESAM’s booking server.
                </Notice>
              ) : null}
              {tooFar ? (
                <Notice tone="warning">
                  That trip is too long to book online — please <a href={`tel:${SUPPORT_PHONE}`}>call {SUPPORT_PHONE_DISPLAY}</a>.
                </Notice>
              ) : null}
              {q.days ? (
                <Notice>
                  Round trip: {q.days} chargeable calendar day{q.days === 1 ? '' : 's'} (Indian dates from pickup to return). Daily minimum kilometres and driver allowance apply to each day.
                </Notice>
              ) : null}
              {adjustment ? (
                <Notice>
                  {adjustment.name}: fares include a {adjustment.percent}% {adjustment.direction === 'increase' ? 'increase' : 'reduction'}.
                </Notice>
              ) : null}
            </div>

            {noCategories ? (
              <div className="card state-card">
                <EmptyState
                  icon="car"
                  title={categoryStatus === 'error' ? 'We couldn’t load cab types' : 'Online booking isn’t available right now'}
                  action={
                    <a className="btn btn--primary" href={`tel:${SUPPORT_PHONE}`}>
                      <Icon name="phone" size={17} /> Call {SUPPORT_PHONE_DISPLAY}
                    </a>
                  }
                >
                  {categoryStatus === 'error' ? 'Check your connection and try again, or call NESAM to book.' : `Please call ${SUPPORT_PHONE_DISPLAY} and our team will book your trip.`}
                </EmptyState>
              </div>
            ) : connection ? (
              <div className="card state-card" role="alert">
                <EmptyState
                  icon="offline"
                  title="We couldn’t reach NESAM"
                  action={
                    <div className="state-card__actions">
                      <Button icon="refresh" onClick={q.retryQuote} disabled={!online}>
                        Try again
                      </Button>
                      <Button variant="secondary" onClick={() => navigate('/book')}>
                        Change search
                      </Button>
                    </div>
                  }
                >
                  {!online ? 'You’re offline. Fares appear as soon as you reconnect.' : q.quoteError || 'Fares could not be loaded. Check your connection and try again.'}
                </EmptyState>
              </div>
            ) : loading ? (
              <div className="searching" role="status" aria-live="polite">
                <p className="searching__label">
                  <span className="spinner" aria-hidden="true" /> Finding cabs for your journey…
                </p>
                <ul className="cabs" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="skeleton cab-skel" />
                  ))}
                </ul>
              </div>
            ) : allUnavailable ? (
              <div className="card state-card">
                <EmptyState
                  icon="clock"
                  title="No cabs available for this trip"
                  action={
                    <div className="state-card__actions">
                      <Button icon="clock" onClick={() => navigate('/book')}>
                        Change time
                      </Button>
                      <a className="btn btn--secondary" href={`tel:${SUPPORT_PHONE}`}>
                        <Icon name="phone" size={17} /> Call NESAM
                      </a>
                    </div>
                  }
                >
                  {q.unavailable.get(categories[0]!.id) || 'Try a different pickup time, or call NESAM and we’ll help you plan it.'}
                </EmptyState>
              </div>
            ) : (
              <>
                {guest && !q.authoritative && !q.quoteLoading ? (
                  <Notice>These are estimates. Sign in on the next step and NESAM’s booking server confirms the exact fare before you submit.</Notice>
                ) : q.quoteError ? (
                  <Notice
                    tone="error"
                    action={
                      <Button size="sm" variant="secondary" icon="refresh" onClick={q.retryQuote} disabled={!online}>
                        Try again
                      </Button>
                    }
                  >
                    We couldn’t confirm fares with NESAM. The amounts below are estimates; you can continue once the fare is confirmed.
                  </Notice>
                ) : null}
                <h2 className="sr-only" id="cabs-h">
                  Available cabs
                </h2>
                <ul className="cabs" role="radiogroup" aria-labelledby="cabs-h">
                  {shown.map((c) => {
                    const cngAlt = fuelOf(c) === 'cng' ? cngOf(c) : null;
                    const fare = cngAlt ? cngAlt.fare : q.quotes.get(c.id);
                    const on = c.id === categoryId;
                    const reason = q.unavailable.get(c.id) ?? '';
                    const blocked = tooFar || !!reason;
                    const entry = q.entries.get(c.id);
                    const strikeTotal = (cngAlt ? cngAlt.strikeTotal : entry?.strikeTotal) ?? 0;
                    const strike = fare && strikeTotal > 0 && fare.total > 0 ? Math.round((fare.taxableAmount * strikeTotal) / fare.total) : 0;
                    const incl = quotedInclusionLine(entry && cngAlt ? { ...entry, extraKmRate: cngAlt.extraKmRate } : entry, c, q.outstation);
                    return (
                      <li key={c.id}>
                        <label className={`cab ${on ? 'is-selected' : ''} ${blocked ? 'is-disabled' : ''}`}>
                          <input type="radio" name="cab" className="cab__radio" checked={on} disabled={blocked} onChange={() => chooseCategory(c)} />
                          <span className="cab__tick" aria-hidden="true">
                            <Icon name="check" size={12} />
                          </span>
                          <span className="cab__photo">
                            <img src={categoryPhoto(c)} alt="" width={360} height={220} loading="lazy" />
                          </span>
                          <span className="cab__info">
                            <strong className="cab__name">{categoryName(c)}</strong>
                            <span className="cabx-facts">
                              <span><CabIcon kind="seat" size={20} /> {c.seats} seats</span>
                              <span><CabIcon kind="ac" size={20} /> AC</span>
                              <span><CabIcon kind="bag" size={20} /> {((c as any).luggage ?? (c.seats >= 6 ? 4 : 2))} bags</span>
                            </span>
                            {incl ? (
                              <span className="cabx-rows">
                                <span><CabIcon kind="road" size={20} /> {incl}</span>
                              </span>
                            ) : null}
                            {cngOf(c) && !blocked ? <FuelPick name={`fuel-${c.id}`} value={fuelOf(c)} onChange={(f) => chooseFuel(c, f)} /> : null}
                            {fare ? (
                              <button
                                type="button"
                                className="cab__details"
                                onClick={(e) => {
                                  e.preventDefault();
                                  setFareFor(c);
                                }}
                              >
                                <Icon name="info" size={13} /> Fare details
                              </button>
                            ) : null}
                          </span>
                          <span className="cab__price">
                            {reason ? (
                              <span className="cab__na">{reason}</span>
                            ) : fare ? (
                              <>
                                {strike > 0 ? <s className="cab__strike">{formatINR(strike)}</s> : null}
                                <strong className="num">{formatINR(fare.taxableAmount)}</strong>
                                <small className="cab__tax">{q.quoteLoading ? 'Confirming fare…' : fare.gst > 0 ? `+ ${formatINR(fare.gst)} GST` : ''}</small>
                              </>
                            ) : q.quoteLoading ? (
                              <span className="skeleton cab__price-skel" />
                            ) : (
                              <small>Fare unavailable</small>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <Notice tone="warning">Toll, parking and state permits are paid separately, against receipts.</Notice>
              </>
            )}
          </div>

          <aside className="choose__aside" aria-label="Your selection">
            <div className="sel-card">
              <div className="sel-card__top">
                <span className="sel-card__eyebrow">Your selection</span>
                <Icon name="shield-check" size={16} />
              </div>
              {selected ? (
                <>
                  <div className="sel-card__car">
                    <div>
                      <strong>{categoryName(selected)}</strong>
                    </div>
                    <img src={categoryPhoto(selected)} alt="" width={180} height={110} />
                  </div>
                  <div className="cab__badges">
                    <span className="feat feat--seats">
                      <Icon name="passengers" size={13} /> {selected.seats} passengers
                    </span>
                    <span className="feat feat--ac">
                      <Icon name="air-conditioning" size={13} /> AC
                    </span>
                  </div>
                </>
              ) : (
                <p className="muted small">Choose a cab to see its fare.</p>
              )}
              <dl className="sel-card__trip">
                <div>
                  <dt>Pickup location</dt>
                  <dd>{pickup.name}</dd>
                </div>
                <div>
                  <dt>Drop location</dt>
                  <dd>{drop.id === 'place-local-disposal' ? 'Within the city' : drop.name}</dd>
                </div>
                <div className="sel-card__when">
                  <Icon name="calendar" size={14} /> {when}
                </div>
              </dl>
              <div className="sel-card__total">
                <span>{summaryLabel}</span>
                <strong className="num">{summaryFare != null ? formatINR(summaryFare) : q.quoteLoading ? '…' : '—'}</strong>
              </div>
              {q.coupon ? <p className="sel-card__saving">Includes {q.coupon.code}: −{formatINR(q.coupon.discount)}</p> : null}
              <p className="sel-card__fine">Toll, parking &amp; state tax are extra, paid separately against receipts.</p>
              <PromoControl />
              <Button block size="lg" icon="arrow-right" disabled={!canContinue} onClick={() => navigate('/book/confirm')}>
                Book Now
              </Button>
              {selected && breakupFor(selected) ? (
                <button type="button" className="link-btn sel-card__fare" onClick={() => setFareFor(selected)}>
                  View fare details
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      </div>

      <FlowBar back={() => navigate('/book')} className="flow-bar--choose">
        <div className="flow-bar__total flow-bar__total--solo flow-bar__total--icons">
          <BarIconButton icon="arrow-left" label="Back to trip details" onClick={() => navigate('/book')} />
          <Button size="lg" disabled={!canContinue} onClick={() => navigate('/book/confirm')}>
            Continue
          </Button>
          <BarIconButton icon="home" label="Home" onClick={() => navigate('/book')} />
        </div>
      </FlowBar>

      {fareFor && breakupFor(fareFor) && q.quotes.get(fareFor.id) ? (
        <FareDialog title={`${categoryName(fareFor)} · fare details`} lines={breakupFor(fareFor)!.lines} total={q.quotes.get(fareFor.id)!.total} estimated={!q.authoritative} onClose={() => setFareFor(null)} />
      ) : null}
    </div>
  );
}
