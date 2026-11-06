// The booking form on the NESAM Cabs home page: service, route, schedule and "Search Cabs".
// Places are real coordinates (search, device location, saved/recent places, map pin); the
// schedule follows the booking server's rules; fares are only ever priced by the server.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GeoPlace } from '@core/types';
import { useCustomerData } from '@/state/customer';
import { reverseGeocode } from '@core/services/geoService';
import { SUPPORT_PHONE, SUPPORT_PHONE_DISPLAY } from '@core/config/constants';
import { scheduleProblem } from '@core/utils/bookingRules';
import { haversineKm, isValidLatLng } from '@core/utils/geo';
import { Button, Tabs } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LocationPicker, type PickerConfig } from '@/components/LocationPicker';
import { TimePicker, formatTime12 } from '@/components/TimePicker';
import { useBooking } from '@/state/Booking';
import { useAuth } from '@/state/Auth';
import { setPendingReturn } from '@/lib/pendingReturn';
import { saveDraft, RENTAL_PACKAGE_HOURS } from '@/lib/draft';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { ClockIcon, SwapIcon } from '@/components/CabParts';
import { combineDateTime, latestPickup, toDateInput, toTimeInput } from '@/lib/schedule';
import { LOCAL_RENTALS_LABEL, SERVICES, SERVICE_TITLE, isLocalRentals, type ServiceId } from '@/lib/services';
import { AIRPORTS, QUICK_CITIES, isAirportPlace } from './content';
import { MulticityForm } from './MulticityForm';
import { ServiceIcon } from '@/components/ServiceIcon';

type Field = 'pickup' | 'drop' | 'stops' | 'hours' | 'date' | 'time' | 'retDate' | 'retTime' | 'form';
type Errors = Partial<Record<Field, string>>;
export type AirportDirection = 'to' | 'from';

const disposalFor = (pickup: GeoPlace): GeoPlace => ({
  id: 'place-local-disposal',
  name: 'Local City Disposal',
  address: `${pickup.name} & City Limits (Within city disposal)`,
  // A point a few hundred metres inland from the pickup: it only stands for "within the city" and is never priced by distance.
  lat: pickup.lat + 0.003,
  lng: pickup.lng - 0.003,
  type: 'other',
});

/** Airport direction follows the draft: whichever end is an airport. */
const directionOf = (pickup: GeoPlace | null, drop: GeoPlace | null): AirportDirection => (isAirportPlace(pickup) && !isAirportPlace(drop) ? 'from' : 'to');

/** "Today", "Tomorrow" or the weekday, shown on the date field so the chosen day is clear at a glance. */
const dayHint = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long' });
};

/** Round trips are booked for up to this many days (the server's roundTrip.maxDays). */
const RT_MAX_DAYS = 30;
/** The calendar date `n` days after a YYYY-MM-DD date (plain calendar arithmetic). */
const addDaysISO = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return toDateInput(new Date(y!, m! - 1, d! + n));
};

