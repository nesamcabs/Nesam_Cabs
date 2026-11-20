// An inline pickup / drop field: type and the suggestions open right below the input (live search,
// saved + recent places, popular cities) with a small crosshair button that detects the current location.
// No separate page or dialog is needed to enter a place; "Choose on map" is the only optional extra step.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { reverseGeocode, searchPlaces } from '@core/services/geoService';
import { isValidLatLng } from '@core/utils/geo';
import { isOnline } from '@core/utils/network';
import { Spinner } from './ui';
import { Icon } from './Icon';
import { PinDialog, type PickerConfig } from './LocationPicker';
import { useDeviceLocation } from '@/lib/hooks';
import { LOCATION_HELP } from '@/lib/schedule';

const TYPE_ICON: Record<string, string> = { home: 'home', work: 'briefcase', airport: 'plane', recent: 'clock', current: 'navigation' };

interface Option {
  key: string;
  kind: 'place' | 'map';
  place?: GeoPlace | LocationItem;
  icon: string;
  title: string;
  subtitle?: string;
}
interface Section {
  head?: string;
  options: Option[];
}
interface Pos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  above: boolean;
}

export interface PlaceFieldProps {
  value: GeoPlace | null;
  config: PickerConfig;
  saved: LocationItem[];
  recent: GeoPlace[];
  onSelect: (place: GeoPlace) => void;
  placeholder?: string;
  /** Extra classes for the input, so a form can reuse its own field typography. */
  inputClassName?: string;
  inputId?: string;
  inputRef?: (el: HTMLInputElement | null) => void;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  invalid?: boolean;
  /** Hide the current-location button (e.g. for an airport-only field). Defaults to `config.allowCurrent`. */
  showLocate?: boolean;
  /** The popup is as wide as the nearest ancestor carrying this attribute (the visible field box). */
  anchorSelector?: string;
}

const MAX_H = 380;

