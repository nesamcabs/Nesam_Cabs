// What to list under a pickup or drop field for the current text: saved and recent places, popular cities
// and the browsable directory before typing; matching cities and live search results while typing.
import { useEffect, useMemo, useState } from 'react';
import type { GeoPlace, LatLng, LocationItem } from '@core/types';
import { searchPlaces } from '@core/services/geoService';
import { isOnline } from '@core/utils/network';
import type { PickerConfig } from '../LocationPicker';
import { directory, flattenTree, groupByRegion, norm, placeNode, searchDirectory, stateNear, withoutListed, type NodeKind, type PlaceNode, type TreeRow } from './model';

export interface Section {
  id: 'saved' | 'recent' | 'popular' | 'browse' | 'directory' | 'live' | 'airports';
  title: string;
  layout: 'list' | 'chips' | 'tree';
  rows: TreeRow[];
}

const SAVED_KIND: Record<string, NodeKind> = { home: 'home', work: 'work', airport: 'airport', favorite: 'favorite', recent: 'recent' };
const flatRows = (nodes: PlaceNode[]): TreeRow[] => nodes.map((node, i) => ({ node, depth: 0, guides: [], last: i === nodes.length - 1, expandable: false, open: false }));

export function usePlaceSuggestions({ config, query, saved, recent, enabled }: { config: PickerConfig; query: string; saved: LocationItem[]; recent: GeoPlace[]; enabled: boolean }) {
  const q = query.trim();
  const near: LatLng | null = config.near ?? null;
  const airportOnly = !!config.resultFilter;
  const [results, setResults] = useState<{ q: string; list: GeoPlace[]; error: string }>({ q: '', list: [], error: '' });
  const [attempt, setAttempt] = useState(0);
  const searching = enabled && q.length >= 3 && results.q !== q;

  // ── Live search (debounced, superseded requests aborted) ────────────────
  useEffect(() => {
    if (!enabled || q.length < 3) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, near, controller.signal)
        .then((raw) => {
          if (controller.signal.aborted) return;
          setResults({ q, list: config.resultFilter ? raw.filter(config.resultFilter) : raw, error: '' });
        })
        .catch(() => !controller.signal.aborted && setResults({ q, list: [], error: isOnline() ? 'Search is temporarily unavailable. Please try again.' : 'You’re offline — search needs a connection.' }));
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, q, near?.lat, near?.lng, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- coordinates, not object identity

  // ── Which branches are open; the rider's own choices reset when the text changes ──
  const [toggled, setToggled] = useState<{ q: string; map: Record<string, boolean> }>({ q: '', map: {} });
  const [tab, setTab] = useState('');
  const stateTab = tab || stateNear(near);
  const mine = toggled.q === q ? toggled.map : {};

  const built = useMemo(() => {
    const out: { id: Section['id']; title: string; layout: Section['layout']; nodes: PlaceNode[]; open: Set<string> }[] = [];
    if (!enabled) return out;
    const none = new Set<string>();
    const add = (id: Section['id'], title: string, layout: Section['layout'], nodes: PlaceNode[], open = none) => {
      if (nodes.length) out.push({ id, title, layout, nodes, open });
    };
    const lower = q.toLowerCase();
    const textHit = (p: { name: string; address: string }) => `${p.name} ${p.address}`.toLowerCase().includes(lower);
    const live = results.q === q && q.length >= 3 ? results.list : [];

    if (airportOnly) {
      const own = q ? config.popular.filter(textHit) : config.popular;
      const extra = live.filter((p) => !config.popular.some((c) => norm(c.name) === norm(p.name)));
      const tree = groupByRegion([...own, ...extra], 'air', 'airport');
      // Airports sit directly under their state: a district level above a single airport adds nothing.
      const states = tree.nodes.map((s) => ({ ...s, children: s.children?.flatMap((c) => (c.kind === 'district' ? c.children ?? [] : [c])) }));
      add('airports', config.popularLabel ?? 'Airports', 'tree', states, tree.open);
    } else if (!q) {
      add('saved', 'Saved places', 'list', saved.map((p) => placeNode(p, SAVED_KIND[p.type] ?? 'favorite', 'saved')));
      add('recent', 'Recent', 'list', recent.map((p) => placeNode(p, 'recent', 'recent')));
      add('popular', config.popularLabel ?? 'Popular cities', 'chips', config.popular.map((p) => placeNode(p, p.type === 'airport' ? 'airport' : 'main', 'pop')));
      add('browse', 'Browse by district', 'tree', directory().find((s) => s.id === stateTab)?.children ?? []);
    } else {
      const found = searchDirectory(q);
      add('directory', 'Cities and areas', 'tree', found.nodes, found.open);
      const tree = groupByRegion(withoutListed(live, found.places));
      add('live', found.nodes.length ? 'More places' : 'Search results', 'tree', tree.nodes, tree.open);
    }
    return out;
  }, [enabled, airportOnly, q, results, config.popular, config.popularLabel, saved, recent, stateTab]);

  const sections: Section[] = built.map((s) => ({
    id: s.id,
    title: s.title,
    layout: s.layout,
    rows: s.layout === 'tree' ? flattenTree(s.nodes, (id) => mine[id] ?? s.open.has(id)) : flatRows(s.nodes),
  }));
  const rows = sections.flatMap((s) => s.rows);
  const hasPlace = sections.some((s) => s.rows.length > 0);

  let status = '';
  if (q && !searching) {
    if (results.q === q && results.error) status = results.error;
    else if (!hasPlace) status = q.length < 3 ? 'Keep typing to search every place.' : config.emptyText ?? 'No places found. Try a landmark, area or city name.';
  }

  return {
    sections,
    rows,
    searching,
    status,
    failed: !!(q && results.q === q && results.error),
    retry: () => {
      setResults({ q: '', list: [], error: '' });
      setAttempt((n) => n + 1);
    },
    toggle: (row: TreeRow) => setToggled({ q, map: { ...mine, [row.node.id]: !row.open } }),
    stateTab,
    setStateTab: setTab,
  };
}

export type Suggestions = ReturnType<typeof usePlaceSuggestions>;
