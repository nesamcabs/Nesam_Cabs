// Turns saved, recent, popular, directory and live search places into the State › District › City › Area
// tree shown under a pickup or drop field. Pure functions only: no React, no network.
import type { GeoPlace, LocationItem } from '@core/types';
import { GAZETTEER, type GzPlace, type PlaceKind } from './gazetteer';

export type NodeKind = PlaceKind | 'state' | 'district' | 'home' | 'work' | 'favorite' | 'recent' | 'place';

export interface PlaceNode {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle?: string;
  /** Set on everything that can be chosen; states and districts only open and close. */
  place?: GeoPlace | LocationItem;
  children?: PlaceNode[];
  /** Other names that should also match what is typed. */
  aka?: string[];
}

export interface TreeRow {
  node: PlaceNode;
  depth: number;
  /** One entry per level above this row: true while that level still has rows to come (draws the tree line). */
  guides: boolean[];
  last: boolean;
  expandable: boolean;
  open: boolean;
}

export const KIND_LABEL: Record<NodeKind, string> = {
  state: 'State',
  district: 'District',
  main: 'Main city',
  town: 'Town',
  temple: 'Temple town',
  hill: 'Hill station',
  beach: 'Coastal',
  area: 'Area',
  bus: 'Bus stand',
  train: 'Railway station',
  airport: 'Airport',
  landmark: 'Landmark',
  home: 'Home',
  work: 'Work',
  favorite: 'Saved',
  recent: 'Recent',
  place: 'Place',
};

const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
export const norm = (s: string): string => words(s).join('');

const slug = (s: string) => norm(s) || 'x';

// ── The directory as a tree ──────────────────────────────────────────────

/** What a place inside a city is called; towns elsewhere in the list keep the fuller labels. */
const INSIDE_LABEL: Partial<Record<PlaceKind, string>> = { temple: 'Temple', beach: 'Beach', hill: 'Hills' };

const gzPlaceNode = (p: GzPlace, parentId: string, trail: string[], state: string, city?: string): PlaceNode => {
  const id = `${parentId}/${slug(p.n)}`;
  const address = [...trail, state].filter((x, i, all) => x !== p.n && all.indexOf(x) === i).join(', ');
  // A hill station's pincode goes into the address, as in the map search's own results: the hill charge is found by it.
  const full = [address || state, p.pin].filter(Boolean).join(' ');
  const inside = p.areas?.map((a) => gzPlaceNode(a, id, [p.n, ...trail], state, p.n));
  // The booking keeps the name, so a landmark carries its city: "Central Bus Stand, Trichy".
  const name = city && p.k !== 'airport' && !norm(p.n).includes(norm(city)) ? `${p.n}, ${city}` : p.n;
  const label = city ? INSIDE_LABEL[p.k] : undefined;
  return {
    id,
    kind: p.k,
    title: p.n,
    aka: p.aka,
    ...(label ? { subtitle: label } : {}),
    place: { id: `dir-${id.replace(/\//g, '-')}`, name, address: full, type: p.k === 'airport' ? 'airport' : 'other', lat: p.lat, lng: p.lng },
    ...(inside?.length ? { children: inside } : {}),
  };
};

let cached: PlaceNode[] | null = null;

/** Every state, with its districts, their towns and the places inside the larger cities. */
export function directory(): PlaceNode[] {
  cached ??= GAZETTEER.map((s) => ({
    id: s.id,
    kind: 'state' as const,
    title: s.name,
    children: s.districts.map((d) => {
      const id = `${s.id}/d-${slug(d.name)}`;
      return {
        id,
        kind: 'district' as const,
        title: d.name,
        aka: d.aka,
        children: d.places.map((p) => gzPlaceNode(p, id, [d.name], s.name)),
      };
    }),
  }));
  return cached;
}

// ── Typing: matching directory entries ───────────────────────────────────

/** How well a name answers the query: 0 is no match. `context` holds the words of the levels above. */
export function matchScore(query: string, title: string, aka: string[] = [], context: string[] = []): number {
  const tokens = words(query);
  const joined = tokens.join('');
  if (joined.length < 2) return 0;
  const names = [title, ...aka];
  if (names.some((n) => norm(n) === joined)) return 100;
  if (names.some((n) => norm(n).startsWith(joined))) return 80;
  const own = names.flatMap(words);
  const hits = (t: string, list: string[]) => list.some((w) => w.startsWith(t));
  if (tokens.every((t) => hits(t, own))) return 60;
  // "trichy bus": one word names the place, the rest name the city or district it is in.
  if (tokens.some((t) => hits(t, own)) && tokens.every((t) => hits(t, own) || hits(t, context))) return 50;
  return 0;
}

