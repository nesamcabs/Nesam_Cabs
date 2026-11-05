// Local Taxi service-zone geometry: GeoJSON-style Polygon / MultiPolygon in [longitude, latitude] order.
//
// Boundary policy (one rule, used everywhere on the server):
//   • A point exactly ON a zone edge or vertex is INSIDE the zone (boundary-inclusive).
//   • A point exactly on the edge of a hole is INSIDE the zone too (the hole's edge belongs to the zone).
//   • Only the open interior of a hole is outside.
// Zones are rejected if they touch or overlap one another, so a point can never belong to two zones.
//
// Maths are planar on degrees. That is accurate for a city-sized zone (the error is far below GPS error);
// zones are limited to a size where this holds (see MAX_ZONE_SPAN_DEG).

export type Position = [number, number];
export type Ring = Position[];
export type Polygon = { type: 'Polygon'; coordinates: Ring[] };
export type MultiPolygon = { type: 'MultiPolygon'; coordinates: Ring[][] };
export type Geometry = Polygon | MultiPolygon;
export interface LatLng { lat: number; lng: number }
export interface BBox { minLng: number; minLat: number; maxLng: number; maxLat: number }

export const MAX_VERTICES = 5000;
/** A single local-taxi zone cannot span more than this many degrees (~220 km), which keeps planar maths valid. */
export const MAX_ZONE_SPAN_DEG = 2;
const EPS = 1e-10;

const inIndiaBounds = (lng: number, lat: number) => lat >= 6.5 && lat <= 35.7 && lng >= 68.1 && lng <= 97.4;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class GeometryError extends Error {}

/** Polygons of a geometry as arrays of rings (outer first, then holes). */
export function polygonsOf(g: Geometry): Ring[][] {
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}

// ── Segment helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const cross = (o: Position, a: Position, b: Position) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function onSegment(p: Position, a: Position, b: Position): boolean {
  if (Math.abs(cross(a, b, p)) > EPS) return false;
  return p[0] >= Math.min(a[0], b[0]) - EPS && p[0] <= Math.max(a[0], b[0]) + EPS && p[1] >= Math.min(a[1], b[1]) - EPS && p[1] <= Math.max(a[1], b[1]) + EPS;
}

/** True when the closed segments ab and cd share at least one point (crossing OR touching). */
function segmentsMeet(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) return true;
  return onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}

function onRingEdge(p: Position, ring: Ring): boolean {
  for (let i = 0; i < ring.length - 1; i++) if (onSegment(p, ring[i]!, ring[i + 1]!)) return true;
  return false;
}

/** Ray casting; the caller has already handled points on the edge. */
function strictlyInRing(p: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function inPolygon(p: Position, rings: Ring[]): boolean {
  const outer = rings[0]!;
  if (!onRingEdge(p, outer) && !strictlyInRing(p, outer)) return false;
  for (let h = 1; h < rings.length; h++) {
    const hole = rings[h]!;
    if (onRingEdge(p, hole)) return true; // a hole's edge belongs to the zone
    if (strictlyInRing(p, hole)) return false;
  }
  return true;
}

/** Boundary-inclusive containment of a coordinate in a zone geometry. */
export function pointInGeometry(point: LatLng, g: Geometry): boolean {
  if (!isNum(point.lat) || !isNum(point.lng)) return false;
  const p: Position = [point.lng, point.lat];
  return polygonsOf(g).some((rings) => inPolygon(p, rings));
}

export function bboxOf(g: Geometry): BBox {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const rings of polygonsOf(g)) for (const [lng, lat] of rings[0]!) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

// ── Validation ───────────────────────────────────────────────────────────────────────────────────────────────────
function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) s += ring[i]![0] * ring[i + 1]![1] - ring[i + 1]![0] * ring[i]![1];
  return s / 2;
}

