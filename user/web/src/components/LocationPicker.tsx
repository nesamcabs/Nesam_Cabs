// Choosing a pickup or drop: live search (Photon via the shared geoService), the device's real
// location, saved places, recent places, popular cities and "choose on map" with a fixed pin.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { reverseGeocode, searchPlaces } from '@core/services/geoService';
import { isValidLatLng } from '@core/utils/geo';
import { isOnline } from '@core/utils/network';
import { Button, Dialog, Spinner } from './ui';
import { Icon } from './Icon';
import { RouteMap } from './RouteMap';
import { useDeviceLocation } from '@/lib/hooks';
import { LOCATION_HELP } from '@/lib/schedule';
import { PolicyLinks } from '@/pages/PolicySections';

const TYPE_ICON: Record<string, string> = {
  home: 'home',
  work: 'briefcase',
  airport: 'plane',
  recent: 'clock',
  current: 'navigation',
};

export interface PickerConfig {
  title: string;
  allowCurrent?: boolean;
  check?: (p: GeoPlace) => string;
  popular: GeoPlace[];
  popularLabel?: string;
  near?: LatLng | null;
  pinMode?: 'pickup' | 'drop';
  // Airport-only pickers: search shows just the places this accepts (plus matching `popular` entries).
  resultFilter?: (p: GeoPlace) => boolean;
  subtitle?: string;
  placeholder?: string;
  emptyText?: string;
}

function Row({ icon, title, subtitle, onClick, busy, disabled }: { icon: string; title: string; subtitle?: string; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <li>
      <button type="button" className="place-row" onClick={onClick} disabled={disabled}>
        <span className="place-row__icon">{busy ? <Spinner /> : <Icon name={icon} size={18} />}</span>
        <span className="place-row__text">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
        <Icon name="chevron-right" size={16} className="place-row__chev" />
      </button>
    </li>
  );
}

