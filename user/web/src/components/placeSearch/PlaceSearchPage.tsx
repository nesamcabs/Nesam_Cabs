// Choosing a pickup or drop on its own page: the search box stays at the top, the suggestions scroll in
// the space left above the on-screen keyboard, and Back returns to the booking form.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { reverseGeocode } from '@core/services/geoService';
import { isValidLatLng } from '@core/utils/geo';
import { useDeviceLocation } from '@/lib/hooks';
import { LOCATION_HELP } from '@/lib/schedule';
import { Icon } from '../Icon';
import type { PickerConfig } from '../LocationPicker';
import { PinDialog } from '../PinDialog';
import { useBackEntry } from './backEntry';
import type { TreeRow } from './model';
import { PlaceIcon } from './PlaceIcon';
import { SuggestionList, type Shortcut } from './SuggestionList';
import { usePlaceSuggestions } from './usePlaceSuggestions';

export interface PlaceSearchPageProps {
  config: PickerConfig;
  saved: LocationItem[];
  recent: GeoPlace[];
  /** The place already in the field, marked in the list. */
  value?: GeoPlace | null;
  /** A message to open with (e.g. why the current location could not be read). */
  notice?: string;
  onSelect: (place: GeoPlace) => void;
  onClose: () => void;
}

/** The part of the screen that is actually visible: shorter than the window while the keyboard is up. */
function useVisibleArea() {
  const read = () => {
    const vv = window.visualViewport;
    return { top: Math.round(vv?.offsetTop ?? 0), height: Math.round(vv?.height ?? window.innerHeight) };
  };
  const [area, setArea] = useState(read);
  useLayoutEffect(() => {
    const on = () => setArea(read());
    const vv = window.visualViewport;
    on();
    vv?.addEventListener('resize', on);
    vv?.addEventListener('scroll', on);
    window.addEventListener('resize', on);
    return () => {
      vv?.removeEventListener('resize', on);
      vv?.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, []);
  return area;
}

export function PlaceSearchPage({ config, saved, recent, value, notice, onSelect, onClose }: PlaceSearchPageProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [reject, setReject] = useState('');
  const [message, setMessage] = useState(notice ?? '');
  const [mapMode, setMapMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locTried, setLocTried] = useState(false);
  const { error: locError, permission, locating, locate } = useDeviceLocation(false);
  const model = usePlaceSuggestions({ config, query, saved, recent, enabled: true });
  const area = useVisibleArea();

  useBackEntry(() => {
    if (mapMode) {
      setMapMode(false);
      return true;
    }
    onClose();
    return false;
  });

  // Focus inside the tap that opened the page, so the phone shows its keyboard straight away.
  useLayoutEffect(() => {
    if (!mapMode) inputRef.current?.focus({ preventScroll: true });
  }, [mapMode]);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  useEffect(() => {
    setActive(-1);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [query]);

  useEffect(() => {
    if (active >= 0) bodyRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (p: LocationItem | GeoPlace) => {
    if (!isValidLatLng(p as Partial<LatLng>)) return;
    const picked = p as GeoPlace;
    const why = config.check?.(picked) ?? '';
    if (why) {
      setReject(why);
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      return;
    }
    inputRef.current?.blur();
    onSelect(picked);
    onClose();
  };

  const useCurrent = async () => {
    setReject('');
    setMessage('');
    setLocTried(true);
    setBusy(true);
    try {
      const pos = await locate();
      if (!pos) return;
      const found = await reverseGeocode(pos);
      choose({ ...found, type: 'current' });
    } catch {
      setMessage('We couldn’t read your address. Please search for it instead.');
    } finally {
      setBusy(false);
    }
  };

  if (mapMode)
    return (
      <PinDialog
        title={config.title}
        mode={config.pinMode ?? 'pickup'}
        onBack={() => setMapMode(false)}
        onConfirm={(p) => {
          setMapMode(false);
          choose(p);
        }}
      />
    );

  const shortcuts: Shortcut[] = [];
  const finding = busy || locating;
  if (config.allowCurrent) shortcuts.push({ id: 'current', title: finding ? 'Finding you…' : 'My location', subtitle: 'Use device GPS', busy: finding, onClick: () => void useCurrent() });
  if (config.pinMode) shortcuts.push({ id: 'map', title: 'Choose on map', subtitle: 'Drop an exact pin', onClick: () => setMapMode(true) });

  const locNote = locTried && !finding ? (locError ? LOCATION_HELP[locError.kind] : permission === 'denied' || permission === 'blocked' ? LOCATION_HELP.blocked : '') : '';
  const compact = area.height < 520;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The page may sit above a dialog; its own keys must not reach that dialog.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab') e.stopPropagation();
    if (e.target !== inputRef.current) return;
    const n = model.rows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (!n ? -1 : e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1));
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && active >= 0) {
      const row = model.rows[active];
      if (row?.expandable && row.open !== (e.key === 'ArrowRight')) {
        e.preventDefault();
        model.toggle(row);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target: TreeRow | undefined = model.rows[active] ?? (query.trim() ? model.rows.find((r) => r.node.place) : undefined);
      if (!target) inputRef.current?.blur();
      else if (target.node.place) choose(target.node.place);
      else model.toggle(target);
    }
  };

  return createPortal(
    <div className="ps-overlay" onKeyDown={onKeyDown} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`ps-page ${compact ? 'is-compact' : ''}`}
        style={{ '--ps-top': `${area.top}px`, '--ps-height': `${area.height}px` } as React.CSSProperties}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-mode={config.pinMode ?? 'any'}
      >
        <header className="ps-bar">
          <div className="ps-bar__title">
            <h2 id={titleId}>{config.title}</h2>
            <p>{config.subtitle ?? 'Search a city, area or landmark'}</p>
          </div>
          <div className="ps-bar__row">
            <button type="button" className="ps-back" aria-label="Back to booking" onClick={onClose}>
              <PlaceIcon kind="back" size={22} />
            </button>
            <div className="ps-search" data-no-reveal>
              <span className="ps-search__dot" aria-hidden="true" />
              <input
                ref={inputRef}
                className="ps-search__input"
                type="text"
                inputMode="search"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
                aria-label={config.title}
                value={query}
                placeholder={config.placeholder ?? 'City, area or landmark'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="words"
                spellCheck={false}
                enterKeyHint="search"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setReject('');
                  setMessage('');
                }}
              />
              {query ? (
                <button
                  type="button"
                  className="ps-search__clear"
                  aria-label="Clear"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                >
                  <PlaceIcon kind="close" size={16} />
                </button>
              ) : null}
            </div>
          </div>
        </header>
        <div
          ref={bodyRef}
          id={listId}
          role="listbox"
          aria-label="Suggestions"
          className="ps-body"
          // Tapping a suggestion keeps the keyboard where it is, so the list does not jump under the finger.
          onMouseDown={(e) => e.preventDefault()}
          // Scrolling the list puts the keyboard away and gives the list the whole screen.
          onTouchMove={() => document.activeElement === inputRef.current && inputRef.current?.blur()}
        >
          <SuggestionList
            model={model}
            query={query}
            active={active}
            idPrefix={`${uid}-opt`}
            shortcuts={query.trim() ? [] : shortcuts}
            selectedId={value?.id}
            onPick={(row) => row.node.place && choose(row.node.place)}
            notices={
              <>
                {reject ? (
                  <p className="ps-note ps-note--error" role="alert">
                    <Icon name="warning" size={16} /> {reject}
                  </p>
                ) : null}
                {message || locNote ? (
                  <p className="ps-note" role="status">
                    <Icon name="info" size={16} /> {message || locNote}
                  </p>
                ) : null}
              </>
            }
          />
          {query.trim() && config.pinMode && !model.searching ? (
            <button type="button" className="ps-footmap" onClick={() => setMapMode(true)}>
              <PlaceIcon kind="map" size={18} /> Can’t find it? Choose on map
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