function validateRing(ring: unknown, label: string): Ring {
  if (!Array.isArray(ring) || ring.length < 4) throw new GeometryError(`${label} needs at least 3 distinct points.`);
  const out: Ring = [];
  for (const pos of ring) {
    if (!Array.isArray(pos) || pos.length < 2 || !isNum(pos[0]) || !isNum(pos[1])) throw new GeometryError(`${label} has a point that is not a valid coordinate.`);
    if (!inIndiaBounds(pos[0], pos[1])) throw new GeometryError(`${label} has a point outside India.`);
    out.push([pos[0], pos[1]]);
  }
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new GeometryError(`${label} must be closed (its first and last point must be the same).`);
  const distinct = new Set(out.slice(0, -1).map((p) => `${p[0]},${p[1]}`));
  if (distinct.size !== out.length - 1) throw new GeometryError(`${label} repeats a point.`);
  if (distinct.size < 3) throw new GeometryError(`${label} needs at least 3 distinct points.`);
  // A ring may not cross or touch itself (adjacent edges share only their common vertex).
  const n = out.length - 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const a = out[i]!, b = out[i + 1]!, c = out[j]!, d = out[j + 1]!;
      if (adjacent) {
        // Adjacent edges may share an endpoint only; reject if they overlap along a line (a spike).
        const shared = j === i + 1 ? b : a;
        const other1 = j === i + 1 ? a : b;
        const other2 = j === i + 1 ? d : c;
        if (Math.abs(cross(shared, other1, other2)) <= EPS && (other1[0] - shared[0]) * (other2[0] - shared[0]) + (other1[1] - shared[1]) * (other2[1] - shared[1]) > 0) throw new GeometryError(`${label} doubles back on itself.`);
        continue;
      }
      if (segmentsMeet(a, b, c, d)) throw new GeometryError(`${label} crosses itself.`);
    }
  }
  if (Math.abs(ringArea(out)) < 1e-10) throw new GeometryError(`${label} has no area.`);
  return out;
}

function ringsMeet(a: Ring, b: Ring): boolean {
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) if (segmentsMeet(a[i]!, a[i + 1]!, b[j]!, b[j + 1]!)) return true;
  return false;
}

/** Returns a normalised copy of the geometry, or throws GeometryError with a reason an admin can act on. */
export function validateGeometry(input: unknown): Geometry {
  if (!input || typeof input !== 'object') throw new GeometryError('The boundary is missing.');
  const g = input as { type?: unknown; coordinates?: unknown };
  let polys: unknown[];
  if (g.type === 'Polygon') polys = [g.coordinates];
  else if (g.type === 'MultiPolygon') polys = Array.isArray(g.coordinates) ? g.coordinates : [];
  else throw new GeometryError('The boundary must be a Polygon or a MultiPolygon.');
  if (!polys.length) throw new GeometryError('The boundary has no polygon.');
  if (polys.length > 20) throw new GeometryError('A zone can have at most 20 separate areas.');
  const out: Ring[][] = [];
  let vertices = 0;
  polys.forEach((p, pi) => {
    if (!Array.isArray(p) || !p.length) throw new GeometryError(`Area ${pi + 1} has no outline.`);
    const rings = p.map((r, ri) => validateRing(r, ri === 0 ? `Area ${pi + 1} outline` : `Area ${pi + 1} hole ${ri}`));
    vertices += rings.reduce((s, r) => s + r.length, 0);
    const outer = rings[0]!;
    for (let h = 1; h < rings.length; h++) {
      const hole = rings[h]!;
      if (ringsMeet(outer, hole)) throw new GeometryError(`Area ${pi + 1} hole ${h} touches or crosses the outline.`);
      if (!strictlyInRing(hole[0]!, outer)) throw new GeometryError(`Area ${pi + 1} hole ${h} is outside the outline.`);
      for (let k = 1; k < h; k++) {
        if (ringsMeet(hole, rings[k]!) || strictlyInRing(hole[0]!, rings[k]!) || strictlyInRing(rings[k]![0]!, hole)) throw new GeometryError(`Area ${pi + 1} holes ${k} and ${h} overlap.`);
      }
    }
    out.push(rings);
  });
  if (vertices > MAX_VERTICES) throw new GeometryError(`The boundary has too many points (limit ${MAX_VERTICES}).`);
  const normalised: Geometry = out.length === 1 ? { type: 'Polygon', coordinates: out[0]! } : { type: 'MultiPolygon', coordinates: out };
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    if (polygonsMeet(out[i]!, out[j]!)) throw new GeometryError(`Areas ${i + 1} and ${j + 1} of the zone overlap or touch.`);
  }
  const b = bboxOf(normalised);
  if (b.maxLng - b.minLng > MAX_ZONE_SPAN_DEG || b.maxLat - b.minLat > MAX_ZONE_SPAN_DEG) throw new GeometryError('A local taxi zone cannot be larger than about 200 km across.');
  return normalised;
}

function polygonsMeet(a: Ring[], b: Ring[]): boolean {
  for (const ra of a) for (const rb of b) if (ringsMeet(ra, rb)) return true;
  // No edges meet: either disjoint, or one polygon sits wholly inside the other's interior.
  return inPolygon(a[0]![0]!, b) || inPolygon(b[0]![0]!, a);
}

/** True when two zone geometries touch or overlap (shared boundary counts, so no point is ambiguous). */
export function geometriesOverlap(a: Geometry, b: Geometry): boolean {
  for (const pa of polygonsOf(a)) for (const pb of polygonsOf(b)) if (polygonsMeet(pa, pb)) return true;
  return false;
}

// ── Distances ────────────────────────────────────────────────────────────────────────────────────────────────────
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
