// Multicity tour form for NESAM: pickup, any number of cities along the way, the final drop, and the departure and
// return schedule. "Let's Go" turns it into a booking draft (a Round Trip through those cities, priced from the Multicity
// rates) and opens the normal flow: cabs with their fares, review, then Confirm booking.
import { useEffect, useMemo, useState } from 'react';
import { ClockIcon } from '@/components/CabParts';
import { useNavigate } from 'react-router-dom';
import type { GeoPlace } from '@core/types';
import { scheduleProblem } from '@core/utils/bookingRules';
import { newId } from '@core/services/callables';
import { useCustomerData } from '@/state/CustomerData';
import { useBooking } from '@/state/Booking';
import { loadMulticityDraft, multicityInstant, validMulticityDate, validMulticityPlace, type MulticityDraft } from '@core/utils/multicityDraft';
import { useOnline } from '@/lib/hooks';
import { combineDateTime, latestPickup, toDateInput } from '@/lib/schedule';
import { Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LocationPicker, type PickerConfig } from '@/components/LocationPicker';
import { TimePicker, formatTime12 } from '@/components/TimePicker';
import { QUICK_CITIES } from './content';

type StoredMulticityState = MulticityDraft;

const STORAGE_KEY = 'nesam.multicity.v1';

function loadStoredState(): StoredMulticityState {
  try { return loadMulticityDraft(sessionStorage.getItem(STORAGE_KEY)); }
  catch { return loadMulticityDraft(null); }
}

const MAX_CITIES = 10;

function saveStoredState(state: StoredMulticityState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage write issues
  }
}

/** "Today", "Tomorrow" or the weekday, shown on the date field. */
const dayHint = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'long' });
};

