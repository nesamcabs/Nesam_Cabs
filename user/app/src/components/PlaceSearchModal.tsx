// Full-screen place picker in the reference layout: page heading, search field,
// “Use current location”, saved addresses, recent and suggested places, and
// debounced Photon search (native port of user/web PlaceSearch.tsx).
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FlatList, Frame } from './layout';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { GeoPlace, LatLng, LocationItem } from '../types';
import { searchPlaces } from '../services/geoService';
import { isValidLatLng } from '../utils/geo';
import { isOnline } from '../utils/network';
import { colors, fonts, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { PageHead } from './ui';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (place: GeoPlace) => void;
  savedPlaces?: LocationItem[];
  recentPlaces?: GeoPlace[];
  /** Fixed suggestions (e.g. airports) shown before the user types. */
  suggestions?: GeoPlace[];
  suggestionsLabel?: string;
  near?: LatLng | null;
  onUseCurrentLocation?: () => void;
  /** Text to search for as soon as the picker opens (e.g. “airport”). */
  initialQuery?: string;
}

type Row =
  | { key: string; kind: 'current' }
  | { key: string; kind: 'header'; label: string }
  | { key: string; kind: 'place'; place: LocationItem; icon: IconName; sub: string };

const TYPE_ICON: Partial<Record<LocationItem['type'], IconName>> = {
  home: 'house',
  work: 'briefcase',
  favorite: 'star',
  airport: 'plane',
  recent: 'clock-3',
};

const TYPE_LABEL: Partial<Record<LocationItem['type'], string>> = { home: 'Home', work: 'Work', favorite: 'Saved', airport: 'Airport' };

export function PlaceSearchModal(props: Props) {
  // The body mounts fresh each time the picker opens, so it starts empty.
  return (
    <Modal visible={props.visible} animationType="slide" onRequestClose={props.onClose}>
      {props.visible ? <PlaceSearchBody {...props} /> : null}
    </Modal>
  );
}

const NO_RESULTS: GeoPlace[] = [];

interface SearchState {
  query: string;
  results: GeoPlace[];
  error: string;
}