export function BookingForm({
  service,
  onService,
  outstationTrip,
  onOutstationTrip,
}: {
  service: ServiceId;
  onService: (s: ServiceId) => void;
  outstationTrip: 'One Way' | 'Round Trip';
  onOutstationTrip: (t: 'One Way' | 'Round Trip') => void;
}) {
  const navigate = useNavigate();
  const { draft, update } = useBooking();
  const { state: auth, openLoginModal } = useAuth();
  const { trips, savedPlaces } = useCustomerData();
  const { position } = useDeviceLocation(true);
  const { online } = useOnline();
  const { pickup, drop, scheduledAt, tripEndAt, tripType } = draft;
  const isRound = service === 'outstation' && tripType === 'Round Trip';

  const [picker, setPicker] = useState<'pickup' | 'drop' | null>(null);
  const [stopPicker, setStopPicker] = useState<number | 'new' | null>(null);
  const [timeFor, setTimeFor] = useState<'pickup' | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [direction, setDirection] = useState<AirportDirection>(() => directionOf(pickup, drop));
  const refs = useRef<Partial<Record<Field, HTMLElement | null>>>({});
  const pickupFromGps = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A device location the rider already allowed becomes the pickup, unless they chose one.
  useEffect(() => {
    if (!position || pickupFromGps.current || pickup || service === 'airport') return;
    pickupFromGps.current = true;
    void reverseGeocode(position).then((p) => {
      if (mounted.current) update((d) => (d.pickup ? {} : { pickup: { ...p, type: 'current' } }));
    });
  }, [position, pickup, update, service]);

  // Rentals drive within the pickup city: the destination is the city-disposal placeholder.
  useEffect(() => {
    if (service === 'rental' && pickup && (!drop || drop.id !== 'place-local-disposal')) update({ drop: disposalFor(pickup) });
  }, [service, pickup?.lat, pickup?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Schedule (local date + time inputs mirrored into the draft) ─────────
  const [date, setDate] = useState(() => (scheduledAt ? toDateInput(scheduledAt) : toDateInput(new Date())));
  const [time, setTime] = useState(() => (scheduledAt ? toTimeInput(scheduledAt) : ''));
  useEffect(() => {
    const d = combineDateTime(date, time);
    if ((d?.getTime() ?? null) !== (scheduledAt?.getTime() ?? null)) update({ scheduledAt: d });
  }, [date, time]); // eslint-disable-line react-hooks/exhaustive-deps
  // Round trip: the customer chooses how many days the trip lasts. It ends on the last day, at the pickup time.
  const [days, setDays] = useState<number>(() => {
    if (!tripEndAt || !scheduledAt) return 1;
    const n = Math.round((Date.parse(toDateInput(tripEndAt)) - Date.parse(toDateInput(scheduledAt))) / 86400000) + 1;
    return n >= 1 && n <= RT_MAX_DAYS ? n : 1;
  });
  useEffect(() => {
    const end = isRound && date && time ? combineDateTime(addDaysISO(date, days - 1), time) : null;
    if ((end?.getTime() ?? null) !== (tripEndAt?.getTime() ?? null)) update({ tripEndAt: end });
  }, [date, time, days, isRound]); // eslint-disable-line react-hooks/exhaustive-deps

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: GeoPlace[] = [];
    for (const t of trips) {
      for (const p of [t.drop, t.pickup]) {
        if (!isValidLatLng(p) || seen.has(p.name) || p.id === 'place-local-disposal') continue;
        seen.add(p.name);
        out.push({ ...p, id: `recent-${t.id}-${p.id}`, type: 'recent' });
      }
    }
    return out.slice(0, 6);
  }, [trips]);

  const airportField: 'pickup' | 'drop' = direction === 'to' ? 'drop' : 'pickup';
  const pickerConfig = (f: 'pickup' | 'drop'): PickerConfig => {
    const airportOnly = service === 'airport' && f === airportField;
    return {
      title: f === 'pickup' ? (service === 'rental' ? 'Choose your pickup location' : 'Pickup location') : 'Drop location',
      allowCurrent: !airportOnly,
      popular: airportOnly ? AIRPORTS : QUICK_CITIES,
      popularLabel: airportOnly ? 'Airports' : service === 'rental' && f === 'pickup' ? 'Your city' : 'Popular locations',
      near: f === 'drop' ? (pickup ?? position) : position,
      pinMode: airportOnly ? undefined : f,
      ...(airportOnly ? { resultFilter: isAirportPlace, subtitle: 'Search for an airport.', placeholder: 'Search airport', emptyText: 'No airports found. Try the airport or city name.' } : {}),
      check: airportOnly ? (p) => (isAirportPlace(p) ? '' : 'Choose an airport for this transfer.') : service === 'airport' ? (p) => (isAirportPlace(p) ? 'The other end of an airport transfer should be your city address, not an airport.' : '') : undefined,
    };
  };

  const setField = (f: 'pickup' | 'drop', p: GeoPlace) => {
    if (f === 'pickup') pickupFromGps.current = true;
    update({ [f]: p } as Partial<typeof draft>);
    setErrors((e) => ({ ...e, [f]: '', form: '' }));
  };

  const changeDirection = (d: AirportDirection) => {
    if (d === direction) return;
    setDirection(d);
    update({ pickup: drop, drop: pickup });
    setErrors({});
  };

  // ── Validation ──────────────────────────────────────────────────────────
  const validate = (): Errors => {
    const e: Errors = {};
    if (!online) e.form = 'You’re offline. Reconnect to see fares.';
    if (!pickup) e.pickup = service === 'airport' && airportField === 'pickup' ? 'Choose the airport.' : 'Choose your pickup location.';
    if (service !== 'rental' && !drop) e.drop = service === 'airport' && airportField === 'drop' ? 'Choose the airport.' : 'Choose your drop location.';
    if (service === 'rental' && !draft.rentalHours) e.hours = 'Select the rental hours.';
    if (service === 'pickup' && pickup && drop && haversineKm(pickup, drop) > 40) e.drop = 'Pickup & Drop is for trips inside one city. For a longer trip choose Outstation.';
    if (service === 'airport') {
      const ap = airportField === 'pickup' ? pickup : drop;
      if (ap && !isAirportPlace(ap)) e[airportField] = 'Choose an airport for this transfer.';
    }
    if (pickup && drop && service !== 'rental' && !(service === 'outstation' && tripType === 'Round Trip') && haversineKm(pickup, drop) < 0.2) e.drop = 'Pickup and drop are too close together.';
    if (tripType === 'Round Trip' && service === 'outstation') {
      const points = [pickup, ...draft.stops, drop].filter((p): p is GeoPlace => p !== null);
      if (points.some((p, index) => index > 0 && haversineKm(points[index - 1]!, p) < 0.2)) e.stops = 'Consecutive itinerary locations cannot be the same.';
    }
    if (isRound && (!days || days < 1 || days > RT_MAX_DAYS)) e.retDate = `Choose 1 to ${RT_MAX_DAYS} days.`;
    const at = combineDateTime(date, time);
    // Local Taxi is on demand: it has no pickup date or time to check.
    if (service === 'local') return e;
    if (!date) e.date = 'Choose a pickup date.';
    else if (!time) e.time = 'Choose a pickup time.';
    else {
      const p = scheduleProblem(at);
      if (p) e.time = p;
    }
    return e;
  };

  const search = () => {
    if (service === 'rental' && pickup && (!drop || drop.id !== 'place-local-disposal')) update({ drop: disposalFor(pickup) });
    const e = validate();
    setErrors(e);
    const first = (['pickup', 'stops', 'drop', 'hours', 'date', 'time', 'retDate', 'retTime'] as Field[]).find((f) => e[f]);
    if (first) {
      refs.current[first]?.focus();
      refs.current[first]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (e.form) return;
    // Local Taxi has its own live flow (zone check, fares, instant booking).
    if (service === 'local') {
      update({ tripType: 'One Way', multicity: false });
      navigate('/local-taxi');
      return;
    }
    // A normal search is never a Multicity tour (that flag is set only by the Multicity form).
    if (draft.multicity) update({ multicity: false });
    if (auth.status !== 'ready') {
      // Account/profile loading can remount the form. Persist before opening phone sign-in;
      // PendingReturn resumes selection after authentication and the existing legal gate.
      saveDraft({ ...draft, multicity: false });
      setPendingReturn('/book/ride');
      openLoginModal({
        title: 'Sign in to compare fares',
        subtitle: 'Verify your mobile number to continue with your saved trip.',
      });
      return;
    }
    navigate('/book/ride');
  };

  const title = service === 'outstation' ? `${outstationTrip} Outstation` : SERVICE_TITLE[service];
  const fieldErr = (f: Field) =>
    errors[f] ? (
      <p className="bf-error" id={`bf-${f}-err`} role="alert">
        {errors[f]}
      </p>
    ) : null;

  const locationField = (f: 'pickup' | 'drop', label: string) => {
    const p = f === 'pickup' ? pickup : drop;
    const airportSide = service === 'airport' && f === airportField;
    return (
      <div className={`bf-field ${errors[f] ? 'is-invalid' : ''}`}>
        <span className={`bf-pin bf-pin--${f}`} aria-hidden="true" />
        <div className="bf-field__main">
          <span className="bf-label" id={`bf-${f}-label`}>
            {label}
          </span>
          <button
            ref={(el) => {
              refs.current[f] = el;
            }}
            type="button"
            className={`bf-trigger ${p ? '' : 'is-empty'}`}
            aria-labelledby={`bf-${f}-label bf-${f}-value`}
            aria-describedby={errors[f] ? `bf-${f}-err` : undefined}
            aria-invalid={!!errors[f] || undefined}
            onClick={() => setPicker(f)}
          >
            <span id={`bf-${f}-value`} className="bf-trigger__text">
              {p ? p.name : ''}
            </span>
          </button>
          {p && p.address !== p.name && p.id !== 'place-local-disposal' ? <small className="bf-addr">{p.address}</small> : null}
        </div>
        <Icon name="chevron-right" size={16} className="bf-chev" />
      </div>
    );
  };

  const stopField = (stop: GeoPlace, index: number) => (
    <div className="bf-field bf-stop-field" key={`${stop.id}-${index}`}><div className="bf-field__main"><span className="bf-label" id={`bf-stop-${index}-label`}>Stop {index + 1}</span><button type="button" className="bf-trigger" aria-labelledby={`bf-stop-${index}-label bf-stop-${index}-value`} onClick={() => setStopPicker(index)}><span id={`bf-stop-${index}-value`} className="bf-trigger__text">{stop.name}</span></button></div><button type="button" className="bf-stop-remove" aria-label={`Delete stop ${index + 1}`} title={`Delete stop ${index + 1}`} onClick={() => update((d) => ({ stops: d.stops.filter((_, n) => n !== index) }))}><Icon name="trash" size={17} /></button></div>
  );

  return (
    <section className="bf" id="book-console" aria-labelledby="bf-title">
      <div className="bf-head">
        <h2 id="bf-title">{title}</h2>
        <p>{service === 'multicity' ? 'Plan multi-stop itineraries with transparent upfront package quotes.' : 'Verified drivers. Upfront fares. Pay at drop.'}</p>
      </div>

      <div className="bf-services" role="group" aria-label="Services">
        {SERVICES.filter((s) => s.id !== 'local' && s.id !== 'pickup').map((s) => {
          // The rental slot is the "Local Rentals" button: it holds both the hourly rental and the pickup & drop.
          const grouped = s.id === 'rental';
          const active = grouped ? isLocalRentals(service) : service === s.id;
          return (
            <button key={s.id} type="button" className={`bf-service ${active ? 'is-active' : ''}`} aria-pressed={active} aria-controls="bf-form" onClick={() => (grouped && isLocalRentals(service) ? undefined : onService(s.id))}>
              <span className="bf-service__icon">
                <ServiceIcon id={s.id} size={30} />
              </span>
              <span>{grouped ? LOCAL_RENTALS_LABEL : s.label}</span>
            </button>
          );
        })}
      </div>

      {isLocalRentals(service) ? (
        <Tabs
          className="bf-journey bf-journey--local"
          active={service}
          onChange={(v) => {
            onService(v as ServiceId);
            setErrors({});
          }}
          items={[
            { id: 'rental', label: 'Hourly Rental' },
            { id: 'pickup', label: 'Pickup & Drop' },
          ]}
        />
      ) : null}

      {service === 'outstation' ? (
        <Tabs
          className="bf-journey"
          active={outstationTrip}
          onChange={(v) => {
            onOutstationTrip(v as 'One Way' | 'Round Trip');
            setErrors({});
          }}
          items={[
            { id: 'One Way', label: 'One Way' },
            { id: 'Round Trip', label: 'Round Trip' },
          ]}
        />
      ) : service === 'airport' ? (
        <Tabs
          className="bf-journey"
          active={direction}
          onChange={(v) => changeDirection(v as AirportDirection)}
          items={[
            { id: 'to', label: 'To airport' },
            { id: 'from', label: 'From airport' },
          ]}
        />
      ) : null}

      {service === 'multicity' ? (
        <MulticityForm />
      ) : (
        <form
          id="bf-form"
          className="bf-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <div className={`bf-route ${service === 'rental' ? 'bf-route--single' : ''} ${service === 'outstation' && outstationTrip === 'Round Trip' ? 'bf-route--round' : ''}`}>
            <div className="bf-route__cell">
              {locationField('pickup', service === 'rental' ? 'Pickup location' : service === 'airport' && direction === 'from' ? 'Pickup airport' : 'Pickup location')}
              {fieldErr('pickup')}
              {service === 'rental' ? <p className="bf-hint">Pick your city, then search an address or drop the pin where the cab and driver should meet you.</p> : null}
            </div>
            {(service === 'outstation' && outstationTrip !== 'Round Trip') || service === 'local' || service === 'pickup' ? (
              <button
                type="button"
                className="bf-swap"
                aria-label="Swap pickup and drop"
                title="Swap route"
                disabled={!pickup && !drop}
                onClick={() => {
                  update((d) => ({ pickup: d.drop, drop: d.pickup, stops: d.tripType === 'Round Trip' ? [...d.stops].reverse() : d.stops }));
                  setErrors((e) => ({ ...e, pickup: '', drop: '' }));
                }}
              >
                <SwapIcon size={22} />
              </button>
            ) : null}
            {service === 'outstation' && outstationTrip === 'Round Trip' ? <>{draft.stops.map(stopField)}
                <div className="bf-route__tools">
                  {draft.stops.length < 8 ? <button type="button" className="bf-round-stop-add" onClick={() => setStopPicker('new')}><Icon name="plus" size={16} /> Add stop</button> : null}
                  <button
                    type="button"
                    className="bf-swap"
                    aria-label="Swap pickup and drop"
                    title="Swap route"
                    disabled={!pickup && !drop}
                    onClick={() => {
                      update((d) => ({ pickup: d.drop, drop: d.pickup, stops: d.tripType === 'Round Trip' ? [...d.stops].reverse() : d.stops }));
                      setErrors((e) => ({ ...e, pickup: '', drop: '' }));
                    }}
                  >
                    <SwapIcon size={22} />
                  </button>
                </div>
                {fieldErr('stops')}</> : null}
            {service !== 'rental' ? (
              <div className="bf-route__cell">
                {locationField('drop', service === 'airport' && direction === 'to' ? 'Drop airport' : 'Drop location')}
                {fieldErr('drop')}
                {service === 'local' ? <p className="bf-hint">Local Taxi is for a pickup and drop inside the same city.</p> : null}
                {service === 'pickup' ? <p className="bf-hint">Pickup & Drop is for a trip inside one city. Choose both places on the map, then the date and time.</p> : null}
              </div>
            ) : null}
          </div>
          {service === 'rental' ? (
            <>
          <div className="bf-row bf-row--single">
            <div className="bf-cell">
              <label className="bf-label bf-label--out" htmlFor="bf-rental-hours">Rental hours</label>
              <select id="bf-rental-hours" className="input bf-input" value={draft.rentalHours ?? ''} onChange={(e) => update({ rentalHours: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Select hours</option>
                {RENTAL_PACKAGE_HOURS.map((h) => <option key={h} value={h}>{h} hours</option>)}
              </select>
              {fieldErr('hours')}
            </div>
          </div>
            </>
          ) : null}

          {service !== 'local' ? (
          <div className={isRound ? 'bf-row bf-row--trio' : 'bf-row'}>
            <div className="bf-cell">
              <label className="bf-label bf-label--out" htmlFor="bf-date">
                Pickup date
              </label>
              <div className="bf-datewrap">
                <input
                  ref={(el) => {
                    refs.current.date = el;
                  }}
                  id="bf-date"
                  className="input bf-input"
                  type="date"
                  value={date}
                  min={toDateInput(new Date())}
                  max={toDateInput(latestPickup())}
                  aria-invalid={!!errors.date || undefined}
                  aria-describedby={errors.date ? 'bf-date-err' : undefined}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setErrors((x) => ({ ...x, date: '', time: '' }));
                  }}
                />
                {date ? <span className="bf-chip">{dayHint(date)}</span> : null}
              </div>
              {fieldErr('date')}
            </div>
            <div className="bf-cell">
              <span className="bf-label bf-label--out" id="bf-time-label">
                Pickup time
              </span>
              <button
                ref={(el) => {
                  refs.current.time = el;
                }}
                type="button"
                className={`bf-time ${time ? '' : 'is-empty'}`}
                aria-labelledby="bf-time-label bf-time-value"
                aria-invalid={!!errors.time || undefined}
                aria-describedby={errors.time ? 'bf-time-err' : undefined}
                onClick={() => setTimeFor('pickup')}
              >
                <span id="bf-time-value">{time ? formatTime12(time) : ''}</span>
                <ClockIcon size={26} />
              </button>
              {fieldErr('time')}
            </div>
            {isRound ? (
              <div className="bf-cell">
                <label className="bf-label bf-label--out" htmlFor="bf-days">
                  Days
                </label>
                <select
                  id="bf-days"
                  className="bf-days__input"
                  value={days}
                  aria-invalid={!!errors.retDate || undefined}
                  onChange={(e) => {
                    setDays(Number(e.target.value));
                    setErrors((x) => ({ ...x, retDate: '' }));
                  }}
                >
                  {Array.from({ length: RT_MAX_DAYS }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'day' : 'days'}
                    </option>
                  ))}
                </select>
                <span className="bf-days__end">{date ? `Ends ${dayHint(addDaysISO(date, days - 1))}` : 'Pick a date'}</span>
                {fieldErr('retDate')}
              </div>
            ) : null}
          </div>
          ) : null}


          {errors.form ? (
            <p className="bf-error bf-error--form" role="alert">
              {errors.form}
            </p>
          ) : null}
          <Button type="submit" size="lg" block className="bf-submit">
            {service === 'local' ? 'See fares' : 'Let’s Go !'}
          </Button>
        </form>
      )}

      {picker ? (
        <LocationPicker
          config={pickerConfig(picker)}
          saved={savedPlaces}
          recent={recent}
          onClose={() => setPicker(null)}
          onSelect={(p) => {
            setField(picker, p);
            setPicker(null);
          }}
        />
      ) : null}
      {stopPicker !== null ? <LocationPicker config={{ title: stopPicker === 'new' ? 'Add itinerary stop' : `Edit stop ${stopPicker + 1}`, allowCurrent: true, popular: QUICK_CITIES, popularLabel: 'Popular locations', near: pickup ?? position, pinMode: 'drop' }} saved={savedPlaces} recent={recent} onClose={() => setStopPicker(null)} onSelect={(place) => { update((d) => ({ stops: stopPicker === 'new' ? [...d.stops, place] : d.stops.map((stop, index) => index === stopPicker ? place : stop) })); setErrors((e) => ({ ...e, stops: '', form: '' })); setStopPicker(null); }} /> : null}
      {timeFor ? (
        <TimePicker
          title="Pickup time"
          date={date}
          value={time}
          validate="pickup"
          notBefore={null}
          onClose={() => setTimeFor(null)}
          onConfirm={(t) => {
            setTime(t);
            setErrors((x) => ({ ...x, time: '' }));
            setTimeFor(null);
          }}
        />
      ) : null}
    </section>
  );
}
