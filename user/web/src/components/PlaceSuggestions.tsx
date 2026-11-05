// What sits under a pickup / destination field: current location, "choose on map",
// saved places, recent places and live search results (Photon, via the shared geoService).
import { useEffect, useMemo, useState } from 'react';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { searchPlaces } from '@core/services/geoService';
import { isValidLatLng } from '@core/utils/geo';
import { isOnline } from '@core/utils/network';
import { Icon } from './Icon';
import { Spinner } from './ui';

const TYPE_ICON: Record<string, string> = {
  home: 'home',
  work: 'briefcase',
  favorite: 'favourite',
  airport: 'plane',
  recent: 'clock',
  current: 'current-location',
};

interface Props {
  query: string;
  near?: LatLng | null;
  saved: LocationItem[];
  recent: GeoPlace[];
  onSelect: (place: GeoPlace) => void;
  onUseCurrent?: () => void;
  locating?: boolean;
  locationNote?: string;
  onPinOnMap?: () => void;
}

interface SearchState {
  query: string;
  results: GeoPlace[];
  error: string;
}

const NONE: GeoPlace[] = [];

function Row({ icon, title, subtitle, onClick, busy }: { icon: string; title: string; subtitle?: string; onClick: () => void; busy?: boolean }) {
  return (
    <li>
      <button type="button" className="place-row" onClick={onClick}>
        <span className="place-row__icon">{busy ? <Spinner /> : <Icon name={icon} size={20} />}</span>
        <span className="place-row__text">
          <strong className="truncate">{title}</strong>
          {subtitle ? <small className="truncate">{subtitle}</small> : null}
        </span>
      </button>
    </li>
  );
}

export function PlaceSuggestions({ query, near, saved, recent, onSelect, onUseCurrent, locating, locationNote, onPinOnMap }: Props) {
  const q = query.trim();
  const active = q.length >= 3;
  const [search, setSearch] = useState<SearchState>({ query: '', results: [], error: '' });
  const settled = active && search.query === q;
  const results = settled ? search.results : NONE;
  const error = settled ? search.error : '';
  const loading = active && !settled;

  // Debounced search; superseded requests are aborted.
  useEffect(() => {
    if (q.length < 3) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, near ?? null, controller.signal)
        .then((r) => {
          if (controller.signal.aborted) return;
          setSearch({ query: q, results: r, error: r.length ? '' : 'No places found. Try a landmark, area or city name.' });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearch({ query: q, results: [], error: isOnline() ? 'Search is temporarily unavailable. Please try again.' : 'You’re offline — search needs a connection.' });
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [q, near?.lat, near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps -- coordinates, not object identity

  const pick = useMemo(
    () => (p: LocationItem) => {
      if (isValidLatLng(p as Partial<LatLng>)) onSelect(p as GeoPlace);
    },
    [onSelect],
  );

  if (active) {
    return (
      <div className="suggest" aria-live="polite">
        {loading ? (
          <p className="suggest__status">
            <Spinner /> Searching…
          </p>
        ) : null}
        {error ? <p className="suggest__status">{error}</p> : null}
        {results.length ? (
          <ul>
            {results.map((p) => (
              <Row key={p.id} icon={p.type === 'airport' ? 'plane' : 'location-pin'} title={p.name} subtitle={p.address !== p.name ? p.address : undefined} onClick={() => pick(p)} />
            ))}
          </ul>
        ) : null}
        {onPinOnMap ? (
          <ul>
            <Row icon="location-pin" title="Choose on map" subtitle="Move the map to drop a pin" onClick={onPinOnMap} />
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="suggest">
      <ul>
        {onUseCurrent ? <Row icon="current-location" title={locating ? 'Finding your location…' : 'Use my current location'} subtitle={locationNote} onClick={onUseCurrent} busy={locating} /> : null}
        {onPinOnMap ? <Row icon="location-pin" title="Choose on map" subtitle="Move the map to drop a pin" onClick={onPinOnMap} /> : null}
      </ul>
      {saved.length ? (
        <>
          <p className="eyebrow suggest__head">Saved places</p>
          <ul>
            {saved.map((p) => (
              <Row key={p.id} icon={TYPE_ICON[p.type] ?? 'saved-place'} title={p.name} subtitle={p.address} onClick={() => pick(p)} />
            ))}
          </ul>
        </>
      ) : null}
      {recent.length ? (
        <>
          <p className="eyebrow suggest__head">Recent</p>
          <ul>
            {recent.map((p) => (
              <Row key={p.id} icon="clock" title={p.name} subtitle={p.address !== p.name ? p.address : undefined} onClick={() => pick(p)} />
            ))}
          </ul>
        </>
      ) : null}
      {!saved.length && !recent.length ? <p className="suggest__status">Type at least 3 letters to search for a place.</p> : null}
    </div>
  );
}
