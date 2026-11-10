// Step 1 — the booking console: pickup and destination (visually connected), trip type and when.
// It sits across the full width of the hero; suggestions open in a panel under the active field,
// and "choose on map" opens a map dialog with a fixed pin.
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { useCustomerData } from '@core/context/CustomerData';
import { reverseGeocode } from '@core/services/geoService';
import { SCHEDULE_MAX_DAYS, SCHEDULE_MIN_LEAD_MIN } from '@core/config/constants';
import { scheduleProblem } from '@core/utils/bookingRules';
import { formatDateTime } from '@core/utils/format';
import { haversineKm, isValidLatLng } from '@core/utils/geo';
import { Button, Dialog, IconButton, Notice, Segmented } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PlaceSuggestions } from '@/components/PlaceSuggestions';
import { RouteMap } from '@/components/RouteMap';
import { useBooking } from '@/state/Booking';
import { useDeviceLocation, useOnline } from '@/lib/hooks';
import { LOCATION_HELP, combineDateTime, earliestPickup, latestPickup, toDateInput, toTimeInput } from '@/lib/schedule';
import { QUICK_CITIES } from './content';

type Field = 'pickup' | 'drop';

export interface PlanUi {
  /** The field whose search / suggestions are open. */
  active: Field | null;
  /** The field being placed with a pin on the map. */
  pin: Field | null;
}

/** A request from elsewhere on the page ("airport transfers", a route card) to start in a given field. */
export interface PlanIntent {
  n: number;
  field: Field;
  text: string;
}