export function PlaceField({ value, config, saved, recent, onSelect, placeholder, inputClassName = '', inputId, inputRef, ariaLabelledBy, ariaDescribedBy, invalid, showLocate, anchorSelector = '[data-pf-anchor]' }: PlaceFieldProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const [reject, setReject] = useState('');
  const [mapMode, setMapMode] = useState(false);
  const [locTried, setLocTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ q: string; list: GeoPlace[]; error: string }>({ q: '', list: [], error: '' });
  const { error: locError, permission, locating, locate } = useDeviceLocation(false);

  const query = dirty ? text : '';
  const q = query.trim();
  const searching = open && q.length >= 3 && results.q !== q;
  const near: LatLng | null = config.near ?? null;
  const canLocate = showLocate ?? config.allowCurrent ?? false;

  // ── Live search (debounced, superseded requests aborted) ────────────────
  useEffect(() => {
    if (!open || q.length < 3) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, near, controller.signal)
        .then((raw) => {
          if (controller.signal.aborted) return;
          const r = config.resultFilter ? raw.filter(config.resultFilter) : raw;
          const own = config.resultFilter ? config.popular.some((p) => `${p.name} ${p.address}`.toLowerCase().includes(q.toLowerCase())) : false;
          setResults({ q, list: r, error: r.length || own ? '' : config.emptyText ?? 'No places found. Try a landmark, area or city name.' });
        })
        .catch(() => !controller.signal.aborted && setResults({ q, list: [], error: isOnline() ? 'Search is temporarily unavailable. Please try again.' : 'You’re offline — search needs a connection.' }));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, q, near?.lat, near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps -- coordinates, not object identity

  // ── Suggestion list ─────────────────────────────────────────────────────
  const lower = q.toLowerCase();
  const sections: Section[] = useMemo(() => {
    const out: Section[] = [];
    const placeOption = (p: GeoPlace | LocationItem, icon: string, withAddress = true): Option => ({
      key: `${icon}-${p.id}`,
      kind: 'place',
      place: p,
      icon,
      title: p.name,
      subtitle: withAddress && p.address !== p.name ? p.address : undefined,
    });
    if (q.length >= 3) {
      const found = results.q === q ? results.list : [];
      const ownMatches = config.resultFilter ? config.popular.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(lower)) : [];
      const list = config.resultFilter ? [...ownMatches, ...found.filter((p) => !config.popular.some((c) => c.name.toLowerCase() === p.name.toLowerCase()))] : found;
      if (list.length) out.push({ head: 'Search results', options: list.map((p) => placeOption(p, p.type === 'airport' ? 'plane' : 'map-pin')) });
    } else {
      const quiet = !q && !config.resultFilter;
      if (quiet && saved.length) out.push({ head: 'Saved addresses', options: saved.map((p) => placeOption(p, TYPE_ICON[p.type] ?? 'star')) });
      if (quiet && recent.length) out.push({ head: 'Recent', options: recent.map((p) => placeOption(p, 'clock')) });
      const pop = q ? config.popular.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(lower)) : config.popular;
      if (pop.length) out.push({ head: config.popularLabel ?? 'Popular locations', options: pop.map((p) => placeOption(p, p.type === 'airport' ? 'plane' : 'map-pin')) });
    }
    if (config.pinMode) out.push({ options: [{ key: 'map', kind: 'map', icon: 'map-pin', title: 'Choose on map', subtitle: 'Drop a pin on the exact spot' }] });
    return out;
  }, [q, lower, results, saved, recent, config.popular, config.popularLabel, config.resultFilter, config.pinMode]);
  const flat = useMemo(() => sections.flatMap((s) => s.options), [sections]);

  useEffect(() => setActive(-1), [q, open]);

  // ── Popup placement: fixed under the field, flips above when there is no room ──
  const place = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const box = (root.closest(anchorSelector) ?? root).getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const below = vh - box.bottom - 10;
    const above = box.top - 10;
    const flip = below < 220 && above > below;
    const room = Math.max(140, Math.min(MAX_H, flip ? above : below));
    setPos({ top: flip ? box.top - 6 : box.bottom + 6, left: box.left, width: box.width, maxHeight: room, above: flip });
  }, [anchorSelector]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    const on = () => place();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    window.visualViewport?.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
      window.visualViewport?.removeEventListener('resize', on);
    };
  }, [open, place, sections.length]);

  const close = useCallback(() => {
    setOpen(false);
    setDirty(false);
    setText('');
    setLocTried(false);
  }, []);

  // Outside click / tap closes the suggestions.
  useEffect(() => {
    if (!open) return undefined;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open, close]);

  useEffect(() => {
    if (active < 0) return;
    popRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // ── Choosing ────────────────────────────────────────────────────────────
  const choose = (p: LocationItem | GeoPlace) => {
    if (!isValidLatLng(p as Partial<LatLng>)) return;
    const picked = p as GeoPlace;
    const why = config.check?.(picked) ?? '';
    if (why) {
      setReject(why);
      setOpen(true);
      return;
    }
    setReject('');
    close();
    inputEl.current?.blur();
    onSelect(picked);
  };

  const pickOption = (o: Option) => {
    if (o.kind === 'map') {
      setOpen(false);
      setMapMode(true);
      return;
    }
    if (o.place) choose(o.place);
  };

  const detectCurrent = async () => {
    setReject('');
    setLocTried(true);
    setBusy(true);
    try {
      const pos = await locate();
      if (!pos) {
        setOpen(true);
        return;
      }
      const found = await reverseGeocode(pos);
      choose({ ...found, type: 'current' });
    } catch {
      setReject('We couldn’t read your address. Please search for it instead.');
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => (flat.length ? (i + 1) % flat.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (flat.length ? (i <= 0 ? flat.length - 1 : i - 1) : -1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const target = flat[active] ?? (q.length >= 1 ? flat.find((o) => o.kind === 'place') : undefined);
      if (target) pickOption(target);
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
        e.currentTarget.blur();
      }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  const locNote = locError ? LOCATION_HELP[locError.kind] : permission === 'denied' || permission === 'blocked' ? LOCATION_HELP.blocked : '';
  const shown = open && dirty ? text : value?.name ?? '';
  const statusLine = searching ? 'Searching…' : results.q === q && q.length >= 3 && results.error && !flat.some((o) => o.kind === 'place') ? results.error : '';

  let index = -1;
  const popup =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            id={listId}
            role="listbox"
            className={`pf-pop ${pos.above ? 'pf-pop--above' : ''}`}
            style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {reject ? (
              <p className="pf-note pf-note--error" role="alert">
                <Icon name="warning" size={16} /> {reject}
              </p>
            ) : null}
            {locTried && locNote && !busy && !locating ? (
              <p className="pf-note" role="status">
                <Icon name="info" size={16} /> {locNote}
              </p>
            ) : null}
            {sections.map((s, si) => (
              <div key={s.head ?? `s${si}`} className="pf-sec">
                {s.head ? <p className="pf-head">{s.head}</p> : null}
                {s.options.map((o) => {
                  index += 1;
                  const i = index;
                  return (
                    <div
                      key={o.key}
                      data-i={i}
                      role="option"
                      aria-selected={i === active}
                      className={`pf-opt ${o.kind === 'map' ? 'pf-opt--map' : ''} ${i === active ? 'is-active' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pickOption(o)}
                    >
                      <span className="pf-opt__icon">
                        <Icon name={o.icon} size={17} />
                      </span>
                      <span className="pf-opt__text">
                        <strong>{o.title}</strong>
                        {o.subtitle ? <small>{o.subtitle}</small> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
            {statusLine ? (
              <p className="pf-note pf-note--status" aria-live="polite">
                {searching ? <Spinner /> : null} {statusLine}
              </p>
            ) : !flat.some((o) => o.kind === 'place') && q.length < 3 ? (
              <p className="pf-note pf-note--status">{q ? 'Keep typing to search every place.' : 'Type at least 3 letters to search for a place.'}</p>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`pf ${open ? 'is-open' : ''}`}>
      <input
        ref={(el) => {
          inputEl.current = el;
          inputRef?.(el);
        }}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={undefined}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        className={`pf__input ${inputClassName}`}
        value={shown}
        placeholder={config.placeholder ?? placeholder ?? 'City, area or landmark'}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        title={value ? [value.name, value.address !== value.name ? value.address : ''].filter(Boolean).join(', ') : undefined}
        onFocus={(e) => {
          setOpen(true);
          setReject('');
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDirty(true);
          setText(e.target.value);
          setReject('');
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && (rootRef.current?.contains(next) || popRef.current?.contains(next))) return;
          // A tap on a suggestion keeps focus here (mousedown is cancelled), so a real blur means "done".
          window.setTimeout(() => {
            if (document.activeElement !== inputEl.current && !rootRef.current?.contains(document.activeElement)) close();
          }, 120);
        }}
      />
      {open && dirty && text ? (
        <button type="button" className="pf__btn pf__btn--clear" aria-label="Clear" onMouseDown={(e) => e.preventDefault()} onClick={() => { setText(''); setDirty(true); inputEl.current?.focus(); }}>
          <Icon name="close" size={15} />
        </button>
      ) : null}
      {canLocate ? (
        <button
          type="button"
          className={`pf__btn pf__btn--locate ${busy || locating ? 'is-busy' : ''}`}
          aria-label="Use my current location"
          title="Use my current location"
          disabled={busy || locating}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void detectCurrent()}
        >
          {busy || locating ? <Spinner /> : <Icon name="crosshair" size={18} />}
        </button>
      ) : null}
      {popup}
      {mapMode ? (
        <PinDialog
          title={config.title}
          mode={config.pinMode ?? 'pickup'}
          onBack={() => setMapMode(false)}
          onConfirm={(p) => {
            setMapMode(false);
            choose(p);
          }}
        />
      ) : null}
    </div>
  );
}
