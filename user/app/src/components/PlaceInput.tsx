// An inline pickup / drop field: type and the suggestions open right below the input (saved + recent places,
// popular cities, live Photon search) with a small crosshair button that detects the current location.
// It replaced the old full-screen place-search modal, so no separate page is needed to enter a place.
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { GeoPlace, LatLng, LocationItem } from '../types';
import { LOCATION_ERROR_TEXT, reverseGeocode, searchPlaces } from '../services/geoService';
import { useDeviceLocation } from '../hooks/useDeviceLocation';
import { isValidLatLng } from '../utils/geo';
import { isOnline } from '../utils/network';
import { colors, fonts } from '../theme';
import { Icon, type IconName } from './Icon';
import { FieldScrollContext } from './fieldScroll';

const FIELD_LINE = '#DAC0C9';

const TYPE_ICON: Partial<Record<LocationItem['type'], IconName>> = {
  home: 'house',
  work: 'briefcase',
  favorite: 'star',
  airport: 'plane',
  recent: 'clock-3',
};

interface Row {
  key: string;
  head?: string;
  place: LocationItem;
  icon: IconName;
  sub: string;
}

interface Props {
  label: string;
  value?: GeoPlace | null;
  onSelect: (place: GeoPlace) => void;
  error?: string;
  /** A control shown at the right edge (e.g. delete stop). */
  trailing?: React.ReactNode;
  /** A pin shown inside the field, before the text. */
  leading?: React.ReactNode;
  saved?: LocationItem[];
  recent?: GeoPlace[];
  /** Fixed suggestions (popular cities, airports) shown before the user types. */
  suggestions?: GeoPlace[];
  suggestionsLabel?: string;
  near?: LatLng | null;
  /** Show the current-location button (default true). */
  allowLocate?: boolean;
  /** Only accept places this returns '' for; otherwise the message is shown and the place is not used. */
  check?: (p: GeoPlace) => string;
  /** Restrict live search results (airport fields). */
  resultFilter?: (p: GeoPlace) => boolean;
  placeholder?: string;
  /** Called when the field gets focus, so a screen can scroll it into view. */
  onFocusField?: () => void;
}

const MAX_ROWS = 7;