export function MulticityForm() {
  const { savedPlaces, trips } = useCustomerData();
  const { online } = useOnline();
  const navigate = useNavigate();
  const { draft, update } = useBooking();

  const [state, setState] = useState<StoredMulticityState>(loadStoredState);
  const [pickerTarget, setPickerTarget] = useState<'pickup' | 'drop' | string | null>(null);
  const [timeFor, setTimeFor] = useState<'pickup' | 'return' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Synchronize draft changes into sessionStorage
  useEffect(() => {
    saveStoredState(state);
  }, [state]);

  const recentPlaces = useMemo<GeoPlace[]>(() => {
    const out: GeoPlace[] = [];
    const seen = new Set<string>();
    for (const t of trips) {
      for (const p of [t.drop, t.pickup]) {
        if (!p || !p.lat || !p.lng) continue;
        const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(p);
        if (out.length >= 6) return out;
      }
    }
    return out;
  }, [trips]);

  const scheduled = useMemo(() => {
    if (!state.date || !state.time) return null;
    const instant = multicityInstant(state.date, state.time);
    return instant ? new Date(instant) : null;
  }, [state.date, state.time]);

  const tourEnd = useMemo(() => (state.endDate && state.endTime ? combineDateTime(state.endDate, state.endTime) : null), [state.endDate, state.endTime]);

  // Only chosen cities are shown; "Add city" opens the picker for the next one.
  const cities = useMemo(() => state.stops.filter((s) => s.place), [state.stops]);

  const todayStr = useMemo(() => toDateInput(new Date()), []);
  const maxDateStr = useMemo(() => toDateInput(latestPickup()), []);

  const removeStop = (id: string) => {
    setState((s) => ({ ...s, stops: s.stops.filter((st) => st.id !== id) }));
  };

  const onPickPlace = (p: GeoPlace) => {
    if (pickerTarget === 'pickup') {
      setState((s) => ({ ...s, pickup: p }));
      setErrors((e) => {
        const next = { ...e };
        delete next.pickup;
        delete next.itinerary;
        return next;
      });
    } else if (pickerTarget === 'drop') {
      setState((s) => ({ ...s, drop: p }));
      setErrors((e) => {
        const next = { ...e };
        delete next.drop;
        delete next.itinerary;
        return next;
      });
    } else if (pickerTarget) {
      setState((s) => ({
        ...s,
        stops: pickerTarget === 'new'
          ? [...s.stops.filter((st) => st.place), { id: newId('stop'), place: p }]
          : s.stops.map((st) => (st.id === pickerTarget ? { ...st, place: p } : st)),
      }));
      setErrors((e) => {
        const next = { ...e };
        delete next[`stop_${pickerTarget}`];
        delete next.stops;
        delete next.itinerary;
        return next;
      });
    }
    setPickerTarget(null);
  };

  const pickerConfig: PickerConfig = useMemo(() => {
    if (pickerTarget === 'pickup') {
      return {
        title: 'Choose Pickup Location',
        allowCurrent: true,
        popular: QUICK_CITIES,
        popularLabel: 'Major Cities',
        pinMode: 'pickup',
      };
    }
    if (pickerTarget === 'drop') {
      return {
        title: 'Choose Drop Location',
        allowCurrent: false,
        popular: QUICK_CITIES,
        popularLabel: 'Popular Destinations',
        pinMode: 'drop',
      };
    }
    const found = state.stops.filter((s) => s.place).findIndex((s) => s.id === pickerTarget);
    const idx = found < 0 ? cities.length : found;
    return {
      title: `Choose City ${idx + 1}`,
      allowCurrent: false,
      popular: QUICK_CITIES,
      popularLabel: 'Popular Cities',
      pinMode: 'drop',
    };
  }, [pickerTarget, state.stops, cities.length]);

  const validate = (): boolean => {
    const err: Record<string, string> = {};
    if (!validMulticityPlace(state.pickup)) {
      err.pickup = 'Please select a starting pickup location.';
    }
    if (!validMulticityPlace(state.drop)) {
      err.drop = 'Please select a final destination drop point.';
    }

    const filledStops = state.stops.filter((s) => s.place !== null);
    if (filledStops.length === 0) {
      err.stops = 'Add at least one city between pickup and drop.';
    }

    // Verify consecutive duplicates across the ordered itinerary
    const allPoints = [state.pickup, ...filledStops.map((s) => s.place), state.drop].filter(Boolean) as GeoPlace[];
    for (let i = 0; i < allPoints.length - 1; i++) {
      if (allPoints[i].name.trim().toLowerCase() === allPoints[i + 1].name.trim().toLowerCase()) {
        err.itinerary = `Consecutive stop duplicate: "${allPoints[i].name}" cannot immediately follow itself.`;
        break;
      }
    }

    if (!validMulticityDate(state.date)) err.date = 'Select a valid departure date.';
    if (!scheduled) err.time = 'Select a valid departure date and time.';

    if (scheduled) {
      const prob = scheduleProblem(scheduled);
      if (prob) err.time = prob;
    }

    if (filledStops.some((stop) => !validMulticityPlace(stop.place))) err.stops = 'Choose a valid location for every city.';

    if (!state.endDate) err.endDate = 'Choose the return date.';
    else if (!state.endTime) err.endTime = 'Choose the return time.';
    else if (scheduled && tourEnd && tourEnd.getTime() <= scheduled.getTime()) err.endTime = 'The return must be after the departure.';

    if (!online) {
      err.form = 'You are currently offline. Please check your internet connection.';
    }

    setErrors(err);
    return Object.keys(err).length === 0;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !scheduled || !tourEnd) return;
    // The tour becomes the booking draft: a Round Trip through these cities, priced from the Multicity rates.
    const filledStops = state.stops.filter((s) => s.place !== null).map((s) => ({ ...s.place!, id: s.place!.id }));
    const next = {
      ...draft,
      pickup: state.pickup!,
      drop: state.drop!,
      stops: filledStops,
      tripType: 'Round Trip' as const,
      multicity: true,
      scheduledAt: scheduled,
      tripEndAt: tourEnd,
      promoCode: '',
    };
    update(next);
    navigate('/book/ride');
  };

  return (
    <form className="bf-multicity" onSubmit={onSubmit} noValidate>
      <fieldset className="bf-fieldset">
      {/* ── Route & Stops Section ── */}
      <div className="bf-section" role="group" aria-label="Route and stops">
        {/* 1. Starting Pickup Point */}
        <div className={`bf-field ${errors.pickup ? 'is-invalid' : ''}`}>
          <span className="bf-pin" aria-hidden="true" />
          <div className="bf-field__main">
            <span className="bf-label" id="mc-pickup-label">
              Pickup location
            </span>
            <button
              id="mc-pickup-btn"
              type="button"
              className={`bf-trigger ${!state.pickup ? 'is-empty' : ''}`}
              aria-labelledby="mc-pickup-label mc-pickup-val"
              onClick={() => setPickerTarget('pickup')}
            >
              <span id="mc-pickup-val" className="bf-trigger__text">
                {state.pickup?.name ?? ''}
              </span>
            </button>
            {state.pickup?.address && state.pickup.address !== state.pickup.name ? (
              <small className="bf-addr">{state.pickup.address}</small>
            ) : null}
          </div>
          <Icon name="chevron-right" size={16} className="bf-chev" />
        </div>
        {errors.pickup ? <p className="bf-error">{errors.pickup}</p> : null}

        {/* 2. Cities along the way: only the chosen ones show, then a plain "Add city" button */}
        {cities.map((stop, index) => (
          <div key={stop.id} className="bf-field">
            <span className="bf-pin bf-pin--stop" aria-hidden="true" />
            <div className="bf-field__main">
              <span className="bf-label" id={`mc-city-${index}-label`}>
                Stop {index + 1}
              </span>
              <button
                type="button"
                className="bf-trigger"
                aria-labelledby={`mc-city-${index}-label mc-city-${index}-val`}
                onClick={() => setPickerTarget(stop.id)}
              >
                <span id={`mc-city-${index}-val`} className="bf-trigger__text">
                  {stop.place?.name ?? ''}
                </span>
              </button>
              {stop.place?.address && stop.place.address !== stop.place.name ? <small className="bf-addr">{stop.place.address}</small> : null}
            </div>
            <button type="button" className="bf-stop-remove" aria-label={`Remove stop ${index + 1}`} onClick={() => removeStop(stop.id)}>
              <Icon name="trash-2" size={16} />
            </button>
          </div>
        ))}
        {cities.length < MAX_CITIES ? (
          <div className="bf-route__tools">
            <button type="button" className={`bf-round-stop-add ${errors.stops ? 'is-invalid' : ''}`} onClick={() => setPickerTarget('new')}>
              <Icon name="plus" size={16} /> Add stop
            </button>
          </div>
        ) : null}
        {errors.stops ? <p className="bf-error">{errors.stops}</p> : null}

        {/* 3. Final Drop Point */}
        <div className={`bf-field ${errors.drop ? 'is-invalid' : ''}`}>
          <span className="bf-pin bf-pin--drop" aria-hidden="true" />
          <div className="bf-field__main">
            <span className="bf-label" id="mc-drop-label">
              Drop location
            </span>
            <button
              id="mc-drop-btn"
              type="button"
              className={`bf-trigger ${!state.drop ? 'is-empty' : ''}`}
              aria-labelledby="mc-drop-label mc-drop-val"
              onClick={() => setPickerTarget('drop')}
            >
              <span id="mc-drop-val" className="bf-trigger__text">
                {state.drop?.name ?? ''}
              </span>
            </button>
            {state.drop?.address && state.drop.address !== state.drop.name ? (
              <small className="bf-addr">{state.drop.address}</small>
            ) : null}
          </div>
          <Icon name="chevron-right" size={16} className="bf-chev" />
        </div>
        {errors.drop ? <p className="bf-error">{errors.drop}</p> : null}
        {errors.itinerary ? <p className="bf-error">{errors.itinerary}</p> : null}

      </div>

      {/* ── Schedule Section ── */}
      <div className="bf-section" role="group" aria-label="Trip schedule">
        <div className="bf-row">
          <div className="bf-cell">
            <label className="bf-label bf-label--out" htmlFor="mc-date">
              Departure date
            </label>
            <div className="bf-datewrap">
              <input
                id="mc-date"
                type="date"
                className="input bf-input"
                min={todayStr}
                max={maxDateStr}
                value={state.date}
                onChange={(e) => {
                  setState((s) => ({ ...s, date: e.target.value }));
                  setErrors((x) => ({ ...x, date: '', time: '' }));
                }}
                required
              />
              {state.date ? <span className="bf-chip">{dayHint(state.date)}</span> : null}
            </div>
            {errors.date ? <p className="bf-error">{errors.date}</p> : null}
          </div>

          <div className="bf-cell">
            <span className="bf-label bf-label--out" id="mc-time-label">
              Departure time
            </span>
            <button
              id="mc-time-btn"
              type="button"
              className={`bf-time ${state.time ? '' : 'is-empty'}`}
              aria-labelledby="mc-time-label mc-time-val"
              onClick={() => setTimeFor('pickup')}
            >
              <span id="mc-time-val">{state.time ? formatTime12(state.time) : ''}</span>
              <Icon name="clock-3" size={16} />
            </button>
            {errors.time ? <p className="bf-error">{errors.time}</p> : null}
          </div>
        </div>
        <div className="bf-row">
          <div className="bf-cell">
            <label className="bf-label bf-label--out" htmlFor="mc-end-date">
              Return date
            </label>
            <div className="bf-datewrap">
              <input
                id="mc-end-date"
                type="date"
                className="input bf-input"
                min={state.date || todayStr}
                max={toDateInput(latestPickup(Date.now() + 30 * 86400000))}
                value={state.endDate}
                onChange={(e) => {
                  setState((s) => ({ ...s, endDate: e.target.value }));
                  setErrors((x) => ({ ...x, endDate: '', endTime: '' }));
                }}
                required
              />
              {state.endDate ? <span className="bf-chip">{dayHint(state.endDate)}</span> : null}
            </div>
            {errors.endDate ? <p className="bf-error">{errors.endDate}</p> : null}
          </div>

          <div className="bf-cell">
            <span className="bf-label bf-label--out" id="mc-end-time-label">
              Return time
            </span>
            <button
              id="mc-end-time-btn"
              type="button"
              className={`bf-time ${state.endTime ? '' : 'is-empty'}`}
              aria-labelledby="mc-end-time-label mc-end-time-val"
              onClick={() => setTimeFor('return')}
            >
              <span id="mc-end-time-val">{state.endTime ? formatTime12(state.endTime) : ''}</span>
              <Icon name="clock-3" size={16} />
            </button>
            {errors.endTime ? <p className="bf-error">{errors.endTime}</p> : null}
          </div>
        </div>
      </div>

      {errors.form ? (
        <p className="bf-error bf-error--form" role="alert">
          {errors.form}
        </p>
      ) : null}

      {/* ── Action Buttons ── */}
      <div className="bf-actions">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          block
          className="bf-submit"
        >
          Let&apos;s Go !
        </Button>
      </div>

      {/* ── Place Picker Modal ── */}
      {pickerTarget ? (
        <LocationPicker
          config={pickerConfig}
          saved={savedPlaces}
          recent={recentPlaces}
          onSelect={onPickPlace}
          onClose={() => setPickerTarget(null)}
        />
      ) : null}

      {/* ── Time Picker Modal ── */}
      {timeFor ? (
        <TimePicker
          title={timeFor === 'pickup' ? 'Departure time' : 'Return time'}
          date={timeFor === 'pickup' ? state.date : state.endDate}
          value={timeFor === 'pickup' ? state.time : state.endTime}
          validate={timeFor === 'pickup' ? 'pickup' : 'after'}
          notBefore={timeFor === 'return' ? scheduled : null}
          onClose={() => setTimeFor(null)}
          onConfirm={(t) => {
            if (timeFor === 'pickup') {
              setState((s) => ({ ...s, time: t }));
              setErrors((x) => ({ ...x, time: '' }));
            } else {
              setState((s) => ({ ...s, endTime: t }));
              setErrors((x) => ({ ...x, endTime: '' }));
            }
            setTimeFor(null);
          }}
        />
      ) : null}
      </fieldset>
    </form>
  );
}