function PlaceSearchBody({
  title,
  subtitle = 'Search a city, area or landmark.',
  onClose,
  onSelect,
  savedPlaces = [],
  recentPlaces = [],
  suggestions = [],
  suggestionsLabel = 'Suggested',
  near,
  onUseCurrentLocation,
  initialQuery = '',
}: Props) {
  const [text, setText] = useState(initialQuery);
  // Results are tagged with the query they answer; anything else is stale.
  const [search, setSearch] = useState<SearchState>({ query: '', results: [], error: '' });
  const q = text.trim();
  const active = q.length >= 3;
  const settled = active && search.query === q;
  const results = settled ? search.results : NO_RESULTS;
  const error = settled ? search.error : '';
  const loading = active && !settled;

  // Debounced search; stale requests are aborted.
  useEffect(() => {
    if (q.length < 3) return undefined;
    const controller = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(q, near ?? null, controller.signal)
        .then((r) => {
          if (!controller.signal.aborted) {
            setSearch({ query: q, results: r, error: r.length ? '' : 'No places found. Try a landmark, area or city name.' });
          }
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSearch({
            query: q,
            results: [],
            error: isOnline() ? 'Search is temporarily unavailable. Please try again.' : 'You’re offline — search needs a connection.',
          });
        });
    }, 400);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, near?.lat, near?.lng]); // eslint-disable-line react-hooks/exhaustive-deps -- coordinates, not the object identity

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const lower = q.toLowerCase();
    // Typing also filters the local lists, so a saved address or airport is one tap away.
    const matches = (p: LocationItem) => !lower || `${p.name} ${p.address}`.toLowerCase().includes(lower);
    if (!active && onUseCurrentLocation) out.push({ key: 'current', kind: 'current' });
    const saved = savedPlaces.filter(matches);
    if (saved.length) {
      out.push({ key: 'h-saved', kind: 'header', label: 'Saved addresses' });
      for (const p of saved) out.push({ key: `s-${p.id}`, kind: 'place', place: p, icon: TYPE_ICON[p.type] ?? 'map-pin', sub: TYPE_LABEL[p.type] ?? p.address });
    }
    const sugg = suggestions.filter(matches);
    if (sugg.length) {
      out.push({ key: 'h-sugg', kind: 'header', label: suggestionsLabel });
      for (const p of sugg) out.push({ key: `g-${p.id}`, kind: 'place', place: p, icon: TYPE_ICON[p.type] ?? 'map-pin', sub: p.address });
    }
    if (!active && recentPlaces.length) {
      out.push({ key: 'h-recent', kind: 'header', label: 'Recent' });
      for (const p of recentPlaces) out.push({ key: `r-${p.id}`, kind: 'place', place: p, icon: 'clock-3', sub: p.address });
    }
    if (active && results.length) {
      out.push({ key: 'h-results', kind: 'header', label: 'Search results' });
      for (const p of results) out.push({ key: `q-${p.id}`, kind: 'place', place: p, icon: p.type === 'airport' ? 'plane' : 'map-pin', sub: p.address });
    }
    return out;
  }, [active, q, results, savedPlaces, recentPlaces, suggestions, suggestionsLabel, onUseCurrentLocation]);

  const pick = (p: LocationItem) => {
    if (!isValidLatLng(p as Partial<LatLng>)) return;
    onSelect(p as GeoPlace);
    onClose();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Frame kind="narrow" style={styles.frame}>
        <PageHead title={title} subtitle={subtitle} onBack={onClose} />
        <View style={styles.searchBox}>
          <Icon name="search" size={18} color="#8D95A1" />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="City, area or landmark"
            placeholderTextColor="#8D95A1"
            autoFocus
            style={styles.input}
            returnKeyType="search"
            autoCorrect={false}
            accessibilityLabel={`Search ${title.toLowerCase()}`}
          />
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          {text ? (
            <Pressable onPress={() => setText('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <Icon name="x" size={16} color="#8D95A1" />
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <FlatList
          data={rows}
          kind="narrow"
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: space.xxl }}
          renderItem={({ item }) => {
            if (item.kind === 'header') return <Text style={styles.group}>{item.label}</Text>;
            if (item.kind === 'current') {
              return (
                <Pressable
                  style={({ pressed }) => [styles.current, pressed && { opacity: 0.7 }]}
                  onPress={() => {
                    onUseCurrentLocation?.();
                    onClose();
                  }}
                  accessibilityRole="button"
                >
                  <Icon name="locate-fixed" size={19} color={colors.primary} />
                  <Text style={styles.currentText}>Use current location</Text>
                </Pressable>
              );
            }
            const usable = isValidLatLng(item.place as Partial<LatLng>);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, !usable && { opacity: 0.5 }, pressed && { backgroundColor: colors.subtle }]}
                onPress={() => pick(item.place)}
                accessibilityRole="button"
                accessibilityLabel={`${item.place.name}, ${item.sub}`}
                disabled={!usable}
              >
                <Icon name={item.icon} size={18} color="#7E8896" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.place.name}
                  </Text>
                  <Text style={styles.addr} numberOfLines={2}>
                    {usable ? item.sub : 'No map position — re-save this place from search.'}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color="#9BA1AB" />
              </Pressable>
            );
          }}
          ListEmptyComponent={!active ? <Text style={styles.hint}>Type at least 3 letters to search.</Text> : null}
        />
      </Frame>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  frame: { paddingHorizontal: space.xl, paddingTop: space.xl },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
  },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14.5, color: colors.value, paddingVertical: 10 },
  error: { fontFamily: fonts.medium, color: colors.primaryDark, marginTop: space.sm, fontSize: 12 },
  current: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 64,
    paddingHorizontal: 16,
    marginTop: space.lg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currentText: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.value },
  group: { fontFamily: fonts.medium, fontSize: 9.5, color: '#7E8691', textTransform: 'uppercase', letterSpacing: 1, paddingTop: 24, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 15, minHeight: 64, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { fontFamily: fonts.medium, fontSize: 13, color: colors.text },
  addr: { fontFamily: fonts.regular, fontSize: 10.5, color: '#8A929E', marginTop: 3 },
  hint: { fontFamily: fonts.regular, fontSize: 12, textAlign: 'center', color: colors.muted, marginTop: space.xl },
});