export function LocationPicker({
  config,
  saved,
  recent,
  onSelect,
  onPick,
  onClose,
}: {
  config: PickerConfig;
  saved: LocationItem[];
  recent: GeoPlace[];
  onSelect?: (p: GeoPlace) => void;
  onPick?: (p: GeoPlace) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ q: string; list: GeoPlace[]; error: string }>({ q: '', list: [], error: '' });
  const [reject, setReject] = useState('');
  const [mapMode, setMapMode] = useState(false);
  const { error: locError, permission, locating, locate } = useDeviceLocation(false);
  const [currentBusy, setCurrentBusy] = useState(false);
  const q = query.trim();
  const searching = q.length >= 3 && results.q !== q;

  const emit = onSelect ?? onPick ?? (() => {});

  useEffect(() => {
    if (q.length < 3) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, config.near ?? null, controller.signal)
        .then((raw) => {
          if (controller.signal.aborted) return;
          const r = config.resultFilter ? raw.filter(config.resultFilter) : raw;
          const own = config.resultFilter ? config.popular.some((p) => `${p.name} ${p.address}`.toLowerCase().includes(q.toLowerCase())) : false;
          setResults({ q, list: r, error: r.length || own ? '' : config.emptyText ?? 'No places found. Try a landmark, area or city name.' });
        })
        .catch(() => !controller.signal.aborted && setResults({ q, list: [], error: isOnline() ? 'Search is temporarily unavailable. Please try again.' : 'You’re offline — search needs a connection.' }));
    }, 320);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, config.near?.lat, config.near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (p: LocationItem | GeoPlace) => {
    if (!isValidLatLng(p as Partial<LatLng>)) return;
    const place = p as GeoPlace;
    const why = config.check?.(place) ?? '';
    if (why) {
      setReject(why);
      return;
    }
    emit(place);
  };

  const useCurrent = async () => {
    setReject('');
    setCurrentBusy(true);
    try {
      const pos = await locate();
      if (!pos) return;
      const found = await reverseGeocode(pos);
      choose({ ...found, type: 'current' });
    } finally {
      setCurrentBusy(false);
    }
  };

  const filterLower = q.toLowerCase();
  const popular = useMemo(
    () => (q && q.length < 3 ? config.popular.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(filterLower)) : config.popular),
    [config.popular, q, filterLower],
  );
  const locationNote = locError ? LOCATION_HELP[locError.kind] : permission === 'denied' || permission === 'blocked' ? LOCATION_HELP.blocked : '';

  if (mapMode) return <PinDialog title={config.title} mode={config.pinMode ?? 'pickup'} onBack={() => setMapMode(false)} onConfirm={choose} />;

  const found = results.q === q ? results.list : [];
  // Airport-only pickers list the curated airports that match first, then any other airports the search found.
  const list = config.resultFilter
    ? [...config.popular.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(filterLower)), ...found.filter((p) => !config.popular.some((c) => c.name.toLowerCase() === p.name.toLowerCase()))]
    : found;
  return (
    <Dialog title={config.title} subtitle={config.subtitle ?? 'Search a city, area or landmark.'} onClose={onClose} variant="page" className="picker">
      <div className="picker__search">
        <Icon name="search" size={18} />
        <label className="sr-only" htmlFor="picker-q">
          {config.title}
        </label>
        <input
          id="picker-q"
          data-autofocus
          type="search"
          value={query}
          placeholder={config.placeholder ?? 'City, area or landmark'}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value);
            setReject('');
          }}
        />
      </div>
      {reject ? (
        <p className="field__error picker__reject" role="alert">
          {reject}
        </p>
      ) : null}

      {config.pinMode || config.allowCurrent ? (
        <div className="pick-opts">
          {config.pinMode ? (
            <button type="button" className="pick-opt pick-opt--map" onClick={() => setMapMode(true)}>
              <span className="pick-opt__icon">
                <Icon name="map-pin" size={22} />
              </span>
              <span className="pick-opt__text">
                <strong>Choose on map</strong>
                <small>Move the map to drop a pin on the exact spot</small>
              </span>
              <Icon name="chevron-right" size={16} className="pick-opt__chev" />
            </button>
          ) : null}
          {config.allowCurrent ? (
            <button type="button" className="pick-opt pick-opt--here" onClick={() => void useCurrent()} disabled={currentBusy || locating}>
              <span className="pick-opt__icon">{currentBusy || locating ? <Spinner /> : <Icon name="navigation" size={22} />}</span>
              <span className="pick-opt__text">
                <strong>{currentBusy || locating ? 'Finding your location…' : 'Use your current location'}</strong>
                {locationNote ? <small>{locationNote}</small> : <small>Uses your device location, with your permission</small>}
              </span>
              <Icon name="chevron-right" size={16} className="pick-opt__chev" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="picker__lists" aria-live="polite">
        {q.length >= 3 ? (
          <>
            <p className="picker__head">Search results</p>
            {searching ? (
              <p className="picker__status">
                <Spinner /> Searching…
              </p>
            ) : results.error ? (
              <p className="picker__status">{results.error}</p>
            ) : (
              <ul>
                {list.map((p) => (
                  <Row key={p.id} icon={p.type === 'airport' ? 'plane' : 'map-pin'} title={p.name} subtitle={p.address !== p.name ? p.address : undefined} onClick={() => choose(p)} />
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {saved.length && !q && !config.resultFilter ? (
              <>
                <p className="picker__head">Saved addresses</p>
                <ul>
                  {saved.map((p) => (
                    <Row key={p.id} icon={TYPE_ICON[p.type] ?? 'star'} title={p.name} subtitle={p.address} onClick={() => choose(p)} />
                  ))}
                </ul>
              </>
            ) : null}
            {recent.length && !q && !config.resultFilter ? (
              <>
                <p className="picker__head">Recent</p>
                <ul>
                  {recent.map((p) => (
                    <Row key={p.id} icon="clock" title={p.name} subtitle={p.address !== p.name ? p.address : undefined} onClick={() => choose(p)} />
                  ))}
                </ul>
              </>
            ) : null}
            {popular.length ? (
              <>
                <p className="picker__head">{config.popularLabel ?? 'Popular locations'}</p>
                <ul>
                  {popular.map((p) => (
                    <Row key={p.id} icon={p.type === 'airport' ? 'plane' : 'map-pin'} title={p.name} subtitle={p.address} onClick={() => choose(p)} />
                  ))}
                </ul>
              </>
            ) : q ? (
              <p className="picker__status">Keep typing to search every place.</p>
            ) : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

function PinDialog({ title, mode, onBack, onConfirm }: { title: string; mode: 'pickup' | 'drop'; onBack: () => void; onConfirm: (p: GeoPlace) => void }) {
  const { position } = useDeviceLocation(false);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [place, setPlace] = useState<GeoPlace | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  // Slides down before it is removed, mirroring the slide up when it opens.
  const close = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onBack, 240);
  };

  useEffect(() => {
    if (!center) return undefined;
    setBusy(true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      reverseGeocode(center, controller.signal)
        .then((p) => {
          if (controller.signal.aborted) return;
          setPlace(p);
          setBusy(false);
        })
        .catch(() => undefined);
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      variant="page"
      className={`pin-sheet ${closing ? 'is-closing' : ''}`}
      title={title}
      subtitle="Move the map so the pin sits on the exact spot."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" icon="arrow-left" onClick={close}>
            Back
          </Button>
          <Button disabled={!place || busy} onClick={() => place && onConfirm(place)}>
            Confirm location
          </Button>
        </>
      }
    >
      <RouteMap className="pinmap" label="Choose a place on the map" pinMode={mode} userLocation={position} onCenterChange={setCenter} />
      <div className="pin-card" aria-live="polite">
        <Icon name="map-pin" size={20} />
        <div>
          <strong>{place?.name ?? 'Move the map…'}</strong>
          <small className="muted">{busy ? 'Finding address…' : place && place.address !== place.name ? place.address : ''}</small>
        </div>
      </div>
    </Dialog>
  );
}
export default LocationPicker;
