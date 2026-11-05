// The booking form on the home page: service, route, schedule and "Search Cabs".
// Places are real coordinates (search, device location, saved/recent places, map pin); the
// schedule follows the booking server's rules; fares are only ever priced by the server.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GeoPlace } from '@core/types';
import { useCustomerData } from '@/state/CustomerData';
import { reverseGeocode } from '@core/services/geoService';
import { scheduleProblem } from '@core/utils/bookingRules';
import { haversineKm, isValidLatLng } from '@core/utils/geo';
import { Button, Tabs } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LocationPicker, type PickerConfig } from '@/components/LocationPicker';
import { TimePicker, formatTime12 } from '@/components/TimePicker';
import { useBooking } from '@/state/Booking';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { ClockIcon, SwapIcon } from '@/components/CabParts';
import { combineDateTime, latestPickup, toDateInput, toTimeInput } from '@/lib/schedule';
import { SERVICES, SERVICE_TITLE, type ServiceId } from '@/lib/services';
import { AIRPORTS, QUICK_CITIES, isAirportPlace } from './content';
import { RENTAL_PACKAGE_HOURS } from '@/lib/draft';
import { MulticityForm } from './MulticityForm';

type Field = 'pickup' | 'drop' | 'stops' | 'date' | 'time' | 'endDate' | 'endTime' | 'form';
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
  const { trips, savedPlaces } = useCustomerData();
  const { position } = useDeviceLocation(true);
  const { online } = useOnline();
  const { pickup, drop, scheduledAt, tripEndAt, tripType } = draft;

  const [picker, setPicker] = useState<'pickup' | 'drop' | null>(null);
  const [stopPicker, setStopPicker] = useState<number | 'new' | null>(null);
  const [timeFor, setTimeFor] = useState<'pickup' | 'return' | null>(null);
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
  const [endDate, setEndDate] = useState(() => (tripEndAt ? toDateInput(tripEndAt) : ''));
  const [endTime, setEndTime] = useState(() => (tripEndAt ? toTimeInput(tripEndAt) : ''));
  useEffect(() => {
    const d = combineDateTime(date, time);
    if ((d?.getTime() ?? null) !== (scheduledAt?.getTime() ?? null)) update({ scheduledAt: d });
  }, [date, time]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const d = tripType === 'Round Trip' ? combineDateTime(endDate, endTime) : null;
    if ((d?.getTime() ?? null) !== (tripEndAt?.getTime() ?? null)) update({ tripEndAt: d });
  }, [endDate, endTime, tripType]); // eslint-disable-line react-hooks/exhaustive-deps

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
      check: airportOnly ? (p) => (isAirportPlace(p) ? '' : 'Choose an airport for this transfer.') : service === 'airport' ? (p) => (isAirportPlace(p) ? 'The other end of an airport transfer should be your address, not an airport.' : '') : undefined,
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
    // Swap so the airport stays on the airport side.
    update({ pickup: drop, drop: pickup });
    setErrors({});
  };

  // ── Validation ──────────────────────────────────────────────────────────
  const validate = (): Errors => {
    const e: Errors = {};
    if (!online) e.form = 'You’re offline. Reconnect to see fares.';
    if (!pickup) e.pickup = service === 'airport' && airportField === 'pickup' ? 'Choose the airport.' : 'Choose your pickup location.';
    if (service !== 'rental' && !drop) e.drop = service === 'airport' && airportField === 'drop' ? 'Choose the airport.' : 'Choose your drop location.';
    if (service === 'airport') {
      const ap = airportField === 'pickup' ? pickup : drop;
      if (ap && !isAirportPlace(ap)) e[airportField] = 'Choose an airport for this transfer.';
    }
    if (pickup && drop && service !== 'rental' && !(service === 'outstation' && tripType === 'Round Trip') && haversineKm(pickup, drop) < 0.2) e.drop = 'Pickup and drop are too close together.';
    if (tripType === 'Round Trip' && service === 'outstation') {
      const points = [pickup, ...draft.stops, drop].filter((p): p is GeoPlace => p !== null);
      if (points.some((p, index) => index > 0 && haversineKm(points[index - 1]!, p) < 0.2)) e.stops = 'Consecutive itinerary locations cannot be the same.';
    }
    const at = combineDateTime(date, time);
    if (!date) e.date = 'Choose a pickup date.';
    else if (!time) e.time = 'Choose a pickup time.';
    else {
      const p = scheduleProblem(at);
      if (p) e.time = p;
    }
    if (tripType === 'Round Trip' && service === 'outstation') {
      const end = combineDateTime(endDate, endTime);
      if (!endDate) e.endDate = 'Choose the return date.';
      else if (!endTime) e.endTime = 'Choose the return time.';
      else if (at && end && end.getTime() <= at.getTime()) e.endTime = 'The return must be after the pickup.';
    }
    return e;
  };

  const search = () => {
    if (service === 'rental' && pickup && (!drop || drop.id !== 'place-local-disposal')) update({ drop: disposalFor(pickup) });
    const e = validate();
    setErrors(e);
    const first = (['pickup', 'stops', 'drop', 'date', 'time', 'endDate', 'endTime'] as Field[]).find((f) => e[f]);
    if (first) {
      refs.current[first]?.focus();
      refs.current[first]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (e.form) return;
    // A normal search is never a Multicity tour (that flag is set only by the Multicity form).
    if (draft.multicity) update({ multicity: false });
    navigate('/book/ride');
  };

  const title = service === 'outstation' ? outstationTrip : SERVICE_TITLE[service];
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
    <div className="bf-field bf-stop-field" key={`${stop.id}-${index}`}>
      <div className="bf-field__main">
        <span className="bf-label" id={`bf-stop-${index}-label`}>Stop {index + 1}</span>
        <button type="button" className="bf-trigger" aria-labelledby={`bf-stop-${index}-label bf-stop-${index}-value`} onClick={() => setStopPicker(index)}>
          <span id={`bf-stop-${index}-value`} className="bf-trigger__text">{stop.name}</span>
        </button>
      </div>
      <button type="button" className="bf-stop-remove" aria-label={`Delete stop ${index + 1}`} title={`Delete stop ${index + 1}`} onClick={() => update((d) => ({ stops: d.stops.filter((_, n) => n !== index) }))}>
        <Icon name="trash" size={17} />
      </button>
    </div>
  );

  return (
    <section className="bf" id="book-console" aria-labelledby="bf-title">
      <div className="bf-head">
        <h2 id="bf-title">{title}</h2>
        <p>Choose your trip. We will take care of the drive.</p>
      </div>

      <div className="bf-services" role="group" aria-label="Service">
        {SERVICES.map((s) => (
          <button key={s.id} type="button" className={`bf-service ${service === s.id ? 'is-active' : ''}`} aria-pressed={service === s.id} aria-controls="bf-form" onClick={() => onService(s.id)}>
            <span className="bf-service__icon">
              <Icon name={s.icon} size={24} />
            </span>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      {service === 'outstation' ? (
        <Tabs
          className="bf-journey"
          label="Journey type"
          value={outstationTrip}
          onChange={(v) => {
            onOutstationTrip(v);
            setErrors({});
          }}
          options={[
            { value: 'One Way', label: 'One Way' },
            { value: 'Round Trip', label: 'Round Trip' },
          ]}
        />
      ) : service === 'airport' ? (
        <Tabs
          className="bf-journey"
          label="Airport direction"
          value={direction}
          onChange={changeDirection}
          options={[
            { value: 'to', label: 'To airport' },
            { value: 'from', label: 'From airport' },
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
            {service === 'outstation' && outstationTrip !== 'Round Trip' ? (
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
                <Icon name="swap" size={16} />
              </button>
            ) : null}
            {service === 'outstation' && outstationTrip === 'Round Trip' ? (
              <>
                {draft.stops.map(stopField)}
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
                    <Icon name="swap" size={16} />
                  </button>
                </div>
                {fieldErr('stops')}
              </>
            ) : null}
            {service !== 'rental' ? (
              <div className="bf-route__cell">
                {locationField('drop', service === 'airport' && direction === 'to' ? 'Drop airport' : 'Drop location')}
                {fieldErr('drop')}
              </div>
            ) : null}
          </div>
          {service === 'rental' ? (
            <>
          <div className="bf-row bf-row--single">
            <div className="bf-cell">
              <label className="bf-label bf-label--out" htmlFor="bf-rental-hours">Rental package</label>
              <select id="bf-rental-hours" className="input bf-input" value={draft.rentalHours ?? ''} onChange={(e) => update({ rentalHours: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Any package</option>
                {RENTAL_PACKAGE_HOURS.map((h) => <option key={h} value={h}>{h} hours</option>)}
              </select>
            </div>
          </div>
            </>
          ) : null}

          <div className="bf-row">
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
          </div>

          {service === 'outstation' && outstationTrip === 'Round Trip' ? (
            <div className="bf-row">
              <div className="bf-cell">
                <label className="bf-label bf-label--out" htmlFor="bf-end-date">
                  Return date
                </label>
                <div className="bf-datewrap">
                  <input
                    ref={(el) => {
                      refs.current.endDate = el;
                    }}
                    id="bf-end-date"
                    className="input bf-input"
                    type="date"
                    value={endDate}
                    min={date || toDateInput(new Date())}
                    max={toDateInput(latestPickup(Date.now() + 30 * 86400000))}
                    aria-invalid={!!errors.endDate || undefined}
                    aria-describedby={errors.endDate ? 'bf-endDate-err' : undefined}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      setErrors((x) => ({ ...x, endDate: '', endTime: '' }));
                    }}
                  />
                  {endDate ? <span className="bf-chip">{dayHint(endDate)}</span> : null}
                </div>
                {fieldErr('endDate')}
              </div>
              <div className="bf-cell">
                <span className="bf-label bf-label--out" id="bf-end-time-label">
                  Return time
                </span>
                <button
                  ref={(el) => {
                    refs.current.endTime = el;
                  }}
                  type="button"
                  className={`bf-time ${endTime ? '' : 'is-empty'}`}
                  aria-labelledby="bf-end-time-label bf-end-time-value"
                  aria-invalid={!!errors.endTime || undefined}
                  aria-describedby={errors.endTime ? 'bf-endTime-err' : undefined}
                  onClick={() => setTimeFor('return')}
                >
                  <span id="bf-end-time-value">{endTime ? formatTime12(endTime) : ''}</span>
                  <ClockIcon size={26} />
                </button>
                {fieldErr('endTime')}
              </div>
            </div>
          ) : null}

          {errors.form ? (
            <p className="bf-error bf-error--form" role="alert">
              {errors.form}
            </p>
          ) : null}
          <Button type="submit" size="lg" block className="bf-submit">
            Let&apos;s Go !
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
      {stopPicker !== null ? (
        <LocationPicker
          config={{ title: stopPicker === 'new' ? 'Add itinerary stop' : `Edit stop ${stopPicker + 1}`, allowCurrent: true, popular: QUICK_CITIES, popularLabel: 'Popular locations', near: pickup ?? position, pinMode: 'drop' }}
          saved={savedPlaces}
          recent={recent}
          onClose={() => setStopPicker(null)}
          onSelect={(place) => {
            update((d) => ({ stops: stopPicker === 'new' ? [...d.stops, place] : d.stops.map((stop, index) => index === stopPicker ? place : stop) }));
            setErrors((e) => ({ ...e, stops: '', form: '' }));
            setStopPicker(null);
          }}
        />
      ) : null}
      {timeFor ? (
        <TimePicker
          title={timeFor === 'pickup' ? 'Pickup time' : 'Return time'}
          date={timeFor === 'pickup' ? date : endDate}
          value={timeFor === 'pickup' ? time : endTime}
          validate={timeFor === 'pickup' ? 'pickup' : 'after'}
          notBefore={timeFor === 'return' ? combineDateTime(date, time) : null}
          onClose={() => setTimeFor(null)}
          onConfirm={(t) => {
            if (timeFor === 'pickup') {
              setTime(t);
              setErrors((x) => ({ ...x, time: '' }));
            } else {
              setEndTime(t);
              setErrors((x) => ({ ...x, endTime: '' }));
            }
            setTimeFor(null);
          }}
        />
      ) : null}
    </section>
  );
}