export interface TreeResult {
  nodes: PlaceNode[];
  /** Branches that start open. */
  open: Set<string>;
  /** Every selectable entry in the tree, used to drop the same place from the live results. */
  places: PlaceNode[];
}

interface Scored {
  node: PlaceNode;
  score: number;
}

/** The part of the directory that matches what is typed, with each match shown under its district and state. */
export function searchDirectory(query: string, limit = 8): TreeResult {
  const open = new Set<string>();
  const strong: { id: string; score: number }[] = [];
  const walk = (node: PlaceNode, context: string[]): Scored | null => {
    const ownScore = matchScore(query, node.title, node.aka, context);
    // A main city outranks a town of the same score, so "tri" leads with Trichy and Trivandrum.
    const own = ownScore ? ownScore + (node.kind === 'main' ? 5 : 0) : 0;
    const nextContext = node.kind === 'state' ? context : [...context, ...[node.title, ...(node.aka ?? [])].flatMap(words)];
    const matched = (node.children ?? []).map((c) => walk(c, nextContext)).filter((c): c is Scored => !!c);
    if (!own && !matched.length) return null;
    matched.sort((a, b) => b.score - a.score);
    const best = Math.max(own, matched[0]?.score ?? 0);
    if (node.kind === 'state' || node.kind === 'district') {
      // A state or district typed in full (or one with no matching town) lists everything in it, best matches first;
      // while it is only half typed, just the towns that match.
      const first = matched.map((m) => m.node);
      const children = own >= 100 || (own >= 60 && !first.length) ? [...first, ...(node.children ?? []).filter((c) => !first.some((f) => f.id === c.id))] : first;
      if (matched.length || (node.kind === 'district' && own >= 60)) open.add(node.id);
      if (node.kind === 'state' && own >= 60) open.add(node.id);
      return { node: { ...node, children }, score: best };
    }
    // A matched city keeps all its areas; a matched area keeps only itself.
    if (own) {
      if (node.children?.length && own >= 80) strong.push({ id: node.id, score: own });
      // An area that answers the text better than the city does is shown straight away.
      if (matched.length && matched[0]!.score > own) open.add(node.id);
      const first = matched.map((m) => m.node);
      const rest = (node.children ?? []).filter((c) => !first.some((f) => f.id === c.id));
      return { node: { ...node, children: node.children ? [...first, ...rest] : undefined }, score: best };
    }
    open.add(node.id);
    return { node: { ...node, children: matched.map((m) => m.node) }, score: best };
  };

  let states = directory()
    .map((s) => walk(s, []))
    .filter((s): s is Scored => !!s)
    .sort((a, b) => b.score - a.score);
  // Strong matches push weak ones out, and the list stays short enough to read.
  const top = states[0]?.score ?? 0;
  states = states.filter((s) => s.score >= Math.min(top, 60));
  let left = limit;
  const nodes: PlaceNode[] = [];
  for (const s of states) {
    if (left <= 0) break;
    const districts = (s.node.children ?? []).slice(0, left);
    left -= districts.length;
    nodes.push({ ...s.node, children: districts });
  }
  // A city opens its areas when its name was typed in full, or when it is the only city the text can mean.
  for (const c of strong) if (c.score >= 100 || strong.length === 1) open.add(c.id);
  return { nodes, open, places: selectable(nodes) };
}

export function selectable(nodes: PlaceNode[]): PlaceNode[] {
  return nodes.flatMap((n) => [...(n.place ? [n] : []), ...selectable(n.children ?? [])]);
}

// ── Live results: which state and district is a place in? ────────────────

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
};

const STATE_ALIASES: Record<string, string> = { tamilnadu: 'tn', pondicherry: 'py', puducherry: 'py', kerala: 'kl', karnataka: 'ka', andhrapradesh: 'ap', telangana: 'ts' };

function nearestIn(point: { lat: number; lng: number }, stateId: string | null, within: number) {
  let found: { stateId: string; districtId: string; d: number } | null = null;
  for (const s of directory()) {
    if (stateId && s.id !== stateId) continue;
    for (const d of s.children ?? []) {
      for (const p of d.children ?? []) {
        const dist = km(point, p.place as GeoPlace);
        if (dist <= within && (!found || dist < found.d)) found = { stateId: s.id, districtId: d.id, d: dist };
      }
    }
  }
  return found;
}

export interface Region {
  stateId: string;
  stateName: string;
  districtId: string | null;
  districtName: string | null;
}