export function PlanStep({ ui, setUi, intent }: { ui: PlanUi; setUi: Dispatch<SetStateAction<PlanUi>>; intent: PlanIntent | null }) {
  const navigate = useNavigate();
  const { draft, update } = useBooking();
  const { trips, savedPlaces } = useCustomerData();
  const { position, error: locError, permission, locating, locate } = useDeviceLocation(true);
  const { online } = useOnline();
  const { pickup, drop, tripType, scheduledAt, tripEndAt } = draft;

  const [text, setText] = useState('');
  const [problem, setProblem] = useState('');
  const root = useRef<HTMLElement>(null);
  const inputs = useRef<Record<Field, HTMLInputElement | null>>({ pickup: null, drop: null });
  const mounted = useRef(true);
  const pickupFromGps = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A GPS fix the rider already allowed becomes the pickup, unless they chose one.
  useEffect(() => {
    if (!position || pickupFromGps.current || pickup) return;
    pickupFromGps.current = true;
    void reverseGeocode(position).then((p) => {
      if (mounted.current) update((d) => (d.pickup ? {} : { pickup: { ...p, type: 'current' } }));
    });
  }, [position, pickup, update]);

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: GeoPlace[] = [];
    for (const t of trips) {
      for (const p of [t.drop, t.pickup]) {
        if (!isValidLatLng(p) || seen.has(p.name)) continue;
        seen.add(p.name);
        out.push({ ...p, id: `recent-${t.id}-${p.id}`, type: 'recent' });
      }
    }
    return out.slice(0, 5);
  }, [trips]);

  const active = ui.active;
  const place = (f: Field) => (f === 'pickup' ? pickup : drop);
  const typed = active && text.trim() !== place(active)?.name ? text : '';

  const activate = (f: Field, initialText?: string) => {
    setUi({ active: f, pin: null });
    setText(initialText ?? place(f)?.name ?? '');
    setProblem('');
  };
  const closeSearch = () => {
    setUi({ active: null, pin: null });
    setText('');
  };

  // The page asked us to start in a field (airport card, route card, …).
  const lastIntent = useRef(0);
  useEffect(() => {
    if (!intent || intent.n === lastIntent.current) return;
    lastIntent.current = intent.n;
    activate(intent.field, intent.text);
    window.setTimeout(() => inputs.current[intent.field]?.focus(), 60);
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps -- reacts to a new request only

  // Clicking outside the console closes an open suggestion panel.
  useEffect(() => {
    if (!active) return undefined;
    const down = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) closeSearch();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (f: Field, p: GeoPlace) => {
    if (f === 'pickup') {
      pickupFromGps.current = true;
      update({ pickup: p });
    } else update({ drop: p });
    setProblem('');
    if (f === 'pickup' && !drop) {
      activate('drop', '');
      window.setTimeout(() => inputs.current.drop?.focus(), 0);
    } else {
      closeSearch();
      inputs.current[f]?.blur();
    }
  };

  const useCurrent = async () => {
    const p = await locate();
    if (!p || !mounted.current) return;
    const found = await reverseGeocode(p);
    if (!mounted.current) return;
    pickupFromGps.current = true;
    choose('pickup', { ...found, type: 'current' });
  };

  // ── Drop-a-pin ───────────────────────────────────────────────────────────
  const [pinCenter, setPinCenter] = useState<LatLng | null>(null);
  const [pinPlace, setPinPlace] = useState<GeoPlace | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  useEffect(() => {
    if (!ui.pin || !pinCenter) return undefined;
    setPinBusy(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      reverseGeocode(pinCenter, controller.signal)
        .then((p) => {
          if (controller.signal.aborted) return;
          setPinPlace(p);
          setPinBusy(false);
        })
        .catch(() => undefined);
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [ui.pin, pinCenter?.lat, pinCenter?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Schedule ─────────────────────────────────────────────────────────────
  const [whenDate, setWhenDate] = useState(() => (scheduledAt ? toDateInput(scheduledAt) : ''));
  const [whenTime, setWhenTime] = useState(() => (scheduledAt ? toTimeInput(scheduledAt) : ''));
  // Every booking is an advance booking: a pickup date and time is always required.
  const suggestPickup = () => {
    const d = earliestPickup(Date.now() + 25 * 60000);
    setWhenDate(toDateInput(d));
    setWhenTime(toTimeInput(d));
  };
  useEffect(() => {
    const d = combineDateTime(whenDate, whenTime);
    if ((d?.getTime() ?? null) !== (scheduledAt?.getTime() ?? null)) update({ scheduledAt: d });
  }, [whenDate, whenTime]); // eslint-disable-line react-hooks/exhaustive-deps
  // No return date is asked: a round trip is quoted from the pickup instant.
  useEffect(() => {
    const d = tripType === 'Round Trip' ? combineDateTime(whenDate, whenTime) : null;
    if ((d?.getTime() ?? null) !== (tripEndAt?.getTime() ?? null)) update({ tripEndAt: d });
  }, [whenDate, whenTime, tripType]); // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleIssue = scheduledAt ? scheduleProblem(scheduledAt) : whenDate || whenTime ? 'Choose both a pickup date and a time.' : '';

  // ── Continue ─────────────────────────────────────────────────────────────
  const home = savedPlaces.find((p) => p.type === 'home');
  const work = savedPlaces.find((p) => p.type === 'work');
  const isLocalRental = tripType === 'Local Rental';
  const isAirportTaxi = tripType === 'Airport Taxi';
  const airport = isAirportTaxi || pickup?.type === 'airport' || drop?.type === 'airport';

  const proceed = () => {
    let targetDrop = drop;
    if (isLocalRental && !targetDrop && pickup) {
      targetDrop = {
        id: 'place-local-disposal',
        name: 'Local City Disposal',
        address: `${pickup.name} & City Limits (Within city disposal)`,
        lat: pickup.lat + 0.04,
        lng: pickup.lng + 0.04,
        type: 'other',
      };
      update({ drop: targetDrop });
    }
    const currentBlocker = !pickup ? 'Set your pickup point.' : !targetDrop ? 'Where are you going? Set your destination.' : '';
    const reason = !online
      ? 'You’re offline. Reconnect to see fares.'
      : !pickup || !targetDrop
        ? currentBlocker
        : haversineKm(pickup, targetDrop) < 0.2 && !isLocalRental && tripType !== 'Round Trip'
          ? 'Pickup and destination are too close together.'
          : scheduleProblem(scheduledAt);
    setProblem(reason);
    if (!reason) navigate('/book/ride');
  };

  const pickSaved = (p: LocationItem | undefined) => {
    if (p && isValidLatLng(p as Partial<LatLng>)) {
      update({ drop: p as GeoPlace });
      setProblem('');
    } else navigate('/account/places');
  };

  const locationNote = locError ? LOCATION_HELP[locError.kind] : permission === 'denied' || permission === 'blocked' ? LOCATION_HELP.blocked : undefined;

  const renderField = (f: Field) => {
    const p = place(f);
    const isActive = active === f;
    const value = isActive ? text : (p?.name ?? '');
    return (
      <div key={f} className={`cfield cfield--${f} ${isActive ? 'is-active' : ''}`}>
        <span className={`cfield__mark cfield__mark--${f}`} aria-hidden="true" />
        <div className="cfield__body">
          <label htmlFor={`field-${f}`} className="cfield__label">
            {f === 'pickup' ? 'Pickup' : 'Destination'}
          </label>
          <input
            id={`field-${f}`}
            ref={(el) => {
              inputs.current[f] = el;
            }}
            className="cfield__input"
            value={value}
            placeholder={f === 'pickup' ? (locating ? 'Finding your location…' : 'Address, area or landmark') : 'City, town or landmark'}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onFocus={(e) => {
              if (!isActive) activate(f);
              e.currentTarget.select();
            }}
            onChange={(e) => {
              if (!isActive) setUi({ active: f, pin: null });
              setText(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                closeSearch();
                e.currentTarget.blur();
              }
            }}
          />
          {!isActive && p && p.address !== p.name ? <small className="cfield__addr truncate">{p.address}</small> : null}
        </div>
        {f === 'pickup' && !isActive ? <IconButton icon="current-location" label="Use my current location" onClick={() => void useCurrent()} /> : null}
        {f === 'drop' && (value || p) ? (
          <IconButton
            icon="close"
            label="Clear destination"
            onClick={() => {
              update({ drop: null });
              setText('');
              activate('drop', '');
              inputs.current.drop?.focus();
            }}
          />
        ) : null}
        {isActive ? (
          <div className="cfield__pop">
            <PlaceSuggestions
              query={typed}
              near={f === 'drop' ? (pickup ?? position) : position}
              saved={savedPlaces}
              recent={recent}
              onSelect={(pl) => choose(f, pl)}
              onUseCurrent={f === 'pickup' ? () => void useCurrent() : undefined}
              locating={locating}
              locationNote={locationNote}
              onPinOnMap={() => {
                setUi({ active: null, pin: f });
                setPinPlace(null);
                setPinCenter(null);
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  const issue = problem || scheduleIssue;

  return (
    <section ref={root} id="book-console" className="console" aria-label="Plan your trip">
      <div className="console__top">
        <Segmented
          label="Trip type"
          value={tripType}
          onChange={(v) => {
            update({ tripType: v });
            if (v === 'Local Rental' && pickup && !drop) {
              update({
                drop: {
                  id: 'place-local-disposal',
                  name: 'Local City Disposal',
                  address: `${pickup.name} & City Limits (Within city disposal)`,
                  lat: pickup.lat + 0.04,
                  lng: pickup.lng + 0.04,
                  type: 'other',
                },
              });
            }
          }}
          options={[
            { value: 'One Way', label: 'One way' },
            { value: 'Round Trip', label: 'Round trip' },
            { value: 'Local Rental', label: 'Local rental' },
            { value: 'Airport Taxi', label: 'Airport taxi' },
          ]}
        />
        {isAirportTaxi ? (
          <div className="console__airport-bar" role="group" aria-label="Airport options">
            <span className="console__tag">
              <Icon name="plane" size={16} /> Airport taxi
            </span>
            <span className="console__quick-label">Airports:</span>
            {[
              { id: 'maa', name: 'Chennai (MAA)', fullName: 'Chennai International Airport (MAA)', lat: 12.9941, lng: 80.1709 },
              { id: 'ixm', name: 'Madurai (IXM)', fullName: 'Madurai Airport (IXM)', lat: 9.8345, lng: 78.0934 },
              { id: 'cjb', name: 'Coimbatore (CJB)', fullName: 'Coimbatore Airport (CJB)', lat: 11.0300, lng: 77.0434 },
              { id: 'trz', name: 'Trichy (TRZ)', fullName: 'Tiruchirappalli Airport (TRZ)', lat: 10.7654, lng: 78.7107 },
              { id: 'blr', name: 'Bengaluru (BLR)', fullName: 'Kempegowda Airport (BLR)', lat: 13.1986, lng: 77.7066 },
            ].map((air) => (
              <button
                key={air.id}
                type="button"
                className="chip"
                onClick={() => {
                  choose('drop', { id: `airport-${air.id}`, name: air.fullName, address: air.fullName + ', India', lat: air.lat, lng: air.lng, type: 'airport' });
                }}
              >
                <Icon name="plane" size={14} /> {air.name}
              </button>
            ))}
          </div>
        ) : isLocalRental ? (
          <div className="console__rental-bar" role="group" aria-label="Local rental options">
            <span className="console__tag console__tag--amber">
              <Icon name="clock" size={16} /> Hourly local rental
            </span>
            <button
              type="button"
              className="chip"
              onClick={() => {
                if (pickup) {
                  choose('drop', {
                    id: 'place-local-disposal',
                    name: 'Local City Disposal',
                    address: `${pickup.name} & City Limits (Within city disposal)`,
                    lat: pickup.lat + 0.04,
                    lng: pickup.lng + 0.04,
                    type: 'other',
                  });
                } else {
                  activate('pickup');
                }
              }}
            >
              <Icon name="location-pin" size={14} /> Within city disposal
            </button>
          </div>
        ) : airport ? (
          <span className="console__tag">
            <Icon name="plane" size={16} /> Airport trip
          </span>
        ) : null}
        <div className="console__quick" role="group" aria-label="Quick destinations">
          <span className="console__quick-label">Quick pick</span>
          <button type="button" className="chip" onClick={() => pickSaved(home)}>
            <Icon name="home" size={17} /> {home ? 'Home' : 'Add home'}
          </button>
          <button type="button" className="chip" onClick={() => pickSaved(work)}>
            <Icon name="briefcase" size={17} /> {work ? 'Work' : 'Add work'}
          </button>
          <button type="button" className="chip" onClick={() => activate('drop', 'airport')}>
            <Icon name="plane" size={17} /> Airport
          </button>
        </div>
      </div>

      <div className={`console__row ${tripType === 'Round Trip' ? 'console__row--round' : ''}`}>
        <div className="console__route" role="group" aria-label="Pickup and destination">
          {renderField('pickup')}
          <button
            type="button"
            className="console__swap"
            aria-label="Swap pickup and destination"
            disabled={!pickup && !drop}
            onClick={() => {
              if (pickup || drop) update({ pickup: drop, drop: pickup });
            }}
          >
            <Icon name="swap" size={18} />
          </button>
          {renderField('drop')}
        </div>

        <div className="when" role="group" aria-label="Pickup date and time">
          <label className="when__item">
            <span>Pickup date</span>
            <input type="date" value={whenDate} min={toDateInput(new Date())} max={toDateInput(latestPickup())} onChange={(e) => setWhenDate(e.target.value)} />
          </label>
          <label className="when__item">
            <span>Pickup time</span>
            <input type="time" value={whenTime} step={300} onChange={(e) => setWhenTime(e.target.value)} />
          </label>
        </div>

        <Button size="lg" className="console__go" disabled={!pickup || !drop} onClick={proceed}>
          See fares
          <Icon name="arrow-right" size={20} />
        </Button>
      </div>

      <div className="console__foot">
        {issue ? (
          <Notice tone={problem ? 'warning' : 'error'}>{issue}</Notice>
        ) : scheduledAt ? (
          <p className="console__hint">
            <Icon name="calendar" size={16} /> {formatDateTime(scheduledAt)} · book {SCHEDULE_MIN_LEAD_MIN} minutes to {SCHEDULE_MAX_DAYS} days ahead.
          </p>
        ) : (
          <p className="console__hint">
            <Icon name="clock" size={16} /> Choose your pickup time ·{' '}
            <button type="button" className="link-btn" onClick={suggestPickup}>
              Suggest the earliest time
            </button>
          </p>
        )}
        {!active && !drop ? (
          <div className="console__cities" role="group" aria-label="Top outstation destinations">
            <span className="console__quick-label">Popular</span>
            {QUICK_CITIES.map((c) => (
              <button key={c.id} type="button" className="chip chip--plain" onClick={() => choose('drop', c)}>
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {ui.pin ? (
        <Dialog
          wide
          title={ui.pin === 'pickup' ? 'Set pickup on the map' : 'Set destination on the map'}
          onClose={() => setUi({ active: ui.pin, pin: null })}
          footer={
            <>
              <Button variant="secondary" onClick={() => setUi({ active: ui.pin, pin: null })}>
                Back
              </Button>
              <Button
                disabled={!pinPlace || pinBusy}
                onClick={() => {
                  if (pinPlace && ui.pin) choose(ui.pin, pinPlace);
                }}
              >
                {ui.pin === 'pickup' ? 'Confirm pickup' : 'Confirm destination'}
              </Button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 14 }}>
            Move the map so the pin sits on the exact spot.
          </p>
          <RouteMap
            className="pinmap"
            label="Choose a place on the map"
            pinMode={ui.pin}
            pickup={ui.pin === 'drop' ? pickup : null}
            userLocation={position}
            onCenterChange={setPinCenter}
          />
          <div className="pin-card" aria-live="polite">
            <Icon name="location-pin" size={22} />
            <div>
              <strong>{pinPlace?.name ?? 'Move the map…'}</strong>
              <small className="muted">{pinBusy ? 'Finding address…' : pinPlace && pinPlace.address !== pinPlace.name ? pinPlace.address : ''}</small>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
