// A pickup / drop field with a small crosshair button that detects the current location.
// On phones, tapping it opens the full-screen search page (the keyboard then never covers the field or
// the suggestions). On wider screens you type in place and the same suggestions open under the field.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { reverseGeocode } from '@core/services/geoService';
import { isValidLatLng } from '@core/utils/geo';
import { Spinner } from './ui';
import { Icon } from './Icon';
import type { PickerConfig } from './LocationPicker';
import { PinDialog } from './PinDialog';
import { PlaceIcon } from './placeSearch/PlaceIcon';
import { PlaceSearchPage } from './placeSearch/PlaceSearchPage';
import { SuggestionList, type Shortcut } from './placeSearch/SuggestionList';
import { usePlaceSuggestions } from './placeSearch/usePlaceSuggestions';
import type { TreeRow } from './placeSearch/model';
import { useDeviceLocation, useMediaQuery } from '@/lib/hooks';
import { LOCATION_HELP } from '@/lib/schedule';

/** Phones (and short touch screens, such as a phone held sideways) search on a separate page. */
const PAGE_QUERY = '(max-width: 899.98px), (pointer: coarse) and (max-height: 599.98px)';

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

const MAX_H = 440;
const MIN_W = 360;

export function PlaceField({ value, config, saved, recent, onSelect, placeholder, inputClassName = '', inputId, inputRef, ariaLabelledBy, ariaDescribedBy, invalid, showLocate, anchorSelector = '[data-pf-anchor]' }: PlaceFieldProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputEl = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const onPage = useMediaQuery(PAGE_QUERY);
  const [page, setPage] = useState<{ notice: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<Pos | null>(null);
  const [reject, setReject] = useState('');
  const [mapMode, setMapMode] = useState(false);
  const [locTried, setLocTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const { error: locError, permission, locating, locate } = useDeviceLocation(false);

  const dropdown = open && !onPage;
  const query = dirty ? text : '';
  const q = query.trim();
  const canLocate = showLocate ?? config.allowCurrent ?? false;
  const model = usePlaceSuggestions({ config, query, saved, recent, enabled: dropdown });

  useEffect(() => setActive(-1), [q, open]);

  // ── The search page ─────────────────────────────────────────────────────
  const openPage = useCallback((notice = '') => {
    // Rendered during the tap itself, so the phone raises the keyboard for the page's search box.
    flushSync(() => setPage((p) => p ?? { notice }));
  }, []);
  const closePage = useCallback(() => {
    setPage(null);
    window.requestAnimationFrame(() => inputEl.current?.focus({ preventScroll: true }));
  }, []);

  // The whole field box opens the page, not only the line of text inside it.
  useEffect(() => {
    if (!onPage) return undefined;
    const box = rootRef.current?.closest(anchorSelector);
    if (!box) return undefined;
    const tap = (e: Event) => {
      if (!(e.target as Element).closest('button, a, input, label, select')) openPage();
    };
    box.addEventListener('click', tap);
    return () => box.removeEventListener('click', tap);
  }, [onPage, anchorSelector, openPage]);

  // ── Popup placement: fixed under the field, flips above when there is no room ──
  const place = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const box = (root.closest(anchorSelector) ?? root).getBoundingClientRect();
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const vw = document.documentElement.clientWidth;
    const below = vh - box.bottom - 10;
    const above = box.top - 10;
    const flip = below < 260 && above > below;
    const room = Math.max(140, Math.min(MAX_H, flip ? above : below));
    const width = Math.min(Math.max(box.width, MIN_W), vw - 16);
    const left = Math.max(8, Math.min(box.left, vw - width - 8));
    setPos({ top: flip ? box.top - 6 : box.bottom + 6, left, width, maxHeight: room, above: flip });
  }, [anchorSelector]);

  useLayoutEffect(() => {
    if (!dropdown) return undefined;
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
  }, [dropdown, place, model.rows.length]);

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
      if (onPage) openPage(why);
      else {
        setReject(why);
        setOpen(true);
      }
      return;
    }
    setReject('');
    close();
    inputEl.current?.blur();
    onSelect(picked);
  };

  const pickRow = (row: TreeRow) => {
    if (row.node.place) choose(row.node.place);
    else model.toggle(row);
  };

  const detectCurrent = async () => {
    setReject('');
    setLocTried(true);
    setBusy(true);
    const failed = (why: string) => {
      if (onPage) openPage(why);
      else setOpen(true);
    };
    try {
      const at = await locate();
      if (!at) {
        failed('We couldn’t get your current location. Allow location access, or search for the place instead.');
        return;
      }
      const found = await reverseGeocode(at);
      choose({ ...found, type: 'current' });
    } catch {
      const why = 'We couldn’t read your address. Please search for it instead.';
      if (!onPage) setReject(why);
      failed(why);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onPage) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        openPage();
      }
      return;
    }
    const n = model.rows.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => (n ? (i + 1) % n : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (n ? (i <= 0 ? n - 1 : i - 1) : -1));
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && open && active >= 0) {
      // Opens or closes the highlighted state, district or city.
      const row = model.rows[active];
      if (row?.expandable && row.open !== (e.key === 'ArrowRight')) {
        e.preventDefault();
        model.toggle(row);
      }
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      const target = model.rows[active] ?? (q ? model.rows.find((r) => r.node.place) : undefined);
      if (target) pickRow(target);
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
  const shown = dropdown && dirty ? text : value?.name ?? '';
  const shortcuts: Shortcut[] = config.pinMode
    ? [{ id: 'map', title: 'Choose on map', subtitle: 'Drop a pin on the exact spot', onClick: () => { setOpen(false); setMapMode(true); } }]
    : [];

  const popup =
    dropdown && pos
      ? createPortal(
          <div
            ref={popRef}
            id={listId}
            role="listbox"
            className={`pf-pop ps-pop ${pos.above ? 'pf-pop--above' : ''}`}
            style={{ left: pos.left, width: pos.width, maxHeight: pos.maxHeight, ...(pos.above ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <SuggestionList
              model={model}
              query={query}
              active={active}
              idPrefix={`${uid}-opt`}
              shortcuts={q ? [] : shortcuts}
              selectedId={value?.id}
              onActive={setActive}
              onPick={pickRow}
              notices={
                <>
                  {reject ? (
                    <p className="ps-note ps-note--error" role="alert">
                      <Icon name="warning" size={16} /> {reject}
                    </p>
                  ) : null}
                  {locTried && locNote && !busy && !locating ? (
                    <p className="ps-note" role="status">
                      <Icon name="info" size={16} /> {locNote}
                    </p>
                  ) : null}
                </>
              }
            />
            {q && config.pinMode && !model.searching ? (
              <button type="button" className="ps-footmap" onClick={shortcuts[0]!.onClick}>
                <PlaceIcon kind="map" size={18} /> Can’t find it? Choose on map
              </button>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`pf ${dropdown ? 'is-open' : ''} ${onPage ? 'is-page' : ''}`}>
      <input
        ref={(el) => {
          inputEl.current = el;
          inputRef?.(el);
        }}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={onPage ? !!page : open}
        aria-haspopup={onPage ? 'dialog' : 'listbox'}
        aria-controls={dropdown ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={dropdown && active >= 0 ? `${uid}-opt-${active}` : undefined}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        className={`pf__input ${inputClassName}`}
        value={shown}
        readOnly={onPage}
        placeholder={config.placeholder ?? placeholder ?? 'City, area or landmark'}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        title={value ? [value.name, value.address !== value.name ? value.address : ''].filter(Boolean).join(', ') : undefined}
        onClick={() => {
          if (onPage) openPage();
          else setOpen(true);
        }}
        onFocus={(e) => {
          if (onPage) return;
          setOpen(true);
          setReject('');
          e.currentTarget.select();
        }}
        onChange={(e) => {
          if (onPage) return;
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
      {dropdown && dirty && text ? (
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
          {busy || locating ? <Spinner /> : <Icon name="my-location" size={22} />}
        </button>
      ) : null}
      {popup}
      {page ? <PlaceSearchPage config={{ ...config, placeholder: config.placeholder ?? placeholder }} value={value} notice={page.notice} saved={saved} recent={recent} onSelect={onSelect} onClose={closePage} /> : null}
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