/** Reads the state and district from the address, falling back to the closest town in the directory. */
export function regionOf(place: { lat: number; lng: number; address?: string; name?: string }): Region {
  const parts = (place.address ?? '')
    .split(',')
    .map((p) => p.replace(/\b\d{6}\b/g, '').replace(/\bdistrict\b/i, '').trim())
    .filter((p) => p && norm(p) !== 'india');
  let stateId: string | null = null;
  let stateAt = -1;
  for (let i = parts.length - 1; i >= 0 && !stateId; i--) {
    stateId = STATE_ALIASES[norm(parts[i]!)] ?? null;
    if (stateId) stateAt = i;
  }
  // Outside the directory: still group by the state the address names (the last part before the country).
  if (!stateId) {
    const near = nearestIn(place, null, 40);
    if (near) stateId = near.stateId;
    else {
      const name = parts[parts.length - 1] || 'Other places';
      return { stateId: `x-${slug(name)}`, stateName: name, districtId: null, districtName: null };
    }
  }
  const state = directory().find((s) => s.id === stateId)!;
  const districts = state.children ?? [];
  const named = (n: PlaceNode, part: string) => [n.title, ...(n.aka ?? [])].some((x) => norm(x) === norm(part));
  let district: PlaceNode | undefined;
  // From the end of the address, where the district and city are, towards the street.
  const candidates = parts.filter((_, i) => i !== stateAt || stateId === 'py').reverse();
  for (const part of candidates) {
    district = districts.find((d) => named(d, part)) ?? districts.find((d) => d.children?.some((p) => named(p, part)));
    if (district) break;
  }
  if (!district) {
    const near = nearestIn(place, stateId, 25);
    district = near ? districts.find((d) => d.id === near.districtId) : undefined;
  }
  return { stateId: state.id, stateName: state.title, districtId: district?.id ?? null, districtName: district?.title ?? null };
}

const liveKind = (p: GeoPlace): NodeKind => {
  if (p.type === 'airport') return 'airport';
  const n = p.name.toLowerCase();
  if (/\b(bus stand|bus station|bus terminus|bus depot|bus stop)\b/.test(n)) return 'bus';
  if (/\b(railway station|junction railway|train station)\b/.test(n)) return 'train';
  if (/\b(temple|kovil|koil|church|mosque|masjid|dargah)\b/.test(n)) return 'temple';
  if (/\bbeach\b/.test(n)) return 'beach';
  return 'place';
};

export const placeNode = (p: GeoPlace | LocationItem, kind?: NodeKind, prefix = 'p'): PlaceNode => ({
  id: `${prefix}:${p.id}`,
  kind: kind ?? liveKind(p as GeoPlace),
  title: p.name,
  subtitle: p.address && p.address !== p.name ? p.address : undefined,
  place: p,
});

/** Places grouped State › District › place, keeping the order the search returned them in. */
export function groupByRegion(places: GeoPlace[], prefix = 'live', kind?: NodeKind): TreeResult {
  const states: PlaceNode[] = [];
  const open = new Set<string>();
  for (const p of places) {
    const r = regionOf(p);
    const stateKey = `${prefix}:${r.stateId}`;
    let state = states.find((s) => s.id === stateKey);
    if (!state) {
      state = { id: stateKey, kind: 'state', title: r.stateName, children: [] };
      states.push(state);
      open.add(stateKey);
    }
    const node = placeNode(p, kind, prefix);
    if (!r.districtId) {
      state.children!.push(node);
      continue;
    }
    const districtKey = `${prefix}:${r.districtId}`;
    let district = state.children!.find((d) => d.id === districtKey);
    if (!district) {
      district = { id: districtKey, kind: 'district', title: r.districtName!, children: [] };
      state.children!.push(district);
      open.add(districtKey);
    }
    district.children!.push(node);
  }
  return { nodes: states, open, places: selectable(states) };
}

/** Live results that the directory does not already show. */
export function withoutListed(live: GeoPlace[], listed: PlaceNode[]): GeoPlace[] {
  return live.filter((p) => {
    // "city-…" entries are the search's own copy of a main city.
    const reach = p.id.startsWith('city-') ? 12 : 3;
    return !listed.some((n) => {
      const names = [n.title, ...(n.aka ?? [])].map(norm);
      return names.includes(norm(p.name)) && km(n.place as GeoPlace, p) < reach;
    });
  });
}

/** The state whose towns are closest to the rider, for the "browse" tabs. */
export function stateNear(point: { lat: number; lng: number } | null | undefined): string {
  return (point ? nearestIn(point, null, 150)?.stateId : null) ?? 'tn';
}

// ── Tree → visible rows ──────────────────────────────────────────────────

export function flattenTree(nodes: PlaceNode[], isOpen: (id: string) => boolean, depth = 0, guides: boolean[] = []): TreeRow[] {
  return nodes.flatMap((node, i) => {
    const last = i === nodes.length - 1;
    const expandable = !!node.children?.length;
    const open = expandable && isOpen(node.id);
    const row: TreeRow = { node, depth, guides, last, expandable, open };
    if (!open) return [row];
    return [row, ...flattenTree(node.children!, isOpen, depth + 1, depth === 0 ? [] : [...guides, !last])];
  });
}