export function PlaceInput({ label, value, onSelect, error, trailing, leading, saved = [], recent = [], suggestions = [], suggestionsLabel = 'Popular locations', near, allowLocate = true, check, resultFilter, placeholder = 'City, area or landmark', onFocusField }: Props) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [text, setText] = useState('');
  const [reject, setReject] = useState('');
  const [locTried, setLocTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState<{ query: string; results: GeoPlace[]; error: string }>({ query: '', results: [], error: '' });
  const input = useRef<TextInput>(null);
  const wrap = useRef<View>(null);
  const scrollIntoView = useContext(FieldScrollContext);
  const pressing = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const { error: locError, locating, locate } = useDeviceLocation(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(blurTimer.current);
    };
  }, []);

  const q = (dirty ? text : '').trim();
  const active = open && q.length >= 3;
  const settled = active && search.query === q;
  const loading = active && !settled;

  useEffect(() => {
    if (!open || q.length < 3) return undefined;
    const controller = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(q, near ?? null, controller.signal)
        .then((raw) => {
          if (controller.signal.aborted) return;
          const r = resultFilter ? raw.filter(resultFilter) : raw;
          setSearch({ query: q, results: r, error: r.length ? '' : 'No places found. Try a landmark, area or city name.' });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearch({ query: q, results: [], error: isOnline() ? 'Search is temporarily unavailable. Please try again.' : 'You’re offline — search needs a connection.' });
        });
    }, 320);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, q, near?.lat, near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps -- coordinates, not object identity

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const lower = q.toLowerCase();
    const matches = (p: LocationItem) => !lower || `${p.name} ${p.address}`.toLowerCase().includes(lower);
    const add = (head: string, list: LocationItem[], icon: (p: LocationItem) => IconName, sub: (p: LocationItem) => string, cap: number) => {
      list.slice(0, cap).forEach((p, i) => out.push({ key: `${head}-${i}-${p.id}`, head: i === 0 ? head : undefined, place: p, icon: icon(p), sub: sub(p) }));
    };
    if (q.length >= 3) {
      add('Suggested', suggestions.filter(matches), (p) => TYPE_ICON[p.type] ?? 'map-pin', (p) => p.address, 3);
      if (settled) add('Search results', search.results, (p) => (p.type === 'airport' ? 'plane' : 'map-pin'), (p) => p.address, MAX_ROWS);
    } else {
      if (!q) {
        add('Saved addresses', saved, (p) => TYPE_ICON[p.type] ?? 'map-pin', (p) => p.address, 3);
        add('Recent', recent, () => 'clock-3', (p) => p.address, 3);
      }
      add(suggestionsLabel, suggestions.filter(matches), (p) => TYPE_ICON[p.type] ?? 'map-pin', (p) => p.address, 5);
    }
    return out;
  }, [q, settled, search.results, saved, recent, suggestions, suggestionsLabel]);

  const close = () => {
    setOpen(false);
    setDirty(false);
    setText('');
    setLocTried(false);
    setReject('');
  };

  const choose = (p: LocationItem | GeoPlace) => {
    if (!isValidLatLng(p as Partial<LatLng>)) return;
    const place = p as GeoPlace;
    const why = check?.(place) ?? '';
    if (why) {
      setReject(why);
      return;
    }
    close();
    input.current?.blur();
    onSelect(place);
  };

  const detectCurrent = async () => {
    setReject('');
    setLocTried(true);
    setOpen(true);
    setBusy(true);
    try {
      const pos = await locate();
      if (!pos) return;
      const found = await reverseGeocode(pos);
      if (mounted.current) choose({ ...found, type: 'current' });
    } catch {
      if (mounted.current) setReject('We couldn’t read your address. Please search for it instead.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  // While the field is open it starts empty (the current place becomes the hint), so typing never appends to the old name.
  const shown = open ? (dirty ? text : '') : value?.name ?? '';
  const showAddr = !open && !!value && value.address && value.address !== value.name;
  const note = reject || (locTried && !busy && !locating && locError ? LOCATION_ERROR_TEXT[locError.kind] : '');
  const empty = open && !rows.length && !loading;
  const emptyText = settled && search.error ? search.error : q.length < 3 ? (q ? 'Keep typing to search every place.' : 'Type at least 3 letters to search for a place.') : '';

  return (
    <View ref={wrap} style={open ? styles.openWrap : undefined}>
      <View style={[styles.field, open && styles.fieldOpen, !!error && !open && styles.fieldError]}>
        {leading}
        <View style={styles.main}>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <TextInput
            ref={input}
            value={shown}
            placeholder={open && value ? value.name : placeholder}
            placeholderTextColor="#9A958C"
            style={[styles.input, Platform.OS === 'web' && ({ outlineStyle: 'none', outlineWidth: 0 } as object)]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel={`${label}${value ? `: ${value.name}` : ''}`}
            accessibilityHint={error || 'Type to search for a place'}
            onFocus={() => {
              clearTimeout(blurTimer.current);
              setOpen(true);
              onFocusField?.();
              if (scrollIntoView) setTimeout(() => wrap.current && scrollIntoView(wrap.current), 60);
            }}
            onBlur={() => {
              // A tap on a suggestion blurs the input first; wait for that tap to finish before closing.
              blurTimer.current = setTimeout(() => {
                if (mounted.current && !pressing.current) close();
              }, 220);
            }}
            onChangeText={(t) => {
              setDirty(true);
              setText(t);
              setReject('');
              setOpen(true);
            }}
            onSubmitEditing={() => {
              const first = rows[0];
              if (first) choose(first.place);
            }}
          />
          {showAddr ? (
            <Text style={styles.addr} numberOfLines={1}>
              {value?.address}
            </Text>
          ) : null}
        </View>
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        {open && dirty && text ? (
          <Pressable onPress={() => { setText(''); setDirty(true); input.current?.focus(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear" style={styles.iconBtn}>
            <Icon name="x" size={16} color="#9A958C" strokeWidth={2} />
          </Pressable>
        ) : null}
        {allowLocate ? (
          <Pressable
            onPress={() => void detectCurrent()}
            disabled={busy || locating}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Use my current location"
            style={({ pressed }) => [styles.locate, pressed && { opacity: 0.7 }]}
          >
            {busy || locating ? <ActivityIndicator size="small" color={colors.primary} /> : <Icon name="crosshair" size={19} color={colors.primary} strokeWidth={2} />}
          </Pressable>
        ) : null}
        {trailing}
      </View>
      {error && !open ? <Text style={styles.error}>{error}</Text> : null}
      {open ? (
        <View style={styles.pop} accessibilityLiveRegion="polite">
          {note ? (
            <View style={styles.note}>
              <Icon name="info" size={15} color={reject ? colors.danger : colors.muted} strokeWidth={2} />
              <Text style={[styles.noteText, !!reject && { color: colors.danger }]}>{note}</Text>
            </View>
          ) : null}
          {rows.map((r) => (
            <View key={r.key}>
              {r.head ? <Text style={styles.head}>{r.head}</Text> : null}
              <Pressable
                onPressIn={() => {
                  pressing.current = true;
                  clearTimeout(blurTimer.current);
                }}
                onPressOut={() => {
                  setTimeout(() => {
                    pressing.current = false;
                  }, 400);
                }}
                onPress={() => choose(r.place)}
                accessibilityRole="button"
                accessibilityLabel={`${r.place.name}, ${r.sub}`}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.subtle }]}
              >
                <View style={styles.rowIcon}>
                  <Icon name={r.icon} size={17} color={colors.muted} strokeWidth={1.8} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {r.place.name}
                  </Text>
                  {r.sub ? (
                    <Text style={styles.sub} numberOfLines={1}>
                      {r.sub}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            </View>
          ))}
          {loading ? (
            <View style={styles.status}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.statusText}>Searching…</Text>
            </View>
          ) : empty && emptyText ? (
            <Text style={styles.statusText}>{emptyText}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  openWrap: { zIndex: 5 },
  field: {
    minHeight: 64,
    paddingVertical: 9,
    paddingLeft: 16,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: FIELD_LINE,
    borderRadius: 6,
    backgroundColor: colors.white,
  },
  fieldOpen: { borderColor: colors.primary, borderWidth: 1.5 },
  fieldError: { borderColor: colors.danger, backgroundColor: '#FFFBFA' },
  main: { flex: 1, minWidth: 0 },
  label: { fontFamily: fonts.bold, fontSize: 10.5, lineHeight: 14, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.muted },
  input: { fontFamily: fonts.extraBold, fontSize: 16, lineHeight: 22, color: colors.ink, paddingVertical: 0, paddingHorizontal: 0, minHeight: 24 },
  addr: { fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 15, color: colors.muted },
  iconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  locate: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FCE9E9', borderWidth: 1, borderColor: '#F5B0B2' },
  error: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: colors.danger, marginTop: 5, marginLeft: 2 },
  pop: {
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.white,
    shadowColor: '#14171C',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  head: { fontFamily: fonts.bold, fontSize: 10.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 8 },
  rowIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.subtle, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.ink },
  sub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.muted, marginTop: 1 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, margin: 4, padding: 9, borderRadius: 8, backgroundColor: colors.subtle },
  noteText: { flex: 1, fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 17, color: colors.muted },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  statusText: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.muted, padding: 10 },
});
